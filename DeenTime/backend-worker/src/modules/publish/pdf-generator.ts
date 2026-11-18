import { addMinutes, dateOnlyFromParts, formatTimeClock, pad, type PdfOrientation, type PdfSize, type SalahType, type TimeOnly } from '../../common/json.js';
import { hijriAnchorKey, ramadanDates, resolveHijriDate, type HijriMonthAnchor } from '../../domain/hijri.js';
import { computePrayerTimes, type PrayerCriteriaInput, type PrayerTimes } from '../../domain/prayer-times.js';
import { DEFAULT_IQAMA_HEADINGS } from '../public/shared.js';
import { stripHtml } from './html-decode.js';
import { encodeWinAnsi, LINE_HEIGHT, PdfDocument, wrapText, type PdfFont, type PdfPage } from './pdf-writer.js';

/**
 * Port of backend-node/src/modules/publish/pdf-generator.ts (itself a port of
 * QuestPdfGenerator): the monthly and Ramadan "Adhan & Iqama Timings" schedules.
 * The periods, headings and cell values are copied unchanged; the pdfmake document is
 * replaced by a direct layout on pdf-writer.ts with the same geometry: 20 pt margins,
 * the centred title block repeated on every page, the 13-column table with its
 * repeating header row and alternating row backgrounds, and the design footer.
 */
export interface PdfOrganization {
  name: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
}

export interface PdfDesign {
  iqamaHeadings: readonly string[];
  footerHtml: string | null;
}

/** An IqamaEntry row; `salah` by name, `time` as the stored TimeOnly. */
export interface PdfIqamaEntry {
  date: Date;
  salah: SalahType;
  time: TimeOnly;
  offsetMinutes: number | null;
}

/** The dates covered by a schedule and the title printed under "Adhan & Iqama Timings". */
export interface SchedulePeriod {
  title: string;
  dates: Date[];
}

export interface SchedulePdfInput {
  organization: PdfOrganization;
  design: PdfDesign | null;
  criteria: PrayerCriteriaInput | null;
  iqamaEntries: readonly PdfIqamaEntry[];
  /** HijriMonthMap rows keyed by hijriAnchorKey(year, month). */
  hijriAnchors: ReadonlyMap<string, HijriMonthAnchor>;
  period: SchedulePeriod;
  size: PdfSize;
  orientation: PdfOrientation;
}

export const MISSING_CRITERIA_MESSAGE = 'Prayer timing criteria must be set before generating PDFs.';

const PAGE_MARGIN = 20;
/** col.Item().PaddingVertical(8): the empty 16 pt item that closes the QuestPDF header column. */
const HEADER_SPACER_HEIGHT = 16;
const WHITE = '#FFFFFF';
/** QuestPDF Colors.BlueGrey.Darken3 and Colors.Grey.Lighten4. */
const HEADER_BACKGROUND = '#37474F';
const ALTERNATE_ROW_BACKGROUND = '#F5F5F5';
/** ConstantColumn(36/28/48) followed by ten RelativeColumn()s. */
const FIXED_COLUMN_WIDTHS = [36, 28, 48];
const RELATIVE_COLUMNS = 10;
const HEADER_CELL_PADDING = 3;
const BODY_CELL_PADDING = 2;
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const PRAYER_STARTS: Partial<Record<SalahType, (times: PrayerTimes) => TimeOnly>> = {
  Fajr: (times) => times.fajr,
  Dhuhr: (times) => times.dhuhr,
  Asr: (times) => times.asr,
  Maghrib: (times) => times.maghrib,
  Isha: (times) => times.isha,
};

/** GenerateMonthlyPdfAsync: every day of the month, titled "{MMMM yyyy}". */
export function monthlyPeriod(year: number, month: number): SchedulePeriod {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    title: `${MONTH_NAMES[month - 1]} ${String(year).padStart(4, '0')}`,
    dates: Array.from({ length: daysInMonth }, (_, index) => dateOnlyFromParts(year, month, index + 1)),
  };
}

/** GenerateRamadanPdfAsync: the dates of the Gregorian year that resolve to Hijri month 9, titled "Ramadan {hijriYear} / {year}". */
export function ramadanPeriod(year: number, anchors: ReadonlyMap<string, HijriMonthAnchor>): SchedulePeriod {
  const dates = ramadanDates(year, anchors);
  if (dates.length === 0) throw new Error(`Could not determine Ramadan dates for ${year}.`);
  const hijriYear = resolveHijriDate(dates[0], anchors.get(hijriAnchorKey(year, dates[0].getUTCMonth() + 1)) ?? null).year;
  return { title: `Ramadan ${hijriYear} / ${year}`, dates };
}

