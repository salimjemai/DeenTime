import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from '../../config/configuration.js';
import { buildInfo, CURRENT_SCHEMA_VERSION } from '../../domain/build-info.js';
import { PrismaService } from '../../prisma/prisma.service.js';

interface DatabaseReadinessResult {
  ready: boolean;
  status: 'ready' | 'migrations-pending' | 'unavailable';
  detail: string | null;
  schemaVersion: string;
  pendingMigrations: string[];
}

/** /health/live, /health/ready and /api/version (minimal APIs in Program.cs). */
@Controller()
export class HealthController {
  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  @Get('health/live')
  live() {
    return { status: 'live' };
  }

  @Get('health/ready')
  async ready(@Res() response: Response): Promise<void> {
    const result = await this.check();
    response.status(result.ready ? 200 : 503).json(result);
  }

  @Get('api/version')
  version() {
    return buildInfo(this.config, process.argv[1]);
  }

  private async check(): Promise<DatabaseReadinessResult> {
    const unavailable = (detail: string): DatabaseReadinessResult => ({
      ready: false,
      status: 'unavailable',
      detail,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pendingMigrations: [],
    });
    try {
      if (!(await this.prisma.canConnect())) return unavailable('The database connection is unavailable.');
      const pending = await this.prisma.migrations.pending();
      return {
        ready: pending.length === 0,
        status: pending.length === 0 ? 'ready' : 'migrations-pending',
        detail: pending.length === 0 ? null : 'The database has not completed all application migrations.',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        pendingMigrations: pending,
      };
    } catch {
      return unavailable('The database readiness check failed.');
    }
  }
}
