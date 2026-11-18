import { authorize } from '../core/auth.js';
import { config, currentUser, db, type App } from '../core/context.js';
import { fromJsonArray, newId, normalizeId, now } from '../core/db.js';
import { randomBytes } from '../core/encoding.js';
import { conflict, notFound, problem, validationProblem } from '../core/errors.js';
import { empty } from '../core/http.js';
import { isGuid } from '../core/json.js';
import { rateLimit } from '../core/rate-limit.js';
import { parseBody } from '../core/validation.js';
import { base64Url, hashToken, normalizeWords } from '../domain/registration-identity.js';
import { registrationEmailSender } from '../integrations/email.js';
import type { AppConfig } from '../core/config.js';
import { frontendBaseUrl, isEmailDeliveryFailure, nullIfBlank } from './auth/auth.helpers.js';
import { buildDashboard, normalizeOptionalWebsite, type InvitationRecord, type MembershipRecord, type OrganizationRecord } from './admin-masjids/admin-masjids.helpers.js';
import { createInvitationSchema } from './admin-masjids/admin-masjids.schemas.js';

/** Invitations are valid for 7 days. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;
const INVITATION_EMAIL_FAILED = 'Invitation email could not be sent.';

interface InvitationRow {
  Id: string;
  OrganizationId: string | null;
  OrganizationName: string;
  Email: string;
  WebsiteUrl: string | null;
  City: string | null;
  State: string | null;
  SentAtUtc: string;
  ExpiresAtUtc: string;
  RegistrationStartedAtUtc: string | null;
  AcceptedAtUtc: string | null;
  RevokedAtUtc: string | null;
  SendCount: number;
}

const INVITATION_COLUMNS =
  '"Id", "OrganizationId", "OrganizationName", "Email", "WebsiteUrl", "City", "State", "SentAtUtc", "ExpiresAtUtc", "RegistrationStartedAtUtc", "AcceptedAtUtc", "RevokedAtUtc", "SendCount"';

function dateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toInvitationRecord(row: InvitationRow): InvitationRecord {
  return {
    id: row.Id,
    organizationId: row.OrganizationId,
    organizationName: row.OrganizationName,
    email: row.Email,
    websiteUrl: row.WebsiteUrl,
    city: row.City,
    state: row.State,
    sentAtUtc: new Date(row.SentAtUtc),
    expiresAtUtc: new Date(row.ExpiresAtUtc),
    registrationStartedAtUtc: dateOrNull(row.RegistrationStartedAtUtc),
    acceptedAtUtc: dateOrNull(row.AcceptedAtUtc),
    revokedAtUtc: dateOrNull(row.RevokedAtUtc),
    sendCount: row.SendCount,
  };
}

function invitationUrl(cfg: AppConfig, rawToken: string): string {
  return `${frontendBaseUrl(cfg)}/login?invite=${encodeURIComponent(rawToken)}`;
}

/**
 * The raw invitation link is handed back to the super user only when it was not
 * emailed (no mail server configured) so it can be passed on by hand, or in Development.
 */
function shareableInvitationUrl(cfg: AppConfig, url: string): string | null {
  return cfg.isDevelopment() || !registrationEmailSender(cfg).enabled ? url : null;
}

