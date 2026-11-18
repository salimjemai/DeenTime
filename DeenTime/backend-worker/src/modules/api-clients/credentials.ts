import { db, type Ctx } from '../../core/context.js';
import { fromJsonArray, newId, normalizeId, toJsonArray, type Db } from '../../core/db.js';
import { bytesToBase64Url, randomBytes, timingSafeEqual, utf8 } from '../../core/encoding.js';
import { sha256, toHex } from '../../core/sha256.js';

/**
 * Port of backend-node/src/modules/api-clients/api-client-credential.service.ts: issues,
 * rotates, revokes and validates the `iqt_{clientId:N}_{secret}` keys used by masjid
 * websites against the public content API. Only the SHA-256 of the secret is stored.
 */

/** An ApiClients row in backend-node's (Prisma) shape; timestamps are the stored ISO strings. */
export interface ApiClient {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  secretHash: string;
  scopes: string[];
  requestsPerMinute: number;
  createdAtUtc: string;
  lastUsedAtUtc: string | null;
  revokedAtUtc: string | null;
}

export interface CreatedApiClient {
  client: ApiClient;
  clientKey: string;
}

export interface ApiClientValidation {
  isValid: boolean;
  error: string | null;
  client: ApiClient | null;
}

export const CLIENT_KEY_HEADER = 'X-IqamaTime-Client-Key';
export const LEGACY_CLIENT_KEY_HEADER = 'X-DeenTime-Client-Key';

const KEY_PREFIX_LENGTH = 18;
const GUID_N_PATTERN = /^[0-9a-fA-F]{32}$/;
const API_CLIENT_COLUMNS = '"Id", "OrganizationId", "Name", "KeyPrefix", "SecretHash", "Scopes", "RequestsPerMinute", "CreatedAtUtc", "LastUsedAtUtc", "RevokedAtUtc"';

interface ApiClientRow {
  Id: string;
  OrganizationId: string;
  Name: string;
  KeyPrefix: string;
  SecretHash: string;
  Scopes: string | null;
  RequestsPerMinute: number;
  CreatedAtUtc: string;
  LastUsedAtUtc: string | null;
  RevokedAtUtc: string | null;
}

function fromRow(row: ApiClientRow): ApiClient {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    name: row.Name,
    keyPrefix: row.KeyPrefix,
    secretHash: row.SecretHash,
    scopes: fromJsonArray(row.Scopes),
    requestsPerMinute: row.RequestsPerMinute,
    createdAtUtc: row.CreatedAtUtc,
    lastUsedAtUtc: row.LastUsedAtUtc ?? null,
    revokedAtUtc: row.RevokedAtUtc ?? null,
  };
}

/** SHA-256 of the UTF-8 secret as upper-case hex (Convert.ToHexString). */
export function hashSecret(value: string): string {
  return toHex(sha256(utf8(value))).toUpperCase();
}

/** 32 random bytes as unpadded base64url (Base64Url helper). */
function newSecret(): string {
  // A secret starting with "_" would be stripped by the Split('_', 3, RemoveEmptyEntries)
  // parsing on both APIs and could never validate, so such secrets are never issued.
  for (;;) {
    const secret = bytesToBase64Url(randomBytes(32));
    if (!secret.startsWith('_')) return secret;
  }
}

function buildKey(clientId: string, secret: string): string {
  return `iqt_${clientId.replace(/-/g, '')}_${secret}`;
}

