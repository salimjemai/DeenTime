import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/configuration.js';
import { ProviderUnavailableError } from './errors.js';
import { TurnstileService } from './turnstile.service.js';

function testConfig(overrides: Record<string, string>): AppConfig {
  return AppConfig.load({ contentRoot: tmpdir(), env: {}, overrides, environmentName: 'Testing' });
}

const enabledSettings = { 'Captcha:Enabled': 'true', 'Captcha:SiteKey': 'site-key', 'Captcha:SecretKey': 'secret-key' };

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function fetchStub(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  };
  return { fetch: impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TurnstileService', () => {
  it('accepts everything when CAPTCHA is disabled', async () => {
    const stub = fetchStub(() => json({ success: false }));
    const service = new TurnstileService(testConfig({ 'Captcha:Enabled': 'false' }), { fetch: stub.fetch });
    expect(service.enabled).toBe(false);
    expect(await service.verify(null, 'login', '127.0.0.1')).toBe(true);
    expect(await service.verify('token', 'login', null)).toBe(true);
    expect(stub.calls).toHaveLength(0);
  });

  it('fails at construction when enabled without keys (ValidateOnStart)', () => {
    expect(() => new TurnstileService(testConfig({ 'Captcha:Enabled': 'true', 'Captcha:SiteKey': 'site-key' }))).toThrow(
      'Captcha site and secret keys are required when CAPTCHA is enabled.',
    );
  });

  it('posts the form-encoded siteverify request without a User-Agent', async () => {
    const stub = fetchStub(() => json({ success: true, action: 'login', hostname: 'app.iqamatime.com' }));
    const service = new TurnstileService(testConfig(enabledSettings), { fetch: stub.fetch, baseUrl: 'https://turnstile.test/' });

    expect(service.enabled).toBe(true);
    expect(service.siteKey).toBe('site-key');
    expect(await service.verify('tok en', 'login', '203.0.113.7')).toBe(true);

    const call = stub.calls[0];
    expect(call.url).toBe('https://turnstile.test/turnstile/v0/siteverify');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' });
    expect(call.init.body).toBe('secret=secret-key&response=tok+en&remoteip=203.0.113.7');
  });

  it('omits remoteip when it is blank', async () => {
    const stub = fetchStub(() => json({ success: true, action: 'login' }));
    const service = new TurnstileService(testConfig(enabledSettings), { fetch: stub.fetch });
    expect(await service.verify('token', 'login', ' ')).toBe(true);
    expect(stub.calls[0].init.body).toBe('secret=secret-key&response=token');
  });

  it('rejects blank or oversized tokens without calling Cloudflare', async () => {
    const stub = fetchStub(() => json({ success: true, action: 'login' }));
    const service = new TurnstileService(testConfig(enabledSettings), { fetch: stub.fetch });
    expect(await service.verify(undefined, 'login', null)).toBe(false);
    expect(await service.verify('   ', 'login', null)).toBe(false);
    expect(await service.verify('x'.repeat(2049), 'login', null)).toBe(false);
    expect(stub.calls).toHaveLength(0);
    expect(await service.verify('x'.repeat(2048), 'login', null)).toBe(true);
  });

  it('rejects an action mismatch (ordinal comparison)', async () => {
    const stub = fetchStub(() => json({ success: true, action: 'register' }));
    const service = new TurnstileService(testConfig(enabledSettings), { fetch: stub.fetch });
    expect(await service.verify('token', 'login', null)).toBe(false);
    expect(await service.verify('token', 'Register', null)).toBe(false);
    expect(await service.verify('token', 'register', null)).toBe(true);
  });

  it('rejects unsuccessful verifications and non-2xx responses', async () => {
    const failed = fetchStub(() => json({ success: false, action: 'login', 'error-codes': ['invalid-input-response'] }));
    expect(await new TurnstileService(testConfig(enabledSettings), { fetch: failed.fetch }).verify('token', 'login', null)).toBe(false);

    const unavailable = fetchStub(() => new Response('', { status: 503 }));
    expect(await new TurnstileService(testConfig(enabledSettings), { fetch: unavailable.fetch }).verify('token', 'login', null)).toBe(false);
  });

  it('checks the hostname case-insensitively when ExpectedHostnames is configured', async () => {
    const settings = { ...enabledSettings, 'Captcha:ExpectedHostnames:0': 'app.iqamatime.com', 'Captcha:ExpectedHostnames:1': 'iqamatime.com' };
    const accepted = fetchStub(() => json({ success: true, action: 'login', hostname: 'App.IqamaTime.com' }));
    expect(await new TurnstileService(testConfig(settings), { fetch: accepted.fetch }).verify('token', 'login', null)).toBe(true);

    const rejected = fetchStub(() => json({ success: true, action: 'login', hostname: 'evil.example' }));
    expect(await new TurnstileService(testConfig(settings), { fetch: rejected.fetch }).verify('token', 'login', null)).toBe(false);

    const missing = fetchStub(() => json({ success: true, action: 'login' }));
    expect(await new TurnstileService(testConfig(settings), { fetch: missing.fetch }).verify('token', 'login', null)).toBe(false);
  });

  it('surfaces network failures as ProviderUnavailableError', async () => {
    const offline = fetchStub(() => {
      throw new TypeError('fetch failed');
    });
    const service = new TurnstileService(testConfig(enabledSettings), { fetch: offline.fetch });
    await expect(service.verify('token', 'login', null)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});
