/**
 * Who is calling: the masjid API never stores passwords. Sign-up and sign-in happen in
 * the shared Jemai Innovations auth service (also used by Mushaf+). A request carries
 * that service's bearer token, and we ask the service who it belongs to.
 *
 * Contract (confirmed with the Mushaf+ backend, see docs/shared-auth-contract.md):
 * GET {AUTH_API_BASE}{AUTH_ME_PATH} with the same Authorization header answers
 * 200 {"user": {"id", "email", "displayName", "createdAt"}} or 401 (unauthorized /
 * session_expired). We never read or write the shared users or sessions tables.
 */

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface AuthEnv {
  AUTH_API_BASE?: string;
  AUTH_ME_PATH?: string;
  /** Optional service binding to the shared auth Worker (faster than a public fetch). */
  AUTH?: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
}

export type AuthVerifier = (request: Request) => Promise<AuthUser | null>;

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { user: AuthUser | null; expires: number }>();

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/** Reads the user from the shared service's "me" response, accepting {user:{…}} or a bare user. */
export function parseUser(body: unknown): AuthUser | null {
  if (!body || typeof body !== 'object') return null;
  const source = ('user' in body && body.user && typeof body.user === 'object' ? body.user : body) as Record<string, unknown>;
  const id = source['id'] ?? source['userId'] ?? source['sub'];
  if (typeof id !== 'string' || !id.trim()) return null;
  const email = typeof source['email'] === 'string' ? source['email'] : '';
  const displayName = typeof source['displayName'] === 'string' ? source['displayName'] : typeof source['name'] === 'string' ? source['name'] : email;
  return { id, email, displayName };
}

export function sharedAuthVerifier(env: AuthEnv): AuthVerifier {
  const base = (env.AUTH_API_BASE ?? 'https://api.jemaiinnovations.com').replace(/\/+$/, '');
  const path = env.AUTH_ME_PATH ?? '/v1/auth/me';
  return async (request) => {
    const token = bearerToken(request);
    if (!token) return null;
    const now = Date.now();
    const cached = cache.get(token);
    if (cached && cached.expires > now) return cached.user;

    const meRequest = new Request(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    const response = env.AUTH ? await env.AUTH.fetch(meRequest) : await fetch(meRequest);
    if (response.status === 401 || response.status === 403) {
      cache.set(token, { user: null, expires: now + CACHE_TTL_MS });
      return null;
    }
    if (!response.ok) throw new AuthUnavailableError(response.status);
    const user = parseUser(await response.json());
    cache.set(token, { user, expires: now + CACHE_TTL_MS });
    if (cache.size > 5_000) cache.clear();
    return user;
  };
}

export class AuthUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`The sign-in service answered ${status}.`);
  }
}
