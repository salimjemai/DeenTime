import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Authorize, AuthorizeRoles, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { canAccessOrganization } from '../../common/auth/claims.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { forbidden, notFound, validationProblem } from '../../common/errors.js';
import { EMPTY_GUID, enumToDb, isGuid, PDF_ORIENTATIONS, PDF_SIZES, type PdfOrientation, type PdfSize } from '../../common/json.js';
import { RateLimit } from '../../common/rate-limit.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { AppConfig } from '../../config/configuration.js';
import { STORAGE_SERVICE, type StorageService } from '../../integrations/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { buildEmbedCode, resolvePublicOrigin, type EmbedCode } from './embed-code.js';
import { PdfGeneratorService } from './pdf-generator.service.js';
import { TV_DISPLAY_CONFIG_DEFAULTS, toPublishArtifactJson, toTvDisplayConfigJson, tvDisplayConfigValues, type PublishArtifactJson, type TvDisplayConfigJson } from './publish.mapper.js';
import {
  pdfGenerateSchema,
  ramadanPdfGenerateSchema,
  tvConfigUpdateSchema,
  type PdfGenerateRequest,
  type RamadanPdfGenerateRequest,
  type TvConfigUpdateRequest,
} from './publish.schemas.js';

/** Port of PublishController.cs. */
@Controller('api/v1/publish')
@Authorize()
export class PublishController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly pdfs: PdfGeneratorService,
  ) {}

  @Get('embed-code/:orgId')
  async embedCode(@CurrentUser() user: SessionUser | null, @Param('orgId') orgId: string, @Query('publicOrigin') publicOrigin?: string | string[]): Promise<EmbedCode> {
    const organizationId = routeGuid(orgId);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const organization = await this.prisma.organization.findFirst({ where: { id: organizationId } });
    if (!organization) throw notFound();
    const origin = resolvePublicOrigin(firstValue(publicOrigin), this.config.get('Frontend:PublicBaseUrl'), this.config.isDevelopment());
    return buildEmbedCode(origin, organization);
  }

  @Get('tv-config/:orgId')
  async tvConfig(@CurrentUser() user: SessionUser | null, @Param('orgId') orgId: string): Promise<TvDisplayConfigJson> {
    const organizationId = routeGuid(orgId);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const stored = await this.prisma.tvDisplayConfig.findFirst({ where: { organizationId } });
    return toTvDisplayConfigJson(stored ?? { id: randomUUID(), organizationId, ...TV_DISPLAY_CONFIG_DEFAULTS });
  }

  @Put('tv-config/:orgId')
  @AuthorizeRoles('Admin', 'Editor')
  async updateTvConfig(
    @CurrentUser() user: SessionUser | null,
    @Param('orgId') orgId: string,
    @Body(validated(tvConfigUpdateSchema)) req: TvConfigUpdateRequest,
  ): Promise<TvDisplayConfigJson> {
    const organizationId = routeGuid(orgId);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const values = tvDisplayConfigValues(req);
    const saved = await this.prisma.tvDisplayConfig.upsert({
      where: { organizationId },
      create: { id: randomUUID(), organizationId, ...values },
      update: values,
    });
    return toTvDisplayConfigJson(saved);
  }

  @Post('pdf/generate')
  @AuthorizeRoles('Admin', 'Editor')
  @RateLimit('expensive')
  @HttpCode(200)
  async generatePdf(@CurrentUser() user: SessionUser | null, @Body(validated(pdfGenerateSchema)) req: PdfGenerateRequest, @Req() request: Request): Promise<PublishArtifactJson> {
    if (!canAccessOrganization(user, req.orgId)) throw forbidden();
    const bytes = await this.pdfs.generateMonthlyPdf(req.orgId, req.year, req.month, req.size, req.orientation);
    const key = `artifacts/${req.orgId}/${req.year}-${req.month}-${randomUUID()}.pdf`;
    return this.storeArtifact(request, key, bytes, req.orgId, req.year, req.month, req.size, req.orientation);
  }

  @Post('pdf/ramadan')
  @AuthorizeRoles('Admin', 'Editor')
  @RateLimit('expensive')
  @HttpCode(200)
  async generateRamadanPdf(
    @CurrentUser() user: SessionUser | null,
    @Body(validated(ramadanPdfGenerateSchema)) req: RamadanPdfGenerateRequest,
    @Req() request: Request,
  ): Promise<PublishArtifactJson> {
    if (!canAccessOrganization(user, req.orgId)) throw forbidden();
    const bytes = await this.pdfs.generateRamadanPdf(req.orgId, req.year, req.size, req.orientation);
    const key = `artifacts/${req.orgId}/ramadan-${req.year}-${req.size}-${randomUUID()}.pdf`;
    return this.storeArtifact(request, key, bytes, req.orgId, req.year, 0, req.size, req.orientation);
  }

  @Get('artifacts')
  async listArtifacts(@CurrentUser() user: SessionUser | null, @Query('orgId') orgId?: string | string[], @Query('year') year?: string | string[]): Promise<PublishArtifactJson[]> {
    const query = bindArtifactsQuery(firstValue(orgId), firstValue(year));
    if (!canAccessOrganization(user, query.organizationId)) throw forbidden();
    const rows = await this.prisma.publishArtifact.findMany({
      where: { organizationId: query.organizationId, year: query.year },
      orderBy: { createdAtUtc: 'desc' },
    });
    return rows.map(toPublishArtifactJson);
  }

  @Get('pdf/:artifactId')
  async getPdf(@CurrentUser() user: SessionUser | null, @Param('artifactId') artifactId: string, @Res() response: Response): Promise<void> {
    const artifact = isGuid(artifactId) ? await this.prisma.publishArtifact.findFirst({ where: { id: artifactId } }) : null;
    if (!artifact) throw notFound();
    if (!canAccessOrganization(user, artifact.organizationId)) throw forbidden();
    // Redirect(url): 302 with the stored URL as-is and no body.
    response.status(302).setHeader('Location', artifact.storageUrl);
    response.end();
  }

  /** UploadAsync + the PublishArtifact row (enums stored as their integer values). */
  private async storeArtifact(request: Request, key: string, bytes: Buffer, organizationId: string, year: number, month: number, size: PdfSize, orientation: PdfOrientation): Promise<PublishArtifactJson> {
    const publicOrigin = `${request.protocol}://${request.get('host') ?? 'localhost'}`;
    const storageUrl = await this.storage.upload(key, 'application/pdf', bytes, publicOrigin);
    const artifact = await this.prisma.publishArtifact.create({
      data: {
        id: randomUUID(),
        organizationId,
        year,
        month,
        size: enumToDb(PDF_SIZES, size),
        orientation: enumToDb(PDF_ORIENTATIONS, orientation),
        storageUrl,
        createdAtUtc: new Date(),
      },
    });
    return toPublishArtifactJson(artifact);
  }
}