/** HijriMonthMap rows → the anchor dictionary keyed by (Year, Month). */
export function hijriAnchorsFromMaps(maps: readonly HijriMonthAnchor[]): Map<string, HijriMonthAnchor> {
  return new Map(maps.map((map) => [hijriAnchorKey(map.year, map.month), map]));
}

/** PageSizes.Letter or 792x1224 (Tabloid), swapped for Landscape. */
export function pageDimensions(size: PdfSize, orientation: PdfOrientation): { width: number; height: number } {
  const base = size === 'Letter' ? { width: 612, height: 792 } : { width: 792, height: 1224 };
  return orientation === 'Landscape' ? { width: base.height, height: base.width } : base;
}

/** NormalizeHeading: "START"/"STARTS" (any case) → "ADHAN". */
export function normalizeHeading(heading: string | null | undefined): string {
  return (heading ?? '').replace(/^STARTS?(?=\n?$)/i, 'ADHAN');
}

/** DATE, DAY, HIJRI and the ten configured headings (the design's only when it has exactly ten). */
export function scheduleHeadings(design: PdfDesign | null): string[] {
  const configured = design !== null && design.iqamaHeadings.length === 10 ? design.iqamaHeadings : DEFAULT_IQAMA_HEADINGS;
  return ['DATE', 'DAY', 'HIJRI', ...configured.map(normalizeHeading)];
}

/** ResolveIqamaTime: a fixed time, or the prayer's start plus the offset. */
export function resolveIqamaTime(entry: PdfIqamaEntry, times: PrayerTimes): TimeOnly {
  if (entry.offsetMinutes === null) return entry.time;
  const prayerStart = PRAYER_STARTS[entry.salah]?.(times) ?? entry.time;
  return addMinutes(prayerStart, entry.offsetMinutes);
}

/** IqamaFor: the latest entry for the prayer dated on or before the row's date, or "". */
function iqamaFor(entries: readonly PdfIqamaEntry[], salah: SalahType, date: Date, times: PrayerTimes): string {
  const entry = entries.findLast((candidate) => candidate.salah === salah && candidate.date.getTime() <= date.getTime());
  return entry === undefined ? '' : formatTimeClock(resolveIqamaTime(entry, times));
}

/** The 13 cells of every row: date, day, Hijri date, then the prayer and Iqama times as "h:mm". */
export function buildScheduleCells(input: SchedulePdfInput): string[][] {
  const { criteria } = input;
  if (criteria === null) throw new Error(MISSING_CRITERIA_MESSAGE);
  const entries = [...input.iqamaEntries].sort((a, b) => a.date.getTime() - b.date.getTime());
  return input.period.dates.map((date) => {
    const times = computePrayerTimes(criteria, date);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const hijri = resolveHijriDate(date, input.hijriAnchors.get(hijriAnchorKey(year, month)) ?? null);
    return [
      `${pad(month)}/${pad(date.getUTCDate())}`,
      DAY_NAMES[date.getUTCDay()],
      `${hijri.day}/${hijri.month}/${hijri.year}`,
      formatTimeClock(times.fajr),
      iqamaFor(entries, 'Fajr', date, times),
      formatTimeClock(times.sunrise),
      formatTimeClock(times.dhuhr),
      iqamaFor(entries, 'Dhuhr', date, times),
      formatTimeClock(times.asr),
      iqamaFor(entries, 'Asr', date, times),
      formatTimeClock(times.sunset),
      formatTimeClock(times.isha),
      iqamaFor(entries, 'Isha', date, times),
    ];
  });
}

function hasText(value: string | null): value is string {
  return value !== null && value.trim() !== '';
}

/** One centred line of the page header or footer. */
export interface TextLine {
  text: string;
  fontSize: number;
  bold: boolean;
}

/** page.Header(): the title, the period, the organization name and its address / contact lines. */
export function headerLines(organization: PdfOrganization, periodTitle: string): TextLine[] {
  const lines: TextLine[] = [
    { text: 'Adhan & Iqama Timings', fontSize: 22, bold: true },
    { text: `(${periodTitle})`, fontSize: 12, bold: false },
    { text: organization.name, fontSize: 16, bold: true },
  ];
  const address = [organization.addressLine, organization.city, organization.state, organization.zipCode].filter(hasText).join(' ');
  if (address.trim() !== '') lines.push({ text: address, fontSize: 9, bold: false });
  const contacts: string[] = [];
  if (hasText(organization.phone)) contacts.push(`Phone: ${organization.phone}`);
  if (hasText(organization.email)) contacts.push(`Email: ${organization.email}`);
  if (hasText(organization.websiteUrl)) contacts.push(`Web: ${organization.websiteUrl}`);
  if (contacts.length > 0) lines.push({ text: contacts.join('     '), fontSize: 8, bold: false });
  return lines;
}

