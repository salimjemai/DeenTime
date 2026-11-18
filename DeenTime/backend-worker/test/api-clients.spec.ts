import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ApiClientCredentialService, clientKeyFromHeaders, hashSecret, splitClientKey } from '../src/modules/api-clients/credentials.js';
import { createTestApp, type SeededOrganization, type TestApp } from './support/test-app.js';

const UNKNOWN_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

interface ClientJson {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  requestsPerMinute: number;
  createdAtUtc: string;
  lastUsedAtUtc: string | null;
  revokedAtUtc: string | null;
}

describe('api-clients', () => {
  let app: TestApp;
  let token: string;
  let organization: SeededOrganization;
  let credentials: ApiClientCredentialService;

  beforeAll(async () => {
    app = await createTestApp();
    credentials = new ApiClientCredentialService(app.db);
  });
  beforeEach(async () => {
    await app.reset();
    ({ token, organization } = await app.seed.signIn({ roles: ['Admin'] }));
  });

  const base = (orgId = organization.id) => `/api/v1/orgs/${orgId}/api-clients`;

  async function create(json: Record<string, unknown> = { name: 'External website' }): Promise<{ client: ClientJson; clientKey: string }> {
    const response = await app.request('POST', base(), { token, json });
    expect(response.status).toBe(200);
    return (await response.json()) as { client: ClientJson; clientKey: string };
  }

  async function list(): Promise<ClientJson[]> {
    const response = await app.request('GET', base(), { token });
    expect(response.status).toBe(200);
    return ((await response.json()) as { data: ClientJson[] }).data;
  }

  async function expectEmpty(response: Response, status: number): Promise<void> {
    expect(response.status).toBe(status);
    expect(await response.text()).toBe('');
  }

  async function expectNotFound(response: Response): Promise<void> {
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    expect(await response.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 });
  }

  it('requires the Admin policy on every endpoint', async () => {
    const calls: Array<[string, string]> = [
      ['GET', base()],
      ['POST', base()],
      ['POST', `${base()}/${UNKNOWN_ID}/rotate`],
      ['POST', `${base()}/${UNKNOWN_ID}/revoke`],
    ];
    for (const [method, path] of calls) await expectEmpty(await app.request(method, path, method === 'POST' ? { json: {} } : {}), 401);

    const editor = await app.seed.signIn({ roles: ['Editor'] });
    for (const [method, path] of calls) {
      await expectEmpty(await app.request(method, path.replace(organization.id, editor.organization.id), { token: editor.token, ...(method === 'POST' ? { json: {} } : {}) }), 403);
    }

    for (const role of ['owner', 'SuperUser']) {
      const user = await app.seed.signIn({ roles: [role] });
      expect((await app.request('GET', base(user.organization.id), { token: user.token })).status).toBe(200);
    }
  });

  it('creates a client and returns its key once (backend-node e2e)', async () => {
    const response = await app.request('POST', base(organization.id.toUpperCase()), { token, json: { name: '  External website ', scopes: ['content:read'], requestsPerMinute: 5 } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    const text = await response.text();
    expect(text).not.toContain('secretHash');
    const body = JSON.parse(text) as { client: ClientJson; clientKey: string };
    expect(Object.keys(body)).toEqual(['client', 'clientKey']);
    expect(Object.keys(body.client)).toEqual(['id', 'organizationId', 'name', 'keyPrefix', 'scopes', 'requestsPerMinute', 'createdAtUtc', 'lastUsedAtUtc', 'revokedAtUtc']);
    expect(body.client).toMatchObject({ organizationId: organization.id, name: 'External website', scopes: ['content:read'], requestsPerMinute: 5, lastUsedAtUtc: null, revokedAtUtc: null });
    expect(body.client.createdAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(body.clientKey).toMatch(/^iqt_[0-9a-f]{32}_[A-Za-z0-9-][A-Za-z0-9_-]{42}$/);
    expect(body.clientKey.split('_')[1]).toBe(body.client.id.replace(/-/g, ''));
    expect(body.client.keyPrefix).toBe(body.clientKey.slice(0, 18));

    // Only the SHA-256 of the secret is stored.
    const row = await app.db.first<{ SecretHash: string; Scopes: string }>('SELECT "SecretHash", "Scopes" FROM "ApiClients" WHERE "Id" = ?', body.client.id);
    expect(row).toEqual({ SecretHash: hashSecret(body.clientKey.slice('iqt_'.length + 33)), Scopes: '["content:read"]' });
    expect(row?.SecretHash).toMatch(/^[0-9A-F]{64}$/);

    expect((await credentials.validate(body.clientKey, 'content:read', '/public/content/qibla')).isValid).toBe(true);
  });

  it('applies defaults, normalizes scopes and clamps the quota', async () => {
    expect((await create({ name: 'defaults' })).client).toMatchObject({ scopes: ['content:read'], requestsPerMinute: 60 });
    expect((await create({ name: 'null scopes', scopes: null })).client.scopes).toEqual(['content:read']);
    expect((await create({ name: 'scopes', scopes: [' Content:Read ', 'content:read', 'admin:write'] })).client.scopes).toEqual(['content:read']);
    expect((await create({ name: 'no scopes', scopes: [] })).client.scopes).toEqual([]);
    expect((await create({ name: 'low', requestsPerMinute: 0 })).client.requestsPerMinute).toBe(1);
    expect((await create({ name: 'negative', requestsPerMinute: -5 })).client.requestsPerMinute).toBe(1);
    expect((await create({ name: 'high', requestsPerMinute: 99_999 })).client.requestsPerMinute).toBe(10_000);
  });

  it('create: validation and access failures', async () => {
    const other = await app.seed.organization();
    // A missing name is reported before the organization check.
    for (const json of [{}, { name: null }]) {
      const missing = await app.request('POST', base(other.id), { token, json });
      expect(missing.status).toBe(400);
      expect(missing.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      const body = (await missing.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
        title: 'One or more validation errors occurred.',
        status: 400,
        errors: { Name: ['The Name field is required.'] },
      });
      expect(body.traceId).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    }
    await expectEmpty(await app.request('POST', base(other.id), { token, json: { name: 'x' } }), 403);

    const blank = await app.request('POST', base(), { token, json: { name: '   ' } });
    expect(blank.status).toBe(400);
    expect(blank.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await blank.json()).toEqual({ error: 'A client name is required.' });

    const invalid = await app.request('POST', base(), { token, json: { name: 5, scopes: 'content:read', requestsPerMinute: 1.5 } });
    expect(invalid.status).toBe(400);
    const errors = ((await invalid.json()) as { errors: Record<string, string[]> }).errors;
    expect(Object.keys(errors)).toEqual(['Name', 'Scopes', 'RequestsPerMinute']);

    // Body validation precedes the route constraint.
    expect((await app.request('POST', base('not-a-guid'), { token, json: { name: 5 } })).status).toBe(400);
    await expectNotFound(await app.request('POST', base('not-a-guid'), { token, json: { name: 'x' } }));
    expect(await app.db.all('SELECT "Id" FROM "ApiClients"')).toEqual([]);
  });

  it('lists the organization clients by name with the supported scopes', async () => {
    await create({ name: 'Zeta' });
    await create({ name: 'alpha' });
    await create({ name: 'Beta' });
    const stranger = await app.seed.signIn({ roles: ['Admin'] });
    await app.request('POST', base(stranger.organization.id), { token: stranger.token, json: { name: 'Theirs' } });

    const response = await app.request('GET', base(), { token });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('secretHash');
    const body = JSON.parse(text) as { data: ClientJson[]; supportedScopes: string[] };
    expect(Object.keys(body)).toEqual(['data', 'supportedScopes']);
    expect(body.supportedScopes).toEqual(['content:read']);
    expect(body.data.map((client) => client.name)).toEqual(['alpha', 'Beta', 'Zeta']);
    expect(Object.keys(body.data[0])).toEqual(['id', 'organizationId', 'name', 'keyPrefix', 'scopes', 'requestsPerMinute', 'createdAtUtc', 'lastUsedAtUtc', 'revokedAtUtc']);

    await expectEmpty(await app.request('GET', base(stranger.organization.id), { token }), 403);
    await expectNotFound(await app.request('GET', base('not-a-guid'), { token }));
    const superUser = await app.seed.signIn({ roles: ['SuperUser'] });
    const all = (await (await app.request('GET', base(), { token: superUser.token })).json()) as { data: ClientJson[] };
    expect(all.data).toHaveLength(3);
  });

  it('rotate issues a new key and invalidates the old one', async () => {
    const created = await create();
    expect((await credentials.validate(created.clientKey, 'content:read', '/x')).isValid).toBe(true);
    expect((await list())[0].lastUsedAtUtc).not.toBeNull();

    const response = await app.request('POST', `${base()}/${created.client.id.toUpperCase()}/rotate`, { token });
    expect(response.status).toBe(200);
    const rotated = (await response.json()) as { client: ClientJson; clientKey: string };
    expect(Object.keys(rotated)).toEqual(['client', 'clientKey']);
    expect(rotated.clientKey).not.toBe(created.clientKey);
    expect(rotated.client).toMatchObject({ id: created.client.id, name: created.client.name, createdAtUtc: created.client.createdAtUtc, keyPrefix: rotated.clientKey.slice(0, 18), lastUsedAtUtc: null, revokedAtUtc: null });
    expect((await list())[0]).toEqual(rotated.client);

    expect(await credentials.validate(created.clientKey, 'content:read', '/x')).toEqual({ isValid: false, error: 'The API client key is invalid.', client: null });
    expect((await credentials.validate(rotated.clientKey, 'content:read', '/x')).isValid).toBe(true);
  });

  it('revoke is idempotent and blocks the key and further rotation', async () => {
    const created = await create();
    await expectEmpty(await app.request('POST', `${base()}/${created.client.id}/revoke`, { token, json: {} }), 204);
    const revokedAt = (await list())[0].revokedAtUtc;
    expect(revokedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    await expectEmpty(await app.request('POST', `${base()}/${created.client.id}/revoke`, { token }), 204);
    expect((await list())[0].revokedAtUtc).toBe(revokedAt);

    expect(await credentials.validate(created.clientKey, 'content:read', '/x')).toEqual({ isValid: false, error: 'The API client key is revoked or unknown.', client: null });
    await expectNotFound(await app.request('POST', `${base()}/${created.client.id}/rotate`, { token }));
  });

  it('rotate and revoke: 404 for unknown ids and other organizations, 403 without access', async () => {
    const created = await create();
    const stranger = await app.seed.signIn({ roles: ['Admin'] });
    for (const action of ['rotate', 'revoke']) {
      await expectNotFound(await app.request('POST', `${base()}/${UNKNOWN_ID}/${action}`, { token }));
      await expectNotFound(await app.request('POST', `${base()}/not-a-guid/${action}`, { token }));
      await expectNotFound(await app.request('POST', `${base('not-a-guid')}/${created.client.id}/${action}`, { token }));
      // Another organization's admin cannot reach the client through their own organization...
      await expectNotFound(await app.request('POST', `${base(stranger.organization.id)}/${created.client.id}/${action}`, { token: stranger.token }));
      // ...nor through the owner's.
      await expectEmpty(await app.request('POST', `${base()}/${created.client.id}/${action}`, { token: stranger.token }), 403);
    }
    expect((await list())[0]).toEqual(created.client);
    expect((await credentials.validate(created.clientKey, 'content:read', '/x')).isValid).toBe(true);
  });

  describe('credential validation', () => {
    it('accepts the iqt_ and legacy dtc_ prefixes and records the usage', async () => {
      const { client, clientKey } = await create();
      const result = await credentials.validate(clientKey, 'Content:Read', `/public/content/${'q'.repeat(300)}`);
      expect(result.isValid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.client).toMatchObject({ id: client.id, organizationId: organization.id });
      expect(result.client?.lastUsedAtUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      expect((await credentials.validate(`dtc_${clientKey.slice(4)}`, 'content:read', '/legacy')).isValid).toBe(true);
      expect((await credentials.validate(clientKey.replace(/^iqt_[0-9a-f]{32}/, (id) => id.toUpperCase().replace('IQT', 'iqt')), 'content:read', '/upper')).isValid).toBe(true);

      const usage = await app.db.all<{ Endpoint: string; UsedAtUtc: string }>('SELECT "Endpoint", "UsedAtUtc" FROM "ApiClientUsage" WHERE "ApiClientId" = ? ORDER BY "UsedAtUtc", "Endpoint"', client.id);
      expect(usage).toHaveLength(3);
      expect(usage.map((row) => row.Endpoint.length).sort((a, b) => a - b)).toEqual([6, 7, 200]);
      const stored = await app.db.first<{ LastUsedAtUtc: string }>('SELECT "LastUsedAtUtc" FROM "ApiClients" WHERE "Id" = ?', client.id);
      expect(stored?.LastUsedAtUtc).toBe(usage[2].UsedAtUtc);
    });

    it('rejects malformed, unknown, wrong and under-scoped keys without recording usage', async () => {
      const { clientKey, client } = await create();
      const secret = clientKey.slice(37);
      const malformed = { isValid: false, error: 'The API client key is malformed.', client: null };
      for (const key of ['', 'nonsense', 'iqt_123_secret', `abc_${client.id.replace(/-/g, '')}_${secret}`, `iqt_${client.id}_${secret}`, `iqt_${client.id.replace(/-/g, '')}`, `iqt_${client.id.replace(/-/g, '')}_`]) {
        expect(await credentials.validate(key, 'content:read', '/x'), key).toEqual(malformed);
      }
      expect(await credentials.validate(`iqt_${UNKNOWN_ID.replace(/-/g, '')}_${secret}`, 'content:read', '/x')).toEqual({ isValid: false, error: 'The API client key is revoked or unknown.', client: null });
      expect(await credentials.validate(`${clientKey.slice(0, -1)}${clientKey.endsWith('A') ? 'B' : 'A'}`, 'content:read', '/x')).toEqual({ isValid: false, error: 'The API client key is invalid.', client: null });

      const scoped = await credentials.validate(clientKey, 'content:write', '/x');
      expect(scoped).toMatchObject({ isValid: false, error: "The API client does not have the 'content:write' scope." });
      expect(scoped.client?.id).toBe(client.id);

      // The scope is checked before the secret, as in backend-node.
      const noScopes = await create({ name: 'no scopes', scopes: [] });
      expect((await credentials.validate(`${noScopes.clientKey}x`, 'content:read', '/x')).error).toBe("The API client does not have the 'content:read' scope.");

      expect(await app.db.all('SELECT "Id" FROM "ApiClientUsage"')).toEqual([]);
      expect((await list()).every((item) => item.lastUsedAtUtc === null)).toBe(true);
    });

    it('enforces the per-minute quota over the last 60 seconds', async () => {
      const { client, clientKey } = await create({ name: 'limited', requestsPerMinute: 2 });
      expect((await credentials.validate(clientKey, 'content:read', '/1')).isValid).toBe(true);
      expect((await credentials.validate(clientKey, 'content:read', '/2')).isValid).toBe(true);
      const blocked = await credentials.validate(clientKey, 'content:read', '/3');
      expect(blocked).toMatchObject({ isValid: false, error: 'The API client quota has been reached. Try again later.' });
      expect(blocked.client?.id).toBe(client.id);
      expect(await app.db.all('SELECT "Id" FROM "ApiClientUsage"')).toHaveLength(2);

      // Usage older than a minute no longer counts.
      await app.db.run('UPDATE "ApiClientUsage" SET "UsedAtUtc" = ?', new Date(Date.now() - 61_000).toISOString());
      expect((await credentials.validate(clientKey, 'content:read', '/4')).isValid).toBe(true);
    });

    it('splitClientKey mirrors Split("_", 3, RemoveEmptyEntries)', () => {
      expect(splitClientKey('iqt_abc_secret')).toEqual(['iqt', 'abc', 'secret']);
      expect(splitClientKey('iqt_abc_se_cr_et')).toEqual(['iqt', 'abc', 'se_cr_et']);
      expect(splitClientKey('__iqt__abc___secret_')).toEqual(['iqt', 'abc', 'secret_']);
      expect(splitClientKey('iqt_abc')).toEqual(['iqt', 'abc']);
      expect(splitClientKey('iqt_abc_')).toEqual(['iqt', 'abc']);
      expect(splitClientKey('iqt')).toEqual(['iqt']);
      expect(splitClientKey('')).toEqual([]);
    });

    it('clientKeyFromHeaders prefers X-IqamaTime-Client-Key over X-DeenTime-Client-Key', () => {
      expect(clientKeyFromHeaders(new Headers())).toBeNull();
      expect(clientKeyFromHeaders(new Headers({ 'X-IqamaTime-Client-Key': '  ' }))).toBeNull();
      expect(clientKeyFromHeaders(new Headers({ 'X-DeenTime-Client-Key': 'legacy' }))).toBe('legacy');
      expect(clientKeyFromHeaders(new Headers({ 'x-iqamatime-client-key': 'new', 'X-DeenTime-Client-Key': 'legacy' }))).toBe('new');
      expect(clientKeyFromHeaders(new Headers({ 'X-IqamaTime-Client-Key': ' ', 'X-DeenTime-Client-Key': 'legacy' }))).toBe('legacy');
    });
  });
});
