import { Controller, Get, HttpCode, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { badRequestText, modelValidationProblem } from '../../common/errors.js';
import { RateLimit } from '../../common/rate-limit.js';
import { AppConfig } from '../../config/configuration.js';
import { escapeDataString, redirectToFrontend } from './public-origin.js';
import { bindQueryString, legacySlug, queryValues, queryValueToString } from './public.mapper.js';

/**
 * The PublicController.cs actions routed outside the /public prefix ([HttpGet("/clock")],
 * [HttpGet("/iqama-widget.php")], [HttpGet("/iqama-widget2.php")]): permanent homes of
 * the pre-IqamaTime embed URLs, redirected to the frontend routes.
 */
@Controller()
@RateLimit('public')
export class LegacyRedirectController {
  constructor(private readonly config: AppConfig) {}

  /** `string masjid` is non-nullable, so a missing or blank value is a ModelState error. */
  @Get('clock')
  @HttpCode(302)
  legacyClock(@Query() query: Record<string, unknown>, @Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    const masjid = bindQueryString(queryValues(query, 'masjid'));
    if (masjid === undefined) throw modelValidationProblem({ masjid: ['The masjid field is required.'] });
    redirectToFrontend(this.config, request, response, `/tv/${escapeDataString(masjid)}`);
  }

  @Get(['iqama-widget.php', 'iqama-widget2.php'])
  @HttpCode(302)
  legacyWidget(@Query() query: Record<string, unknown>, @Req() request: Request, @Res({ passthrough: true }) response: Response): void {
    const separator = request.originalUrl.indexOf('?');
    const rawQueryString = separator < 0 ? '' : request.originalUrl.slice(separator);
    const slug = legacySlug(rawQueryString, queryValueToString(queryValues(query, 'masjid')));
    const compact = request.path.toLowerCase().includes('widget2');
    if (slug.trim() === '') throw badRequestText('Missing organization slug');
    redirectToFrontend(this.config, request, response, `/${compact ? 'w2' : 'w'}/${escapeDataString(slug)}`);
  }
}
