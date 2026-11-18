// Run with: npm run pages:test   (node --test, no Cloudflare account needed)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, it } from 'node:test';
import worker from './_worker.js';

const SITE = 'https://masjidhub.jemaiinnovations.com';
const ORIGIN = 'https://masjidhub-origin.jemaiinnovations.com';
const routes = JSON.parse(readFileSync(new URL('./_routes.json', import.meta.url), 'utf8'));
const headersFile = readFileSync(new URL('./_headers', import.meta.url), 'utf8');

let calls;
let respond;
const realFetch = globalThis.fetch;
const assets = { fetch: async () => new Response('static asset', { status: 200 }) };
const env = (extra = {}) => ({ API_ORIGIN: ORIGIN, ASSETS: assets, ...extra });

beforeEach(() => {
  calls = [];
  respond = () => new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return respond();
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('MasjidHub Pages proxy worker', () => {
  it('forwards every path listed in _routes.json to the tunnel origin', async () => {
    for (const pattern of routes.include) {
      const path = pattern.replace('*', 'v1/thing');
      const response = await worker.fetch(new Request(`${SITE}${path}?a=1&b=two`), env());
      assert.equal(response.status, 200, path);
      assert.equal(calls.at(-1).url, `${ORIGIN}${path}?a=1&b=two`);
    }
    assert.equal(calls.length, routes.include.length);
  });

  it('leaves everything else to the static assets', async () => {
    for (const path of ['/', '/login', '/tv/al-noor', '/w/al-noor/daily', '/w2/al-noor', '/iqamatime-embed.js', '/apidocs', '/jobsboard']) {
      const response = await worker.fetch(new Request(`${SITE}${path}`), env());
      assert.equal(await response.text(), 'static asset', path);
    }
    assert.equal(calls.length, 0);
  });

  it('preserves method, headers and body, and does not follow API redirects', async () => {
    const body = JSON.stringify({ email: 'admin@masjid.test', password: 'secret' });
    await worker.fetch(
      new Request(`${SITE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token-123', 'X-IqamaTime-Client-Key': 'client-key', Origin: SITE },
        body,
      }),
      env(),
    );
    const { init } = calls[0];
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.get('content-type'), 'application/json');
    assert.equal(init.headers.get('authorization'), 'Bearer token-123');
    assert.equal(init.headers.get('x-iqamatime-client-key'), 'client-key');
    assert.equal(init.headers.get('origin'), SITE);
    assert.equal(await new Response(init.body).text(), body);
  });

  it('sends no body for GET and HEAD', async () => {
    await worker.fetch(new Request(`${SITE}/public/display/al-noor`), env());
    await worker.fetch(new Request(`${SITE}/health/live`, { method: 'HEAD' }), env());
    assert.equal(calls[0].init.body, undefined);
    assert.equal(calls[1].init.body, undefined);
    assert.equal(calls[1].init.method, 'HEAD');
  });

  it('forwards the visitor address and the public host, and never trusts values the visitor sent', async () => {
    await worker.fetch(
      new Request(`${SITE}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.7', 'X-MasjidHub-Client-IP': '10.0.0.1', 'X-MasjidHub-Proxy-Key': 'guess' },
        body: '{}',
      }),
      env({ ORIGIN_PROXY_KEY: 'shared-key' }),
    );
    const headers = calls[0].init.headers;
    assert.equal(headers.get('x-masjidhub-client-ip'), '198.51.100.7');
    assert.equal(headers.get('x-masjidhub-proxy-key'), 'shared-key');
    assert.equal(headers.get('x-forwarded-host'), 'masjidhub.jemaiinnovations.com');
    assert.equal(headers.get('x-forwarded-proto'), 'https');

    await worker.fetch(new Request(`${SITE}/health/live`, { headers: { 'X-MasjidHub-Client-IP': '10.0.0.1', 'X-MasjidHub-Proxy-Key': 'guess' } }), env());
    assert.equal(calls[1].init.headers.get('x-masjidhub-client-ip'), null);
    assert.equal(calls[1].init.headers.get('x-masjidhub-proxy-key'), null);
  });

  it('passes API responses through unchanged, including redirects and API errors', async () => {
    respond = () => new Response(null, { status: 302, headers: { Location: `${SITE}/tv/al-noor` } });
    const redirect = await worker.fetch(new Request(`${SITE}/clock?masjid=al-noor`), env());
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get('location'), `${SITE}/tv/al-noor`);

    respond = () => new Response('{"status":"Unhealthy"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    const unhealthy = await worker.fetch(new Request(`${SITE}/health/ready`), env());
    assert.equal(unhealthy.status, 503);
    assert.equal(await unhealthy.text(), '{"status":"Unhealthy"}');
    assert.equal(unhealthy.headers.get('x-masjidhub-proxy'), null);
  });

  it('answers a branded 503 when the origin is unreachable', async () => {
    respond = () => {
      throw new TypeError('fetch failed');
    };
    const api = await worker.fetch(new Request(`${SITE}/api/v1/auth/config`, { headers: { Accept: 'application/json' } }), env());
    assert.equal(api.status, 503);
    assert.equal(api.headers.get('cache-control'), 'no-store');
    assert.equal(api.headers.get('retry-after'), '60');
    assert.equal(api.headers.get('x-masjidhub-proxy'), 'origin-unreachable');
    assert.deepEqual(await api.json(), {
      status: 503,
      title: 'MasjidHub is temporarily offline',
      detail: 'The MasjidHub service cannot be reached right now. Please try again in a few minutes.',
      message: 'MasjidHub is temporarily offline',
    });

    const page = await worker.fetch(new Request(`${SITE}/public/tv/al-noor`, { headers: { Accept: 'text/html,application/xhtml+xml' } }), env());
    assert.equal(page.status, 503);
    assert.match(page.headers.get('content-type'), /^text\/html/);
    assert.match(await page.text(), /<h1>MasjidHub is temporarily offline<\/h1>/);
  });

  it('treats Cloudflare and tunnel gateway errors as offline', async () => {
    for (const status of [502, 504, 521, 523, 530]) {
      respond = () => new Response('error code: 1033', { status });
      const response = await worker.fetch(new Request(`${SITE}/health/live`), env());
      assert.equal(response.status, 503, String(status));
      assert.equal(response.headers.get('x-masjidhub-proxy'), `origin-${status}`);
      assert.equal((await response.json()).title, 'MasjidHub is temporarily offline');
    }
  });

  it('refuses to proxy when API_ORIGIN is missing, not https, or points back at the site', async () => {
    for (const origin of [undefined, '', 'not a url', 'http://masjidhub-origin.jemaiinnovations.com', SITE]) {
      const response = await worker.fetch(new Request(`${SITE}/health/live`), { ASSETS: assets, API_ORIGIN: origin });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('x-masjidhub-proxy'), 'origin-not-configured');
    }
    assert.equal(calls.length, 0);
  });
});

describe('Pages static headers', () => {
  it('denies framing by default and lifts it for the embeddable display routes', () => {
    const blocks = headersFile
      .split(/\r?\n\s*\r?\n/)
      .map((block) => block.split(/\r?\n/).filter((line) => line.trim() !== '' && !line.startsWith('#')))
      .filter((lines) => lines.length > 0)
      .map(([path, ...rules]) => ({ path, rules: rules.map((rule) => rule.trim()) }));
    assert.deepEqual(blocks[0].path, '/*');
    assert.ok(blocks[0].rules.includes('X-Frame-Options: DENY'));
    for (const path of ['/tv/*', '/w/*', '/w2/*']) {
      const block = blocks.find((candidate) => candidate.path === path);
      assert.ok(block, `${path} rule is missing`);
      assert.deepEqual(block.rules, ['! X-Frame-Options', 'Content-Security-Policy: frame-ancestors *']);
      assert.ok(blocks.indexOf(block) > 0, 'detach rules must come after the /* rule they override');
    }
  });
});
