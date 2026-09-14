import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppModule } from './app.module.js';
import { AppConfig, resolveListenAddress } from './config/configuration.js';
import { configureHttp } from './http-setup.js';
import { StartupService } from './startup/startup.service.js';

/** appsettings*.json, prisma/ and wwwroot/ live one level above src/ and dist/. */
export const contentRoot = process.env.DEENTIME_CONTENT_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function bootstrap(): Promise<void> {
  const config = AppConfig.load({ contentRoot });
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), { bufferLogs: true, bodyParser: false });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  configureHttp(app, config);
  await app.init();
  await app.get(StartupService).run();
  const { host, port } = resolveListenAddress(config);
  await app.listen(port, host);
  app.get(Logger).log(`IqamaTime API (${config.environment}) listening on http://${host}:${port}`);
}

await bootstrap();
