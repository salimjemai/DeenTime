import { Module } from '@nestjs/common';
import { IslamicContentProvidersModule } from '../../integrations/islamic-content/islamic-content-providers.module.js';
import { IslamicContentController } from './islamic-content.controller.js';
import { IslamicContentSyncService } from './islamic-content-sync.service.js';
import { JobsController } from './jobs.controller.js';
import { IslamicContentSyncQueue } from './sync-queue.js';
import { IslamicContentSyncWorker } from './sync-worker.js';

/** Super-user content administration: /api/v1/islamic-content and the /jobs status page. */
@Module({
  imports: [IslamicContentProvidersModule],
  controllers: [IslamicContentController, JobsController],
  providers: [IslamicContentSyncQueue, IslamicContentSyncService, IslamicContentSyncWorker],
  exports: [IslamicContentSyncQueue, IslamicContentSyncService, IslamicContentProvidersModule],
})
export class IslamicContentModule {}
