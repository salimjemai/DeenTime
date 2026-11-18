/**
 * Pure pieces of AdminMasjidsController.cs: the per-invitation status, the
 * dashboard rows/summary and the optional website normalization.
 */
export const MASJID_STATUSES = ['Registered', 'Revoked', 'Expired', 'AwaitingEmailVerification', 'EmailVerificationExpired', 'InvitationSent'] as const;
export type MasjidStatus = (typeof MASJID_STATUSES)[number];
export type MasjidSource = 'Invitation' | 'SelfRegistration';

/** The MasjidAdminRow record (camelCase JSON). */
export interface MasjidAdminRow {
  id: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  websiteUrl: string | null;
  city: string | null;
  state: string | null;
  status: MasjidStatus;
  source: MasjidSource;
  invitedAtUtc: Date | null;
  expiresAtUtc: Date | null;
  registrationStartedAtUtc: Date | null;
  registeredAtUtc: Date | null;
  sendCount: number;
  canResend: boolean;
  canRevoke: boolean;
}

export interface DashboardSummary {
  total: number;
  registered: number;
  invited: number;
  awaitingEmailVerification: number;
  expired: number;
  revoked: number;
}

export interface MasjidDashboard {
  summary: DashboardSummary;
  items: MasjidAdminRow[];
}

export interface InvitationRecord {
  id: string;
  organizationId: string | null;
  organizationName: string;
  email: string;
  websiteUrl: string | null;
  city: string | null;
  state: string | null;
  sentAtUtc: Date;
  expiresAtUtc: Date;
  registrationStartedAtUtc: Date | null;
  acceptedAtUtc: Date | null;
  revokedAtUtc: Date | null;
  sendCount: number;
}

export interface OrganizationRecord {
  id: string;
  name: string;
  email: string | null;
  websiteUrl: string | null;
  city: string | null;
  state: string | null;
  updatedAtUtc: Date;
}

export interface MembershipRecord {
  organizationId: string;
  email: string | null;
  roles: string[];
}

export interface DashboardInput {
  invitations: InvitationRecord[];
  /** Ids of the invitations that have a pending registration whose verification link is still live. */
  pendingInvitationIds: Iterable<string>;
  organizations: OrganizationRecord[];
  memberships: MembershipRecord[];
  now: Date;
}

/** StatusFor(invitation, hasPendingVerification, now). */
export function statusFor(
  invitation: Pick<InvitationRecord, 'acceptedAtUtc' | 'revokedAtUtc' | 'expiresAtUtc' | 'registrationStartedAtUtc'>,
  hasPendingVerification: boolean,
  now: Date,
): MasjidStatus {
  if (invitation.acceptedAtUtc !== null) return 'Registered';
  if (invitation.revokedAtUtc !== null) return 'Revoked';
  if (invitation.expiresAtUtc.getTime() <= now.getTime()) return 'Expired';
  if (hasPendingVerification) return 'AwaitingEmailVerification';
  if (invitation.registrationStartedAtUtc !== null) return 'EmailVerificationExpired';
  return 'InvitationSent';
}

export function canResend(status: MasjidStatus): boolean {
  return status === 'InvitationSent' || status === 'Expired' || status === 'EmailVerificationExpired';
}

export function canRevoke(status: MasjidStatus): boolean {
  return status === 'InvitationSent' || status === 'AwaitingEmailVerification' || status === 'EmailVerificationExpired';
}

/** roles.Contains(role, StringComparer.OrdinalIgnoreCase). */
export function rolesInclude(roles: string[], role: string): boolean {
  return roles.some((candidate) => candidate.toLowerCase() === role.toLowerCase());
}

export function invitationRow(invitation: InvitationRecord, hasPendingVerification: boolean, now: Date): MasjidAdminRow {
  const status = statusFor(invitation, hasPendingVerification, now);
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    organizationName: invitation.organizationName,
    email: invitation.email,
    websiteUrl: invitation.websiteUrl,
    city: invitation.city,
    state: invitation.state,
    status,
    source: 'Invitation',
    invitedAtUtc: invitation.sentAtUtc,
    expiresAtUtc: invitation.expiresAtUtc,
    registrationStartedAtUtc: invitation.registrationStartedAtUtc,
    registeredAtUtc: invitation.acceptedAtUtc,
    sendCount: invitation.sendCount,
    canResend: canResend(status),
    canRevoke: canRevoke(status),
  };
}

