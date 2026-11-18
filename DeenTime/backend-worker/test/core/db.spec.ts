import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isUniqueViolation, newId, now } from '../../src/core/db.js';
import { createTestApp, type TestApp } from '../support/test-app.js';

/** The names in backend-node/prisma/migrations/0_baseline/migration.sql. */
const TABLES = [
  'ApiClientUsage',
  'ApiClients',
  'AppUsers',
  'DesignSettings',
  'HadithBooks',
  'HadithChapters',
  'HadithRecords',
  'HijriMonthMaps',
  'IqamaEntries',
  'IslamicContentCacheEntries',
  'IslamicContentSyncStates',
  'MasjidInvitations',
  'OrgUsers',
  'Organizations',
  'PendingRegistrations',
  'PrayerTimingCriteria',
  'PublishArtifacts',
  'QuranEditions',
  'TvDisplayConfigs',
];

describe('schema and Db helper', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await app.reset();
  });

  it('creates the 19 PostgreSQL tables plus RateLimitWindows', async () => {
    const tables = await app.db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name`,
    );
    expect(tables.map((table) => table.name)).toEqual([...TABLES, 'RateLimitWindows'].sort());
  });

  it('creates the 38 PostgreSQL indexes, 4 of them partial unique', async () => {
    const indexes = await app.db.all<{ name: string; sql: string }>(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'IX_%' AND tbl_name <> 'RateLimitWindows'`);
    expect(indexes).toHaveLength(38);
    expect(
      indexes
        .filter((index) => / WHERE /.test(index.sql))
        .map((index) => index.name)
        .sort(),
    ).toEqual([
      'IX_AppUsers_PasswordResetTokenHash',
      'IX_Organizations_AddressFingerprint',
      'IX_Organizations_MasjidIdentityKey',
      'IX_Organizations_NormalizedWebsiteHost',
    ]);
  });

  it('partial unique indexes allow many NULLs and reject duplicate values', async () => {
    await app.seed.organization();
    await app.seed.organization();
    await app.seed.organization({ columns: { MasjidIdentityKey: 'KEY' } });
    const duplicate = await app.seed.organization({ columns: { MasjidIdentityKey: 'KEY' } }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(isUniqueViolation(duplicate)).toBe(true);
    expect(isUniqueViolation(new Error('something else'))).toBe(false);
  });

  it('enforces foreign keys: cascade and set null', async () => {
    const { organization, user } = await app.seed.signIn();
    const invitationId = newId();
    await app.db.run(
      `INSERT INTO "MasjidInvitations" ("Id", "Email", "NormalizedEmail", "OrganizationName", "NormalizedOrganizationName", "InvitationTokenHash", "InvitedBySubject", "CreatedAtUtc", "SentAtUtc", "ExpiresAtUtc", "SendCount", "OrganizationId")
       VALUES (?, 'a@b.test', 'a@b.test', 'Org', 'ORG', 'HASH', ?, ?, ?, ?, 1, ?)`,
      invitationId,
      user.id,
      now(),
      now(),
      now(),
      organization.id,
    );
    await app.db.run('DELETE FROM "Organizations" WHERE "Id" = ?', organization.id);
    expect(await app.db.all('SELECT "Id" FROM "OrgUsers"')).toEqual([]);
    expect(await app.db.first('SELECT "OrganizationId" FROM "MasjidInvitations" WHERE "Id" = ?', invitationId)).toEqual({ OrganizationId: null });

    const orphan = await app.db.run(`INSERT INTO "OrgUsers" ("Id", "OrganizationId", "Issuer", "Subject", "Roles", "LastSeenUtc") VALUES (?, ?, 'i', 's', '[]', ?)`, newId(), newId(), now()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(String(orphan)).toMatch(/FOREIGN KEY constraint failed/);
  });

  it('applies column defaults and stores decimals, booleans, dates and times as documented', async () => {
    const organization = await app.seed.organization();
    await app.db.run('INSERT INTO "DesignSettings" ("Id", "OrganizationId", "IqamaHeadings", "Theme", "UpdatedAtUtc") VALUES (?, ?, ?, ?, ?)', newId(), organization.id, '["Fajr","Dhuhr"]', 'light', now());
    expect(await app.db.first('SELECT "CompactFontFamily", "CompactFontScale", "TvFontScale", "IqamaHeadings" FROM "DesignSettings"')).toEqual({
      CompactFontFamily: 'system',
      CompactFontScale: 100,
      TvFontScale: 100,
      IqamaHeadings: '["Fajr","Dhuhr"]',
    });

    await app.db.run(
      `INSERT INTO "PrayerTimingCriteria" ("Id", "OrganizationId", "Method", "JuristicMethodAsr", "Latitude", "Longitude", "TimezoneId", "DstObserved", "DstBegins", "ZipCode", "MinutesAfterZawal", "MinutesAfterMaghrib", "KhutbahTimeMinutes", "UpdatedAtUtc")
       VALUES (?, ?, 'ISNA', 'Other', ?, ?, 'America/Chicago', ?, ?, '78717', 5, 1, 20, ?)`,
      newId(),
      organization.id,
      30.5119418,
      -97.8177601,
      true,
      '2026-03-08',
      new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)),
    );
    expect(await app.db.first('SELECT "Latitude", "Longitude", "DstObserved", "DstBegins", "DstEnds", "UpdatedAtUtc" FROM "PrayerTimingCriteria"')).toEqual({
      Latitude: 30.5119418,
      Longitude: -97.8177601,
      DstObserved: 1,
      DstBegins: '2026-03-08',
      DstEnds: null,
      UpdatedAtUtc: '2026-01-02T03:04:05.006Z',
    });
  });

  it('first / all / run', async () => {
    expect(await app.db.first('SELECT "Id" FROM "Organizations" WHERE "Slug" = ?', 'missing')).toBeNull();
    const organization = await app.seed.organization({ slug: 'noor' });
    expect(await app.db.first<{ Id: string }>('SELECT "Id" FROM "Organizations" WHERE "Slug" = ?', 'noor')).toEqual({ Id: organization.id });
    await app.seed.organization({ slug: 'huda' });
    expect((await app.db.all<{ Slug: string }>('SELECT "Slug" FROM "Organizations" ORDER BY "Slug"')).map((row) => row.Slug)).toEqual(['huda', 'noor']);
    expect(await app.db.run('UPDATE "Organizations" SET "City" = ? WHERE "Slug" IN (?, ?)', undefined, 'noor', 'huda')).toEqual({ changes: 2 });
    expect(await app.db.run('DELETE FROM "Organizations" WHERE "Slug" = ?', 'missing')).toEqual({ changes: 0 });
  });

  it('batch is atomic: a failing statement rolls back the others', async () => {
    const organization = await app.seed.organization({ slug: 'noor' });
    const failed = await app.db
      .batch([
        app.db.stmt('UPDATE "Organizations" SET "Name" = ? WHERE "Id" = ?', 'Renamed', organization.id),
        app.db.stmt('INSERT INTO "Organizations" ("Id", "Slug", "Name", "UpdatedAtUtc") VALUES (?, ?, ?, ?)', newId(), 'noor', 'Duplicate slug', now()),
      ])
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(isUniqueViolation(failed)).toBe(true);
    expect(await app.db.first('SELECT "Name" FROM "Organizations" WHERE "Id" = ?', organization.id)).toEqual({ Name: organization.name });

    await app.db.batch([
      app.db.stmt('UPDATE "Organizations" SET "Name" = ? WHERE "Id" = ?', 'Renamed', organization.id),
      app.db.stmt('INSERT INTO "Organizations" ("Id", "Slug", "Name", "UpdatedAtUtc") VALUES (?, ?, ?, ?)', newId(), 'huda', 'Huda', now()),
    ]);
    expect(await app.db.all('SELECT "Name" FROM "Organizations" ORDER BY "Slug"')).toEqual([{ Name: 'Huda' }, { Name: 'Renamed' }]);
    expect(await app.db.batch([])).toEqual([]);
  });

  it('seed helpers create rows a module can query', async () => {
    const user = await app.seed.user({ email: 'imam@masjid.test', password: 'TestOnly-Password-1234' });
    const organization = await app.seed.organization({ name: 'Masjid Noor', slug: 'masjid-noor' });
    await app.seed.membership(organization, user, ['Admin', 'Editor']);
    expect(await app.db.first('SELECT "Email", "PasswordHash" LIKE \'pbkdf2-sha256$100000$%\' AS hashed FROM "AppUsers" WHERE "Id" = ?', user.id)).toEqual({ Email: 'imam@masjid.test', hashed: 1 });
    expect(await app.db.first('SELECT "OrganizationId", "Issuer", "Subject", "Roles" FROM "OrgUsers"')).toEqual({
      OrganizationId: organization.id,
      Issuer: 'deentime-test',
      Subject: user.id,
      Roles: '["Admin","Editor"]',
    });
  });
});
