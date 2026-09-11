import { badRequestText, modelValidationProblem } from '../../common/errors.js';
import { addMinutes, formatDateOnly, formatTimeShort, salahFromDb, timeOnlyFromDb, type SalahType, type TimeOnly } from '../../common/json.js';
import type { PrayerTimes } from '../../domain/prayer-times.js';
import { normalizeTheme } from '../design/design.schemas.js';
import { latestEntriesPerSalah } from '../iqama/iqama.mapper.js';
import { embedScriptUrl } from './public-origin.js';

/**
 * Pure pieces of PublicController.cs: query binding/validation for the display
 * endpoint, the design/tvConfig/iqama shaping and the embed markup helpers.
 */
export const SUPPORTED_THEMES = ['default', 'dark', 'classic'] as const;
export const SUPPORTED_LAYOUTS = ['tv', 'widget', 'compact'] as const;

/** GET /public/display/{slug} query parameters after model binding (absent or blank → undefined). */
export interface DisplayParameters {
  locale?: string;
  theme?: string;
  fontScale?: number;
  layout?: string;
}

/** IQueryCollection lookup: keys are case-insensitive and same-named values are merged in order. */
export function queryValues(query: Record<string, unknown>, name: string): string[] {
  const values: string[] = [];
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(query)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) values.push(...value.filter((item): item is string => typeof item === 'string'));
    else if (typeof value === 'string') values.push(value);
  }
  return values;
}

/** Simple-type model binding of a string? parameter: the first value, null when blank (ConvertEmptyStringToNull). */
export function bindQueryString(values: string[]): string | undefined {
  const first = values[0];
  return first === undefined || first.trim() === '' ? undefined : first;
}

/** StringValues.ToString(): values joined with "," (empty when absent). */
export function queryValueToString(values: string[]): string {
  return values.join(',');
}

const INT32_TEXT = /^\s*[+-]?\d+\s*$/;

/** Model binding of an int? parameter: surrounding whitespace and a sign are accepted; anything else is a ModelState error. */
export function bindQueryInt(values: string[], name: string): number | undefined {
  const text = bindQueryString(values);
  if (text === undefined) return undefined;
  const parsed = INT32_TEXT.test(text) ? Number.parseInt(text.trim(), 10) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < -2_147_483_648 || parsed > 2_147_483_647) {
    throw modelValidationProblem({ [name]: [`The value '${text}' is not valid.`] });
  }
  return parsed;
}

/** string.Equals(a, b, StringComparison.OrdinalIgnoreCase). */
function equalsIgnoreCase(a: string, b: string): boolean {
  return a.length === b.length && a.toUpperCase() === b.toUpperCase();
}

/** ValidateDisplayParameters: the BadRequest text, or null when every parameter is acceptable. */
export function validateDisplayParameters(parameters: DisplayParameters): string | null {
  const { locale, theme, fontScale, layout } = parameters;
  // .NET's "$" also matches before a trailing newline, hence the optional "\n".
  if (locale !== undefined && !/^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?\n?$/.test(locale)) return 'locale must be a supported language tag.';
  if (theme !== undefined && !SUPPORTED_THEMES.some((supported) => equalsIgnoreCase(supported, normalizeTheme(theme)))) {
    return 'theme must be default, dark, or classic.';
  }
  if (fontScale !== undefined && (fontScale < 75 || fontScale > 160 || fontScale % 5 !== 0)) {
    return 'fontScale must be between 75 and 160 in increments of 5.';
  }
  if (layout !== undefined && !SUPPORTED_LAYOUTS.some((supported) => equalsIgnoreCase(supported, layout))) return 'layout must be tv, widget, or compact.';
  return null;
}

/** Binds the display query like ASP.NET model binding (400 ValidationProblemDetails) and applies ValidateDisplayParameters (400 text). */
export function parseDisplayParameters(query: Record<string, unknown>): DisplayParameters {
  const parameters: DisplayParameters = {
    locale: bindQueryString(queryValues(query, 'locale')),
    theme: bindQueryString(queryValues(query, 'theme')),
    fontScale: bindQueryInt(queryValues(query, 'fontScale'), 'fontScale'),
    layout: bindQueryString(queryValues(query, 'layout')),
  };
  const error = validateDisplayParameters(parameters);
  if (error !== null) throw badRequestText(error);
  return parameters;
}

