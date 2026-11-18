import { Hono } from 'hono';
import type { App, AppEnv } from './core/context.js';
import { pipeline, renderError, renderNotFound } from './core/http.js';
import { createPathResolver } from './core/routing.js';
import { register as registerAdminMasjids } from './modules/admin-masjids.js';
import { register as registerApiClients } from './modules/api-clients.js';
import { register as registerAuth } from './modules/auth.js';
import { register as registerDesign } from './modules/design.js';
import { register as registerHealth } from './modules/health.js';
import { register as registerHijri } from './modules/hijri.js';
import { register as registerIqama } from './modules/iqama.js';
import { register as registerIslamicContent } from './modules/islamic-content.js';
import { register as registerLocations } from './modules/locations.js';
import { register as registerOrganizations } from './modules/organizations.js';
import { register as registerPublicContent } from './modules/public-content.js';
import { register as registerPublic } from './modules/public.js';
import { register as registerPublish } from './modules/publish.js';
import { register as registerTimings } from './modules/timings.js';

/**
 * Builds the API. Each module file exports `register(app)` and adds its routes with
 * full paths (`app.get('/api/v1/orgs/:id', ...)`); see README.md for the conventions.
 * The order below is backend-node's AppModule import order.
 */
export function createApp(): App {
  const app: App = new Hono<AppEnv>({ getPath: createPathResolver(() => app.routes.map((route) => route.path)) });
  app.use('*', pipeline);
  app.onError(renderError);
  app.notFound(renderNotFound);

  registerHealth(app);
  registerIqama(app);
  registerOrganizations(app);
  registerTimings(app);
  registerHijri(app);
  registerDesign(app);
  registerIslamicContent(app);
  registerApiClients(app);
  registerPublicContent(app);
  registerAuth(app);
  registerAdminMasjids(app);
  registerLocations(app);
  registerPublish(app);
  registerPublic(app);
  return app;
}
