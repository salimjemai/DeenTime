/**
 * MasjidHub on Cloudflare Pages ("advanced mode" worker).
 *
 * The Angular site is served by Pages as static files. The browser keeps talking to
 * its own origin, so this worker forwards the API paths to the machine that runs the
 * NestJS API, reached through a Cloudflare Tunnel hostname:
 *
 *   /api/*  /public/*  /uploads/*  /health/*  /jobs  and the legacy redirects
 *   /clock  /iqama-widget.php  /iqama-widget2.php
 *
 * _routes.json limits the worker to those paths, so static assets never invoke it.
 *
 * Pages settings (see docs/cloudflare-deployment.md):
 *   API_ORIGIN        https origin of the tunnel hostname (plain variable, wrangler.toml)
 *   ORIGIN_PROXY_KEY  optional secret; must equal Proxy__SharedKey on the origin so the
 *                     API believes the visitor address this worker forwards
 */

const PROXIED_PREFIXES = ['/api/', '/public/', '/uploads/', '/health/', '/jobs/'];
const PROXIED_PATHS = new Set(['/jobs', '/clock', '/iqama-widget.php', '/iqama-widget2.php']);

const OFFLINE_TITLE = 'MasjidHub is temporarily offline';
const OFFLINE_DETAIL = 'The MasjidHub service cannot be reached right now. Please try again in a few minutes.';

/** Statuses Cloudflare (520-530) or cloudflared (502, 504) answer with when the origin cannot be reached. */
function originIsDown(status) {
  return status === 502 || status === 504 || (status >= 520 && status <= 530);
}

function isProxied(pathname) {
  const path = pathname.toLowerCase();
  return PROXIED_PATHS.has(path) || PROXIED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function offline(request, reason) {
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '60', 'X-MasjidHub-Proxy': reason };
  const wantsPage = request.method === 'GET' && (request.headers.get('Accept') ?? '').includes('text/html');
  if (wantsPage) {
    const page =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<title>${escapeHtml(OFFLINE_TITLE)}</title>` +
      '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#192b3e;color:#f4f1e8;' +
      'font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:28rem;padding:2rem;text-align:center}' +
      'h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:0;opacity:.85}</style></head>' +
      `<body><main><h1>${escapeHtml(OFFLINE_TITLE)}</h1><p>${escapeHtml(OFFLINE_DETAIL)}</p></main></body></html>`;
    return new Response(page, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  }
  const body = JSON.stringify({ status: 503, title: OFFLINE_TITLE, detail: OFFLINE_DETAIL, message: OFFLINE_TITLE });
  return new Response(request.method === 'HEAD' ? null : body, {
    status: 503,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** The configured tunnel origin, or null when it is missing, not https, or points back at this site. */
function resolveOrigin(env, requestUrl) {
  const configured = typeof env.API_ORIGIN === 'string' ? env.API_ORIGIN.trim() : '';
  if (configured === '') return null;
  let origin;
  try {
    origin = new URL(configured);
  } catch {
    return null;
  }
  if (origin.protocol !== 'https:' || origin.host === requestUrl.host) return null;
  return origin;
}

async function proxy(request, env, url) {
  const origin = resolveOrigin(env, url);
  if (!origin) return offline(request, 'origin-not-configured');

  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(request.headers);
  headers.delete('host');
  // The API builds public links from its configured origin; these keep the fallback honest.
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', url.protocol.replace(':', ''));
  // Never let a visitor choose their own address or present a proxy key.
  headers.delete('X-MasjidHub-Client-IP');
  headers.delete('X-MasjidHub-Proxy-Key');
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) headers.set('X-MasjidHub-Client-IP', clientIp);
  const proxyKey = typeof env.ORIGIN_PROXY_KEY === 'string' ? env.ORIGIN_PROXY_KEY.trim() : '';
  if (proxyKey !== '') headers.set('X-MasjidHub-Proxy-Key', proxyKey);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let upstream;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      // API redirects (legacy embed URLs, /public/tv/:slug) must reach the browser as redirects.
      redirect: 'manual',
      ...(hasBody ? { duplex: 'half' } : {}),
    });
  } catch {
    return offline(request, 'origin-unreachable');
  }
  if (originIsDown(upstream.status)) return offline(request, `origin-${upstream.status}`);
  return new Response(upstream.body, upstream);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isProxied(url.pathname)) return proxy(request, env, url);
    // _routes.json keeps other paths away from this worker; serve assets if one arrives anyway.
    return env.ASSETS.fetch(request);
  },
};
