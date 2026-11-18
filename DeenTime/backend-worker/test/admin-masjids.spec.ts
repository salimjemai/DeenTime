import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId, now } from '../src/core/db.js';
import { hashToken } from '../src/domain/registration-identity.js';
import { createTestApp, TEST_PUBLIC_BASE_URL, type TestApp } from './support/test-app.js';

type Json = Record<string, any>;

const DAY_MS = 24 * 60 * 60_000;
const BASE = '/api/v1/admin/masjids';

const invitationBody = (overrides: Record<string, unknown> = {}) => ({
  email: 'Invited-Admin@Masjid.test',
  organizationName: ' Invited Test Masjid ',
  websiteUrl: 'https://www.invited-test.example/about',
  addressLine: ' 456 Invitation Lane ',
  city: 'Cedar Park',
  state: 'tx',
  zipCode: '78613',
  ...overrides,
});

describe('admin masjids', () => {
  /** Email delivery disabled, links logged: what backend-node's tests get from their capturing sender. */
  let app: TestApp;
  let logs: string[];
  let fetchCalls: { url: string; init: RequestInit }[];

  beforeAll(async () => {
    app = await createTestApp({ settings: { EmailDelivery__LogLinksWhenDisabled: 'true' } });
  });

  beforeEach(async () => {
    await app.reset();
    logs = [];
    vi.spyOn(console, 'log').mockImplementation((message: unknown) => {
      logs.push(String(message));
    });
    stubFetch(() => new Response('unexpected request', { status: 500 }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Replaces the network: nothing in these tests reaches a real host. */
  function stubFetch(handler: (url: string) => Response): void {
    fetchCalls = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      fetchCalls.push({ url, init: init ?? {} });
      return handler(url);
    });
  }

  /** A new super user each time, so the per-user `expensive` rate limit does not interfere. */
  async function superUser(): Promise<{ token: string; userId: string; organizationId: string }> {
    const { token, user, organization } = await app.seed.signIn({ roles: ['SuperUser', 'Admin'] });
    return { token, userId: user.id, organizationId: organization.id };
  }

  async function invite(overrides: Record<string, unknown> = {}, target: TestApp = app): Promise<Response> {
    return target.request('POST', `${BASE}/invitations`, { token: (await superUser()).token, json: invitationBody(overrides) });
  }

  function loggedInvitationToken(): string {
    const line = logs.filter((entry) => entry.startsWith('Email delivery disabled; invitation URL for ')).at(-1);
    if (!line) throw new Error('No invitation link was logged.');
    return new URL(line.slice(line.indexOf(': ') + 2)).searchParams.get('invite') as string;
  }

  async function seedInvitation(columns: Record<string, string | number | null> = {}): Promise<{ id: string; token: string }> {
    const id = newId();
    const token = `invitation-token-${id}`;
    const row: Record<string, string | number | null> = {
      Id: id,
      Email: `${id}@masjid.test`,
      NormalizedEmail: `${id}@masjid.test`,
      OrganizationName: `Masjid ${id}`,
      NormalizedOrganizationName: `MASJID ${id.toUpperCase()}`,
      InvitationTokenHash: hashToken(token),
      InvitedBySubject: 'test',
      CreatedAtUtc: now(),
      SentAtUtc: now(),
      ExpiresAtUtc: now(new Date(Date.now() + 7 * DAY_MS)),
      SendCount: 1,
      ...columns,
    };
    const names = Object.keys(row);
    await app.db.run(`INSERT INTO "MasjidInvitations" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`, ...names.map((name) => row[name]));
    return { id, token };
  }

  /** A registration waiting for its email verification (expired when `expiresInMs` is negative). */
  async function seedPending(invitationId: string | null, email: string, expiresInMs = 30 * 60_000): Promise<string> {
    const id = newId();
    await app.db.run(
      `INSERT INTO "PendingRegistrations" ("Id", "InvitationId", "Email", "NormalizedEmail", "PasswordHash", "PasswordSalt", "OrganizationName", "NormalizedName",
  "WebsiteUrl", "NormalizedWebsiteHost", "AddressLine", "City", "State", "ZipCode", "AddressFingerprint", "MasjidIdentityKey", "Latitude", "Longitude", "TimezoneId",
  "VerificationTokenHash", "VerificationExpiresAtUtc", "CreatedAtUtc")
VALUES (?, ?, ?, ?, 'hash', 'salt', 'Pending Masjid', 'PENDING MASJID', ?, ?, '1 Way', 'Cedar Park', 'TX', '78613', ?, ?, 30.5, -97.8, 'America/Chicago', ?, ?, ?)`,
      id,
      invitationId,
      email,
      email,
      `https://${id}.example`,
      `${id}.example`,
      `fingerprint-${id}`,
      `identity-${id}`,
      `token-hash-${id}`,
      now(new Date(Date.now() + expiresInMs)),
      now(),
    );
    return id;
  }

  const invitationRow = (id: string) => app.db.first<Json>('SELECT * FROM "MasjidInvitations" WHERE "Id" = ?', id);
  const count = async (table: string): Promise<number> => (await app.db.first<{ N: number }>(`SELECT COUNT(*) AS "N" FROM "${table}"`))?.N ?? 0;

  describe('authorization', () => {
    const endpoints: [string, string][] = [
      ['GET', BASE],
      ['POST', `${BASE}/invitations`],
      ['POST', `${BASE}/invitations/${newId()}/resend`],
      ['POST', `${BASE}/invitations/${newId()}/revoke`],
    ];

    it('answers 401 without a session', async () => {
      for (const [method, path] of endpoints) {
        const response = await app.request(method, path, { json: method === 'POST' ? invitationBody() : undefined });
        expect(response.status, `${method} ${path}`).toBe(401);
        expect(await response.text()).toBe('');
      }
    });

    it('answers 403 for a masjid administrator', async () => {
      for (const [method, path] of endpoints) {
        const { token } = await app.seed.signIn({ roles: ['Admin'] });
        const response = await app.request(method, path, { token, json: method === 'POST' ? invitationBody() : undefined });
        expect(response.status, `${method} ${path}`).toBe(403);
        expect(await response.text()).toBe('');
      }
      expect(await count('MasjidInvitations')).toBe(0);
    });
  });

  describe('POST /invitations', () => {
    it('creates the invitation and hands the link back when it was not emailed', async () => {
      const admin = await superUser();
      const response = await app.request('POST', `${BASE}/invitations`, { token: admin.token, json: invitationBody() });
      expect(response.status).toBe(201);
      const body = (await response.json()) as Json;
      expect(response.headers.get('Location')).toBe(`/api/v1/admin/masjids/invitations/${body.id}`);
      const token = loggedInvitationToken();
      expect(logs).toEqual([`Email delivery disabled; invitation URL for invited-admin@masjid.test: ${TEST_PUBLIC_BASE_URL}/login?invite=${token}`]);
      const stored = await invitationRow(body.id);
      expect(body).toEqual({
        id: stored?.Id,
        email: 'invited-admin@masjid.test',
        organizationName: 'Invited Test Masjid',
        status: 'InvitationSent',
        expiresAtUtc: stored?.ExpiresAtUtc,
        emailDelivered: false,
        invitationUrl: `${TEST_PUBLIC_BASE_URL}/login?invite=${token}`,
      });
      expect(Object.keys(body)).toEqual(['id', 'email', 'organizationName', 'status', 'expiresAtUtc', 'emailDelivered', 'invitationUrl']);
      expect(stored).toMatchObject({
        Email: 'invited-admin@masjid.test',
        NormalizedEmail: 'invited-admin@masjid.test',
        OrganizationName: 'Invited Test Masjid',
        NormalizedOrganizationName: 'INVITED TEST MASJID',
        WebsiteUrl: 'https://invited-test.example',
        AddressLine: '456 Invitation Lane',
        City: 'Cedar Park',
        State: 'TX',
        ZipCode: '78613',
        InvitationTokenHash: hashToken(token),
        InvitedBySubject: admin.userId,
        RegistrationStartedAtUtc: null,
        AcceptedAtUtc: null,
        RevokedAtUtc: null,
        SendCount: 1,
        OrganizationId: null,
      });
      expect(stored?.CreatedAtUtc).toBe(stored?.SentAtUtc);
      expect(Date.parse(stored?.ExpiresAtUtc) - Date.parse(stored?.SentAtUtc)).toBe(7 * DAY_MS);

      // The link opens the registration form.
      const prefill = await app.request('GET', `/api/v1/auth/invitations/${token}`);
      expect(prefill.status).toBe(200);
      expect(await prefill.json()).toMatchObject({ email: 'invited-admin@masjid.test', organizationName: 'Invited Test Masjid', state: 'TX' });
    });

    it('needs only an email and a name', async () => {
      const response = await invite({ websiteUrl: null, addressLine: '  ', city: undefined, state: '', zipCode: undefined });
      expect(response.status).toBe(201);
      const stored = await invitationRow(((await response.json()) as Json).id);
      expect(stored).toMatchObject({ WebsiteUrl: null, AddressLine: null, City: null, State: null, ZipCode: null });
    });

    it('validates the request', async () => {
      const response = await invite({ email: 'not-an-email', organizationName: '', state: 'Texas', zipCode: '123' });
      expect(response.status).toBe(400);
      const body = (await response.json()) as Json;
      expect(body.title).toBe('One or more validation errors occurred.');
      expect(Object.keys(body.errors).sort()).toEqual(['Email', 'OrganizationName', 'State', 'ZipCode']);
      expect(body.errors.State).toEqual(['State must be a two-letter abbreviation.']);
      expect(body.errors.ZipCode).toEqual(['Enter a valid U.S. ZIP code.']);

      const website = await invite({ websiteUrl: 'ftp://files.example' });
      expect(website.status).toBe(400);
      const problem = (await website.json()) as Json;
      expect(problem.errors).toEqual({ WebsiteUrl: ['Enter a valid masjid website address.'] });
      expect(problem.traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
      expect(await count('MasjidInvitations')).toBe(0);
    });

    it('answers 409 for an email or masjid that is already invited, pending or registered', async () => {
      const unavailable = { code: 'invitation_unavailable', message: 'This email or masjid is already registered, invited, or awaiting verification.' };
      const expectUnavailable = async (response: Response): Promise<void> => {
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual(unavailable);
      };

      expect((await invite()).status).toBe(201);
      await expectUnavailable(await invite({ organizationName: 'Another Masjid', websiteUrl: null }));

      await app.seed.user({ email: 'registered@masjid.test' });
      await expectUnavailable(await invite({ email: 'Registered@masjid.test', organizationName: 'Another Masjid', websiteUrl: null }));

      await app.seed.organization({ name: 'Cedar Park Test Masjid', columns: { NormalizedName: 'CEDAR PARK TEST MASJID', NormalizedWebsiteHost: 'cedar-park-test.example' } });
      await expectUnavailable(await invite({ email: 'different-admin@masjid.test', organizationName: 'cedar park  test masjid', websiteUrl: 'https://cedar-park-test.example' }));

      await seedPending(null, 'pending@masjid.test');
      await expectUnavailable(await invite({ email: 'pending@masjid.test', organizationName: 'Another Masjid', websiteUrl: null }));

      const website = await invite({ email: 'different-admin@masjid.test', organizationName: 'Another Masjid', websiteUrl: 'www.cedar-park-test.example' });
      expect(website.status).toBe(409);
      expect(await website.json()).toEqual({ code: 'invitation_unavailable', message: 'This masjid website is already registered.' });
      expect(await count('MasjidInvitations')).toBe(1);
    });

    it('allows a new invitation once the previous one expired or was revoked', async () => {
      await seedInvitation({ Email: 'invited-admin@masjid.test', NormalizedEmail: 'invited-admin@masjid.test', ExpiresAtUtc: now(new Date(Date.now() - 1000)) });
      await seedInvitation({ Email: 'invited-admin@masjid.test', NormalizedEmail: 'invited-admin@masjid.test', RevokedAtUtc: now() });
      expect((await invite()).status).toBe(201);
    });

    it('answers 503 and keeps nothing when the invitation cannot be sent', async () => {
      const noEmail = await createTestApp();
      const response = await invite({}, noEmail);
      expect(response.status).toBe(503);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await response.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.6.4', title: 'Invitation email could not be sent.', status: 503 });
      expect(await count('MasjidInvitations')).toBe(0);
      expect(logs).toEqual([]);
    });

    it('emails the link through Resend and keeps it out of the response when delivery is enabled', async () => {
      const delivering = await createTestApp({ settings: { EmailDelivery__Enabled: 'true', EmailDelivery__ApiKey: 're_test_key', EmailDelivery__FromAddress: 'noreply@masjidhub.test' } });
      stubFetch(() => Response.json({ id: 'email-1' }));
      const response = await invite({}, delivering);
      expect(response.status).toBe(201);
      const body = (await response.json()) as Json;
      expect(body).toMatchObject({ emailDelivered: true, invitationUrl: null });
      expect(fetchCalls.map((call) => call.url)).toEqual(['https://api.resend.com/emails']);
      const message = JSON.parse(String(fetchCalls[0].init.body)) as Json;
      expect(message).toMatchObject({ from: 'MasjidHub <noreply@masjidhub.test>', to: ['invited-admin@masjid.test'], subject: 'You are invited to register your masjid with MasjidHub' });
      expect(message.html).toContain('<strong>Invited Test Masjid</strong>');
      const link = new URL((/href="([^"]+)"/.exec(message.html) as RegExpExecArray)[1]);
      expect(`${link.origin}${link.pathname}`).toBe(`${TEST_PUBLIC_BASE_URL}/login`);
      expect((await invitationRow(body.id))?.InvitationTokenHash).toBe(hashToken(link.searchParams.get('invite') as string));
      expect(logs).toEqual([]);

      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      stubFetch(() => new Response('upstream down', { status: 502 }));
      const refused = await invite({ email: 'second@masjid.test', organizationName: 'Second Masjid', websiteUrl: null }, delivering);
      expect(refused.status).toBe(503);
      expect(await count('MasjidInvitations')).toBe(1);
    });

    it('returns the link in Development even when it was emailed', async () => {
      const development = await createTestApp({
        settings: { ASPNETCORE_ENVIRONMENT: 'Development', EmailDelivery__Enabled: 'true', EmailDelivery__ApiKey: 're_test_key', EmailDelivery__FromAddress: 'noreply@masjidhub.test' },
      });
      stubFetch(() => Response.json({ id: 'email-1' }));
      const body = (await (await invite({}, development)).json()) as Json;
      expect(body.emailDelivered).toBe(true);
      expect(body.invitationUrl).toMatch(new RegExp(`^${TEST_PUBLIC_BASE_URL}/login\\?invite=[A-Za-z0-9_-]{43}$`));
    });

    it('is limited to 5 requests per 10 minutes per user', async () => {
      const admin = await superUser();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await app.request('POST', `${BASE}/invitations`, { token: admin.token, json: invitationBody({ email: `m${attempt}@masjid.test`, organizationName: `Masjid ${attempt}`, websiteUrl: null }) });
        expect(response.status).toBe(201);
      }
      const limited = await app.request('POST', `${BASE}/invitations`, { token: admin.token, json: invitationBody({ email: 'm6@masjid.test', organizationName: 'Masjid 6', websiteUrl: null }) });
      expect(limited.status).toBe(429);
      expect(await limited.text()).toBe('');
      // Resend shares the policy; the list and revoke are not limited.
      const invitation = await seedInvitation();
      expect((await app.request('POST', `${BASE}/invitations/${invitation.id}/resend`, { token: admin.token })).status).toBe(429);
      expect((await app.request('GET', BASE, { token: admin.token })).status).toBe(200);
      expect((await app.request('POST', `${BASE}/invitations/${invitation.id}/revoke`, { token: admin.token })).status).toBe(204);
    });
  });

  describe('GET /', () => {
    it('is empty when there is nothing but the super user organization', async () => {
      const admin = await superUser();
      const response = await app.request('GET', BASE, { token: admin.token });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ summary: { total: 0, registered: 0, invited: 0, awaitingEmailVerification: 0, expired: 0, revoked: 0 }, items: [] });
    });

    it('lists every invitation with its status, and masjids registered without one', async () => {
      const admin = await superUser();
      const at = (minutesAgo: number): string => now(new Date(Date.now() - minutesAgo * 60_000));

      const sent = await seedInvitation({ Email: 'sent@masjid.test', OrganizationName: 'Sent Masjid', WebsiteUrl: 'https://sent.example', City: 'Austin', State: 'TX', SentAtUtc: at(10), SendCount: 2 });
      const awaiting = await seedInvitation({ Email: 'awaiting@masjid.test', SentAtUtc: at(20), RegistrationStartedAtUtc: at(5) });
      await seedPending(awaiting.id, 'awaiting@masjid.test');
      const lapsed = await seedInvitation({ Email: 'lapsed@masjid.test', SentAtUtc: at(30), RegistrationStartedAtUtc: at(25) });
      await seedPending(lapsed.id, 'lapsed@masjid.test', -1000);
      const expired = await seedInvitation({ Email: 'expired@masjid.test', SentAtUtc: at(40), ExpiresAtUtc: at(1) });
      const revoked = await seedInvitation({ Email: 'revoked@masjid.test', SentAtUtc: at(50), RevokedAtUtc: at(2) });

      const joined = await app.seed.organization({ name: 'Joined Masjid' });
      const accepted = await seedInvitation({ Email: 'accepted@masjid.test', OrganizationName: 'Joined Masjid', SentAtUtc: at(60), AcceptedAtUtc: at(55), OrganizationId: joined.id });

      const self = await app.seed.organization({ name: 'Self Registered Masjid', columns: { Email: 'office@self.example', WebsiteUrl: 'https://self.example', City: 'Dallas', State: 'TX', UpdatedAtUtc: at(70) } });
      const selfAdmin = await app.seed.user({ email: 'imam@self.example' });
      await app.seed.membership(self, selfAdmin, ['Editor']);
      await app.seed.membership(self, await app.seed.user({ email: 'admin@self.example' }), ['admin']);
      const bare = await app.seed.organization({ name: 'No Members Masjid', columns: { Email: 'office@bare.example', UpdatedAtUtc: at(80) } });

      const response = await app.request('GET', BASE, { token: admin.token });
      expect(response.status).toBe(200);
      const body = (await response.json()) as { summary: Json; items: Json[] };

      expect(body.summary).toEqual({ total: 8, registered: 3, invited: 1, awaitingEmailVerification: 2, expired: 1, revoked: 1 });
      // Open invitations first, newest first; registered masjids last. The super user's own organization is not listed.
      expect(body.items.map((item) => [item.id, item.status, item.source, item.canResend, item.canRevoke])).toEqual([
        [sent.id, 'InvitationSent', 'Invitation', true, true],
        [awaiting.id, 'AwaitingEmailVerification', 'Invitation', false, true],
        [lapsed.id, 'EmailVerificationExpired', 'Invitation', true, true],
        [expired.id, 'Expired', 'Invitation', true, false],
        [revoked.id, 'Revoked', 'Invitation', false, false],
        [accepted.id, 'Registered', 'Invitation', false, false],
        [self.id, 'Registered', 'SelfRegistration', false, false],
        [bare.id, 'Registered', 'SelfRegistration', false, false],
      ]);

      const stored = await invitationRow(sent.id);
      expect(body.items[0]).toEqual({
        id: sent.id,
        organizationId: null,
        organizationName: 'Sent Masjid',
        email: 'sent@masjid.test',
        websiteUrl: 'https://sent.example',
        city: 'Austin',
        state: 'TX',
        status: 'InvitationSent',
        source: 'Invitation',
        invitedAtUtc: stored?.SentAtUtc,
        expiresAtUtc: stored?.ExpiresAtUtc,
        registrationStartedAtUtc: null,
        registeredAtUtc: null,
        sendCount: 2,
        canResend: true,
        canRevoke: true,
      });
      expect(Object.keys(body.items[0])).toEqual([
        'id',
        'organizationId',
        'organizationName',
        'email',
        'websiteUrl',
        'city',
        'state',
        'status',
        'source',
        'invitedAtUtc',
        'expiresAtUtc',
        'registrationStartedAtUtc',
        'registeredAtUtc',
        'sendCount',
        'canResend',
        'canRevoke',
      ]);
      expect(body.items[5]).toMatchObject({ organizationId: joined.id, registeredAtUtc: (await invitationRow(accepted.id))?.AcceptedAtUtc });
      expect(body.items[6]).toEqual({
        id: self.id,
        organizationId: self.id,
        organizationName: 'Self Registered Masjid',
        email: 'admin@self.example',
        websiteUrl: 'https://self.example',
        city: 'Dallas',
        state: 'TX',
        status: 'Registered',
        source: 'SelfRegistration',
        invitedAtUtc: null,
        expiresAtUtc: null,
        registrationStartedAtUtc: null,
        registeredAtUtc: (await app.db.first<Json>('SELECT "UpdatedAtUtc" FROM "Organizations" WHERE "Id" = ?', self.id))?.UpdatedAtUtc,
        sendCount: 0,
        canResend: false,
        canRevoke: false,
      });
      expect(body.items[7].email).toBe('office@bare.example');
    });
  });

  describe('POST /invitations/:id/resend', () => {
    it('issues a new link, extends the expiry and counts the send', async () => {
      const admin = await superUser();
      const invitation = await seedInvitation({ Email: 'sent@masjid.test', SentAtUtc: now(new Date(Date.now() - 3 * DAY_MS)), ExpiresAtUtc: now(new Date(Date.now() - 1000)), RegistrationStartedAtUtc: now() });
      await seedPending(invitation.id, 'sent@masjid.test', -1000);

      const response = await app.request('POST', `${BASE}/invitations/${invitation.id.toUpperCase()}/resend`, { token: admin.token });
      expect(response.status).toBe(200);
      const token = loggedInvitationToken();
      const stored = await invitationRow(invitation.id);
      expect(await response.json()).toEqual({
        message: 'Invitation resent.',
        expiresAtUtc: stored?.ExpiresAtUtc,
        emailDelivered: false,
        invitationUrl: `${TEST_PUBLIC_BASE_URL}/login?invite=${token}`,
      });
      expect(logs.at(-1)).toContain('invitation URL for sent@masjid.test: ');
      expect(stored).toMatchObject({ InvitationTokenHash: hashToken(token), SendCount: 2, RegistrationStartedAtUtc: null });
      expect(Date.parse(stored?.ExpiresAtUtc) - Date.parse(stored?.SentAtUtc)).toBe(7 * DAY_MS);
      expect(Date.now() - Date.parse(stored?.SentAtUtc)).toBeLessThan(60_000);

      // Only the new link works.
      expect((await app.request('GET', `/api/v1/auth/invitations/${invitation.token}`)).status).toBe(400);
      expect((await app.request('GET', `/api/v1/auth/invitations/${token}`)).status).toBe(200);
    });

    it('answers 404 for an unknown invitation', async () => {
      const admin = await superUser();
      for (const id of [newId(), 'not-a-guid']) {
        const response = await app.request('POST', `${BASE}/invitations/${id}/resend`, { token: admin.token });
        expect(response.status).toBe(404);
        expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
        expect(await response.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 });
      }
    });

    it('answers 409 for a completed or revoked invitation and while a verification link is live', async () => {
      const organization = await app.seed.organization();
      const accepted = await seedInvitation({ AcceptedAtUtc: now(), OrganizationId: organization.id });
      const revoked = await seedInvitation({ RevokedAtUtc: now() });
      for (const invitation of [accepted, revoked]) {
        const response = await app.request('POST', `${BASE}/invitations/${invitation.id}/resend`, { token: (await superUser()).token });
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({ message: 'A completed or revoked invitation cannot be resent.' });
      }

      const awaiting = await seedInvitation();
      await seedPending(awaiting.id, 'awaiting@masjid.test');
      const response = await app.request('POST', `${BASE}/invitations/${awaiting.id}/resend`, { token: (await superUser()).token });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ message: 'This masjid already has an active email-verification link.' });
      expect((await invitationRow(awaiting.id))?.SendCount).toBe(1);
      expect(logs).toEqual([]);
    });

    it('answers 503 and leaves the current link valid when the email cannot be sent', async () => {
      const noEmail = await createTestApp();
      const invitation = await seedInvitation();
      const before = await invitationRow(invitation.id);
      const response = await noEmail.request('POST', `${BASE}/invitations/${invitation.id}/resend`, { token: (await superUser()).token });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ title: 'Invitation email could not be sent.', status: 503 });
      expect(await invitationRow(invitation.id)).toEqual(before);
    });
  });

  describe('POST /invitations/:id/revoke', () => {
    it('revokes the invitation and drops its pending registration', async () => {
      const admin = await superUser();
      const invitation = await seedInvitation();
      await seedPending(invitation.id, 'awaiting@masjid.test');
      const other = await seedInvitation();
      await seedPending(other.id, 'other@masjid.test');

      const response = await app.request('POST', `${BASE}/invitations/${invitation.id.toUpperCase()}/revoke`, { token: admin.token });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      const revokedAt = (await invitationRow(invitation.id))?.RevokedAtUtc as string;
      expect(Date.now() - Date.parse(revokedAt)).toBeLessThan(60_000);
      expect((await invitationRow(other.id))?.RevokedAtUtc).toBeNull();
      expect(await app.db.all<Json>('SELECT "InvitationId" FROM "PendingRegistrations"')).toEqual([{ InvitationId: other.id }]);
      expect((await app.request('GET', `/api/v1/auth/invitations/${invitation.token}`)).status).toBe(400);

      // Revoking again keeps the original time.
      await app.db.run(`UPDATE "MasjidInvitations" SET "RevokedAtUtc" = '2026-01-02T03:04:05.000Z' WHERE "Id" = ?`, invitation.id);
      expect((await app.request('POST', `${BASE}/invitations/${invitation.id}/revoke`, { token: admin.token })).status).toBe(204);
      expect((await invitationRow(invitation.id))?.RevokedAtUtc).toBe('2026-01-02T03:04:05.000Z');
    });

    it('answers 404 for an unknown invitation and 409 for a completed one', async () => {
      const admin = await superUser();
      for (const id of [newId(), 'not-a-guid']) {
        const response = await app.request('POST', `${BASE}/invitations/${id}/revoke`, { token: admin.token });
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ title: 'Not Found', status: 404 });
      }

      const organization = await app.seed.organization();
      const accepted = await seedInvitation({ AcceptedAtUtc: now(), OrganizationId: organization.id });
      const response = await app.request('POST', `${BASE}/invitations/${accepted.id}/revoke`, { token: admin.token });
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ message: 'A completed invitation cannot be revoked.' });
      expect((await invitationRow(accepted.id))?.RevokedAtUtc).toBeNull();
    });
  });
});
