import { Injectable } from '@nestjs/common';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { AppConfig } from '../../config/configuration.js';

/** Claims carried by the IqamaTime session token (same names as the .NET API). */
export interface SessionUser {
  sub: string;
  email: string | null;
  orgId: string | null;
  roles: string[];
  issuer: string | null;
}

/**
 * HS256 tokens compatible with the ones issued by the .NET API: `sub`, `email`,
 * `orgId`, one `role` per role (a string when there is a single role, otherwise
 * an array), issuer/audience from configuration, 12-hour lifetime.
 */
@Injectable()
export class JwtService {
  private readonly key: string;
  readonly issuer: string;
  readonly audience: string;

  constructor(config: AppConfig) {
    const key = config.get('Auth:SigningKey') ?? '';
    if (config.get('Auth:Authority')) {
      throw new Error('Auth:Authority (OpenID Connect) is not supported by the Node API; configure Auth:SigningKey.');
    }
    if (!key) throw new Error('Auth:SigningKey or Auth:Authority must be configured before the API can start.');
    if (Buffer.byteLength(key, 'utf8') < 32) throw new Error('Auth:SigningKey must be at least 32 bytes.');
    this.key = key;
    this.issuer = config.getOrDefault('Auth:Issuer', 'deentime');
    this.audience = config.getOrDefault('Auth:Audience', 'DeenTime.Api');
  }

  issue(user: { id: string; email: string | null }, organizationId: string, roles: string[]): string {
    const payload: Record<string, unknown> = {
      sub: user.id,
      email: user.email ?? '',
      orgId: organizationId,
    };
    if (roles.length === 1) payload.role = roles[0];
    else if (roles.length > 1) payload.role = roles;
    return jwt.sign(payload, this.key, {
      algorithm: 'HS256',
      issuer: this.issuer,
      audience: this.audience,
      expiresIn: '12h',
    });
  }

  /** Returns the session user or null when the token is missing, malformed, expired or unsigned. */
  verify(token: string | undefined | null): SessionUser | null {
    if (!token) return null;
    try {
      const payload = jwt.verify(token, this.key, {
        algorithms: ['HS256'],
        issuer: this.issuer || undefined,
        audience: this.audience || undefined,
        clockTolerance: 300,
      }) as JwtPayload;
      const email = firstString(payload.email);
      const roleClaim = payload.role ?? payload.roles ?? [];
      const roles = (Array.isArray(roleClaim) ? roleClaim : [roleClaim]).filter((role): role is string => typeof role === 'string');
      return {
        sub: typeof payload.sub === 'string' ? payload.sub : '',
        email,
        orgId: typeof payload.orgId === 'string' ? payload.orgId : null,
        roles,
        issuer: typeof payload.iss === 'string' ? payload.iss : null,
      };
    } catch {
      return null;
    }
  }
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  return typeof value === 'string' ? value : null;
}
