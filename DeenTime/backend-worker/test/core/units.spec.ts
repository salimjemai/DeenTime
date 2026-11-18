import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isIP } from '../../src/core/client-address.js';
import { AppConfig } from '../../src/core/config.js';
import { fromDbBool, fromJsonArray, newId, normalizeId, now, toJsonArray } from '../../src/core/db.js';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, utf8 } from '../../src/core/encoding.js';
import { ProblemDetailsException } from '../../src/core/errors.js';
import { dateOnlyFromDb, dateOnlyToDb, formatDateTime, formatTimeOnly, isGuid, timeOnlyFromDb, timeOnlyToDb } from '../../src/core/json.js';
import { sha256, sha256HexLower, toHex } from '../../src/core/sha256.js';
import { modelStateKey, validate } from '../../src/core/validation.js';
import { hashToken, tryCreateIdentity } from '../../src/domain/registration-identity.js';

describe('config', () => {
  it('bakes appsettings.json defaults', () => {
    const config = AppConfig.fromEnv({});
    expect(config.environment).toBe('Production');
    expect(config.get('Auth:Issuer')).toBe('deentime');
    expect(config.get('Auth:Audience')).toBe('deentime-api');
    expect(config.get('Auth:SigningKey')).toBe('');
    expect(config.getBoolean('Captcha:Enabled')).toBe(false);
    expect(config.getInt('EmailDelivery:Port', 0)).toBe(587);
    expect(config.getArray('Cors:AllowedOrigins')).toEqual([
      'https://app.deentime.com',
      'http://localhost:4200',
      'http://127.0.0.1:4200',
      'capacitor://localhost',
      'tauri://localhost',
    ]);
    expect(config.get('IslamicContent:QuranBaseUrl')).toBe('https://api.alquran.cloud/v1/');
  });

  it('reads Section__Key variables case-insensitively and ignores bindings', () => {
    const config = AppConfig.fromEnv({
      DB: { prepare: () => null },
      Auth__SigningKey: 'secret',
      auth__issuer: 'from-env',
      Frontend__PublicBaseUrl: 'https://masjidhub.example',
      Cors__AllowedOrigins__0: 'https://one.example',
      Cors__AllowedOrigins__5: 'https://six.example',
      Captcha__Enabled: 'true',
      PLAIN: 'ignored',
    });
    expect(config.get('Auth:SigningKey')).toBe('secret');
    expect(config.get('AUTH:ISSUER')).toBe('from-env');
    expect(config.get('Auth__Issuer')).toBe('from-env');
    expect(config.get('Frontend:PublicBaseUrl')).toBe('https://masjidhub.example');
    expect(config.getBoolean('Captcha:Enabled')).toBe(true);
    expect(config.getArray('Cors:AllowedOrigins')).toEqual([
      'https://one.example',
      'http://localhost:4200',
      'http://127.0.0.1:4200',
      'capacitor://localhost',
      'tauri://localhost',
      'https://six.example',
    ]);
    expect(config.get('Plain')).toBeUndefined();
    expect(config.get('Missing:Key')).toBeUndefined();
    expect(config.getOrDefault('Missing:Key', 'fallback')).toBe('fallback');
    expect(config.getOrDefault('Storage:CdnBase', 'fallback')).toBe('fallback');
  });

  it('does not let one env change the defaults seen by another', () => {
    AppConfig.fromEnv({ Cors__AllowedOrigins__0: 'https://one.example', Support__Email: 'x@y.test' });
    const clean = AppConfig.fromEnv({});
    expect(clean.getArray('Cors:AllowedOrigins')[0]).toBe('https://app.deentime.com');
    expect(clean.get('Support:Email')).not.toBe('x@y.test');
  });

  it('resolves the environment name and applies overrides last', () => {
    expect(AppConfig.fromEnv({ ASPNETCORE_ENVIRONMENT: 'Development' }).isDevelopment()).toBe(true);
    expect(AppConfig.fromEnv({ NODE_ENV: 'test' }).environment).toBe('Testing');
    const config = AppConfig.fromEnv({ Auth__Issuer: 'env' }, { overrides: { 'Auth:Issuer': 'override' } });
    expect(config.get('Auth:Issuer')).toBe('override');
  });
});

describe('sha256', () => {
  it('matches the standard test vectors', () => {
    expect(sha256HexLower('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256HexLower('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256HexLower('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('agrees with WebCrypto across block boundaries and for non-ASCII text', async () => {
    for (const length of [1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 1000]) {
      const data = new Uint8Array(length).map((_, index) => (index * 31 + length) & 0xff);
      expect(toHex(sha256(data)), String(length)).toBe(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data))));
    }
    const text = 'مسجد النور | 78717';
    expect(sha256HexLower(text)).toBe(toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(text)))));
  });

  it('backs the registration identity hashes (upper-case hex, as backend-node writes them)', () => {
    expect(hashToken('abc')).toBe('BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD');
    const identity = tryCreateIdentity(' Imam@Masjid.Test ', 'Masjid  Noor', 'www.Noor.example/', '1 Main St', 'Austin', 'tx', '78717');
    expect(identity).toMatchObject({ email: 'imam@masjid.test', name: 'MASJID NOOR', websiteHost: 'noor.example', websiteUrl: 'https://noor.example' });
    expect(identity?.masjidIdentityKey).toBe(sha256HexLower('MASJID NOOR|78717').toUpperCase());
    expect(identity?.addressFingerprint).toBe(sha256HexLower('1 MAIN ST|AUSTIN|TX|78717').toUpperCase());
  });
});

