import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../../config/configuration.js';
import {
  absoluteRoute,
  dotnetTicks,
  embedScriptUrl,
  escapeDataString,
  PublicOriginError,
  resolvePublicOrigin,
  ticksFromUtcText,
  uriToString,
  versionedAssetUrl,
  type PublicOriginRequest,
} from './public-origin.js';

function config(overrides: Record<string, string>, environmentName = 'Testing'): AppConfig {
  return AppConfig.load({ contentRoot: tmpdir(), env: {}, overrides, environmentName });
}

function request(headers: Record<string, string | string[]>, protocol = 'http'): PublicOriginRequest {
  const lowered = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return { protocol, header: (name) => lowered.get(name.toLowerCase()) };
}

describe('resolvePublicOrigin', () => {
  it('prefers a configured absolute http(s) Frontend:PublicBaseUrl', () => {
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'https://iqamatime.com' }), request({ host: 'ignored.test' })).href).toBe('https://iqamatime.com/');
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'HTTPS://IqamaTime.com/App' }), request({})).href).toBe('https://iqamatime.com/App');
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'https://iqamatime.com:443' }), request({})).href).toBe('https://iqamatime.com/');
  });

  it('forces https on a configured http URL outside Development, keeping a non-default port', () => {
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'http://iqamatime.com' }), request({})).href).toBe('https://iqamatime.com/');
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'http://iqamatime.com:8080' }), request({})).href).toBe('https://iqamatime.com:8080/');
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'http://iqamatime.com:80/x?q=1#f' }), request({})).href).toBe('https://iqamatime.com/x?q=1#f');
    expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': 'http://localhost:4200' }, 'Development'), request({})).href).toBe('http://localhost:4200/');
  });

  it('rejects a configured loopback origin outside Development', () => {
    for (const url of ['http://localhost:4200', 'https://127.0.0.1', 'https://[::1]:8443']) {
      const act = () => resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': url }), request({}));
      if (url.includes('::1')) expect(act).not.toThrow();
      else expect(act).toThrow(new PublicOriginError('Production public display URLs must use a non-local HTTPS origin.'));
    }
  });

  it('ignores a configured value that is not an absolute http(s) URL', () => {
    for (const configured of ['ftp://x.com', 'iqamatime.com', '/relative', '', '   ']) {
      expect(resolvePublicOrigin(config({ 'Frontend:PublicBaseUrl': configured }), request({ 'x-forwarded-host': 'public.test' })).href).toBe('https://public.test/');
    }
  });

  it('falls back to X-Forwarded-Proto / X-Forwarded-Host, forcing https outside Development', () => {
    expect(resolvePublicOrigin(config({}), request({ 'x-forwarded-proto': 'http', 'x-forwarded-host': 'example.com', host: 'internal:8080' })).href).toBe('https://example.com/');
    expect(resolvePublicOrigin(config({}), request({ 'x-forwarded-proto': 'https, http', 'x-forwarded-host': 'a.example.com, b.example.com' })).href).toBe('https://a.example.com/');
    expect(resolvePublicOrigin(config({}), request({ 'x-forwarded-host': ['first.example.com', 'second.example.com'] })).href).toBe('https://first.example.com/');
    expect(resolvePublicOrigin(config({}), request({ 'x-forwarded-host': 'example.com:8443' })).href).toBe('https://example.com:8443/');
    expect(resolvePublicOrigin(config({}), request({ host: 'example.com' })).href).toBe('https://example.com/');
    expect(resolvePublicOrigin(config({}), request({ 'x-forwarded-proto': 'HTTPS', host: 'Example.COM' })).href).toBe('https://example.com/');
  });

  it('keeps the request scheme and host in Development', () => {
    expect(resolvePublicOrigin(config({}, 'Development'), request({ host: 'localhost:3000' })).href).toBe('http://localhost:3000/');
    expect(resolvePublicOrigin(config({}, 'Development'), request({ 'x-forwarded-proto': 'https', host: 'localhost:3000' })).href).toBe('https://localhost:3000/');
    expect(resolvePublicOrigin(config({}, 'Development'), request({ 'x-forwarded-proto': '  ', host: 'dev.test' }, 'https')).href).toBe('https://dev.test/');
  });

  it('rejects unsafe or loopback fallback hosts', () => {
    const unsafe = new PublicOriginError('A safe public frontend origin is required for public display links.');
    expect(() => resolvePublicOrigin(config({}), request({}))).toThrow(unsafe);
    expect(() => resolvePublicOrigin(config({}), request({ host: '' }))).toThrow(unsafe);
    expect(() => resolvePublicOrigin(config({}), request({ 'x-forwarded-host': '', host: 'example.com' }))).toThrow(unsafe);
    expect(() => resolvePublicOrigin(config({}), request({ host: 'user@example.com' }))).toThrow(unsafe);
    expect(() => resolvePublicOrigin(config({}), request({ host: 'example.com/path' }))).toThrow(unsafe);
    const loopback = new PublicOriginError('Production public display URLs must use a non-local HTTPS origin.');
    expect(() => resolvePublicOrigin(config({}), request({ host: 'localhost:8080' }))).toThrow(loopback);
    expect(() => resolvePublicOrigin(config({}), request({ 'x-forwarded-host': '127.0.0.1' }))).toThrow(loopback);
    expect(() => resolvePublicOrigin(config({}, 'Development'), request({ host: 'localhost:8080' }))).not.toThrow();
  });
});

