import { describe, expect, it } from 'vitest';
import { handleMasjidApi, createSlug } from '../src/masjid-api.js';
import { parseUser } from '../src/auth.js';
import { createTestDb } from './d1-shim.js';

const users: Record<string, { id: string; email: string; displayName: string }> = {
  'token-amina': { id: 'user-amina', email: 'amina@example.org', displayName: 'Amina' },
  'token-omar': { id: 'user-omar', email: 'omar@example.org', displayName: 'Omar' },
};

function setup() {
  const db = createTestDb();
  const ctx = {
    db,
    authApiBase: 'https://auth.test',
    now: () => new Date('2026-11-18T15:00:00Z'),
    verify: async (request: Request) => users[(request.headers.get('Authorization') ?? '').replace('Bearer ', '')] ?? null,
    fetchImpl: (async () => new Response(JSON.stringify({ places: [{ 'place name': 'Cedar Park', state: 'Texas', 'state abbreviation': 'TX', latitude: '30.5052', longitude: '-97.8203' }] }))) as unknown as typeof fetch,
  };
  const call = async (method: string, path: string, body?: unknown, token?: string) => {
    const request = new Request(`https://jemaiinnovations.com/masjid${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const response = (await handleMasjidApi(request, path, ctx))!;
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  };
  return { call };
}

const newMasjid = {
  name: 'Masjid An-Noor',
  addressLine: '100 Main St',
  city: 'Cedar Park',
  region: 'TX',
  postalCode: '78613',
  country: 'US',
  latitude: 30.5052,
  longitude: -97.8203,
  timezone: 'America/Chicago',
  calculationMethod: 'ISNA',
};

describe('masjid admin API', () => {
  it('needs a signed-in user to create or list masjids', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/v1/masjids', newMasjid)).status).toBe(401);
    expect((await call('GET', '/api/v1/me/masjids', undefined, 'bad-token')).status).toBe(401);
  });

  it('creates a masjid, lists it for its owner and hides it from others', async () => {
    const { call } = setup();
    const created = await call('POST', '/api/v1/masjids', newMasjid, 'token-amina');
    expect(created.status).toBe(201);
    expect(created.body.masjid.slug).toBe('masjid-an-noor');
    expect(created.body.masjid.widget.showIqama).toBe(true);

    const mine = await call('GET', '/api/v1/me/masjids', undefined, 'token-amina');
    expect(mine.body.masjids).toHaveLength(1);
    expect((await call('GET', '/api/v1/me/masjids', undefined, 'token-omar')).body.masjids).toHaveLength(0);
    expect((await call('GET', `/api/v1/masjids/${created.body.masjid.id}`, undefined, 'token-omar')).status).toBe(404);
  });

  it('gives a second masjid with the same name its own slug', async () => {
    const { call } = setup();
    await call('POST', '/api/v1/masjids', newMasjid, 'token-amina');
    const second = await call('POST', '/api/v1/masjids', newMasjid, 'token-omar');
    expect(second.body.masjid.slug).toMatch(/^masjid-an-noor-[0-9a-f]{4}$/);
  });

  it('rejects missing name and time zone with field messages', async () => {
    const { call } = setup();
    const result = await call('POST', '/api/v1/masjids', { name: ' ', timezone: 'Mars/Olympus' }, 'token-amina');
    expect(result.status).toBe(422);
    expect(Object.keys(result.body.error.fields).sort()).toEqual(['name', 'timezone']);
  });

  it('saves iqama, jumuah and widget settings and shows them on the public page', async () => {
    const { call } = setup();
    const { body } = await call('POST', '/api/v1/masjids', newMasjid, 'token-amina');
    const id = body.masjid.id;
    const updated = await call(
      'PUT',
      `/api/v1/masjids/${id}`,
      {
        iqama: { fajr: { mode: 'offset', minutes: 20 }, dhuhr: { mode: 'fixed', time: '13:30' } },
        jumuah: ['14:30', '13:30'],
        widget: { theme: 'dark', accent: '#123456', showMessages: false },
      },
      'token-amina',
    );
    expect(updated.status).toBe(200);
    expect(updated.body.masjid.jumuah).toEqual(['13:30', '14:30']);
    expect(updated.body.masjid.widget).toMatchObject({ theme: 'dark', accent: '#123456', showMessages: false, showIqama: true });

    await call('POST', `/api/v1/masjids/${id}/messages`, { title: 'Family night', body: 'Friday after Isha', pinned: true }, 'token-amina');
    await call('POST', `/api/v1/masjids/${id}/messages`, { title: 'Old notice', endsOn: '2026-01-01' }, 'token-amina');

    const pub = await call('GET', '/api/v1/public/masjids/masjid-an-noor');
    expect(pub.status).toBe(200);
    expect(pub.body.masjid).not.toHaveProperty('id');
    expect(pub.body.date).toBe('2026-11-18');
    expect(pub.body.prayerTimes.fajr).toMatch(/^0[5-6]:\d{2}:00$/);
    expect(pub.body.iqama.dhuhr).toBe('13:30');
    const fajr = pub.body.prayerTimes.fajr.slice(0, 5).split(':').map(Number);
    const fajrIqama = pub.body.iqama.fajr.split(':').map(Number);
    expect(fajrIqama[0] * 60 + fajrIqama[1] - (fajr[0] * 60 + fajr[1])).toBe(20);
    expect(pub.body.messages.map((m: { title: string }) => m.title)).toEqual(['Family night']);
  });

  it('lets only the admin edit and delete messages', async () => {
    const { call } = setup();
    const { body } = await call('POST', '/api/v1/masjids', newMasjid, 'token-amina');
    const id = body.masjid.id;
    const msg = await call('POST', `/api/v1/masjids/${id}/messages`, { title: 'Eid prayer' }, 'token-amina');
    const messageId = msg.body.message.id;
    expect((await call('PUT', `/api/v1/masjids/${id}/messages/${messageId}`, { title: 'Hacked' }, 'token-omar')).status).toBe(404);
    const edited = await call('PUT', `/api/v1/masjids/${id}/messages/${messageId}`, { title: 'Eid prayer at 8:00' }, 'token-amina');
    expect(edited.body.message.title).toBe('Eid prayer at 8:00');
    expect((await call('DELETE', `/api/v1/masjids/${id}/messages/${messageId}`, undefined, 'token-amina')).status).toBe(204);
    expect((await call('GET', `/api/v1/masjids/${id}/messages`, undefined, 'token-amina')).body.messages).toHaveLength(0);
  });

  it('looks up a postal code without signing in', async () => {
    const { call } = setup();
    const result = await call('GET', '/api/v1/locate/postal-code?country=US&code=78613');
    expect(result.body).toEqual({ city: 'Cedar Park', region: 'TX', latitude: 30.5052, longitude: -97.8203 });
  });

  it('shares the config the web app needs', async () => {
    const { call } = setup();
    const config = await call('GET', '/api/v1/config');
    expect(config.body.authApiBase).toBe('https://auth.test');
    expect(config.body.brand.name).toBeTruthy();
  });
});

describe('helpers', () => {
  it('makes readable slugs', () => {
    expect(createSlug('  Islamic Center of Cedar Park ')).toBe('islamic-center-of-cedar-park');
    expect(createSlug('Mosquée Al-Fajr')).toBe('mosquee-al-fajr');
    expect(createSlug('مسجد')).toBe('masjid');
  });

  it('reads the user from either {user} or a bare user', () => {
    expect(parseUser({ user: { id: 'u1', email: 'a@b.c', displayName: 'A' } })).toEqual({ id: 'u1', email: 'a@b.c', displayName: 'A' });
    expect(parseUser({ sub: 'u2', email: 'x@y.z' })).toEqual({ id: 'u2', email: 'x@y.z', displayName: 'x@y.z' });
    expect(parseUser({})).toBeNull();
  });
});

describe('prayer times', () => {
  it('uses standard time right after the clocks go back (Cedar Park, 17 Nov 2026)', async () => {
    const { prayerTimesFor } = await import('../src/prayer.js');
    const times = prayerTimesFor(
      { latitude: 30.5052, longitude: -97.8203, timezone: 'America/Chicago', calculationMethod: 'ISNA', asrMethod: 'Standard' },
      new Date('2026-11-17T18:00:00Z'),
    )!;
    // Solar noon there is about 12:16 CST; Dhuhr adds 5 minutes. Sunset is about 17:33.
    expect(times.dhuhr).toBe('12:21:00');
    expect(times.sunset.slice(0, 2)).toBe('17');
  });

  it('uses daylight time in summer (Cedar Park, 1 Jul 2026)', async () => {
    const { prayerTimesFor } = await import('../src/prayer.js');
    const times = prayerTimesFor(
      { latitude: 30.5052, longitude: -97.8203, timezone: 'America/Chicago', calculationMethod: 'ISNA', asrMethod: 'Standard' },
      new Date('2026-07-01T18:00:00Z'),
    )!;
    expect(times.dhuhr.slice(0, 2)).toBe('13');
    expect(times.maghrib.slice(0, 2)).toBe('20');
  });
});