/** {orgId:guid} route constraint: anything else is 404, and Guid.ToString() is lower-case. */
function routeGuid(value: string): string {
  if (!isGuid(value)) throw notFound();
  return value.toLowerCase();
}

/** [FromQuery] string: the first value of a repeated query key. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * ListArtifacts([FromQuery] Guid orgId, [FromQuery] int year) model binding: a missing value
 * is the type's default, an empty or unparsable one is a 400 ValidationProblemDetails.
 */
function bindArtifactsQuery(orgId: string | undefined, year: string | undefined): { organizationId: string; year: number } {
  const errors: Record<string, string[]> = {};
  let organizationId = EMPTY_GUID;
  if (orgId !== undefined) {
    if (orgId.trim() === '') errors.orgId = [`The value '${orgId}' is invalid.`];
    else if (isGuid(orgId.trim())) organizationId = orgId.trim().toLowerCase();
    else errors.orgId = [`The value '${orgId}' is not valid.`];
  }
  let yearNumber = 0;
  if (year !== undefined) {
    const parsed = /^\s*[+-]?\d+\s*$/.test(year) ? Number(year) : Number.NaN;
    if (year.trim() === '') errors.year = [`The value '${year}' is invalid.`];
    else if (Number.isInteger(parsed) && parsed >= -2_147_483_648 && parsed <= 2_147_483_647) yearNumber = parsed;
    else errors.year = [`The value '${year}' is not valid.`];
  }
  if (Object.keys(errors).length > 0) throw validationProblem(errors);
  return { organizationId, year: yearNumber };
}
