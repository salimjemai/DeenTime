import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { badRequest, badRequestText, conflict, forbidden, notFound, problem, unauthorized, validationProblem } from '../../src/core/errors.js';
import { empty, text } from '../../src/core/http.js';
import { parseBody } from '../../src/core/validation.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** Bodies, headers and status codes of backend-node's ProblemDetailsFilter and http-middleware. */
describe('http pipeline', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp({
      routes: (hono) => {
        hono.get('/api/test/problem', () => {
          throw problem(409, 'Already there', 'The slug is taken.');
        });
        hono.get('/api/test/validation-problem', () => {
          throw validationProblem({ Email: ['Email is required.'] });
        });
        hono.get('/api/test/not-found', () => {
          throw notFound();
        });
        hono.get('/api/test/unauthorized', () => {
          throw unauthorized();
        });
        hono.get('/api/test/bad-request', () => {
          throw badRequest({ code: 'invalid_token', message: 'The link has expired.' });
        });
        hono.get('/api/test/bad-request-text', () => {
          throw badRequestText('Invalid range');
        });
        hono.get('/api/test/conflict', () => {
          throw conflict({ message: 'Duplicate masjid.' });
        });
        hono.get('/api/test/forbidden', () => {
          throw forbidden();
        });
        hono.get('/api/test/crash', () => {
          throw new Error('boom');
        });
        hono.get('/api/test/text', (c) => text(c, 'plain'));
        hono.delete('/api/test/empty', (c) => empty(c));
        hono.get('/api/test/items/:id', (c) => c.json({ id: c.req.param('id'), path: c.req.path }));
        hono.get('/api/test/items/:id/files/*', (c) => c.json({ id: c.req.param('id'), path: c.req.path }));
        hono.get('/public/content/test', (c) => c.json({ ok: true }));
        hono.post('/api/test/echo', async (c) => c.json(await parseBody(c, z.object({ name: z.string().min(1, 'Name is required.'), tags: z.array(z.string().max(3, 'Too long.')).optional() })), 201));
      },
    });
  });

  it('adds the correlation id and security headers to every API response', async () => {
    const response = await app.request('GET', '/health/live');
    expect(response.headers.get('X-Correlation-Id')).toMatch(/^[0-9a-f]{32}$/);
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('echoes a sane incoming correlation id and replaces an oversized one', async () => {
    const echoed = await app.request('GET', '/health/live', { headers: { 'X-Correlation-Id': '  abc-123  ' } });
    expect(echoed.headers.get('X-Correlation-Id')).toBe('abc-123');
    const replaced = await app.request('GET', '/health/live', { headers: { 'X-Correlation-Id': 'x'.repeat(129) } });
    expect(replaced.headers.get('X-Correlation-Id')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('problem(): application/problem+json with type, title, status, detail and a W3C traceId', async () => {
    const response = await app.request('GET', '/api/test/problem', { headers: { 'X-Correlation-Id': 'ABCDEF12-zz-34' } });
    expect(response.status).toBe(409);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    const body = (await response.json()) as Record<string, string>;
    expect(Object.keys(body)).toEqual(['type', 'title', 'status', 'detail', 'traceId']);
    expect(body).toMatchObject({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.10',
      title: 'Already there',
      status: 409,
      detail: 'The slug is taken.',
    });
    expect(body.traceId).toMatch(/^00-abcdef12340{22}-[0-9a-f]{16}-01$/);
  });

  it('validationProblem() carries type and traceId; notFound()/unauthorized() are default problems', async () => {
    const validation = await app.request('GET', '/api/test/validation-problem');
    expect(validation.status).toBe(400);
    expect(await validation.json()).toMatchObject({
      type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1',
      title: 'One or more validation errors occurred.',
      status: 400,
      errors: { Email: ['Email is required.'] },
      traceId: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
    });
    const missing = await app.request('GET', '/api/test/not-found');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.5', title: 'Not Found', status: 404 });
    const denied = await app.request('GET', '/api/test/unauthorized');
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.2', title: 'Unauthorized', status: 401 });
  });

  it('JSON, text and empty error bodies', async () => {
    const json = await app.request('GET', '/api/test/bad-request');
    expect(json.status).toBe(400);
    expect(json.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(await json.text()).toBe('{"code":"invalid_token","message":"The link has expired."}');

    const plain = await app.request('GET', '/api/test/bad-request-text');
    expect(plain.status).toBe(400);
    expect(plain.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await plain.text()).toBe('Invalid range');

    const duplicate = await app.request('GET', '/api/test/conflict');
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ message: 'Duplicate masjid.' });

    const denied = await app.request('GET', '/api/test/forbidden');
    expect(denied.status).toBe(403);
    expect(denied.headers.get('Content-Type')).toBeNull();
    expect(await denied.text()).toBe('');
    expect(denied.headers.get('X-Correlation-Id')).not.toBeNull();
  });

  it('unhandled errors: 500 problem with the correlation id and no internals', async () => {
    const response = await app.request('GET', '/api/test/crash', { headers: { 'X-Correlation-Id': 'trace-me' } });
    expect(response.status).toBe(500);
    expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
    expect(response.headers.get('X-Correlation-Id')).toBe('trace-me');
    expect(await response.json()).toEqual({
      type: 'https://httpstatuses.com/500',
      title: 'The request could not be completed.',
      status: 500,
      detail: 'Try again or provide the correlation id to support.',
      correlationId: 'trace-me',
    });
  });

  it('unknown API routes and unmatched methods: 404 with an empty body and the usual headers', async () => {
    for (const [method, path] of [
      ['GET', '/api/nope'],
      ['GET', '/health/nope'],
      ['GET', '/public/nope'],
      ['GET', '/uploads/nope.png'],
      ['GET', '/jobs/nope'],
      ['POST', '/health/live'],
    ]) {
      const response = await app.request(method, path);
      expect(response.status, `${method} ${path}`).toBe(404);
      expect(await response.text()).toBe('');
      expect(response.headers.get('Content-Type')).toBeNull();
      expect(response.headers.get('X-Frame-Options')).toBe('DENY');
      expect(response.headers.get('X-Correlation-Id')).not.toBeNull();
    }
  });

  it('non-API paths go to ASSETS untouched', async () => {
    for (const path of ['/', '/login', '/tv/my-masjid', '/main-ABC.js', '/apix', '/healthz', '/clock/extra']) {
      const response = await app.request('GET', path);
      expect(await response.text(), path).toBe(`asset:${path}`);
      expect(response.headers.get('X-Correlation-Id')).toBeNull();
    }
  });

  it('API prefixes and routes match case-insensitively and ignore one trailing slash', async () => {
    for (const path of ['/HEALTH/live', '/Health/Live', '/health/live/', '/HEALTH/LIVE/']) {
      const response = await app.request('GET', path);
      expect(response.status, path).toBe(200);
      expect(await response.json()).toEqual({ status: 'live' });
    }
    expect((await app.request('GET', '/API/Version')).status).toBe(200);
    expect((await app.request('GET', '/JOBS')).status).toBe(404);
    expect(await (await app.request('GET', '/JOBS')).text()).toBe('');
  });

  it('keeps the caller’s spelling of parameters and wildcard segments', async () => {
    expect(await (await app.request('GET', '/API/Test/Items/AbC-123')).json()).toEqual({ id: 'AbC-123', path: '/api/test/items/AbC-123' });
    expect(await (await app.request('GET', '/api/test/items/AbC')).json()).toEqual({ id: 'AbC', path: '/api/test/items/AbC' });
    expect(await (await app.request('GET', '/api/TEST/items/AbC/FILES/Dir/Logo.PNG')).json()).toEqual({
      id: 'AbC',
      path: '/api/test/items/AbC/files/Dir/Logo.PNG',
    });
  });

  it('HEAD is answered from the GET route without a body', async () => {
    const response = await app.request('HEAD', '/health/live');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('text() and empty() helpers', async () => {
    const plain = await app.request('GET', '/api/test/text');
    expect(plain.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(await plain.text()).toBe('plain');
    const none = await app.request('DELETE', '/api/test/empty');
    expect(none.status).toBe(204);
    expect(await none.text()).toBe('');
  });

  describe('CORS', () => {
    it('emits nothing without an Origin header', async () => {
      const response = await app.request('GET', '/health/live');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(response.headers.get('Vary')).toBeNull();
    });

    it('dashboard: allow-listed origins are echoed with credentials', async () => {
      const response = await app.request('GET', '/health/live', { headers: { Origin: 'https://APP.deentime.com' } });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://APP.deentime.com');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response.headers.get('Vary')).toBe('Origin');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeNull();
    });

    it('dashboard: other origins get no CORS headers, even on preflight', async () => {
      const response = await app.request('GET', '/health/live', { headers: { Origin: 'https://evil.example' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
      const preflight = await app.request('OPTIONS', '/health/live', { headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' } });
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull();
      expect(preflight.status).toBe(404);
    });

    it('dashboard preflight: 204, methods, reflected request headers', async () => {
      const response = await app.request('OPTIONS', '/api/v1/anything', {
        headers: { Origin: 'http://localhost:4200', 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      expect(response.status).toBe(204);
      expect(await response.text()).toBe('');
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      expect(response.headers.get('Access-Control-Allow-Methods')).toBe('GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
      expect(response.headers.get('Access-Control-Allow-Headers')).toBe('authorization,content-type');
      expect(response.headers.get('Vary')).toBe('Origin, Access-Control-Request-Headers');
      expect(response.headers.get('X-Correlation-Id')).not.toBeNull();
    });

    it('errors keep their CORS headers', async () => {
      const response = await app.request('GET', '/api/test/crash', { headers: { Origin: 'http://localhost:4200' } });
      expect(response.status).toBe(500);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
    });

    it('Cors:AllowedOrigins can be replaced by indexed settings', async () => {
      const custom = await createTestApp({ settings: { Cors__AllowedOrigins__0: 'https://masjidhub.example' } });
      const allowed = await custom.request('GET', '/health/live', { headers: { Origin: 'https://masjidhub.example' } });
      expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://masjidhub.example');
      const second = await custom.request('GET', '/health/live', { headers: { Origin: 'http://localhost:4200' } });
      expect(second.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:4200');
    });

    it('/public/content: any origin, no credentials, exposed headers', async () => {
      const response = await app.request('GET', '/public/content/test', { headers: { Origin: 'https://any.example' } });
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
      expect(response.headers.get('Access-Control-Expose-Headers')).toBe('X-IqamaTime-Source,X-IqamaTime-Retrieved,Warning');
      expect(response.headers.get('Vary')).toBeNull();

      const preflight = await app.request('OPTIONS', '/public/content/test', { headers: { Origin: 'https://any.example' } });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET,OPTIONS');
      expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('Accept,Authorization,Content-Type,X-IqamaTime-Client-Key,X-DeenTime-Client-Key');
    });
  });

  describe('request bodies', () => {
    it('parses and validates JSON', async () => {
      const response = await app.request('POST', '/api/test/echo', { json: { name: 'Masjid', tags: ['a'] } });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ name: 'Masjid', tags: ['a'] });
    });

    it('validation failures: 400 with title, status and PascalCase error keys only', async () => {
      const response = await app.request('POST', '/api/test/echo', { json: { name: '', tags: ['ok', 'too long'] } });
      expect(response.status).toBe(400);
      expect(response.headers.get('Content-Type')).toBe('application/problem+json; charset=utf-8');
      expect(await response.text()).toBe(
        '{"title":"One or more validation errors occurred.","status":400,"errors":{"Name":["Name is required."],"Tags[1]":["Too long."]}}',
      );
    });

    it('a missing or non-JSON body validates as {}', async () => {
      for (const options of [{}, { body: 'name=x', headers: { 'Content-Type': 'text/plain' } }]) {
        const response = await app.request('POST', '/api/test/echo', options);
        expect(response.status).toBe(400);
        expect(((await response.json()) as { errors: Record<string, string[]> }).errors).toHaveProperty('Name');
      }
    });

    it('form-encoded bodies are read as string fields', async () => {
      const response = await app.request('POST', '/api/test/echo', { body: 'name=Masjid+Noor', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ name: 'Masjid Noor' });
    });

    it('malformed JSON: 400 problem without a traceId', async () => {
      const response = await app.request('POST', '/api/test/echo', { body: '{"name": ', headers: { 'Content-Type': 'application/json' } });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { errors: Record<string, string[]> };
      expect(Object.keys(body)).toEqual(['type', 'title', 'status', 'errors']);
      expect(body).toMatchObject({ type: 'https://tools.ietf.org/html/rfc9110#section-15.5.1', title: 'One or more validation errors occurred.', status: 400 });
      expect(body.errors['']).toHaveLength(1);
    });

    it('bodies over 1 MB: 413 with an empty body', async () => {
      const response = await app.request('POST', '/api/test/echo', { body: JSON.stringify({ name: 'x'.repeat(1024 * 1024) }), headers: { 'Content-Type': 'application/json' } });
      expect(response.status).toBe(413);
      expect(await response.text()).toBe('');
    });
  });
});
