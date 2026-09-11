import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthorizeRoles, Authorize, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { canAccessOrganization } from '../../common/auth/claims.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { badRequestText, conflict, forbidden, notFound } from '../../common/errors.js';
import { isGuid, parseDateOnly, salahToDb, timeOnlyToDb, utcToday } from '../../common/json.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { latestEntriesPerSalah, salahOrder, toIqamaEntryJson, type IqamaEntryJson } from './iqama.mapper.js';
import { iqamaScheduleSchema, iqamaUpsertSchema, type IqamaScheduleRequest, type IqamaUpsertRequest } from './iqama.schemas.js';

const OFFSET_RANGE_MESSAGE = 'Minutes after prayer start must be between 0 and 180.';

/** Port of IqamaController.cs. */
@Controller('api/v1/iqama')
@Authorize()
export class IqamaController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: SessionUser | null, @Query('orgId') orgId?: string, @Query('year') year?: string): Promise<IqamaEntryJson[]> {
    const organizationId = requireGuid(orgId);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const yearNumber = Number.parseInt(year ?? '', 10) || 0;
    const rows = await this.prisma.iqamaEntry.findMany({
      where: { organizationId, date: { gte: new Date(Date.UTC(yearNumber, 0, 1)), lt: new Date(Date.UTC(yearNumber + 1, 0, 1)) } },
      orderBy: [{ date: 'asc' }, { salah: 'asc' }],
    });
    return rows.map(toIqamaEntryJson);
  }

  @Get('current')
  async current(@CurrentUser() user: SessionUser | null, @Query('orgId') orgId?: string, @Query('date') date?: string): Promise<IqamaEntryJson[]> {
    const organizationId = requireGuid(orgId);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const effectiveDate = (date ? parseDateOnly(date) : null) ?? utcToday();
    const history = await this.prisma.iqamaEntry.findMany({
      where: { organizationId, date: { lte: effectiveDate } },
      orderBy: [{ date: 'asc' }, { updatedAtUtc: 'asc' }],
    });
    return latestEntriesPerSalah(history)
      .map(toIqamaEntryJson)
      .sort((a, b) => salahOrder(a.salah) - salahOrder(b.salah));
  }

  @Put('schedule')
  @AuthorizeRoles('Admin', 'Editor')
  async updateSchedule(@CurrentUser() user: SessionUser | null, @Body(validated(iqamaScheduleSchema)) req: IqamaScheduleRequest): Promise<IqamaEntryJson[]> {
    if (!canAccessOrganization(user, req.organizationId)) throw forbidden();
    if (req.entries.length === 0) throw badRequestText('Add at least one Iqama time.');
    if (req.entries.length > 9) throw badRequestText('A schedule can contain at most nine prayer entries.');
    if (new Set(req.entries.map((entry) => entry.salah)).size !== req.entries.length) throw badRequestText('Each prayer can appear only once for an effective date.');
    if (req.entries.some((entry) => entry.offsetMinutes !== null && (entry.offsetMinutes < 0 || entry.offsetMinutes > 180))) throw badRequestText(OFFSET_RANGE_MESSAGE);

    const salahValues = req.entries.map((entry) => salahToDb(entry.salah));
    const existing = await this.prisma.iqamaEntry.findMany({
      where: { organizationId: req.organizationId, date: req.effectiveDate, salah: { in: salahValues } },
    });
    const byValue = new Map(existing.map((row) => [row.salah, row]));
    const saved = [];
    for (const item of req.entries) {
      const value = salahToDb(item.salah);
      const data = {
        time: timeOnlyToDb(item.time),
        offsetMinutes: item.offsetMinutes,
        note: item.note?.trim() ? item.note.trim() : null,
        updatedAtUtc: new Date(),
      };
      const current = byValue.get(value);
      saved.push(
        current
          ? await this.prisma.iqamaEntry.update({ where: { id: current.id }, data })
          : await this.prisma.iqamaEntry.create({ data: { id: randomUUID(), organizationId: req.organizationId, date: req.effectiveDate, salah: value, ...data } }),
      );
    }
    return saved.map(toIqamaEntryJson).sort((a, b) => salahOrder(a.salah) - salahOrder(b.salah));
  }

  @Post()
  @AuthorizeRoles('Admin', 'Editor')
  async create(@CurrentUser() user: SessionUser | null, @Body(validated(iqamaUpsertSchema)) req: IqamaUpsertRequest, @Res({ passthrough: true }) response: Response): Promise<IqamaEntryJson> {
    if (!canAccessOrganization(user, req.organizationId)) throw forbidden();
    if (req.offsetMinutes !== null && (req.offsetMinutes < 0 || req.offsetMinutes > 180)) throw badRequestText(OFFSET_RANGE_MESSAGE);
    const duplicate = await this.prisma.iqamaEntry.findFirst({ where: { organizationId: req.organizationId, date: req.date, salah: salahToDb(req.salah) } });
    if (duplicate) throw conflict('An Iqama entry already exists for that prayer and effective date.');
    const created = await this.prisma.iqamaEntry.create({
      data: {
        id: randomUUID(),
        organizationId: req.organizationId,
        date: req.date,
        salah: salahToDb(req.salah),
        time: timeOnlyToDb(req.time),
        note: req.note,
        offsetMinutes: req.offsetMinutes,
        updatedAtUtc: new Date(),
      },
    });
    response.status(201).setHeader('Location', `/api/v1/iqama/${created.id}`);
    return toIqamaEntryJson(created);
  }

  @Put(':id')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(204)
  async update(@CurrentUser() user: SessionUser | null, @Param('id') id: string, @Body(validated(iqamaUpsertSchema)) req: IqamaUpsertRequest): Promise<void> {
    const existing = isGuid(id) ? await this.prisma.iqamaEntry.findFirst({ where: { id } }) : null;
    if (!existing) throw notFound();
    if (!canAccessOrganization(user, existing.organizationId) || req.organizationId.toLowerCase() !== existing.organizationId.toLowerCase()) throw forbidden();
    if (req.offsetMinutes !== null && (req.offsetMinutes < 0 || req.offsetMinutes > 180)) throw badRequestText(OFFSET_RANGE_MESSAGE);
    await this.prisma.iqamaEntry.update({
      where: { id: existing.id },
      data: { date: req.date, salah: salahToDb(req.salah), time: timeOnlyToDb(req.time), note: req.note, offsetMinutes: req.offsetMinutes, updatedAtUtc: new Date() },
    });
  }

  @Delete(':id')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(204)
  async remove(@CurrentUser() user: SessionUser | null, @Param('id') id: string): Promise<void> {
    const existing = isGuid(id) ? await this.prisma.iqamaEntry.findFirst({ where: { id } }) : null;
    if (!existing) throw notFound();
    if (!canAccessOrganization(user, existing.organizationId)) throw forbidden();
    await this.prisma.iqamaEntry.delete({ where: { id: existing.id } });
  }
}

function requireGuid(value: string | undefined): string {
  return value && isGuid(value) ? value : '00000000-0000-0000-0000-000000000000';
}
