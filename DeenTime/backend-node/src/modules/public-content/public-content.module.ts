import { Module } from '@nestjs/common';
import { IslamicContentProvidersModule } from '../../integrations/islamic-content/islamic-content-providers.module.js';
import { ApiClientsModule } from '../api-clients/api-clients.module.js';
import { PublicContentController } from './public-content.controller.js';

/** The anonymous /public/content API (Qur'an proxy, Qibla, Hadith library). */
@Module({
  imports: [IslamicContentProvidersModule, ApiClientsModule],
  controllers: [PublicContentController],
})
export class PublicContentModule {}
