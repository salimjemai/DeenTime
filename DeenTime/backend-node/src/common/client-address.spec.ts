import { describe, expect, it } from 'vitest';
import { AppConfig } from '../config/configuration.js';
import { ClientAddressResolver, isLoopback, type ClientAddressRequest } from './client-address.js';

function resolver(overrides: Record<string, string> = {}): ClientAddressResolver {
  return new ClientAddressResolver(AppConfig.load({ contentRoot: import.meta.dirname, environmentName: 'Testing', env: {}, overrides }));
}

function request(remoteAddress: string | undefined, headers: Record<string, string | string[]> = {}): ClientAddressRequest {
  return { socket: { remoteAddress }, headers };
}

const HEADER = { 'Proxy:ClientIpHeader': 'X-MasjidHub-Client-IP' };
const KEYED = { ...HEADER, 'Proxy:SharedKey': 'proxy-key-for-tests' };

describe('ClientAddressResolver', () => {
  it('uses the TCP peer when no proxy header is configured, whatever the request claims', () => {
    const direct = resolver();
    expect(direct.resolve(request('203.0.113.7'))).toBe('203.0.113.7');
    expect(direct.resolve(request('127.0.0.1', { 'x-masjidhub-client-ip': '198.51.100.4', 'x-forwarded-for': '198.51.100.4' }))).toBe('127.0.0.1');
    expect(direct.resolve({ socket: null, ip: '203.0.113.9', headers: {} })).toBe('203.0.113.9');
    expect(direct.resolve({ headers: {} })).toBeUndefined();
  });

  it('reads the configured header from a loopback proxy (IPv4, IPv6 and mapped peers)', () => {
    const proxied = resolver(HEADER);
    for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(proxied.resolve(request(peer, { 'x-masjidhub-client-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    }
    expect(proxied.resolve(request('::1', { 'x-masjidhub-client-ip': '2001:db8::17' }))).toBe('2001:db8::17');
  });

  it('never believes the header from a peer that is not on this machine', () => {
    expect(resolver(HEADER).resolve(request('203.0.113.7', { 'x-masjidhub-client-ip': '198.51.100.4' }))).toBe('203.0.113.7');
  });

  it('takes the entry the nearest proxy appended when the header holds a list', () => {
    const nginx = resolver({ 'Proxy:ClientIpHeader': 'X-Forwarded-For' });
    expect(nginx.resolve(request('127.0.0.1', { 'x-forwarded-for': '10.9.9.9, 198.51.100.4' }))).toBe('198.51.100.4');
    expect(nginx.resolve(request('127.0.0.1', { 'x-forwarded-for': ['10.9.9.9', '198.51.100.5'] }))).toBe('198.51.100.5');
  });

  it('falls back to the peer when the header is missing or is not an address', () => {
    const proxied = resolver(HEADER);
    expect(proxied.resolve(request('127.0.0.1'))).toBe('127.0.0.1');
    expect(proxied.resolve(request('127.0.0.1', { 'x-masjidhub-client-ip': '' }))).toBe('127.0.0.1');
    expect(proxied.resolve(request('127.0.0.1', { 'x-masjidhub-client-ip': 'not-an-address' }))).toBe('127.0.0.1');
  });

  it('requires the shared proxy key before believing the header when one is configured', () => {
    const keyed = resolver(KEYED);
    const claimed = { 'x-masjidhub-client-ip': '198.51.100.4' };
    expect(keyed.resolve(request('127.0.0.1', { ...claimed, 'x-masjidhub-proxy-key': 'proxy-key-for-tests' }))).toBe('198.51.100.4');
    expect(keyed.resolve(request('127.0.0.1', claimed))).toBe('127.0.0.1');
    expect(keyed.resolve(request('127.0.0.1', { ...claimed, 'x-masjidhub-proxy-key': 'wrong' }))).toBe('127.0.0.1');
    expect(keyed.resolve(request('127.0.0.1', { ...claimed, 'x-masjidhub-proxy-key': 'proxy-key-for-tests-and-more' }))).toBe('127.0.0.1');
  });
});

describe('isLoopback', () => {
  it('recognizes loopback peers only', () => {
    expect(['127.0.0.1', '127.8.8.8', '::1', '::ffff:127.0.0.1'].every(isLoopback)).toBe(true);
    expect(['10.0.0.1', '203.0.113.7', '::ffff:10.0.0.1', '', undefined, null].some(isLoopback)).toBe(false);
  });
});
