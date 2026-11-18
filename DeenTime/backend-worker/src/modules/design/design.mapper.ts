import { fromJsonArray } from '../../core/db.js';
import { formatDateTime } from '../../common/json.js';

/** A "DesignSettings" row as D1 returns it (IqamaHeadings is JSON array text). */
export interface DesignRow {
  Id: string;
  OrganizationId: string;
  HeaderImageUrl: string | null;
  IqamaHeadings: string | null;
  FooterHtml: string | null;
  Theme: string;
  TvFontScale: number;
  WidgetFontScale: number;
  CompactFontScale: number;
  TvFontFamily: string;
  WidgetFontFamily: string;
  CompactFontFamily: string;
  UpdatedAtUtc: string;
}

export const DESIGN_COLUMNS =
  '"Id", "OrganizationId", "HeaderImageUrl", "IqamaHeadings", "FooterHtml", "Theme", "TvFontScale", "WidgetFontScale", "CompactFontScale", "TvFontFamily", "WidgetFontFamily", "CompactFontFamily", "UpdatedAtUtc"';

/** DesignSettings entity JSON (backend-node's organization.mapper.ts toDesignJson). */
export function toDesignJson(row: DesignRow): Record<string, unknown> {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    headerImageUrl: row.HeaderImageUrl ?? null,
    iqamaHeadings: fromJsonArray(row.IqamaHeadings),
    footerHtml: row.FooterHtml ?? null,
    theme: row.Theme,
    tvFontScale: row.TvFontScale,
    widgetFontScale: row.WidgetFontScale,
    compactFontScale: row.CompactFontScale,
    tvFontFamily: row.TvFontFamily,
    widgetFontFamily: row.WidgetFontFamily,
    compactFontFamily: row.CompactFontFamily,
    updatedAtUtc: formatDateTime(row.UpdatedAtUtc),
    organization: null,
  };
}

/** DesignController.TryIdentifySafeImage: PNG, JPEG or WebP magic bytes. */
export function identifySafeImage(bytes: Uint8Array): { extension: string; contentType: string } | null {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && PNG.every((value, index) => bytes[index] === value)) return { extension: '.png', contentType: 'image/png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: '.jpg', contentType: 'image/jpeg' };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { extension: '.webp', contentType: 'image/webp' };
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}
