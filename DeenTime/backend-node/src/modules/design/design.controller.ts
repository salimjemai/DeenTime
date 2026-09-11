import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { Authorize, AuthorizeRoles, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { canAccessOrganization } from '../../common/auth/claims.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { badRequestText, forbidden, notFound } from '../../common/errors.js';
import { isGuid } from '../../common/json.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { STORAGE_SERVICE, type StorageService } from '../../integrations/storage.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { toDesignJson } from '../organizations/organization.mapper.js';
import { designRequestSchema, normalizeTheme, type DesignRequest } from './design.schemas.js';

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** DesignController.TryIdentifySafeImage: PNG, JPEG or WebP magic bytes. */
export function identifySafeImage(bytes: Buffer): { extension: string; contentType: string } | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { extension: '.png', contentType: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: '.jpg', contentType: 'image/jpeg' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return { extension: '.webp', contentType: 'image/webp' };
  return null;
}

/** Port of DesignController.cs. */
@Controller('api/v1/design')
@Authorize()
export class DesignController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  @Get(':orgId')
  async get(@CurrentUser() user: SessionUser | null, @Param('orgId') orgId: string): Promise<Record<string, unknown>> {
    if (!isGuid(orgId)) throw notFound();
    if (!canAccessOrganization(user, orgId)) throw forbidden();
    const design = await this.prisma.designSettings.findFirst({ where: { organizationId: orgId } });
    if (!design) throw notFound();
    return toDesignJson(design);
  }

  @Put(':orgId')
  @AuthorizeRoles('Admin', 'Editor')
  @HttpCode(204)
  async put(@CurrentUser() user: SessionUser | null, @Param('orgId') orgId: string, @Body(validated(designRequestSchema)) req: DesignRequest): Promise<void> {
    if (!isGuid(orgId)) throw notFound();
    if (!canAccessOrganization(user, orgId)) throw forbidden();
    const design = await this.prisma.designSettings.findFirst({ where: { organizationId: orgId } });
    if (!design) {
      await this.prisma.designSettings.create({
        data: {
          id: randomUUID(),
          organizationId: orgId,
          headerImageUrl: req.headerImageUrl,
          iqamaHeadings: req.iqamaHeadings ?? [],
          footerHtml: req.footerHtml,
          theme: normalizeTheme(req.theme),
          tvFontScale: req.tvFontScale ?? 100,
          widgetFontScale: req.widgetFontScale ?? 100,
          compactFontScale: req.compactFontScale ?? 100,
          tvFontFamily: req.tvFontFamily ?? 'system',
          widgetFontFamily: req.widgetFontFamily ?? 'system',
          compactFontFamily: req.compactFontFamily ?? 'system',
          updatedAtUtc: new Date(),
        },
      });
      return;
    }
    await this.prisma.designSettings.update({
      where: { id: design.id },
      data: {
        headerImageUrl: req.headerImageUrl ?? design.headerImageUrl,
        iqamaHeadings: req.iqamaHeadings ?? [],
        footerHtml: req.footerHtml,
        theme: normalizeTheme(req.theme ?? design.theme),
        tvFontScale: req.tvFontScale ?? design.tvFontScale,
        widgetFontScale: req.widgetFontScale ?? design.widgetFontScale,
        compactFontScale: req.compactFontScale ?? design.compactFontScale,
        tvFontFamily: req.tvFontFamily ?? design.tvFontFamily,
        widgetFontFamily: req.widgetFontFamily ?? design.widgetFontFamily,
        compactFontFamily: req.compactFontFamily ?? design.compactFontFamily,
        updatedAtUtc: new Date(),
      },
    });
  }

  @Post('files/header-image')
  @AuthorizeRoles('Admin', 'Editor')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadHeaderImage(
    @CurrentUser() user: SessionUser | null,
    @Query('orgId') orgId: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
  ): Promise<{ publicUrl: string; appliedTo: string[] }> {
    const organizationId = orgId && isGuid(orgId) ? orgId : '00000000-0000-0000-0000-000000000000';
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    if (!file || file.size === 0) throw badRequestText('Choose an image first.');
    const image = identifySafeImage(file.buffer);
    if (!image) throw badRequestText('Header image must be a valid PNG, JPEG, or WebP file.');

    const key = `orgs/${organizationId}/header-${randomUUID()}${image.extension}`;
    const publicOrigin = `${request.protocol}://${request.get('host') ?? 'localhost'}`;
    const publicUrl = await this.storage.upload(key, image.contentType, file.buffer, publicOrigin);

    const design = await this.prisma.designSettings.findFirst({ where: { organizationId } });
    if (!design) {
      await this.prisma.designSettings.create({
        data: { id: randomUUID(), organizationId, headerImageUrl: publicUrl, iqamaHeadings: [], theme: 'default', updatedAtUtc: new Date() },
      });
    } else {
      await this.prisma.designSettings.update({ where: { id: design.id }, data: { headerImageUrl: publicUrl, updatedAtUtc: new Date() } });
    }
    return { publicUrl, appliedTo: ['tv', 'widget', 'compactWidget', 'schedulePreview'] };
  }
}
