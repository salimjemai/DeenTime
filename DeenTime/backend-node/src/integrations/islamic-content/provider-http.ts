/**
 * Shared plumbing for the typed HTTP clients registered in Program.cs
 * (AddHttpClient<QuranProviderClient> and friends): injectable fetch/base URL/clock
 * so unit tests never touch the network, plus helpers that reproduce .NET
 * behaviours (Uri.EscapeDataString, HttpStatusCode names, timeout classification).
 */
export interface ProviderClientOptions {
  /** Replaces the global fetch (tests). */
  fetch?: typeof fetch;
  /** Overrides the configured base address; a trailing slash is added when missing. */
  baseUrl?: string;
  /** Clock used for retrievedAt/expiry stamps. */
  now?: () => Date;
  /** Replaces real timers for throttle spacing and retry back-off (tests). */
  delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Nest injection token for an optional ProviderClientOptions instance. */
export const PROVIDER_CLIENT_OPTIONS = 'IslamicContent:ProviderClientOptions';

export function ensureTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '') + '/';
}

export function resolveFetch(options: ProviderClientOptions | undefined): typeof fetch {
  return options?.fetch ?? ((input, init) => globalThis.fetch(input, init));
}

export function resolveClock(options: ProviderClientOptions | undefined): () => Date {
  return options?.now ?? (() => new Date());
}

/** Abortable setTimeout; rejects with the signal's reason when aborted first. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** HttpClient.Timeout combined with an optional caller cancellation token. */
export function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export type FetchFailure = 'timeout' | 'aborted' | 'network';

/**
 * Maps fetch rejections onto the .NET exception types the providers handled:
 * TimeoutError → OperationCanceledException from HttpClient.Timeout, AbortError →
 * the caller's cancellation token, TypeError ("fetch failed"/"terminated") →
 * HttpRequestException. Anything else is not an HTTP failure.
 */
export function classifyFetchError(error: unknown): FetchFailure | null {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name: unknown }).name;
    if (name === 'TimeoutError') return 'timeout';
    if (name === 'AbortError') return 'aborted';
  }
  if (error instanceof TypeError) return 'network';
  return null;
}

/** Uri.EscapeDataString: RFC 3986 unreserved characters only (encodeURIComponent keeps !'()*). */
export function escapeDataString(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

const HTTP_STATUS_NAMES: Record<number, string> = {
  100: 'Continue',
  101: 'SwitchingProtocols',
  102: 'Processing',
  103: 'EarlyHints',
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  203: 'NonAuthoritativeInformation',
  204: 'NoContent',
  205: 'ResetContent',
  206: 'PartialContent',
  207: 'MultiStatus',
  208: 'AlreadyReported',
  226: 'IMUsed',
  300: 'MultipleChoices',
  301: 'MovedPermanently',
  302: 'Found',
  303: 'SeeOther',
  304: 'NotModified',
  305: 'UseProxy',
  306: 'Unused',
  307: 'TemporaryRedirect',
  308: 'PermanentRedirect',
  400: 'BadRequest',
  401: 'Unauthorized',
  402: 'PaymentRequired',
  403: 'Forbidden',
  404: 'NotFound',
  405: 'MethodNotAllowed',
  406: 'NotAcceptable',
  407: 'ProxyAuthenticationRequired',
  408: 'RequestTimeout',
  409: 'Conflict',
  410: 'Gone',
  411: 'LengthRequired',
  412: 'PreconditionFailed',
  413: 'RequestEntityTooLarge',
  414: 'RequestUriTooLong',
  415: 'UnsupportedMediaType',
  416: 'RequestedRangeNotSatisfiable',
  417: 'ExpectationFailed',
  421: 'MisdirectedRequest',
  422: 'UnprocessableEntity',
  423: 'Locked',
  424: 'FailedDependency',
  426: 'UpgradeRequired',
  428: 'PreconditionRequired',
  429: 'TooManyRequests',
  431: 'RequestHeaderFieldsTooLarge',
  451: 'UnavailableForLegalReasons',
  500: 'InternalServerError',
  501: 'NotImplemented',
  502: 'BadGateway',
  503: 'ServiceUnavailable',
  504: 'GatewayTimeout',
  505: 'HttpVersionNotSupported',
  506: 'VariantAlsoNegotiates',
  507: 'InsufficientStorage',
  508: 'LoopDetected',
  510: 'NotExtended',
  511: 'NetworkAuthenticationRequired',
};

/** System.Net.HttpStatusCode.ToString(): the enum member name, or the number when undefined. */
export function httpStatusName(status: number): string {
  return HTTP_STATUS_NAMES[status] ?? String(status);
}

/** The media type of a Content-Type header ("image/png; charset=binary" → "image/png"). */
export function mediaType(contentType: string | null): string | null {
  if (!contentType) return null;
  const type = contentType.split(';')[0]?.trim() ?? '';
  return type.length > 0 ? type : null;
}

/** Number.ToString("N0") in the invariant/en-US culture ("1,234"). */
export function formatCount(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
