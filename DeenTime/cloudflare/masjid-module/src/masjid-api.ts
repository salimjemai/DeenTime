/**
 * Masjid admin API, written to drop into the shared Jemai Innovations backend (the
 * Mushaf+ Worker and its D1). That Worker mounts it under /v1/masjid and passes its own
 * session check as `verify`; see ../README.md. Every write needs a signed-in user.
 */
import { ASR_METHODS, CALCULATION_METHODS, SALAH, iqamaTimes, isValidTimeZone, prayerTimesFor, type IqamaRule, type IqamaRules } from './prayer.js';

/** The signed-in caller, as the shared backend's session check returns it. */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

/**
 * Returns the caller, or null when the request carries no valid session. It may also
 * throw an error with a numeric `status` and a string `code` (such as the shared
 * backend's ApiError for session_expired); that becomes the response.
 */
export type AuthVerifier = (request: Request) => Promise<AuthUser | null>;

/** The slice of the D1 API this module uses (tests provide a node:sqlite shim). */
export interface Db {
  prepare(sql: string): DbStatement;
  batch(statements: DbStatement[]): Promise<unknown>;
}
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

export interface MasjidApiContext {
  db: Db;
  verify: AuthVerifier;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

type Json = Record<string, unknown>;

interface MasjidRow {
  id: string;
  slug: string;
  owner_user_id: string;
  name: string;
  address_line: string;
  city: string;
  region: string;
  postal_code: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  website_url: string;
  phone: string;
  email: string;
  about: string;
  calculation_method: string;
  asr_method: string;
  iqama_json: string;
  jumuah_json: string;
  widget_json: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  masjid_id: string;
  title: string;
  body: string;
  starts_on: string | null;
  ends_on: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface WidgetSettings {
  theme: 'light' | 'dark';
  accent: string;
  showIqama: boolean;
  showMessages: boolean;
  showJumuah: boolean;
}

const DEFAULT_WIDGET: WidgetSettings = { theme: 'light', accent: '#0f766e', showIqama: true, showMessages: true, showJumuah: true };

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function errorResponse(error: HttpError): Response {
  return json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } }, error.status);
}

/**
 * Answers one masjid API request. `route` is the path after the mount point, so with the
 * module mounted at /v1/masjid a request for /v1/masjid/me/masjids passes "/me/masjids".
 */
