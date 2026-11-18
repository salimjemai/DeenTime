import hijriFixture from '../../domain/__fixtures__/hijri.json';
import { describe, expect, it } from 'vitest';
import { addMinutes, formatDateOnly, formatTimeClock, parseDateOnly, timeOnly } from '../../common/json.js';
import { hijriAnchorKey, type HijriMonthAnchor } from '../../domain/hijri.js';
import { computePrayerTimes, type PrayerCriteriaInput } from '../../domain/prayer-times.js';
import {
  buildScheduleCells,
  columnWidths,
  headerLines,
  hijriAnchorsFromMaps,
  monthlyPeriod,
  normalizeHeading,
  pageDimensions,
  ramadanPeriod,
  renderSchedulePdf,
  scheduleHeadings,
  type PdfIqamaEntry,
  type SchedulePdfInput,
} from './pdf-generator.js';
import { encodeWinAnsi, PdfDocument, pdfString, textWidth, wrapText } from './pdf-writer.js';
import { expectValidPdf, latin1, pdfTexts } from '../../../test/pdf-helpers.js';

interface HijriFixture {
  monthMaps2026: HijriMonthAnchor[];
  ramadan: { y2026: { dates: string[]; hijriYear: number; title: string } };
}

const fixture = hijriFixture as unknown as HijriFixture;
const anchors2026 = hijriAnchorsFromMaps(fixture.monthMaps2026);

const criteria: PrayerCriteriaInput = {
  method: 'ISNA',
  juristicMethodAsr: 'Other',
  latitude: 30.5119418,
  longitude: -97.8177601,
  timezoneId: 'America/Chicago',
  dstObserved: true,
  dstBegins: null,
  dstEnds: null,
  minutesAfterZawal: 5,
  minutesAfterMaghrib: 1,
};

const organization = {
  name: 'MasjidHub Demo Mosque',
  addressLine: '14300 Rountree Ranch Lane',
  city: 'Austin',
  state: 'TX',
  zipCode: '78717',
  phone: '4094543454',
  email: 'demo@iqamatime.test',
  websiteUrl: 'https://deentime.dev',
};

const date = (value: string): Date => {
  const parsed = parseDateOnly(value);
  if (!parsed) throw new Error(`Invalid date ${value}`);
  return parsed;
};

/** Deliberately unordered: the generator sorts by date like the .NET query. */
const iqamaEntries: PdfIqamaEntry[] = [
  { date: date('2026-02-15'), salah: 'Asr', time: timeOnly(17, 30), offsetMinutes: null },
  { date: date('2026-01-01'), salah: 'Fajr', time: timeOnly(6, 15), offsetMinutes: null },
  { date: date('2026-02-10'), salah: 'Dhuhr', time: timeOnly(0, 0), offsetMinutes: 15 },
  { date: date('2026-02-01'), salah: 'Asr', time: timeOnly(17, 0), offsetMinutes: null },
  { date: date('2026-03-01'), salah: 'Isha', time: timeOnly(20, 0), offsetMinutes: null },
  { date: date('2026-01-01'), salah: 'Maghrib', time: timeOnly(0, 0), offsetMinutes: 5 },
];

function input(overrides: Partial<SchedulePdfInput> = {}): SchedulePdfInput {
  return {
    organization,
    design: { iqamaHeadings: ['FAJR', 'IQM', 'SUNRISE', 'start', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'Starts'], footerHtml: '<p>&copy; 2026 Demo Mosque &middot; <b>MasjidHub</b></p>' },
    criteria,
    iqamaEntries,
    hijriAnchors: anchors2026,
    period: monthlyPeriod(2026, 2),
    size: 'Letter',
    orientation: 'Portrait',
    ...overrides,
  };
}

