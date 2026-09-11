import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * PBKDF2-SHA256 hashes in the exact format written by the .NET API
 * ("pbkdf2-sha256$600000$<base64 hash>", salt kept separately as base64), so
 * existing accounts keep their passwords. The legacy bare-base64 100k-iteration
 * format is still accepted and reported by needsRehash().
 */
const CURRENT_ITERATIONS = 600_000;
const LEGACY_ITERATIONS = 100_000;
const PREFIX = 'pbkdf2-sha256';

export interface PasswordHash {
  hash: string;
  salt: string;
}

export function hashPassword(password: string): PasswordHash {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, CURRENT_ITERATIONS, 32, 'sha256');
  return { hash: `${PREFIX}$${CURRENT_ITERATIONS}$${hash.toString('base64')}`, salt: salt.toString('base64') };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  try {
    const saltBytes = Buffer.from(salt, 'base64');
    let iterations = LEGACY_ITERATIONS;
    let encoded = hash;
    const parts = hash.split('$').filter((part) => part.length > 0);
    if (parts.length === 3 && parts[0] === PREFIX && /^\d+$/.test(parts[1])) {
      iterations = Number(parts[1]);
      encoded = parts[2];
    }
    if (iterations < LEGACY_ITERATIONS || iterations > 1_000_000) return false;
    const expected = Buffer.from(encoded, 'base64');
    if (expected.length !== 32) return false;
    const actual = pbkdf2Sync(password, saltBytes, iterations, 32, 'sha256');
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function needsRehash(hash: string): boolean {
  return !hash.startsWith(`${PREFIX}$${CURRENT_ITERATIONS}$`);
}

/** A throw-away hash used to equalize login timing for unknown emails. */
export const DUMMY_PASSWORD = hashPassword('not-a-real-password');
