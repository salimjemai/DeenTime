import { z } from 'zod';

const FONT_FAMILIES = new Set(['system', 'modern-sans', 'classic-serif']);
const THEMES = new Set(['default', 'light', 'dark', 'classic']);

function isSafeImageUrl(value: string | null): boolean {
  if (!value?.trim()) return true;
  if (value.startsWith('/uploads/')) return true;
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password;
  } catch {
    return false;
  }
}

const optionalText = z.string().nullish().transform((value) => value ?? null);
const fontScale = z.number().int().nullish().transform((value) => value ?? null);
const fontFamily = z.string().nullish().transform((value) => value ?? null);

/** DesignRequest + DesignRequestValidator. */
export const designRequestSchema = z
  .object({
    headerImageUrl: optionalText.refine(isSafeImageUrl, { message: 'Header image URL must be an HTTPS/HTTP address or a local uploaded image.' }),
    iqamaHeadings: z.array(z.string().max(80, { message: "The length of 'Iqama Headings' must be 80 characters or fewer." })).nullish(),
    footerHtml: optionalText.refine((value) => (value ?? '').length <= 10_000, { message: "The length of 'Footer Html' must be 10000 characters or fewer." }),
    theme: optionalText.refine((value) => value === null || THEMES.has(value), { message: 'Theme must be default, dark, or classic.' }),
    tvFontScale: fontScale,
    widgetFontScale: fontScale,
    compactFontScale: fontScale,
    tvFontFamily: fontFamily.refine((value) => value === null || FONT_FAMILIES.has(value), { message: 'TV font family is not supported.' }),
    widgetFontFamily: fontFamily.refine((value) => value === null || FONT_FAMILIES.has(value), { message: 'Widget font family is not supported.' }),
    compactFontFamily: fontFamily.refine((value) => value === null || FONT_FAMILIES.has(value), { message: 'Compact font family is not supported.' }),
  })
  .superRefine((value, ctx) => {
    if (value.iqamaHeadings === null || value.iqamaHeadings === undefined) {
      ctx.addIssue({ code: 'custom', path: ['iqamaHeadings'], message: "'Iqama Headings' must not be empty." });
    } else if (value.iqamaHeadings.length > 20) {
      ctx.addIssue({ code: 'custom', path: ['iqamaHeadings'], message: 'At most 20 display headings are allowed.' });
    }
    // FluentValidation could not infer a member name for the three scale rules, so their errors are keyed by "".
    for (const scale of [value.tvFontScale, value.widgetFontScale, value.compactFontScale]) {
      if (scale !== null && !(scale >= 75 && scale <= 160 && scale % 5 === 0)) {
        ctx.addIssue({ code: 'custom', path: [], message: 'Font scale must be between 75 and 160 in increments of 5.' });
      }
    }
  });
export type DesignRequest = z.infer<typeof designRequestSchema>;

export function normalizeTheme(theme: string | null | undefined): string {
  return !theme?.trim() || theme.toLowerCase() === 'light' ? 'default' : theme.toLowerCase();
}
