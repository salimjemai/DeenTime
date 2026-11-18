// Copy into the shared backend as backend/test/masjid.test.ts; it runs with that repo's
// @cloudflare/vitest-plugin setup (real D1, real sign-up), not with this folder's tests.
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

async function signUp(email: string) {
  const res = await SELF.fetch('https://api.test/v1/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'correct horse battery', displayName: 'Imam' }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { token: string }).token;
}

describe('masjid module mounted in the shared Worker', () => {
  it('sets up a masjid with a shared account and shows it publicly', async () => {
    const token = await signUp('imam@example.org');
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    expect((await SELF.fetch('https://api.test/v1/masjid/me/masjids')).status).toBe(401);
    const created = await SELF.fetch('https://api.test/v1/masjid/masjids', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ name: 'Masjid An-Noor', latitude: 30.5052, longitude: -97.8203, timezone: 'America/Chicago' }),
    });
    expect(created.status).toBe(201);
    const { masjid } = (await created.json()) as { masjid: { id: string; slug: string } };
    const patched = await SELF.fetch(`https://api.test/v1/masjid/masjids/${masjid.id}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ city: 'Cedar Park' }) });
    expect(patched.status).toBe(200);
    const pub = await SELF.fetch(`https://api.test/v1/masjid/public/masjids/${masjid.slug}`);
    expect(pub.status).toBe(200);
    const body = (await pub.json()) as { prayerTimes: { dhuhr: string } | null };
    expect(body.prayerTimes?.dhuhr).toMatch(/^\d\d:\d\d/);
    const del = await SELF.fetch('https://api.test/v1/me', { method: 'DELETE', headers: auth, body: JSON.stringify({ password: 'correct horse battery' }) });
    expect([200, 204]).toContain(del.status);
    expect((await SELF.fetch(`https://api.test/v1/masjid/public/masjids/${masjid.slug}`)).status).toBe(404);
  });
});
