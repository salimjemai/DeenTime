import { z } from 'zod';
import type { AppConfig } from '../core/config.js';
import { ProviderHttpClient, type ProviderClientOptions } from './http-client.js';

const MAX_TOKEN_LENGTH = 2048;

const siteverifyResponse = z.object({
  success: z.boolean().nullish(),
  hostname: z.string().nullish(),
  action: z.string().nullish(),
  'error-codes': z.array(z.string()).nullish(),
});

/**
 * Port of backend-node's TurnstileService (TurnstileCaptchaVerifier): Cloudflare Turnstile
 * siteverify with a 10 s timeout. Options: Captcha:Enabled, Captcha:SiteKey,
 * Captcha:SecretKey, Captcha:ExpectedHostnames.
 */
export class TurnstileService {
  static readonly DEFAULT_BASE_URL = 'https://challenges.cloudflare.com/';

  readonly enabled: boolean;
  /** Public widget key (GET /api/v1/auth/config returns it as captchaSiteKey when enabled). */
  readonly siteKey: string;
  private readonly secretKey: string;
  private readonly expectedHostnames: string[];
  private readonly http: ProviderHttpClient;

  constructor(config: AppConfig, options: ProviderClientOptions = {}) {
    this.enabled = config.getBoolean('Captcha:Enabled');
    this.siteKey = config.get('Captcha:SiteKey') ?? '';
    this.secretKey = config.get('Captcha:SecretKey') ?? '';
    this.expectedHostnames = config.getArray('Captcha:ExpectedHostnames');
    if (this.enabled && (this.siteKey.trim() === '' || this.secretKey.trim() === '')) {
      // backend-node refuses to start (ValidateOnStart); here the first request that needs CAPTCHA fails.
      throw new Error('Captcha site and secret keys are required when CAPTCHA is enabled.');
    }
    this.http = new ProviderHttpClient('Turnstile', { baseUrl: TurnstileService.DEFAULT_BASE_URL, timeoutMs: 10_000 }, options);
  }

  /**
   * True when CAPTCHA is disabled; otherwise the token must verify with a matching
   * action and, when ExpectedHostnames is configured, an expected hostname.
   */
  async verify(token: string | null | undefined, action: string, remoteIp: string | null | undefined): Promise<boolean> {
    if (!this.enabled) return true;
    if (!token || token.trim() === '' || token.length > MAX_TOKEN_LENGTH || this.secretKey.trim() === '') return false;

    const fields = new URLSearchParams({ secret: this.secretKey, response: token });
    if (remoteIp && remoteIp.trim() !== '') fields.set('remoteip', remoteIp);

    const response = await this.http.send('turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: fields.toString(),
    });
    if (!response.ok) return false;

    const parsed = siteverifyResponse.safeParse(await this.http.readJson(response));
    if (!parsed.success || parsed.data.success !== true || parsed.data.action !== action) return false;

    const hostname = parsed.data.hostname;
    return (
      this.expectedHostnames.length === 0 ||
      (typeof hostname === 'string' && this.expectedHostnames.some((expected) => expected.toLowerCase() === hostname.toLowerCase()))
    );
  }
}

const instances = new WeakMap<AppConfig, TurnstileService>();

/**
 * The isolate-wide verifier (backend-node's singleton provider): `turnstileService(config(c))`.
 * Throws when Captcha:Enabled is set without both keys, where backend-node refuses to start.
 */
export function turnstileService(config: AppConfig): TurnstileService {
  let service = instances.get(config);
  if (!service) {
    service = new TurnstileService(config);
    instances.set(config, service);
  }
  return service;
}
