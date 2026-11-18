import { z } from 'zod';
import { authorize } from '../core/auth.js';
import { db, type App } from '../core/context.js';
import type { SqlParam } from '../core/db.js';
import { badRequest, conflict, validationProblem } from '../core/errors.js';
import { parseBody } from '../core/validation.js';
import { HadithProviderClient } from '../integrations/islamic-content/hadith-provider.client.js';
import { IslamicContentOptions } from '../integrations/islamic-content/islamic-content-options.js';
import { QiblaProviderClient } from '../integrations/islamic-content/qibla-provider.client.js';
import { QuranProviderClient } from '../integrations/islamic-content/quran-provider.client.js';
import { contentProviders } from './islamic-content/providers.js';
import { QURAN_SYNC_SCOPES, SYNC_STATES_SQL, offlineSyncCommand, readSyncStates, toSyncStateJson, type SyncStateRow } from './islamic-content/sync-state.js';

/** QuranSyncRequest(string Scope = "catalog"). */
const quranSyncSchema = z.object({ scope: z.string().nullable().optional() });

/** Count of rows where `!string.IsNullOrEmpty(column)`. */
function nonEmptyCount(column: string): string {
  return `SUM("${column}" IS NOT NULL AND "${column}" <> '')`;
}

/** [FromQuery] binding is case-insensitive; repeated keys bind their first value. */
function firstQueryValue(url: URL, name: string): string | undefined {
  for (const [key, value] of url.searchParams) if (key.toLowerCase() === name.toLowerCase()) return value;
  return undefined;
}

function rows<T>(result: D1Result | undefined): T[] {
  return (result?.results ?? []) as T[];
}

/**
 * The answer of the sync endpoints. backend-node queued a background run and answered
 * 202 { provider, scope, status: 'queued' }. A Worker cannot run one, so nothing is
 * queued: the answer is 409 with the same fields, status 'offline', an `error` text (the
 * field the dashboard shows for a 409 here) and the command that runs the
 * synchronization from a PC. Its progress then shows up in /status as before.
 */
function offlineSync(provider: 'quran' | 'hadith', scope: string) {
  const command = offlineSyncCommand(provider, scope);
  return conflict({
    error: `Content synchronization does not run on this server. Run "${command}" in backend-worker on a computer with Cloudflare access; progress appears here.`,
    provider,
    scope,
    status: 'offline',
    command,
  });
}

/**
 * /api/v1/islamic-content (super users): content summary, edition catalogue, sync status,
 * and /jobs. Port of backend-node/src/modules/islamic-content/. The synchronization
 * itself is ./islamic-content/offline-sync.ts, run by scripts/sync-content.mjs.
 */
