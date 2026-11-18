import { describe, expect, it } from 'vitest';
import { burnPasswordCheck, CURRENT_ITERATIONS, hashPassword, MAX_SUPPORTED_ITERATIONS, needsRehash, verifyPassword } from '../../src/core/password-hasher.js';

/** Reference hashes computed by node:crypto pbkdf2Sync (backend-node) for this password and salt. */
const PASSWORD = 'TestOnly-Password-1234';
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const NODE_100K = 'c7cdNfPJ09aEMVEodcVf5pslIkaNb609RhHPcpYqEUQ=';
const NODE_600K = 'ENDP6PS/6x1ZdUo3Emvzyqy0Ye5jSEOwn6vZdBIzk4o=';

async function pbkdf2(iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PASSWORD), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new Uint8Array(16), iterations }, key, 256);
}

/**
 * Records what the local runtime does. Finding (workerd 1.20261117): there is NO 100,000
 * cap locally; 600,000 iterations compute. The hasher therefore enforces the ceiling itself.
 */
describe('platform: WebCrypto PBKDF2 in workerd', () => {
  it('measures 100,000 iterations and probes higher counts', async () => {
    await pbkdf2(1_000);
    const timings: number[] = [];
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      await pbkdf2(100_000);
      timings.push(performance.now() - started);
    }
    console.log(`PBKDF2-SHA256 100,000 iterations in workerd, ms per hash: ${timings.map((ms) => ms.toFixed(1)).join(', ')}`);
    for (const iterations of [100_001, 600_000]) {
      const started = performance.now();
      const error = await pbkdf2(iterations).then(
        () => null,
        (reason: unknown) => reason as Error,
      );
      console.log(`PBKDF2 ${iterations}: ${error ? `${error.name}: ${error.message}` : `computed in ${(performance.now() - started).toFixed(1)} ms`}`);
      if (error) expect(error.name).toBe('NotSupportedError');
    }
  });
});

describe('password hasher', () => {
  it('writes "pbkdf2-sha256$100000$<base64>" with a 16-byte base64 salt', async () => {
    const { hash, salt } = await hashPassword(PASSWORD);
    expect(CURRENT_ITERATIONS).toBe(100_000);
    expect(hash).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9+/]{43}=$/);
    expect(atob(salt)).toHaveLength(16);
    expect(await verifyPassword(PASSWORD, hash, salt)).toBe('valid');
    expect(await verifyPassword(`${PASSWORD}x`, hash, salt)).toBe('invalid');
    expect(needsRehash(hash)).toBe(false);
    expect((await hashPassword(PASSWORD)).hash).not.toBe(hash);
  });

  it('verifies hashes computed by backend-node at 100,000 iterations, prefixed and legacy bare', async () => {
    expect(await verifyPassword(PASSWORD, `pbkdf2-sha256$100000$${NODE_100K}`, SALT)).toBe('valid');
    expect(await verifyPassword(PASSWORD, NODE_100K, SALT)).toBe('valid');
    expect(await verifyPassword('wrong', NODE_100K, SALT)).toBe('invalid');
    expect(needsRehash(NODE_100K)).toBe(true);
  });

  it("reports backend-node's 600,000-iteration hashes as unsupported, for right and wrong passwords alike", async () => {
    const stored = `pbkdf2-sha256$600000$${NODE_600K}`;
    expect(await verifyPassword(PASSWORD, stored, SALT)).toBe('unsupported');
    expect(await verifyPassword('wrong', stored, SALT)).toBe('unsupported');
    expect(MAX_SUPPORTED_ITERATIONS).toBe(100_000);
    expect(await verifyPassword(PASSWORD, `pbkdf2-sha256$100001$${NODE_100K}`, SALT)).toBe('unsupported');
  });

  it('treats malformed or out-of-range hashes as invalid without throwing', async () => {
    expect(await verifyPassword(PASSWORD, `pbkdf2-sha256$99999$${NODE_100K}`, SALT)).toBe('invalid');
    expect(await verifyPassword(PASSWORD, `pbkdf2-sha256$1000001$${NODE_100K}`, SALT)).toBe('invalid');
    expect(await verifyPassword(PASSWORD, 'c2hvcnQ=', SALT)).toBe('invalid');
    expect(await verifyPassword(PASSWORD, '!!not base64!!', SALT)).toBe('invalid');
    expect(await verifyPassword(PASSWORD, NODE_100K, '!!not base64!!')).toBe('invalid');
    expect(await verifyPassword(PASSWORD, '', '')).toBe('invalid');
  });

  it('burnPasswordCheck resolves without a stored hash', async () => {
    await expect(burnPasswordCheck(PASSWORD)).resolves.toBeUndefined();
  });
});
