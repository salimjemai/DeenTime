import { Controller, Get, Query } from '@nestjs/common';
import { badRequestText, notFound, validationProblem } from '../../common/errors.js';
import { addDays, dayNumber, isGuid, parseDateOnly } from '../../common/json.js';
import { RateLimit } from '../../common/rate-limit.js';
import { computePrayerTimes, toPrayerTimesDto, type PrayerTimesDto } from '../../domain/prayer-times.js';
import { todayInZone } from '../../domain/timezone.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { criteriaToCalculatorInput } from '../organizations/organization.mapper.js';

/** Port of TimingsController.cs (anonymous, "public" rate-limit policy). */
@Controller('api/v1/timings')
@RateLimit('public')
export class TimingsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@Query('orgId') orgId?: string, @Query('date') date?: string): Promise<PrayerTimesDto> {
    const parsed = requireDate(date, 'date');
    const criteria = await this.findCriteria(orgId);
    return toPrayerTimesDto(computePrayerTimes(criteria, parsed));
  }

  @Get('range')
  async range(@Query('orgId') orgId?: string, @Query('from') from?: string, @Query('to') to?: string): Promise<PrayerTimesDto[]> {
    const start = requireDate(from, 'from');
    const end = requireDate(to, 'to');
    if (end.getTime() < start.getTime()) throw badRequestText('Invalid range');
    const span = dayNumber(end) - dayNumber(start);
    if (span > 366) throw badRequestText('Date range must be no more than 367 days.');
    const criteria = await this.findCriteria(orgId);
    const results: PrayerTimesDto[] = [];
    for (let offset = 0; offset <= span; offset += 1) {
      results.push(toPrayerTimesDto(computePrayerTimes(criteria, addDays(start, offset))));
    }
    return results;
  }

  @Get('today')
  async today(@Query('orgId') orgId?: string): Promise<PrayerTimesDto> {
    const criteria = await this.findCriteria(orgId);
    return toPrayerTimesDto(computePrayerTimes(criteria, todayInZone(criteria.timezoneId)));
  }

  private async findCriteria(orgId: string | undefined) {
    if (!orgId) throw validationProblem({ orgId: ['The orgId field is required.'] });
    const organization = await this.prisma.organization.findFirst({
      where: isGuid(orgId) ? { id: orgId } : { slug: orgId },
      include: { criteria: true },
    });
    if (!organization?.criteria) throw notFound();
    return criteriaToCalculatorInput(organization.criteria);
  }
}

function requireDate(value: string | undefined, name: string): Date {
  const parsed = value ? parseDateOnly(value) : null;
  if (!parsed) throw validationProblem({ [name]: [`The value '${value ?? ''}' is not valid.`] });
  return parsed;
}
