import type { Response } from 'express';
import type { AppConfig } from '../../config/configuration.js';

/**
 * PublicController.PublicOrigin / EnsureProductionScheme / AbsoluteRoute /
 * VersionedAssetUrl and the pieces of System.Uri they rely on. Every URL the
 * .NET controller emits goes through Uri.ToString(), i.e. UriFormat.SafeUnescaped:
 * percent-encoded reserved characters and controls stay encoded while everything
 * else (spaces, quotes, non-ASCII, ...) is rendered literally. uriToString()
 * reproduces that rendering on top of the WHATWG URL parser.
 */

/** The parts of the Express request PublicOrigin() reads. */
export interface PublicOriginRequest {
  /** Request.Scheme. */
  protocol: string;
  header(name: string): string | string[] | undefined;
}

/** InvalidOperationException from PublicOrigin(): unhandled in .NET, so it becomes a 500 here too. */
export class PublicOriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PublicOriginError';
  }
}

const HTTP_SCHEMES = new Set(['http:', 'https:']);
const UNIX_EPOCH_TICKS = 621_355_968_000_000_000n;

/** Uri.TryCreate(value, UriKind.Absolute) for the scheme-qualified values this module handles. */
function tryParseAbsolute(value: string | undefined): URL | null {
  if (value === undefined || value.trim() === '') return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** Headers["X-Forwarded-*"].FirstOrDefault()?.Split(',')[0].Trim(): undefined only when the header is absent. */
function firstHeaderValue(request: PublicOriginRequest, name: string): string | undefined {
  const raw = request.header(name);
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined ? undefined : value.split(',')[0].trim();
}

export function isLoopbackHost(host: string): boolean {
  const lowered = host.toLowerCase();
  return lowered === 'localhost' || lowered === '127.0.0.1' || lowered === '::1';
}

function ensureProductionScheme(url: URL, isDevelopment: boolean): URL {
  if (!isDevelopment && isLoopbackHost(url.hostname)) {
    throw new PublicOriginError('Production public display URLs must use a non-local HTTPS origin.');
  }
  if (isDevelopment || url.protocol === 'https:') return url;
  // UriBuilder { Scheme = https, Port = IsDefaultPort ? -1 : Port }: a non-default port survives.
  const secured = new URL(url.href);
  secured.protocol = 'https:';
  return secured;
}

/**
 * PublicController.PublicOrigin(): Frontend:PublicBaseUrl when it is an absolute
 * http(s) URL, otherwise X-Forwarded-Proto / X-Forwarded-Host with the request's
 * scheme and Host header as fallbacks. Outside Development the scheme is forced to
 * https and loopback hosts are rejected; hosts containing "@" or "/" always are.
 */
export function resolvePublicOrigin(config: AppConfig, request: PublicOriginRequest): URL {
  const isDevelopment = config.isDevelopment();
  const configured = tryParseAbsolute(config.get('Frontend:PublicBaseUrl'));
  if (configured && HTTP_SCHEMES.has(configured.protocol)) return ensureProductionScheme(configured, isDevelopment);

  const forwardedProto = firstHeaderValue(request, 'x-forwarded-proto');
  const forwardedHost = firstHeaderValue(request, 'x-forwarded-host');
  let scheme = forwardedProto === undefined || forwardedProto === '' ? request.protocol : forwardedProto;
  if (scheme.toLowerCase() !== 'https' && !isDevelopment) scheme = 'https';
  const hostHeader = request.header('host');
  const host = forwardedHost ?? (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ?? '';
  if (host.trim() === '' || host.includes('@') || host.includes('/')) {
    throw new PublicOriginError('A safe public frontend origin is required for public display links.');
  }
  const candidate = tryParseAbsolute(`${scheme}://${host}`);
  if (!isDevelopment && candidate && isLoopbackHost(candidate.hostname)) {
    throw new PublicOriginError('Production public display URLs must use a non-local HTTPS origin.');
  }
  const origin = tryParseAbsolute(`${scheme.toLowerCase()}://${host}/`);
  if (!origin) throw new PublicOriginError(`Invalid public origin: ${scheme}://${host}`);
  return origin;
}

/** Uri.EscapeDataString: RFC 3986 unreserved characters stay, everything else is UTF-8 percent-encoded. */
export function escapeDataString(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** ASCII characters Uri.ToString() keeps percent-encoded (UriHelper.IsNotSafeForUnescape). */
const NOT_SAFE_FOR_UNESCAPE = new Set([...'%;/?:@&=+$,#[]!\'()*\\'].map((char) => char.charCodeAt(0)));

/** RFC 3987 ucschar: the non-ASCII code points an IRI may carry literally. */
function isIriCodePoint(codePoint: number): boolean {
  if (codePoint < 0xa0) return false;
  if (codePoint <= 0xd7ff) return true;
  if (codePoint >= 0xf900 && codePoint <= 0xfdcf) return true;
  if (codePoint >= 0xfdf0 && codePoint <= 0xffef) return true;
  if (codePoint >= 0x10000 && codePoint <= 0xefffd) return (codePoint & 0xffff) <= 0xfffd && !(codePoint >= 0xe0000 && codePoint < 0xe1000);
  return false;
}

function isSafeToUnescape(codePoint: number): boolean {
  if (codePoint < 0x80) return codePoint > 0x1f && codePoint !== 0x7f && !NOT_SAFE_FOR_UNESCAPE.has(codePoint);
  return isIriCodePoint(codePoint);
}

function isHexPair(text: string, index: number): boolean {
  return index + 1 < text.length && /^[0-9A-Fa-f]{2}$/.test(text.slice(index, index + 2));
}

/** Decodes one UTF-8 scalar starting at bytes[index]; null for an invalid sequence. */
function decodeUtf8(bytes: number[], index: number): { codePoint: number; length: number } | null {
  const first = bytes[index];
  if (first < 0x80) return { codePoint: first, length: 1 };
  let length: number;
  let codePoint: number;
  let minimum: number;
  if (first >= 0xc2 && first <= 0xdf) {
    length = 2;
    codePoint = first & 0x1f;
    minimum = 0x80;
  } else if (first >= 0xe0 && first <= 0xef) {
    length = 3;
    codePoint = first & 0x0f;
    minimum = 0x800;
  } else if (first >= 0xf0 && first <= 0xf4) {
    length = 4;
    codePoint = first & 0x07;
    minimum = 0x10000;
  } else {
    return null;
  }
  if (index + length > bytes.length) return null;
  for (let offset = 1; offset < length; offset++) {
    const continuation = bytes[index + offset];
    if ((continuation & 0xc0) !== 0x80) return null;
    codePoint = (codePoint << 6) | (continuation & 0x3f);
  }
  if (codePoint < minimum || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
  return { codePoint, length };
}

/** Uri.ToString() (UriFormat.SafeUnescaped) of a WHATWG-normalized URL. */
export function uriToString(url: URL): string {
  const href = url.href;
  let output = '';
  let index = 0;
  while (index < href.length) {
    if (href[index] !== '%' || !isHexPair(href, index + 1)) {
      output += href[index];
      index++;
      continue;
    }
    const bytes: number[] = [];
    while (index < href.length && href[index] === '%' && isHexPair(href, index + 1)) {
      bytes.push(Number.parseInt(href.slice(index + 1, index + 3), 16));
      index += 3;
    }
    let position = 0;
    while (position < bytes.length) {
      const decoded = decodeUtf8(bytes, position);
      if (decoded && isSafeToUnescape(decoded.codePoint)) {
        output += String.fromCodePoint(decoded.codePoint);
        position += decoded.length;
      } else {
        output += `%${bytes[position].toString(16).toUpperCase().padStart(2, '0')}`;
        position++;
      }
    }
  }
  return output;
}

/** AbsoluteRoute(origin, path) = new Uri(origin, path.TrimStart('/')).ToString(). */
export function absoluteRoute(origin: URL, path: string): string {
  return uriToString(new URL(path.replace(/^\/+/, ''), origin));
}

/** new Uri(new Uri(url).GetLeftPart(UriPartial.Authority) + "/iqamatime-embed.js").AbsoluteUri. */
export function embedScriptUrl(url: string): string {
  const parsed = new URL(url);
  const credentials = parsed.username === '' ? '' : `${parsed.username}${parsed.password === '' ? '' : `:${parsed.password}`}@`;
  return `${parsed.protocol}//${credentials}${parsed.host}/iqamatime-embed.js`;
}

/** DateTime.Ticks (100 ns since 0001-01-01) of a UTC instant plus its sub-millisecond microseconds. */
export function dotnetTicks(instant: Date, extraMicroseconds = 0): string {
  return (UNIX_EPOCH_TICKS + BigInt(instant.getTime()) * 10_000n + BigInt(extraMicroseconds) * 10n).toString();
}

/**
 * Ticks of a PostgreSQL timestamp rendered with to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.US')
 * ("2026-09-10T20:11:07.100348"), keeping the microseconds Npgsql hands to DateTime and
 * Prisma's JavaScript Date drops. Null when the text does not have that shape.
 */
export function ticksFromUtcText(text: string | undefined | null): string | null {
  const match = text ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(text) : null;
  if (!match) return null;
  const milliseconds = Date.parse(`${match[1]}Z`);
  if (Number.isNaN(milliseconds)) return null;
  const microseconds = Number((match[2] ?? '').padEnd(6, '0'));
  return dotnetTicks(new Date(milliseconds + Math.floor(microseconds / 1000)), microseconds % 1000);
}

/**
 * VersionedAssetUrl: null for blank values; absolute URLs are kept, relative ones
 * resolve against the public origin (leading slashes trimmed); "v={ticks}" is appended
 * to the query with "?" or "&" depending on whether the URL already carries one.
 */
export function versionedAssetUrl(value: string | null | undefined, version: string, origin: () => URL): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const url = tryParseAbsolute(value) ?? new URL(value.replace(/^\/+/, ''), origin());
  const beforeFragment = url.href.slice(0, url.href.length - url.hash.length);
  const hasQuery = url.search !== '' || beforeFragment.endsWith('?');
  url.search = hasQuery ? `${url.search.slice(1)}&v=${version}` : `v=${version}`;
  return uriToString(url);
}

/**
 * RedirectToFrontend(path): Location = AbsoluteRoute(PublicOrigin(), path), written
 * verbatim (Express's res.redirect would percent-encode what Uri.ToString() left literal).
 * The handler carries @HttpCode(302).
 */
export function redirectToFrontend(config: AppConfig, request: PublicOriginRequest, response: Response, path: string): void {
  const location = absoluteRoute(resolvePublicOrigin(config, request), path);
  // Kestrel refuses non-ASCII and control characters in header values (a 500), where Node would send them Latin-1 encoded.
  if (/[^\t\x20-\x7e]/.test(location)) throw new PublicOriginError(`Invalid non-ASCII or control character in header: ${location}`);
  response.setHeader('Location', location);
}