describe('encoding', () => {
  it('round-trips base64 and base64url', () => {
    const bytes = new Uint8Array([0, 250, 251, 252, 253, 254, 255, 62, 63]);
    expect(bytesToBase64(bytes)).toBe('APr7/P3+/z4/');
    expect(bytesToBase64Url(bytes)).toBe('APr7_P3-_z4_');
    expect([...base64ToBytes('APr7/P3+/z4/')]).toEqual([...bytes]);
    expect([...base64ToBytes('APr7_P3-_z4_')]).toEqual([...bytes]);
    expect([...base64ToBytes('AQI=')]).toEqual([1, 2]);
    expect([...base64ToBytes('AQI')]).toEqual([1, 2]);
  });
});

describe('db value helpers', () => {
  it('now() is ISO-8601 UTC with milliseconds, the format backend-node emits', () => {
    expect(now(new Date(Date.UTC(2026, 10, 18, 9, 30, 0)))).toBe('2026-11-18T09:30:00.000Z');
    expect(now()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(formatDateTime(now(new Date(0)))).toBe('1970-01-01T00:00:00.000Z');
    expect(JSON.stringify({ at: new Date(0) })).toBe('{"at":"1970-01-01T00:00:00.000Z"}');
  });

  it('ids are lowercase UUIDs', () => {
    const id = newId();
    expect(isGuid(id)).toBe(true);
    expect(id).toBe(id.toLowerCase());
    expect(normalizeId(' 0B9D7A3E-6F0C-4A52-9D55-2F1F6F0C9A11 ')).toBe('0b9d7a3e-6f0c-4a52-9d55-2f1f6f0c9a11');
  });

  it('text[] columns are JSON arrays', () => {
    expect(toJsonArray(['Admin', 'Editor'])).toBe('["Admin","Editor"]');
    expect(toJsonArray(null)).toBe('[]');
    expect(fromJsonArray('["Admin","Editor"]')).toEqual(['Admin', 'Editor']);
    expect(fromJsonArray(null)).toEqual([]);
    expect(fromJsonArray('')).toEqual([]);
    expect(fromJsonArray('{broken')).toEqual([]);
  });

  it('booleans, dates and times', () => {
    expect([fromDbBool(1), fromDbBool(0), fromDbBool(null)]).toEqual([true, false, false]);
    expect(dateOnlyToDb(dateOnlyFromDb('2026-09-10'))).toBe('2026-09-10');
    expect(dateOnlyFromDb('2026-09-10').toISOString()).toBe('2026-09-10T00:00:00.000Z');
    expect(timeOnlyFromDb('13:45:00')).toEqual({ hour: 13, minute: 45, second: 0 });
    expect(timeOnlyToDb({ hour: 5, minute: 7, second: 9 })).toBe('05:07:09');
    expect(formatTimeOnly(timeOnlyFromDb('05:07:09'))).toBe('05:07:09');
  });
});

describe('client address validation', () => {
  it('accepts IPv4 and IPv6 and nothing else', () => {
    for (const value of ['203.0.113.10', '0.0.0.0', '255.255.255.255']) expect(isIP(value), value).toBe(4);
    for (const value of ['::1', '::', '2001:db8::7', '2001:db8:0:0:0:0:0:1', '::ffff:203.0.113.10', 'fe80::1%eth0']) expect(isIP(value), value).toBe(6);
    for (const value of ['', 'unknown', '256.1.1.1', '1.2.3', '1.2.3.4.5', '01.2.3.4', '2001:db8', '1::2::3', '2001:db8:0:0:0:0:0:0:1', 'g::1', '203.0.113.10, 10.0.0.1']) {
      expect(isIP(value), value).toBe(0);
    }
  });
});

describe('validate', () => {
  const schema = z.object({ email: z.string().email('Enter a valid email.'), items: z.array(z.object({ offsetMinutes: z.number() })).optional() });

  it('returns the parsed value', () => {
    expect(validate(schema, { email: 'a@b.test' })).toEqual({ email: 'a@b.test' });
  });

  it('throws the model-validation problem with PascalCase keys', () => {
    let thrown: unknown;
    try {
      validate(schema, { email: 'nope', items: [{ offsetMinutes: 1 }, { offsetMinutes: 'x' }] });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProblemDetailsException);
    const details = (thrown as ProblemDetailsException).problem;
    expect(Object.keys(details)).toEqual(['title', 'status', 'errors']);
    expect(details.title).toBe('One or more validation errors occurred.');
    expect(details.status).toBe(400);
    expect(Object.keys(details.errors ?? {})).toEqual(['Email', 'Items[1].OffsetMinutes']);
    expect(details.errors?.Email).toEqual(['Enter a valid email.']);
  });

  it('treats null and undefined as {} and maps paths like backend-node', () => {
    expect(() => validate(schema, undefined)).toThrow(ProblemDetailsException);
    expect(modelStateKey([])).toBe('');
    expect(modelStateKey(['organizationId'])).toBe('OrganizationId');
    expect(modelStateKey(['entries', 0, 'time'])).toBe('Entries[0].Time');
    expect(modelStateKey(['a', 'b', 2, 3])).toBe('A.B[2][3]');
  });
});
