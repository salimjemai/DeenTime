import type { TestingModuleBuilder } from '@nestjs/testing';
import { PostalCodeService } from '../../src/integrations/postal-code.service.js';
import { RegistrationEmailSender } from '../../src/integrations/email.service.js';
import { QiblaProviderClient } from '../../src/integrations/islamic-content/qibla-provider.client.js';

/** The stub responses used by backend/DeenTime.Api.Tests/ApiIntegrationTests.cs. */
export const CEDAR_PARK = {
  postalCode: '78613',
  city: 'Cedar Park',
  state: 'Texas',
  stateAbbreviation: 'TX',
  country: 'United States',
  latitude: 30.5052,
  longitude: -97.8203,
};

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class CapturingEmailSender {
  readonly enabled = false;
  lastVerificationUrl: string | null = null;
  lastInvitationUrl: string | null = null;
  lastPasswordResetUrl: string | null = null;

  async sendVerification(_email: string, _organizationName: string, verificationUrl: string): Promise<void> {
    this.lastVerificationUrl = verificationUrl;
  }

  async sendInvitation(_email: string, _organizationName: string, invitationUrl: string): Promise<void> {
    this.lastInvitationUrl = invitationUrl;
  }

  async sendPasswordReset(_email: string, resetUrl: string): Promise<void> {
    this.lastPasswordResetUrl = resetUrl;
  }
}

export interface Stubs {
  email: CapturingEmailSender;
}

/** Replaces the external services exactly like the .NET test factory does. */
export function withStubs(stubs: Stubs) {
  return (builder: TestingModuleBuilder): TestingModuleBuilder =>
    builder
      .overrideProvider(PostalCodeService)
      .useValue({ resolveUs: async () => CEDAR_PARK })
      .overrideProvider(RegistrationEmailSender)
      .useValue(stubs.email)
      .overrideProvider(QiblaProviderClient)
      .useValue({
        getDirection: async (latitude: number, longitude: number) => ({
          data: { latitude, longitude, direction: 43.36991455214116 },
          fromCache: false,
          retrievedAtUtc: new Date(),
        }),
        getCompass: async () => ({ content: PNG_SIGNATURE, contentType: 'image/png', retrievedAtUtc: new Date() }),
      });
}
