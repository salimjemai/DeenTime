import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { delay } from '../../integrations/islamic-content/provider-http.js';
import { IslamicContentSyncService } from './islamic-content-sync.service.js';
import { IslamicContentSyncQueue } from './sync-queue.js';

/**
 * IslamicContentSyncWorker (BackgroundService): drains the sync queue in the
 * background, one request at a time, without blocking application start-up.
 */
@Injectable()
export class IslamicContentSyncWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(IslamicContentSyncWorker.name);
  private readonly stopping = new AbortController();
  private loop: Promise<void> | null = null;

  constructor(
    private readonly queue: IslamicContentSyncQueue,
    private readonly syncService: IslamicContentSyncService,
  ) {}

  onApplicationBootstrap(): void {
    this.loop = this.consume();
  }

  async onModuleDestroy(): Promise<void> {
    this.stopping.abort();
    if (this.loop) await Promise.race([this.loop, delay(5_000)]);
  }

  private async consume(): Promise<void> {
    const signal = this.stopping.signal;
    try {
      for await (const request of this.queue.readAll(signal)) {
        try {
          await this.syncService.run(request, signal);
        } catch (error) {
          if (signal.aborted) return;
          this.logger.error(
            `Islamic content synchronization failed for ${request.provider} (${request.scope})`,
            error instanceof Error ? error.stack : String(error),
          );
        } finally {
          this.queue.markCompleted(request.provider);
        }
      }
    } catch (error) {
      this.logger.error('The Islamic content sync worker stopped unexpectedly', error instanceof Error ? error.stack : String(error));
    }
  }
}