describe('periods', () => {
  it('monthlyPeriod lists every day with the English month title', () => {
    const period = monthlyPeriod(2026, 2);
    expect(period.title).toBe('February 2026');
    expect(period.dates.map(formatDateOnly)).toEqual(Array.from({ length: 28 }, (_, index) => `2026-02-${String(index + 1).padStart(2, '0')}`));
    expect(monthlyPeriod(2024, 2).dates).toHaveLength(29);
    expect(monthlyPeriod(2026, 12).title).toBe('December 2026');
  });

  it('ramadanPeriod resolves the Ramadan dates through the organization anchors', () => {
    const period = ramadanPeriod(2026, anchors2026);
    expect(period.title).toBe(fixture.ramadan.y2026.title);
    expect(period.title).toBe('Ramadan 1447 / 2026');
    expect(period.dates.map(formatDateOnly)).toEqual(fixture.ramadan.y2026.dates);
  });

  it('ramadanPeriod throws when no date of the year resolves to Ramadan', () => {
    const muharramAllYear = new Map<string, HijriMonthAnchor>();
    for (let month = 1; month <= 12; month++) {
      muharramAllYear.set(hijriAnchorKey(2026, month), { year: 2026, month, hijriDayOnFirst: 1, hijriMonthOnFirst: 1, hijriYearOnFirst: 1447 });
    }
    expect(() => ramadanPeriod(2026, muharramAllYear)).toThrow('Could not determine Ramadan dates for 2026.');
  });
});

describe('headings', () => {
  it('normalizes START/STARTS to ADHAN and falls back to the defaults unless exactly ten are configured', () => {
    expect(normalizeHeading('start')).toBe('ADHAN');
    expect(normalizeHeading('STARTS')).toBe('ADHAN');
    expect(normalizeHeading('STARTED')).toBe('STARTED');
    expect(normalizeHeading(null)).toBe('');
    expect(scheduleHeadings(input().design)).toEqual(['DATE', 'DAY', 'HIJRI', 'FAJR', 'IQM', 'SUNRISE', 'ADHAN', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'ADHAN']);
    expect(scheduleHeadings({ iqamaHeadings: ['A', 'B'], footerHtml: null })).toEqual(['DATE', 'DAY', 'HIJRI', 'FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*']);
    expect(scheduleHeadings(null)).toEqual(scheduleHeadings({ iqamaHeadings: [], footerHtml: null }));
  });
});

describe('buildScheduleCells', () => {
  const rows = buildScheduleCells(input());

  it('formats the date, day, Hijri date and prayer times of every row', () => {
    expect(rows).toHaveLength(28);
    const first = computePrayerTimes(criteria, date('2026-02-01'));
    expect(rows[0]).toEqual([
      '02/01',
      'Sun',
      '14/8/1447',
      formatTimeClock(first.fajr),
      '6:15',
      formatTimeClock(first.sunrise),
      formatTimeClock(first.dhuhr),
      '',
      formatTimeClock(first.asr),
      '5:00',
      formatTimeClock(first.sunset),
      formatTimeClock(first.isha),
      '',
    ]);
    expect(rows[16].slice(0, 3)).toEqual(['02/17', 'Tue', '1/9/1447']);
    expect(rows.map((row) => row[0])).toEqual(rows.map((_, index) => `02/${String(index + 1).padStart(2, '0')}`));
  });

  it('applies the latest Iqama entry on or before each date, resolving offsets against the computed start', () => {
    const feb20 = computePrayerTimes(criteria, date('2026-02-20'));
    expect(rows[19].slice(3)).toEqual([
      formatTimeClock(feb20.fajr),
      '6:15',
      formatTimeClock(feb20.sunrise),
      formatTimeClock(feb20.dhuhr),
      formatTimeClock(addMinutes(feb20.dhuhr, 15)),
      formatTimeClock(feb20.asr),
      '5:30',
      formatTimeClock(feb20.sunset),
      formatTimeClock(feb20.isha),
      '',
    ]);
    expect(rows[8][7]).toBe('');
    expect(rows[9][7]).not.toBe('');
    expect(rows[13][9]).toBe('5:00');
    expect(rows[14][9]).toBe('5:30');
  });

  it('requires prayer timing criteria', () => {
    expect(() => buildScheduleCells(input({ criteria: null }))).toThrow('Prayer timing criteria must be set before generating PDFs.');
  });
});