describe('escapeDataString', () => {
  it('escapes everything but RFC 3986 unreserved characters', () => {
    expect(escapeDataString("a b+c/d?e#f&g=h'i(j)k*l!m~n.o_p-q")).toBe('a%20b%2Bc%2Fd%3Fe%23f%26g%3Dh%27i%28j%29k%2Al%21m~n.o_p-q');
    expect(escapeDataString('café مسجد 😀')).toBe('caf%C3%A9%20%D9%85%D8%B3%D8%AC%D8%AF%20%F0%9F%98%80');
  });
});

describe('absoluteRoute / uriToString', () => {
  const origin = new URL('https://example.com/');

  // Values observed from new Uri(origin, "tv/" + Uri.EscapeDataString(slug)).ToString() on .NET 10.
  it.each([
    ['a b', 'https://example.com/tv/a b'],
    ['a+b', 'https://example.com/tv/a%2Bb'],
    ['a/b', 'https://example.com/tv/a%2Fb'],
    ['a%b', 'https://example.com/tv/a%25b'],
    ['café', 'https://example.com/tv/café'],
    ['مسجد', 'https://example.com/tv/مسجد'],
    ['a?b', 'https://example.com/tv/a%3Fb'],
    ['a#b', 'https://example.com/tv/a%23b'],
    ['a&b=c', 'https://example.com/tv/a%26b%3Dc'],
    ["a'b", 'https://example.com/tv/a%27b'],
    ['a(b)', 'https://example.com/tv/a%28b%29'],
    ['a*b', 'https://example.com/tv/a%2Ab'],
    ['a!b', 'https://example.com/tv/a%21b'],
    ['a~b', 'https://example.com/tv/a~b'],
    ['a.b_c-d', 'https://example.com/tv/a.b_c-d'],
    ['A B', 'https://example.com/tv/A B'],
    ['a"b', 'https://example.com/tv/a"b'],
    ['a<b>', 'https://example.com/tv/a<b>'],
    ['a{b}', 'https://example.com/tv/a{b}'],
    ['a|b', 'https://example.com/tv/a|b'],
    ['a`b', 'https://example.com/tv/a`b'],
    ['a^b', 'https://example.com/tv/a^b'],
    ['a\\b', 'https://example.com/tv/a%5Cb'],
    ['a[b]', 'https://example.com/tv/a%5Bb%5D'],
    ['a@b', 'https://example.com/tv/a%40b'],
    ['a:b', 'https://example.com/tv/a%3Ab'],
    ['a;b', 'https://example.com/tv/a%3Bb'],
    ['a,b', 'https://example.com/tv/a%2Cb'],
    ['a$b', 'https://example.com/tv/a%24b'],
    ['😀', 'https://example.com/tv/😀'],
    ['ab', 'https://example.com/tv/a%01b'],
    ['ab', 'https://example.com/tv/a%7Fb'],
    ['a b', 'https://example.com/tv/a b'],
    ['%20', 'https://example.com/tv/%2520'],
  ])('renders the escaped slug %j like Uri.ToString()', (slug, expected) => {
    expect(absoluteRoute(origin, `/tv/${escapeDataString(slug)}`)).toBe(expected);
  });

  it('resolves the path against the origin like new Uri(baseUri, relativeUri)', () => {
    expect(absoluteRoute(new URL('https://iqamatime.com/app'), '/tv/slug')).toBe('https://iqamatime.com/tv/slug');
    expect(absoluteRoute(new URL('https://iqamatime.com/app/'), '///tv/slug')).toBe('https://iqamatime.com/app/tv/slug');
    expect(absoluteRoute(new URL('https://iqamatime.com/x?q=1#f'), '/w/slug/daily')).toBe('https://iqamatime.com/w/slug/daily');
    expect(absoluteRoute(new URL('https://iqamatime.com/a b/'), '/w2/slug')).toBe('https://iqamatime.com/a b/w2/slug');
  });

  it('keeps invalid or private-use percent-encoded sequences encoded', () => {
    expect(uriToString(new URL('https://h/a%C3b%FF'))).toBe('https://h/a%C3b%FF');
    expect(uriToString(new URL('https://h/%EE%80%80%C2%85'))).toBe('https://h/%EE%80%80%C2%85');
    expect(uriToString(new URL('https://h/%2f%7e'))).toBe('https://h/%2F~');
  });
});

describe('embedScriptUrl', () => {
  it('points at /iqamatime-embed.js on the URL authority', () => {
    expect(embedScriptUrl('https://public.deentime.test/w/slug/daily')).toBe('https://public.deentime.test/iqamatime-embed.js');
    expect(embedScriptUrl('https://example.com:8443/app/w/slug')).toBe('https://example.com:8443/iqamatime-embed.js');
    expect(embedScriptUrl('https://user:pw@iqamatime.com/w/slug')).toBe('https://user:pw@iqamatime.com/iqamatime-embed.js');
    expect(embedScriptUrl('http://127.0.0.1:4200/w/a b')).toBe('http://127.0.0.1:4200/iqamatime-embed.js');
  });
});

