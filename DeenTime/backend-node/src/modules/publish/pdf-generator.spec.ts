import type { Table, TableCell } from 'pdfmake';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { addMinutes, formatDateOnly, formatTimeClock, parseDateOnly, timeOnly } from '../../common/json.js';
import { hijriAnchorKey, type HijriMonthAnchor } from '../../domain/hijri.js';
import { computePrayerTimes, type PrayerCriteriaInput } from '../../domain/prayer-times.js';
import {
  buildScheduleCells,
  buildScheduleDocument,
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

interface HijriFixture {
  monthMaps2026: HijriMonthAnchor[];
  ramadan: { y2026: { dates: string[]; hijriYear: number; title: string } };
}

const fixture = JSON.parse(readFileSync(new URL('../../domain/__fixtures__/hijri.json', import.meta.url), 'utf8')) as HijriFixture;
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
  name: 'IqamaTime Demo Mosque',
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
    design: { iqamaHeadings: ['FAJR', 'IQM', 'SUNRISE', 'start', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'Starts'], footerHtml: '<p>&copy; 2026 Demo Mosque &middot; <b>IqamaTime</b></p>' },
    criteria,
    iqamaEntries,
    hijriAnchors: anchors2026,
    period: monthlyPeriod(2026, 2),
    size: 'Letter',
    orientation: 'Portrait',
    ...overrides,
  };
}

const cellText = (cell: TableCell): string => (cell as { text?: string }).text ?? '';
const cellFill = (cell: TableCell): string | undefined => (cell as { fillColor?: string }).fillColor;
const tableOf = (content: unknown): { table: Table } => content as { table: Table };

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
    const dhuhrIqama = addMinutes(feb20.dhuhr, 15);
    expect(rows[19].slice(3)).toEqual([
      formatTimeClock(feb20.fajr),
      '6:15',
      formatTimeClock(feb20.sunrise),
      formatTimeClock(feb20.dhuhr),
      formatTimeClock(dhuhrIqama),
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

describe('buildScheduleDocument', () => {
  it('reproduces the QuestPDF page, header, table and footer', () => {
    const definition = buildScheduleDocument(input(), { header: 100, footer: 9 });
    expect(definition.pageSize).toEqual({ width: 612, height: 792 });
    expect(definition.pageMargins).toEqual([20, 116, 20, 29]);
    expect(typeof definition.header).toBe('function');
    expect(typeof definition.footer).toBe('function');
    expect((definition.footer as () => unknown)()).toEqual({ text: '© 2026 Demo Mosque ·  IqamaTime', fontSize: 9, alignment: 'center', margin: [20, 0, 20, 0] });
    expect((definition.header as () => unknown)()).toEqual({
      stack: [
        { text: 'Adhan & Iqama Timings', fontSize: 22, bold: true, alignment: 'center' },
        { text: '(February 2026)', fontSize: 12, alignment: 'center' },
        { text: 'IqamaTime Demo Mosque', fontSize: 16, bold: true, alignment: 'center' },
        { text: '14300 Rountree Ranch Lane Austin TX 78717', fontSize: 9, alignment: 'center' },
        { text: 'Phone: 4094543454     Email: demo@iqamatime.test     Web: https://deentime.dev', fontSize: 8, alignment: 'center' },
      ],
      margin: [20, 20, 20, 0],
    });

    const table = tableOf(definition.content);
    expect(table.table.headerRows).toBe(1);
    expect(table.table.widths).toEqual([36, 28, 48, '*', '*', '*', '*', '*', '*', '*', '*', '*', '*']);
    expect(table.table.body).toHaveLength(29);
    expect(table.table.body[0].map(cellText)).toEqual(['DATE', 'DAY', 'HIJRI', 'FAJR', 'IQM', 'SUNRISE', 'ADHAN', 'IQM', 'ASR', 'IQM', 'SUNSET', 'ISHA', 'ADHAN']);
    expect(table.table.body[0][0]).toEqual({ text: 'DATE', fontSize: 7.5, bold: true, color: '#FFFFFF', fillColor: '#37474F', alignment: 'center', margin: [3, 3, 3, 3] });
    expect(table.table.body[1][1]).toEqual({ text: 'Sun', fontSize: 7.5, fillColor: '#FFFFFF', alignment: 'center', margin: [2, 2, 2, 2] });
    expect(table.table.body.slice(1).map((row) => cellFill(row[0]))).toEqual(Array.from({ length: 28 }, (_, index) => (index % 2 === 1 ? '#F5F5F5' : '#FFFFFF')));
  });

  it('uses Tabloid landscape dimensions with 9 pt text and omits an empty footer and header lines', () => {
    const definition = buildScheduleDocument(
      input({ size: 'Tabloid', orientation: 'Landscape', design: { iqamaHeadings: [], footerHtml: ' <p></p> ' }, organization: { ...organization, addressLine: null, city: '  ', state: null, zipCode: null, phone: null, email: '', websiteUrl: null } }),
      { header: 50, footer: 0 },
    );
    expect(definition.pageSize).toEqual({ width: 1224, height: 792 });
    expect(definition.pageMargins).toEqual([20, 66, 20, 20]);
    expect(definition.footer).toBeUndefined();
    expect((definition.header as () => { stack: unknown[] })().stack).toHaveLength(3);
    expect(cellText(tableOf(definition.content).table.body[0][6])).toBe('DUHUR');
    expect(tableOf(definition.content).table.body[2][0]).toMatchObject({ fontSize: 9, fillColor: '#F5F5F5' });
    expect(pageDimensions('Tabloid', 'Portrait')).toEqual({ width: 792, height: 1224 });
    expect(pageDimensions('Letter', 'Landscape')).toEqual({ width: 792, height: 612 });
  });
});

describe('renderSchedulePdf', () => {
  it('produces a PDF for a monthly schedule', async () => {
    const buffer = await renderSchedulePdf(input());
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(2000);
  });

  it('produces a PDF for a Tabloid landscape Ramadan schedule without a design', async () => {
    const buffer = await renderSchedulePdf(input({ design: null, period: ramadanPeriod(2026, anchors2026), size: 'Tabloid', orientation: 'Landscape' }));
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('rejects when the organization has no prayer timing criteria', async () => {
    await expect(renderSchedulePdf(input({ criteria: null }))).rejects.toThrow('Prayer timing criteria must be set before generating PDFs.');
  });
});