export async function handleMasjidApi(request: Request, route: string, ctx: MasjidApiContext): Promise<Response> {
  const method = request.method.toUpperCase();
  const now = ctx.now ?? (() => new Date());
  try {
    if (method === 'GET' && route === '/config') {
      return json({ calculationMethods: CALCULATION_METHODS, asrMethods: ASR_METHODS });
    }

    let match = /^\/public\/masjids\/([a-z0-9-]{1,80})$/.exec(route);
    if (method === 'GET' && match) {
      const masjid = await ctx.db.prepare('SELECT * FROM masjids WHERE slug = ?').bind(match[1]).first<MasjidRow>();
      if (!masjid) throw new HttpError(404, 'not_found', 'That masjid was not found.');
      return json(await publicView(ctx.db, masjid, now()), 200, { 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' });
    }

    if (method === 'GET' && route.startsWith('/locate/postal-code')) {
      const url = new URL(request.url);
      return json(await lookupPostalCode(url.searchParams.get('country') ?? 'US', url.searchParams.get('code') ?? '', ctx.fetchImpl ?? fetch));
    }

    const user = await requireUser(request, ctx.verify);

    if (method === 'GET' && route === '/me/masjids') {
      const { results } = await ctx.db
        .prepare('SELECT m.* FROM masjids m JOIN masjid_admins a ON a.masjid_id = m.id WHERE a.user_id = ? ORDER BY m.created_at')
        .bind(user.id)
        .all<MasjidRow>();
      return json({ masjids: results.map(toMasjid) });
    }

    if (method === 'POST' && route === '/masjids') {
      const input = validateMasjid(await readJson(request), true);
      const owned = await ctx.db.prepare('SELECT COUNT(*) AS n FROM masjids WHERE owner_user_id = ?').bind(user.id).first<{ n: number }>();
      if ((owned?.n ?? 0) >= 5) throw new HttpError(409, 'limit_reached', 'An account can set up at most 5 masjids.');
      const id = crypto.randomUUID();
      const slug = await uniqueSlug(ctx.db, input.name as string);
      const stamp = now().toISOString();
      const row = { ...defaults(), ...input, id, slug, owner_user_id: user.id, created_at: stamp, updated_at: stamp };
      const columns = Object.keys(row);
      await ctx.db.batch([
        ctx.db.prepare(`INSERT INTO masjids (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).bind(...columns.map((c) => (row as Json)[c])),
        ctx.db.prepare("INSERT INTO masjid_admins (masjid_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").bind(id, user.id, stamp),
      ]);
      const created = await ctx.db.prepare('SELECT * FROM masjids WHERE id = ?').bind(id).first<MasjidRow>();
      return json({ masjid: toMasjid(created!) }, 201);
    }

    match = /^\/masjids\/([0-9a-f-]{36})(\/messages(?:\/([0-9a-f-]{36}))?)?$/.exec(route);
    if (match) {
      const [, masjidId, messagesPart, messageId] = match;
      const masjid = await requireAdmin(ctx.db, masjidId, user);

      if (!messagesPart) {
        if (method === 'GET') return json({ masjid: toMasjid(masjid) });
        if (method === 'PUT' || method === 'PATCH') {
          const input = validateMasjid(await readJson(request), false);
          const entries = Object.entries({ ...input, updated_at: now().toISOString() });
          await ctx.db
            .prepare(`UPDATE masjids SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
            .bind(...entries.map(([, v]) => v), masjidId)
            .run();
          const updated = await ctx.db.prepare('SELECT * FROM masjids WHERE id = ?').bind(masjidId).first<MasjidRow>();
          return json({ masjid: toMasjid(updated!) });
        }
        if (method === 'DELETE') {
          if (masjid.owner_user_id !== user.id) throw new HttpError(403, 'forbidden', 'Only the owner can delete this masjid.');
          await ctx.db.batch([
            ctx.db.prepare('DELETE FROM masjid_messages WHERE masjid_id = ?').bind(masjidId),
            ctx.db.prepare('DELETE FROM masjid_admins WHERE masjid_id = ?').bind(masjidId),
            ctx.db.prepare('DELETE FROM masjids WHERE id = ?').bind(masjidId),
          ]);
          return json(null, 204);
        }
      } else if (!messageId) {
        if (method === 'GET') {
          const { results } = await ctx.db
            .prepare('SELECT * FROM masjid_messages WHERE masjid_id = ? ORDER BY pinned DESC, created_at DESC')
            .bind(masjidId)
            .all<MessageRow>();
          return json({ messages: results.map(toMessage) });
        }
        if (method === 'POST') {
          const input = validateMessage(await readJson(request));
          const count = await ctx.db.prepare('SELECT COUNT(*) AS n FROM masjid_messages WHERE masjid_id = ?').bind(masjidId).first<{ n: number }>();
          if ((count?.n ?? 0) >= 200) throw new HttpError(409, 'limit_reached', 'Delete older messages before adding more.');
          const id = crypto.randomUUID();
          const stamp = now().toISOString();
          await ctx.db
            .prepare('INSERT INTO masjid_messages (id, masjid_id, title, body, starts_on, ends_on, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(id, masjidId, input.title, input.body, input.startsOn, input.endsOn, input.pinned ? 1 : 0, stamp, stamp)
            .run();
          const created = await ctx.db.prepare('SELECT * FROM masjid_messages WHERE id = ?').bind(id).first<MessageRow>();
          return json({ message: toMessage(created!) }, 201);
        }
      } else {
        const existing = await ctx.db.prepare('SELECT * FROM masjid_messages WHERE id = ? AND masjid_id = ?').bind(messageId, masjidId).first<MessageRow>();
        if (!existing) throw new HttpError(404, 'not_found', 'That message was not found.');
        if (method === 'PUT' || method === 'PATCH') {
          const input = validateMessage(await readJson(request));
          await ctx.db
            .prepare('UPDATE masjid_messages SET title = ?, body = ?, starts_on = ?, ends_on = ?, pinned = ?, updated_at = ? WHERE id = ?')
            .bind(input.title, input.body, input.startsOn, input.endsOn, input.pinned ? 1 : 0, now().toISOString(), messageId)
            .run();
          const updated = await ctx.db.prepare('SELECT * FROM masjid_messages WHERE id = ?').bind(messageId).first<MessageRow>();
          return json({ message: toMessage(updated!) });
        }
        if (method === 'DELETE') {
          await ctx.db.prepare('DELETE FROM masjid_messages WHERE id = ?').bind(messageId).run();
          return json(null, 204);
        }
      }
    }

    throw new HttpError(404, 'not_found', 'No such API route.');
  } catch (error) {
    if (error instanceof HttpError) return errorResponse(error);
    if (isStatusError(error)) return errorResponse(new HttpError(error.status, error.code, error.message));
    throw error;
  }
}

function isStatusError(error: unknown): error is { status: number; code: string; message: string } {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return typeof e['status'] === 'number' && e['status'] >= 400 && e['status'] < 600 && typeof e['code'] === 'string';
}

async function requireUser(request: Request, verify: AuthVerifier): Promise<AuthUser> {
  const user = await verify(request);
  if (!user) throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
  return user;
}

async function requireAdmin(db: Db, masjidId: string, user: AuthUser): Promise<MasjidRow> {
  const masjid = await db
    .prepare('SELECT m.* FROM masjids m JOIN masjid_admins a ON a.masjid_id = m.id WHERE m.id = ? AND a.user_id = ?')
    .bind(masjidId, user.id)
    .first<MasjidRow>();
  if (!masjid) throw new HttpError(404, 'not_found', 'That masjid was not found in your account.');
  return masjid;
}

async function readJson(request: Request): Promise<Json> {
  const text = await request.text();
  if (text.length > 64_000) throw new HttpError(413, 'too_large', 'That request is too large.');
  try {
    const body: unknown = JSON.parse(text || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Json;
  } catch {
    throw new HttpError(400, 'invalid_json', 'The request body must be a JSON object.');
  }
}

function defaults(): Partial<MasjidRow> {
  return {
    address_line: '',
    city: '',
    region: '',
    postal_code: '',
    country: 'US',
    latitude: null,
    longitude: null,
    website_url: '',
    phone: '',
    email: '',
    about: '',
    calculation_method: 'ISNA',
    asr_method: 'Standard',
    iqama_json: '{}',
    jumuah_json: '[]',
    widget_json: JSON.stringify(DEFAULT_WIDGET),
  };
}

const TEXT_FIELDS: [input: string, column: keyof MasjidRow, max: number][] = [
  ['name', 'name', 160],
  ['addressLine', 'address_line', 240],
  ['city', 'city', 120],
  ['region', 'region', 120],
  ['postalCode', 'postal_code', 20],
  ['country', 'country', 2],
  ['websiteUrl', 'website_url', 2048],
  ['phone', 'phone', 40],
  ['email', 'email', 320],
  ['about', 'about', 4000],
];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Turns the client's camelCase body into column values; `create` requires name and timezone. */
export function validateMasjid(body: Json, create: boolean): Partial<MasjidRow> {
  const fields: Record<string, string> = {};
  const out: Record<string, unknown> = {};

  for (const [key, column, max] of TEXT_FIELDS) {
    if (!(key in body)) continue;
    const value = typeof body[key] === 'string' ? (body[key] as string).trim() : body[key] === null ? '' : undefined;
    if (value === undefined) fields[key] = 'Must be text.';
    else if (value.length > max) fields[key] = `Keep this under ${max} characters.`;
    else out[column] = column === 'country' ? value.toUpperCase() : value;
  }
  if (create && !out['name']) fields['name'] = 'Enter the masjid name.';
  if ('name' in out && !out['name']) fields['name'] = 'Enter the masjid name.';
  if (out['website_url'] && !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(out['website_url'] as string)) fields['websiteUrl'] = 'Enter a full address starting with https://';
  if (out['email'] && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out['email'] as string)) fields['email'] = 'Enter a valid email.';
  if (out['country'] && !/^[A-Z]{2}$/.test(out['country'] as string)) fields['country'] = 'Use the two-letter country code, like US.';

  for (const [key, column, limit] of [['latitude', 'latitude', 90], ['longitude', 'longitude', 180]] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (value === null || value === '') out[column] = null;
    else if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit) out[column] = Math.round(value * 1e6) / 1e6;
    else fields[key] = `Enter a number between -${limit} and ${limit}.`;
  }

  if ('timezone' in body) {
    if (typeof body['timezone'] === 'string' && isValidTimeZone(body['timezone'])) out['timezone'] = body['timezone'];
    else fields['timezone'] = 'Choose a time zone like America/Chicago.';
  } else if (create) fields['timezone'] = 'Choose the masjid time zone.';

  if ('calculationMethod' in body) {
    if ((CALCULATION_METHODS as readonly unknown[]).includes(body['calculationMethod'])) out['calculation_method'] = body['calculationMethod'];
    else fields['calculationMethod'] = 'Choose a calculation method from the list.';
  }
  if ('asrMethod' in body) {
    if ((ASR_METHODS as readonly unknown[]).includes(body['asrMethod'])) out['asr_method'] = body['asrMethod'];
    else fields['asrMethod'] = 'Choose Standard or Hanafi.';
  }

  if ('iqama' in body) {
    const rules: IqamaRules = {};
    const raw = body['iqama'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fields['iqama'] = 'Invalid iqama settings.';
    else {
      for (const salah of SALAH) {
        const rule = (raw as Record<string, unknown>)[salah] as Record<string, unknown> | undefined;
        if (!rule) continue;
        const parsed = parseIqamaRule(rule);
        if (parsed) rules[salah] = parsed;
        else fields[`iqama.${salah}`] = 'Use a time like 13:30 or minutes after the adhan (0 to 120).';
      }
      out['iqama_json'] = JSON.stringify(rules);
    }
  }

  if ('jumuah' in body) {
    const list = body['jumuah'];
    if (!Array.isArray(list) || list.length > 4 || !list.every((t) => typeof t === 'string' && TIME.test(t))) fields['jumuah'] = 'List up to 4 times like 13:30.';
    else out['jumuah_json'] = JSON.stringify([...new Set(list as string[])].sort());
  }

  if ('widget' in body) {
    const raw = body['widget'] as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') fields['widget'] = 'Invalid widget settings.';
    else {
      const widget: WidgetSettings = {
        theme: raw['theme'] === 'dark' ? 'dark' : 'light',
        accent: typeof raw['accent'] === 'string' && /^#[0-9a-f]{6}$/i.test(raw['accent']) ? raw['accent'] : DEFAULT_WIDGET.accent,
        showIqama: raw['showIqama'] !== false,
        showMessages: raw['showMessages'] !== false,
        showJumuah: raw['showJumuah'] !== false,
      };
      out['widget_json'] = JSON.stringify(widget);
    }
  }

  if (Object.keys(fields).length) throw new HttpError(422, 'validation_failed', 'Some details need fixing.', fields);
  return out as Partial<MasjidRow>;
}

function parseIqamaRule(rule: Record<string, unknown>): IqamaRule | null {
  if (rule['mode'] === 'none') return { mode: 'none' };
  if (rule['mode'] === 'fixed' && typeof rule['time'] === 'string' && TIME.test(rule['time'])) return { mode: 'fixed', time: rule['time'] };
  if (rule['mode'] === 'offset' && Number.isInteger(rule['minutes']) && (rule['minutes'] as number) >= 0 && (rule['minutes'] as number) <= 120) {
    return { mode: 'offset', minutes: rule['minutes'] as number };
  }
  return null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateMessage(body: Json): { title: string; body: string; startsOn: string | null; endsOn: string | null; pinned: boolean } {
  const fields: Record<string, string> = {};
  const title = typeof body['title'] === 'string' ? body['title'].trim() : '';
  const text = typeof body['body'] === 'string' ? body['body'].trim() : '';
  const startsOn = typeof body['startsOn'] === 'string' && body['startsOn'] ? body['startsOn'] : null;
  const endsOn = typeof body['endsOn'] === 'string' && body['endsOn'] ? body['endsOn'] : null;
  if (!title) fields['title'] = 'Give the message a title.';
  else if (title.length > 160) fields['title'] = 'Keep the title under 160 characters.';
  if (text.length > 4000) fields['body'] = 'Keep the message under 4000 characters.';
  if (startsOn && !DATE.test(startsOn)) fields['startsOn'] = 'Use a date like 2026-12-01.';
  if (endsOn && !DATE.test(endsOn)) fields['endsOn'] = 'Use a date like 2026-12-31.';
  if (startsOn && endsOn && endsOn < startsOn) fields['endsOn'] = 'The end date is before the start date.';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation_failed', 'Some details need fixing.', fields);
  return { title, body: text, startsOn, endsOn, pinned: body['pinned'] === true };
}

export function createSlug(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'masjid';
}

async function uniqueSlug(db: Db, name: string): Promise<string> {
  const base = createSlug(name);
  for (let attempt = 0; attempt < 6; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${crypto.randomUUID().slice(0, 4)}`;
    const taken = await db.prepare('SELECT 1 AS taken FROM masjids WHERE slug = ?').bind(candidate).first();
    if (!taken) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function toMasjid(row: MasjidRow) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    addressLine: row.address_line,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    country: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    timezone: row.timezone,
    websiteUrl: row.website_url,
    phone: row.phone,
    email: row.email,
    about: row.about,
    calculationMethod: row.calculation_method,
    asrMethod: row.asr_method,
    iqama: parseJson<IqamaRules>(row.iqama_json, {}),
    jumuah: parseJson<string[]>(row.jumuah_json, []),
    widget: { ...DEFAULT_WIDGET, ...parseJson<Partial<WidgetSettings>>(row.widget_json, {}) },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toMessage(row: MessageRow) {
  return { id: row.id, title: row.title, body: row.body, startsOn: row.starts_on, endsOn: row.ends_on, pinned: row.pinned === 1, createdAt: row.created_at, updatedAt: row.updated_at };
}

async function publicView(db: Db, row: MasjidRow, now: Date) {
  const masjid = toMasjid(row);
  const times = prayerTimesFor(masjid, now);
  const tomorrow = prayerTimesFor(masjid, now, 1);
  const today = times?.date ?? now.toISOString().slice(0, 10);
  const { results } = await db
    .prepare(
      `SELECT * FROM masjid_messages WHERE masjid_id = ?
         AND (starts_on IS NULL OR starts_on <= ?) AND (ends_on IS NULL OR ends_on >= ?)
       ORDER BY pinned DESC, created_at DESC LIMIT 20`,
    )
    .bind(row.id, today, today)
    .all<MessageRow>();
  return {
    masjid: {
      slug: masjid.slug,
      name: masjid.name,
      addressLine: masjid.addressLine,
      city: masjid.city,
      region: masjid.region,
      postalCode: masjid.postalCode,
      country: masjid.country,
      timezone: masjid.timezone,
      websiteUrl: masjid.websiteUrl,
      phone: masjid.phone,
      email: masjid.email,
      about: masjid.about,
      calculationMethod: masjid.calculationMethod,
      asrMethod: masjid.asrMethod,
      jumuah: masjid.jumuah,
      widget: masjid.widget,
    },
    date: today,
    prayerTimes: times,
    iqama: iqamaTimes(masjid.iqama, times),
    tomorrow: tomorrow ? { prayerTimes: tomorrow, iqama: iqamaTimes(masjid.iqama, tomorrow) } : null,
    messages: results.map(toMessage),
  };
}

async function lookupPostalCode(country: string, code: string, fetchImpl: typeof fetch) {
  const cc = country.trim().toUpperCase();
  const postal = code.trim();
  if (!/^[A-Z]{2}$/.test(cc) || !/^[A-Za-z0-9 -]{2,10}$/.test(postal)) throw new HttpError(400, 'invalid_postal_code', 'Enter a postal code and a two-letter country.');
  const response = await fetchImpl(`https://api.zippopotam.us/${cc.toLowerCase()}/${encodeURIComponent(postal)}`, { headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new HttpError(404, 'not_found', 'That postal code was not found.');
  if (!response.ok) throw new HttpError(503, 'lookup_unavailable', 'Postal code lookup is temporarily unavailable.');
  const body = (await response.json()) as { places?: { 'place name': string; state: string; 'state abbreviation': string; latitude: string; longitude: string }[] };
  const place = body.places?.[0];
  if (!place) throw new HttpError(404, 'not_found', 'That postal code was not found.');
  return { city: place['place name'], region: place['state abbreviation'] || place.state, latitude: Number(place.latitude), longitude: Number(place.longitude) };
}
