import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Authorize } from '../../common/auth/authorize.decorator.js';
import { badRequest, conflict, problem, validationProblem } from '../../common/errors.js';
import { validated } from '../../common/zod-validation.pipe.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { HadithProviderClient } from '../../integrations/islamic-content/hadith-provider.client.js';
import { IslamicContentOptions } from '../../integrations/islamic-content/islamic-content-options.js';
import { QiblaProviderClient } from '../../integrations/islamic-content/qibla-provider.client.js';
import { QuranProviderClient } from '../../integrations/islamic-content/quran-provider.client.js';
import { QURAN_SYNC_SCOPES } from './islamic-content-sync.service.js';
import { IslamicContentSyncQueue } from './sync-queue.js';
import { toSyncStateJson } from './sync-state.js';

/** QuranSyncRequest(string Scope = "catalog"). */
const quranSyncSchema = z.object({ scope: z.string().nullable().optional() });

function firstQueryValue(query: Record<string, unknown>, name: string): string | undefined {
  const key = Object.keys(query).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  const value = key === undefined ? undefined : query[key];
  const single = Array.isArray(value) ? value[0] : value;
  return typeof single === 'string' ? single : undefined;
}

/** Predicate for `!string.IsNullOrEmpty(column)`. */
function nonEmpty(field: 'hadithArabic' | 'hadithEnglish' | 'hadithUrdu'): Prisma.HadithRecordWhereInput {
  return { AND: [{ [field]: { not: null } }, { [field]: { not: '' } }] };
}

@Controller('api/v1/islamic-content')
@Authorize('SuperUser')
export class IslamicContentController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly syncQueue: IslamicContentSyncQueue,
    private readonly hadithClient: HadithProviderClient,
  ) {}

  @Get('summary')
  async summary() {
    const quranProvider = QuranProviderClient.providerName;
    const [
      editionCount,
      textEditionCount,
      audioEditionCount,
      languages,
      cachedPayloads,
      cachedBytes,
      bookCount,
      chapterCount,
      recordCount,
      arabicCount,
      englishCount,
      urduCount,
      states,
    ] = await Promise.all([
      this.prisma.quranEdition.count(),
      this.prisma.quranEdition.count({ where: { format: 'text' } }),
      this.prisma.quranEdition.count({ where: { format: 'audio' } }),
      this.prisma.quranEdition.findMany({ distinct: ['language'], select: { language: true } }),
      this.prisma.islamicContentCacheEntry.count({ where: { provider: quranProvider } }),
      this.prisma.islamicContentCacheEntry.aggregate({ _sum: { payloadBytes: true }, where: { provider: quranProvider } }),
      this.prisma.hadithBook.count(),
      this.prisma.hadithChapter.count(),
      this.prisma.hadithRecord.count(),
      this.prisma.hadithRecord.count({ where: nonEmpty('hadithArabic') }),
      this.prisma.hadithRecord.count({ where: nonEmpty('hadithEnglish') }),
      this.prisma.hadithRecord.count({ where: nonEmpty('hadithUrdu') }),
      this.prisma.islamicContentSyncState.findMany({ orderBy: { provider: 'asc' } }),
    ]);

    return {
      quran: {
        editionCount,
        textEditionCount,
        audioEditionCount,
        languageCount: languages.length,
        cachedPayloads,
        cachedBytes: Number(cachedBytes._sum.payloadBytes ?? 0n),
        upstreamServer: IslamicContentOptions.requiredQuranBaseUrl.replace(/\/+$/, ''),
        endpointCount: QuranProviderClient.endpointTemplates.length,
        endpointTemplates: QuranProviderClient.endpointTemplates,
      },
      hadith: {
        configured: this.hadithClient.isConfigured,
        bookCount,
        chapterCount,
        recordCount,
        languages: HadithProviderClient.languages,
        languageCoverage: { ar: arabicCount, en: englishCount, ur: urduCount },
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
      syncStates: states.map(toSyncStateJson),
    };
  }

  @Get('quran/editions')
  async quranEditions(@Query() query: Record<string, unknown>) {
    const language = firstQueryValue(query, 'language');
    const format = firstQueryValue(query, 'format');
    const type = firstQueryValue(query, 'type');
    const where: Prisma.QuranEditionWhereInput = {};
    if (language?.trim()) where.language = language;
    if (format?.trim()) where.format = format;
    if (type?.trim()) where.type = type;

    const editions = await this.prisma.quranEdition.findMany({ where, orderBy: [{ language: 'asc' }, { englishName: 'asc' }] });
    const data = editions.map((edition) => ({
      identifier: edition.identifier,
      language: edition.language,
      name: edition.name,
      englishName: edition.englishName,
      format: edition.format,
      type: edition.type,
      direction: edition.direction,
      syncedAtUtc: edition.syncedAtUtc,
    }));
    return { data, total: data.length };
  }

  @Get('status')
  async status() {
    const states = await this.prisma.islamicContentSyncState.findMany({ orderBy: { provider: 'asc' } });
    return states.map(toSyncStateJson);
  }

  @Post('sync/quran')
  @HttpCode(202)
  syncQuran(@Body(validated(quranSyncSchema)) body: z.infer<typeof quranSyncSchema>) {
    if (body.scope === null) throw validationProblem({ Scope: ['The Scope field is required.'] });
    const scope = (body.scope ?? 'catalog').trim().toLowerCase();
    if (!QURAN_SYNC_SCOPES.includes(scope)) throw badRequest({ error: 'Scope must be catalog, text, or all.' });
    if (!this.syncQueue.tryQueue('quran', scope)) throw conflict({ error: "A Qur'an synchronization is already queued or running." });
    return { provider: 'quran', scope, status: 'queued' };
  }

  @Post('sync/hadith')
  @HttpCode(202)
  syncHadith() {
    if (!this.hadithClient.isConfigured) {
      throw problem(503, 'Hadith provider is not configured', 'Configure the server-side Hadith API key before starting an import.');
    }
    if (!this.syncQueue.tryQueue('hadith', 'all')) throw conflict({ error: 'A Hadith synchronization is already queued or running.' });
    return { provider: 'hadith', scope: 'all', status: 'queued' };
  }
}
