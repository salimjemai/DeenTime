import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../../config/configuration.js';
import { HadithProviderClient } from './hadith-provider.client.js';
import { IslamicContentOptions } from './islamic-content-options.js';
import { QiblaProviderClient } from './qibla-provider.client.js';
import { QuranProviderClient } from './quran-provider.client.js';

/**
 * The IslamicContentOptions binding and the three typed provider clients from
 * Program.cs. Imported by the admin (IslamicContentModule) and public
 * (PublicContentModule) modules; the clients are singletons shared by both.
 */
@Module({
  providers: [
    { provide: IslamicContentOptions, useFactory: (config: AppConfig) => IslamicContentOptions.fromConfig(config), inject: [AppConfig] },
    QuranProviderClient,
    QiblaProviderClient,
    HadithProviderClient,
  ],
  exports: [IslamicContentOptions, QuranProviderClient, QiblaProviderClient, HadithProviderClient],
})
export class IslamicContentProvidersModule implements OnModuleInit {
  private readonly logger = new Logger(IslamicContentProvidersModule.name);

  constructor(private readonly options: IslamicContentOptions) {}

  onModuleInit(): void {
    if (!this.options.isHadithConfigured) {
      this.logger.warn(
        'Hadith provider is not configured. Set IslamicContent__HadithApiKey through a secret store or environment variable; it will never be returned to clients.',
      );
    }
  }
}