/** An organization that was not created from an invitation (and is not the super user's). */
export function organizationRow(organization: OrganizationRecord, adminEmail: string | null | undefined): MasjidAdminRow {
  return {
    id: organization.id,
    organizationId: organization.id,
    organizationName: organization.name,
    email: adminEmail ?? organization.email ?? '',
    websiteUrl: organization.websiteUrl,
    city: organization.city,
    state: organization.state,
    status: 'Registered',
    source: 'SelfRegistration',
    invitedAtUtc: null,
    expiresAtUtc: null,
    registrationStartedAtUtc: null,
    registeredAtUtc: organization.updatedAtUtc,
    sendCount: 0,
    canResend: false,
    canRevoke: false,
  };
}

/** OrderBy(Registered last).ThenByDescending(InvitedAtUtc ?? RegisteredAtUtc); LINQ's OrderBy is stable, so is Array.sort. */
export function sortRows(rows: MasjidAdminRow[]): MasjidAdminRow[] {
  const group = (row: MasjidAdminRow): number => (row.status === 'Registered' ? 1 : 0);
  const moment = (row: MasjidAdminRow): number => (row.invitedAtUtc ?? row.registeredAtUtc)?.getTime() ?? Number.NEGATIVE_INFINITY;
  return [...rows].sort((a, b) => {
    const byGroup = group(a) - group(b);
    if (byGroup !== 0) return byGroup;
    const [first, second] = [moment(a), moment(b)];
    if (first === second) return 0;
    return first > second ? -1 : 1;
  });
}

export function summarize(rows: MasjidAdminRow[]): DashboardSummary {
  const count = (predicate: (status: MasjidStatus) => boolean): number => rows.filter((row) => predicate(row.status)).length;
  return {
    total: rows.length,
    registered: count((status) => status === 'Registered'),
    invited: count((status) => status === 'InvitationSent'),
    awaitingEmailVerification: count((status) => status === 'AwaitingEmailVerification' || status === 'EmailVerificationExpired'),
    expired: count((status) => status === 'Expired'),
    revoked: count((status) => status === 'Revoked'),
  };
}

/** The GET /api/v1/admin/masjids aggregation. */
export function buildDashboard(input: DashboardInput): MasjidDashboard {
  const pendingIds = new Set(input.pendingInvitationIds);
  const superUserOrgIds = new Set(input.memberships.filter((membership) => rolesInclude(membership.roles, 'SuperUser')).map((membership) => membership.organizationId));
  const linkedOrganizationIds = new Set(input.invitations.map((invitation) => invitation.organizationId).filter((id): id is string => id !== null));
  // GroupBy(OrganizationId).First().Email: the first Admin membership per organization.
  const adminEmails = new Map<string, string | null>();
  for (const membership of input.memberships) {
    if (rolesInclude(membership.roles, 'Admin') && !adminEmails.has(membership.organizationId)) adminEmails.set(membership.organizationId, membership.email);
  }

  const rows = input.invitations.map((invitation) => invitationRow(invitation, pendingIds.has(invitation.id), input.now));
  for (const organization of input.organizations) {
    if (superUserOrgIds.has(organization.id) || linkedOrganizationIds.has(organization.id)) continue;
    rows.push(organizationRow(organization, adminEmails.get(organization.id)));
  }
  const items = sortRows(rows);
  return { summary: summarize(items), items };
}

/** NormalizeOptionalWebsite: null for blank or invalid input, otherwise "https://{host}" without "www.". */
export function normalizeOptionalWebsite(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  let candidate = value.trim();
  if (!candidate.includes('://')) candidate = `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  let host = url.hostname.replace(/\.+$/, '').toLowerCase();
  if (host.startsWith('www.')) host = host.slice(4);
  return `https://${host}`;
}
