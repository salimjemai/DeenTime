import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Authorize, AuthorizeRoles, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { canAccessOrganization, isSuperUser } from '../../common/auth/claims.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { conflict, forbidden, notFound, problem, validationProblem } from '../../common/errors.js';
import { formatDateOnly, isGuid, salahFromDb, utcToday } from '../../common/json.js';
import { pagedResult, type PagedResult } from '../../common/paged-result.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { normalizeWords, tryCreateIdentity } from '../../domain/registration-identity.js';
import { ProviderUnavailableError } from '../../integrations/errors.js';
import { PostalCodeService } from '../../integrations/postal-code.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { latestEntriesPerSalah } from '../iqama/iqama.mapper.js';
import { toCriteriaJson, toOrganizationJson } from './organization.mapper.js';
import { criteriaSchema, organizationUpdateSchema, type CriteriaRequest, type OrganizationUpdateRequest } from './organizations.schemas.js';

const PAGE_SIZE = 20;

/** Port of OrganizationsController.cs. */
@Controller('api/v1/orgs')
@Authorize()
export class OrganizationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly postalCodes: PostalCodeService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SessionUser | null, @Query('search') search?: string, @Query('page') page?: string): Promise<PagedResult<Record<string, unknown>>> {
    const where: { id?: string; name?: { contains: string; mode: 'insensitive' } } = {};
    if (!isSuperUser(user)) {
      if (!user?.orgId || !isGuid(user.orgId)) throw forbidden();
      where.id = user.orgId;
    }
    if (search?.trim()) where.name = { contains: search, mode: 'insensitive' };
    let pageNumber = Number.parseInt(page ?? '', 10);
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) pageNumber = 1;
    const [total, items] = await Promise.all([
      this.prisma.organization.count({ where }),
      this.prisma.organization.findMany({ where, orderBy: { name: 'asc' }, skip: (pageNumber - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    ]);
    return pagedResult(items.map((item) => toOrganizationJson(item)), pageNumber, PAGE_SIZE, total);
  }

  @Get(':idOrSlug')
  async get(@CurrentUser() user: SessionUser | null, @Param('idOrSlug') idOrSlug: string): Promise<Record<string, unknown>> {
    const organization = await this.prisma.organization.findFirst({
      where: isGuid(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug },
      include: { criteria: true },
    });
    if (organization && !canAccessOrganization(user, organization.id)) throw forbidden();
    if (!organization) throw notFound();
    return toOrganizationJson(organization, { criteria: organization.criteria });
  }

  @Put(':id')
  @Authorize('Admin')
  @HttpCode(204)
  async update(@CurrentUser() user: SessionUser | null, @Param('id') id: string, @Body(validated(organizationUpdateSchema)) input: OrganizationUpdateRequest): Promise<void> {
    if (!isGuid(id)) throw notFound();
    if (!canAccessOrganization(user, id)) throw forbidden();
    const existing = await this.prisma.organization.findFirst({ where: { id } });
    if (!existing) throw notFound();

    const data: Record<string, unknown> = {
      name: input.name,
      addressLine: input.addressLine,
      city: input.city,
      state: input.state,
      zipCode: input.zipCode,
      phone: input.phone,
      email: input.email,
      socialUrl: input.socialUrl,
      updatedAtUtc: new Date(),
    };
    let websiteUrl = existing.websiteUrl;
    if (input.websiteUrl?.trim() && input.addressLine?.trim() && input.city?.trim() && input.state?.trim() && input.zipCode?.trim()) {
      const identity = tryCreateIdentity(existing.email ?? '', input.name, input.websiteUrl, input.addressLine, input.city, input.state, input.zipCode);
      if (!identity) throw validationProblem({ WebsiteUrl: ['Enter a valid masjid website address.'] });
      data.normalizedName = identity.name;
      data.normalizedWebsiteHost = identity.websiteHost;
      data.addressFingerprint = identity.addressFingerprint;
      data.masjidIdentityKey = identity.masjidIdentityKey;
      websiteUrl = identity.websiteUrl;
    } else {
      data.normalizedName = normalizeWords(input.name);
    }
    if (!websiteUrl?.trim()) websiteUrl = input.websiteUrl;
    data.websiteUrl = websiteUrl;

    try {
      await this.prisma.organization.update({ where: { id }, data });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict({ code: 'masjid_already_registered', message: 'This masjid website or address belongs to another registration.' });
      throw error;
    }
  }

  @Get(':id/criteria')
  async getCriteria(@CurrentUser() user: SessionUser | null, @Param('id') id: string): Promise<Record<string, unknown>> {
    if (!isGuid(id)) throw notFound();
    if (!canAccessOrganization(user, id)) throw forbidden();
    const criteria = await this.prisma.prayerTimingCriteria.findFirst({ where: { organizationId: id } });
    if (!criteria) throw notFound();
    return toCriteriaJson(criteria);
  }

  @Put(':id/criteria')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(204)
  async putCriteria(@CurrentUser() user: SessionUser | null, @Param('id') id: string, @Body(validated(criteriaSchema)) input: CriteriaRequest): Promise<void> {
    if (!isGuid(id)) throw notFound();
    if (!canAccessOrganization(user, id)) throw forbidden();

    let latitude = input.latitude;
    let longitude = input.longitude;
    let zipCode = input.zipCode;
    const normalized = PostalCodeService.normalizeUsPostalCode(input.zipCode);
    if (normalized) {
      let location;
      try {
        location = await this.postalCodes.resolveUs(normalized);
      } catch (error) {
        if (error instanceof ProviderUnavailableError) {
          throw problem(503, 'Postal-code lookup is temporarily unavailable.', 'Prayer criteria were not saved because the location could not be verified.');
        }
        throw error;
      }
      if (!location) throw validationProblem({ ZipCode: ['The U.S. ZIP code could not be found.'] });
      // A U.S. ZIP is the source of truth for the calculation location.
      zipCode = location.postalCode;
      latitude = location.latitude;
      longitude = location.longitude;
    }

    const data = {
      method: input.method,
      juristicMethodAsr: input.juristicMethodAsr,
      latitude: String(latitude),
      longitude: String(longitude),
      timezoneId: input.timezoneId,
      dstObserved: input.dstObserved,
      dstBegins: input.dstBegins,
      dstEnds: input.dstEnds,
      zipCode,
      minutesAfterZawal: input.minutesAfterZawal,
      minutesAfterMaghrib: input.minutesAfterMaghrib,
      khutbahTimeMinutes: input.khutbahTimeMinutes,
      updatedAtUtc: new Date(),
    };
    const existing = await this.prisma.prayerTimingCriteria.findFirst({ where: { organizationId: id } });
    if (existing) await this.prisma.prayerTimingCriteria.update({ where: { id: existing.id }, data });
    else await this.prisma.prayerTimingCriteria.create({ data: { id: randomUUID(), organizationId: id, ...data } });
  }

  @Delete(':id/criteria')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(204)
  async deleteCriteria(@CurrentUser() user: SessionUser | null, @Param('id') id: string): Promise<void> {
    if (!isGuid(id)) throw notFound();
    if (!canAccessOrganization(user, id)) throw forbidden();
    await this.prisma.prayerTimingCriteria.deleteMany({ where: { organizationId: id } });
  }

  @Get(':id/readiness')
  async readiness(@CurrentUser() user: SessionUser | null, @Param('id') id: string): Promise<Record<string, unknown>> {
    if (!isGuid(id)) throw notFound();
    if (!canAccessOrganization(user, id)) throw forbidden();
    const organization = await this.prisma.organization.findFirst({ where: { id }, include: { criteria: true, design: true } });
    if (!organization) throw notFound();

    const today = utcToday();
    const active = latestEntriesPerSalah(await this.prisma.iqamaEntry.findMany({ where: { organizationId: id, date: { lte: today } } }));
    const activeSalahs = new Set(active.map((entry) => salahFromDb(entry.salah)));
    const daily = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'] as const;
    const dailyIqama = Object.fromEntries(daily.map((prayer) => [prayer, activeSalahs.has(prayer)])) as Record<string, boolean>;
    const jumuahCount = active.filter((entry) => ['Jumuah', 'Jumuah2nd', 'Jumuah3rd', 'Jumuah4th'].includes(salahFromDb(entry.salah))).length;
    const checks = {
      criteria: organization.criteria !== null,
      dailyIqama,
      jumuah: jumuahCount > 0,
      design: organization.design !== null && !!organization.design.headerImageUrl?.trim(),
      publicPreview: organization.criteria !== null,
    };
    return {
      readyToPublish: checks.criteria && daily.every((prayer) => dailyIqama[prayer]) && checks.jumuah && checks.design,
      checks,
      jumuahCount,
      effectiveDate: formatDateOnly(today),
    };
  }
}

/** Prisma unique-constraint violation (P2002) — the DbUpdateException case in .NET. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'P2002';
}
