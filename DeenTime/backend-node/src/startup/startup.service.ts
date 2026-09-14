import { Injectable, Logger } from '@nestjs/common';
import { randomUUID, randomBytes } from 'node:crypto';
import { AppConfig } from '../config/configuration.js';
import { hashPassword, verifyPassword } from '../domain/password-hasher.js';
import { normalizeWords, tryCreateIdentity } from '../domain/registration-identity.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const DEFAULT_IQAMA_HEADINGS = ['FAJR', 'IQM*', 'SUNRISE', 'DUHUR', 'IQM*', 'ASR', 'IQM*', 'SUNSET', 'ISHA', 'IQM*'];

/**
 * Port of SeedSuperUserAsync: migrate, backfill organization identity, then make
 * the SuperUser configuration section authoritative for the IqamaTime
 * administrator account (create, rename, grant, or rotate the password).
 */
@Injectable()
export class StartupService {
  private readonly logger = new Logger(StartupService.name);

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async run(): Promise<void> {
    await this.prisma.migrations.migrate();
    await this.backfillOrganizations();
    await this.seedSuperUser();
  }

  private async backfillOrganizations(): Promise<void> {
    const organizations = await this.prisma.organization.findMany();
    const adminMemberships = await this.prisma.orgUser.findMany({ where: { roles: { has: 'Admin' } }, orderBy: { id: 'asc' } });
    for (const organization of organizations) {
      const adminUserId = organization.adminUserId ?? adminMemberships.find((membership) => membership.organizationId === organization.id)?.subject ?? null;
      await this.prisma.organization.update({
        where: { id: organization.id },
        data: { adminUserId, ...identityBackfill(organization) },
      });
    }
  }

