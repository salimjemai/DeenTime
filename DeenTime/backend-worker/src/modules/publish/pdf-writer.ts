import { HELVETICA_BOLD_WIDTHS, HELVETICA_WIDTHS } from './helvetica-metrics.js';

/**
 * A dependency-free PDF 1.4 writer for the schedule documents: pages of text and filled
 * rectangles in the base-14 Helvetica / Helvetica-Bold faces with WinAnsiEncoding.
 * It replaces pdfmake/pdfkit, which are too heavy for a Worker. The file is written
 * uncompressed and as 7-bit ASCII (bytes above 0x7E are octal escapes inside strings),
 * followed by a classic cross-reference table.
 *
 * Characters without a WinAnsi glyph (Arabic, Urdu, emoji, ...) are written as "?".
 * backend-node's pdfkit emitted a corrupt hex string for them, so neither API can print
 * such text with the built-in fonts; "?" keeps the rest of the line readable.
 */
export type PdfFont = 'regular' | 'bold';

/** Helvetica ascender and (ascender - descender) per em, as pdfkit reports them for both faces. */
export const ASCENDER = 0.718;
export const LINE_HEIGHT = 0.925;

/** Windows-1252 code points 0x80..0x9F (0 = unassigned). */
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];
const UNICODE_TO_WIN_ANSI = new Map<number, number>(CP1252_HIGH.flatMap((codePoint, index): [number, number][] => (codePoint === 0 ? [] : [[codePoint, 0x80 + index]])));
const REPLACEMENT = 0x3f;

function widths(font: PdfFont): readonly number[] {
  return font === 'bold' ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS;
}

/**
 * Text → WinAnsi codes, one char (0x20..0xFF) per glyph. Line breaks are kept as "\n",
 * other control characters become spaces and characters without a glyph become "?".
 */
export function encodeWinAnsi(text: string): string {
  let encoded = '';
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint === 0x0a) {
      encoded += '\n';
      continue;
    }
    let code: number;
    if (codePoint < 0x20 || codePoint === 0x7f) code = 0x20;
    else if (codePoint < 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff)) code = codePoint;
    else code = UNICODE_TO_WIN_ANSI.get(codePoint) ?? REPLACEMENT;
    if ((HELVETICA_WIDTHS[code - 32] ?? 0) === 0) code = REPLACEMENT;
    encoded += String.fromCharCode(code);
  }
  return encoded;
}

/** Advance width in points of WinAnsi-encoded text. */
export function textWidth(encoded: string, font: PdfFont, size: number): number {
  const table = widths(font);
  let total = 0;
  for (let index = 0; index < encoded.length; index++) total += table[encoded.charCodeAt(index) - 32] ?? 0;
  return (total * size) / 1000;
}

/**
 * Greedy word wrap of WinAnsi-encoded text: breaks at spaces and "\n"; a word wider than
 * the line is split between characters. Always returns at least one line.
 */
export function wrapText(encoded: string, font: PdfFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of encoded.split('\n')) {
    if (textWidth(paragraph, font, size) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ').filter((part) => part !== '')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (textWidth(candidate, font, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== '') lines.push(line);
      line = '';
      for (const char of word) {
        if (line !== '' && textWidth(line + char, font, size) > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A number in content-stream syntax: at most two decimals, no exponent. */
function num(value: number): string {
  const fixed = value.toFixed(2);
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** "#RRGGBB" → "r g b" components in 0..1. */
function rgb(color: string): string {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((part) => num(part / 255)).join(' ');
}

/** A PDF literal string of WinAnsi-encoded text, 7-bit clean. */
export function pdfString(encoded: string): string {
  let out = '(';
  for (let index = 0; index < encoded.length; index++) {
    const code = encoded.charCodeAt(index);
    if (code === 0x28 || code === 0x29 || code === 0x5c) out += `\\${encoded[index]}`;
    else if (code < 0x20 || code > 0x7e) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += encoded[index];
  }
  return `${out})`;
}

/** One page; coordinates are in points from the top-left corner, like pdfmake's. */
export class PdfPage {
  private readonly operations: string[] = [];
  private fill = '';
  private font = '';

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  private setFill(color: string): void {
    if (this.fill === color) return;
    this.fill = color;
    this.operations.push(`${rgb(color)} rg`);
  }

  /** A filled rectangle with its top-left corner at (x, y). */
  rect(x: number, y: number, width: number, height: number, color: string): void {
    this.setFill(color);
    this.operations.push(`${num(x)} ${num(this.height - y - height)} ${num(width)} ${num(height)} re f`);
  }

  /** One line of WinAnsi-encoded text whose line box starts at (x, y). */
  text(encoded: string, x: number, y: number, font: PdfFont, size: number, color = '#000000'): void {
    if (encoded === '') return;
    this.setFill(color);
    const fontKey = `/${font === 'bold' ? 'F2' : 'F1'} ${num(size)} Tf`;
    const setFont = this.font === fontKey ? '' : `${fontKey} `;
    this.font = fontKey;
    this.operations.push(`BT ${setFont}${num(x)} ${num(this.height - y - ASCENDER * size)} Td ${pdfString(encoded)} Tj ET`);
  }

  /** One line of text centred between `left` and `left + width`. */
  centeredText(encoded: string, left: number, width: number, y: number, font: PdfFont, size: number, color = '#000000'): void {
    this.text(encoded, left + (width - textWidth(encoded, font, size)) / 2, y, font, size, color);
  }

  content(): string {
    return this.operations.join('\n');
  }
}

export class PdfDocument {
  private readonly pages: PdfPage[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly title = '',
  ) {}

  addPage(): PdfPage {
    const page = new PdfPage(this.width, this.height);
    this.pages.push(page);
    return page;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** The complete file: header, objects, cross-reference table and trailer. */
  toBytes(): Uint8Array {
    const firstPageObject = 6;
    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Count ${this.pages.length} /Kids [${this.pages.map((_, index) => `${firstPageObject + index * 2} 0 R`).join(' ')}] >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Title ${pdfString(encodeWinAnsi(this.title).replace(/\n/g, ' '))} /Producer (MasjidHub) >>`,
    ];
    this.pages.forEach((page, index) => {
      const content = page.content();
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.width)} ${num(page.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${firstPageObject + index * 2 + 1} 0 R >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      );
    });

    // Every character written is below U+0100, so string length equals byte length.
    let file = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objects.forEach((body, index) => {
      offsets.push(file.length);
      file += `${index + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xrefOffset = file.length;
    file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
    file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    const bytes = new Uint8Array(file.length);
    for (let index = 0; index < file.length; index++) bytes[index] = file.charCodeAt(index);
    return bytes;
  }
}
