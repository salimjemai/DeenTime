import { createApp } from './app.js';
import type { App, Env } from './core/context.js';

/**
 * Worker entry (Cloudflare Pages advanced mode, dist/_worker.js). API paths go to the
 * Hono app; everything else is a static asset (Pages also does the SPA fallback).
 * The path list matches frontend/deentime-web/cloudflare/_worker.js and _routes.json.
 */
const API_PREFIXES = ['/api/', '/public/', '/uploads/', '/health/', '/jobs/'];
const API_PATHS = new Set(['/jobs', '/clock', '/iqama-widget.php', '/iqama-widget2.php']);

export function isApiPath(pathname: string): boolean {
  const path = pathname.toLowerCase();
  return API_PATHS.has(path) || API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** The fetch handler. `build` exists so tests can add routes to the app; production uses createApp. */
export function createWorker(build: () => App = createApp): ExportedHandler<Env> & { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> } {
  // Built on the first API request, not at module load, and reused for the isolate's lifetime.
  let app: App | null = null;
  return {
    async fetch(request, env, ctx) {
      if (!isApiPath(new URL(request.url).pathname)) return env.ASSETS.fetch(request);
      app ??= build();
      return app.fetch(request, env, ctx);
    },
  };
}

export default createWorker();
