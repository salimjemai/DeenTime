import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Authorize, AuthorizeRoles, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { canAccessOrganization } from '../../common/auth/claims.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { badRequestText, forbidden, notFound } from '../../common/errors.js';
import { EMPTY_GUID, formatDateTime, isGuid, parseDateOnly } from '../../common/json.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { generateHijriMonthMaps } from '../../domain/hijri.js';
import { PrismaService } from '../../prisma/prisma.service.js';

interface HijriMonthMapRow {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  hijriDayOnFirst: number;
  hijriMonthOnFirst: number;
  hijriYearOnFirst: number;
  locked: boolean;
  updatedAtUtc: Date;
}

/** HijriMonthMap entity JSON. */
export function toHijriMonthMapJson(row: HijriMonthMapRow): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organizationId,
    year: row.year,
    month: row.month,
    hijriDayOnFirst: row.hijriDayOnFirst,
    hijriMonthOnFirst: row.hijriMonthOnFirst,
    hijriYearOnFirst: row.hijriYearOnFirst,
    locked: row.locked,
    updatedAtUtc: formatDateTime(row.updatedAtUtc),
  };
}

/** HijriUpsertRequest (no validator; model binding defaults). */
const hijriUpsertSchema = z.object({
  organizationId: z.string().nullish().transform((value) => (value && isGuid(value) ? value : EMPTY_GUID)),
  year: z.coerce.number().int().default(0),
  month: z.coerce.number().int().default(0),
  hijriDayOnFirst: z.coerce.number().int().default(0),
  hijriMonthOnFirst: z.coerce.number().int().nullish().transform((value) => value ?? null),
  hijriYearOnFirst: z.coerce.number().int().nullish().transform((value) => value ?? null),
  locked: z.boolean().default(false),
});
type HijriUpsertRequest = z.infer<typeof hijriUpsertSchema>;

