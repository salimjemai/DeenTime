import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { Authorize, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { JwtService, type SessionUser } from '../../common/auth/jwt.service.js';
import { badRequest, conflict, problem, tooManyRequests, unauthorized, validationProblem } from '../../common/errors.js';
import { isGuid } from '../../common/json.js';
import { RateLimit } from '../../common/rate-limit.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { AppConfig } from '../../config/configuration.js';
import { DUMMY_PASSWORD, hashPassword, needsRehash, verifyPassword } from '../../domain/password-hasher.js';
import { base64Url, createSlug, hashToken, resolveUsTimeZone, tryCreateIdentity } from '../../domain/registration-identity.js';
import { RegistrationEmailSender } from '../../integrations/email.service.js';
import { ProviderUnavailableError } from '../../integrations/errors.js';
import { GoogleAddressService, type VerifiedAddress } from '../../integrations/google-address.service.js';
import { LoginThrottle } from '../../integrations/login-throttle.js';
import { PostalCodeService, type PostalCodeLocation } from '../../integrations/postal-code.service.js';
import { TurnstileService } from '../../integrations/turnstile.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { DEFAULT_IQAMA_HEADINGS } from '../../startup/startup.service.js';
import { isUniqueViolation } from '../organizations/organizations.controller.js';
import { frontendBaseUrl, isEmailDeliveryFailure, nullIfBlank } from './auth.helpers.js';
import {
  forgotSchema,
  loginSchema,
  registerSchema,
  resetSchema,
  verifyEmailSchema,
  type ForgotRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetRequest,
  type VerifyEmailRequest,
} from './auth.schemas.js';

const CAPTCHA_FAILED = { code: 'captcha_failed', message: 'Please complete the security verification and try again.' };
const RESET_INVALID = { code: 'reset_invalid', message: 'The password reset link is invalid or has expired. Request a new one.' };
const REGISTRATION_UNAVAILABLE = { code: 'registration_unavailable', message: 'This email or masjid is already registered or awaiting verification.' };
const ALREADY_REGISTERED = { code: 'registration_unavailable', message: 'This email or masjid has already been registered.' };
const ORGANIZATION_UNAVAILABLE = 'Organization unavailable';
/** Verification and password-reset links live for 30 minutes. */
const TOKEN_TTL_MS = 30 * 60_000;
/** U.S. zones that do not observe daylight saving time. */
const NON_DST_ZONES = new Set(['America/Phoenix', 'Pacific/Honolulu']);

/** Port of AuthController.cs: registration is by invitation only. */
@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: AppConfig,
    private readonly jwt: JwtService,
    private readonly captcha: TurnstileService,
    private readonly postalCodes: PostalCodeService,
    private readonly addresses: GoogleAddressService,
    private readonly emailSender: RegistrationEmailSender,
    private readonly throttle: LoginThrottle,
  ) {}

  @Get('config')
  config(): Record<string, unknown> {
    return {
      captchaEnabled: this.captcha.enabled,
      captchaSiteKey: this.captcha.enabled ? this.captcha.siteKey : null,
      addressAutocompleteEnabled: this.addresses.isEnabled,
      // Masjids are registered from an administrator invitation only; the sign-in
      // page shows these so anyone without an invitation knows whom to contact.
      registrationByInvitationOnly: true,
      supportEmail: nullIfBlank(this.configuration.get('Support:Email')),
      supportPhone: nullIfBlank(this.configuration.get('Support:Phone')),
      supportUrl: nullIfBlank(this.configuration.get('Support:Url')),
    };
  }

  @Get('invitations/:token')
  @RateLimit('auth-verify')
  async invitation(@Param('token') token: string): Promise<Record<string, unknown>> {
    const invalid = () => badRequest({ code: 'invitation_invalid', message: 'This invitation is invalid or has expired.' });
    if (!token?.trim() || token.length > 512) throw invalid();

    const invitation = await this.prisma.masjidInvitation.findFirst({ where: { invitationTokenHash: hashToken(token) } });
    if (!invitation || invitation.expiresAtUtc.getTime() <= Date.now() || invitation.revokedAtUtc !== null || invitation.acceptedAtUtc !== null) throw invalid();

    return {
      email: invitation.email,
      organizationName: invitation.organizationName,
      websiteUrl: invitation.websiteUrl,
      addressLine: invitation.addressLine,
      city: invitation.city,
      state: invitation.state,
      zipCode: invitation.zipCode,
      expiresAtUtc: invitation.expiresAtUtc,
    };
  }

  @Post('register')
  @RateLimit('auth-register')
  @HttpCode(202)
  async register(@Body(validated(registerSchema)) req: RegisterRequest, @Req() request: Request): Promise<Record<string, unknown>> {
    // Registration is by invitation only: the IqamaTime administrator invites a masjid
    // and the invited email completes the form from the link in that invitation.
    if (!req.invitationToken?.trim()) {
      throw badRequest({ code: 'invitation_required', message: 'Masjid registration is by invitation only. Contact the IqamaTime administrator to request an invitation.' });
    }
    if (!(await this.captcha.verify(req.captchaToken, 'register', request.socket.remoteAddress))) throw badRequest(CAPTCHA_FAILED);

    let addressLine = req.addressLine.trim();
    let city = req.city.trim();
    let state = req.state.trim();
    let zipCode = req.zipCode.trim();
    if (this.addresses.isEnabled) {
      if (!req.addressPlaceId?.trim()) throw validationProblem({ AddressPlaceId: ['Choose a verified address from the suggestions.'] });
      let verifiedAddress: VerifiedAddress | null;
      try {
        verifiedAddress = await this.addresses.resolve(req.addressPlaceId, null);
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

    const now = new Date();
    const invitation = await this.prisma.masjidInvitation.findFirst({ where: { invitationTokenHash: hashToken(req.invitationToken) } });
    if (!invitation || invitation.expiresAtUtc.getTime() <= now.getTime() || invitation.revokedAtUtc !== null || invitation.acceptedAtUtc !== null) {
      throw badRequest({ code: 'invitation_invalid', message: 'This invitation is invalid or has expired. Contact the IqamaTime administrator for a new one.' });
    }
    if (invitation.normalizedEmail !== identity.email) {
      throw badRequest({ code: 'invitation_email_mismatch', message: 'Register with the email address that received this invitation.' });
    }

    const postalCode = PostalCodeService.normalizeUsPostalCode(zipCode) ?? '';
    let location: PostalCodeLocation | null;
    try {
      location = await this.postalCodes.resolveUs(postalCode);
    } catch (error) {
      if (error instanceof ProviderUnavailableError) throw problem(503, 'Location verification is temporarily unavailable.');
      throw error;
    }
    if (!location) throw validationProblem({ ZipCode: ['That U.S. ZIP code could not be found.'] });
    if (location.stateAbbreviation.toUpperCase() !== state.toUpperCase()) throw validationProblem({ State: ['The state does not match the ZIP code.'] });

    await this.prisma.pendingRegistration.deleteMany({ where: { verificationExpiresAtUtc: { lte: new Date() } } });

    const existingEmail = await this.prisma.appUser.findFirst({ where: { email: identity.email }, select: { id: true } });
    const existingMasjid = await this.prisma.organization.findFirst({
      where: { OR: [{ normalizedWebsiteHost: identity.websiteHost }, { addressFingerprint: identity.addressFingerprint }, { masjidIdentityKey: identity.masjidIdentityKey }] },
      select: { id: true },
    });
    const pendingDuplicate = await this.prisma.pendingRegistration.findFirst({
      where: {
        OR: [
          { normalizedEmail: identity.email },
          { normalizedWebsiteHost: identity.websiteHost },
          { addressFingerprint: identity.addressFingerprint },
          { masjidIdentityKey: identity.masjidIdentityKey },
        ],
      },
      select: { id: true },
    });
    if (existingEmail || existingMasjid || pendingDuplicate) throw conflict(REGISTRATION_UNAVAILABLE);

    const rawToken = base64Url(randomBytes(32));
    const password = hashPassword(req.password);
    const pending = {
      id: randomUUID(),
      invitationId: invitation.id,
      email: identity.email,
      normalizedEmail: identity.email,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      organizationName: req.organizationName.trim(),
      normalizedName: identity.name,
      websiteUrl: identity.websiteUrl,
      normalizedWebsiteHost: identity.websiteHost,
      addressLine,
      city,
      state: location.stateAbbreviation,
      zipCode: location.postalCode,
      addressFingerprint: identity.addressFingerprint,
      masjidIdentityKey: identity.masjidIdentityKey,
      latitude: location.latitude,
      longitude: location.longitude,
      timezoneId: resolveUsTimeZone(location.stateAbbreviation, location.longitude),
      verificationTokenHash: hashToken(rawToken),
      verificationExpiresAtUtc: new Date(Date.now() + TOKEN_TTL_MS),
      createdAtUtc: new Date(),
    };
    try {
      await this.prisma.$transaction([
        this.prisma.pendingRegistration.create({ data: pending }),
        this.prisma.masjidInvitation.update({ where: { id: invitation.id }, data: { registrationStartedAtUtc: new Date() } }),
      ]);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict(REGISTRATION_UNAVAILABLE);
      throw error;
    }

    const verificationUrl = `${frontendBaseUrl(this.configuration)}/verify-email?token=${encodeURIComponent(rawToken)}`;
    try {
      await this.emailSender.sendVerification(pending.email, pending.organizationName, verificationUrl);
    } catch (error) {
      if (!isEmailDeliveryFailure(error)) throw error;
      await this.prisma.$transaction([
        this.prisma.pendingRegistration.deleteMany({ where: { id: pending.id } }),
        this.prisma.masjidInvitation.update({ where: { id: invitation.id }, data: { registrationStartedAtUtc: null } }),
      ]);
      throw problem(503, 'Verification email could not be sent.');
    }

    return {
      message: 'Check your email to verify the administrator account.',
      verificationRequired: true,
      developmentVerificationUrl: this.configuration.isDevelopment() ? verificationUrl : null,
    };
  }

  @Post('verify-email')
  @RateLimit('auth-verify')
  @HttpCode(200)
  async verifyEmail(@Body(validated(verifyEmailSchema)) req: VerifyEmailRequest): Promise<Record<string, unknown>> {
    const pending = await this.prisma.pendingRegistration.findFirst({ where: { verificationTokenHash: hashToken(req.token) } });
    if (!pending || pending.verificationExpiresAtUtc.getTime() <= Date.now()) {
      if (pending) await this.prisma.pendingRegistration.delete({ where: { id: pending.id } });
      throw badRequest({ code: 'verification_invalid', message: 'The verification link is invalid or has expired.' });
    }

    const duplicateUser = await this.prisma.appUser.findFirst({ where: { email: pending.normalizedEmail }, select: { id: true } });
    const duplicateMasjid = duplicateUser
      ? null
      : await this.prisma.organization.findFirst({
          where: {
            OR: [
              { normalizedWebsiteHost: pending.normalizedWebsiteHost },
              { addressFingerprint: pending.addressFingerprint },
              { masjidIdentityKey: pending.masjidIdentityKey },
            ],
          },
          select: { id: true },
        });
    if (duplicateUser || duplicateMasjid) throw conflict(ALREADY_REGISTERED);

    const user = { id: randomUUID(), email: pending.normalizedEmail, displayName: pending.email, passwordHash: pending.passwordHash, passwordSalt: pending.passwordSalt };
    try {
      await this.prisma.$transaction(async (tx) => {
        const slugBase = createSlug(pending.organizationName);
        const slugTaken = await tx.organization.findFirst({ where: { slug: slugBase }, select: { id: true } });
        const slug = slugTaken ? `${slugBase}-${randomBytes(2).toString('hex')}` : slugBase;
        const organizationId = randomUUID();

        await tx.appUser.create({ data: user });
        await tx.organization.create({
          data: {
            id: organizationId,
            slug,
            name: pending.organizationName,
            normalizedName: pending.normalizedName,
            websiteUrl: pending.websiteUrl,
            normalizedWebsiteHost: pending.normalizedWebsiteHost,
            addressLine: pending.addressLine,
            city: pending.city,
            state: pending.state,
            zipCode: pending.zipCode,
            email: pending.email,
            addressFingerprint: pending.addressFingerprint,
            masjidIdentityKey: pending.masjidIdentityKey,
            adminUserId: user.id,
            updatedAtUtc: new Date(),
          },
        });
        if (pending.invitationId !== null) {
          await tx.masjidInvitation.updateMany({ where: { id: pending.invitationId }, data: { acceptedAtUtc: new Date(), organizationId } });
        }
        await tx.orgUser.create({
          data: {
            id: randomUUID(),
            organizationId,
            issuer: this.configuration.get('Auth:Issuer') ?? 'local',
            subject: user.id,
            email: pending.email,
            displayName: pending.email,
            roles: ['Admin'],
            lastSeenUtc: new Date(),
          },
        });
        await tx.prayerTimingCriteria.create({
          data: {
            id: randomUUID(),
            organizationId,
            method: 'ISNA',
            juristicMethodAsr: 'Other',
            latitude: pending.latitude,
            longitude: pending.longitude,
            timezoneId: pending.timezoneId,
            dstObserved: !NON_DST_ZONES.has(pending.timezoneId),
            zipCode: pending.zipCode,
            minutesAfterZawal: 5,
            minutesAfterMaghrib: 1,
            khutbahTimeMinutes: 20,
            updatedAtUtc: new Date(),
          },
        });
        await tx.designSettings.create({
          data: {
            id: randomUUID(),
            organizationId,
            iqamaHeadings: DEFAULT_IQAMA_HEADINGS,
            footerHtml: `© ${new Date().getUTCFullYear()} ${pending.organizationName} · IqamaTime`,
            theme: 'default',
            updatedAtUtc: new Date(),
          },
        });
        await tx.pendingRegistration.delete({ where: { id: pending.id } });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict(ALREADY_REGISTERED);
      throw error;
    }

    // Verification activates the account but deliberately does not sign the browser
    // in: the administrator signs in with the password they chose, which also proves
    // the credentials work before the masjid dashboard is opened for the first time.
    return {
      verified: true,
      email: user.email,
      organizationName: pending.organizationName,
      message: 'Your email is verified. Sign in with the password you chose to open your masjid dashboard.',
    };
  }

  @Post('login')
  @RateLimit('auth-login')
  @HttpCode(200)
  async login(@Body(validated(loginSchema)) req: LoginRequest, @Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<{ token: string }> {
    if (!(await this.captcha.verify(req.captchaToken, 'login', request.socket.remoteAddress))) throw badRequest(CAPTCHA_FAILED);

    const email = req.email.trim().toLowerCase();
    const attempt = this.throttle.canAttempt(email);
    if (!attempt.allowed) {
      response.setHeader('Retry-After', String(attempt.retryAfterSeconds));
      throw tooManyRequests({ message: 'Too many failed attempts. Try again later.' });
    }

    const user = await this.prisma.appUser.findFirst({ where: { email } });
    const passwordValid = user ? verifyPassword(req.password, user.passwordHash, user.passwordSalt) : verifyPassword(req.password, DUMMY_PASSWORD.hash, DUMMY_PASSWORD.salt);
    if (!user || !passwordValid) {
      this.throttle.recordFailure(email);
      throw unauthorized();
    }

    const membership = await this.prisma.orgUser.findFirst({ where: { subject: user.id }, include: { organization: true } });
    if (!membership?.organization) throw problem(403, ORGANIZATION_UNAVAILABLE, 'This account is not assigned to an active organization.');
    let roles = membership.roles ?? [];
    const superUser = roles.some((role) => role.toLowerCase() === 'superuser');
    if (!superUser && membership.organization.adminUserId !== user.id) roles = roles.filter((role) => role.toLowerCase() !== 'admin');

    if (needsRehash(user.passwordHash)) {
      const rehashed = hashPassword(req.password);
      await this.prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: rehashed.hash, passwordSalt: rehashed.salt } });
    }
    this.throttle.reset(email);
    return { token: this.jwt.issue(user, membership.organizationId, roles) };
  }

  @Get('session')
  @Authorize()
  async session(@CurrentUser() user: SessionUser | null): Promise<Record<string, unknown>> {
    const subject = user?.sub?.trim() ? user.sub : null;
    if (!user || subject === null) throw unauthorized();
    if (!user.orgId || !isGuid(user.orgId)) throw problem(403, ORGANIZATION_UNAVAILABLE, 'The session does not contain an active organization.');

    const where: { subject: string; organizationId: string; issuer?: string } = { subject, organizationId: user.orgId.toLowerCase() };
    if (user.issuer?.trim()) where.issuer = user.issuer;
    const membership = await this.prisma.orgUser.findFirst({ where, include: { organization: true } });
    if (!membership?.organization) throw problem(403, ORGANIZATION_UNAVAILABLE, 'Your session no longer has access to this organization.');

    await this.prisma.orgUser.update({ where: { id: membership.id }, data: { lastSeenUtc: new Date() } });
    return {
      userId: subject,
      email: membership.email,
      displayName: membership.displayName,
      organizationId: membership.organization.id,
      organizationSlug: membership.organization.slug,
      organizationName: membership.organization.name,
      roles: membership.roles ?? [],
    };
  }

  @Post('forgot')
  @RateLimit('auth-register')
  @HttpCode(202)
  async forgot(@Body(validated(forgotSchema)) req: ForgotRequest): Promise<Record<string, unknown>> {
    // The response is the same whether or not the email has an account, so the
    // endpoint cannot be used to discover registered administrators.
    const email = req.email.trim().toLowerCase();
    const user = await this.prisma.appUser.findFirst({ where: { email } });
    let developmentResetUrl: string | null = null;
    if (user) {
      const rawToken = base64Url(randomBytes(32));
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: { passwordResetTokenHash: hashToken(rawToken), passwordResetExpiresAtUtc: new Date(Date.now() + TOKEN_TTL_MS) },
      });

      const resetUrl = `${frontendBaseUrl(this.configuration)}/reset-password?token=${encodeURIComponent(rawToken)}`;
      try {
        await this.emailSender.sendPasswordReset(user.email ?? email, resetUrl);
      } catch (error) {
        if (!isEmailDeliveryFailure(error)) throw error;
        await this.prisma.appUser.update({ where: { id: user.id }, data: { passwordResetTokenHash: null, passwordResetExpiresAtUtc: null } });
        throw problem(503, 'Password reset email could not be sent.');
      }
      if (this.configuration.isDevelopment()) developmentResetUrl = resetUrl;
    }

    return {
      message: 'If that email belongs to an administrator account, a password reset link is on its way.',
      developmentResetUrl,
    };
  }

  @Post('reset')
  @RateLimit('auth-verify')
  @HttpCode(200)
  async reset(@Body(validated(resetSchema)) req: ResetRequest): Promise<{ message: string }> {
    if (!req.token.trim() || req.token.length > 512) throw badRequest(RESET_INVALID);

    const user = await this.prisma.appUser.findFirst({ where: { passwordResetTokenHash: hashToken(req.token) } });
    if (!user || user.passwordResetExpiresAtUtc === null || user.passwordResetExpiresAtUtc.getTime() <= Date.now()) {
      if (user) await this.prisma.appUser.update({ where: { id: user.id }, data: { passwordResetTokenHash: null, passwordResetExpiresAtUtc: null } });
      throw badRequest(RESET_INVALID);
    }

    const password = hashPassword(req.newPassword);
    await this.prisma.appUser.update({
      where: { id: user.id },
      data: { passwordHash: password.hash, passwordSalt: password.salt, passwordResetTokenHash: null, passwordResetExpiresAtUtc: null },
    });
    if (user.email?.trim()) this.throttle.reset(user.email.trim().toLowerCase());

    return { message: 'Your password has been updated. Sign in with your new password.' };
  }
}
