import { Controller, Get, HttpCode, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { problem } from '../../common/errors.js';
import { formatDateOnly } from '../../common/json.js';
import { RateLimit } from '../../common/rate-limit.js';
import { AppConfig } from '../../config/configuration.js';
import { buildHijriDisplay, type HijriDisplay } from '../../domain/hijri.js';
import { computePrayerTimes, toPrayerTimesDto, type PrayerTimesDto } from '../../domain/prayer-times.js';
import { todayInZone } from '../../domain/timezone.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { criteriaToCalculatorInput } from '../organizations/organization.mapper.js';
import {
  absoluteRoute,
  dotnetTicks,
  escapeDataString,
  redirectToFrontend,
  resolvePublicOrigin,
  ticksFromUtcText,
  versionedAssetUrl,
} from './public-origin.js';
import {
  buildDisplayDesign,
  buildIqamaItems,
  buildTvConfig,
  iframe,
  parseDisplayParameters,
  SUPPORTED_LAYOUTS,
  SUPPORTED_THEMES,
  webUtilityHtmlEncode,
  type DisplayDesign,
  type DisplayIqamaItem,
  type DisplayTvConfig,
} from './public.mapper.js';

export interface DisplayResponse {
  organization: { name: string; slug: string; addressLine: string | null; city: string | null; state: string | null };
  date: string;
  timezoneId: string;
  timings: PrayerTimesDto | null;
  iqama: DisplayIqamaItem[];
  monthlyPdfUrl: string | null;
  design: DisplayDesign;
  hijri: HijriDisplay | null;
  tvConfig: DisplayTvConfig;
}

export interface DisplayEmbed {
  url: string;
  iframe: string;
}

export interface DisplayDiscoveryResponse {
  organization: { name: string; slug: string };
  displays: { tv: DisplayEmbed; widget: DisplayEmbed; combined: DisplayEmbed; daily: DisplayEmbed; jumuah: DisplayEmbed; compact: DisplayEmbed };
  supportedParameters: { locale: string[]; theme: string[]; fontScale: { min: number; max: number; step: number }; layout: string[] };
  defaults: { theme: string; fontScale: number; locale: string };
  provider: string;
}

/** UpdatedAtUtc with the microseconds Npgsql keeps in DateTime.Ticks and Prisma's Date drops. */
const DESIGN_VERSION_SQL = 'SELECT to_char("UpdatedAtUtc" AT TIME ZONE \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US\') AS utc FROM "DesignSettings" WHERE "Id" = $1';

/** Port of PublicController.cs (anonymous, "public" rate-limit policy); the routes outside /public live in LegacyRedirectController. */
@Controller('public')
@RateLimit('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  @Get('display/:slug')
  async display(@Param('slug') slug: string, @Query() query: Record<string, unknown>, @Req() request: Request): Promise<DisplayResponse> {
    const parameters = parseDisplayParameters(query);
    const org = await this.prisma.organization.findUnique({ where: { slug }, include: { criteria: true, design: true } });
    if (!org) throw problem(404);

    const timezoneId = org.criteria?.timezoneId ?? 'UTC';
    const date = todayInZone(timezoneId);
    const times = org.criteria ? computePrayerTimes(criteriaToCalculatorInput(org.criteria), date) : null;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const [history, hijriMap, tvConfig, artifact] = await Promise.all([
      this.prisma.iqamaEntry.findMany({ where: { organizationId: org.id, date: { lte: date } } }),
      this.prisma.hijriMonthMap.findFirst({ where: { organizationId: org.id, year, month } }),
      this.prisma.tvDisplayConfig.findFirst({ where: { organizationId: org.id } }),
      this.prisma.publishArtifact.findFirst({ where: { organizationId: org.id, year, month }, orderBy: { createdAtUtc: 'desc' }, select: { storageUrl: true } }),
    ]);

    // PublicOrigin() is only consulted for a relative header image, exactly like VersionedAssetUrl.
    let origin: URL | null = null;
    const publicOrigin = (): URL => (origin ??= resolvePublicOrigin(this.config, request));
    const headerImage = org.design?.headerImageUrl ?? null;
    const headerImageUrl = org.design && headerImage !== null && headerImage.trim() !== '' ? versionedAssetUrl(headerImage, await this.designVersion(org.design), publicOrigin) : null;

    return {
      organization: { name: org.name, slug: org.slug, addressLine: org.addressLine, city: org.city, state: org.state },
      date: formatDateOnly(date),
      timezoneId,
      timings: times === null ? null : toPrayerTimesDto(times),
      iqama: buildIqamaItems(history, times, org.criteria?.khutbahTimeMinutes ?? 30),
      monthlyPdfUrl: artifact?.storageUrl ?? null,
      design: buildDisplayDesign(org.design, parameters, headerImageUrl),
      hijri: buildHijriDisplay(date, hijriMap),
      tvConfig: buildTvConfig(tvConfig),
    };
  }

  @Get('organizations/:slug/displays')
  async discoverDisplays(@Param('slug') slug: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<DisplayDiscoveryResponse> {
    // [ResponseCache(NoStore = true, Location = None)] runs before the action, so the 404 carries these too.
    response.setHeader('Cache-Control', 'no-store,no-cache');
    response.setHeader('Pragma', 'no-cache');
    const org = await this.prisma.organization.findUnique({ where: { slug }, select: { name: true, slug: true } });
    if (!org) throw problem(404);

    const origin = resolvePublicOrigin(this.config, request);
    const escapedSlug = escapeDataString(org.slug);
    const tvUrl = absoluteRoute(origin, `/tv/${escapedSlug}`);
    const widgetUrl = absoluteRoute(origin, `/w/${escapedSlug}`);
    const dailyWidgetUrl = absoluteRoute(origin, `/w/${escapedSlug}/daily`);
    const jumuahWidgetUrl = absoluteRoute(origin, `/w/${escapedSlug}/jumuah`);
    const compactUrl = absoluteRoute(origin, `/w2/${escapedSlug}`);
    const encodedTitle = webUtilityHtmlEncode(`IqamaTime · ${org.name} prayer times`);

    return {
      organization: { name: org.name, slug: org.slug },
      displays: {
        tv: { url: tvUrl, iframe: iframe(tvUrl, encodedTitle, '100%', '720', false) },
        widget: { url: widgetUrl, iframe: iframe(widgetUrl, encodedTitle, '390', '920', true) },
        combined: { url: widgetUrl, iframe: iframe(widgetUrl, encodedTitle, '390', '920', true) },
        daily: { url: dailyWidgetUrl, iframe: iframe(dailyWidgetUrl, webUtilityHtmlEncode(`IqamaTime · ${org.name} daily prayer times`), '390', '720', true) },
        jumuah: { url: jumuahWidgetUrl, iframe: iframe(jumuahWidgetUrl, webUtilityHtmlEncode(`IqamaTime · ${org.name} Friday prayer times`), '390', '560', true) },
        compact: { url: compactUrl, iframe: iframe(compactUrl, encodedTitle, '330', '820', true) },
      },
      supportedParameters: {
        locale: ['en-US', 'ar', 'ur'],
        theme: [...SUPPORTED_THEMES],
        fontScale: { min: 75, max: 160, step: 5 },
        layout: [...SUPPORTED_LAYOUTS],
      },
      defaults: { theme: 'default', fontScale: 100, locale: 'en-US' },
      provider: 'IqamaTime',
    };
  }

  @Get('widget/:slug')
  @HttpCode(302)
  widget(@Param('slug') slug: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    redirectToFrontend(this.config, request, response, `/w/${escapeDataString(slug)}`);
  }

  @Get('widget/:slug/daily')
  @HttpCode(302)
  dailyWidget(@Param('slug') slug: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    redirectToFrontend(this.config, request, response, `/w/${escapeDataString(slug)}/daily`);
  }

  @Get('widget/:slug/jumuah')
  @HttpCode(302)
  jumuahWidget(@Param('slug') slug: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    redirectToFrontend(this.config, request, response, `/w/${escapeDataString(slug)}/jumuah`);
  }

  @Get('tv/:slug')
  @HttpCode(302)
  tv(@Param('slug') slug: string, @Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    redirectToFrontend(this.config, request, response, `/tv/${escapeDataString(slug)}`);
  }

  /** DesignSettings.UpdatedAtUtc.Ticks; falls back to the millisecond Date when the row cannot be re-read. */
  private async designVersion(design: { id: string; updatedAtUtc: Date }): Promise<string> {
    const result = await this.prisma.pool.query<{ utc: string }>(DESIGN_VERSION_SQL, [design.id]);
    return ticksFromUtcText(result.rows[0]?.utc) ?? dotnetTicks(design.updatedAtUtc);
  }
}
