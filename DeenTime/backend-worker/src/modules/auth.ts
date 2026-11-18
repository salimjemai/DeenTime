import { authorize } from '../core/auth.js';
import { clientAddress } from '../core/client-address.js';
import { config, currentUser, db, jwt, type App } from '../core/context.js';
import { fromJsonArray, isUniqueViolation, newId, now, toJsonArray } from '../core/db.js';
import { randomBytes } from '../core/encoding.js';
import { badRequest, conflict, problem, unauthorized, validationProblem } from '../core/errors.js';
import { isGuid } from '../core/json.js';
import { burnPasswordCheck, hashPassword, needsRehash, verifyPassword } from '../core/password-hasher.js';
import { rateLimit } from '../core/rate-limit.js';
import { toHex } from '../core/sha256.js';
import { parseBody } from '../core/validation.js';
import { base64Url, createSlug, hashToken, resolveUsTimeZone, tryCreateIdentity } from '../domain/registration-identity.js';
import { registrationEmailSender } from '../integrations/email.js';
import { ProviderUnavailableError } from '../integrations/errors.js';
import { googleAddressService, type VerifiedAddress } from '../integrations/google-address.js';
import { loginThrottle } from '../integrations/login-throttle.js';
import { PostalCodeService, postalCodeService, type PostalCodeLocation } from '../integrations/postal-code.js';
import { turnstileService } from '../integrations/turnstile.js';
import { DEFAULT_IQAMA_HEADINGS } from './auth/auth.defaults.js';
import { frontendBaseUrl, isEmailDeliveryFailure, nullIfBlank } from './auth/auth.helpers.js';
import { forgotSchema, loginSchema, registerSchema, resetSchema, verifyEmailSchema } from './auth/auth.schemas.js';

const CAPTCHA_FAILED = { code: 'captcha_failed', message: 'Please complete the security verification and try again.' };
const RESET_INVALID = { code: 'reset_invalid', message: 'The password reset link is invalid or has expired. Request a new one.' };
const REGISTRATION_UNAVAILABLE = { code: 'registration_unavailable', message: 'This email or masjid is already registered or awaiting verification.' };
const ALREADY_REGISTERED = { code: 'registration_unavailable', message: 'This email or masjid has already been registered.' };
const ORGANIZATION_UNAVAILABLE = 'Organization unavailable';
/** Verification and password-reset links live for 30 minutes. */
const TOKEN_TTL_MS = 30 * 60_000;
/** U.S. zones that do not observe daylight saving time. */
const NON_DST_ZONES = new Set(['America/Phoenix', 'Pacific/Honolulu']);

interface InvitationRow {
  Id: string;
  Email: string;
  NormalizedEmail: string;
  OrganizationName: string;
  WebsiteUrl: string | null;
  AddressLine: string | null;
  City: string | null;
  State: string | null;
  ZipCode: string | null;
  ExpiresAtUtc: string;
  RevokedAtUtc: string | null;
  AcceptedAtUtc: string | null;
}

interface PendingRow {
  Id: string;
  Email: string;
  NormalizedEmail: string;
  PasswordHash: string;
  PasswordSalt: string;
  OrganizationName: string;
  NormalizedName: string;
  WebsiteUrl: string;
  NormalizedWebsiteHost: string;
  AddressLine: string;
  City: string;
  State: string;
  ZipCode: string;
  AddressFingerprint: string;
  MasjidIdentityKey: string;
  Latitude: number;
  Longitude: number;
  TimezoneId: string;
  VerificationExpiresAtUtc: string;
  InvitationId: string | null;
}

const INVITATION_BY_TOKEN =
  'SELECT "Id", "Email", "NormalizedEmail", "OrganizationName", "WebsiteUrl", "AddressLine", "City", "State", "ZipCode", "ExpiresAtUtc", "RevokedAtUtc", "AcceptedAtUtc" FROM "MasjidInvitations" WHERE "InvitationTokenHash" = ?';

function invitationUsable(invitation: InvitationRow | null, nowMs: number): invitation is InvitationRow {
  return invitation !== null && Date.parse(invitation.ExpiresAtUtc) > nowMs && invitation.RevokedAtUtc === null && invitation.AcceptedAtUtc === null;
}

