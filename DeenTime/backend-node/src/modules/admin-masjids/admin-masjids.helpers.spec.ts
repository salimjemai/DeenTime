import { describe, expect, it } from 'vitest';
import {
  buildDashboard,
  canResend,
  canRevoke,
  invitationRow,
  normalizeOptionalWebsite,
  organizationRow,
  sortRows,
  statusFor,
  summarize,
  type InvitationRecord,
  type MasjidAdminRow,
  type MasjidStatus,
  type MembershipRecord,
  type OrganizationRecord,
} from './admin-masjids.helpers.js';

const now = new Date('2026-09-10T12:00:00Z');
const earlier = new Date('2026-09-01T12:00:00Z');
const later = new Date('2026-09-17T12:00:00Z');

function invitation(overrides: Partial<InvitationRecord> = {}): InvitationRecord {
  return {
    id: 'inv-1',
    organizationId: null,
    organizationName: 'Cedar Park Masjid',
    email: 'admin@cedar-park.test',
    websiteUrl: 'https://cedar-park.test',
    city: 'Cedar Park',
    state: 'TX',
    sentAtUtc: earlier,
    expiresAtUtc: later,
    registrationStartedAtUtc: null,
    acceptedAtUtc: null,
    revokedAtUtc: null,
    sendCount: 1,
    ...overrides,
  };
}

function organization(overrides: Partial<OrganizationRecord> = {}): OrganizationRecord {
  return { id: 'org-1', name: 'Self Registered Masjid', email: 'org@self.test', websiteUrl: null, city: 'Austin', state: 'TX', updatedAtUtc: earlier, ...overrides };
}

describe('statusFor', () => {
  it('derives the status in the .NET precedence order', () => {
    expect(statusFor(invitation({ acceptedAtUtc: now, revokedAtUtc: now, expiresAtUtc: earlier }), true, now)).toBe('Registered');
    expect(statusFor(invitation({ revokedAtUtc: now, expiresAtUtc: earlier }), true, now)).toBe('Revoked');
    expect(statusFor(invitation({ expiresAtUtc: earlier, registrationStartedAtUtc: earlier }), true, now)).toBe('Expired');
    expect(statusFor(invitation({ expiresAtUtc: now }), false, now)).toBe('Expired');
    expect(statusFor(invitation({ registrationStartedAtUtc: earlier }), true, now)).toBe('AwaitingEmailVerification');
    expect(statusFor(invitation({ registrationStartedAtUtc: earlier }), false, now)).toBe('EmailVerificationExpired');
    expect(statusFor(invitation(), false, now)).toBe('InvitationSent');
  });
});

describe('canResend / canRevoke', () => {
  it('follows the status matrix', () => {
    const matrix: Record<MasjidStatus, [boolean, boolean]> = {
      Registered: [false, false],
      Revoked: [false, false],
      Expired: [true, false],
      AwaitingEmailVerification: [false, true],
      EmailVerificationExpired: [true, true],
      InvitationSent: [true, true],
    };
    for (const [status, [resend, revoke]] of Object.entries(matrix) as [MasjidStatus, [boolean, boolean]][]) {
      expect(canResend(status), `${status} resend`).toBe(resend);
      expect(canRevoke(status), `${status} revoke`).toBe(revoke);
    }
  });
});

describe('rows', () => {
  it('maps an invitation to a MasjidAdminRow', () => {
    const accepted = invitation({ organizationId: 'org-9', acceptedAtUtc: now, registrationStartedAtUtc: earlier, sendCount: 3 });
    expect(invitationRow(accepted, false, now)).toEqual({
      id: 'inv-1',
      organizationId: 'org-9',
      organizationName: 'Cedar Park Masjid',
      email: 'admin@cedar-park.test',
      websiteUrl: 'https://cedar-park.test',
      city: 'Cedar Park',
      state: 'TX',
      status: 'Registered',
      source: 'Invitation',
      invitedAtUtc: earlier,
      expiresAtUtc: later,
      registrationStartedAtUtc: earlier,
      registeredAtUtc: now,
      sendCount: 3,
      canResend: false,
      canRevoke: false,
    });
  });

  it('maps a self-registered organization, preferring the admin membership email', () => {
    expect(organizationRow(organization(), 'admin@self.test')).toEqual({
      id: 'org-1',
      organizationId: 'org-1',
      organizationName: 'Self Registered Masjid',
      email: 'admin@self.test',
      websiteUrl: null,
      city: 'Austin',
      state: 'TX',
      status: 'Registered',
      source: 'SelfRegistration',
      invitedAtUtc: null,
      expiresAtUtc: null,
      registrationStartedAtUtc: null,
      registeredAtUtc: earlier,
      sendCount: 0,
      canResend: false,
      canRevoke: false,
    });
    expect(organizationRow(organization(), null).email).toBe('org@self.test');
    expect(organizationRow(organization({ email: null }), undefined).email).toBe('');
  });
});

