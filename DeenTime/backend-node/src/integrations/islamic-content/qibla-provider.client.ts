import { Inject, Injectable, Optional } from '@nestjs/common';
import { ArgumentError, IslamicContentProviderError } from './errors.js';
import { IslamicContentOptions } from './islamic-content-options.js';
import {
  PROVIDER_CLIENT_OPTIONS,
  classifyFetchError,
  ensureTrailingSlash,
  mediaType,
  requestSignal,
  resolveClock,
  resolveFetch,
  type ProviderClientOptions,
} from './provider-http.js';

export interface QiblaCoordinates {
  latitude: number;
  longitude: number;
  direction: number;
}

export interface QiblaDirectionPayload {
  data: QiblaCoordinates;
  fromCache: boolean;
  retrievedAtUtc: Date;
}

export interface QiblaCompassPayload {
  content: Buffer;
  contentType: string;
  retrievedAtUtc: Date;
}

interface CacheSlot {
  payload: QiblaDirectionPayload;
  expiresAtMs: number;
}

const COORDINATES_MESSAGE = 'Latitude must be between -90 and 90, and longitude must be between -180 and 180.';

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function discardBody(response: Response): void {
  void response.body?.cancel().catch(() => undefined);
}

/** Rethrows fetch failures as the provider errors QiblaProviderClient.cs raised; other errors pass through. */
function translateFailure(error: unknown, timeoutMessage: string, unavailableMessage: string): never {
  const failure = classifyFetchError(error);
  if (failure === 'timeout') throw new IslamicContentProviderError(timeoutMessage, { cause: error });
  if (failure === 'network') throw new IslamicContentProviderError(unavailableMessage, { cause: error });
  throw error;
}

/**
 * Typed client for https://api.aladhan.com/v1/ (20 second timeout, UA IqamaTime/1.0,
 * gzip) with the in-memory direction cache from QiblaProviderClient.cs.
 */
@Injectable()
export class QiblaProviderClient {
  static readonly providerName = 'AlAdhan';
  static readonly providerOrganization = 'Islamic Network';
  static readonly openApiVersion = '3.1.0';
  static readonly openApiDocumentUrl = 'https://api.aladhan.com/v1/documentation/openapi/qibla/yaml';
  static readonly directionEndpointTemplate = '/qibla/{latitude}/{longitude}';
  static readonly compassEndpointTemplate = '/qibla/{latitude}/{longitude}/compass';
  static readonly officialServers: readonly string[] = [
    'https://api.aladhan.com/v1',
    'https://aladhan.api.islamic.network/v1/',
    'https://aladhan.api.alislam.ru/v1/',
  ];
  static readonly upstreamCompression: readonly string[] = ['gzip', 'zstd'];
  static readonly maximumCompassBytes = 2_000_000;
  private static readonly timeoutMs = 20_000;
  /** AddMemoryCache(SizeLimit = 5_000) with Size = 1 per direction entry. */
  private static readonly cacheSizeLimit = 5_000;

  private readonly fetch: typeof fetch;
  private readonly baseUrl: string;
  private readonly now: () => Date;
  private readonly cache = new Map<string, CacheSlot>();

  constructor(
    private readonly options: IslamicContentOptions,
    @Optional() @Inject(PROVIDER_CLIENT_OPTIONS) clientOptions?: ProviderClientOptions,
  ) {
    this.fetch = resolveFetch(clientOptions);
    this.baseUrl = ensureTrailingSlash(clientOptions?.baseUrl ?? options.alAdhanBaseUrl);
    this.now = resolveClock(clientOptions);
  }

  async getDirection(latitude: number, longitude: number, signal?: AbortSignal): Promise<QiblaDirectionPayload> {
    QiblaProviderClient.ensureValidCoordinates(latitude, longitude);
    const latitudePath = QiblaProviderClient.formatCoordinate(latitude);
    const longitudePath = QiblaProviderClient.formatCoordinate(longitude);
    const cacheKey = `qibla:${latitudePath}:${longitudePath}`;

    const slot = this.cache.get(cacheKey);
    if (slot !== undefined) {
      if (slot.expiresAtMs > this.now().getTime()) return { ...slot.payload, fromCache: true };
      this.cache.delete(cacheKey);
    }

    let json: string;
    try {
      const response = await this.fetch(`${this.baseUrl}qibla/${latitudePath}/${longitudePath}`, {
        headers: { 'User-Agent': 'IqamaTime/1.0', 'Accept-Encoding': 'gzip' },
        signal: requestSignal(QiblaProviderClient.timeoutMs, signal),
      });
      if (response.status !== 200) {
        discardBody(response);
        throw new IslamicContentProviderError(`The Qibla provider returned HTTP ${response.status}.`);
      }
      json = await response.text();
    } catch (error) {
      translateFailure(error, 'The Qibla provider timed out.', 'The Qibla provider is currently unavailable.');
    }

    const data = QiblaProviderClient.parseDirection(json);
    const payload: QiblaDirectionPayload = { data, fromCache: false, retrievedAtUtc: this.now() };
    const cacheDays = Math.min(365, Math.max(1, this.options.qiblaCacheDays));
    this.store(cacheKey, { payload, expiresAtMs: payload.retrievedAtUtc.getTime() + cacheDays * 86_400_000 });
    return payload;
  }