/** EffectiveScale: the query override for the matching layout, otherwise the saved value when valid, else 100. */
export function effectiveScale(saved: number, displayLayout: string, requestedLayout: string | undefined, overrideScale: number | undefined): number {
  if (overrideScale !== undefined && requestedLayout !== undefined && equalsIgnoreCase(displayLayout, requestedLayout)) return overrideScale;
  return saved >= 75 && saved <= 160 && saved % 5 === 0 ? saved : 100;
}

/** NormalizeFontFamily: only the two named families are kept (case-sensitive), anything else is "system". */
export function normalizeFontFamily(family: string | null | undefined): string {
  return family === 'modern-sans' || family === 'classic-serif' ? family : 'system';
}

/** The DesignSettings columns the display reads. */
export interface DisplayDesignSource {
  headerImageUrl: string | null;
  iqamaHeadings: string[];
  footerHtml: string | null;
  theme: string;
  tvFontScale: number;
  widgetFontScale: number;
  compactFontScale: number;
  tvFontFamily: string;
  widgetFontFamily: string;
  compactFontFamily: string;
}

export interface DisplayDesign {
  headerImageUrl: string | null;
  backgroundImageUrl: string | null;
  iqamaHeadings: string[];
  footerHtml: string | null;
  theme: string;
  tvFontScale: number;
  widgetFontScale: number;
  compactFontScale: number;
  tvFontFamily: string;
  widgetFontFamily: string;
  compactFontFamily: string;
  locale: string;
}

/** The `design` object of the display response; `headerImageUrl` is the already-versioned header image URL. */
export function buildDisplayDesign(design: DisplayDesignSource | null, parameters: DisplayParameters, headerImageUrl: string | null): DisplayDesign {
  return {
    headerImageUrl,
    // .NET versions HeaderImageUrl for both properties.
    backgroundImageUrl: headerImageUrl,
    iqamaHeadings: design?.iqamaHeadings ?? [],
    footerHtml: design?.footerHtml ?? null,
    theme: normalizeTheme(parameters.theme ?? design?.theme),
    tvFontScale: effectiveScale(design?.tvFontScale ?? 100, 'tv', parameters.layout, parameters.fontScale),
    widgetFontScale: effectiveScale(design?.widgetFontScale ?? 100, 'widget', parameters.layout, parameters.fontScale),
    compactFontScale: effectiveScale(design?.compactFontScale ?? 100, 'compact', parameters.layout, parameters.fontScale),
    tvFontFamily: normalizeFontFamily(design?.tvFontFamily),
    widgetFontFamily: normalizeFontFamily(design?.widgetFontFamily),
    compactFontFamily: normalizeFontFamily(design?.compactFontFamily),
    locale: parameters.locale ?? 'en-US',
  };
}

export interface DisplayTvConfig {
  showSeconds: boolean;
  showHijri: boolean;
  accentColor: string;
  clockFontScale: number;
  autoRefreshSeconds: number;
}

/** new TvDisplayConfig { OrganizationId = org.Id }: the entity's property initializers. */
export const DEFAULT_TV_CONFIG: Readonly<DisplayTvConfig> = { showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 };

export function buildTvConfig(row: DisplayTvConfig | null): DisplayTvConfig {
  const source = row ?? DEFAULT_TV_CONFIG;
  return {
    showSeconds: source.showSeconds,
    showHijri: source.showHijri,
    accentColor: source.accentColor,
    clockFontScale: source.clockFontScale,
    autoRefreshSeconds: source.autoRefreshSeconds,
  };
}

/** The IqamaEntry columns the display reads. */
export interface DisplayIqamaSource {
  salah: number;
  date: Date;
  time: Date;
  offsetMinutes: number | null;
  note: string | null;
  updatedAtUtc: Date;
}