  private async seedSuperUser(): Promise<void> {
    const configuredEmail = this.config.get('SuperUser:Email');
    const password = this.config.get('SuperUser:Password');
    const orgName = this.config.getOrDefault('SuperUser:OrgName', 'Super Org');
    if (!configuredEmail?.trim() || !password?.trim()) return;
    const email = configuredEmail.trim().toLowerCase();

    let user = await this.prisma.appUser.findFirst({ where: { email } });
    if (!user) {
      const seeded = await this.findSeededSuperUserMembership();
      if (seeded) {
        const seededUser = await this.prisma.appUser.findFirst({ where: { id: seeded.subject } });
        if (seededUser) {
          this.logger.log(`Super user email changed from ${seededUser.email} to ${email}`);
          user = await this.prisma.appUser.update({ where: { id: seededUser.id }, data: { email } });
          await this.prisma.orgUser.update({ where: { id: seeded.id }, data: { email } });
        }
      }
    }

    if (user) {
      const membership = await this.prisma.orgUser.findFirst({ where: { subject: user.id }, include: { organization: true } });
      if (membership) {
        const roles = membership.roles ?? [];
        if (!roles.some((role) => role.toLowerCase() === 'superuser')) {
          const merged = [...roles];
          for (const role of ['Admin', 'SuperUser']) if (!merged.some((item) => item.toLowerCase() === role.toLowerCase())) merged.push(role);
          await this.prisma.orgUser.update({ where: { id: membership.id }, data: { roles: merged } });
          this.logger.log(`Granted the SuperUser role to ${email}`);
        }
        if (membership.organization) {
          await this.prisma.organization.update({
            where: { id: membership.organization.id },
            data: { adminUserId: membership.organization.adminUserId ?? user.id, ...identityBackfill(membership.organization) },
          });
        }
      } else {
        await this.createSuperUserOrganization(user, orgName, await this.uniqueSlug('admin'));
      }
      if (!verifyPassword(password, user.passwordHash, user.passwordSalt)) {
        const rotated = hashPassword(password);
        await this.prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: rotated.hash, passwordSalt: rotated.salt } });
        this.logger.log(`Super user password updated from configuration for ${email}`);
      }
      return;
    }

    const hashed = hashPassword(password);
    user = await this.prisma.appUser.create({
      data: { id: randomUUID(), email, displayName: 'Super User', passwordHash: hashed.hash, passwordSalt: hashed.salt },
    });
    await this.createSuperUserOrganization(user, orgName, await this.uniqueSlug('admin'));
    this.logger.log(`Super user seeded: ${email}`);
  }

  private async findSeededSuperUserMembership() {
    const superUsers = await this.prisma.orgUser.findMany({ where: { roles: { has: 'SuperUser' } }, include: { organization: true } });
    return superUsers.find((item) => item.organization?.slug === 'admin') ?? (superUsers.length === 1 ? superUsers[0] : null);
  }

  private async uniqueSlug(slug: string): Promise<string> {
    const taken = await this.prisma.organization.findFirst({ where: { slug } });
    return taken ? `${slug}-${randomBytes(2).toString('hex')}` : slug;
  }

  private async createSuperUserOrganization(user: { id: string; email: string | null; displayName: string | null }, orgName: string, slug: string): Promise<void> {
    const cfg = this.config;
    const organization = {
      id: randomUUID(),
      slug,
      name: orgName,
      normalizedName: normalizeWords(orgName),
      addressLine: cfg.get('SuperUser:AddressLine') ?? null,
      city: cfg.get('SuperUser:City') ?? null,
      state: cfg.get('SuperUser:State') ?? null,
      zipCode: cfg.get('SuperUser:ZipCode') ?? null,
      phone: cfg.get('SuperUser:Phone') ?? null,
      email: cfg.get('SuperUser:OrgEmail') ?? user.email,
      websiteUrl: cfg.get('SuperUser:WebsiteUrl') ?? null,
      socialUrl: cfg.get('SuperUser:SocialUrl') ?? null,
      adminUserId: user.id,
      updatedAtUtc: new Date(),
    };
    await this.prisma.organization.create({ data: { ...organization, ...identityBackfill(organization) } });

    const latitude = cfg.get('SuperUser:Latitude');
    const longitude = cfg.get('SuperUser:Longitude');
    if (latitude && longitude) {
      await this.prisma.prayerTimingCriteria.create({
        data: {
          id: randomUUID(),
          organizationId: organization.id,
          method: cfg.getOrDefault('SuperUser:Method', 'ISNA'),
          juristicMethodAsr: cfg.getOrDefault('SuperUser:JuristicMethodAsr', 'Other'),
          latitude,
          longitude,
          timezoneId: cfg.getOrDefault('SuperUser:TimezoneId', 'America/Chicago'),
          dstObserved: true,
          zipCode: organization.zipCode ?? '',
          minutesAfterZawal: cfg.getInt('SuperUser:MinutesAfterZawal', 5),
          minutesAfterMaghrib: cfg.getInt('SuperUser:MinutesAfterMaghrib', 1),
          khutbahTimeMinutes: cfg.getInt('SuperUser:KhutbahTimeMinutes', 20),
          updatedAtUtc: new Date(),
        },
      });
    }

    await this.prisma.designSettings.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        iqamaHeadings: DEFAULT_IQAMA_HEADINGS,
        footerHtml: `© ${new Date().getUTCFullYear()} ${orgName} · IqamaTime`,
        theme: 'default',
        updatedAtUtc: new Date(),
      },
    });

    await this.prisma.orgUser.create({
      data: {
        id: randomUUID(),
        organizationId: organization.id,
        issuer: cfg.getOrDefault('Auth:Issuer', 'local'),
        subject: user.id,
        email: user.email,
        displayName: user.displayName,
        roles: ['Admin', 'SuperUser'],
        lastSeenUtc: new Date(),
      },
    });
  }
}

/** BackfillOrganizationIdentity: recompute NormalizedName and, when the address is complete, the fingerprints. */
export function identityBackfill(organization: {
  name: string;
  email: string | null;
  websiteUrl: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}): { normalizedName: string; normalizedWebsiteHost?: string; addressFingerprint?: string; masjidIdentityKey?: string } {
  const result: { normalizedName: string; normalizedWebsiteHost?: string; addressFingerprint?: string; masjidIdentityKey?: string } = {
    normalizedName: normalizeWords(organization.name),
  };
  if (!organization.websiteUrl?.trim() || !organization.addressLine?.trim() || !organization.city?.trim() || !organization.state?.trim() || !organization.zipCode?.trim()) {
    return result;
  }
  const identity = tryCreateIdentity(organization.email ?? '', organization.name, organization.websiteUrl, organization.addressLine, organization.city, organization.state, organization.zipCode);
  if (!identity) return result;
  result.normalizedWebsiteHost = identity.websiteHost;
  result.addressFingerprint = identity.addressFingerprint;
  result.masjidIdentityKey = identity.masjidIdentityKey;
  return result;
}
