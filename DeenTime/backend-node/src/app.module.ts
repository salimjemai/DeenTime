import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppConfig } from './config/configuration.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { RateLimitGuard } from './common/rate-limit.js';
import { CoreModule } from './core.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IqamaModule } from './modules/iqama/iqama.module.js';
import { OrganizationsModule } from './modules/organizations/organizations.module.js';
import { TimingsModule } from './modules/timings/timings.module.js';
import { HijriModule } from './modules/hijri/hijri.module.js';
import { DesignModule } from './modules/design/design.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { IslamicContentModule } from './modules/islamic-content/islamic-content.module.js';
import { ApiClientsModule } from './modules/api-clients/api-clients.module.js';
import { PublicContentModule } from './modules/public-content/public-content.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { AdminMasjidsModule } from './modules/admin-masjids/admin-masjids.module.js';
import { LocationsModule } from './modules/locations/locations.module.js';
import { PublishModule } from './modules/publish/publish.module.js';
import { PublicModule } from './modules/public/public.module.js';
import { StartupService } from './startup/startup.service.js';

@Module({})
export class AppModule {
  static register(config: AppConfig, options: { logging?: boolean } = {}): DynamicModule {
    const logging = options.logging ?? true;
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: logging ? (config.isDevelopment() ? 'debug' : 'info') : 'silent',
            autoLogging: logging,
            customSuccessMessage: (request, response, responseTime) =>
              `HTTP ${request.method} ${request.url?.split('?')[0]} responded ${response.statusCode} in ${responseTime.toFixed(1)} ms`,
            customErrorMessage: (request, response) => `HTTP ${request.method} ${request.url?.split('?')[0]} responded ${response.statusCode}`,
            serializers: { req: () => undefined, res: () => undefined },
            quietReqLogger: true,
          },
        }),
        CoreModule.forRoot(config),
        PrismaModule,
        IntegrationsModule,
        HealthModule,
        IqamaModule,
        OrganizationsModule,
        TimingsModule,
        HijriModule,
        DesignModule,
        IslamicContentModule,
        ApiClientsModule,
        PublicContentModule,
        AuthModule,
        AdminMasjidsModule,
        LocationsModule,
        PublishModule,
        PublicModule,
      ],
      providers: [
        StartupService,
        // Program.cs order: authentication (optional JWT middleware) → rate limiter → authorization.
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    };
  }
}