describe('dotnetTicks', () => {
  it('counts 100 ns intervals since 0001-01-01', () => {
    expect(dotnetTicks(new Date(0))).toBe('621355968000000000');
    expect(dotnetTicks(new Date('2026-09-10T20:11:07.100Z'))).toBe('639246678671000000');
    expect(dotnetTicks(new Date('2026-09-10T20:11:07.100Z'), 348)).toBe('639246678671003480');
  });

  it('reads the microseconds PostgreSQL renders with to_char', () => {
    expect(ticksFromUtcText('2026-09-10T20:11:07.100348')).toBe('639246678671003480');
    expect(ticksFromUtcText('2026-09-10T20:11:07')).toBe('639246678670000000');
    expect(ticksFromUtcText('2026-09-10T20:11:07.1')).toBe('639246678671000000');
    expect(ticksFromUtcText('2026-09-10T20:11:07.000001')).toBe('639246678670000010');
    expect(ticksFromUtcText('2026-09-10 20:11:07.100348')).toBeNull();
    expect(ticksFromUtcText(undefined)).toBeNull();
    expect(ticksFromUtcText(null)).toBeNull();
  });
});

describe('versionedAssetUrl', () => {
  const version = '639246678671003480';
  const origin = () => new URL('https://example.com/');
  const noOrigin = (): URL => {
    throw new Error('origin must not be resolved for absolute URLs');
  };

  it('returns null for blank values', () => {
    expect(versionedAssetUrl(null, version, origin)).toBeNull();
    expect(versionedAssetUrl(undefined, version, origin)).toBeNull();
    expect(versionedAssetUrl('', version, origin)).toBeNull();
    expect(versionedAssetUrl('   ', version, origin)).toBeNull();
  });

  // Values observed from VersionedAssetUrl on .NET 10 (relative values as on Windows, where "/x" is not an absolute Uri).
  it.each([
    ['https://cdn.example.com/img.png', 'https://cdn.example.com/img.png?v=639246678671003480'],
    ['https://cdn.example.com/img.png?a=1', 'https://cdn.example.com/img.png?a=1&v=639246678671003480'],
    ['https://cdn.example.com/img.png?a=1&b=2', 'https://cdn.example.com/img.png?a=1&b=2&v=639246678671003480'],
    ['https://cdn.example.com/img.png?', 'https://cdn.example.com/img.png?&v=639246678671003480'],
    ['https://cdn.example.com/img.png#frag', 'https://cdn.example.com/img.png?v=639246678671003480#frag'],
    ['https://cdn.example.com/img.png?x=1#frag', 'https://cdn.example.com/img.png?x=1&v=639246678671003480#frag'],
    ['https://cdn/a b.png', 'https://cdn/a b.png?v=639246678671003480'],
    ['https://cdn/a%20b.png', 'https://cdn/a b.png?v=639246678671003480'],
    ['https://cdn/café.png', 'https://cdn/café.png?v=639246678671003480'],
    ['HTTPS://CDN.Example.com:443/Img.PNG', 'https://cdn.example.com/Img.PNG?v=639246678671003480'],
    ['https://cdn.example.com:8443/img.png', 'https://cdn.example.com:8443/img.png?v=639246678671003480'],
    ['http://cdn/x.png?a=b+c&d=%20', 'http://cdn/x.png?a=b+c&d= &v=639246678671003480'],
  ])('versions the absolute URL %s without consulting the origin', (value, expected) => {
    expect(versionedAssetUrl(value, version, noOrigin)).toBe(expected);
  });

  it.each([
    ['/uploads/orgs/x/header-guid.png', 'https://example.com/uploads/orgs/x/header-guid.png?v=639246678671003480'],
    ['uploads/x.png', 'https://example.com/uploads/x.png?v=639246678671003480'],
    ['///uploads/x.png', 'https://example.com/uploads/x.png?v=639246678671003480'],
    ['/uploads/x.png?v=old', 'https://example.com/uploads/x.png?v=old&v=639246678671003480'],
    ['/uploads/../x.png', 'https://example.com/x.png?v=639246678671003480'],
    ['/uploads/orgs/header a.png', 'https://example.com/uploads/orgs/header a.png?v=639246678671003480'],
  ])('resolves the relative value %s against the public origin', (value, expected) => {
    expect(versionedAssetUrl(value, version, origin)).toBe(expected);
  });

  it('resolves relative values against a base path the way System.Uri does', () => {
    expect(versionedAssetUrl('/uploads/x.png', version, () => new URL('https://iqamatime.com/app/'))).toBe('https://iqamatime.com/app/uploads/x.png?v=639246678671003480');
    expect(versionedAssetUrl('/uploads/x.png', version, () => new URL('https://iqamatime.com/app'))).toBe('https://iqamatime.com/uploads/x.png?v=639246678671003480');
  });
});
