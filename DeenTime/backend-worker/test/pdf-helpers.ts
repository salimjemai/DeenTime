import { expect } from 'vitest';

/** The file as text: every byte is one char, which is what the offsets in the xref table count. */
export function latin1(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return text;
}

/**
 * Structural checks any reader relies on: header, %%EOF, startxref pointing at the xref
 * table, one 20-byte entry per object pointing at "N 0 obj", a trailer naming the catalog,
 * the page tree agreeing with the page objects and every stream's /Length being exact.
 * Returns the number of pages.
 */
export function expectValidPdf(bytes: Uint8Array): number {
  const file = latin1(bytes);
  expect(file.startsWith('%PDF-1.4\n')).toBe(true);
  expect(file.endsWith('%%EOF\n')).toBe(true);

  const startxref = /startxref\n(\d+)\n%%EOF\n$/.exec(file);
  expect(startxref).not.toBeNull();
  const xrefOffset = Number(startxref?.[1]);
  expect(file.slice(xrefOffset, xrefOffset + 5)).toBe('xref\n');

  const xref = /^xref\n0 (\d+)\n((?:\d{10} \d{5} [nf] \n)+)trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info 5 0 R >>\n/.exec(file.slice(xrefOffset));
  expect(xref).not.toBeNull();
  const size = Number(xref?.[1]);
  const entries = (xref?.[2] ?? '').match(/.{19}\n/g) ?? [];
  expect(entries).toHaveLength(size);
  expect(Number(xref?.[3])).toBe(size);
  expect(entries[0]).toBe('0000000000 65535 f \n');
  entries.slice(1).forEach((entry, index) => {
    expect(entry.slice(10)).toBe(' 00000 n \n');
    const offset = Number(entry.slice(0, 10));
    const header = `${index + 1} 0 obj\n`;
    expect(file.slice(offset, offset + header.length), `object ${index + 1}`).toBe(header);
  });
  expect((file.match(/\d+ 0 obj\n/g) ?? []).length).toBe(size - 1);
  expect((file.match(/\nendobj\n/g) ?? []).length).toBe(size - 1);

  for (const stream of file.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = (stream.index ?? 0) + stream[0].length;
    expect(file.slice(start + Number(stream[1]), start + Number(stream[1]) + 11)).toBe('\nendstream\n');
  }

  const pages = (file.match(/\/Type \/Page /g) ?? []).length;
  const tree = /\/Type \/Pages \/Count (\d+) \/Kids \[([^\]]*)\]/.exec(file);
  expect(Number(tree?.[1])).toBe(pages);
  expect((tree?.[2] ?? '').split(' 0 R').filter((kid) => kid.trim() !== '')).toHaveLength(pages);
  // 7-bit clean apart from the binary marker comment on line 2.
  expect(/^[\n\x20-\x7e]*$/.test(file.slice(15))).toBe(true);
  return pages;
}

/** The text shown by the page content streams, in drawing order. */
export function pdfTexts(bytes: Uint8Array): string[] {
  return [...latin1(bytes).matchAll(/Td \(((?:\\.|[^\\)])*)\) Tj/g)].map((match) =>
    match[1].replace(/\\([0-7]{3})|\\(.)/g, (_, octal: string | undefined, char: string) => (octal ? String.fromCharCode(Number.parseInt(octal, 8)) : char)),
  );
}
