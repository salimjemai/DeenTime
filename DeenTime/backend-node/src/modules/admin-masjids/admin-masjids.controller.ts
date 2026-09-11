import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes, randomUUID } from 'node:crypto';
import { Authorize, CurrentUser } from '../../common/auth/authorize.decorator.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { conflict, notFound, problem, validationProblem } from '../../common/errors.js';
import { isGuid } from '../../common/json.js';
import { RateLimit } from '../../common/rate-limit.js';
import { validated } from '../../common/zod-validation.pipe.js';
import { AppConfig } from '../../config/configuration.js';
import { base64Url, hashToken, normalizeWords } from '../../domain/registration-identity.js';
import { RegistrationEmailSender } from '../../integrations/email.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { frontendBaseUrl, isEmailDeliveryFailure, nullIfBlank } from '../auth/auth.helpers.js';
import { buildDashboard, normalizeOptionalWebsite, type MasjidDashboard } from './admin-masjids.helpers.js';
import { createInvitationSchema, type CreateInvitationRequest } from './admin-masjids.schemas.js';

/** Invitations are valid for 7 days. */
const INVITATION_TTL_MS = 7 * 24 * 60 * 60_000;
const INVITATION_EMAIL_FAILED = 'Invitation email could not be sent.';

/** Port of AdminMasjidsController.cs. */
@Controller('api/v1/admin/masjids')
@Authorize('SuperUser')
export class AdminMasjidsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configuration: AppConfig,
    private readonly emailSender: RegistrationEmailSender,
  ) {}

  @Get()
  async list(): Promise<MasjidDashboard> {
    const now = new Date();
    const invitations = await this.prisma.masjidInvitation.findMany();
    const pending = await this.prisma.pendingRegistration.findMany({
      where: { invitationId: { not: null }, verificationExpiresAtUtc: { gt: now } },
      select: { invitationId: true },
    });
    const organizations = await this.prisma.organization.findMany();
    const memberships = await this.prisma.orgUser.findMany();
    return buildDashboard({
      invitations,
      pendingInvitationIds: pending.map((item) => item.invitationId).filter((id): id is string => id !== null),
      organizations,
      memberships,
      now,
    });
  }

  @Post('invitations')
  @RateLimit('expensive')
  async invite(
    @CurrentUser() user: SessionUser | null,
    @Body(validated(createInvitationSchema)) request: CreateInvitationRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown>> {
    const email = request.email.trim().toLowerCase();
    const normalizedName = normalizeWords(request.organizationName);
    const now = new Date();
    const activeInvite = await this.prisma.masjidInvitation.findFirst({
      where: { normalizedEmail: email, acceptedAtUtc: null, revokedAtUtc: null, expiresAtUtc: { gt: now } },
      select: { id: true },
    });
    const registeredUser = await this.prisma.appUser.findFirst({ where: { email }, select: { id: true } });
    const registeredMasjid = registeredUser ? null : await this.prisma.organization.findFirst({ where: { normalizedName }, select: { id: true } });
    const pendingRegistration = await this.prisma.pendingRegistration.findFirst({ where: { normalizedEmail: email }, select: { id: true } });
    if (activeInvite || registeredUser || registeredMasjid || pendingRegistration) {
      throw conflict({ code: 'invitation_unavailable', message: 'This email or masjid is already registered, invited, or awaiting verification.' });
    }

    const website = normalizeOptionalWebsite(request.websiteUrl);
    if (request.websiteUrl?.trim() && website === null) throw validationProblem({ WebsiteUrl: ['Enter a valid masjid website address.'] });
    if (website !== null) {
      const taken = await this.prisma.organization.findFirst({ where: { normalizedWebsiteHost: new URL(website).hostname }, select: { id: true } });
      if (taken) throw conflict({ code: 'invitation_unavailable', message: 'This masjid website is already registered.' });
    }

    const rawToken = base64Url(randomBytes(32));
    const invitation = await this.prisma.masjidInvitation.create({
      data: {
        id: randomUUID(),
        email,
        normalizedEmail: email,
        organizationName: request.organizationName.trim(),
        normalizedOrganizationName: normalizedName,
        websiteUrl: website,
        addressLine: nullIfBlank(request.addressLine),
        city: nullIfBlank(request.city),
        state: nullIfBlank(request.state)?.toUpperCase() ?? null,
        zipCode: nullIfBlank(request.zipCode),
        invitationTokenHash: hashToken(rawToken),
        invitedBySubject: user?.sub ? user.sub : 'unknown',
        createdAtUtc: now,
        sentAtUtc: now,
        expiresAtUtc: new Date(now.getTime() + INVITATION_TTL_MS),
        sendCount: 1,
      },
    });

    const invitationUrl = this.invitationUrl(rawToken);
    try {
      await this.emailSender.sendInvitation(email, invitation.organizationName, invitationUrl);
    } catch (error) {
      if (!isEmailDeliveryFailure(error)) throw error;
      await this.prisma.masjidInvitation.deleteMany({ where: { id: invitation.id } });
      throw problem(503, INVITATION_EMAIL_FAILED);
    }

    response.status(201).setHeader('Location', `/api/v1/admin/masjids/invitations/${invitation.id}`);
    return {
      id: invitation.id,
      email: invitation.email,
      organizationName: invitation.organizationName,
      status: 'InvitationSent',
      expiresAtUtc: invitation.expiresAtUtc,
      emailDelivered: this.emailSender.enabled,
      invitationUrl: this.shareableInvitationUrl(invitationUrl),
    };
  }

  @Post('invitations/:id/resend')
  @RateLimit('expensive')
  @HttpCode(200)
  async resend(@Param('id') id: string): Promise<Record<string, unknown>> {
    const invitation = isGuid(id) ? await this.prisma.masjidInvitation.findFirst({ where: { id } }) : null;
    if (!invitation) throw notFound();
    if (invitation.acceptedAtUtc !== null || invitation.revokedAtUtc !== null) throw conflict({ message: 'A completed or revoked invitation cannot be resent.' });
    const activeVerification = await this.prisma.pendingRegistration.findFirst({
      where: { invitationId: invitation.id, verificationExpiresAtUtc: { gt: new Date() } },
      select: { id: true },
    });
    if (activeVerification) throw conflict({ message: 'This masjid already has an active email-verification link.' });

    const rawToken = base64Url(randomBytes(32));
    const now = new Date();
    const data = {
      invitationTokenHash: hashToken(rawToken),
      sentAtUtc: now,
      expiresAtUtc: new Date(now.getTime() + INVITATION_TTL_MS),
      registrationStartedAtUtc: null,
      sendCount: invitation.sendCount + 1,
    };

    const invitationUrl = this.invitationUrl(rawToken);
    try {
      await this.emailSender.sendInvitation(invitation.email, invitation.organizationName, invitationUrl);
    } catch (error) {
      if (!isEmailDeliveryFailure(error)) throw error;
      throw problem(503, INVITATION_EMAIL_FAILED);
    }
    await this.prisma.masjidInvitation.update({ where: { id: invitation.id }, data });

    return {
      message: 'Invitation resent.',
      expiresAtUtc: data.expiresAtUtc,
      emailDelivered: this.emailSender.enabled,
      invitationUrl: this.shareableInvitationUrl(invitationUrl),
    };
  }

  @Post('invitations/:id/revoke')
  @HttpCode(204)
  async revoke(@Param('id') id: string): Promise<void> {
    const invitation = isGuid(id) ? await this.prisma.masjidInvitation.findFirst({ where: { id } }) : null;
    if (!invitation) throw notFound();
    if (invitation.acceptedAtUtc !== null) throw conflict({ message: 'A completed invitation cannot be revoked.' });
    await this.prisma.$transaction([
      this.prisma.masjidInvitation.update({ where: { id: invitation.id }, data: { revokedAtUtc: invitation.revokedAtUtc ?? new Date() } }),
      this.prisma.pendingRegistration.deleteMany({ where: { invitationId: invitation.id } }),
    ]);
  }

  private invitationUrl(rawToken: string): string {
    return `${frontendBaseUrl(this.configuration)}/login?invite=${encodeURIComponent(rawToken)}`;
  }

  /**
   * The raw invitation link is handed back to the super user only when it was not
   * emailed (no mail server configured) so it can be passed on by hand, or in Development.
   */
  private shareableInvitationUrl(invitationUrl: string): string | null {
    return this.configuration.isDevelopment() || !this.emailSender.enabled ? invitationUrl : null;
  }
}