function parseMonthRange(from: string | undefined, to: string | undefined, invalidMessage: string): { fromDate: Date; toDate: Date } {
  const fromDate = parseDateOnly(`${from ?? ''}-01`);
  const toDate = parseDateOnly(`${to ?? ''}-01`);
  if (!fromDate || !toDate) throw badRequestText(invalidMessage);
  const months = (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12 + toDate.getUTCMonth() - fromDate.getUTCMonth();
  if (toDate.getTime() < fromDate.getTime() || months > 24) throw badRequestText('Date range must be no more than 24 months.');
  return { fromDate, toDate };
}

function inRange(row: { year: number; month: number }, fromDate: Date, toDate: Date): boolean {
  const key = row.year * 12 + row.month;
  return key >= fromDate.getUTCFullYear() * 12 + fromDate.getUTCMonth() + 1 && key <= toDate.getUTCFullYear() * 12 + toDate.getUTCMonth() + 1;
}

/** Port of HijriController.cs. */
@Controller('api/v1/hijri')
@Authorize()
export class HijriController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':orgId')
  async get(@CurrentUser() user: SessionUser | null, @Param('orgId') orgId: string, @Query('from') from?: string, @Query('to') to?: string): Promise<Record<string, unknown>[]> {
    if (!isGuid(orgId)) throw notFound();
    if (!canAccessOrganization(user, orgId)) throw forbidden();
    const { fromDate, toDate } = parseMonthRange(from, to, 'Invalid YYYY-MM range');
    const stored = (await this.prisma.hijriMonthMap.findMany({ where: { organizationId: orgId }, orderBy: [{ year: 'asc' }, { month: 'asc' }] })).filter((row) => inRange(row, fromDate, toDate));
    const byMonth = new Map(stored.map((row) => [`${row.year}-${row.month}`, row]));
    const all = [...stored];
    for (const generated of generateHijriMonthMaps(fromDate, toDate)) {
      const existing = byMonth.get(`${generated.year}-${generated.month}`);
      if (!existing) {
        const created = await this.prisma.hijriMonthMap.create({
          data: { id: randomUUID(), organizationId: orgId, ...generated, updatedAtUtc: new Date() },
        });
        all.push(created);
      } else if (!existing.locked && (existing.hijriMonthOnFirst <= 0 || existing.hijriYearOnFirst <= 1)) {
        const updated = await this.prisma.hijriMonthMap.update({
          where: { id: existing.id },
          data: { hijriDayOnFirst: generated.hijriDayOnFirst, hijriMonthOnFirst: generated.hijriMonthOnFirst, hijriYearOnFirst: generated.hijriYearOnFirst, updatedAtUtc: new Date() },
        });
        all[all.indexOf(existing)] = updated;
      }
    }
    return all.sort((a, b) => a.year - b.year || a.month - b.month).map(toHijriMonthMapJson);
  }

  @Post()
  @AuthorizeRoles('Admin', 'Editor')
  async create(@CurrentUser() user: SessionUser | null, @Body(validated(hijriUpsertSchema)) req: HijriUpsertRequest, @Res({ passthrough: true }) response: Response): Promise<Record<string, unknown>> {
    if (!canAccessOrganization(user, req.organizationId)) throw forbidden();
    const created = await this.prisma.hijriMonthMap.create({
      data: {
        id: randomUUID(),
        organizationId: req.organizationId,
        year: req.year,
        month: req.month,
        hijriDayOnFirst: req.hijriDayOnFirst,
        hijriMonthOnFirst: req.hijriMonthOnFirst ?? 1,
        hijriYearOnFirst: req.hijriYearOnFirst ?? 1,
        locked: req.locked,
        updatedAtUtc: new Date(),
      },
    });
    response.status(201).setHeader('Location', `/api/v1/hijri/${created.id}`);
    return toHijriMonthMapJson(created);
  }

  @Put(':id')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(204)
  async update(@CurrentUser() user: SessionUser | null, @Param('id') id: string, @Body(validated(hijriUpsertSchema)) req: HijriUpsertRequest): Promise<void> {
    const existing = isGuid(id) ? await this.prisma.hijriMonthMap.findFirst({ where: { id } }) : null;
    if (!existing) throw notFound();
    if (!canAccessOrganization(user, existing.organizationId)) throw forbidden();
    if (req.organizationId.toLowerCase() !== existing.organizationId.toLowerCase()) throw badRequestText('A Hijri record cannot be moved to another masjid.');
    await this.prisma.hijriMonthMap.update({
      where: { id: existing.id },
      data: {
        year: req.year,
        month: req.month,
        hijriDayOnFirst: req.hijriDayOnFirst,
        hijriMonthOnFirst: req.hijriMonthOnFirst ?? existing.hijriMonthOnFirst,
        hijriYearOnFirst: req.hijriYearOnFirst ?? existing.hijriYearOnFirst,
        locked: req.locked,
        updatedAtUtc: new Date(),
      },
    });
  }

  @Post('regenerate/:orgId')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(200)
  async regenerate(@CurrentUser() user: SessionUser | null, @Param('orgId') orgId: string, @Query('from') from?: string, @Query('to') to?: string): Promise<{ regenerated: number; preservedLocked: number }> {
    if (!isGuid(orgId)) throw notFound();
    if (!canAccessOrganization(user, orgId)) throw forbidden();
    const { fromDate, toDate } = parseMonthRange(from, to, 'Invalid range');
    const existing = (await this.prisma.hijriMonthMap.findMany({ where: { organizationId: orgId } })).filter((row) => inRange(row, fromDate, toDate));
    const locked = new Set(existing.filter((row) => row.locked).map((row) => `${row.year}-${row.month}`));
    const generated = generateHijriMonthMaps(fromDate, toDate).filter((row) => !locked.has(`${row.year}-${row.month}`));
    await this.prisma.$transaction([
      this.prisma.hijriMonthMap.deleteMany({ where: { id: { in: existing.filter((row) => !row.locked).map((row) => row.id) } } }),
      this.prisma.hijriMonthMap.createMany({
        data: generated.map((row) => ({ id: randomUUID(), organizationId: orgId, ...row, updatedAtUtc: new Date() })),
      }),
    ]);
    return { regenerated: generated.length, preservedLocked: locked.size };
  }
}