/** /api/v1/auth, port of backend-node's AuthController: registration is by invitation only. */
export function register(app: App): void {
  app.get('/api/v1/auth/config', (c) => {
    const cfg = config(c);
    const captcha = turnstileService(cfg);
    return c.json({
      captchaEnabled: captcha.enabled,
      captchaSiteKey: captcha.enabled ? captcha.siteKey : null,
      addressAutocompleteEnabled: googleAddressService(cfg).isEnabled,
      // Masjids are registered from an administrator invitation only; the sign-in
      // page shows these so anyone without an invitation knows whom to contact.
      registrationByInvitationOnly: true,
      supportEmail: nullIfBlank(cfg.get('Support:Email')),
      supportPhone: nullIfBlank(cfg.get('Support:Phone')),
      supportUrl: nullIfBlank(cfg.get('Support:Url')),
    });
  });

  app.get('/api/v1/auth/invitations/:token', rateLimit('auth-verify'), async (c) => {
    const token = c.req.param('token');
    const invalid = () => badRequest({ code: 'invitation_invalid', message: 'This invitation is invalid or has expired.' });
    if (!token?.trim() || token.length > 512) throw invalid();

    const invitation = await db(c).first<InvitationRow>(INVITATION_BY_TOKEN, hashToken(token));
    if (!invitationUsable(invitation, Date.now())) throw invalid();

    return c.json({
      email: invitation.Email,
      organizationName: invitation.OrganizationName,
      websiteUrl: invitation.WebsiteUrl,
      addressLine: invitation.AddressLine,
      city: invitation.City,
      state: invitation.State,
      zipCode: invitation.ZipCode,
      expiresAtUtc: invitation.ExpiresAtUtc,
    });
  });

  app.post('/api/v1/auth/register', rateLimit('auth-register'), async (c) => {
    const req = await parseBody(c, registerSchema);
    const cfg = config(c);
    const database = db(c);
    // Registration is by invitation only: the MasjidHub administrator invites a masjid
    // and the invited email completes the form from the link in that invitation.
    if (!req.invitationToken?.trim()) {
      throw badRequest({ code: 'invitation_required', message: 'Masjid registration is by invitation only. Contact the MasjidHub administrator to request an invitation.' });
    }
    if (!(await turnstileService(cfg).verify(req.captchaToken, 'register', clientAddress(c)))) throw badRequest(CAPTCHA_FAILED);

    let addressLine = req.addressLine.trim();
    let city = req.city.trim();
    let state = req.state.trim();
    let zipCode = req.zipCode.trim();
    const addresses = googleAddressService(cfg);
    if (addresses.isEnabled) {
      if (!req.addressPlaceId?.trim()) throw validationProblem({ AddressPlaceId: ['Choose a verified address from the suggestions.'] });
      let verifiedAddress: VerifiedAddress | null;
      try {
        verifiedAddress = await addresses.resolve(req.addressPlaceId, null);
      } catch (error) {
        if (error instanceof ProviderUnavailableError) throw problem(503, 'Address verification is temporarily unavailable.');
        throw error;
      }
      if (!verifiedAddress) throw validationProblem({ AddressPlaceId: ['Choose a complete U.S. street address from the suggestions.'] });
      addressLine = verifiedAddress.addressLine;
      city = verifiedAddress.city;
      state = verifiedAddress.state;
      zipCode = verifiedAddress.postalCode;
    }

    const identity = tryCreateIdentity(req.email, req.organizationName, req.websiteUrl, addressLine, city, state, zipCode);
    if (!identity) throw validationProblem({ WebsiteUrl: ['Enter a valid masjid website address.'] });

    const invitation = await database.first<InvitationRow>(INVITATION_BY_TOKEN, hashToken(req.invitationToken));
    if (!invitationUsable(invitation, Date.now())) {
      throw badRequest({ code: 'invitation_invalid', message: 'This invitation is invalid or has expired. Contact the MasjidHub administrator for a new one.' });
    }
    if (invitation.NormalizedEmail !== identity.email) {
      throw badRequest({ code: 'invitation_email_mismatch', message: 'Register with the email address that received this invitation.' });
    }

    const postalCode = PostalCodeService.normalizeUsPostalCode(zipCode) ?? '';
    let location: PostalCodeLocation | null;
    try {
      location = await postalCodeService(cfg).resolveUs(postalCode);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Location verification is temporarily unavailable.');
      throw error;
    }
    if (!location) throw validationProblem({ ZipCode: ['That U.S. ZIP code could not be found.'] });
    if (location.stateAbbreviation.toUpperCase() !== state.toUpperCase()) throw validationProblem({ State: ['The state does not match the ZIP code.'] });

    // Expired registrations are dropped, then the duplicate checks run, in one round trip.
    const [, duplicates] = await database.batch([
      database.stmt('DELETE FROM "PendingRegistrations" WHERE "VerificationExpiresAtUtc" <= ?', now()),
      database.stmt(
        `SELECT
  EXISTS (SELECT 1 FROM "AppUsers" WHERE "Email" = ?1) AS "ExistingEmail",
  EXISTS (SELECT 1 FROM "Organizations" WHERE "NormalizedWebsiteHost" = ?2 OR "AddressFingerprint" = ?3 OR "MasjidIdentityKey" = ?4) AS "ExistingMasjid",
  EXISTS (SELECT 1 FROM "PendingRegistrations" WHERE "NormalizedEmail" = ?1 OR "NormalizedWebsiteHost" = ?2 OR "AddressFingerprint" = ?3 OR "MasjidIdentityKey" = ?4) AS "PendingDuplicate"`,
        identity.email,
        identity.websiteHost,
        identity.addressFingerprint,
        identity.masjidIdentityKey,
      ),
    ]);
    const found = duplicates.results[0] as { ExistingEmail: number; ExistingMasjid: number; PendingDuplicate: number } | undefined;
    if (!found || found.ExistingEmail || found.ExistingMasjid || found.PendingDuplicate) throw conflict(REGISTRATION_UNAVAILABLE);

    const rawToken = base64Url(randomBytes(32));
    const password = await hashPassword(req.password);
    const pending = { id: newId(), email: identity.email, organizationName: req.organizationName.trim() };
    try {
      await database.batch([
        database.stmt(
          `INSERT INTO "PendingRegistrations" ("Id", "InvitationId", "Email", "NormalizedEmail", "PasswordHash", "PasswordSalt", "OrganizationName", "NormalizedName",
  "WebsiteUrl", "NormalizedWebsiteHost", "AddressLine", "City", "State", "ZipCode", "AddressFingerprint", "MasjidIdentityKey", "Latitude", "Longitude", "TimezoneId",
  "VerificationTokenHash", "VerificationExpiresAtUtc", "CreatedAtUtc")
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          pending.id,
          invitation.Id,
          pending.email,
          identity.email,
          password.hash,
          password.salt,
          pending.organizationName,
          identity.name,
          identity.websiteUrl,
          identity.websiteHost,
          addressLine,
          city,
          location.stateAbbreviation,
          location.postalCode,
          identity.addressFingerprint,
          identity.masjidIdentityKey,
          location.latitude,
          location.longitude,
          resolveUsTimeZone(location.stateAbbreviation, location.longitude),
          hashToken(rawToken),
          now(new Date(Date.now() + TOKEN_TTL_MS)),
          now(),
        ),
        database.stmt('UPDATE "MasjidInvitations" SET "RegistrationStartedAtUtc" = ? WHERE "Id" = ?', now(), invitation.Id),
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict(REGISTRATION_UNAVAILABLE);
      throw error;
    }

    const verificationUrl = `${frontendBaseUrl(cfg)}/verify-email?token=${encodeURIComponent(rawToken)}`;
    try {
      await registrationEmailSender(cfg).sendVerification(pending.email, pending.organizationName, verificationUrl);
    } catch (error) {
      if (!isEmailDeliveryFailure(error)) throw error;
      await database.batch([
        database.stmt('DELETE FROM "PendingRegistrations" WHERE "Id" = ?', pending.id),
        database.stmt('UPDATE "MasjidInvitations" SET "RegistrationStartedAtUtc" = NULL WHERE "Id" = ?', invitation.Id),
      ]);
      throw problem(503, 'Verification email could not be sent.');
    }

    return c.json(
      {
        message: 'Check your email to verify the administrator account.',
        verificationRequired: true,
        developmentVerificationUrl: cfg.isDevelopment() ? verificationUrl : null,
      },
      202,
    );
  });

  app.post('/api/v1/auth/verify-email', rateLimit('auth-verify'), async (c) => {
    const req = await parseBody(c, verifyEmailSchema);
    const cfg = config(c);
    const database = db(c);
    const pending = await database.first<PendingRow>(
      `SELECT "Id", "Email", "NormalizedEmail", "PasswordHash", "PasswordSalt", "OrganizationName", "NormalizedName", "WebsiteUrl", "NormalizedWebsiteHost",
  "AddressLine", "City", "State", "ZipCode", "AddressFingerprint", "MasjidIdentityKey", "Latitude", "Longitude", "TimezoneId", "VerificationExpiresAtUtc", "InvitationId"
FROM "PendingRegistrations" WHERE "VerificationTokenHash" = ?`,
      hashToken(req.token),
    );
    if (!pending || Date.parse(pending.VerificationExpiresAtUtc) <= Date.now()) {
      if (pending) await database.run('DELETE FROM "PendingRegistrations" WHERE "Id" = ?', pending.Id);
      throw badRequest({ code: 'verification_invalid', message: 'The verification link is invalid or has expired.' });
    }

    const slugBase = createSlug(pending.OrganizationName);
    const existing = await database.first<{ DuplicateUser: number; DuplicateMasjid: number; SlugTaken: number }>(
      `SELECT
  EXISTS (SELECT 1 FROM "AppUsers" WHERE "Email" = ?1) AS "DuplicateUser",
  EXISTS (SELECT 1 FROM "Organizations" WHERE "NormalizedWebsiteHost" = ?2 OR "AddressFingerprint" = ?3 OR "MasjidIdentityKey" = ?4) AS "DuplicateMasjid",
  EXISTS (SELECT 1 FROM "Organizations" WHERE "Slug" = ?5) AS "SlugTaken"`,
      pending.NormalizedEmail,
      pending.NormalizedWebsiteHost,
      pending.AddressFingerprint,
      pending.MasjidIdentityKey,
      slugBase,
    );
    if (!existing || existing.DuplicateUser || existing.DuplicateMasjid) throw conflict(ALREADY_REGISTERED);

    const user = { id: newId(), email: pending.NormalizedEmail };
    const organizationId = newId();
    const slug = existing.SlugTaken ? `${slugBase}-${toHex(randomBytes(2))}` : slugBase;
    const timestamp = now();
    // backend-node runs these in an interactive transaction. A batch is all-or-nothing, and a
    // second verification racing this one fails on a unique index (user email, slug, masjid
    // identity), which rolls the whole batch back and is reported as "already registered".
    const statements = [
      database.stmt('INSERT INTO "AppUsers" ("Id", "Email", "DisplayName", "PasswordHash", "PasswordSalt") VALUES (?, ?, ?, ?, ?)', user.id, user.email, pending.Email, pending.PasswordHash, pending.PasswordSalt),
      database.stmt(
        `INSERT INTO "Organizations" ("Id", "Slug", "Name", "NormalizedName", "WebsiteUrl", "NormalizedWebsiteHost", "AddressLine", "City", "State", "ZipCode", "Email",
  "AddressFingerprint", "MasjidIdentityKey", "AdminUserId", "UpdatedAtUtc")
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        organizationId,
        slug,
        pending.OrganizationName,
        pending.NormalizedName,
        pending.WebsiteUrl,
        pending.NormalizedWebsiteHost,
        pending.AddressLine,
        pending.City,
        pending.State,
        pending.ZipCode,
        pending.Email,
        pending.AddressFingerprint,
        pending.MasjidIdentityKey,
        user.id,
        timestamp,
      ),
    ];
    if (pending.InvitationId !== null) {
      statements.push(database.stmt('UPDATE "MasjidInvitations" SET "AcceptedAtUtc" = ?, "OrganizationId" = ? WHERE "Id" = ?', timestamp, organizationId, pending.InvitationId));
    }
    statements.push(
      database.stmt(
        'INSERT INTO "OrgUsers" ("Id", "OrganizationId", "Issuer", "Subject", "Email", "DisplayName", "Roles", "LastSeenUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        newId(),
        organizationId,
        cfg.get('Auth:Issuer') ?? 'local',
        user.id,
        pending.Email,
        pending.Email,
        toJsonArray(['Admin']),
        timestamp,
      ),
      database.stmt(
        `INSERT INTO "PrayerTimingCriteria" ("Id", "OrganizationId", "Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "ZipCode",
  "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes", "UpdatedAtUtc")
VALUES (?, ?, 'ISNA', 'Other', ?, ?, ?, ?, ?, 5, 1, 20, ?)`,
        newId(),
        organizationId,
        pending.Latitude,
        pending.Longitude,
        pending.TimezoneId,
        !NON_DST_ZONES.has(pending.TimezoneId),
        pending.ZipCode,
        timestamp,
      ),
      database.stmt(
        `INSERT INTO "DesignSettings" ("Id", "OrganizationId", "IqamaHeadings", "FooterHtml", "Theme", "UpdatedAtUtc") VALUES (?, ?, ?, ?, 'default', ?)`,
        newId(),
        organizationId,
        toJsonArray(DEFAULT_IQAMA_HEADINGS),
        `© ${new Date().getUTCFullYear()} ${pending.OrganizationName} · MasjidHub`,
        timestamp,
      ),
      database.stmt('DELETE FROM "PendingRegistrations" WHERE "Id" = ?', pending.Id),
    );
    try {
      await database.batch(statements);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict(ALREADY_REGISTERED);
      throw error;
    }

    // Verification activates the account but deliberately does not sign the browser
    // in: the administrator signs in with the password they chose, which also proves
    // the credentials work before the masjid dashboard is opened for the first time.
    return c.json({
      verified: true,
      email: user.email,
      organizationName: pending.OrganizationName,
      message: 'Your email is verified. Sign in with the password you chose to open your masjid dashboard.',
    });
  });

  app.post('/api/v1/auth/login', rateLimit('auth-login'), async (c) => {
    const req = await parseBody(c, loginSchema);
    const cfg = config(c);
    const database = db(c);
    if (!(await turnstileService(cfg).verify(req.captchaToken, 'login', clientAddress(c)))) throw badRequest(CAPTCHA_FAILED);

    const email = req.email.trim().toLowerCase();
    const throttle = loginThrottle(database);
    const attempt = await throttle.canAttempt(email);
    if (!attempt.allowed) {
      return c.json({ message: 'Too many failed attempts. Try again later.' }, 429, { 'Retry-After': String(attempt.retryAfterSeconds) });
    }

    // The user with the first membership and its organization (backend-node reads them in two queries).
    const user = await database.first<{
      Id: string;
      Email: string | null;
      PasswordHash: string;
      PasswordSalt: string;
      OrganizationId: string | null;
      Roles: string | null;
      AdminUserId: string | null;
    }>(
      `SELECT u."Id", u."Email", u."PasswordHash", u."PasswordSalt", m."OrganizationId", m."Roles", o."AdminUserId"
FROM "AppUsers" u
LEFT JOIN "OrgUsers" m ON m."Subject" = u."Id"
LEFT JOIN "Organizations" o ON o."Id" = m."OrganizationId"
WHERE u."Email" = ?
ORDER BY m.rowid
LIMIT 1`,
      email,
    );
    let passwordValid = false;
    if (user) {
      const verification = await verifyPassword(req.password, user.PasswordHash, user.PasswordSalt);
      passwordValid = verification === 'valid';
      // A hash this platform cannot compute is answered exactly like a wrong password, so the
      // response does not reveal that the account exists; the account needs a password reset.
      if (verification === 'unsupported') console.warn(`Login refused for user ${user.Id}: the stored password hash is not supported on this platform; a password reset is required.`);
    } else {
      await burnPasswordCheck(req.password);
    }
    if (!user || !passwordValid) {
      await throttle.recordFailure(email);
      throw unauthorized();
    }

    if (user.OrganizationId === null) throw problem(403, ORGANIZATION_UNAVAILABLE, 'This account is not assigned to an active organization.');
    let roles = fromJsonArray(user.Roles);
    const superUser = roles.some((role) => role.toLowerCase() === 'superuser');
    if (!superUser && user.AdminUserId !== user.Id) roles = roles.filter((role) => role.toLowerCase() !== 'admin');

    if (needsRehash(user.PasswordHash)) {
      const rehashed = await hashPassword(req.password);
      await database.run('UPDATE "AppUsers" SET "PasswordHash" = ?, "PasswordSalt" = ? WHERE "Id" = ?', rehashed.hash, rehashed.salt, user.Id);
    }
    await throttle.reset(email);
    return c.json({ token: await jwt(c).issue({ id: user.Id, email: user.Email }, user.OrganizationId, roles) });
  });

  app.get('/api/v1/auth/session', authorize(), async (c) => {
    const user = currentUser(c);
    const subject = user?.sub?.trim() ? user.sub : null;
    if (!user || subject === null) throw unauthorized();
    if (!user.orgId || !isGuid(user.orgId)) throw problem(403, ORGANIZATION_UNAVAILABLE, 'The session does not contain an active organization.');

    const database = db(c);
    const issuer = user.issuer?.trim() ? user.issuer : null;
    const membership = await database.first<{ Id: string; Email: string | null; DisplayName: string | null; Roles: string | null; OrgId: string; Slug: string; Name: string }>(
      `SELECT m."Id", m."Email", m."DisplayName", m."Roles", o."Id" AS "OrgId", o."Slug", o."Name"
FROM "OrgUsers" m
JOIN "Organizations" o ON o."Id" = m."OrganizationId"
WHERE m."Subject" = ?1 AND m."OrganizationId" = ?2 AND (?3 IS NULL OR m."Issuer" = ?3)
ORDER BY m.rowid
LIMIT 1`,
      subject,
      user.orgId.toLowerCase(),
      issuer,
    );
    if (!membership) throw problem(403, ORGANIZATION_UNAVAILABLE, 'Your session no longer has access to this organization.');

    await database.run('UPDATE "OrgUsers" SET "LastSeenUtc" = ? WHERE "Id" = ?', now(), membership.Id);
    return c.json({
      userId: subject,
      email: membership.Email,
      displayName: membership.DisplayName,
      organizationId: membership.OrgId,
      organizationSlug: membership.Slug,
      organizationName: membership.Name,
      roles: fromJsonArray(membership.Roles),
    });
  });

  app.post('/api/v1/auth/forgot', rateLimit('auth-register'), async (c) => {
    const req = await parseBody(c, forgotSchema);
    const cfg = config(c);
    const database = db(c);
    // The response is the same whether or not the email has an account, so the
    // endpoint cannot be used to discover registered administrators.
    const email = req.email.trim().toLowerCase();
    const user = await database.first<{ Id: string; Email: string | null }>('SELECT "Id", "Email" FROM "AppUsers" WHERE "Email" = ?', email);
    let developmentResetUrl: string | null = null;
    if (user) {
      const rawToken = base64Url(randomBytes(32));
      await database.run(
        'UPDATE "AppUsers" SET "PasswordResetTokenHash" = ?, "PasswordResetExpiresAtUtc" = ? WHERE "Id" = ?',
        hashToken(rawToken),
        now(new Date(Date.now() + TOKEN_TTL_MS)),
        user.Id,
      );

      const resetUrl = `${frontendBaseUrl(cfg)}/reset-password?token=${encodeURIComponent(rawToken)}`;
      try {
        await registrationEmailSender(cfg).sendPasswordReset(user.Email ?? email, resetUrl);
      } catch (error) {
        if (!isEmailDeliveryFailure(error)) throw error;
        await database.run('UPDATE "AppUsers" SET "PasswordResetTokenHash" = NULL, "PasswordResetExpiresAtUtc" = NULL WHERE "Id" = ?', user.Id);
        throw problem(503, 'Password reset email could not be sent.');
      }
      if (cfg.isDevelopment()) developmentResetUrl = resetUrl;
    }

    return c.json(
      {
        message: 'If that email belongs to an administrator account, a password reset link is on its way.',
        developmentResetUrl,
      },
      202,
    );
  });

  app.post('/api/v1/auth/reset', rateLimit('auth-verify'), async (c) => {
    const req = await parseBody(c, resetSchema);
    const database = db(c);
    if (!req.token.trim() || req.token.length > 512) throw badRequest(RESET_INVALID);

    const tokenHash = hashToken(req.token);
    const user = await database.first<{ Id: string; Email: string | null; PasswordResetExpiresAtUtc: string | null }>(
      'SELECT "Id", "Email", "PasswordResetExpiresAtUtc" FROM "AppUsers" WHERE "PasswordResetTokenHash" = ?',
      tokenHash,
    );
    if (!user || user.PasswordResetExpiresAtUtc === null || Date.parse(user.PasswordResetExpiresAtUtc) <= Date.now()) {
      if (user) await database.run('UPDATE "AppUsers" SET "PasswordResetTokenHash" = NULL, "PasswordResetExpiresAtUtc" = NULL WHERE "Id" = ?', user.Id);
      throw badRequest(RESET_INVALID);
    }

    const password = await hashPassword(req.newPassword);
    // The token condition makes the link single-use even when two requests race.
    const updated = await database.run(
      'UPDATE "AppUsers" SET "PasswordHash" = ?, "PasswordSalt" = ?, "PasswordResetTokenHash" = NULL, "PasswordResetExpiresAtUtc" = NULL WHERE "Id" = ? AND "PasswordResetTokenHash" = ?',
      password.hash,
      password.salt,
      user.Id,
      tokenHash,
    );
    if (updated.changes === 0) throw badRequest(RESET_INVALID);
    if (user.Email?.trim()) await loginThrottle(database).reset(user.Email.trim().toLowerCase());

    return c.json({ message: 'Your password has been updated. Sign in with your new password.' });
  });
}
