import { describe, expect, it } from 'vitest';
import { JsonResponseException, ProblemDetailsException } from '../../common/errors.js';
import { salahToDb, timeOnly, timeOnlyToDb, type SalahType } from '../../common/json.js';
import type { PrayerTimes } from '../../domain/prayer-times.js';
import {
  bindQueryInt,
  bindQueryString,
  buildDisplayDesign,
  buildIqamaItems,
  buildTvConfig,
  effectiveScale,
  iframe,
  legacySlug,
  normalizeFontFamily,
  parseDisplayParameters,
  queryValues,
  queryValueToString,
  resolveIqamaTime,
  validateDisplayParameters,
  webUtilityHtmlEncode,
  type DisplayDesignSource,
  type DisplayIqamaSource,
} from './public.mapper.js';

const timings: PrayerTimes = {
  date: new Date('2026-09-10T00:00:00Z'),
  fajr: timeOnly(6, 5),
  sunrise: timeOnly(7, 12),
  dhuhr: timeOnly(13, 33),
  asr: timeOnly(17, 0),
  maghrib: timeOnly(19, 44),
  sunset: timeOnly(19, 43),
  isha: timeOnly(20, 50),
};

function entry(salah: SalahType, time: string, options: { date?: string; offsetMinutes?: number | null; note?: string | null; updatedAtUtc?: string } = {}): DisplayIqamaSource {
  const [hour, minute, second = 0] = time.split(':').map(Number);
  return {
    salah: salahToDb(salah),
    date: new Date(`${options.date ?? '2026-01-01'}T00:00:00Z`),
    time: timeOnlyToDb(timeOnly(hour, minute, second)),
    offsetMinutes: options.offsetMinutes ?? null,
    note: options.note ?? null,
    updatedAtUtc: new Date(options.updatedAtUtc ?? '2026-01-01T12:00:00Z'),
  };
}

const savedDesign: DisplayDesignSource = {
  headerImageUrl: '/uploads/orgs/x/header.png',
  iqamaHeadings: ['FAJR', 'IQM*'],
  footerHtml: '<p>Footer</p>',
  theme: 'Dark',
  tvFontScale: 120,
  widgetFontScale: 73,
  compactFontScale: 200,
  tvFontFamily: 'classic-serif',
  widgetFontFamily: 'Modern-Sans',
  compactFontFamily: 'comic',
};

describe('query binding', () => {
  it('reads keys case-insensitively and merges repeated values in order', () => {
    expect(queryValues({ Locale: 'ar', locale: ['ur', 'en'] }, 'locale')).toEqual(['ar', 'ur', 'en']);
    expect(queryValues({ other: 'x' }, 'locale')).toEqual([]);
    expect(queryValueToString(['a', 'b'])).toBe('a,b');
    expect(queryValueToString([])).toBe('');
  });

  it('binds strings like SimpleTypeModelBinder (first value, blank → null)', () => {
    expect(bindQueryString([])).toBeUndefined();
    expect(bindQueryString([''])).toBeUndefined();
    expect(bindQueryString(['   '])).toBeUndefined();
    expect(bindQueryString([' dark ', 'classic'])).toBe(' dark ');
  });

  it('binds int? values with the Int32 converter rules', () => {
    expect(bindQueryInt([], 'fontScale')).toBeUndefined();
    expect(bindQueryInt([''], 'fontScale')).toBeUndefined();
    expect(bindQueryInt([' 100 '], 'fontScale')).toBe(100);
    expect(bindQueryInt(['+100'], 'fontScale')).toBe(100);
    expect(bindQueryInt(['-5'], 'fontScale')).toBe(-5);
    expect(bindQueryInt(['80', 'abc'], 'fontScale')).toBe(80);
    for (const invalid of ['abc', '1.0', '1e2', '99999999999', '0x10', '1 0']) {
      let caught: unknown;
      try {
        bindQueryInt([invalid], 'fontScale');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ProblemDetailsException);
      expect((caught as ProblemDetailsException).problem).toMatchObject({ status: 400, errors: { fontScale: [`The value '${invalid}' is not valid.`] } });
    }
  });
});

