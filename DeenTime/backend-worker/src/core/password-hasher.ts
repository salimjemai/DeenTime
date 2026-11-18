import { base64ToBytes, bytesToBase64, randomBytes, timingSafeEqual, utf8 } from './encoding.js';

/**
 * PBKDF2-SHA256 hashes in the stored format shared with backend-node and the .NET API:
 * "pbkdf2-sha256$<iterations>$<base64 hash>", salt kept separately as base64. A bare
 * base64 hash is the legacy 100,000-iteration format.
 *
 * New hashes use 100,000 iterations, a count backend-node also verifies. Hashes above
 * MAX_SUPPORTED_ITERATIONS (backend-node writes 600,000) are not attempted:
 * verifyPassword reports them as 'unsupported' so the login handler can ask the user to
 * reset the password instead of answering "wrong password". Two reasons, see README.md:
 *  - Cloudflare's production runtime has rejected PBKDF2 above 100,000 iterations
 *    (NotSupportedError). Local workerd does NOT enforce that cap (it computed 600,000 in
 *    test/core/password-hasher.spec.ts), so the ceiling is enforced here, and a
 *    NotSupportedError from the platform is mapped to 'unsupported' as well;
 *  - CPU: 100,000 iterations already cost tens of milliseconds, 600,000 six times that.
 */
export const CURRENT_ITERATIONS = 100_000;
/** Highest iteration count verifyPassword will compute on this platform. */
export const MAX_SUPPORTED_ITERATIONS = 100_000;
const LEGACY_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;
const PREFIX = 'pbkdf2-sha256';

export interface PasswordHash {
  hash: string;
  salt: string;
}

/**
 * - 'valid': the password matches.
 * - 'invalid': it does not match, or the stored hash/salt is malformed.
 * - 'unsupported': the stored hash is well-formed but uses an iteration count this
 *   platform does not compute; the password was not checked.
 */
export type PasswordVerification = 'valid' | 'invalid' | 'unsupported';

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, CURRENT_ITERATIONS);
  return { hash: `${PREFIX}$${CURRENT_ITERATIONS}$${bytesToBase64(hash)}`, salt: bytesToBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<PasswordVerification> {
  let saltBytes: Uint8Array;
  let expected: Uint8Array;
  let iterations = LEGACY_ITERATIONS;
  try {
    saltBytes = base64ToBytes(salt);
    let encoded = hash;
    const parts = hash.split('$').filter((part) => part.length > 0);
    if (parts.length === 3 && parts[0] === PREFIX && /^\d+$/.test(parts[1])) {
      iterations = Number(parts[1]);
      encoded = parts[2];
    }
    if (iterations < LEGACY_ITERATIONS || iterations > MAX_ITERATIONS) return 'invalid';
    expected = base64ToBytes(encoded);
    if (expected.length !== 32) return 'invalid';
  } catch {
    return 'invalid';
  }
  if (iterations > MAX_SUPPORTED_ITERATIONS) return 'unsupported';
  let actual: Uint8Array;
  try {
    actual = await derive(password, saltBytes, iterations);
  } catch (error) {
    // The platform refused the iteration count; anything else is a real fault.
    if (error instanceof Error && error.name === 'NotSupportedError') return 'unsupported';
    throw error;
  }
  return timingSafeEqual(actual, expected) ? 'valid' : 'invalid';
}

/**
 * Costs the same as verifying a real hash; call it when the account does not exist so
 * login timing does not reveal which emails are registered (backend-node's DUMMY_PASSWORD,
 * without hashing anything at module load).
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  await derive(password, new Uint8Array(16), CURRENT_ITERATIONS);
}

/** True when a successfully verified hash should be rewritten in the current format. */
export function needsRehash(hash: string): boolean {
  return !hash.startsWith(`${PREFIX}$${CURRENT_ITERATIONS}$`);
}