  async getCompass(latitude: number, longitude: number, signal?: AbortSignal): Promise<QiblaCompassPayload> {
    QiblaProviderClient.ensureValidCoordinates(latitude, longitude);
    const latitudePath = QiblaProviderClient.formatCoordinate(latitude);
    const longitudePath = QiblaProviderClient.formatCoordinate(longitude);

    try {
      const response = await this.fetch(`${this.baseUrl}qibla/${latitudePath}/${longitudePath}/compass`, {
        headers: { 'User-Agent': 'IqamaTime/1.0', 'Accept-Encoding': 'gzip' },
        signal: requestSignal(QiblaProviderClient.timeoutMs, signal),
      });
      if (response.status !== 200) {
        discardBody(response);
        throw new IslamicContentProviderError(`The Qibla compass provider returned HTTP ${response.status}.`);
      }
      if (mediaType(response.headers.get('content-type'))?.toLowerCase() !== 'image/png') {
        discardBody(response);
        throw new IslamicContentProviderError('The Qibla provider returned an unexpected compass format.');
      }
      const declaredLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > QiblaProviderClient.maximumCompassBytes) {
        discardBody(response);
        throw new IslamicContentProviderError('The Qibla compass image exceeded the safe response limit.');
      }

      const content = Buffer.from(await response.arrayBuffer());
      if (content.length === 0 || content.length > QiblaProviderClient.maximumCompassBytes) {
        throw new IslamicContentProviderError('The Qibla compass image was empty or too large.');
      }
      return { content, contentType: 'image/png', retrievedAtUtc: this.now() };
    } catch (error) {
      translateFailure(error, 'The Qibla compass provider timed out.', 'The Qibla compass provider is currently unavailable.');
    }
  }

  static areValidCoordinates(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }

  /** Math.Round(value, 6, MidpointRounding.AwayFromZero).ToString("0.######", InvariantCulture). */
  static formatCoordinate(value: number): string {
    const scaled = value * 1e6;
    const truncated = Math.trunc(scaled);
    const fraction = scaled - truncated;
    let rounded = (Math.abs(fraction) >= 0.5 ? truncated + Math.sign(fraction) : truncated) / 1e6;
    if (rounded === 0) rounded = 0; // "-0" → "0"
    return rounded.toFixed(6).replace(/\.?0+$/, '');
  }

  private static ensureValidCoordinates(latitude: number, longitude: number): void {
    if (!QiblaProviderClient.areValidCoordinates(latitude, longitude)) throw new ArgumentError(COORDINATES_MESSAGE, 'latitude');
  }

  private static parseDirection(json: string): QiblaCoordinates {
    let root: unknown;
    try {
      root = JSON.parse(json) as unknown;
    } catch (error) {
      throw new IslamicContentProviderError('The Qibla provider returned invalid JSON.', { cause: error });
    }

    const envelope = asObject(root);
    const data = asObject(envelope?.data);
    const latitude = data?.latitude;
    const longitude = data?.longitude;
    const direction = data?.direction;
    if (
      envelope === null ||
      envelope.code !== 200 ||
      data === null ||
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      typeof direction !== 'number'
    ) {
      throw new IslamicContentProviderError('The Qibla provider returned an incomplete response.');
    }
    if (!QiblaProviderClient.areValidCoordinates(latitude, longitude) || !Number.isFinite(direction) || direction < 0 || direction >= 360) {
      throw new IslamicContentProviderError('The Qibla provider returned invalid direction data.');
    }
    return { latitude, longitude, direction };
  }

  private store(cacheKey: string, slot: CacheSlot): void {
    if (this.cache.size >= QiblaProviderClient.cacheSizeLimit) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(cacheKey, slot);
  }
}