describe('validateDisplayParameters', () => {
  it.each([
    [{}, null],
    [{ locale: 'en-US', theme: 'dark', fontScale: 100, layout: 'tv' }, null],
    [{ locale: 'ar' }, null],
    [{ locale: 'ur' }, null],
    [{ locale: 'zh-Hant' }, 'locale must be a supported language tag.'],
    [{ locale: 'xx-YYY' }, 'locale must be a supported language tag.'],
    [{ locale: 'e' }, 'locale must be a supported language tag.'],
    [{ locale: 'en_US' }, 'locale must be a supported language tag.'],
    [{ locale: ' en' }, 'locale must be a supported language tag.'],
    [{ locale: 'en\n' }, null],
    [{ theme: 'default' }, null],
    [{ theme: 'DARK' }, null],
    [{ theme: 'Classic' }, null],
    [{ theme: 'light' }, null],
    [{ theme: 'Light' }, null],
    [{ theme: 'neon' }, 'theme must be default, dark, or classic.'],
    [{ theme: ' dark' }, 'theme must be default, dark, or classic.'],
    [{ fontScale: 75 }, null],
    [{ fontScale: 160 }, null],
    [{ fontScale: 105 }, null],
    [{ fontScale: 70 }, 'fontScale must be between 75 and 160 in increments of 5.'],
    [{ fontScale: 74 }, 'fontScale must be between 75 and 160 in increments of 5.'],
    [{ fontScale: 165 }, 'fontScale must be between 75 and 160 in increments of 5.'],
    [{ fontScale: 101 }, 'fontScale must be between 75 and 160 in increments of 5.'],
    [{ fontScale: -100 }, 'fontScale must be between 75 and 160 in increments of 5.'],
    [{ layout: 'tv' }, null],
    [{ layout: 'TV' }, null],
    [{ layout: 'Widget' }, null],
    [{ layout: 'compact' }, null],
    [{ layout: 'phone' }, 'layout must be tv, widget, or compact.'],
    [{ locale: 'b@d', theme: 'bad', fontScale: 1, layout: 'bad' }, 'locale must be a supported language tag.'],
    [{ theme: 'bad', fontScale: 1, layout: 'bad' }, 'theme must be default, dark, or classic.'],
    [{ fontScale: 1, layout: 'bad' }, 'fontScale must be between 75 and 160 in increments of 5.'],
  ])('validates %j', (parameters, expected) => {
    expect(validateDisplayParameters(parameters)).toBe(expected);
  });

  it('parseDisplayParameters binds first (400 ValidationProblemDetails), then validates (400 text)', () => {
    expect(parseDisplayParameters({ locale: 'ar', Theme: 'Light', fontScale: ' 120 ', layout: ['TV'] })).toEqual({ locale: 'ar', theme: 'Light', fontScale: 120, layout: 'TV' });
    expect(parseDisplayParameters({ theme: '', fontScale: '', locale: '  ' })).toEqual({ locale: undefined, theme: undefined, fontScale: undefined, layout: undefined });
    expect(() => parseDisplayParameters({ fontScale: 'abc', locale: '!!' })).toThrow(ProblemDetailsException);
    let caught: unknown;
    try {
      parseDisplayParameters({ fontScale: '101', locale: 'en' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(JsonResponseException);
    expect((caught as JsonResponseException).getStatus()).toBe(400);
    expect((caught as JsonResponseException).body).toBe('fontScale must be between 75 and 160 in increments of 5.');
  });
});

describe('design shaping', () => {
  it('applies the query override only to the requested layout and repairs invalid saved scales', () => {
    expect(effectiveScale(120, 'tv', 'tv', 90)).toBe(90);
    expect(effectiveScale(120, 'tv', 'TV', 90)).toBe(90);
    expect(effectiveScale(120, 'widget', 'tv', 90)).toBe(120);
    expect(effectiveScale(120, 'tv', undefined, 90)).toBe(120);
    expect(effectiveScale(73, 'tv', undefined, undefined)).toBe(100);
    expect(effectiveScale(200, 'tv', undefined, undefined)).toBe(100);
    expect(effectiveScale(75, 'tv', undefined, undefined)).toBe(75);
    expect(effectiveScale(160, 'tv', undefined, undefined)).toBe(160);
    expect(effectiveScale(101, 'tv', undefined, undefined)).toBe(100);
    expect(effectiveScale(-100, 'tv', undefined, undefined)).toBe(100);
  });

  it('coerces font families to the three supported values', () => {
    expect(normalizeFontFamily('modern-sans')).toBe('modern-sans');
    expect(normalizeFontFamily('classic-serif')).toBe('classic-serif');
    expect(normalizeFontFamily('system')).toBe('system');
    expect(normalizeFontFamily('Modern-Sans')).toBe('system');
    expect(normalizeFontFamily('comic')).toBe('system');
    expect(normalizeFontFamily(null)).toBe('system');
    expect(normalizeFontFamily(undefined)).toBe('system');
  });

  it('builds the design from the saved settings and the query', () => {
    expect(buildDisplayDesign(savedDesign, { layout: 'compact', fontScale: 85 }, 'https://cdn/header.png?v=1')).toEqual({
      headerImageUrl: 'https://cdn/header.png?v=1',
      backgroundImageUrl: 'https://cdn/header.png?v=1',
      iqamaHeadings: ['FAJR', 'IQM*'],
      footerHtml: '<p>Footer</p>',
      theme: 'dark',
      tvFontScale: 120,
      widgetFontScale: 100,
      compactFontScale: 85,
      tvFontFamily: 'classic-serif',
      widgetFontFamily: 'system',
      compactFontFamily: 'system',
      locale: 'en-US',
    });
    expect(buildDisplayDesign(savedDesign, { theme: 'Light', locale: 'ar' }, null)).toMatchObject({ theme: 'default', locale: 'ar', headerImageUrl: null, backgroundImageUrl: null });
    expect(buildDisplayDesign({ ...savedDesign, theme: 'Neon' }, {}, null).theme).toBe('neon');
    expect(buildDisplayDesign({ ...savedDesign, theme: ' ' }, {}, null).theme).toBe('default');
  });

  it('uses the DesignSettings defaults when the organization has none', () => {
    expect(buildDisplayDesign(null, {}, null)).toEqual({
      headerImageUrl: null,
      backgroundImageUrl: null,
      iqamaHeadings: [],
      footerHtml: null,
      theme: 'default',
      tvFontScale: 100,
      widgetFontScale: 100,
      compactFontScale: 100,
      tvFontFamily: 'system',
      widgetFontFamily: 'system',
      compactFontFamily: 'system',
      locale: 'en-US',
    });
    expect(buildDisplayDesign(null, { layout: 'widget', fontScale: 150 }, null)).toMatchObject({ tvFontScale: 100, widgetFontScale: 150, compactFontScale: 100 });
  });

  it('falls back to the TvDisplayConfig entity defaults', () => {
    expect(buildTvConfig(null)).toEqual({ showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 160, autoRefreshSeconds: 30 });
    expect(buildTvConfig({ showSeconds: false, showHijri: false, accentColor: '#123456', clockFontScale: 120, autoRefreshSeconds: 60 })).toEqual({
      showSeconds: false,
      showHijri: false,
      accentColor: '#123456',
      clockFontScale: 120,
      autoRefreshSeconds: 60,
    });
  });
});

describe('iqama shaping', () => {
  it('resolves fixed times, offsets from the computed prayer start and offsets without timings', () => {
    expect(resolveIqamaTime(entry('Fajr', '06:30:15'), timings)).toEqual(timeOnly(6, 30, 15));
    expect(resolveIqamaTime(entry('Fajr', '06:30'), null)).toEqual(timeOnly(6, 30));
    expect(resolveIqamaTime(entry('Fajr', '00:00', { offsetMinutes: 20 }), timings)).toEqual(timeOnly(6, 25));
    expect(resolveIqamaTime(entry('Dhuhr', '00:00', { offsetMinutes: 15 }), timings)).toEqual(timeOnly(13, 48));
    expect(resolveIqamaTime(entry('Asr', '00:00', { offsetMinutes: 10 }), timings)).toEqual(timeOnly(17, 10));
    expect(resolveIqamaTime(entry('Maghrib', '00:00', { offsetMinutes: -10 }), timings)).toEqual(timeOnly(19, 34));
    expect(resolveIqamaTime(entry('Isha', '00:00', { offsetMinutes: 20 }), timings)).toEqual(timeOnly(21, 10));
    expect(resolveIqamaTime(entry('Jumuah', '13:30', { offsetMinutes: 10 }), timings)).toEqual(timeOnly(13, 40));
    expect(resolveIqamaTime(entry('Fajr', '06:30', { offsetMinutes: 20 }), null)).toBeNull();
    expect(resolveIqamaTime(entry('Isha', '23:50', { offsetMinutes: 0 }), timings)).toEqual(timeOnly(20, 50));
  });

  it('shapes the latest entry per Salah, ordered by stored time then Salah', () => {
    const history = [
      entry('Isha', '23:50', { note: 'Fixed Isha' }),
      entry('Maghrib', '19:30', { offsetMinutes: -10, note: 'ignored' }),
      entry('Jumuah2nd', '14:00', { offsetMinutes: 15 }),
      entry('Jumuah', '13:30'),
      entry('Dhuhr', '13:30', { note: 'Dhuhr note' }),
      entry('Fajr', '06:00', { offsetMinutes: 20, date: '2026-02-01' }),
      entry('Fajr', '05:00', { date: '2025-12-01', note: 'superseded by date' }),
      entry('Fajr', '05:30', { date: '2026-02-01', updatedAtUtc: '2025-12-31T00:00:00Z', note: 'superseded by updatedAtUtc' }),
    ];
    expect(buildIqamaItems(history, timings, 20)).toEqual([
      { salah: 'Fajr', time: '06:25', salahTime: null, offsetMinutes: 20, note: '+20 minutes', effectiveDate: '2026-02-01' },
      { salah: 'Dhuhr', time: '13:30', salahTime: null, offsetMinutes: null, note: 'Dhuhr note', effectiveDate: '2026-01-01' },
      { salah: 'Jumuah', time: '13:30', salahTime: '13:50', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
      { salah: 'Jumuah2nd', time: '14:15', salahTime: '14:35', offsetMinutes: 15, note: '+15 minutes', effectiveDate: '2026-01-01' },
      { salah: 'Maghrib', time: '19:34', salahTime: null, offsetMinutes: -10, note: '+-10 minutes', effectiveDate: '2026-01-01' },
      { salah: 'Isha', time: '23:50', salahTime: null, offsetMinutes: null, note: 'Fixed Isha', effectiveDate: '2026-01-01' },
    ]);
  });

  it('leaves time and salahTime null for offsets when timings are unavailable', () => {
    const history = [entry('Jumuah', '13:30', { offsetMinutes: 10 }), entry('Fajr', '06:00', { offsetMinutes: 20 }), entry('Jumuah3rd', '15:00')];
    expect(buildIqamaItems(history, null, 30)).toEqual([
      { salah: 'Fajr', time: null, salahTime: null, offsetMinutes: 20, note: '+20 minutes', effectiveDate: '2026-01-01' },
      { salah: 'Jumuah', time: null, salahTime: null, offsetMinutes: 10, note: '+10 minutes', effectiveDate: '2026-01-01' },
      { salah: 'Jumuah3rd', time: '15:00', salahTime: '15:30', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
    ]);
  });

  it('wraps past midnight like TimeOnly.AddMinutes and ignores seconds in the output', () => {
    expect(buildIqamaItems([entry('Jumuah4th', '23:45:30')], timings, 30)).toEqual([
      { salah: 'Jumuah4th', time: '23:45', salahTime: '00:15', offsetMinutes: null, note: null, effectiveDate: '2026-01-01' },
    ]);
    expect(buildIqamaItems([entry('Khutbah', '13:00')], timings, 30)[0]).toMatchObject({ salah: 'Khutbah', time: '13:00', salahTime: null });
  });
});

describe('embed markup', () => {
  it('encodes like WebUtility.HtmlEncode', () => {
    expect(webUtilityHtmlEncode(`IqamaTime · Café <b> & "q" 'a' 1+1 مسجد 😀 ÿ Ā`)).toBe('IqamaTime &#183; Caf&#233; &lt;b&gt; &amp; &quot;q&quot; &#39;a&#39; 1+1 مسجد &#128512; &#255; Ā');
    expect(webUtilityHtmlEncode(' ')).toBe('&#160;');
    expect(webUtilityHtmlEncode('https://x.test/w/slug?a=1&b=2')).toBe('https://x.test/w/slug?a=1&amp;b=2');
  });

  it('renders the tv iframe without auto-height and the widget iframes with the loader script', () => {
    const title = webUtilityHtmlEncode('IqamaTime · North Lamar Austin Muslim Community Center prayer times');
    expect(iframe('https://public.deentime.test/tv/north-lamar', title, '100%', '720', false)).toBe(
      '<iframe src="https://public.deentime.test/tv/north-lamar" title="IqamaTime &#183; North Lamar Austin Muslim Community Center prayer times" width="100%" height="720" loading="lazy" style="display:block;border:0;max-width:100%;overflow:hidden"></iframe>',
    );
    expect(iframe('https://public.deentime.test/w/north-lamar/daily', webUtilityHtmlEncode('IqamaTime · North Lamar Austin Muslim Community Center daily prayer times'), '390', '720', true)).toBe(
      '<iframe src="https://public.deentime.test/w/north-lamar/daily" title="IqamaTime &#183; North Lamar Austin Muslim Community Center daily prayer times" width="390" height="720" loading="lazy" data-iqamatime-auto-height style="display:block;border:0;max-width:100%;overflow:hidden"></iframe><script async src="https://public.deentime.test/iqamatime-embed.js"></script>',
    );
  });

  it('HTML-encodes the organization name and the URL inside the markup', () => {
    const title = webUtilityHtmlEncode(`IqamaTime · Masjid <Al-Noor> & "Friends" 'Center' prayer times`);
    expect(iframe('https://example.com:8443/w/al noor', title, '330', '820', true)).toBe(
      `<iframe src="https://example.com:8443/w/al noor" title="IqamaTime &#183; Masjid &lt;Al-Noor&gt; &amp; &quot;Friends&quot; &#39;Center&#39; prayer times" width="330" height="820" loading="lazy" data-iqamatime-auto-height style="display:block;border:0;max-width:100%;overflow:hidden"></iframe><script async src="https://example.com:8443/iqamatime-embed.js"></script>`,
    );
  });
});

describe('legacySlug', () => {
  it('takes the second "?"-delimited segment of the raw query string, else ?masjid=', () => {
    expect(legacySlug('?x?my-slug', '')).toBe('my-slug');
    expect(legacySlug('?a=1&b=2?slug?extra', 'm')).toBe('slug');
    expect(legacySlug('?masjid=abc', 'abc')).toBe('abc');
    expect(legacySlug('??slug', '')).toBe('');
    expect(legacySlug('?x?my%20slug', '')).toBe('my%20slug');
    expect(legacySlug('', '')).toBe('');
    expect(legacySlug('?', 'abc')).toBe('abc');
  });
});
