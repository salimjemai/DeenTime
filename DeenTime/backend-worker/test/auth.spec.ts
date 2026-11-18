import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { servicesFor } from '../src/core/context.js';
import { newId, now } from '../src/core/db.js';
import { base64ToBytes, fromUtf8 } from '../src/core/encoding.js';
import { verifyPassword } from '../src/core/password-hasher.js';
import { hashToken } from '../src/domain/registration-identity.js';
import { resetPostalCodeService } from '../src/integrations/postal-code.js';
import { createTestApp, TEST_PASSWORD, TEST_PUBLIC_BASE_URL, type TestApp } from './support/test-app.js';

/** What api.zippopotam.us answers for 78613 (the stub backend-node's tests use). */
const zippopotam = {
  'post code': '78613',
  country: 'United States',
  'country abbreviation': 'US',
  places: [{ 'place name': 'Cedar Park', longitude: '-97.8203', state: 'Texas', 'state abbreviation': 'TX', latitude: '30.5052' }],
};

/** A 100,000-iteration hash of TEST_PASSWORD in the legacy bare format, and a 600,000-iteration one (backend-node's). */
const LEGACY_SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const LEGACY_HASH = 'c7cdNfPJ09aEMVEodcVf5pslIkaNb609RhHPcpYqEUQ=';
const NODE_600K_HASH = 'pbkdf2-sha256$600000$ENDP6PS/6x1ZdUo3Emvzyqy0Ye5jSEOwn6vZdBIzk4o=';

const NEW_PASSWORD = 'A-strong-test-password-1234';

const registration = (overrides: Record<string, unknown> = {}) => ({
  email: 'new-admin@masjid.test',
  password: NEW_PASSWORD,
  confirmPassword: NEW_PASSWORD,
  organizationName: 'Cedar Park Test Masjid',
  websiteUrl: 'https://www.cedar-park-test.example/about',
  addressLine: '123 Masjid Way',
  city: 'Cedar Park',
  state: 'TX',
  zipCode: '78613',
  ...overrides,
});

type Json = Record<string, any>;

interface FetchCall {
  url: string;
  init: RequestInit;
}