/** /api/v1/admin/masjids, port of backend-node's AdminMasjidsController (SuperUser only). */
export function register(app: App): void {
  app.get('/api/v1/admin/masjids', authorize('SuperUser'), async (c) => {
    const database = db(c);
    const current = new Date();
    const [invitations, pending, organizations, memberships] = await database.batch([
      database.stmt(`SELECT ${INVITATION_COLUMNS} FROM "MasjidInvitations" ORDER BY rowid`),
      database.stmt('SELECT "InvitationId" FROM "PendingRegistrations" WHERE "InvitationId" IS NOT NULL AND "VerificationExpiresAtUtc" > ?', now(current)),
      database.stmt('SELECT "Id", "Name", "Email", "WebsiteUrl", "City", "State", "UpdatedAtUtc" FROM "Organizations" ORDER BY rowid'),
      database.stmt('SELECT "OrganizationId", "Email", "Roles" FROM "OrgUsers" ORDER BY rowid'),
    ]);
    return c.json(
      buildDashboard({
        invitations: (invitations.results as unknown as InvitationRow[]).map(toInvitationRecord),
        pendingInvitationIds: (pending.results as unknown as { InvitationId: string }[]).map((item) => item.InvitationId),
        organizations: (organizations.results as unknown as { Id: string; Name: string; Email: string | null; WebsiteUrl: string | null; City: string | null; State: string | null; UpdatedAtUtc: string }[]).map(
          (row): OrganizationRecord => ({ id: row.Id, name: row.Name, email: row.Email, websiteUrl: row.WebsiteUrl, city: row.City, state: row.State, updatedAtUtc: new Date(row.UpdatedAtUtc) }),
        ),
        memberships: (memberships.results as unknown as { OrganizationId: string; Email: string | null; Roles: string | null }[]).map(
          (row): MembershipRecord => ({ organizationId: row.OrganizationId, email: row.Email, roles: fromJsonArray(row.Roles) }),
        ),
        now: current,
      }),
    );
  });

  app.post('/api/v1/admin/masjids/invitations', rateLimit('expensive'), authorize('SuperUser'), async (c) => {
    const request = await parseBody(c, createInvitationSchema);
    const cfg = config(c);
    const database = db(c);
    const user = currentUser(c);
    const email = request.email.trim().toLowerCase();
    const normalizedName = normalizeWords(request.organizationName);
    const current = new Date();
    const unavailable = await database.first<{ Taken: number }>(
      `SELECT (
  EXISTS (SELECT 1 FROM "MasjidInvitations" WHERE "NormalizedEmail" = ?1 AND "AcceptedAtUtc" IS NULL AND "RevokedAtUtc" IS NULL AND "ExpiresAtUtc" > ?2)
  OR EXISTS (SELECT 1 FROM "AppUsers" WHERE "Email" = ?1)
  OR EXISTS (SELECT 1 FROM "Organizations" WHERE "NormalizedName" = ?3)
  OR EXISTS (SELECT 1 FROM "PendingRegistrations" WHERE "NormalizedEmail" = ?1)
) AS "Taken"`,
      email,
      now(current),
      normalizedName,
    );
    if (!unavailable || unavailable.Taken) {
      throw conflict({ code: 'invitation_unavailable', message: 'This email or masjid is already registered, invited, or awaiting verification.' });
    }

    const website = normalizeOptionalWebsite(request.websiteUrl);
    if (request.websiteUrl?.trim() && website === null) throw validationProblem({ WebsiteUrl: ['Enter a valid masjid website address.'] });
    if (website !== null) {
      const taken = await database.first('SELECT 1 AS "Taken" FROM "Organizations" WHERE "NormalizedWebsiteHost" = ?', new URL(website).hostname);
      if (taken) throw conflict({ code: 'invitation_unavailable', message: 'This masjid website is already registered.' });
    }

    const rawToken = base64Url(randomBytes(32));
    const invitation = {
      id: newId(),
      email,
      organizationName: request.organizationName.trim(),
      expiresAtUtc: now(new Date(current.getTime() + INVITATION_TTL_MS)),
    };
    await database.run(
      `INSERT INTO "MasjidInvitations" ("Id", "Email", "NormalizedEmail", "OrganizationName", "NormalizedOrganizationName", "WebsiteUrl", "AddressLine", "City", "State", "ZipCode",
  "InvitationTokenHash", "InvitedBySubject", "CreatedAtUtc", "SentAtUtc", "ExpiresAtUtc", "SendCount")
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      invitation.id,
      email,
      email,
      invitation.organizationName,
      normalizedName,
      website,
      nullIfBlank(request.addressLine),
      nullIfBlank(request.city),
      nullIfBlank(request.state)?.toUpperCase() ?? null,
      nullIfBlank(request.zipCode),
      hashToken(rawToken),
      user?.sub ? user.sub : 'unknown',
      now(current),
      now(current),
      invitation.expiresAtUtc,
    );

    const url = invitationUrl(cfg, rawToken);
    try {
      await registrationEmailSender(cfg).sendInvitation(email, invitation.organizationName, url);
    } catch (error) {
      if (!isEmailDeliveryFailure(error)) throw error;
      await database.run('DELETE FROM "MasjidInvitations" WHERE "Id" = ?', invitation.id);
      throw problem(503, INVITATION_EMAIL_FAILED);
    }

    return c.json(
      {
        id: invitation.id,
        email: invitation.email,
        organizationName: invitation.organizationName,
        status: 'InvitationSent',
        expiresAtUtc: invitation.expiresAtUtc,
        emailDelivered: registrationEmailSender(cfg).enabled,
        invitationUrl: shareableInvitationUrl(cfg, url),
      },
      201,
      { Location: `/api/v1/admin/masjids/invitations/${invitation.id}` },
    );
  });

  app.post('/api/v1/admin/masjids/invitations/:id/resend', rateLimit('expensive'), authorize('SuperUser'), async (c) => {
    const id = c.req.param('id');
    const cfg = config(c);
    const database = db(c);
    const invitation = isGuid(id)
      ? await database.first<{ Id: string; Email: string; OrganizationName: string; AcceptedAtUtc: string | null; RevokedAtUtc: string | null; SendCount: number; ActiveVerification: number }>(
          `SELECT "Id", "Email", "OrganizationName", "AcceptedAtUtc", "RevokedAtUtc", "SendCount",
  EXISTS (SELECT 1 FROM "PendingRegistrations" p WHERE p."InvitationId" = "MasjidInvitations"."Id" AND p."VerificationExpiresAtUtc" > ?2) AS "ActiveVerification"
FROM "MasjidInvitations" WHERE "Id" = ?1`,
          normalizeId(id),
          now(),
        )
      : null;
    if (!invitation) throw notFound();
    if (invitation.AcceptedAtUtc !== null || invitation.RevokedAtUtc !== null) throw conflict({ message: 'A completed or revoked invitation cannot be resent.' });
    if (invitation.ActiveVerification) throw conflict({ message: 'This masjid already has an active email-verification link.' });

    const rawToken = base64Url(randomBytes(32));
    const current = new Date();
    const expiresAtUtc = now(new Date(current.getTime() + INVITATION_TTL_MS));

    const url = invitationUrl(cfg, rawToken);
    try {
      await registrationEmailSender(cfg).sendInvitation(invitation.Email, invitation.OrganizationName, url);
    } catch (error) {
      if (!isEmailDeliveryFailure(error)) throw error;
      throw problem(503, INVITATION_EMAIL_FAILED);
    }
    await database.run(
      'UPDATE "MasjidInvitations" SET "InvitationTokenHash" = ?, "SentAtUtc" = ?, "ExpiresAtUtc" = ?, "RegistrationStartedAtUtc" = NULL, "SendCount" = ? WHERE "Id" = ?',
      hashToken(rawToken),
      now(current),
      expiresAtUtc,
      invitation.SendCount + 1,
      invitation.Id,
    );

    return c.json({
      message: 'Invitation resent.',
      expiresAtUtc,
      emailDelivered: registrationEmailSender(cfg).enabled,
      invitationUrl: shareableInvitationUrl(cfg, url),
    });
  });

  app.post('/api/v1/admin/masjids/invitations/:id/revoke', authorize('SuperUser'), async (c) => {
    const id = c.req.param('id');
    const database = db(c);
    const invitation = isGuid(id)
      ? await database.first<{ Id: string; AcceptedAtUtc: string | null; RevokedAtUtc: string | null }>('SELECT "Id", "AcceptedAtUtc", "RevokedAtUtc" FROM "MasjidInvitations" WHERE "Id" = ?', normalizeId(id))
      : null;
    if (!invitation) throw notFound();
    if (invitation.AcceptedAtUtc !== null) throw conflict({ message: 'A completed invitation cannot be revoked.' });
    await database.batch([
      database.stmt('UPDATE "MasjidInvitations" SET "RevokedAtUtc" = ? WHERE "Id" = ?', invitation.RevokedAtUtc ?? now(), invitation.Id),
      database.stmt('DELETE FROM "PendingRegistrations" WHERE "InvitationId" = ?', invitation.Id),
    ]);
    return empty(c, 204);
  });
}
