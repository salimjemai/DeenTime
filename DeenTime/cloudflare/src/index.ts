/**
 * The masjid admin site at https://jemaiinnovations.com/masjid on Cloudflare.
 * - /masjid/api/v1/*  masjid API on D1 (src/masjid-api.ts)
 * - /masjid/*         the Angular app, built with --base-href /masjid/ into dist-web/masjid
 * Accounts come from the shared Jemai Innovations auth service (src/auth.ts).
 */
import { sharedAuthVerifier, type AuthEnv } from './auth.js';
import { handleMasjidApi, json, type Db } from './masjid-api.js';

export interface Env extends AuthEnv {
  DB: Db;
  ASSETS: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
  /** Comma-separated origins allowed to call the signed-in API from another site. */
  ALLOWED_ORIGINS?: string;
  BASE_PATH?: string;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const base = (env.BASE_PATH ?? '/masjid').replace(/\/+$/, '');

    if (url.pathname === base) return Response.redirect(`${url.origin}${base}/${url.search}`, 301);
    if (base && !url.pathname.startsWith(`${base}/`)) return new Response('Not found', { status: 404 });
    const path = url.pathname.slice(base.length) || '/';

    if (path.startsWith('/api/')) {
      const cors = corsHeaders(request, env);
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const response =
        (await handleMasjidApi(request, path, {
          db: env.DB,
          verify: sharedAuthVerifier(env),
          authApiBase: (env.AUTH_API_BASE ?? 'https://api.jemaiinnovations.com').replace(/\/+$/, ''),
        })) ?? json({ error: { code: 'not_found', message: 'No such API route.' } }, 404);
      return withHeaders(response, { ...cors, ...SECURITY_HEADERS });
    }

    // Static files first; any other page is an Angular route, so answer with index.html.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || request.method !== 'GET') return asset;
    const accept = request.headers.get('Accept') ?? '';
    if (/\.[a-z0-9]{2,5}$/i.test(path) && !accept.includes('text/html')) return asset;
    // Fetch the folder, not index.html: the assets binding redirects /index.html to the folder.
    const index = await env.ASSETS.fetch(new Request(`${url.origin}${base}/`, { headers: request.headers }));
    return withHeaders(index, { ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' });
  },
};

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) if (!copy.headers.has(key)) copy.headers.set(key, value);
  return copy;
}