describe('sortRows / summarize', () => {
  const row = (id: string, status: MasjidStatus, invitedAtUtc: Date | null, registeredAtUtc: Date | null): MasjidAdminRow => ({
    ...organizationRow(organization({ id }), null),
    status,
    invitedAtUtc,
    registeredAtUtc,
  });

  it('puts registered rows last and orders each group by the most recent activity', () => {
    const rows = [
      row('registered-old', 'Registered', null, earlier),
      row('sent-old', 'InvitationSent', earlier, null),
      row('registered-new', 'Registered', null, now),
      row('expired-new', 'Expired', now, null),
      row('undated', 'Revoked', null, null),
      row('sent-mid', 'InvitationSent', new Date('2026-09-05T12:00:00Z'), null),
    ];
    expect(sortRows(rows).map((item) => item.id)).toEqual(['expired-new', 'sent-mid', 'sent-old', 'undated', 'registered-new', 'registered-old']);
    expect(rows.map((item) => item.id)[0]).toBe('registered-old');
  });

  it('is stable for equal keys', () => {
    const rows = [row('a', 'InvitationSent', now, null), row('b', 'InvitationSent', now, null), row('c', 'InvitationSent', now, null)];
    expect(sortRows(rows).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('counts the statuses like the .NET summary', () => {
    const rows: MasjidAdminRow[] = (['Registered', 'Registered', 'InvitationSent', 'AwaitingEmailVerification', 'EmailVerificationExpired', 'Expired', 'Revoked'] as MasjidStatus[]).map(
      (status, index) => row(String(index), status, null, null),
    );
    expect(summarize(rows)).toEqual({ total: 7, registered: 2, invited: 1, awaitingEmailVerification: 2, expired: 1, revoked: 1 });
  });
});

describe('buildDashboard', () => {
  it('merges invitations with unlinked, non-super-user organizations', () => {
    const invitations = [
      invitation({ id: 'inv-accepted', organizationId: 'org-linked', acceptedAtUtc: earlier, sentAtUtc: new Date('2026-08-20T00:00:00Z') }),
      invitation({ id: 'inv-pending', email: 'pending@masjid.test', registrationStartedAtUtc: earlier, sentAtUtc: new Date('2026-09-02T00:00:00Z') }),
      invitation({ id: 'inv-sent', email: 'sent@masjid.test', sentAtUtc: new Date('2026-09-03T00:00:00Z') }),
    ];
    const organizations = [
      organization({ id: 'org-linked', name: 'Linked Masjid', updatedAtUtc: now }),
      organization({ id: 'org-super', name: 'Super Org', updatedAtUtc: now }),
      organization({ id: 'org-self', name: 'Self Masjid', email: 'org@self.test', updatedAtUtc: new Date('2026-09-04T00:00:00Z') }),
      organization({ id: 'org-orphan', name: 'Orphan Masjid', email: null, updatedAtUtc: new Date('2026-09-05T00:00:00Z') }),
    ];
    const memberships: MembershipRecord[] = [
      { organizationId: 'org-super', email: 'super@deentime.test', roles: ['Admin', 'superuser'] },
      { organizationId: 'org-self', email: null, roles: ['Editor'] },
      { organizationId: 'org-self', email: 'first-admin@self.test', roles: ['admin'] },
      { organizationId: 'org-self', email: 'second-admin@self.test', roles: ['Admin'] },
      { organizationId: 'org-linked', email: 'linked@masjid.test', roles: ['Admin'] },
    ];

    const dashboard = buildDashboard({ invitations, pendingInvitationIds: ['inv-pending'], organizations, memberships, now });

    expect(dashboard.items.map((item) => [item.id, item.status, item.source, item.email])).toEqual([
      ['inv-sent', 'InvitationSent', 'Invitation', 'sent@masjid.test'],
      ['inv-pending', 'AwaitingEmailVerification', 'Invitation', 'pending@masjid.test'],
      ['org-orphan', 'Registered', 'SelfRegistration', ''],
      ['org-self', 'Registered', 'SelfRegistration', 'first-admin@self.test'],
      ['inv-accepted', 'Registered', 'Invitation', 'admin@cedar-park.test'],
    ]);
    expect(dashboard.summary).toEqual({ total: 5, registered: 3, invited: 1, awaitingEmailVerification: 1, expired: 0, revoked: 0 });
    expect(dashboard.items.find((item) => item.id === 'inv-accepted')?.organizationId).toBe('org-linked');
    expect(dashboard.items.find((item) => item.id === 'inv-pending')).toMatchObject({ canResend: false, canRevoke: true });
  });
});

describe('normalizeOptionalWebsite', () => {
  it('returns null for blank input', () => {
    expect(normalizeOptionalWebsite(null)).toBeNull();
    expect(normalizeOptionalWebsite(undefined)).toBeNull();
    expect(normalizeOptionalWebsite('   ')).toBeNull();
  });

  it('keeps only the lower-cased host without www.', () => {
    expect(normalizeOptionalWebsite('www.Example.com/about?x=1')).toBe('https://example.com');
    expect(normalizeOptionalWebsite(' HTTP://WWW.Masjid.ORG. ')).toBe('https://masjid.org');
    expect(normalizeOptionalWebsite('https://cedar-park-test.example')).toBe('https://cedar-park-test.example');
  });

  it('rejects other schemes, credentials and unparsable input', () => {
    expect(normalizeOptionalWebsite('ftp://masjid.org')).toBeNull();
    expect(normalizeOptionalWebsite('https://user:pw@masjid.org')).toBeNull();
    expect(normalizeOptionalWebsite('https://')).toBeNull();
    expect(normalizeOptionalWebsite('not a url')).toBeNull();
  });
});
