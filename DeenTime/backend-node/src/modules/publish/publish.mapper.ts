import { enumFromDb, formatDateTime, PDF_ORIENTATIONS, PDF_SIZES, type PdfOrientation, type PdfSize } from '../../common/json.js';
import type { TvConfigUpdateRequest } from './publish.schemas.js';

export interface PublishArtifactRow {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  size: number;
  orientation: number;
  storageUrl: string;
  createdAtUtc: Date;
}

/** PublishArtifact entity JSON (enums by name; the entity has no navigation properties). */
export interface PublishArtifactJson {
  id: string;
  organizationId: string;
  year: number;
  month: number;
  size: PdfSize;
  orientation: PdfOrientation;
  storageUrl: string;
  createdAtUtc: string | null;
}

export function toPublishArtifactJson(row: PublishArtifactRow): PublishArtifactJson {
  return {
    id: row.id,
    organizationId: row.organizationId,
    year: row.year,
    month: row.month,
    size: enumFromDb(PDF_SIZES, row.size),
    orientation: enumFromDb(PDF_ORIENTATIONS, row.orientation),
    storageUrl: row.storageUrl,
    createdAtUtc: formatDateTime(row.createdAtUtc),
  };
}

export interface TvDisplayConfigValues {
  showSeconds: boolean;
  showHijri: boolean;
  accentColor: string;
  clockFontScale: number;
  autoRefreshSeconds: number;
}

export interface TvDisplayConfigRow extends TvDisplayConfigValues {
  id: string;
  organizationId: string;
}

/** TvDisplayConfig entity JSON. */
export interface TvDisplayConfigJson extends TvDisplayConfigRow {}

/** The TvDisplayConfig property initializers (an unsaved `new TvDisplayConfig { ... }`). */
export const TV_DISPLAY_CONFIG_DEFAULTS: Readonly<TvDisplayConfigValues> = {
  showSeconds: true,
  showHijri: true,
  accentColor: '#00AEEF',
  clockFontScale: 160,
  autoRefreshSeconds: 30,
};

/** PublishController.UpdateTvConfig: blank accent colour → default, clock scale 80..200, refresh 15..3600 s. */
export function tvDisplayConfigValues(req: TvConfigUpdateRequest): TvDisplayConfigValues {
  return {
    showSeconds: req.showSeconds,
    showHijri: req.showHijri,
    accentColor: req.accentColor === null || req.accentColor.trim() === '' ? TV_DISPLAY_CONFIG_DEFAULTS.accentColor : req.accentColor,
    clockFontScale: clamp(req.clockFontScale, 80, 200),
    autoRefreshSeconds: clamp(req.autoRefreshSeconds, 15, 3600),
  };
}

export function toTvDisplayConfigJson(row: TvDisplayConfigRow): TvDisplayConfigJson {
  return {
    id: row.id,
    organizationId: row.organizationId,
    showSeconds: row.showSeconds,
    showHijri: row.showHijri,
    accentColor: row.accentColor,
    clockFontScale: row.clockFontScale,
    autoRefreshSeconds: row.autoRefreshSeconds,
  };
}

/** Math.Clamp. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
