import type { AppConfig } from './config.js';
import { base64ToBytes, bytesToBase64Url, fromUtf8, utf8 } from './encoding.js';

/** Claims carried by the MasjidHub session token (same names as backend-node and the .NET API). */
export interface SessionUser {
  sub: string;
  email: string | null;
  orgId: string | null;
  roles: string[];
  issuer: string | null;
}

const LIFETIME_SECONDS = 12 * 60 * 60;
const CLOCK_TOLERANCE_SECONDS = 300;
/** base64url of {"alg":"HS256","typ":"JWT"}, the header jsonwebtoken writes. */
const HEADER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';

/**
 * HS256 tokens interchangeable with the ones backend-node issues through jsonwebtoken:
 * `sub`, `email`, `orgId`, one `role` per role (a string when there is a single role,
 * otherwise an array), then `iat`, `exp`, `aud`, `iss`; 12-hour lifetime, 300 s tolerance.
 */
export class JwtService {
  readonly issuer: string;
  readonly audience: string;
  private readonly keyBytes: Uint8Array;
  private key: Promise<CryptoKey> | null = null;

  constructor(config: AppConfig) {
    const key = config.get('Auth:SigningKey') ?? '';
    if (config.get('Auth:Authority')) {
      throw new Error('Auth:Authority (OpenID Connect) is not supported; configure Auth:SigningKey.');
    }
    if (!key) throw new Error('Auth:SigningKey must be configured before the API can serve requests.');
    this.keyBytes = utf8(key);
    if (this.keyBytes.length < 32) throw new Error('Auth:SigningKey must be at least 32 bytes.');
    this.issuer = config.getOrDefault('Auth:Issuer', 'deentime');
    this.audience = config.getOrDefault('Auth:Audience', 'DeenTime.Api');
  }

  async issue(user: { id: string; email: string | null }, organizationId: string, roles: string[], nowMs: number = Date.now()): Promise<string> {
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email ?? '',
      orgId: organizationId,
    };
    if (roles.length === 1) payload.role = roles[0];
    else if (roles.length > 1) payload.role = roles;
    const iat = Math.floor(nowMs / 1000);
    payload.iat = iat;
    payload.exp = iat + LIFETIME_SECONDS;
    payload.aud = this.audience;
    payload.iss = this.issuer;
    const signingInput = `${HEADER}.${bytesToBase64Url(utf8(JSON.stringify(payload)))}`;
    const signature = await crypto.subtle.sign('HMAC', await this.cryptoKey(), utf8(signingInput));
    return `${signingInput}.${bytesToBase64Url(new Uint8Array(signature))}`;
  }

  /** Returns the session user or null when the token is missing, malformed, expired or not signed with our key. */
  async verify(token: string | undefined | null, nowMs: number = Date.now()): Promise<SessionUser | null> {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3 || !parts[2]) return null;
      const header = JSON.parse(fromUtf8(base64ToBytes(parts[0]))) as { alg?: unknown } | null;
      if (!header || typeof header !== 'object' || header.alg !== 'HS256') return null;
      const valid = await crypto.subtle.verify('HMAC', await this.cryptoKey(), base64ToBytes(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
      if (!valid) return null;
      const payload = JSON.parse(fromUtf8(base64ToBytes(parts[1]))) as Record<string, unknown> | null;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

      const clock = Math.floor(nowMs / 1000);
      if (payload.nbf !== undefined) {
        if (typeof payload.nbf !== 'number' || payload.nbf > clock + CLOCK_TOLERANCE_SECONDS) return null;
      }
      if (payload.exp !== undefined) {
        if (typeof payload.exp !== 'number' || clock >= payload.exp + CLOCK_TOLERANCE_SECONDS) return null;
      }
      const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audiences.includes(this.audience)) return null;
      if (payload.iss !== this.issuer) return null;

      const roleClaim = payload.role ?? payload.roles ?? [];
      const roles = (Array.isArray(roleClaim) ? roleClaim : [roleClaim]).filter((role): role is string => typeof role === 'string');
      return {
        sub: typeof payload.sub === 'string' ? payload.sub : '',
        email: firstString(payload.email),
        orgId: typeof payload.orgId === 'string' ? payload.orgId : null,
        roles,
        issuer: typeof payload.iss === 'string' ? payload.iss : null,
      };
    } catch {
      return null;
    }
  }

  private cryptoKey(): Promise<CryptoKey> {
    this.key ??= crypto.subtle.importKey('raw', this.keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    return this.key;
  }
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  return typeof value === 'string' ? value : null;
}
