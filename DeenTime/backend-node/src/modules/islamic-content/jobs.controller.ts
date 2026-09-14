import { Controller, Get } from '@nestjs/common';
import { Authorize } from '../../common/auth/authorize.decorator.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IslamicContentSyncQueue } from './sync-queue.js';
import { toSyncStateJson } from './sync-state.js';

/**
 * Replaces the Hangfire dashboard that Program.cs mounted at /jobs for super users:
 * the providers with a synchronization queued or running plus every sync state.
 */
@Controller('jobs')
@Authorize('SuperUser')
export class JobsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncQueue: IslamicContentSyncQueue,
  ) {}

  @Get()
  async jobs() {
    const states = await this.prisma.islamicContentSyncState.findMany({ orderBy: { provider: 'asc' } });
    return { queued: this.syncQueue.queued(), syncStates: states.map(toSyncStateJson) };
  }
}
