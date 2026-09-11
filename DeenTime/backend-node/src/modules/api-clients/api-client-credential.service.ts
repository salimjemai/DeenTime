import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { ApiClient } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';

export interface CreatedApiClient {
  client: ApiClient;
  clientKey: string;
}

export interface ApiClientValidation {
  isValid: boolean;
  error: string | null;
  client: ApiClient | null;
}

const KEY_PREFIX_LENGTH = 18;
const GUID_N_PATTERN = /^[0-9a-fA-F]{32}$/;

/** SHA-256 of the UTF-8 secret as upper-case hex (Convert.ToHexString). */
function hashSecret(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').toUpperCase();
}

/** 32 random bytes as unpadded base64url (Base64Url helper). */
function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

function buildKey(clientId: string, secret: string): string {
  return `iqt_${clientId.replace(/-/g, '')}_${secret}`;
}

/** Guid "N" text → canonical dashed lower-case form. */
function guidFromN(value: string): string {
  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * rawKey.Split('_', 3, StringSplitOptions.RemoveEmptyEntries): up to two non-empty
 * leading pieces, then the remainder with its leading separators removed.
 */
export function splitClientKey(rawKey: string): string[] {
  const parts: string[] = [];
  let rest = rawKey;
  while (parts.length < 2) {
    const separator = rest.indexOf('_');
    if (separator < 0) break;
    const piece = rest.slice(0, separator);
    rest = rest.slice(separator + 1);
    if (piece.length > 0) parts.push(piece);
  }
  if (parts.length === 2) rest = rest.replace(/^_+/, '');
  if (rest.length > 0) parts.push(rest);
  return parts;
}

function normalizeScopes(scopes: Iterable<string>): string[] {
  const supported = new Set(ApiClientCredentialService.supportedScopes.map((scope) => scope.toLowerCase()));
  const result: string[] = [];
  for (const scope of scopes) {
    const normalized = scope.trim().toLowerCase();
    if (supported.has(normalized) && !result.includes(normalized)) result.push(normalized);
  }
  return result;
}

/**
 * ApiClientCredentialService: issues, rotates, revokes and validates the
 * `iqt_{clientId:N}_{secret}` keys used by masjid websites against the public
 * content API. Only the SHA-256 of the secret is stored.
 */
@Injectable()
export class ApiClientCredentialService {
  static readonly supportedScopes: readonly string[] = ['content:read'];

  constructor(private readonly prisma: PrismaService) {}

  async create(organizationId: string, name: string, scopes: Iterable<string>, requestsPerMinute: number): Promise<CreatedApiClient> {
    const id = randomUUID();
    const secret = newSecret();
    const key = buildKey(id, secret);
    const client = await this.insertClient({
      id,
      organizationId,
      name: name.trim(),
      keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
      secretHash: hashSecret(secret),
      scopes: normalizeScopes(scopes),
      requestsPerMinute: Math.min(10_000, Math.max(1, Math.trunc(requestsPerMinute))),
      createdAtUtc: new Date(),
      lastUsedAtUtc: null,
      revokedAtUtc: null,
    });
    return { client, clientKey: key };
  }

  /** Issues a new secret for an active client; null when the client is missing or revoked. */
  async rotate(organizationId: string, clientId: string): Promise<CreatedApiClient | null> {
    const client = await this.findOrganizationClient(organizationId, clientId);
    if (client === null || client.revokedAtUtc !== null) return null;

    const secret = newSecret();
    const key = buildKey(client.id, secret);
    const updated = await this.updateClient(client.id, { keyPrefix: key.slice(0, KEY_PREFIX_LENGTH), secretHash: hashSecret(secret), lastUsedAtUtc: null });
    return { client: updated, clientKey: key };
  }

  /** Marks the client revoked (idempotent); false when it does not belong to the organization. */
  async revoke(organizationId: string, clientId: string): Promise<boolean> {
    const client = await this.findOrganizationClient(organizationId, clientId);
    if (client === null) return false;
    if (client.revokedAtUtc === null) await this.updateClient(client.id, { revokedAtUtc: new Date() });
    return true;
  }

  /**
   * Validates a raw key for `requiredScope`, enforces the per-minute quota and, on
   * success, records the usage (endpoint truncated to 200 characters).
   */
  async validate(rawKey: string, requiredScope: string, endpoint: string): Promise<ApiClientValidation> {
    const parts = splitClientKey(rawKey);
    const prefix = parts[0];
    const idText = parts[1];
    const secret = parts[2];
    if (parts.length !== 3 || (prefix !== 'iqt' && prefix !== 'dtc') || idText === undefined || secret === undefined || !GUID_N_PATTERN.test(idText)) {
      return { isValid: false, error: 'The API client key is malformed.', client: null };
    }

    const client = await this.findClient(guidFromN(idText));
    if (client === null || client.revokedAtUtc !== null) return { isValid: false, error: 'The API client key is revoked or unknown.', client: null };
    if (!client.scopes.some((scope) => scope.toLowerCase() === requiredScope.toLowerCase())) {
      return { isValid: false, error: `The API client does not have the '${requiredScope}' scope.`, client };
    }

    const expected = Buffer.from(client.secretHash, 'hex');
    const actual = Buffer.from(hashSecret(secret), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return { isValid: false, error: 'The API client key is invalid.', client: null };
    }

    const now = new Date();
    const used = await this.countUsageSince(client.id, new Date(now.getTime() - 60_000));
    if (used >= client.requestsPerMinute) return { isValid: false, error: 'The API client quota has been reached. Try again later.', client };

    const updated = await this.recordUsage(client.id, endpoint.length > 200 ? endpoint.slice(0, 200) : endpoint, now);
    return { isValid: true, error: null, client: updated };
  }

  // Data access is isolated in these small methods so tests can fake the PrismaService.

  private findClient(id: string): Promise<ApiClient | null> {
    return this.prisma.apiClient.findUnique({ where: { id } });
  }

  private findOrganizationClient(organizationId: string, clientId: string): Promise<ApiClient | null> {
    return this.prisma.apiClient.findFirst({ where: { id: clientId, organizationId } });
  }

  private insertClient(client: ApiClient): Promise<ApiClient> {
    return this.prisma.apiClient.create({ data: client });
  }

  private updateClient(id: string, data: Partial<Pick<ApiClient, 'keyPrefix' | 'secretHash' | 'lastUsedAtUtc' | 'revokedAtUtc'>>): Promise<ApiClient> {
    return this.prisma.apiClient.update({ where: { id }, data });
  }

  private countUsageSince(clientId: string, since: Date): Promise<number> {
    return this.prisma.apiClientUsage.count({ where: { apiClientId: clientId, usedAtUtc: { gte: since } } });
  }

  private async recordUsage(clientId: string, endpoint: string, usedAtUtc: Date): Promise<ApiClient> {
    const [updated] = await this.prisma.$transaction([
      this.prisma.apiClient.update({ where: { id: clientId }, data: { lastUsedAtUtc: usedAtUtc } }),
      this.prisma.apiClientUsage.create({ data: { id: randomUUID(), apiClientId: clientId, endpoint, usedAtUtc } }),
    ]);
    return updated;
  }
}
