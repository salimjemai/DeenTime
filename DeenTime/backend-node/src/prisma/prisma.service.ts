import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { resolve } from 'node:path';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { AppConfig, parsePostgresConnectionString } from '../config/configuration.js';
import { MigrationRunner } from './migration-runner.js';

/**
 * The application's database gateway: one pg pool shared by Prisma (through the
 * driver adapter) and by raw SQL (migrations, readiness probe).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  readonly pool: pg.Pool;
  readonly migrations: MigrationRunner;
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    const connection = config.get('ConnectionStrings:Default');
    if (!connection) throw new Error('ConnectionStrings:Default must be configured before the API can start.');
    const settings = parsePostgresConnectionString(connection);
    const pool = new pg.Pool(
      settings.connectionString
        ? { connectionString: settings.connectionString }
        : { host: settings.host, port: settings.port, database: settings.database, user: settings.user, password: settings.password, ssl: settings.ssl },
    );
    super({ adapter: new PrismaPg(pool) });
    this.pool = pool;
    this.migrations = new MigrationRunner(pool, resolve(config.contentRoot, 'prisma', 'migrations'), (message) => this.logger.log(message));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
  }

  /** True when the database answers a trivial query. */
  async canConnect(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }
}
