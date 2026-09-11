import { ProviderUnavailableError } from './errors.js';

/** Constructor options shared by the HTTP-backed integrations so tests can stub the network and the clock. */
export interface ProviderClientOptions {
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => Date;
}

export interface ProviderRequest {
  method: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
}

export interface ProviderClientDefaults {
  baseUrl: string;
  timeoutMs: number;
  userAgent?: string;
}

/**
 * Stand-in for the typed HttpClient registered in Program.cs: base address, timeout
 * and User-Agent. Network failures and timeouts surface as ProviderUnavailableError.
 */
export class ProviderHttpClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly userAgent: string | undefined;

  constructor(
    readonly provider: string,
    defaults: ProviderClientDefaults,
    options: ProviderClientOptions = {},
  ) {
    this.baseUrl = `${(options.baseUrl ?? defaults.baseUrl).replace(/\/+$/, '')}/`;
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.timeoutMs = defaults.timeoutMs;
    this.userAgent = defaults.userAgent;
  }

  /** Sends `path` relative to the base address (like a relative Uri on HttpClient.BaseAddress). */
  async send(path: string, request: ProviderRequest): Promise<Response> {
    const headers: Record<string, string> = { ...request.headers };
    if (this.userAgent !== undefined) headers['User-Agent'] = this.userAgent;
    try {
      return await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: request.method,
        headers,
        body: request.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ProviderUnavailableError(this.provider, `${this.provider} request failed: ${describeError(error)}`, { cause: error });
    }
  }

  /** response.EnsureSuccessStatusCode(). */
  ensureSuccess(response: Response): void {
    if (!response.ok) {
      throw new ProviderUnavailableError(this.provider, `${this.provider} responded with HTTP ${response.status}.`);
    }
  }

  /** ReadFromJsonAsync: an unreadable body counts as a failed request. */
  async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new ProviderUnavailableError(this.provider, `${this.provider} returned an unreadable response.`, { cause: error });
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
