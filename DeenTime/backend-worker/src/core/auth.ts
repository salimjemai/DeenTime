import { currentUser, type Ctx, type Middleware } from './context.js';
import { JsonResponseException } from './errors.js';
import type { SessionUser } from './jwt.js';

export type { SessionUser } from './jwt.js';
export type AuthorizationPolicy = 'Admin' | 'SuperUser';

export function hasRole(user: SessionUser | null | undefined, ...roles: string[]): boolean {
  if (!user) return false;
  return user.roles.some((role) => roles.some((candidate) => candidate.toLowerCase() === role.toLowerCase()));
}

export function isSuperUser(user: SessionUser | null | undefined): boolean {
  return hasRole(user, 'SuperUser');
}

/** SuperUser, or the token's orgId claim matches. */
export function canAccessOrganization(user: SessionUser | null | undefined, organizationId: string): boolean {
  if (!user) return false;
  if (isSuperUser(user)) return true;
  return !!user.orgId && user.orgId.toLowerCase() === organizationId.toLowerCase();
}

/** The "Admin" authorization policy: any of Admin, admin, owner, SuperUser. */
export function satisfiesAdminPolicy(user: SessionUser | null | undefined): boolean {
  return hasRole(user, 'Admin', 'admin', 'owner', 'SuperUser');
}

/** The session user of an authorized route; 401 with an empty body when there is none. */
export function requireUser(c: Ctx): SessionUser {
  const user = currentUser(c);
  if (!user) throw new JsonResponseException(401, '');
  return user;
}

/**
 * Route middleware equivalent to backend-node's @Authorize():
 *   authorize()             any valid session token
 *   authorize('Admin')      the Admin policy (Admin, admin, owner or SuperUser)
 *   authorize('SuperUser')  the SuperUser role
 * A missing/invalid token is 401 and a failed policy is 403, both with an empty body.
 * List several to AND them (controller-level + handler-level requirements).
 */
export function authorize(policy?: AuthorizationPolicy): Middleware {
  return async (c, next) => {
    const user = requireUser(c);
    if (policy === 'Admin' && !satisfiesAdminPolicy(user)) throw new JsonResponseException(403, '');
    if (policy === 'SuperUser' && !isSuperUser(user)) throw new JsonResponseException(403, '');
    await next();
  };
}

/** Equivalent to @AuthorizeRoles('Admin', 'Editor'): the user must hold one of the roles. */
export function authorizeRoles(...roles: string[]): Middleware {
  return async (c, next) => {
    const user = requireUser(c);
    if (roles.length && !hasRole(user, ...roles)) throw new JsonResponseException(403, '');
    await next();
  };
}