/** ConstantColumn(36/28/48) and ten equal shares of the remaining width. */
export function columnWidths(pageWidth: number): number[] {
  const available = pageWidth - 2 * PAGE_MARGIN;
  const relative = (available - FIXED_COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0)) / RELATIVE_COLUMNS;
  return [...FIXED_COLUMN_WIDTHS, ...Array.from({ length: RELATIVE_COLUMNS }, () => relative)];
}

interface WrappedLine {
  text: string;
  font: PdfFont;
  fontSize: number;
}

function wrapLines(lines: readonly TextLine[], maxWidth: number): WrappedLine[] {
  return lines.flatMap((line) => {
    const font: PdfFont = line.bold ? 'bold' : 'regular';
    return wrapText(encodeWinAnsi(line.text), font, line.fontSize, maxWidth).map((text) => ({ text, font, fontSize: line.fontSize }));
  });
}

function blockHeight(lines: readonly WrappedLine[]): number {
  return lines.reduce((sum, line) => sum + line.fontSize * LINE_HEIGHT, 0);
}

interface TableRow {
  cells: string[][];
  height: number;
}

function tableRow(texts: readonly string[], widths: readonly number[], font: PdfFont, fontSize: number, padding: number): TableRow {
  const cells = texts.map((text, column) => wrapText(encodeWinAnsi(text), font, fontSize, widths[column] - 2 * padding));
  const lineCount = Math.max(...cells.map((lines) => lines.length));
  return { cells, height: lineCount * fontSize * LINE_HEIGHT + 2 * padding };
}

/** Renders the schedule to PDF bytes (QuestPdfGenerator.GeneratePdfAsync's Document.GeneratePdf()). */
export function renderSchedulePdf(input: SchedulePdfInput): Uint8Array {
  if (input.criteria === null) throw new Error(MISSING_CRITERIA_MESSAGE);
  const page = pageDimensions(input.size, input.orientation);
  const fontSize = input.size === 'Tabloid' ? 9 : 7.5;
  const contentWidth = page.width - 2 * PAGE_MARGIN;
  const widths = columnWidths(page.width);

  const header = wrapLines(headerLines(input.organization, input.period.title), contentWidth);
  const footerText = stripHtml(input.design?.footerHtml);
  const footer = footerText === '' ? [] : wrapLines([{ text: footerText, fontSize: 9, bold: false }], contentWidth);
  // The header block starts below the 20 pt page margin; both slots are sized to their content.
  const tableTop = Math.ceil(PAGE_MARGIN + blockHeight(header)) + HEADER_SPACER_HEIGHT;
  const footerTop = page.height - PAGE_MARGIN - Math.ceil(blockHeight(footer));
  const tableBottom = footer.length === 0 ? page.height - PAGE_MARGIN : footerTop;

  const headingRow = tableRow(scheduleHeadings(input.design), widths, 'bold', fontSize, HEADER_CELL_PADDING);
  const bodyRows = buildScheduleCells(input).map((cells) => tableRow(cells, widths, 'regular', fontSize, BODY_CELL_PADDING));

  const document = new PdfDocument(page.width, page.height, `Adhan & Iqama Timings (${input.period.title})`);
  let current!: PdfPage;
  let y = 0;

  const drawBlock = (lines: readonly WrappedLine[], top: number): void => {
    let lineTop = top;
    for (const line of lines) {
      current.centeredText(line.text, PAGE_MARGIN, contentWidth, lineTop, line.font, line.fontSize);
      lineTop += line.fontSize * LINE_HEIGHT;
    }
  };

  const drawRow = (row: TableRow, font: PdfFont, padding: number, background: string | null, color: string): void => {
    if (background !== null) current.rect(PAGE_MARGIN, y, contentWidth, row.height, background);
    let x = PAGE_MARGIN;
    row.cells.forEach((lines, column) => {
      lines.forEach((line, index) => current.centeredText(line, x, widths[column], y + padding + index * fontSize * LINE_HEIGHT, font, fontSize, color));
      x += widths[column];
    });
    y += row.height;
  };

  const startPage = (): void => {
    current = document.addPage();
    drawBlock(header, PAGE_MARGIN);
    drawBlock(footer, footerTop);
    y = tableTop;
    drawRow(headingRow, 'bold', HEADER_CELL_PADDING, HEADER_BACKGROUND, WHITE);
  };

  startPage();
  let rowsOnPage = 0;
  bodyRows.forEach((row, index) => {
    // A row that does not fit moves to a new page, unless it is the first of its page (it could never fit).
    if (y + row.height > tableBottom && rowsOnPage > 0) {
      startPage();
      rowsOnPage = 0;
    }
    drawRow(row, 'regular', BODY_CELL_PADDING, index % 2 === 1 ? ALTERNATE_ROW_BACKGROUND : null, '#000000');
    rowsOnPage++;
  });

  return document.toBytes();
}
