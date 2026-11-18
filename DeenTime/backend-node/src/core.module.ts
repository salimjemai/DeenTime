import { Global, Module, type DynamicModule } from '@nestjs/common';
import { AppConfig } from './config/configuration.js';
import { JwtService } from './common/auth/jwt.service.js';
import { ClientAddressResolver } from './common/client-address.js';
import { RateLimitStore } from './common/rate-limit.js';

/** Configuration and cross-cutting singletons available to every module. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [{ provide: AppConfig, useValue: config }, JwtService, RateLimitStore, ClientAddressResolver],
      exports: [AppConfig, JwtService, RateLimitStore, ClientAddressResolver],
    };
  }
}
