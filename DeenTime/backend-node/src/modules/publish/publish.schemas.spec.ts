import type { ZodType } from 'zod';
import { describe, expect, it } from 'vitest';
import { ProblemDetailsException } from '../../common/errors.js';
import { EMPTY_GUID } from '../../common/json.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { pdfGenerateSchema, ramadanPdfGenerateSchema, tvConfigUpdateSchema } from './publish.schemas.js';

const ORG_ID = '7F0D0C6A-3E2B-4C1D-9A8B-5E6F7A8B9C0D';

function errorsOf(schema: ZodType, body: unknown): Record<string, string[]> {
  try {
    validated(schema).transform(body);
  } catch (error) {
    if (error instanceof ProblemDetailsException) return error.problem.errors ?? {};
    throw error;
  }
  return {};
}

describe('pdfGenerateSchema', () => {
  it('binds like System.Text.Json (quoted ints, enum names or numbers, lower-cased Guid)', () => {
    expect(validated(pdfGenerateSchema).transform({ orgId: ORG_ID, year: '2026', month: 2, size: 'tabloid', orientation: 1 })).toEqual({
      orgId: ORG_ID.toLowerCase(),
      year: 2026,
      month: 2,
      size: 'Tabloid',
      orientation: 'Landscape',
    });
    expect(validated(pdfGenerateSchema).transform({ orgId: ORG_ID, year: 2026, month: 12 })).toMatchObject({ size: 'Letter', orientation: 'Portrait' });
  });

  it('reports the PdfGenerateRequestValidator messages keyed by PascalCase property', () => {
    expect(errorsOf(pdfGenerateSchema, { year: 1999, month: 13 })).toEqual({
      OrgId: ["'Org Id' must not be empty."],
      Year: ["'Year' must be between 2000 and 2100. You entered 1999."],
      Month: ["'Month' must be between 1 and 12. You entered 13."],
    });
    expect(errorsOf(pdfGenerateSchema, { orgId: EMPTY_GUID, year: 2026, month: 1 })).toEqual({ OrgId: ["'Org Id' must not be empty."] });
    expect(errorsOf(pdfGenerateSchema, { orgId: ORG_ID })).toEqual({
      Year: ["'Year' must be between 2000 and 2100. You entered 0."],
      Month: ["'Month' must be between 1 and 12. You entered 0."],
    });
  });

  it('rejects values System.Text.Json cannot convert', () => {
    expect(errorsOf(pdfGenerateSchema, { orgId: 'not-a-guid', year: '2026.5', month: 1, size: 'A4', orientation: null })).toEqual({
      OrgId: ['The value is not a valid GUID.'],
      Year: ['The value is not a valid integer.'],
      Size: ['The value is not a valid PDF size.'],
      Orientation: ['The value is not a valid PDF orientation.'],
    });
  });
});

describe('ramadanPdfGenerateSchema', () => {
  it('has no validator: missing members take their defaults', () => {
    expect(validated(ramadanPdfGenerateSchema).transform({})).toEqual({ orgId: EMPTY_GUID, year: 0, size: 'Letter', orientation: 'Portrait' });
    expect(validated(ramadanPdfGenerateSchema).transform({ orgId: ORG_ID, year: 2027, size: 1, orientation: 'landscape' })).toEqual({
      orgId: ORG_ID.toLowerCase(),
      year: 2027,
      size: 'Tabloid',
      orientation: 'Landscape',
    });
  });
});

describe('tvConfigUpdateSchema', () => {
  it('applies the record defaults and ignores extra members', () => {
    expect(validated(tvConfigUpdateSchema).transform({})).toEqual({ showSeconds: false, showHijri: false, accentColor: null, clockFontScale: 160, autoRefreshSeconds: 30 });
    expect(
      validated(tvConfigUpdateSchema).transform({ id: '', organizationId: ORG_ID, showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 250, autoRefreshSeconds: '45' }),
    ).toEqual({ showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 250, autoRefreshSeconds: 45 });
  });

  it('rejects members of the wrong type', () => {
    expect(errorsOf(tvConfigUpdateSchema, { showSeconds: 'yes', accentColor: 5, clockFontScale: null })).toEqual({
      ShowSeconds: ['The value is not a valid boolean.'],
      AccentColor: ['The value is not a valid string.'],
      ClockFontScale: ['The value is not a valid integer.'],
    });
  });
});
