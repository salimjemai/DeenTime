/**
 * Static hosting for the masjid admin site at https://jemaiinnovations.com/masjid.
 * The Angular app is built with --base-href /masjid/ into dist-web/masjid. It calls the
 * one shared backend (api.jemaiinnovations.com, which also serves Mushaf+) for accounts
 * and masjid data, so this Worker has no database and no API of its own.
 */

export interface Env {
  ASSETS: { fetch(input: Request | string, init?: RequestInit): Promise<Response> };
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

    // Static files first; any other page is an Angular route, so answer with index.html.
    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404 || request.method !== 'GET') return withHeaders(asset, SECURITY_HEADERS);
    const accept = request.headers.get('Accept') ?? '';
    if (/\.[a-z0-9]{2,5}$/i.test(path) && !accept.includes('text/html')) return asset;
    // Fetch the folder, not index.html: the assets binding redirects /index.html to the folder.
    const index = await env.ASSETS.fetch(new Request(`${url.origin}${base}/`, { headers: request.headers }));
    return withHeaders(index, { ...SECURITY_HEADERS, 'Cache-Control': 'no-cache' });
  },
};

function withHeaders(response: Response, headers: Record<string, string>): Response {
  const copy = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) if (!copy.headers.has(key)) copy.headers.set(key, value);
  return copy;
}
