import { beforeAll, describe, expect, it } from 'vitest';
import { authorize, authorizeRoles, canAccessOrganization, requireUser } from '../src/core/auth.js';
import { currentUser } from '../src/core/context.js';
import { forbidden } from '../src/core/errors.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** The guard behaviour of backend-node's AuthGuard, on routes added just for this test. */
describe('authorize', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp({
      routes: (hono) => {
        hono.get('/api/test/anonymous', (c) => c.json({ user: currentUser(c) }));
        hono.get('/api/test/any', authorize(), (c) => c.json({ sub: requireUser(c).sub }));
        hono.get('/api/test/admin', authorize('Admin'), (c) => c.json({ ok: true }));
        hono.get('/api/test/super', authorize('SuperUser'), (c) => c.json({ ok: true }));
        hono.get('/api/test/editors', authorizeRoles('Admin', 'Editor'), (c) => c.json({ ok: true }));
        hono.get('/api/test/both', authorize(), authorize('SuperUser'), (c) => c.json({ ok: true }));
        hono.get('/api/test/orgs/:orgId', authorize(), (c) => {
          if (!canAccessOrganization(currentUser(c), c.req.param('orgId'))) throw forbidden();
          return c.json({ orgId: c.req.param('orgId') });
        });
      },
    });
  });

  async function expectEmpty(response: Response, status: number): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
    expect(response.headers.get('Content-Type')).toBeNull();
  }

  it('401 with an empty body without a token', async () => {
    await expectEmpty(await app.request('GET', '/api/test/any'), 401);
    await expectEmpty(await app.request('GET', '/api/test/admin'), 401);
  });

  it('401 for a token that is malformed, tampered with, or signed with another key', async () => {
    const { token } = await app.seed.signIn();
    await expectEmpty(await app.request('GET', '/api/test/any', { token: 'not-a-token' }), 401);
    await expectEmpty(await app.request('GET', '/api/test/any', { token: `${token.slice(0, -2)}xx` }), 401);
    const other = await createTestApp({ settings: { Auth__SigningKey: 'another-signing-key-that-is-long-enough-000' } });
    const foreign = await other.token({ id: 'u', email: 'u@masjid.test' }, 'org', ['SuperUser']);
    await expectEmpty(await app.request('GET', '/api/test/any', { token: foreign }), 401);
  });

  it('accepts any valid token on authorize()', async () => {
    const { token, user } = await app.seed.signIn({ roles: ['Viewer'] });
    const response = await app.request('GET', '/api/test/any', { token });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sub: user.id });
  });

  it('exposes the session user to anonymous routes', async () => {
    const { token, user, organization } = await app.seed.signIn({ roles: ['Admin', 'Editor'] });
    expect(await (await app.request('GET', '/api/test/anonymous')).json()).toEqual({ user: null });
    expect(await (await app.request('GET', '/api/test/anonymous', { token })).json()).toEqual({
      user: { sub: user.id, email: user.email, orgId: organization.id, roles: ['Admin', 'Editor'], issuer: 'deentime-test' },
    });
  });

  it('Admin policy: Admin, admin, owner and SuperUser pass, others get an empty 403', async () => {
    for (const role of ['Admin', 'admin', 'owner', 'SuperUser']) {
      const { token } = await app.seed.signIn({ roles: [role] });
      expect((await app.request('GET', '/api/test/admin', { token })).status, role).toBe(200);
    }
    const { token } = await app.seed.signIn({ roles: ['Editor'] });
    await expectEmpty(await app.request('GET', '/api/test/admin', { token }), 403);
  });

  it('SuperUser policy', async () => {
    const admin = await app.seed.signIn({ roles: ['Admin'] });
    const superUser = await app.seed.signIn({ roles: ['Admin', 'SuperUser'] });
    await expectEmpty(await app.request('GET', '/api/test/super', { token: admin.token }), 403);
    expect((await app.request('GET', '/api/test/super', { token: superUser.token })).status).toBe(200);
    await expectEmpty(await app.request('GET', '/api/test/both', { token: admin.token }), 403);
    await expectEmpty(await app.request('GET', '/api/test/both'), 401);
  });

  it('authorizeRoles matches role names case-insensitively', async () => {
    const editor = await app.seed.signIn({ roles: ['editor'] });
    const viewer = await app.seed.signIn({ roles: ['Viewer'] });
    expect((await app.request('GET', '/api/test/editors', { token: editor.token })).status).toBe(200);
    await expectEmpty(await app.request('GET', '/api/test/editors', { token: viewer.token }), 403);
  });

  it('organization scoping: own organization or SuperUser', async () => {
    const mine = await app.seed.signIn({ roles: ['Admin'] });
    const theirs = await app.seed.signIn({ roles: ['Admin'] });
    const superUser = await app.seed.signIn({ roles: ['SuperUser'] });
    expect((await app.request('GET', `/api/test/orgs/${mine.organization.id}`, { token: mine.token })).status).toBe(200);
    expect((await app.request('GET', `/api/test/orgs/${mine.organization.id.toUpperCase()}`, { token: mine.token })).status).toBe(200);
    await expectEmpty(await app.request('GET', `/api/test/orgs/${theirs.organization.id}`, { token: mine.token }), 403);
    expect((await app.request('GET', `/api/test/orgs/${theirs.organization.id}`, { token: superUser.token })).status).toBe(200);
  });
});