export interface DisplayIqamaItem {
  salah: SalahType;
  time: string | null;
  salahTime: string | null;
  offsetMinutes: number | null;
  note: string | null;
  effectiveDate: string;
}

/** ResolveIqamaTime: the stored time, or the computed prayer start plus the offset (null when timings are unavailable). */
export function resolveIqamaTime(entry: Pick<DisplayIqamaSource, 'salah' | 'time' | 'offsetMinutes'>, timings: PrayerTimes | null): TimeOnly | null {
  const stored = timeOnlyFromDb(entry.time);
  if (entry.offsetMinutes === null) return stored;
  if (timings === null) return null;
  const starts: Partial<Record<SalahType, TimeOnly>> = {
    Fajr: timings.fajr,
    Dhuhr: timings.dhuhr,
    Asr: timings.asr,
    Maghrib: timings.maghrib,
    Isha: timings.isha,
  };
  return addMinutes(starts[salahFromDb(entry.salah)] ?? stored, entry.offsetMinutes);
}

/** The display's iqama list: the latest entry per Salah dated on/before today, ordered by stored time then Salah. */
export function buildIqamaItems<T extends DisplayIqamaSource>(history: T[], timings: PrayerTimes | null, khutbahTimeMinutes: number): DisplayIqamaItem[] {
  return latestEntriesPerSalah(history)
    .sort((a, b) => a.time.getTime() - b.time.getTime() || a.salah - b.salah)
    .map((entry) => {
      const salah = salahFromDb(entry.salah);
      const resolved = resolveIqamaTime(entry, timings);
      const isJumuah = salah.startsWith('Jumuah');
      return {
        salah,
        time: resolved === null ? null : formatTimeShort(resolved),
        salahTime: isJumuah && resolved !== null ? formatTimeShort(addMinutes(resolved, khutbahTimeMinutes)) : null,
        offsetMinutes: entry.offsetMinutes,
        note: entry.offsetMinutes === null ? entry.note : `+${entry.offsetMinutes} minutes`,
        effectiveDate: formatDateOnly(entry.date),
      };
    });
}

/**
 * WebUtility.HtmlEncode: the five markup characters, the Latin-1 supplement
 * (U+00A0–U+00FF) and astral code points become entities; everything else is kept.
 */
export function webUtilityHtmlEncode(value: string): string {
  let encoded = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0) ?? 0;
    switch (char) {
      case '<':
        encoded += '&lt;';
        break;
      case '>':
        encoded += '&gt;';
        break;
      case '"':
        encoded += '&quot;';
        break;
      case "'":
        encoded += '&#39;';
        break;
      case '&':
        encoded += '&amp;';
        break;
      default:
        encoded += (codePoint >= 160 && codePoint < 256) || codePoint >= 0x10000 ? `&#${codePoint};` : char;
    }
  }
  return encoded;
}

/** PublicController.Iframe: the embed snippet, with the auto-height marker and loader script when requested. */
export function iframe(url: string, title: string, width: string, height: string, autoHeight: boolean): string {
  const marker = autoHeight ? ' data-iqamatime-auto-height' : '';
  const markup = `<iframe src="${webUtilityHtmlEncode(url)}" title="${title}" width="${webUtilityHtmlEncode(width)}" height="${webUtilityHtmlEncode(height)}" loading="lazy"${marker} style="display:block;border:0;max-width:100%;overflow:hidden"></iframe>`;
  if (!autoHeight) return markup;
  return `${markup}<script async src="${webUtilityHtmlEncode(embedScriptUrl(url))}"></script>`;
}

/**
 * LegacyWidget's slug: the second "?"-delimited segment of the raw query string
 * (the historical "?...?slug" form, kept percent-encoded like .NET), else ?masjid=.
 */
export function legacySlug(rawQueryString: string, masjid: string): string {
  const parts = rawQueryString.split('?').filter((part) => part !== '');
  return parts.length >= 2 ? parts[1] : masjid;
}