describe('auth', () => {
  /** Email delivery disabled, links logged: what backend-node's tests get from their capturing sender. */
  let app: TestApp;
  /** Email delivery disabled and nothing logged: sending fails, as in production without a mail provider. */
  let noEmail: TestApp;
  let logs: string[];
  let fetchCalls: FetchCall[];
  let address = 0;

  beforeAll(async () => {
    app = await createTestApp({ settings: { EmailDelivery__LogLinksWhenDisabled: 'true' } });
    noEmail = await createTestApp();
  });

  beforeEach(async () => {
    await app.reset();
    resetPostalCodeService(servicesFor(app.env).config);
    resetPostalCodeService(servicesFor(noEmail.env).config);
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    stubFetch((url) => (url === 'https://api.zippopotam.us/us/78613' ? Response.json(zippopotam) : new Response('unexpected request', { status: 500 })));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Replaces the network: nothing in these tests reaches a real host. */
  function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>): void {
    fetchCalls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchCalls.push({ url, init: init ?? {} });
      return handler(url, init ?? {});
    });
  }

  /** A request from a fresh client address, so the per-IP rate limits do not interfere. */
  function send(target: TestApp, method: string, path: string, json?: unknown, token?: string): Promise<Response> {
    address += 1;
    return target.request(method, path, { json, token, headers: { 'CF-Connecting-IP': `198.51.${Math.floor(address / 250) % 250}.${(address % 250) + 1}` } });
  }
  const post = (path: string, json?: unknown, token?: string) => send(app, 'POST', path, json, token);
  const get = (path: string, token?: string) => send(app, 'GET', path, undefined, token);

  function loggedLink(kind: 'verification' | 'invitation' | 'password reset', parameter: string): string {
    const prefix = `Email delivery disabled; ${kind} URL for `;
    const line = logs.filter((entry) => entry.startsWith(prefix)).at(-1);
    if (!line) throw new Error(`No ${kind} link was logged.`);
    return new URL(line.slice(line.indexOf(': ') + 2)).searchParams.get(parameter) as string;
  }

  async function seedInvitation(columns: Record<string, string | number | null> = {}): Promise<{ id: string; token: string }> {
    const id = newId();
    const token = `invitation-token-${id}`;
    const row: Record<string, string | number | null> = {
      Id: id,
      Email: 'new-admin@masjid.test',
      NormalizedEmail: 'new-admin@masjid.test',
      OrganizationName: 'Cedar Park Test Masjid',
      NormalizedOrganizationName: 'CEDAR PARK TEST MASJID',
      WebsiteUrl: 'https://cedar-park-test.example',
      AddressLine: '123 Masjid Way',
      City: 'Cedar Park',
      State: 'TX',
      ZipCode: '78613',
      InvitationTokenHash: hashToken(token),
      InvitedBySubject: 'test',
      CreatedAtUtc: now(),
      SentAtUtc: now(),
      ExpiresAtUtc: now(new Date(Date.now() + 7 * 24 * 60 * 60_000)),
      SendCount: 1,
      ...columns,
    };
    const names = Object.keys(row);
    await app.db.run(`INSERT INTO "MasjidInvitations" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, ...names.map((name) => row[name]));
    return { id, token };
  }

  /** Invitation → registration; returns the verification token from the logged link. */
  async function registerInvited(overrides: Record<string, unknown> = {}): Promise<{ invitationId: string; verificationToken: string }> {
    const invitation = await seedInvitation();
    const response = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token, ...overrides }));
    expect(response.status).toBe(202);
    return { invitationId: invitation.id, verificationToken: loggedLink('verification', 'token') };
  }

  /** A signed-in masjid administrator with a real password. */
  async function seedAdmin(email = 'admin@masjid.test', roles = ['Admin']): Promise<{ userId: string; organizationId: string; slug: string; name: string }> {
    const user = await app.seed.user({ email, password: TEST_PASSWORD });
    const organization = await app.seed.organization({ columns: { AdminUserId: user.id } });
    await app.seed.membership(organization, user, roles);
    return { userId: user.id, organizationId: organization.id, slug: organization.slug, name: organization.name };
  }

  function claims(token: string): Json {
    return JSON.parse(fromUtf8(base64ToBytes(token.split('.')[1]))) as Json;
  }

  const count = async (table: string): Promise<number> => (await app.db.first<{ N: number }>(`SELECT COUNT(*) AS "N" FROM "${table}"`))?.N ?? 0;

  describe('GET /api/v1/auth/config', () => {
    it('lists the support contact and that registration is by invitation', async () => {
      const response = await get('/api/v1/auth/config');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(await response.json()).toEqual({
        captchaEnabled: false,
        captchaSiteKey: null,
        addressAutocompleteEnabled: false,
        registrationByInvitationOnly: true,
        supportEmail: 'support@deentime.test',
        supportPhone: null,
        supportUrl: null,
      });
    });

    it('publishes the CAPTCHA site key (never the secret) when CAPTCHA is enabled', async () => {
      const captcha = await createTestApp({
        settings: { Captcha__Enabled: 'true', Captcha__SiteKey: 'site-key', Captcha__SecretKey: 'secret-key', Support__Phone: ' 512-555-0100 ', Support__Url: 'https://masjidhub.test/help' },
      });
      const body = (await (await send(captcha, 'GET', '/api/v1/auth/config')).json()) as Json;
      expect(body).toMatchObject({ captchaEnabled: true, captchaSiteKey: 'site-key', supportPhone: '512-555-0100', supportUrl: 'https://masjidhub.test/help' });
      expect(JSON.stringify(body)).not.toContain('secret-key');
    });
  });

  describe('GET /api/v1/auth/invitations/:token', () => {
    it('returns the details that prefill the registration form', async () => {
      const invitation = await seedInvitation();
      const response = await get(`/api/v1/auth/invitations/${encodeURIComponent(invitation.token)}`);
      expect(response.status).toBe(200);
      const stored = await app.db.first<{ ExpiresAtUtc: string }>('SELECT "ExpiresAtUtc" FROM "MasjidInvitations" WHERE "Id" = ?', invitation.id);
      expect(await response.json()).toEqual({
        email: 'new-admin@masjid.test',
        organizationName: 'Cedar Park Test Masjid',
        websiteUrl: 'https://cedar-park-test.example',
        addressLine: '123 Masjid Way',
        city: 'Cedar Park',
        state: 'TX',
        zipCode: '78613',
        expiresAtUtc: stored?.ExpiresAtUtc,
      });
    });

    it('answers 400 invitation_invalid for unknown, oversized, expired, revoked and used invitations', async () => {
      const invalid = { code: 'invitation_invalid', message: 'This invitation is invalid or has expired.' };
      const expired = await seedInvitation({ Email: 'a@masjid.test', NormalizedEmail: 'a@masjid.test', ExpiresAtUtc: now(new Date(Date.now() - 1000)) });
      const revoked = await seedInvitation({ Email: 'b@masjid.test', NormalizedEmail: 'b@masjid.test', RevokedAtUtc: now() });
      const accepted = await seedInvitation({ Email: 'c@masjid.test', NormalizedEmail: 'c@masjid.test', AcceptedAtUtc: now() });
      for (const token of ['not-a-real-invitation', 'x'.repeat(513), expired.token, revoked.token, accepted.token]) {
        const response = await get(`/api/v1/auth/invitations/${token}`);
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(invalid);
      }
    });

    it('is limited to 10 requests per 5 minutes per client address', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) expect((await app.request('GET', '/api/v1/auth/invitations/nope')).status).toBe(400);
      const limited = await app.request('GET', '/api/v1/auth/invitations/nope');
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
    });
  });

  describe('POST /api/v1/auth/register', () => {
    it('requires an invitation', async () => {
      const uninvited = await post('/api/v1/auth/register', registration());
      expect(uninvited.status).toBe(400);
      expect(await uninvited.json()).toEqual({
        code: 'invitation_required',
        message: 'Masjid registration is by invitation only. Contact the MasjidHub administrator to request an invitation.',
      });

      const forged = await post('/api/v1/auth/register', registration({ invitationToken: 'not-a-real-invitation' }));
      expect(forged.status).toBe(400);
      expect(await forged.json()).toEqual({
        code: 'invitation_invalid',
        message: 'This invitation is invalid or has expired. Contact the MasjidHub administrator for a new one.',
      });
      expect(await count('PendingRegistrations')).toBe(0);
      expect(logs).toEqual([]);
    });

    it('validates the form before anything else', async () => {
      const invalidEmail = await post('/api/v1/auth/register', registration({ email: 'not-an-email' }));
      expect(invalidEmail.status).toBe(400);
      const emailBody = (await invalidEmail.json()) as Json;
      expect(emailBody.title).toBe('One or more validation errors occurred.');
      expect(emailBody.status).toBe(400);
      expect(Object.keys(emailBody.errors)).toEqual(['Email']);

      const weak = await post('/api/v1/auth/register', registration({ password: 'alllowercasepassword', confirmPassword: 'alllowercasepassword' }));
      expect(weak.status).toBe(400);
      expect(((await weak.json()) as Json).errors.Password).toEqual(['Password must include an uppercase letter.', 'Password must include a number.', 'Password must include a symbol.']);

      const mismatch = await post('/api/v1/auth/register', registration({ confirmPassword: 'Another-password-5678', zipCode: 'ABCDE', state: 'Texas' }));
      expect(mismatch.status).toBe(400);
      const errors = ((await mismatch.json()) as Json).errors as Record<string, string[]>;
      expect(errors.ConfirmPassword).toEqual(['Passwords do not match.']);
      expect(Object.keys(errors).sort()).toEqual(['ConfirmPassword', 'State', 'ZipCode']);

      const empty = await post('/api/v1/auth/register');
      expect(empty.status).toBe(400);
      expect(fetchCalls).toEqual([]);
    });

    it('stores a pending registration and sends the verification link', async () => {
      const invitation = await seedInvitation();
      const response = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token, email: 'New-Admin@Masjid.test' }));
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        message: 'Check your email to verify the administrator account.',
        verificationRequired: true,
        developmentVerificationUrl: null,
      });

      const link = logs.find((entry) => entry.startsWith('Email delivery disabled; verification URL for new-admin@masjid.test: '));
      expect(link).toContain(`${TEST_PUBLIC_BASE_URL}/verify-email?token=`);
      const pending = await app.db.first<Json>('SELECT * FROM "PendingRegistrations"');
      expect(pending).toMatchObject({
        InvitationId: invitation.id,
        Email: 'new-admin@masjid.test',
        NormalizedEmail: 'new-admin@masjid.test',
        OrganizationName: 'Cedar Park Test Masjid',
        WebsiteUrl: 'https://cedar-park-test.example',
        NormalizedWebsiteHost: 'cedar-park-test.example',
        AddressLine: '123 Masjid Way',
        City: 'Cedar Park',
        State: 'TX',
        ZipCode: '78613',
        Latitude: 30.5052,
        Longitude: -97.8203,
        TimezoneId: 'America/Chicago',
        VerificationTokenHash: hashToken(loggedLink('verification', 'token')),
      });
      expect(pending?.PasswordHash).toMatch(/^pbkdf2-sha256\$100000\$/);
      expect(await verifyPassword(NEW_PASSWORD, pending?.PasswordHash, pending?.PasswordSalt)).toBe('valid');
      const lifetime = Date.parse(pending?.VerificationExpiresAtUtc) - Date.now();
      expect(lifetime).toBeGreaterThan(29 * 60_000);
      expect(lifetime).toBeLessThanOrEqual(30 * 60_000);
      const started = await app.db.first<{ RegistrationStartedAtUtc: string | null }>('SELECT "RegistrationStartedAtUtc" FROM "MasjidInvitations" WHERE "Id" = ?', invitation.id);
      expect(started?.RegistrationStartedAtUtc).not.toBeNull();
    });

    it('returns the verification link in Development only', async () => {
      const development = await createTestApp({ settings: { ASPNETCORE_ENVIRONMENT: 'Development' } });
      const invitation = await seedInvitation();
      const response = await send(development, 'POST', '/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(response.status).toBe(202);
      const body = (await response.json()) as Json;
      expect(body.developmentVerificationUrl).toMatch(new RegExp(`^${TEST_PUBLIC_BASE_URL}/verify-email\\?token=[A-Za-z0-9_-]{43}$`));
    });

    it('must use the invited email address', async () => {
      const invitation = await seedInvitation();
      const response = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token, email: 'someone-else@masjid.test' }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: 'invitation_email_mismatch', message: 'Register with the email address that received this invitation.' });
    });

    it('rejects a website that is not a web address', async () => {
      const invitation = await seedInvitation();
      const response = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token, websiteUrl: 'ftp://files.example' }));
      expect(response.status).toBe(400);
      const body = (await response.json()) as Json;
      expect(body.errors).toEqual({ WebsiteUrl: ['Enter a valid masjid website address.'] });
      expect(body.type).toBe('https://tools.ietf.org/html/rfc9110#section-15.5.1');
      expect(body.traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    });

    it('checks the ZIP code against the postal code service', async () => {
      const invitation = await seedInvitation();
      stubFetch((url) => (url.endsWith('/us/78613') ? Response.json(zippopotam) : new Response('{}', { status: 404 })));

      const unknown = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token, zipCode: '00000' }));
      expect(unknown.status).toBe(400);
      expect(((await unknown.json()) as Json).errors).toEqual({ ZipCode: ['That U.S. ZIP code could not be found.'] });

      const wrongState = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token, state: 'CA' }));
      expect(wrongState.status).toBe(400);
      expect(((await wrongState.json()) as Json).errors).toEqual({ State: ['The state does not match the ZIP code.'] });

      resetPostalCodeService(servicesFor(app.env).config);
      stubFetch(() => new Response('down', { status: 502 }));
      const unavailable = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(unavailable.status).toBe(503);
      expect(unavailable.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await unavailable.json()).toMatchObject({ title: 'Location verification is temporarily unavailable.', status: 503 });
      expect(await count('PendingRegistrations')).toBe(0);
    });

    it('answers 409 for an email or masjid that is already registered or pending', async () => {
      const unavailable = { code: 'registration_unavailable', message: 'This email or masjid is already registered or awaiting verification.' };
      const invitation = await seedInvitation();
      expect((await post('/api/v1/auth/register', registration({ invitationToken: invitation.token }))).status).toBe(202);

      const pendingDuplicate = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(pendingDuplicate.status).toBe(409);
      expect(await pendingDuplicate.json()).toEqual(unavailable);

      await app.db.run('DELETE FROM "PendingRegistrations"');
      await app.seed.user({ email: 'new-admin@masjid.test' });
      const existingEmail = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(existingEmail.status).toBe(409);
      expect(await existingEmail.json()).toEqual(unavailable);

      await app.db.run('DELETE FROM "AppUsers"');
      await app.seed.organization({ columns: { NormalizedWebsiteHost: 'cedar-park-test.example' } });
      const existingMasjid = await post('/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(existingMasjid.status).toBe(409);
      expect(await existingMasjid.json()).toEqual(unavailable);
    });

    it('drops expired pending registrations, so the masjid can register again', async () => {
      const first = await registerInvited();
      await app.db.run('UPDATE "PendingRegistrations" SET "VerificationExpiresAtUtc" = ?', now(new Date(Date.now() - 1000)));
      const invitation = await app.db.first<{ InvitationTokenHash: string }>('SELECT "InvitationTokenHash" FROM "MasjidInvitations" WHERE "Id" = ?', first.invitationId);
      expect(invitation).not.toBeNull();
      const again = await seedInvitation({ Email: 'x@masjid.test', NormalizedEmail: 'new-admin@masjid.test' });
      expect((await post('/api/v1/auth/register', registration({ invitationToken: again.token }))).status).toBe(202);
      expect(await count('PendingRegistrations')).toBe(1);
    });

    it('answers 503 and keeps nothing when the verification email cannot be sent', async () => {
      const invitation = await seedInvitation();
      const response = await send(noEmail, 'POST', '/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.6.4', title: 'Verification email could not be sent.', status: 503 });
      expect(await count('PendingRegistrations')).toBe(0);
      const row = await app.db.first<{ RegistrationStartedAtUtc: string | null }>('SELECT "RegistrationStartedAtUtc" FROM "MasjidInvitations" WHERE "Id" = ?', invitation.id);
      expect(row?.RegistrationStartedAtUtc).toBeNull();
      expect(logs).toEqual([]);
    });

    it('requires the CAPTCHA when it is enabled', async () => {
      const captcha = await createTestApp({
        settings: { Captcha__Enabled: 'true', Captcha__SiteKey: 'site-key', Captcha__SecretKey: 'secret-key', EmailDelivery__LogLinksWhenDisabled: 'true' },
      });
      const invitation = await seedInvitation();
      const missing = await send(captcha, 'POST', '/api/v1/auth/register', registration({ invitationToken: invitation.token }));
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ code: 'captcha_failed', message: 'Please complete the security verification and try again.' });
      expect(fetchCalls).toEqual([]);

      stubFetch((url) => (url.includes('siteverify') ? Response.json({ success: true, action: 'register' }) : Response.json(zippopotam)));
      const solved = await send(captcha, 'POST', '/api/v1/auth/register', registration({ invitationToken: invitation.token, captchaToken: 'solved' }));
      expect(solved.status).toBe(202);
      expect(fetchCalls[0].url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
      expect(String(fetchCalls[0].init.body)).toContain('response=solved');
    });

    it('is limited to 5 requests per 15 minutes per client address', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await app.request('POST', '/api/v1/auth/register', { json: registration() })).status).toBe(400);
      const limited = await app.request('POST', '/api/v1/auth/register', { json: registration() });
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('activates the masjid: account, organization, membership, prayer criteria and design', async () => {
      const { invitationId, verificationToken } = await registerInvited();

      const early = await post('/api/v1/auth/login', { email: 'new-admin@masjid.test', password: NEW_PASSWORD });
      expect(early.status).toBe(401);

      const verify = await post('/api/v1/auth/verify-email', { token: verificationToken });
      expect(verify.status).toBe(200);
      expect(await verify.json()).toEqual({
        verified: true,
        email: 'new-admin@masjid.test',
        organizationName: 'Cedar Park Test Masjid',
        message: 'Your email is verified. Sign in with the password you chose to open your masjid dashboard.',
      });

      const organization = await app.db.first<Json>('SELECT * FROM "Organizations"');
      const user = await app.db.first<Json>('SELECT * FROM "AppUsers"');
      expect(user).toMatchObject({ Email: 'new-admin@masjid.test', DisplayName: 'new-admin@masjid.test' });
      expect(organization).toMatchObject({
        Slug: 'cedar-park-test-masjid',
        Name: 'Cedar Park Test Masjid',
        WebsiteUrl: 'https://cedar-park-test.example',
        NormalizedWebsiteHost: 'cedar-park-test.example',
        AddressLine: '123 Masjid Way',
        City: 'Cedar Park',
        State: 'TX',
        ZipCode: '78613',
        Email: 'new-admin@masjid.test',
        AdminUserId: user?.Id,
      });
      expect(await app.db.first<Json>('SELECT * FROM "OrgUsers"')).toMatchObject({
        OrganizationId: organization?.Id,
        Issuer: 'deentime-test',
        Subject: user?.Id,
        Email: 'new-admin@masjid.test',
        DisplayName: 'new-admin@masjid.test',
        Roles: '["Admin"]',
      });
      expect(await app.db.first<Json>('SELECT * FROM "PrayerTimingCriteria"')).toMatchObject({
        OrganizationId: organization?.Id,
        Method: 'ISNA',
        JuristicMethodAsr: 'Other',
        Latitude: 30.5052,
        Longitude: -97.8203,
        TimezoneId: 'America/Chicago',
        DstObserved: 1,
        ZipCode: '78613',
        MinutesAfterZawal: 5,
        MinutesAfterMaghrib: 1,
        KhutbahTimeMinutes: 20,
      });
      expect(await app.db.first<Json>('SELECT * FROM "DesignSettings"')).toMatchObject({
        OrganizationId: organization?.Id,
        IqamaHeadings: '["FAJR","IQM*","SUNRISE","DUHUR","IQM*","ASR","IQM*","SUNSET","ISHA","IQM*"]',
        FooterHtml: `© ${new Date().getUTCFullYear()} Cedar Park Test Masjid · MasjidHub`,
        Theme: 'default',
      });
      const invitation = await app.db.first<Json>('SELECT "AcceptedAtUtc", "OrganizationId" FROM "MasjidInvitations" WHERE "Id" = ?', invitationId);
      expect(invitation?.AcceptedAtUtc).not.toBeNull();
      expect(invitation?.OrganizationId).toBe(organization?.Id);
      expect(await count('PendingRegistrations')).toBe(0);

      // The link works once, and the response never carried a session token.
      const again = await post('/api/v1/auth/verify-email', { token: verificationToken });
      expect(again.status).toBe(400);
      expect(await again.json()).toEqual({ code: 'verification_invalid', message: 'The verification link is invalid or has expired.' });

      const login = await post('/api/v1/auth/login', { email: 'new-admin@masjid.test', password: NEW_PASSWORD });
      expect(login.status).toBe(200);
      const { token } = (await login.json()) as { token: string };
      const session = await get('/api/v1/auth/session', token);
      expect(await session.json()).toEqual({
        userId: user?.Id,
        email: 'new-admin@masjid.test',
        displayName: 'new-admin@masjid.test',
        organizationId: organization?.Id,
        organizationSlug: 'cedar-park-test-masjid',
        organizationName: 'Cedar Park Test Masjid',
        roles: ['Admin'],
      });
    });

    it('adds a suffix when the slug is taken and marks zones without daylight saving time', async () => {
      await app.seed.organization({ slug: 'cedar-park-test-masjid', name: 'Another Masjid' });
      const { verificationToken } = await registerInvited();
      await app.db.run(`UPDATE "PendingRegistrations" SET "TimezoneId" = 'America/Phoenix'`);
      expect((await post('/api/v1/auth/verify-email', { token: verificationToken })).status).toBe(200);
      const created = await app.db.first<{ Slug: string }>(`SELECT "Slug" FROM "Organizations" WHERE "Name" = 'Cedar Park Test Masjid'`);
      expect(created?.Slug).toMatch(/^cedar-park-test-masjid-[0-9a-f]{4}$/);
      expect((await app.db.first<{ DstObserved: number }>('SELECT "DstObserved" FROM "PrayerTimingCriteria"'))?.DstObserved).toBe(0);
    });

    it('rejects a missing or unknown token and deletes an expired registration', async () => {
      const missing = await post('/api/v1/auth/verify-email', {});
      expect(missing.status).toBe(400);
      expect(Object.keys(((await missing.json()) as Json).errors)).toEqual(['Token']);

      const invalid = { code: 'verification_invalid', message: 'The verification link is invalid or has expired.' };
      const unknown = await post('/api/v1/auth/verify-email', { token: 'not-a-token' });
      expect(unknown.status).toBe(400);
      expect(await unknown.json()).toEqual(invalid);

      const { verificationToken } = await registerInvited();
      await app.db.run('UPDATE "PendingRegistrations" SET "VerificationExpiresAtUtc" = ?', now(new Date(Date.now() - 1000)));
      const expired = await post('/api/v1/auth/verify-email', { token: verificationToken });
      expect(expired.status).toBe(400);
      expect(await expired.json()).toEqual(invalid);
      expect(await count('PendingRegistrations')).toBe(0);
      expect(await count('AppUsers')).toBe(0);
    });

    it('answers 409 when the email or masjid was registered in the meantime', async () => {
      const registered = { code: 'registration_unavailable', message: 'This email or masjid has already been registered.' };
      const { verificationToken } = await registerInvited();
      const user = await app.seed.user({ email: 'new-admin@masjid.test' });
      const duplicateUser = await post('/api/v1/auth/verify-email', { token: verificationToken });
      expect(duplicateUser.status).toBe(409);
      expect(await duplicateUser.json()).toEqual(registered);

      await app.db.run('DELETE FROM "AppUsers" WHERE "Id" = ?', user.id);
      await app.seed.organization({ columns: { NormalizedWebsiteHost: 'cedar-park-test.example' } });
      const duplicateMasjid = await post('/api/v1/auth/verify-email', { token: verificationToken });
      expect(duplicateMasjid.status).toBe(409);
      expect(await duplicateMasjid.json()).toEqual(registered);
      expect(await count('AppUsers')).toBe(0);
      expect(await count('PendingRegistrations')).toBe(1);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('issues a session token for the right password', async () => {
      const admin = await seedAdmin();
      const response = await post('/api/v1/auth/login', { email: 'Admin@Masjid.TEST', password: TEST_PASSWORD });
      expect(response.status).toBe(200);
      const body = (await response.json()) as Json;
      expect(Object.keys(body)).toEqual(['token']);
      expect(claims(body.token)).toMatchObject({ sub: admin.userId, email: 'admin@masjid.test', orgId: admin.organizationId, role: 'Admin', iss: 'deentime-test', aud: 'deentime-api-test' });
      expect((await get('/api/v1/auth/session', body.token)).status).toBe(200);
    });

    it('answers 401 the same way for a wrong password and an unknown email', async () => {
      await seedAdmin();
      for (const credentials of [
        { email: 'admin@masjid.test', password: 'Wrong-Password-1234' },
        { email: 'nobody@masjid.test', password: TEST_PASSWORD },
      ]) {
        const response = await post('/api/v1/auth/login', credentials);
        expect(response.status).toBe(401);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
        const body = (await response.json()) as Json;
        expect(body).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.2', title: 'Unauthorized', status: 401 });
        expect(Object.keys(body).sort()).toEqual(['status', 'title', 'traceId', 'type']);
      }
    });

    it('validates the request', async () => {
      const response = await post('/api/v1/auth/login', { email: 'not-an-email', password: '' });
      expect(response.status).toBe(400);
      const body = (await response.json()) as Json;
      expect(body.title).toBe('One or more validation errors occurred.');
      expect(Object.keys(body.errors).sort()).toEqual(['Email', 'Password']);
      expect('traceId' in body).toBe(false);
    });

    it('refuses a stored hash this platform cannot compute like a wrong password, and warns in the log', async () => {
      const admin = await seedAdmin();
      await app.db.run('UPDATE "AppUsers" SET "PasswordHash" = ?, "PasswordSalt" = ? WHERE "Id" = ?', NODE_600K_HASH, LEGACY_SALT, admin.userId);
      const warnings: string[] = [];
      vi.spyOn(console, 'warn').mockImplementation((message: unknown) => {
        warnings.push(String(message));
      });

      const response = await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ title: 'Unauthorized', status: 401 });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(admin.userId);
      expect(warnings[0]).toContain('password reset is required');
      expect(warnings[0]).not.toContain(TEST_PASSWORD);
      expect(warnings[0]).not.toContain('admin@masjid.test');
      // The stored hash is left alone, and the attempt counts as a failure.
      expect((await app.db.first<{ PasswordHash: string }>('SELECT "PasswordHash" FROM "AppUsers" WHERE "Id" = ?', admin.userId))?.PasswordHash).toBe(NODE_600K_HASH);
      expect(await count('RateLimitWindows')).toBeGreaterThan(0);
    });

    it('rewrites a legacy hash in the current format after a successful sign-in', async () => {
      const admin = await seedAdmin();
      await app.db.run('UPDATE "AppUsers" SET "PasswordHash" = ?, "PasswordSalt" = ? WHERE "Id" = ?', LEGACY_HASH, LEGACY_SALT, admin.userId);
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD })).status).toBe(200);
      const stored = await app.db.first<{ PasswordHash: string; PasswordSalt: string }>('SELECT "PasswordHash", "PasswordSalt" FROM "AppUsers" WHERE "Id" = ?', admin.userId);
      expect(stored?.PasswordHash).toMatch(/^pbkdf2-sha256\$100000\$/);
      expect(stored?.PasswordSalt).not.toBe(LEGACY_SALT);
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD })).status).toBe(200);
    });

    it('answers 403 for an account without an organization', async () => {
      await app.seed.user({ email: 'orphan@masjid.test', password: TEST_PASSWORD });
      const response = await post('/api/v1/auth/login', { email: 'orphan@masjid.test', password: TEST_PASSWORD });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.4',
        title: 'Organization unavailable',
        status: 403,
        detail: 'This account is not assigned to an active organization.',
      });
    });

    it('grants Admin only to the administrator of the organization, and keeps it for a super user', async () => {
      const user = await app.seed.user({ email: 'editor@masjid.test', password: TEST_PASSWORD });
      const organization = await app.seed.organization(); // AdminUserId is someone else (null)
      await app.seed.membership(organization, user, ['Admin', 'Editor']);
      const editor = (await (await post('/api/v1/auth/login', { email: 'editor@masjid.test', password: TEST_PASSWORD })).json()) as Json;
      expect(claims(editor.token).role).toBe('Editor');

      const root = await app.seed.user({ email: 'root@masjid.test', password: TEST_PASSWORD });
      await app.seed.membership(organization, root, ['SuperUser', 'Admin']);
      const superUser = (await (await post('/api/v1/auth/login', { email: 'root@masjid.test', password: TEST_PASSWORD })).json()) as Json;
      expect(claims(superUser.token).role).toEqual(['SuperUser', 'Admin']);
    });

    it('blocks the email after five failures, with Retry-After, until a success resets it', async () => {
      await seedAdmin();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: 'Wrong-Password-1234' })).status).toBe(401);
      }
      const blocked = await post('/api/v1/auth/login', { email: 'ADMIN@masjid.test', password: TEST_PASSWORD });
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('Retry-After')).toBe('60');
      expect(blocked.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
      expect(await blocked.json()).toEqual({ message: 'Too many failed attempts. Try again later.' });

      // Other accounts are unaffected.
      await seedAdmin('second@masjid.test');
      expect((await post('/api/v1/auth/login', { email: 'second@masjid.test', password: TEST_PASSWORD })).status).toBe(200);

      // Four failures do not block, and a success clears the count.
      for (let attempt = 0; attempt < 4; attempt += 1) await post('/api/v1/auth/login', { email: 'second@masjid.test', password: 'Wrong-Password-1234' });
      expect((await post('/api/v1/auth/login', { email: 'second@masjid.test', password: TEST_PASSWORD })).status).toBe(200);
      for (let attempt = 0; attempt < 4; attempt += 1) await post('/api/v1/auth/login', { email: 'second@masjid.test', password: 'Wrong-Password-1234' });
      expect((await post('/api/v1/auth/login', { email: 'second@masjid.test', password: TEST_PASSWORD })).status).toBe(200);
    });

    it('is limited to 10 requests per minute per client address', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await app.request('POST', '/api/v1/auth/login', { json: { email: `user${attempt}@masjid.test`, password: 'Wrong-Password-1234' } })).status).toBe(401);
      }
      const limited = await app.request('POST', '/api/v1/auth/login', { json: { email: 'user@masjid.test', password: 'Wrong-Password-1234' } });
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
      expect(limited.headers.get('Retry-After')).toBeNull();
    });

    it('requires the CAPTCHA when it is enabled', async () => {
      const captcha = await createTestApp({ settings: { Captcha__Enabled: 'true', Captcha__SiteKey: 'site-key', Captcha__SecretKey: 'secret-key' } });
      await seedAdmin();
      stubFetch(() => Response.json({ success: true, action: 'login' }));

      const missing = await send(captcha, 'POST', '/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD });
      expect(missing.status).toBe(400);
      expect(await missing.json()).toEqual({ code: 'captcha_failed', message: 'Please complete the security verification and try again.' });
      expect(fetchCalls).toEqual([]);

      const solved = await send(captcha, 'POST', '/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD, captchaToken: 'solved' });
      expect(solved.status).toBe(200);
      expect(fetchCalls.map((call) => call.url)).toEqual(['https://challenges.cloudflare.com/turnstile/v0/siteverify']);

      stubFetch(() => Response.json({ success: true, action: 'register' }));
      const wrongAction = await send(captcha, 'POST', '/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD, captchaToken: 'solved' });
      expect(wrongAction.status).toBe(400);
    });
  });

  describe('GET /api/v1/auth/session', () => {
    it('describes the signed-in user and records the visit', async () => {
      const admin = await seedAdmin('admin@masjid.test', ['Admin', 'Editor']);
      await app.db.run(`UPDATE "OrgUsers" SET "LastSeenUtc" = '2020-01-01T00:00:00.000Z'`);
      const token = await app.token({ id: admin.userId, email: 'admin@masjid.test' }, admin.organizationId.toUpperCase(), ['Admin']);
      const response = await get('/api/v1/auth/session', token);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        userId: admin.userId,
        email: 'admin@masjid.test',
        displayName: 'admin@masjid.test',
        organizationId: admin.organizationId,
        organizationSlug: admin.slug,
        organizationName: admin.name,
        roles: ['Admin', 'Editor'],
      });
      const seen = await app.db.first<{ LastSeenUtc: string }>('SELECT "LastSeenUtc" FROM "OrgUsers"');
      expect(Date.now() - Date.parse(seen?.LastSeenUtc ?? '')).toBeLessThan(60_000);
    });

    it('answers 401 without a valid token', async () => {
      for (const token of [undefined, 'not-a-token']) {
        const response = await get('/api/v1/auth/session', token);
        expect(response.status).toBe(401);
        expect(await response.text()).toBe('');
      }
    });

    it('answers 403 when the token has no organization or the membership is gone', async () => {
      const admin = await seedAdmin();
      const user = { id: admin.userId, email: 'admin@masjid.test' };

      const noOrganization = await get('/api/v1/auth/session', await app.token(user, 'not-a-guid', ['Admin']));
      expect(noOrganization.status).toBe(403);
      expect(await noOrganization.json()).toMatchObject({ title: 'Organization unavailable', status: 403, detail: 'The session does not contain an active organization.' });

      const token = await app.token(user, admin.organizationId, ['Admin']);
      await app.db.run('DELETE FROM "OrgUsers"');
      const removed = await get('/api/v1/auth/session', token);
      expect(removed.status).toBe(403);
      expect(await removed.json()).toMatchObject({ title: 'Organization unavailable', status: 403, detail: 'Your session no longer has access to this organization.' });
    });
  });

  describe('POST /api/v1/auth/forgot and /reset', () => {
    const accepted = { message: 'If that email belongs to an administrator account, a password reset link is on its way.', developmentResetUrl: null };

    it('the reset link updates the password once', async () => {
      const admin = await seedAdmin();

      const unknown = await post('/api/v1/auth/forgot', { email: 'nobody@masjid.test' });
      expect(unknown.status).toBe(202);
      expect(await unknown.json()).toEqual(accepted);
      expect(logs).toEqual([]);

      const forgot = await post('/api/v1/auth/forgot', { email: 'Admin@Masjid.test' });
      expect(forgot.status).toBe(202);
      expect(await forgot.json()).toEqual(accepted);
      const link = logs.at(-1) ?? '';
      expect(link.startsWith(`Email delivery disabled; password reset URL for admin@masjid.test: ${TEST_PUBLIC_BASE_URL}/reset-password?token=`)).toBe(true);
      const token = loggedLink('password reset', 'token');
      const stored = await app.db.first<{ PasswordResetTokenHash: string; PasswordResetExpiresAtUtc: string }>('SELECT "PasswordResetTokenHash", "PasswordResetExpiresAtUtc" FROM "AppUsers" WHERE "Id" = ?', admin.userId);
      expect(stored?.PasswordResetTokenHash).toBe(hashToken(token));
      expect(Date.parse(stored?.PasswordResetExpiresAtUtc ?? '') - Date.now()).toBeGreaterThan(29 * 60_000);

      const weak = await post('/api/v1/auth/reset', { token, newPassword: 'short' });
      expect(weak.status).toBe(400);
      expect(Object.keys(((await weak.json()) as Json).errors)).toEqual(['NewPassword']);

      const reset = await post('/api/v1/auth/reset', { token, newPassword: 'Another-strong-password-5678' });
      expect(reset.status).toBe(200);
      expect(await reset.json()).toEqual({ message: 'Your password has been updated. Sign in with your new password.' });

      const reused = await post('/api/v1/auth/reset', { token, newPassword: 'Yet-another-password-9012' });
      expect(reused.status).toBe(400);
      expect(await reused.json()).toEqual({ code: 'reset_invalid', message: 'The password reset link is invalid or has expired. Request a new one.' });

      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD })).status).toBe(401);
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: 'Another-strong-password-5678' })).status).toBe(200);
    });

    it('replaces a hash this platform cannot compute, which is how those accounts recover', async () => {
      const admin = await seedAdmin();
      await app.db.run('UPDATE "AppUsers" SET "PasswordHash" = ?, "PasswordSalt" = ? WHERE "Id" = ?', NODE_600K_HASH, LEGACY_SALT, admin.userId);
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD })).status).toBe(401);

      expect((await post('/api/v1/auth/forgot', { email: 'admin@masjid.test' })).status).toBe(202);
      expect((await post('/api/v1/auth/reset', { token: loggedLink('password reset', 'token'), newPassword: 'Another-strong-password-5678' })).status).toBe(200);
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: 'Another-strong-password-5678' })).status).toBe(200);
    });

    it('lifts the failed sign-in block of that email', async () => {
      await seedAdmin();
      for (let attempt = 0; attempt < 5; attempt += 1) await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: 'Wrong-Password-1234' });
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD })).status).toBe(429);

      await post('/api/v1/auth/forgot', { email: 'admin@masjid.test' });
      expect((await post('/api/v1/auth/reset', { token: loggedLink('password reset', 'token'), newPassword: 'Another-strong-password-5678' })).status).toBe(200);
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: 'Another-strong-password-5678' })).status).toBe(200);
    });

    it('rejects oversized, unknown, blank and expired tokens', async () => {
      const invalid = { code: 'reset_invalid', message: 'The password reset link is invalid or has expired. Request a new one.' };
      const admin = await seedAdmin();
      for (const token of ['x'.repeat(513), 'not-a-token']) {
        const response = await post('/api/v1/auth/reset', { token, newPassword: 'Another-strong-password-5678' });
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual(invalid);
      }
      for (const body of [{ newPassword: 'Another-strong-password-5678' }, { token: '   ', newPassword: 'Another-strong-password-5678' }]) {
        const missing = await post('/api/v1/auth/reset', body);
        expect(missing.status).toBe(400);
        expect(Object.keys(((await missing.json()) as Json).errors)).toEqual(['Token']);
      }

      await post('/api/v1/auth/forgot', { email: 'admin@masjid.test' });
      await app.db.run('UPDATE "AppUsers" SET "PasswordResetExpiresAtUtc" = ?', now(new Date(Date.now() - 1000)));
      const expired = await post('/api/v1/auth/reset', { token: loggedLink('password reset', 'token'), newPassword: 'Another-strong-password-5678' });
      expect(expired.status).toBe(400);
      expect(await expired.json()).toEqual(invalid);
      const stored = await app.db.first<Json>('SELECT "PasswordResetTokenHash", "PasswordResetExpiresAtUtc" FROM "AppUsers" WHERE "Id" = ?', admin.userId);
      expect(stored).toEqual({ PasswordResetTokenHash: null, PasswordResetExpiresAtUtc: null });
      expect((await post('/api/v1/auth/login', { email: 'admin@masjid.test', password: TEST_PASSWORD })).status).toBe(200);
    });

    it('validates the email and answers 503 without leaving a token when the email cannot be sent', async () => {
      const invalid = await post('/api/v1/auth/forgot', { email: 'not-an-email' });
      expect(invalid.status).toBe(400);
      expect(Object.keys(((await invalid.json()) as Json).errors)).toEqual(['Email']);

      const admin = await seedAdmin();
      const response = await send(noEmail, 'POST', '/api/v1/auth/forgot', { email: 'admin@masjid.test' });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ title: 'Password reset email could not be sent.', status: 503 });
      const stored = await app.db.first<Json>('SELECT "PasswordResetTokenHash", "PasswordResetExpiresAtUtc" FROM "AppUsers" WHERE "Id" = ?', admin.userId);
      expect(stored).toEqual({ PasswordResetTokenHash: null, PasswordResetExpiresAtUtc: null });

      // An unknown email is still 202 there: the answer does not reveal which emails have an account.
      expect((await send(noEmail, 'POST', '/api/v1/auth/forgot', { email: 'nobody@masjid.test' })).status).toBe(202);
    });

    it('returns the reset link in Development only', async () => {
      const development = await createTestApp({ settings: { ASPNETCORE_ENVIRONMENT: 'Development' } });
      await seedAdmin();
      const known = (await (await send(development, 'POST', '/api/v1/auth/forgot', { email: 'admin@masjid.test' })).json()) as Json;
      expect(known.developmentResetUrl).toMatch(new RegExp(`^${TEST_PUBLIC_BASE_URL}/reset-password\\?token=[A-Za-z0-9_-]{43}$`));
      const unknown = (await (await send(development, 'POST', '/api/v1/auth/forgot', { email: 'nobody@masjid.test' })).json()) as Json;
      expect(unknown.developmentResetUrl).toBeNull();
    });

    it('delivers through the Resend API when email delivery is enabled', async () => {
      const delivering = await createTestApp({
        settings: { EmailDelivery__Enabled: 'true', EmailDelivery__ApiKey: 're_test_key', EmailDelivery__FromAddress: 'noreply@masjidhub.test', EmailDelivery__ReplyTo: 'help@masjidhub.test' },
      });
      const admin = await seedAdmin();
      stubFetch(() => Response.json({ id: 'email-1' }));

      const response = await send(delivering, 'POST', '/api/v1/auth/forgot', { email: 'admin@masjid.test' });
      expect(response.status).toBe(202);
      expect(await response.json()).toEqual(accepted);
      expect(logs).toEqual([]);
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toBe('https://api.resend.com/emails');
      expect(fetchCalls[0].init.method).toBe('POST');
      expect(fetchCalls[0].init.headers).toEqual({ Authorization: 'Bearer re_test_key', 'Content-Type': 'application/json' });
      const message = JSON.parse(String(fetchCalls[0].init.body)) as Json;
      expect(message).toMatchObject({ from: 'MasjidHub <noreply@masjidhub.test>', to: ['admin@masjid.test'], reply_to: 'help@masjidhub.test', subject: 'Reset your MasjidHub password' });
      const token = new URL((/href="([^"]+)"/.exec(message.html) as RegExpExecArray)[1].replace(/&amp;/g, '&')).searchParams.get('token') as string;
      expect((await app.db.first<Json>('SELECT "PasswordResetTokenHash" FROM "AppUsers" WHERE "Id" = ?', admin.userId))?.PasswordResetTokenHash).toBe(hashToken(token));

      // A refused delivery is a 503 and the token is withdrawn.
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      stubFetch(() => Response.json({ statusCode: 403, name: 'validation_error', message: 'The domain is not verified.' }, { status: 403 }));
      const refused = await send(delivering, 'POST', '/api/v1/auth/forgot', { email: 'admin@masjid.test' });
      expect(refused.status).toBe(503);
      expect(await refused.json()).toMatchObject({ title: 'Password reset email could not be sent.', status: 503 });
      expect((await app.db.first<Json>('SELECT "PasswordResetTokenHash" FROM "AppUsers" WHERE "Id" = ?', admin.userId))?.PasswordResetTokenHash).toBeNull();
    });

    it('forgot is limited to 5 requests per 15 minutes and reset to 10 per 5 minutes per client address', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) expect((await app.request('POST', '/api/v1/auth/forgot', { json: { email: 'nobody@masjid.test' } })).status).toBe(202);
      expect((await app.request('POST', '/api/v1/auth/forgot', { json: { email: 'nobody@masjid.test' } })).status).toBe(429);

      await app.reset();
      // reset and verify-email share the auth-verify policy.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        expect((await app.request('POST', '/api/v1/auth/reset', { json: { token: 'nope', newPassword: 'Another-strong-password-5678' } })).status).toBe(400);
        expect((await app.request('POST', '/api/v1/auth/verify-email', { json: { token: 'nope' } })).status).toBe(400);
      }
      expect((await app.request('POST', '/api/v1/auth/reset', { json: { token: 'nope', newPassword: 'Another-strong-password-5678' } })).status).toBe(429);
      expect((await app.request('POST', '/api/v1/auth/verify-email', { json: { token: 'nope' } })).status).toBe(429);
    });
  });
});
