import { z } from 'zod';
import { EMPTY_GUID, isGuid, PDF_ORIENTATIONS, PDF_SIZES, parseEnum } from '../../common/json.js';

/**
 * Request bodies of PublishController. System.Text.Json binding rules (missing members
 * take the record defaults, enums accept their names or numbers, ints may be quoted)
 * followed by the FluentValidation rules of PublishValidators.cs.
 */
interface IssueContext {
  addIssue(issue: { code: 'custom'; message: string }): void;
}

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

function invalid(ctx: IssueContext, message: string): never {
  ctx.addIssue({ code: 'custom', message });
  return z.NEVER;
}

/** Guid: missing/null → Guid.Empty, otherwise the "D" format (lower-cased like Guid.ToString()). */
const guid = z.unknown().optional().transform((value, ctx) => {
  if (value === undefined || value === null) return EMPTY_GUID;
  if (typeof value === 'string' && isGuid(value)) return value.toLowerCase();
  return invalid(ctx, 'The value is not a valid GUID.');
});

const int32 = (fallback: number) =>
  z.unknown().optional().transform((value, ctx) => {
    if (value === undefined) return fallback;
    const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value) ? Number(value) : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < INT32_MIN || parsed > INT32_MAX) return invalid(ctx, 'The value is not a valid integer.');
    return parsed;
  });

const boolean = (fallback: boolean) =>
  z.unknown().optional().transform((value, ctx) => {
    if (value === undefined) return fallback;
    if (typeof value === 'boolean') return value;
    return invalid(ctx, 'The value is not a valid boolean.');
  });

const pdfEnum = <T extends readonly string[]>(names: T, fallback: T[number], label: string) =>
  z.unknown().optional().transform((value, ctx): T[number] => {
    if (value === undefined) return fallback;
    return parseEnum(names, value) ?? invalid(ctx, `The value is not a valid ${label}.`);
  });

const pdfSize = pdfEnum(PDF_SIZES, 'Letter', 'PDF size');
const pdfOrientation = pdfEnum(PDF_ORIENTATIONS, 'Portrait', 'PDF orientation');

/** PdfGenerateRequest + PdfGenerateRequestValidator (OrgId NotEmpty, Year 2000..2100, Month 1..12). */
export const pdfGenerateSchema = z.object({
  orgId: guid.transform((value, ctx) => (value === EMPTY_GUID ? invalid(ctx, "'Org Id' must not be empty.") : value)),
  year: int32(0).transform((value, ctx) => (value >= 2000 && value <= 2100 ? value : invalid(ctx, `'Year' must be between 2000 and 2100. You entered ${value}.`))),
  month: int32(0).transform((value, ctx) => (value >= 1 && value <= 12 ? value : invalid(ctx, `'Month' must be between 1 and 12. You entered ${value}.`))),
  size: pdfSize,
  orientation: pdfOrientation,
});
export type PdfGenerateRequest = z.infer<typeof pdfGenerateSchema>;

/** PublishController.RamadanPdfGenerateRequest (no validator). */
export const ramadanPdfGenerateSchema = z.object({
  orgId: guid,
  year: int32(0),
  size: pdfSize,
  orientation: pdfOrientation,
});
export type RamadanPdfGenerateRequest = z.infer<typeof ramadanPdfGenerateSchema>;

/** PublishController.TvDisplayConfigUpdateRequest (ClockFontScale = 160 and AutoRefreshSeconds = 30 by default). */
export const tvConfigUpdateSchema = z.object({
  showSeconds: boolean(false),
  showHijri: boolean(false),
  accentColor: z.unknown().optional().transform((value, ctx) => {
    if (value === undefined || value === null) return null;
    return typeof value === 'string' ? value : invalid(ctx, 'The value is not a valid string.');
  }),
  clockFontScale: int32(160),
  autoRefreshSeconds: int32(30),
});
export type TvConfigUpdateRequest = z.infer<typeof tvConfigUpdateSchema>;
