// Password hashing for scripts/set-password.mjs, in exactly the format src/core/password-hasher.ts
// writes and verifies: PBKDF2-SHA256, 100,000 iterations, 32-byte key, 16-byte random salt,
// stored as "pbkdf2-sha256$100000$<base64 hash>" with the salt as separate base64.
// Uses WebCrypto only, so it runs in Node 22 and inside workerd (test/set-password.spec.ts).

export const ITERATIONS = 100_000;
const PREFIX = 'pbkdf2-sha256';

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * @param {string} password
 * @param {Uint8Array} [salt] 16 random bytes; generated when omitted (pass one only in tests).
 * @returns {Promise<{ hash: string, salt: string }>}
 */
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return { hash: `${PREFIX}$${ITERATIONS}$${toBase64(new Uint8Array(bits))}`, salt: toBase64(salt) };
}

/** The password policy of the API (auth/validation-rules.ts passwordRules); returns the first problem or null. */
export function passwordProblem(password) {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  if (!/[a-z]/.test(password)) return 'Password must include a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must include an uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must include a number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must include a symbol.';
  if (/\s/.test(password)) return 'Password cannot contain spaces.';
  return null;
}

/** A single-quoted SQLite string literal. */
export function sqlText(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** SHA-256 of the text as upper-case hex: the key suffix integrations/login-throttle.ts uses. */
export async function sha256HexUpper(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/**
 * The statements that set the password of the account with this (already normalized) email:
 * the new hash and salt, any outstanding password-reset link cleared, and the failed-login
 * throttle of that email cleared. The schema has no refresh tokens or stored sessions.
 */
export async function buildUpdateSql(email, password) {
  const emailHash = await sha256HexUpper(email);
  return [
    `UPDATE "AppUsers" SET "PasswordHash" = ${sqlText(password.hash)}, "PasswordSalt" = ${sqlText(password.salt)}, "PasswordResetTokenHash" = NULL, "PasswordResetExpiresAtUtc" = NULL WHERE "Email" = ${sqlText(email)};`,
    `DELETE FROM "RateLimitWindows" WHERE "Key" IN (${sqlText(`login-failures:${emailHash}`)}, ${sqlText(`login-blocked:${emailHash}`)});`,
    '',
  ].join('\n');
}