export function register(app: App): void {
  app.get('/api/v1/islamic-content/summary', authorize('SuperUser'), async (c) => {
    const database = db(c);
    const [editions, cache, hadithCatalogue, hadithRecords, states] = await database.batch([
      database.stmt(
        `SELECT COUNT(*) AS "Total", SUM("Format" = 'text') AS "Text", SUM("Format" = 'audio') AS "Audio", COUNT(DISTINCT "Language") AS "Languages" FROM "QuranEditions"`,
      ),
      database.stmt('SELECT COUNT(*) AS "Payloads", SUM("PayloadBytes") AS "Bytes" FROM "IslamicContentCacheEntries" WHERE "Provider" = ?', QuranProviderClient.providerName),
      database.stmt('SELECT (SELECT COUNT(*) FROM "HadithBooks") AS "Books", (SELECT COUNT(*) FROM "HadithChapters") AS "Chapters"'),
      database.stmt(
        `SELECT COUNT(*) AS "Total", ${nonEmptyCount('HadithArabic')} AS "Arabic", ${nonEmptyCount('HadithEnglish')} AS "English", ${nonEmptyCount('HadithUrdu')} AS "Urdu" FROM "HadithRecords"`,
      ),
      database.stmt(SYNC_STATES_SQL),
    ]);
    const edition = rows<{ Total: number; Text: number | null; Audio: number | null; Languages: number }>(editions)[0];
    const cached = rows<{ Payloads: number; Bytes: number | null }>(cache)[0];
    const catalogue = rows<{ Books: number; Chapters: number }>(hadithCatalogue)[0];
    const records = rows<{ Total: number; Arabic: number | null; English: number | null; Urdu: number | null }>(hadithRecords)[0];

    return c.json({
      quran: {
        editionCount: edition?.Total ?? 0,
        textEditionCount: edition?.Text ?? 0,
        audioEditionCount: edition?.Audio ?? 0,
        languageCount: edition?.Languages ?? 0,
        cachedPayloads: cached?.Payloads ?? 0,
        cachedBytes: cached?.Bytes ?? 0,
        upstreamServer: IslamicContentOptions.requiredQuranBaseUrl.replace(/\/+$/, ''),
        endpointCount: QuranProviderClient.endpointTemplates.length,
        endpointTemplates: QuranProviderClient.endpointTemplates,
      },
      hadith: {
        configured: contentProviders(c).options.isHadithConfigured,
        bookCount: catalogue?.Books ?? 0,
        chapterCount: catalogue?.Chapters ?? 0,
        recordCount: records?.Total ?? 0,
        languages: HadithProviderClient.languages,
        languageCoverage: { ar: records?.Arabic ?? 0, en: records?.English ?? 0, ur: records?.Urdu ?? 0 },
      },
      qibla: {
        provider: QiblaProviderClient.providerName,
        providerOrganization: QiblaProviderClient.providerOrganization,
        upstreamServer: IslamicContentOptions.requiredAlAdhanBaseUrl.replace(/\/+$/, ''),
        endpointCount: 2,
        endpointTemplates: [QiblaProviderClient.directionEndpointTemplate, QiblaProviderClient.compassEndpointTemplate],
        responseFormats: ['application/json', 'image/png'],
        metadata: '/public/content/qibla/metadata',
      },
      publicApi: {
        capabilities: '/public/content/capabilities',
        quranBase: '/public/content/quran',
        hadithBase: '/public/content/hadith',
        qiblaBase: '/public/content/qibla',
      },
      syncStates: rows<SyncStateRow>(states).map(toSyncStateJson),
    });
  });

  app.get('/api/v1/islamic-content/quran/editions', authorize('SuperUser'), async (c) => {
    const url = new URL(c.req.url);
    const conditions: string[] = [];
    const params: SqlParam[] = [];
    for (const [name, column] of [
      ['language', 'Language'],
      ['format', 'Format'],
      ['type', 'Type'],
    ] as const) {
      const value = firstQueryValue(url, name);
      if (!value?.trim()) continue;
      conditions.push(`"${column}" = ?`);
      params.push(value);
    }
    const editions = await db(c).all<{
      Identifier: string;
      Language: string;
      Name: string;
      EnglishName: string;
      Format: string;
      Type: string;
      Direction: string | null;
      SyncedAtUtc: string;
    }>(`SELECT * FROM "QuranEditions"${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''} ORDER BY "Language", "EnglishName"`, ...params);
    const data = editions.map((edition) => ({
      identifier: edition.Identifier,
      language: edition.Language,
      name: edition.Name,
      englishName: edition.EnglishName,
      format: edition.Format,
      type: edition.Type,
      direction: edition.Direction,
      syncedAtUtc: edition.SyncedAtUtc,
    }));
    return c.json({ data, total: data.length });
  });

  app.get('/api/v1/islamic-content/status', authorize('SuperUser'), async (c) => c.json(await readSyncStates(db(c))));

  app.post('/api/v1/islamic-content/sync/quran', authorize('SuperUser'), async (c) => {
    const body = await parseBody(c, quranSyncSchema);
    if (body.scope === null) throw validationProblem({ Scope: ['The Scope field is required.'] });
    const scope = (body.scope ?? 'catalog').trim().toLowerCase();
    if (!QURAN_SYNC_SCOPES.includes(scope)) throw badRequest({ error: 'Scope must be catalog, text, or all.' });
    throw offlineSync('quran', scope);
  });

  app.post('/api/v1/islamic-content/sync/hadith', authorize('SuperUser'), () => {
    throw offlineSync('hadith', 'all');
  });

  /**
   * backend-node listed the providers held by its in-process queue. Here `queued` is the
   * providers whose sync state says a run of the offline script is queued or running.
   */
  app.get('/jobs', authorize('SuperUser'), async (c) => {
    const syncStates = await readSyncStates(db(c));
    return c.json({ queued: syncStates.filter((state) => state.status === 'queued' || state.status === 'running').map((state) => state.key), syncStates });
  });
}
