import { describe, expect, it } from 'vitest';
import { AppConfig } from '../../src/core/config.js';
import { JwtService } from '../../src/core/jwt.js';
import { TEST_SIGNING_KEY } from '../support/test-app.js';

/**
 * Tokens produced by backend-node (jsonwebtoken 9, JwtService.issue) with the test key,
 * issuer "deentime-test", audience "deentime-api-test" and Date.now() fixed at 1800000000000.
 */
const NOW = 1_800_000_000_000;
const ORG = '0b9d7a3e-6f0c-4a52-9d55-2f1f6f0c9a11';
const NODE_SINGLE_ROLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEiLCJlbWFpbCI6ImltYW1AbWFzamlkLnRlc3QiLCJvcmdJZCI6IjBiOWQ3YTNlLTZmMGMtNGE1Mi05ZDU1LTJmMWY2ZjBjOWExMSIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTgwMDAwMDAwMCwiZXhwIjoxODAwMDQzMjAwLCJhdWQiOiJkZWVudGltZS1hcGktdGVzdCIsImlzcyI6ImRlZW50aW1lLXRlc3QifQ.uE7KwxI06knW9HNeFSco70vALvV6Fvf3nTrIV3RYrm8';
const NODE_TWO_ROLES =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTIiLCJlbWFpbCI6IiIsIm9yZ0lkIjoiMGI5ZDdhM2UtNmYwYy00YTUyLTlkNTUtMmYxZjZmMGM5YTExIiwicm9sZSI6WyJBZG1pbiIsIlN1cGVyVXNlciJdLCJpYXQiOjE4MDAwMDAwMDAsImV4cCI6MTgwMDA0MzIwMCwiYXVkIjoiZGVlbnRpbWUtYXBpLXRlc3QiLCJpc3MiOiJkZWVudGltZS10ZXN0In0.6eOCD9C4F3VMt-IlGnCJeTe4sBQhnm1JB_gFjlsJGcs';

function service(overrides: Record<string, string> = {}): JwtService {
  return new JwtService(
    AppConfig.fromEnv({ Auth__Issuer: 'deentime-test', Auth__Audience: 'deentime-api-test', Auth__SigningKey: TEST_SIGNING_KEY, ...overrides }),
  );
}

describe('JwtService', () => {
  it('issues byte-identical tokens to backend-node', async () => {
    const jwt = service();
    expect(await jwt.issue({ id: 'user-1', email: 'imam@masjid.test' }, ORG, ['Admin'], NOW)).toBe(NODE_SINGLE_ROLE);
    expect(await jwt.issue({ id: 'user-2', email: null }, ORG, ['Admin', 'SuperUser'], NOW)).toBe(NODE_TWO_ROLES);
  });

  it('verifies tokens issued by backend-node', async () => {
    const jwt = service();
    expect(await jwt.verify(NODE_SINGLE_ROLE, NOW)).toEqual({
      sub: 'user-1',
      email: 'imam@masjid.test',
      orgId: ORG,
      roles: ['Admin'],
      issuer: 'deentime-test',
    });
    expect(await jwt.verify(NODE_TWO_ROLES, NOW)).toEqual({ sub: 'user-2', email: '', orgId: ORG, roles: ['Admin', 'SuperUser'], issuer: 'deentime-test' });
  });

  it('omits the role claim when there are no roles', async () => {
    const jwt = service();
    const token = await jwt.issue({ id: 'u', email: 'u@masjid.test' }, ORG, [], NOW);
    expect(JSON.parse(atob(token.split('.')[1]))).toEqual({
      sub: 'u',
      email: 'u@masjid.test',
      orgId: ORG,
      iat: 1_800_000_000,
      exp: 1_800_043_200,
      aud: 'deentime-api-test',
      iss: 'deentime-test',
    });
    expect((await jwt.verify(token, NOW))?.roles).toEqual([]);
  });

  it('lives 12 hours with a 300 second tolerance', async () => {
    const jwt = service();
    const expiry = NOW + 12 * 3600 * 1000;
    expect(await jwt.verify(NODE_SINGLE_ROLE, expiry + 299_000)).not.toBeNull();
    expect(await jwt.verify(NODE_SINGLE_ROLE, expiry + 300_000)).toBeNull();
  });

  it('rejects missing, malformed and tampered tokens', async () => {
    const jwt = service();
    const [header, payload, signature] = NODE_SINGLE_ROLE.split('.');
    const forgedPayload = btoa(JSON.stringify({ ...JSON.parse(atob(payload)), role: 'SuperUser' })).replace(/=+$/, '');
    for (const token of [undefined, null, '', 'abc', 'a.b.c', `${header}.${payload}`, `${header}.${payload}.`, `${header}.${forgedPayload}.${signature}`]) {
      expect(await jwt.verify(token, NOW), String(token)).toBeNull();
    }
    const none = `${btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/=+$/, '')}.${payload}.${signature}`;
    expect(await jwt.verify(none, NOW)).toBeNull();
  });

  it('rejects another key, issuer or audience', async () => {
    expect(await service({ Auth__SigningKey: 'another-signing-key-that-is-long-enough-000' }).verify(NODE_SINGLE_ROLE, NOW)).toBeNull();
    expect(await service({ Auth__Issuer: 'someone-else' }).verify(NODE_SINGLE_ROLE, NOW)).toBeNull();
    expect(await service({ Auth__Audience: 'someone-else' }).verify(NODE_SINGLE_ROLE, NOW)).toBeNull();
  });

  it('refuses a missing or short signing key, like backend-node at startup', () => {
    expect(() => service({ Auth__SigningKey: '' })).toThrow(/must be configured/);
    expect(() => service({ Auth__SigningKey: 'too-short' })).toThrow(/at least 32 bytes/);
    expect(() => service({ Auth__Authority: 'https://login.example' })).toThrow(/not supported/);
  });
});