describe('layout', () => {
  it('uses Letter or Tabloid dimensions, swapped for Landscape', () => {
    expect(pageDimensions('Letter', 'Portrait')).toEqual({ width: 612, height: 792 });
    expect(pageDimensions('Letter', 'Landscape')).toEqual({ width: 792, height: 612 });
    expect(pageDimensions('Tabloid', 'Portrait')).toEqual({ width: 792, height: 1224 });
    expect(pageDimensions('Tabloid', 'Landscape')).toEqual({ width: 1224, height: 792 });
  });

  it('gives the date, day and Hijri columns 36/28/48 pt and shares the rest equally', () => {
    const widths = columnWidths(612);
    expect(widths.slice(0, 3)).toEqual([36, 28, 48]);
    expect(widths.slice(3)).toEqual(Array.from({ length: 10 }, () => 46));
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(572);
  });

  it('builds the title block and leaves out the empty address and contact lines', () => {
    expect(headerLines(organization, 'February 2026')).toEqual([
      { text: 'Adhan & Iqama Timings', fontSize: 22, bold: true },
      { text: '(February 2026)', fontSize: 12, bold: false },
      { text: 'MasjidHub Demo Mosque', fontSize: 16, bold: true },
      { text: '14300 Rountree Ranch Lane Austin TX 78717', fontSize: 9, bold: false },
      { text: 'Phone: 4094543454     Email: demo@iqamatime.test     Web: https://deentime.dev', fontSize: 8, bold: false },
    ]);
    const bare = { ...organization, addressLine: ' ', city: null, state: null, zipCode: '', phone: null, email: '  ', websiteUrl: null };
    expect(headerLines(bare, 'X')).toHaveLength(3);
    expect(headerLines({ ...bare, email: 'a@b.test' }, 'X')[3]).toEqual({ text: 'Email: a@b.test', fontSize: 8, bold: false });
  });
});

describe('pdf-writer', () => {
  it('encodes WinAnsi text and replaces characters without a glyph with "?"', () => {
    expect(encodeWinAnsi('Café © · ÿ')).toBe('Caf\xe9 \xa9 \xb7 \xff');
    expect(encodeWinAnsi('€ “quoted” – ’s …')).toBe('\x80 \x93quoted\x94 \x96 \x92s \x85');
    expect(encodeWinAnsi('مسجد Masjid 😀')).toBe('???? Masjid ?');
    expect(encodeWinAnsi('a\tb\r\nc')).toBe('a b \nc');
  });

  it('measures text with the Helvetica advance widths', () => {
    expect(textWidth('', 'regular', 10)).toBe(0);
    expect(textWidth('Hello', 'regular', 10)).toBeCloseTo((722 + 556 + 222 + 222 + 556) / 100, 6);
    expect(textWidth('Hello', 'bold', 10)).toBeCloseTo((722 + 556 + 278 + 278 + 611) / 100, 6);
    expect(textWidth('12:34', 'regular', 7.5)).toBeCloseTo(((556 * 4 + 278) * 7.5) / 1000, 6);
  });

  it('wraps at spaces and line breaks and splits words wider than the line', () => {
    expect(wrapText('short', 'regular', 10, 100)).toEqual(['short']);
    expect(wrapText('', 'regular', 10, 100)).toEqual(['']);
    expect(wrapText('one two three four', 'regular', 10, 40)).toEqual(['one two', 'three', 'four']);
    expect(wrapText('first\nsecond', 'regular', 10, 100)).toEqual(['first', 'second']);
    const split = wrapText('WWWWWWWWWW', 'regular', 10, 30);
    expect(split.join('')).toBe('WWWWWWWWWW');
    expect(split.every((line) => textWidth(line, 'regular', 10) <= 30)).toBe(true);
  });

  it('escapes literal strings and keeps them 7-bit clean', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
    expect(pdfString('Caf\xe9')).toBe('(Caf\\351)');
  });

  it('writes a valid file for an empty and for a multi-page document', () => {
    const document = new PdfDocument(612, 792, 'Title (draft)');
    document.addPage();
    const second = document.addPage();
    second.rect(10, 20, 30, 40, '#37474F');
    second.text('Hello', 10, 20, 'bold', 12, '#FFFFFF');
    second.centeredText('Centre', 0, 612, 100, 'regular', 10);
    const bytes = document.toBytes();
    expect(expectValidPdf(bytes)).toBe(2);
    expect(pdfTexts(bytes)).toEqual(['Hello', 'Centre']);
    const file = latin1(bytes);
    expect(file).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(file).toContain('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding');
    expect(file).toContain('/Title (Title \\(draft\\))');
    expect(file).toContain('/MediaBox [0 0 612 792]');
    // Top-left coordinates become PDF's bottom-left ones.
    expect(file).toContain('0.22 0.28 0.31 rg\n10 732 30 40 re f');
    expect(file).toContain(`1 1 1 rg\nBT /F2 12 Tf 10 ${(792 - 20 - 0.718 * 12).toFixed(2).replace(/0$/, '')} Td (Hello) Tj ET`);
  });
});

