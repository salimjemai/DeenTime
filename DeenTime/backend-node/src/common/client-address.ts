import { Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { AppConfig } from '../config/configuration.js';

/** Header a trusted reverse proxy uses to prove itself when Proxy:SharedKey is set. */
export const PROXY_KEY_HEADER = 'x-masjidhub-proxy-key';

/** The parts of an Express request the resolver reads. */
export interface ClientAddressRequest {
  socket?: { remoteAddress?: string | null } | null;
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The visitor address used for IP-partitioned rate limits and Turnstile.
 *
 * Exposed directly, the API uses the TCP peer, as Program.cs did. Behind a reverse
 * proxy on the same machine (cloudflared, nginx) every peer is loopback and all
 * visitors would share one rate-limit window, so:
 *
 * - `Proxy:ClientIpHeader` names the header the proxy puts the visitor address in
 *   (`X-MasjidHub-Client-IP` from the Cloudflare Pages proxy, `X-Real-IP` from nginx).
 *   When it holds a list, the last entry (the one the nearest proxy appended) is used.
 * - `Proxy:SharedKey`, when set, must arrive in `X-MasjidHub-Proxy-Key` for the header
 *   to be believed. The tunnel hostname is reachable by anyone, so without the key a
 *   caller could invent an address per request.
 *
 * The header is only ever read from loopback peers; anything else falls back to the peer.
 */
@Injectable()
export class ClientAddressResolver {
  private readonly header: string;
  private readonly sharedKeyDigest: Buffer | null;

  constructor(config: AppConfig) {
    this.header = (config.get('Proxy:ClientIpHeader') ?? '').trim().toLowerCase();
    const sharedKey = (config.get('Proxy:SharedKey') ?? '').trim();
    this.sharedKeyDigest = sharedKey === '' ? null : digest(sharedKey);
  }

  resolve(request: ClientAddressRequest): string | undefined {
    const peer = request.socket?.remoteAddress ?? request.ip ?? undefined;
    if (this.header === '' || !isLoopback(peer) || !this.proxyIsTrusted(request)) return peer;
    const forwarded = lastValue(request.headers[this.header]);
    return forwarded !== undefined && isIP(forwarded) !== 0 ? forwarded : peer;
  }

  private proxyIsTrusted(request: ClientAddressRequest): boolean {
    if (this.sharedKeyDigest === null) return true;
    const presented = lastValue(request.headers[PROXY_KEY_HEADER]);
    return presented !== undefined && timingSafeEqual(digest(presented), this.sharedKeyDigest);
  }
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function lastValue(raw: string | string[] | undefined): string | undefined {
  const joined = Array.isArray(raw) ? raw.join(',') : raw;
  const value = joined?.split(',').at(-1)?.trim();
  return value === undefined || value === '' ? undefined : value;
}

export function isLoopback(address: string | null | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized.startsWith('127.');
}
