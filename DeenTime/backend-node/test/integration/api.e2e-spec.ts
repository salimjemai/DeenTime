import { randomUUID } from 'node:crypto';
import { CURRENT_SCHEMA_VERSION } from '../../src/domain/build-info.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { createTestApp, TEST_PASSWORD, TEST_PUBLIC_BASE_URL, TEST_SUPER_USER_EMAIL, type TestApp } from '../support/test-app.js';
import { CapturingEmailSender, withStubs } from '../support/stubs.js';

/** Port of backend/DeenTime.Api.Tests/ApiIntegrationTests.cs (one scenario per test, fresh database per file). */
describe('API integration', () => {
  let app: TestApp;
  let email: CapturingEmailSender;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const superUser = () => auth(app.superUserToken);

  const registration = (overrides: Record<string, unknown> = {}) => ({
    email: 'new-admin@masjid.test',
    password: 'A-strong-test-password-1234',
    confirmPassword: 'A-strong-test-password-1234',
    organizationName: 'Cedar Park Test Masjid',
    websiteUrl: 'https://www.cedar-park-test.example/about',
    addressLine: '123 Masjid Way',
    city: 'Cedar Park',
    state: 'TX',
    zipCode: '78613',
    ...overrides,
  });

  async function invite(inviteEmail: string, organizationName: string, websiteUrl: string): Promise<string> {
    const response = await app
      .http()
      .post('/api/v1/admin/masjids/invitations')
      .set(superUser())
      .send({ email: inviteEmail, organizationName, websiteUrl, addressLine: '123 Masjid Way', city: 'Cedar Park', state: 'TX', zipCode: '78613' });
    expect(response.status).toBe(201);
    expect(response.body.emailDelivered).toBe(false);
    expect(response.body.invitationUrl).toBe(email.lastInvitationUrl);
    return new URL(response.body.invitationUrl).searchParams.get('invite') as string;
  }

  function tokenFromUrl(url: string | null, name: string): string {
    return new URL(url ?? '').searchParams.get(name) as string;
  }

  beforeEach(async () => {
    email = new CapturingEmailSender();
    app = await createTestApp({ customize: withStubs({ email }) });
  });

  afterEach(async () => {
    await app.close();
  });

  it('writes timestamps as true UTC instants regardless of the database session time zone', async () => {
    const before = Date.now();
    const maps = await app.http().get(`/api/v1/hijri/${app.organizationId}?from=2030-01&to=2030-01`).set(superUser());
    expect(maps.status).toBe(200);
    const written = Date.parse(maps.body[0].updatedAtUtc);
    expect(Math.abs(written - before)).toBeLessThan(60_000);
    const raw = await app.app.get(PrismaService).pool.query<{ utc: string }>(`SELECT to_char("UpdatedAtUtc" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') AS utc FROM "HijriMonthMaps" WHERE "Id" = $1`, [maps.body[0].id]);
    expect(Date.parse(`${raw.rows[0].utc}Z`)).toBe(Math.floor(written / 1000) * 1000);
  });

  it('readiness and version report the current stack', async () => {
    const readiness = await app.http().get('/health/ready');
    expect(readiness.status).toBe(200);
    expect(readiness.body.status).toBe('ready');
    const version = await app.http().get('/api/version');
    expect(version.body.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(version.body.apiVersion).toBeTruthy();
  });

  it('registration requires an invitation and the sign-in config lists the support contact', async () => {
    const config = await app.http().get('/api/v1/auth/config');
    expect(config.body.registrationByInvitationOnly).toBe(true);
    expect(config.body.supportEmail).toBe('support@deentime.test');

    const uninvited = await app.http().post('/api/v1/auth/register').send(registration());
    expect(uninvited.status).toBe(400);
    expect(uninvited.body.code).toBe('invitation_required');
    expect(email.lastVerificationUrl).toBeNull();

    const forged = await app.http().post('/api/v1/auth/register').send(registration({ invitationToken: 'not-a-real-invitation' }));
    expect(forged.status).toBe(400);
    expect(forged.body.code).toBe('invitation_invalid');
    expect(email.lastVerificationUrl).toBeNull();
  });

  it('invited masjid registers, verifies email, then signs in to a fully set up masjid', async () => {
    const invitationToken = await invite('new-admin@masjid.test', 'Cedar Park Test Masjid', 'https://www.cedar-park-test.example/about');

    const registered = await app.http().post('/api/v1/auth/register').send(registration({ invitationToken }));
    expect(registered.status).toBe(202);
    expect(email.lastVerificationUrl).not.toBeNull();

    const early = await app.http().post('/api/v1/auth/login').send({ email: 'new-admin@masjid.test', password: 'A-strong-test-password-1234' });
    expect(early.status).toBe(401);

    const token = tokenFromUrl(email.lastVerificationUrl, 'token');
    const verify = await app.http().post('/api/v1/auth/verify-email').send({ token });
    expect(verify.status).toBe(200);
    expect(verify.body.verified).toBe(true);
    expect(verify.body.organizationName).toBe('Cedar Park Test Masjid');
    expect(verify.body.token).toBeUndefined();
    expect((await app.http().post('/api/v1/auth/verify-email').send({ token })).status).toBe(400);

    const login = await app.http().post('/api/v1/auth/login').send({ email: 'new-admin@masjid.test', password: 'A-strong-test-password-1234' });
    expect(login.status).toBe(200);
    const admin = auth(login.body.token);

    const session = await app.http().get('/api/v1/auth/session').set(admin);
    expect(session.body.organizationName).toBe('Cedar Park Test Masjid');
    expect(session.body.roles).toContain('Admin');
    expect(session.body.roles).not.toContain('SuperUser');

    const organizations = await app.http().get('/api/v1/orgs?page=1').set(admin);
    expect(organizations.body.total).toBe(1);
    const ownOrganizationId = organizations.body.items[0].id as string;
    expect(ownOrganizationId).not.toBe(app.organizationId);

    const criteria = await app.http().get(`/api/v1/orgs/${ownOrganizationId}/criteria`).set(admin);
    expect(criteria.body.zipCode).toBe('78613');
    expect(criteria.body.latitude).toBe(30.5052);
    expect(criteria.body.longitude).toBe(-97.8203);
    expect(criteria.body.timezoneId).toBe('America/Chicago');
    const design = await app.http().get(`/api/v1/design/${ownOrganizationId}`).set(admin);
    expect(design.body.theme).toBe('default');

    expect((await app.http().get(`/api/v1/orgs/${app.organizationId}`).set(admin)).status).toBe(403);
    expect((await app.http().get(`/api/v1/orgs/${app.organizationId}/criteria`).set(admin)).status).toBe(403);
    expect((await app.http().get('/api/v1/islamic-content/summary').set(admin)).status).toBe(403);
    expect((await app.http().get('/api/v1/admin/masjids').set(admin)).status).toBe(403);

    const duplicateInvite = await app
      .http()
      .post('/api/v1/admin/masjids/invitations')
      .set(superUser())
      .send({ email: 'different-admin@masjid.test', organizationName: 'Cedar Park Test Masjid', websiteUrl: 'https://cedar-park-test.example' });
    expect(duplicateInvite.status).toBe(409);
  });

  it('super user account follows the configured email and password', async () => {
    const before = await app.http().get('/api/v1/auth/session').set(superUser());
    const superUserId = before.body.userId as string;

    const restarted = await createTestApp({
      existingDatabase: app.databaseName,
      skipLogin: true,
      customize: withStubs({ email }),
      configOverrides: { 'SuperUser:Email': 'owner@deentime.test', 'SuperUser:Password': 'Rotated-Password-5678' },
    });
    try {
      expect((await restarted.http().post('/api/v1/auth/login').send({ email: TEST_SUPER_USER_EMAIL, password: TEST_PASSWORD })).status).toBe(401);
      expect((await restarted.http().post('/api/v1/auth/login').send({ email: 'owner@deentime.test', password: TEST_PASSWORD })).status).toBe(401);
      const login = await restarted.http().post('/api/v1/auth/login').send({ email: 'owner@deentime.test', password: 'Rotated-Password-5678' });
      expect(login.status).toBe(200);
      const owner = auth(login.body.token);
      const session = await restarted.http().get('/api/v1/auth/session').set(owner);
      expect(session.body.userId).toBe(superUserId);
      expect(session.body.email).toBe('owner@deentime.test');
      expect(session.body.roles).toContain('SuperUser');
      expect((await restarted.http().get('/api/v1/admin/masjids').set(owner)).status).toBe(200);

      const prisma = restarted.app.get(PrismaService);
      expect(await prisma.orgUser.count({ where: { roles: { has: 'SuperUser' } } })).toBe(1);
      expect(await prisma.appUser.count()).toBe(1);
    } finally {
      await restarted.close();
    }
  });

  it('registration rejects invalid email and weak password and allows public zip lookup', async () => {
    const location = await app.http().get('/api/v1/locations/postal-code/78613');
    expect(location.status).toBe(200);
    expect(location.body.city).toBe('Cedar Park');
    expect(location.body.stateAbbreviation).toBe('TX');

    const invalidEmail = await app.http().post('/api/v1/auth/register').send(registration({ email: 'not-an-email', organizationName: 'Invalid Email Masjid', websiteUrl: 'https://invalid-email.example', addressLine: '100 Test Way' }));
    expect(invalidEmail.status).toBe(400);
    const weakPassword = await app
      .http()
      .post('/api/v1/auth/register')
      .send(registration({ email: 'weak-password@masjid.test', password: 'alllowercasepassword', confirmPassword: 'alllowercasepassword', organizationName: 'Weak Password Masjid', websiteUrl: 'https://weak-password.example', addressLine: '101 Test Way' }));
    expect(weakPassword.status).toBe(400);
  });

  it('super user invites a masjid and tracks registration and email verification', async () => {
    const invited = await app
      .http()
      .post('/api/v1/admin/masjids/invitations')
      .set(superUser())
      .send({ email: 'invited-admin@masjid.test', organizationName: 'Invited Test Masjid', websiteUrl: 'https://invited-test.example', addressLine: '456 Invitation Lane', city: 'Cedar Park', state: 'TX', zipCode: '78613' });
    expect(invited.status).toBe(201);
    expect(email.lastInvitationUrl).not.toBeNull();
    const invitationToken = tokenFromUrl(email.lastInvitationUrl, 'invite');

    const prefill = await app.http().get(`/api/v1/auth/invitations/${encodeURIComponent(invitationToken)}`);
    expect(prefill.status).toBe(200);
    expect(prefill.body.email).toBe('invited-admin@masjid.test');
    expect(prefill.body.organizationName).toBe('Invited Test Masjid');

    const registered = await app
      .http()
      .post('/api/v1/auth/register')
      .send(registration({ email: 'invited-admin@masjid.test', password: 'An-invited-test-password-1234', confirmPassword: 'An-invited-test-password-1234', organizationName: 'Invited Test Masjid', websiteUrl: 'https://invited-test.example', addressLine: '456 Invitation Lane', invitationToken }));
    expect(registered.status).toBe(202);

    const before = await app.http().get('/api/v1/admin/masjids').set(superUser());
    const invitedBefore = before.body.items.find((item: { email: string }) => item.email === 'invited-admin@masjid.test');
    expect(invitedBefore.status).toBe('AwaitingEmailVerification');

    const verify = await app.http().post('/api/v1/auth/verify-email').send({ token: tokenFromUrl(email.lastVerificationUrl, 'token') });
    expect(verify.status).toBe(200);
    const login = await app.http().post('/api/v1/auth/login').send({ email: 'invited-admin@masjid.test', password: 'An-invited-test-password-1234' });
    expect(login.status).toBe(200);

    const after = await app.http().get('/api/v1/admin/masjids').set(superUser());
    const invitedAfter = after.body.items.find((item: { email: string }) => item.email === 'invited-admin@masjid.test');
    expect(invitedAfter.status).toBe('Registered');
    expect(invitedAfter.source).toBe('Invitation');
    expect(invitedAfter.organizationId).not.toBe('00000000-0000-0000-0000-000000000000');
    expect(invitedAfter.organizationId).toBeTruthy();
    expect((await app.http().get('/api/v1/admin/masjids').set(auth(login.body.token))).status).toBe(403);
  });

  it('header upload rejects spoofed image content', async () => {
    const response = await app
      .http()
      .post(`/api/v1/design/files/header-image?orgId=${app.organizationId}`)
      .set(superUser())
      .attach('file', Buffer.from("<script>alert('not an image')</script>"), { filename: 'header.png', contentType: 'image/png' });
    expect(response.status).toBe(400);
  });

  it('US zip is authoritative when prayer criteria are saved', async () => {
    const update = await app
      .http()
      .put(`/api/v1/orgs/${app.organizationId}/criteria`)
      .set(superUser())
      .send({ organizationId: app.organizationId, zipCode: '78613', method: 'ISNA', juristicMethodAsr: 'Other', latitude: 30.5052, longitude: 30.5052, timezoneId: 'America/Chicago', dstObserved: true, minutesAfterZawal: 5, minutesAfterMaghrib: 1, khutbahTimeMinutes: 20 });
    expect(update.status).toBe(204);
    const saved = await app.http().get(`/api/v1/orgs/${app.organizationId}/criteria`).set(superUser());
    expect(saved.body.latitude).toBe(30.5052);
    expect(saved.body.longitude).toBe(-97.8203);
  });

  it('session reports the organization and the embed code is portable', async () => {
    const session = await app.http().get('/api/v1/auth/session').set(superUser());
    expect(session.body.organizationId).toBe(app.organizationId);

    const embed = await app.http().get(`/api/v1/publish/embed-code/${app.organizationId}`).set(superUser());
    expect(embed.status).toBe(200);
    const iframe = embed.body.iframe as string;
    expect(iframe).toContain(`src="${TEST_PUBLIC_BASE_URL}/w/`);
    expect(iframe).toContain('title="IqamaTime');
    expect(iframe).toContain('Integration Mosque prayer times');
    expect(embed.body.dailyWidgetUrl).toContain(`/w/${app.organizationSlug}/daily`);
    expect(embed.body.jumuahWidgetUrl).toContain(`/w/${app.organizationSlug}/jumuah`);
    expect(embed.body.dailyIframe).toContain(`/w/${app.organizationSlug}/daily`);
    expect(embed.body.jumuahIframe).toContain(`/w/${app.organizationSlug}/jumuah`);
    expect(iframe).toContain('data-iqamatime-auto-height');
    expect(iframe).toContain('/iqamatime-embed.js');

    const dynamic = await app.http().get(`/api/v1/publish/embed-code/${app.organizationId}?publicOrigin=https%3A%2F%2Fiqamatime.example`).set(superUser());
    expect(dynamic.body.iframe).toContain('src="https://iqamatime.example/w/');
    expect(dynamic.body.iframe).not.toContain('public.deentime.test');
    expect(dynamic.body.dailyWidgetUrl.startsWith('https://iqamatime.example/w/')).toBe(true);
    expect(dynamic.body.jumuahWidgetUrl.startsWith('https://iqamatime.example/w/')).toBe(true);
    expect(dynamic.body.iframe).toContain('https://iqamatime.example/iqamatime-embed.js');
  });

  it('TV clock scale is saved independently and bounded', async () => {
    const defaults = await app.http().get(`/api/v1/publish/tv-config/${app.organizationId}`).set(superUser());
    expect(defaults.body.clockFontScale).toBe(160);
    const saved = await app
      .http()
      .put(`/api/v1/publish/tv-config/${app.organizationId}`)
      .set(superUser())
      .send({ id: '', organizationId: app.organizationId, showSeconds: true, showHijri: true, accentColor: '#00AEEF', clockFontScale: 250, autoRefreshSeconds: 30 });
    expect(saved.status).toBe(200);
    expect(saved.body.clockFontScale).toBe(200);
    const display = await app.http().get(`/public/display/${app.organizationSlug}?layout=tv`);
    expect(display.body.tvConfig.clockFontScale).toBe(200);
  });

  it('design persists independent typography and public query overrides are bounded', async () => {
    const design = await app.http().get(`/api/v1/design/${app.organizationId}`).set(superUser());
    expect(design.body.tvFontScale).toBe(100);
    expect(design.body.compactFontFamily).toBe('system');

    const update = await app
      .http()
      .put(`/api/v1/design/${app.organizationId}`)
      .set(superUser())
      .send({ headerImageUrl: 'https://cdn.example.test/masjid.jpg', iqamaHeadings: ['FAJR', 'IQM*'], footerHtml: '<p>IqamaTime</p>', theme: 'classic', tvFontScale: 75, widgetFontScale: 125, compactFontScale: 160, tvFontFamily: 'classic-serif', widgetFontFamily: 'modern-sans', compactFontFamily: 'system' });
    expect(update.status).toBe(204);
    const saved = await app.http().get(`/api/v1/design/${app.organizationId}`).set(superUser());
    expect(saved.body.tvFontScale).toBe(75);
    expect(saved.body.widgetFontScale).toBe(125);
    expect(saved.body.compactFontScale).toBe(160);

    const invalid = await app
      .http()
      .put(`/api/v1/design/${app.organizationId}`)
      .set(superUser())
      .send({ iqamaHeadings: [], theme: 'classic', tvFontScale: 77, widgetFontScale: 125, compactFontScale: 160, tvFontFamily: 'system', widgetFontFamily: 'modern-sans', compactFontFamily: 'system' });
    expect(invalid.status).toBe(400);

    const display = await app.http().get(`/public/display/${app.organizationSlug}?layout=compact&fontScale=155`);
    expect(display.status).toBe(200);
    expect(display.body.design.tvFontScale).toBe(75);
    expect(display.body.design.widgetFontScale).toBe(125);
    expect(display.body.design.compactFontScale).toBe(155);
    expect((display.body.design.headerImageUrl as string).startsWith('https://cdn.example.test/masjid.jpg?')).toBe(true);
    expect(display.body.design.headerImageUrl).toContain('v=');
    expect((await app.http().get(`/public/display/${app.organizationSlug}?fontScale=74`)).status).toBe(400);
    expect((await app.http().get(`/public/display/${app.organizationSlug}?theme=neon`)).status).toBe(400);
    expect((await app.http().get(`/public/display/${app.organizationSlug}?layout=wall`)).status).toBe(400);
  });

  it('discovery is anonymous and encodes names in absolute snippets', async () => {
    const update = await app
      .http()
      .put(`/api/v1/orgs/${app.organizationId}`)
      .set(superUser())
      .send({ name: 'Mosque <East> & Community', addressLine: '1 Main St', city: 'Austin', state: 'TX', zipCode: '78701', phone: '', websiteUrl: '', email: '', socialUrl: '' });
    expect(update.status).toBe(204);

    const discovery = await app.http().get(`/public/organizations/${app.organizationSlug}/displays`);
    expect(discovery.status).toBe(200);
    const widget = discovery.body.displays.widget;
    expect((widget.url as string).startsWith(`${TEST_PUBLIC_BASE_URL}/w/`)).toBe(true);
    expect(widget.iframe).toContain('IqamaTime');
    expect(widget.iframe).toContain('&lt;East&gt;');
    expect(widget.iframe).toContain('&amp; Community');
    expect(widget.iframe).not.toContain('src="/w/');
    expect((discovery.body.displays.daily.url as string).endsWith('/daily')).toBe(true);
    expect((discovery.body.displays.jumuah.url as string).endsWith('/jumuah')).toBe(true);
    expect(discovery.body.supportedParameters.fontScale.min).toBe(75);
    expect((await app.http().get(`/public/display/${app.organizationSlug}`)).status).toBe(200);
  });

  it('public display keeps saved iqama visible before adhan criteria are configured', async () => {
    const prisma = app.app.get(PrismaService);
    const partialOrganizationId = randomUUID();
    await prisma.organization.create({ data: { id: partialOrganizationId, slug: 'partial-schedule', name: 'Partial Schedule Mosque', normalizedName: 'PARTIAL SCHEDULE MOSQUE', updatedAtUtc: new Date() } });
    const yesterday = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() - 1));
    await prisma.iqamaEntry.createMany({
      data: [
        { id: randomUUID(), organizationId: partialOrganizationId, date: yesterday, salah: 1, time: new Date(Date.UTC(1970, 0, 1, 6, 15, 0)), updatedAtUtc: new Date() },
        { id: randomUUID(), organizationId: partialOrganizationId, date: yesterday, salah: 4, time: new Date(Date.UTC(1970, 0, 1, 0, 0, 0)), offsetMinutes: 5, updatedAtUtc: new Date() },
      ],
    });
    const display = await app.http().get('/public/display/partial-schedule');
    expect(display.status).toBe(200);
    expect(display.body.timings).toBeNull();
    const fajr = display.body.iqama.find((item: { salah: string }) => item.salah === 'Fajr');
    const maghrib = display.body.iqama.find((item: { salah: string }) => item.salah === 'Maghrib');
    expect(fajr.time).toBe('06:15');
    expect(maghrib.time).toBeNull();
    expect(maghrib.offsetMinutes).toBe(5);
  });

  it('client credentials are scoped, metered and revocable', async () => {
    const capabilities = await app.http().get('/public/content/capabilities');
    expect(capabilities.status).toBe(200);
    expect(capabilities.body.quran.showcaseRecitation).toBe('/public/content/quran/showcase/ayah/{number}/recitation/{edition}');
    expect(capabilities.body.qibla.selectedUpstreamServer).toBe('https://api.aladhan.com/v1');
    expect(capabilities.body.qibla.openApiVersion).toBe('3.1.0');
    expect(capabilities.body.qibla.routes).toHaveLength(2);
    expect((await app.http().get('/public/content/qibla/metadata')).status).toBe(200);

    const preflight = await app
      .http()
      .options('/public/content/qibla/30.5052/-97.8203')
      .set('Origin', 'https://masjid.example')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'X-IqamaTime-Client-Key, Authorization');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('*');
    expect(preflight.headers['access-control-allow-headers']).toContain('X-IqamaTime-Client-Key');
    expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');

    expect((await app.http().get('/public/content/qibla/30.5052/-97.8203')).status).toBe(401);
    expect((await app.http().get('/public/content/hadith/books')).status).toBe(401);
    expect((await app.http().get('/public/content/hadith/books').set(superUser())).status).toBe(200);

    const qibla = await app.http().get('/public/content/qibla/30.5052/-97.8203').set(superUser());
    expect(qibla.status).toBe(200);
    expect(qibla.body.data.direction).toBe(43.36991455214116);
    expect(qibla.body.data.directionUnit).toBe('degrees');
    expect((qibla.body.data.compassUrl as string).endsWith('/public/content/qibla/30.5052/-97.8203/compass')).toBe(true);
    const compass = await app.http().get('/public/content/qibla/30.5052/-97.8203/compass').set(superUser());
    expect(compass.status).toBe(200);
    expect(compass.headers['content-type']).toContain('image/png');
    expect((await app.http().get('/public/content/qibla/91/0').set(superUser())).status).toBe(400);
    expect((await app.http().get('/public/content/quran/showcase/ayah/0/recitation/ar.alafasy').set(superUser())).status).toBe(400);

    const created = await app
      .http()
      .post(`/api/v1/orgs/${app.organizationId}/api-clients`)
      .set(superUser())
      .send({ name: 'External website', scopes: ['content:read'], requestsPerMinute: 5 });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.body)).not.toContain('secretHash');
    const clientKey = created.body.clientKey as string;
    expect(clientKey.startsWith('iqt_')).toBe(true);
    expect((await app.http().get('/public/content/qibla/30.5052/-97.8203').set('X-IqamaTime-Client-Key', clientKey)).status).toBe(200);
    expect((await app.http().get('/public/content/qibla/30.5052/-97.8203').set('X-DeenTime-Client-Key', clientKey)).status).toBe(200);

    expect((await app.http().post(`/api/v1/orgs/${app.organizationId}/api-clients/${created.body.client.id}/revoke`).set(superUser()).send({})).status).toBe(204);
    expect((await app.http().get('/public/content/qibla/30.5052/-97.8203').set('X-IqamaTime-Client-Key', clientKey)).status).toBe(401);
  });

  it('password reset link updates the password once', async () => {
    email.lastPasswordResetUrl = null;
    const unknown = await app.http().post('/api/v1/auth/forgot').send({ email: 'nobody@masjid.test' });
    expect(unknown.status).toBe(202);
    expect(email.lastPasswordResetUrl).toBeNull();

    const forgot = await app.http().post('/api/v1/auth/forgot').send({ email: 'Admin@DeenTime.test' });
    expect(forgot.status).toBe(202);
    expect(email.lastPasswordResetUrl).not.toBeNull();
    const resetUrl = new URL(email.lastPasswordResetUrl ?? '');
    expect(`${resetUrl.origin}${resetUrl.pathname}`).toBe(`${TEST_PUBLIC_BASE_URL}/reset-password`);
    const token = resetUrl.searchParams.get('token') as string;

    expect((await app.http().post('/api/v1/auth/reset').send({ token, newPassword: 'short' })).status).toBe(400);
    expect((await app.http().post('/api/v1/auth/reset').send({ token, newPassword: 'Another-strong-password-5678' })).status).toBe(200);
    expect((await app.http().post('/api/v1/auth/reset').send({ token, newPassword: 'Yet-another-password-9012' })).status).toBe(400);
    expect((await app.http().post('/api/v1/auth/login').send({ email: TEST_SUPER_USER_EMAIL, password: TEST_PASSWORD })).status).toBe(401);
    expect((await app.http().post('/api/v1/auth/login').send({ email: TEST_SUPER_USER_EMAIL, password: 'Another-strong-password-5678' })).status).toBe(200);
  });
});
