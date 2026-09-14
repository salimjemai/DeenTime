import { createHash } from 'node:crypto';

/**
 * Port of RegistrationIdentityNormalizer + UsTimeZoneResolver: normalized email,
 * website host and the SHA-256 fingerprints used to detect duplicate masjids.
 */
export interface NormalizedRegistrationIdentity {
  email: string;
  name: string;
  websiteUrl: string;
  websiteHost: string;
  addressFingerprint: string;
  masjidIdentityKey: string;
}

export function normalizeWords(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

export function tryCreateIdentity(
  email: string,
  organizationName: string,
  websiteUrl: string,
  addressLine: string,
  city: string,
  state: string,
  zipCode: string,
): NormalizedRegistrationIdentity | null {
  let candidate = (websiteUrl ?? '').trim();
  if (!candidate.includes('://')) candidate = `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  let host = url.hostname.replace(/\.+$/, '').toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  if (host.length === 0 || host.length > 253) return null;

  const normalizedName = normalizeWords(organizationName);
  const normalizedAddress = [normalizeWords(addressLine), normalizeWords(city), normalizeWords(state), normalizeWords(zipCode)].join('|');
  return {
    email: (email ?? '').trim().toLowerCase(),
    name: normalizedName,
    websiteUrl: `https://${host}`,
    websiteHost: host,
    addressFingerprint: sha256Hex(normalizedAddress),
    masjidIdentityKey: sha256Hex(`${normalizedName}|${normalizeWords(zipCode)}`),
  };
}

/** RegistrationIdentityNormalizer.CreateSlug. */
export function createSlug(name: string): string {
  const ascii = name.normalize('NFD').replace(/\p{Mn}/gu, '');
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.length === 0 ? 'masjid' : slug.slice(0, 70);
}

const PACIFIC = new Set(['CA', 'NV', 'OR', 'WA']);
const MOUNTAIN = new Set(['AZ', 'CO', 'ID', 'MT', 'NM', 'UT', 'WY']);
const CENTRAL = new Set(['AL', 'AR', 'IA', 'IL', 'KS', 'LA', 'MN', 'MO', 'MS', 'ND', 'NE', 'OK', 'SD', 'TN', 'TX', 'WI']);

/** UsTimeZoneResolver.Resolve: IANA zone from a U.S. state and longitude. */
export function resolveUsTimeZone(state: string, longitude: number): string {
  const code = (state ?? '').trim().toUpperCase();
  if (code === 'AK') return 'America/Anchorage';
  if (code === 'HI') return 'Pacific/Honolulu';
  if (code === 'AZ') return 'America/Phoenix';
  if (code === 'TX' && longitude < -103) return 'America/Denver';
  if (code === 'FL') return longitude < -85.2 ? 'America/Chicago' : 'America/New_York';
  if (code === 'KY') return longitude < -85.7 ? 'America/Chicago' : 'America/New_York';
  if (PACIFIC.has(code)) return 'America/Los_Angeles';
  if (MOUNTAIN.has(code)) return 'America/Denver';
  if (CENTRAL.has(code)) return 'America/Chicago';
  return 'America/New_York';
}

export function base64Url(bytes: Buffer): string {
  return bytes.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** SHA-256 hex (upper-case, like Convert.ToHexString) of an opaque token. */
export function hashToken(token: string): string {
  return sha256Hex(token);
}