/** Guid "N" text → canonical dashed lower-case form. */
function guidFromN(value: string): string {
  const hex = value.toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Hex text → bytes; null when it is not an even-length hex string. */
function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
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

export class ApiClientCredentialService {
  static readonly supportedScopes: readonly string[] = ['content:read'];

  constructor(private readonly db: Db) {}

  async create(organizationId: string, name: string, scopes: Iterable<string>, requestsPerMinute: number): Promise<CreatedApiClient> {
    const id = newId();
    const secret = newSecret();
    const key = buildKey(id, secret);
    const client: ApiClient = {
      id,
      organizationId: normalizeId(organizationId),
      name: name.trim(),
      keyPrefix: key.slice(0, KEY_PREFIX_LENGTH),
      secretHash: hashSecret(secret),
      scopes: normalizeScopes(scopes),
      requestsPerMinute: Math.min(10_000, Math.max(1, Math.trunc(requestsPerMinute))),
      createdAtUtc: new Date().toISOString(),
      lastUsedAtUtc: null,
      revokedAtUtc: null,
    };
    await this.db.run(
      `INSERT INTO "ApiClients" (${API_CLIENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      client.id,
      client.organizationId,
      client.name,
      client.keyPrefix,
      client.secretHash,
      toJsonArray(client.scopes),
      client.requestsPerMinute,
      client.createdAtUtc,
      client.lastUsedAtUtc,
      client.revokedAtUtc,
    );
    return { client, clientKey: key };
  }

  /** Issues a new secret for an active client; null when the client is missing or revoked. */
  async rotate(organizationId: string, clientId: string): Promise<CreatedApiClient | null> {
    const client = await this.findOrganizationClient(organizationId, clientId);
    if (client === null || client.revokedAtUtc !== null) return null;

    const secret = newSecret();
    const key = buildKey(client.id, secret);
    const updated: ApiClient = { ...client, keyPrefix: key.slice(0, KEY_PREFIX_LENGTH), secretHash: hashSecret(secret), lastUsedAtUtc: null };
    await this.db.run('UPDATE "ApiClients" SET "KeyPrefix" = ?, "SecretHash" = ?, "LastUsedAtUtc" = NULL WHERE "Id" = ?', updated.keyPrefix, updated.secretHash, client.id);
    return { client: updated, clientKey: key };
  }

  /** Marks the client revoked (idempotent); false when it does not belong to the organization. */
  async revoke(organizationId: string, clientId: string): Promise<boolean> {
    const client = await this.findOrganizationClient(organizationId, clientId);
    if (client === null) return false;
    if (client.revokedAtUtc === null) await this.db.run('UPDATE "ApiClients" SET "RevokedAtUtc" = ? WHERE "Id" = ?', new Date().toISOString(), client.id);
    return true;
  }

  /**
   * Validates a raw key for `requiredScope`, enforces the per-minute quota and, on
   * success, records the usage (endpoint truncated to 200 characters).
   * D1 cost: one read (client + usage count) and, on success, one write batch.
   */
  async validate(rawKey: string, requiredScope: string, endpoint: string): Promise<ApiClientValidation> {
    const parts = splitClientKey(rawKey);
    const prefix = parts[0];
    const idText = parts[1];
    const secret = parts[2];
    if (parts.length !== 3 || (prefix !== 'iqt' && prefix !== 'dtc') || idText === undefined || secret === undefined || !GUID_N_PATTERN.test(idText)) {
      return { isValid: false, error: 'The API client key is malformed.', client: null };
    }

    const now = new Date();
    const row = await this.db.first<ApiClientRow & { UsedLastMinute: number }>(
      `SELECT ${API_CLIENT_COLUMNS},
              (SELECT COUNT(*) FROM "ApiClientUsage" WHERE "ApiClientId" = "ApiClients"."Id" AND "UsedAtUtc" >= ?) AS "UsedLastMinute"
         FROM "ApiClients" WHERE "Id" = ?`,
      new Date(now.getTime() - 60_000).toISOString(),
      guidFromN(idText),
    );
    const client = row ? fromRow(row) : null;
    if (row === null || client === null || client.revokedAtUtc !== null) return { isValid: false, error: 'The API client key is revoked or unknown.', client: null };
    if (!client.scopes.some((scope) => scope.toLowerCase() === requiredScope.toLowerCase())) {
      return { isValid: false, error: `The API client does not have the '${requiredScope}' scope.`, client };
    }

    const expected = hexToBytes(client.secretHash);
    const actual = hexToBytes(hashSecret(secret));
    if (expected === null || actual === null || !timingSafeEqual(expected, actual)) {
      return { isValid: false, error: 'The API client key is invalid.', client: null };
    }

    if (row.UsedLastMinute >= client.requestsPerMinute) return { isValid: false, error: 'The API client quota has been reached. Try again later.', client };

    const usedAtUtc = now.toISOString();
    await this.db.batch([
      this.db.stmt('UPDATE "ApiClients" SET "LastUsedAtUtc" = ? WHERE "Id" = ?', usedAtUtc, client.id),
      this.db.stmt('INSERT INTO "ApiClientUsage" ("Id", "ApiClientId", "Endpoint", "UsedAtUtc") VALUES (?, ?, ?, ?)', newId(), client.id, endpoint.length > 200 ? endpoint.slice(0, 200) : endpoint, usedAtUtc),
    ]);
    return { isValid: true, error: null, client: { ...client, lastUsedAtUtc: usedAtUtc } };
  }

  private async findOrganizationClient(organizationId: string, clientId: string): Promise<ApiClient | null> {
    const row = await this.db.first<ApiClientRow>(`SELECT ${API_CLIENT_COLUMNS} FROM "ApiClients" WHERE "Id" = ? AND "OrganizationId" = ?`, normalizeId(clientId), normalizeId(organizationId));
    return row ? fromRow(row) : null;
  }
}

/** The credential service of this request (`this.credentials` in backend-node's controllers). */
export function apiClientCredentials(c: Ctx): ApiClientCredentialService {
  return new ApiClientCredentialService(db(c));
}

/** The client key a request carries: X-IqamaTime-Client-Key, else the legacy X-DeenTime-Client-Key; null when neither is set. */
export function clientKeyFromHeaders(headers: Headers): string | null {
  let key = headers.get(CLIENT_KEY_HEADER);
  if (!key?.trim()) key = headers.get(LEGACY_CLIENT_KEY_HEADER);
  return key?.trim() ? key : null;
}

/**
 * Validates the client key of an incoming request for `requiredScope` and records the
 * usage: `credentials.validate(key, requiredScope, request.path)` with the key taken
 * from the request headers. Returns null when the request carries no client key (the
 * caller answers with its own "key required" 401); otherwise the validation result.
 * `endpoint` defaults to the request path.
 */
export async function validateClientKey(c: Ctx, requiredScope: string, endpoint: string = new URL(c.req.url).pathname): Promise<ApiClientValidation | null> {
  const key = clientKeyFromHeaders(c.req.raw.headers);
  if (key === null) return null;
  return apiClientCredentials(c).validate(key, requiredScope, endpoint);
}
