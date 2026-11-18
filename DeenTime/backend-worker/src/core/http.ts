import { servicesFor, type Ctx, type Middleware } from './context.js';
import { randomBytes } from './encoding.js';
import { JsonResponseException, ProblemDetailsException } from './errors.js';
import type { SessionUser } from './jwt.js';
import { toHex } from './sha256.js';

/**
 * The request pipeline of backend-node's http-setup.ts, minus what the platform does
 * (compression, static files, SPA fallback): correlation id → security headers → CORS
 * (split on /public/content) → optional JWT → routes → error rendering.
 */
const CORRELATION_HEADER = 'X-Correlation-Id';

const PUBLIC_CONTENT_CORS = {
  methods: 'GET,OPTIONS',
  allowedHeaders: 'Accept,Authorization,Content-Type,X-IqamaTime-Client-Key,X-DeenTime-Client-Key',
  exposedHeaders: 'X-IqamaTime-Source,X-IqamaTime-Retrieved,Warning',
};
const DASHBOARD_CORS_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS';

function newCorrelationId(c: Ctx): string {
  const incoming = c.req.header(CORRELATION_HEADER);
  return incoming && incoming.trim() && incoming.length <= 128 ? incoming.trim() : crypto.randomUUID().replace(/-/g, '');
}

async function bearerUser(c: Ctx): Promise<SessionUser | null> {
  const header = c.req.header('Authorization');
  if (typeof header !== 'string' || !/^Bearer\s+/i.test(header)) return null;
  return c.get('services').jwt().verify(header.replace(/^Bearer\s+/i, '').trim());
}

function appendVary(headers: Headers, value: string): void {
  const existing = headers.get('Vary');
  if (!existing) headers.set('Vary', value);
  else if (!existing.split(',').some((item) => item.trim().toLowerCase() === value.toLowerCase())) headers.set('Vary', `${existing}, ${value}`);
}

/** CORS headers for this request, or null when it gets none (no Origin, or an origin that is not allowed). */
function corsHeaders(c: Ctx, path: string, preflight: boolean): Headers | null {
  // Like ASP.NET, CORS headers are only emitted for requests that carry an Origin header.
  const origin = c.req.header('Origin');
  if (!origin) return null;
  const headers = new Headers();
  if (path === '/public/content' || path.startsWith('/public/content/')) {
    headers.set('Access-Control-Allow-Origin', '*');
    if (preflight) {
      headers.set('Access-Control-Allow-Methods', PUBLIC_CONTENT_CORS.methods);
      headers.set('Access-Control-Allow-Headers', PUBLIC_CONTENT_CORS.allowedHeaders);
    }
    headers.set('Access-Control-Expose-Headers', PUBLIC_CONTENT_CORS.exposedHeaders);
    return headers;
  }
  if (!c.get('services').allowedOrigins.has(origin.toLowerCase())) return null;
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Credentials', 'true');
  if (preflight) {
    headers.set('Access-Control-Allow-Methods', DASHBOARD_CORS_METHODS);
    // No fixed allow-list: the requested headers are reflected.
    const requested = c.req.header('Access-Control-Request-Headers');
    appendVary(headers, 'Access-Control-Request-Headers');
    if (requested) headers.set('Access-Control-Allow-Headers', requested);
  }
  return headers;
}

/** Applies the headers every response carries; JSON and text content types get backend-node's exact spelling. */
function finalize(c: Ctx, id: string, path: string, cors: Headers | null): void {
  const response = new Response(c.res.body, c.res);
  const headers = response.headers;
  headers.set(CORRELATION_HEADER, id);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (/^\/(?:tv|w|w2)(?:\/|$)/.test(path)) {
    headers.delete('X-Frame-Options');
    headers.set('Content-Security-Policy', 'frame-ancestors *');
  } else {
    headers.set('X-Frame-Options', 'DENY');
  }
  if (cors) {
    for (const [name, value] of cors) {
      if (name.toLowerCase() === 'vary') value.split(',').forEach((item) => appendVary(headers, item.trim()));
      else headers.set(name, value);
    }
  }
  const contentType = headers.get('Content-Type');
  if (contentType === 'application/json') headers.set('Content-Type', 'application/json; charset=utf-8');
  else if (contentType && contentType.endsWith('charset=UTF-8')) headers.set('Content-Type', contentType.replace('charset=UTF-8', 'charset=utf-8'));
  c.res = undefined;
  c.res = response;
}

/** The single global middleware; registered first by createApp. */
export const pipeline: Middleware = async (c, next) => {
  const services = servicesFor(c.env);
  c.set('services', services);
  const id = newCorrelationId(c);
  c.set('correlationId', id);
  c.set('user', null);
  const path = new URL(c.req.url).pathname;
  try {
    c.set('user', await bearerUser(c));
    const preflight = c.req.method === 'OPTIONS';
    const cors = corsHeaders(c, path, preflight);
    if (preflight && cors) {
      c.res = new Response(null, { status: 204, headers: { 'Content-Length': '0' } });
    } else {
      await next();
    }
    finalize(c, id, path, cors);
  } catch (error) {
    c.res = renderError(error, c);
    finalize(c, id, path, corsHeaders(c, path, false));
  }
};

function traceIdFor(correlation: string): string {
  const trace = correlation
    .replace(/[^0-9a-f]/gi, '')
    .toLowerCase()
    .padEnd(32, '0')
    .slice(0, 32);
  return `00-${trace}-${toHex(randomBytes(8))}-01`;
}

/**
 * Renders every error the way backend-node's ProblemDetailsFilter does:
 *  - ProblemDetails (application/problem+json) for problem()/validationProblem();
 *  - JSON, plain-string or empty bodies for badRequest({...}) / badRequestText('...') / forbidden();
 *  - anything else: 500 application/problem+json with the correlation id.
 */
export function renderError(error: unknown, c: Ctx): Response {
  const id = c.get('correlationId') ?? '';
  if (error instanceof ProblemDetailsException) {
    const body = error.problem.type && !('traceId' in error.problem) ? { ...error.problem, traceId: traceIdFor(id) } : error.problem;
    return new Response(JSON.stringify(body), { status: error.problem.status, headers: { 'Content-Type': 'application/problem+json; charset=utf-8' } });
  }
  if (error instanceof JsonResponseException) {
    const body = error.body;
    if (body === undefined || body === null || body === '') return new Response(null, { status: error.status, headers: { 'Content-Length': '0' } });
    if (typeof body === 'string') return new Response(body, { status: error.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    return new Response(JSON.stringify(body), { status: error.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }
  console.error(`Unhandled exception for ${c.req.method} ${new URL(c.req.url).pathname} (correlation ${id})`, error instanceof Error ? (error.stack ?? error.message) : String(error));
  return new Response(
    JSON.stringify({
      type: 'https://httpstatuses.com/500',
      title: 'The request could not be completed.',
      status: 500,
      detail: 'Try again or provide the correlation id to support.',
      correlationId: id,
    }),
    { status: 500, headers: { 'Content-Type': 'application/problem+json; charset=utf-8' } },
  );
}

/** Unknown routes under the API prefixes: 404 with an empty body. */
export function renderNotFound(): Response {
  return new Response(null, { status: 404, headers: { 'Content-Length': '0' } });
}

/** A plain-text (or other textual) response with backend-node's content-type spelling. */
export function text(c: Ctx, body: string, status = 200, contentType = 'text/plain; charset=utf-8'): Response {
  return c.body(body, status as 200, { 'Content-Type': contentType });
}

/** A response with no body (204 by default). */
export function empty(c: Ctx, status = 204): Response {
  return c.body(null, status as 204);
}
