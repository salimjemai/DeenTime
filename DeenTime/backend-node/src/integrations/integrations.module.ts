import { Global, Module } from '@nestjs/common';
import { RegistrationEmailSender } from './email.service.js';
import { GoogleAddressService } from './google-address.service.js';
import { LoginThrottle } from './login-throttle.js';
import { PostalCodeService } from './postal-code.service.js';
import { STORAGE_SERVICE, storageProvider } from './storage.service.js';
import { TurnstileService } from './turnstile.service.js';

/**
 * Third-party integrations registered as singletons in Program.cs: ZIP lookup,
 * Google Places, Cloudflare Turnstile, SMTP delivery, file storage and the login
 * throttle. Requires AppConfig from CoreModule.
 */
@Global()
@Module({
  providers: [PostalCodeService, GoogleAddressService, TurnstileService, RegistrationEmailSender, LoginThrottle, storageProvider],
  exports: [PostalCodeService, GoogleAddressService, TurnstileService, RegistrationEmailSender, LoginThrottle, STORAGE_SERVICE],
})
export class IntegrationsModule {}
