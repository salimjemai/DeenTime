import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildUpdateSql, hashPassword, ITERATIONS, passwordProblem, sqlText } from '../scripts/password-hash.mjs';
import { Db, newId } from '../src/core/db.js';
import { base64ToBytes } from '../src/core/encoding.js';
import { CURRENT_ITERATIONS, needsRehash, verifyPassword } from '../src/core/password-hasher.js';
import { D1LoginThrottle } from '../src/integrations/login-throttle.js';

/** The reference vector of test/core/password-hasher.spec.ts (node:crypto pbkdf2Sync, 100,000 iterations). */
const PASSWORD = 'TestOnly-Password-1234';
const SALT = 'AAECAwQFBgcICQoLDA0ODw==';
const NODE_100K = 'c7cdNfPJ09aEMVEodcVf5pslIkaNb609RhHPcpYqEUQ=';

describe('scripts/set-password.mjs hashing', () => {
  it('writes the format and iteration count the Worker hasher creates', async () => {
    expect(ITERATIONS).toBe(CURRENT_ITERATIONS);
    const hashed = await hashPassword(PASSWORD, base64ToBytes(SALT));
    expect(hashed).toEqual({ hash: `pbkdf2-sha256$100000$${NODE_100K}`, salt: SALT });
    expect(needsRehash(hashed.hash)).toBe(false);
  });

  it('produces hashes the Worker hasher verifies', async () => {
    const hashed = await hashPassword('Sup3r-Secret-Passphrase!');
    expect(base64ToBytes(hashed.salt)).toHaveLength(16);
    expect(await verifyPassword('Sup3r-Secret-Passphrase!', hashed.hash, hashed.salt)).toBe('valid');
    expect(await verifyPassword('Sup3r-Secret-Passphrase?', hashed.hash, hashed.salt)).toBe('invalid');
    expect((await hashPassword('Sup3r-Secret-Passphrase!')).salt).not.toBe(hashed.salt);
  });

  it('applies the password policy of the API', () => {
    expect(passwordProblem('Sup3r-Secret-Passphrase!')).toBeNull();
    expect(passwordProblem('Short-1!')).toBe('Password must be at least 12 characters.');
    expect(passwordProblem('alllowercase-1234')).toBe('Password must include an uppercase letter.');
    expect(passwordProblem('ALLUPPERCASE-1234')).toBe('Password must include a lowercase letter.');
    expect(passwordProblem('No-Digits-In-Here')).toBe('Password must include a number.');
    expect(passwordProblem('NoSymbols12345')).toBe('Password must include a symbol.');
    expect(passwordProblem('Has Spaces-12345')).toBe('Password cannot contain spaces.');
  });
});

describe('scripts/set-password.mjs SQL', () => {
  const db = new Db((env as unknown as { DB: D1Database }).DB);

  beforeEach(async () => {
    await db.batch([db.stmt('DELETE FROM "AppUsers"'), db.stmt('DELETE FROM "RateLimitWindows"')]);
  });

  it('quotes text literals', () => {
    expect(sqlText("o'brien@masjid.test")).toBe("'o''brien@masjid.test'");
  });

  it('updates only that account, clears its reset link and its sign-in lockout', async () => {
    const insert = 'INSERT INTO "AppUsers" ("Id", "Email", "PasswordHash", "PasswordSalt", "PasswordResetTokenHash", "PasswordResetExpiresAtUtc") VALUES (?, ?, ?, ?, ?, ?)';
    await db.run(insert, newId(), 'imam@masjid.test', 'pbkdf2-sha256$600000$ENDP6PS/6x1ZdUo3Emvzyqy0Ye5jSEOwn6vZdBIzk4o=', SALT, 'RESETHASH', '2030-01-01T00:00:00.000Z');
    await db.run(insert, newId(), 'other@masjid.test', 'other-hash', 'other-salt', null, null);
    const throttle = new D1LoginThrottle(db);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await throttle.recordFailure('imam@masjid.test');
      await throttle.recordFailure('other@masjid.test');
    }

    const hashed = await hashPassword('Sup3r-Secret-Passphrase!');
    const sql = await buildUpdateSql('imam@masjid.test', hashed);
    // wrangler d1 execute --file runs the statements one after the other.
    for (const statement of sql.split('\n').filter((line) => line.trim() !== '')) await db.run(statement);

    const rows = await db.all<{ Email: string; PasswordHash: string; PasswordSalt: string; PasswordResetTokenHash: string | null; PasswordResetExpiresAtUtc: string | null }>(
      'SELECT "Email", "PasswordHash", "PasswordSalt", "PasswordResetTokenHash", "PasswordResetExpiresAtUtc" FROM "AppUsers" ORDER BY "Email"',
    );
    expect(rows).toEqual([
      { Email: 'imam@masjid.test', PasswordHash: hashed.hash, PasswordSalt: hashed.salt, PasswordResetTokenHash: null, PasswordResetExpiresAtUtc: null },
      { Email: 'other@masjid.test', PasswordHash: 'other-hash', PasswordSalt: 'other-salt', PasswordResetTokenHash: null, PasswordResetExpiresAtUtc: null },
    ]);
    expect(await verifyPassword('Sup3r-Secret-Passphrase!', rows[0].PasswordHash, rows[0].PasswordSalt)).toBe('valid');
    expect(await throttle.canAttempt('imam@masjid.test')).toEqual({ allowed: true });
    expect((await throttle.canAttempt('other@masjid.test')).allowed).toBe(false);
  });
});
