import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ApiClient } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { ApiClientCredentialService, splitClientKey } from './api-client-credential.service.js';

interface UsageRow {
  id: string;
  apiClientId: string;
  endpoint: string;
  usedAtUtc: Date;
}

interface FakeDb {
  prisma: PrismaService;
  clients: Map<string, ApiClient>;
  usage: UsageRow[];
}

/** In-memory stand-in for the Prisma model methods the service uses. */
function fakeDb(): FakeDb {
  const clients = new Map<string, ApiClient>();
  const usage: UsageRow[] = [];
  const prisma = {
    apiClient: {
      findUnique: async (args: { where: { id: string } }) => clients.get(args.where.id) ?? null,
      findFirst: async (args: { where: { id: string; organizationId: string } }) =>
        [...clients.values()].find((client) => client.id === args.where.id && client.organizationId === args.where.organizationId) ?? null,
      create: async (args: { data: ApiClient }) => {
        clients.set(args.data.id, { ...args.data });
        return { ...args.data };
      },
      update: async (args: { where: { id: string }; data: Partial<ApiClient> }) => {
        const existing = clients.get(args.where.id);
        if (!existing) throw new Error('missing client');
        const updated = { ...existing, ...args.data };
        clients.set(args.where.id, updated);
        return updated;
      },
    },
    apiClientUsage: {
      count: async (args: { where: { apiClientId: string; usedAtUtc: { gte: Date } } }) =>
        usage.filter((row) => row.apiClientId === args.where.apiClientId && row.usedAtUtc >= args.where.usedAtUtc.gte).length,
      create: async (args: { data: UsageRow }) => {
        usage.push(args.data);
        return args.data;
      },
    },
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  return { prisma: prisma as unknown as PrismaService, clients, usage };
}

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const OTHER_ORG = '9b2b4c2e-2a1d-4a3e-9f4e-0a1b2c3d4e5f';

function sha256Upper(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

describe('ApiClientCredentialService.create', () => {
  it('issues iqt_ keys, stores only the hash and normalizes the request', async () => {
    const db = fakeDb();
    const service = new ApiClientCredentialService(db.prisma);

    const { client, clientKey } = await service.create(ORG, '  External website  ', [' Content:Read ', 'content:read', 'admin:write'], 50_000);

    expect(clientKey).toMatch(/^iqt_[0-9a-f]{32}_[A-Za-z0-9_-]{43}$/);
    const [, idPart, secret] = splitClientKey(clientKey);
    expect(client.id.replace(/-/g, '')).toBe(idPart);
    expect(client.keyPrefix).toBe(clientKey.slice(0, 18));
    expect(client.secretHash).toBe(sha256Upper(secret ?? ''));
    expect(client.scopes).toEqual(['content:read']);
    expect(client.requestsPerMinute).toBe(10_000);
    expect(client.name).toBe('External website');
    expect(client.organizationId).toBe(ORG);
    expect(client.lastUsedAtUtc).toBeNull();
    expect(client.revokedAtUtc).toBeNull();
    expect(client.createdAtUtc).toBeInstanceOf(Date);
    expect(db.clients.size).toBe(1);
  });

  it('clamps the quota to at least one request per minute', async () => {
    const service = new ApiClientCredentialService(fakeDb().prisma);
    const { client } = await service.create(ORG, 'site', ['content:read'], 0);
    expect(client.requestsPerMinute).toBe(1);
    expect(ApiClientCredentialService.supportedScopes).toEqual(['content:read']);
  });
});

describe('ApiClientCredentialService.validate', () => {
  it('accepts a valid key, records usage and updates lastUsedAtUtc', async () => {
    const db = fakeDb();
    const service = new ApiClientCredentialService(db.prisma);
    const { client, clientKey } = await service.create(ORG, 'site', ['content:read'], 60);

    const endpoint = '/public/content/' + 'x'.repeat(300);
    const result = await service.validate(clientKey, 'content:read', endpoint);

    expect(result.isValid).toBe(true);
    expect(result.error).toBeNull();
    expect(result.client?.id).toBe(client.id);
    expect(result.client?.lastUsedAtUtc).toBeInstanceOf(Date);
    expect(db.usage).toHaveLength(1);
    expect(db.usage[0]?.apiClientId).toBe(client.id);
    expect(db.usage[0]?.endpoint).toBe(endpoint.slice(0, 200));
    expect(db.usage[0]?.endpoint).toHaveLength(200);
  });

  it('accepts the legacy dtc_ prefix and matches scopes case-insensitively', async () => {
    const service = new ApiClientCredentialService(fakeDb().prisma);
    const { clientKey } = await service.create(ORG, 'site', ['content:read'], 60);
    const legacy = clientKey.replace(/^iqt_/, 'dtc_');
    await expect(service.validate(legacy, 'CONTENT:READ', '/x')).resolves.toMatchObject({ isValid: true });
  });

  it.each(['', 'nonsense', 'iqt_notaguid_secret', 'iqt_3f2504e04f8911d39a0c0305e82c3301', 'abc_3f2504e04f8911d39a0c0305e82c3301_secret', 'iqt_3f2504e04f8911d39a0c0305e82c3301_'])(
    'reports malformed keys (%j)',
    async (key) => {
      const service = new ApiClientCredentialService(fakeDb().prisma);
      await expect(service.validate(key, 'content:read', '/x')).resolves.toEqual({ isValid: false, error: 'The API client key is malformed.', client: null });
    },
  );

  it('reports unknown, revoked, unscoped and forged keys with the .NET messages', async () => {
    const db = fakeDb();
    const service = new ApiClientCredentialService(db.prisma);

    await expect(service.validate('iqt_3f2504e04f8911d39a0c0305e82c3301_secret', 'content:read', '/x')).resolves.toEqual({
      isValid: false,
      error: 'The API client key is revoked or unknown.',
      client: null,
    });

    const unscoped = await service.create(ORG, 'unscoped', [], 60);
    await expect(service.validate(unscoped.clientKey, 'content:read', '/x')).resolves.toMatchObject({
      isValid: false,
      error: "The API client does not have the 'content:read' scope.",
      client: { id: unscoped.client.id },
    });

    const scoped = await service.create(ORG, 'scoped', ['content:read'], 60);
    const forged = scoped.clientKey.slice(0, -4) + 'AAAA';
    await expect(service.validate(forged, 'content:read', '/x')).resolves.toEqual({ isValid: false, error: 'The API client key is invalid.', client: null });

    await service.revoke(ORG, scoped.client.id);
    await expect(service.validate(scoped.clientKey, 'content:read', '/x')).resolves.toEqual({
      isValid: false,
      error: 'The API client key is revoked or unknown.',
      client: null,
    });
    expect(db.usage).toHaveLength(0);
  });

  it('enforces the per-minute quota from recorded usage', async () => {
    const db = fakeDb();
    const service = new ApiClientCredentialService(db.prisma);
    const { client, clientKey } = await service.create(ORG, 'metered', ['content:read'], 2);

    await expect(service.validate(clientKey, 'content:read', '/a')).resolves.toMatchObject({ isValid: true });
    await expect(service.validate(clientKey, 'content:read', '/b')).resolves.toMatchObject({ isValid: true });
    await expect(service.validate(clientKey, 'content:read', '/c')).resolves.toMatchObject({
      isValid: false,
      error: 'The API client quota has been reached. Try again later.',
      client: { id: client.id },
    });
    expect(db.usage).toHaveLength(2);

    // Usage older than a minute no longer counts.
    for (const row of db.usage) row.usedAtUtc = new Date(Date.now() - 61_000);
    await expect(service.validate(clientKey, 'content:read', '/d')).resolves.toMatchObject({ isValid: true });
  });
});

describe('ApiClientCredentialService.rotate / revoke', () => {
  it('rotates the secret, invalidating the previous key', async () => {
    const service = new ApiClientCredentialService(fakeDb().prisma);
    const { client, clientKey } = await service.create(ORG, 'site', ['content:read'], 60);
    await service.validate(clientKey, 'content:read', '/x');

    const rotated = await service.rotate(ORG, client.id);

    expect(rotated).not.toBeNull();
    expect(rotated?.clientKey).not.toBe(clientKey);
    expect(rotated?.clientKey.startsWith(`iqt_${client.id.replace(/-/g, '')}_`)).toBe(true);
    expect(rotated?.client.keyPrefix).toBe(rotated?.clientKey.slice(0, 18));
    expect(rotated?.client.lastUsedAtUtc).toBeNull();
    await expect(service.validate(clientKey, 'content:read', '/x')).resolves.toMatchObject({ isValid: false, error: 'The API client key is invalid.' });
    await expect(service.validate(rotated?.clientKey ?? '', 'content:read', '/x')).resolves.toMatchObject({ isValid: true });
  });

  it('refuses to rotate revoked, foreign or unknown clients', async () => {
    const service = new ApiClientCredentialService(fakeDb().prisma);
    const { client } = await service.create(ORG, 'site', ['content:read'], 60);
    await expect(service.rotate(OTHER_ORG, client.id)).resolves.toBeNull();
    await expect(service.rotate(ORG, '00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
    await service.revoke(ORG, client.id);
    await expect(service.rotate(ORG, client.id)).resolves.toBeNull();
  });

  it('revokes idempotently and only within the organization', async () => {
    const db = fakeDb();
    const service = new ApiClientCredentialService(db.prisma);
    const { client } = await service.create(ORG, 'site', ['content:read'], 60);

    await expect(service.revoke(OTHER_ORG, client.id)).resolves.toBe(false);
    await expect(service.revoke(ORG, client.id)).resolves.toBe(true);
    const revokedAt = db.clients.get(client.id)?.revokedAtUtc;
    expect(revokedAt).toBeInstanceOf(Date);
    await expect(service.revoke(ORG, client.id)).resolves.toBe(true);
    expect(db.clients.get(client.id)?.revokedAtUtc).toBe(revokedAt);
  });
});

describe('splitClientKey', () => {
  it('mirrors String.Split with a count of three and RemoveEmptyEntries', () => {
    expect(splitClientKey('iqt_abc_def_ghi')).toEqual(['iqt', 'abc', 'def_ghi']);
    expect(splitClientKey('iqt__abc__def')).toEqual(['iqt', 'abc', 'def']);
    expect(splitClientKey('iqt_abc_')).toEqual(['iqt', 'abc']);
    expect(splitClientKey('_iqt_abc_def')).toEqual(['iqt', 'abc', 'def']);
    expect(splitClientKey('nonsense')).toEqual(['nonsense']);
    expect(splitClientKey('')).toEqual([]);
  });
});
