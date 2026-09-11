import type { Request } from 'express';
import type { SessionUser } from './jwt.service.js';

export type AuthenticatedRequest = Request & { user?: SessionUser | null; correlationId?: string };

export function hasRole(user: SessionUser | null | undefined, ...roles: string[]): boolean {
  if (!user) return false;
  return user.roles.some((role) => roles.some((candidate) => candidate.toLowerCase() === role.toLowerCase()));
}

export function isSuperUser(user: SessionUser | null | undefined): boolean {
  return hasRole(user, 'SuperUser');
}

/** ClaimsPrincipalExtensions.CanAccessOrganization: SuperUser, or the token's orgId claim matches. */
export function canAccessOrganization(user: SessionUser | null | undefined, organizationId: string): boolean {
  if (!user) return false;
  if (isSuperUser(user)) return true;
  return !!user.orgId && user.orgId.toLowerCase() === organizationId.toLowerCase();
}

/** The "Admin" authorization policy: any of Admin, admin, owner, SuperUser. */
export function satisfiesAdminPolicy(user: SessionUser | null | undefined): boolean {
  return hasRole(user, 'Admin', 'admin', 'owner', 'SuperUser');
}
