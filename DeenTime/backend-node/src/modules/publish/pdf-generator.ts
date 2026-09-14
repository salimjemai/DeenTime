import pdfmake from 'pdfmake';
import type { Content, CustomTableLayout, Size, TableCell } from 'pdfmake';
import { addMinutes, dateOnlyFromParts, formatTimeClock, pad, type PdfOrientation, type PdfSize, type SalahType, type TimeOnly } from '../../common/json.js';
import { hijriAnchorKey, ramadanDates, resolveHijriDate, type HijriMonthAnchor } from '../../domain/hijri.js';
import { computePrayerTimes, type PrayerCriteriaInput, type PrayerTimes } from '../../domain/prayer-times.js';
import { DEFAULT_IQAMA_HEADINGS } from '../../startup/startup.service.js';
import { stripHtml } from './html-decode.js';

/**
 * Port of QuestPdfGenerator (the monthly and Ramadan "Adhan & Iqama Timings" schedules)
 * on top of pdfmake and the built-in Helvetica faces. The page geometry, the centred
 * title block repeated on every page, the 13-column table with its repeating header
 * row and the design footer mirror the QuestPDF document; data access lives in
 * PdfGeneratorService so this module can be exercised with plain objects.
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

/** Heights (pt) reserved in the page margins for the repeated header block and the footer text. */
export interface ReservedHeights {
  header: number;
  footer: number;
}

export const MISSING_CRITERIA_MESSAGE = 'Prayer timing criteria must be set before generating PDFs.';

/** The document definition type is not re-exported by @types/pdfmake's entry point. */
export type TDocumentDefinitions = Parameters<typeof pdfmake.createPdf>[0];

