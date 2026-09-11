import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import express from 'express';
import { resolve } from 'node:path';
import { JwtService } from './common/auth/jwt.service.js';
import { optionalJwt } from './common/auth/optional-jwt.middleware.js';
import { correlationId, dashboardCors, PUBLIC_CONTENT_CORS, securityHeaders } from './common/http-middleware.js';
import { ProblemDetailsFilter } from './common/problem-details.filter.js';
import type { AppConfig } from './config/configuration.js';

/**
 * The request pipeline from Program.cs, shared by main.ts and the integration tests:
 * correlation id → security headers → compression → CORS (split on /public/content)
 * → optional JWT → static wwwroot → controllers → ProblemDetails / SPA fallback.
 */
export function configureHttp(app: NestExpressApplication, config: AppConfig): string {
  const webRoot = resolve(config.contentRoot, 'wwwroot');
  const server = app.getHttpAdapter().getInstance() as express.Express;
  server.disable('x-powered-by');
  app.use(correlationId());
  app.use(securityHeaders());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(optionalJwt(app.get(JwtService)));

  const dashboard = dashboardCors(config.getArray('Cors:AllowedOrigins'));
  app.enableCors((request, callback) => {
    const req = request as express.Request;
    const path = req.path ?? '';
    // ASP.NET only emits CORS headers for requests that carry an Origin header.
    if (!req.headers.origin) {
      callback(null, { origin: false });
      return;
    }
    callback(null, path === '/public/content' || path.startsWith('/public/content/') ? PUBLIC_CONTENT_CORS : dashboard);
  });

  app.useStaticAssets(webRoot, {
    index: false,
    redirect: false,
    setHeaders: (response, filePath) => {
      if (/(?:^|[\\/])(?:index\.html|ngsw\.json)$/.test(filePath)) response.setHeader('Cache-Control', 'no-store');
    },
  });
  app.useGlobalFilters(new ProblemDetailsFilter(webRoot));
  return webRoot;
}