describe('renderSchedulePdf', () => {
  it('produces a one-page PDF for a monthly Letter schedule with the title block, headings, rows and footer', () => {
    const bytes = renderSchedulePdf(input());
    expect(latin1(bytes.subarray(0, 5))).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(2000);
    expect(expectValidPdf(bytes)).toBe(1);
    const texts = pdfTexts(bytes);
    expect(texts.slice(0, 5)).toEqual([
      'Adhan & Iqama Timings',
      '(February 2026)',
      'MasjidHub Demo Mosque',
      '14300 Rountree Ranch Lane Austin TX 78717',
      'Phone: 4094543454     Email: demo@iqamatime.test     Web: https://deentime.dev',
    ]);
    expect(texts[5]).toBe('\xa9 2026 Demo Mosque \xb7  MasjidHub');
    expect(texts.slice(6, 19)).toEqual(['DATE', 'DAY', 'HIJRI', 'FAJR', 'IQM', 'SUNRISE', 'ADHAN', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'ADHAN']);
    // Every non-empty cell of every row, in order.
    expect(texts.slice(19)).toEqual(buildScheduleCells(input()).flat().filter((cell) => cell !== ''));
    const file = latin1(bytes);
    expect(file).toContain('/MediaBox [0 0 612 792]');
    expect(file).toContain('/Title (Adhan & Iqama Timings \\(February 2026\\))');
    // The header row background and the 14 alternate row backgrounds.
    expect((file.match(/ re f\n/g) ?? []).length).toBe(15);
  });

  it('produces a PDF for a Tabloid landscape Ramadan schedule without a design', () => {
    const period = ramadanPeriod(2026, anchors2026);
    const bytes = renderSchedulePdf(input({ design: null, period, size: 'Tabloid', orientation: 'Landscape' }));
    expect(expectValidPdf(bytes)).toBe(1);
    const texts = pdfTexts(bytes);
    expect(texts).toContain('(Ramadan 1447 / 2026)');
    expect(texts).toContain('DUHUR');
    expect(texts).not.toContain('\xa9 2026 Demo Mosque \xb7  MasjidHub');
    const file = latin1(bytes);
    expect(file).toContain('/MediaBox [0 0 1224 792]');
    expect(file).toContain('/F1 9 Tf');
  });

  it('continues on further pages, repeating the title block, the footer and the heading row', () => {
    const dates = [...monthlyPeriod(2026, 1).dates, ...monthlyPeriod(2026, 2).dates, ...monthlyPeriod(2026, 3).dates];
    const bytes = renderSchedulePdf(input({ period: { title: 'Q1 2026', dates }, orientation: 'Landscape' }));
    const pages = expectValidPdf(bytes);
    expect(pages).toBeGreaterThan(1);
    const texts = pdfTexts(bytes);
    expect(texts.filter((text) => text === 'Adhan & Iqama Timings')).toHaveLength(pages);
    expect(texts.filter((text) => text === 'HIJRI')).toHaveLength(pages);
    expect(texts.filter((text) => text.startsWith('\xa9 2026 Demo Mosque'))).toHaveLength(pages);
    expect(texts.filter((text) => /^\d\d\/\d\d$/.test(text))).toHaveLength(dates.length);
  });

  it('wraps long headings and replaces text the built-in fonts cannot show', () => {
    const design = { iqamaHeadings: ['FAJR ADHAN TIME', 'IQM', 'SUNRISE', 'DHUHR', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'IQM'], footerHtml: 'مسجد النور (Masjid)' };
    const bytes = renderSchedulePdf(input({ design, organization: { ...organization, name: 'Mosquée Al-Noor' } }));
    expect(expectValidPdf(bytes)).toBe(1);
    const texts = pdfTexts(bytes);
    expect(texts).toContain('Mosqu\xe9e Al-Noor');
    expect(texts).toContain('???? ????? (Masjid)');
    expect(texts).not.toContain('FAJR ADHAN TIME');
    expect(texts).toEqual(expect.arrayContaining(['FAJR', 'ADHAN', 'TIME']));
  });

  it('throws when the organization has no prayer timing criteria', () => {
    expect(() => renderSchedulePdf(input({ criteria: null }))).toThrow('Prayer timing criteria must be set before generating PDFs.');
  });
});