const PAGE_MARGIN = 20;
/** col.Item().PaddingVertical(8): the empty 16 pt item that closes the QuestPDF header column. */
const HEADER_SPACER_HEIGHT = 16;
const WHITE = '#FFFFFF';
/** QuestPDF Colors.BlueGrey.Darken3 and Colors.Grey.Lighten4. */
const HEADER_BACKGROUND = '#37474F';
const ALTERNATE_ROW_BACKGROUND = '#F5F5F5';
/** ConstantColumn(36/28/48) followed by ten RelativeColumn()s. */
const COLUMN_WIDTHS: Size[] = [36, 28, 48, '*', '*', '*', '*', '*', '*', '*', '*', '*', '*'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const STANDARD_FONT_FILES = new Set(['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique']);
const DEFAULT_STYLE = { font: 'Helvetica', fontSize: 12 };
/** No borders; the QuestPDF cell padding is reproduced with cell margins. */
const TABLE_LAYOUT: CustomTableLayout = {
  hLineWidth: () => 0,
  vLineWidth: () => 0,
  paddingLeft: () => 0,
  paddingRight: () => 0,
  paddingTop: () => 0,
  paddingBottom: () => 0,
};
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

/** page.Header(): the centred title block with its 20 pt page margin on the top and sides. */
export function headerBlock(organization: PdfOrganization, periodTitle: string): Content {
  const lines: Content[] = [
    { text: 'Adhan & Iqama Timings', fontSize: 22, bold: true, alignment: 'center' },
    { text: `(${periodTitle})`, fontSize: 12, alignment: 'center' },
    { text: organization.name, fontSize: 16, bold: true, alignment: 'center' },
  ];
  const address = [organization.addressLine, organization.city, organization.state, organization.zipCode].filter(hasText).join(' ');
  if (address.trim() !== '') lines.push({ text: address, fontSize: 9, alignment: 'center' });
  const contacts: string[] = [];
  if (hasText(organization.phone)) contacts.push(`Phone: ${organization.phone}`);
  if (hasText(organization.email)) contacts.push(`Email: ${organization.email}`);
  if (hasText(organization.websiteUrl)) contacts.push(`Web: ${organization.websiteUrl}`);
  if (contacts.length > 0) lines.push({ text: contacts.join('     '), fontSize: 8, alignment: 'center' });
  return { stack: lines, margin: [PAGE_MARGIN, PAGE_MARGIN, PAGE_MARGIN, 0] };
}

/** page.Footer(): the stripped design footer, centred at 9 pt. */
export function footerBlock(footer: string): Content {
  return { text: footer, fontSize: 9, alignment: 'center', margin: [PAGE_MARGIN, 0, PAGE_MARGIN, 0] };
}

function headerCell(text: string, fontSize: number): TableCell {
  return { text, fontSize, bold: true, color: WHITE, fillColor: HEADER_BACKGROUND, alignment: 'center', margin: [3, 3, 3, 3] };
}

function bodyCell(text: string, fontSize: number, background: string): TableCell {
  return { text, fontSize, fillColor: background, alignment: 'center', margin: [2, 2, 2, 2] };
}

/** The complete pdfmake document for a schedule, given the space reserved for the header and footer. */
export function buildScheduleDocument(input: SchedulePdfInput, reserved: ReservedHeights): TDocumentDefinitions {
  const page = pageDimensions(input.size, input.orientation);
  const fontSize = input.size === 'Tabloid' ? 9 : 7.5;
  const footer = stripHtml(input.design?.footerHtml);
  const body: TableCell[][] = [
    scheduleHeadings(input.design).map((heading) => headerCell(heading, fontSize)),
    ...buildScheduleCells(input).map((cells, index) => cells.map((text) => bodyCell(text, fontSize, index % 2 === 1 ? ALTERNATE_ROW_BACKGROUND : WHITE))),
  ];
  return {
    pageSize: page,
    pageMargins: [PAGE_MARGIN, reserved.header + HEADER_SPACER_HEIGHT, PAGE_MARGIN, footer === '' ? PAGE_MARGIN : PAGE_MARGIN + reserved.footer],
    defaultStyle: DEFAULT_STYLE,
    background: () => ({ canvas: [{ type: 'rect', x: 0, y: 0, w: page.width, h: page.height, color: WHITE }] }),
    header: () => headerBlock(input.organization, input.period.title),
    ...(footer === '' ? {} : { footer: () => footerBlock(footer) }),
    content: { table: { headerRows: 1, widths: COLUMN_WIDTHS, body }, layout: TABLE_LAYOUT },
  };
}

/** Renders the schedule to PDF bytes (QuestPdfGenerator.GeneratePdfAsync's Document.GeneratePdf()). */
export async function renderSchedulePdf(input: SchedulePdfInput): Promise<Buffer> {
  if (input.criteria === null) throw new Error(MISSING_CRITERIA_MESSAGE);
  const page = pageDimensions(input.size, input.orientation);
  const footer = stripHtml(input.design?.footerHtml);
  const reserved: ReservedHeights = {
    header: Math.ceil(await measureBlockHeight(headerBlock(input.organization, input.period.title), page.width)),
    footer: footer === '' ? 0 : Math.ceil(await measureBlockHeight(footerBlock(footer), page.width)),
  };
  return configuredPdfMake().createPdf(buildScheduleDocument(input, reserved)).getBuffer();
}

let configured = false;

/** The pdfmake singleton with the four standard Helvetica faces and no external resource access. */
function configuredPdfMake(): typeof pdfmake {
  if (!configured) {
    pdfmake.setFonts({ Helvetica: { normal: 'Helvetica', bold: 'Helvetica-Bold', italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique' } });
    pdfmake.setUrlAccessPolicy(() => false);
    pdfmake.setLocalAccessPolicy((path) => STANDARD_FONT_FILES.has(path));
    configured = true;
  }
  return pdfmake;
}

/**
 * QuestPDF sizes the header and footer slots to their content; pdfmake needs the space
 * reserved in the page margins, so the block is laid out on an auto-height page first.
 */
async function measureBlockHeight(content: Content, pageWidth: number): Promise<number> {
  const created = configuredPdfMake().createPdf({ pageSize: { width: pageWidth, height: 'auto' }, pageMargins: 0, defaultStyle: DEFAULT_STYLE, content });
  const document = await created.getStream();
  const height = document.page.height;
  await created.getBuffer();
  return height;
}
