using DeenTime.Api.Services.IslamicContent;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Controllers;

[ApiController]
[Authorize("SuperUser")]
[Route("api/v1/islamic-content")]
public sealed class IslamicContentController(
    IDbContextFactory<AppDbContext> dbFactory,
    IIslamicContentSyncQueue syncQueue,
    HadithProviderClient hadithClient) : ControllerBase
{
    [HttpGet("summary")]
    public async Task<IActionResult> Summary(CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);

        var quranEditionCount = await db.QuranEditions.CountAsync(cancellationToken);
        var quranTextCount = await db.QuranEditions.CountAsync(
            edition => edition.Format == "text", cancellationToken);
        var quranAudioCount = await db.QuranEditions.CountAsync(
            edition => edition.Format == "audio", cancellationToken);
        var quranLanguageCount = await db.QuranEditions.Select(edition => edition.Language)
            .Distinct().CountAsync(cancellationToken);
        var quranCachedPayloads = await db.IslamicContentCacheEntries.CountAsync(
            entry => entry.Provider == QuranProviderClient.ProviderName, cancellationToken);
        var quranCachedBytes = await db.IslamicContentCacheEntries
            .Where(entry => entry.Provider == QuranProviderClient.ProviderName)
            .Select(entry => (long?)entry.PayloadBytes)
            .SumAsync(cancellationToken) ?? 0;

        var hadithBookCount = await db.HadithBooks.CountAsync(cancellationToken);
        var hadithChapterCount = await db.HadithChapters.CountAsync(cancellationToken);
        var hadithRecordCount = await db.HadithRecords.CountAsync(cancellationToken);
        var hadithArabicCount = await db.HadithRecords.CountAsync(
            record => !string.IsNullOrEmpty(record.HadithArabic), cancellationToken);
        var hadithEnglishCount = await db.HadithRecords.CountAsync(
            record => !string.IsNullOrEmpty(record.HadithEnglish), cancellationToken);
        var hadithUrduCount = await db.HadithRecords.CountAsync(
            record => !string.IsNullOrEmpty(record.HadithUrdu), cancellationToken);
        var states = await db.IslamicContentSyncStates.AsNoTracking()
            .OrderBy(state => state.Provider)
            .ToArrayAsync(cancellationToken);

        return Ok(new
        {
            quran = new
            {
                editionCount = quranEditionCount,
                textEditionCount = quranTextCount,
                audioEditionCount = quranAudioCount,
                languageCount = quranLanguageCount,
                cachedPayloads = quranCachedPayloads,
                cachedBytes = quranCachedBytes,
                upstreamServer = IslamicContentOptions.RequiredQuranBaseUrl.TrimEnd('/'),
                endpointCount = QuranProviderClient.EndpointTemplates.Length,
                endpointTemplates = QuranProviderClient.EndpointTemplates
            },
            hadith = new
            {
                configured = hadithClient.IsConfigured,
                bookCount = hadithBookCount,
                chapterCount = hadithChapterCount,
                recordCount = hadithRecordCount,
                languages = HadithProviderClient.Languages,
                languageCoverage = new
                {
                    ar = hadithArabicCount,
                    en = hadithEnglishCount,
                    ur = hadithUrduCount
                }
            },
            qibla = new
            {
                provider = QiblaProviderClient.ProviderName,
                providerOrganization = QiblaProviderClient.ProviderOrganization,
                upstreamServer = IslamicContentOptions.RequiredAlAdhanBaseUrl.TrimEnd('/'),
                endpointCount = 2,
                endpointTemplates = new[]
                {
                    QiblaProviderClient.DirectionEndpointTemplate,
                    QiblaProviderClient.CompassEndpointTemplate
                },
                responseFormats = new[] { "application/json", "image/png" },
                metadata = "/public/content/qibla/metadata"
            },
            publicApi = new
            {
                capabilities = "/public/content/capabilities",
                quranBase = "/public/content/quran",
                hadithBase = "/public/content/hadith",
                qiblaBase = "/public/content/qibla"
            },
            syncStates = states
        });
    }

    [HttpGet("quran/editions")]
    public async Task<IActionResult> QuranEditions(
        [FromQuery] string? language,
        [FromQuery] string? format,
        [FromQuery] string? type,
        CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var query = db.QuranEditions.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(language)) query = query.Where(edition => edition.Language == language);
        if (!string.IsNullOrWhiteSpace(format)) query = query.Where(edition => edition.Format == format);
        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(edition => edition.Type == type);

        var editions = await query.OrderBy(edition => edition.Language)
            .ThenBy(edition => edition.EnglishName)
            .ToArrayAsync(cancellationToken);
        return Ok(new { data = editions, total = editions.Length });
    }

    [HttpGet("status")]
    public async Task<IActionResult> Status(CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        return Ok(await db.IslamicContentSyncStates.AsNoTracking()
            .OrderBy(state => state.Provider)
            .ToArrayAsync(cancellationToken));
    }

    [HttpPost("sync/quran")]
    public IActionResult SyncQuran([FromBody] QuranSyncRequest request)
    {
        var scope = request.Scope.Trim().ToLowerInvariant();
        if (scope is not ("catalog" or "text" or "all"))
            return BadRequest(new { error = "Scope must be catalog, text, or all." });
        if (!syncQueue.TryQueue("quran", scope))
            return Conflict(new { error = "A Qur'an synchronization is already queued or running." });
        return Accepted(new { provider = "quran", scope, status = "queued" });
    }

    [HttpPost("sync/hadith")]
    public IActionResult SyncHadith()
    {
        if (!hadithClient.IsConfigured)
            return Problem(
                statusCode: StatusCodes.Status503ServiceUnavailable,
                title: "Hadith provider is not configured",
                detail: "Configure the server-side Hadith API key before starting an import.");
        if (!syncQueue.TryQueue("hadith", "all"))
            return Conflict(new { error = "A Hadith synchronization is already queued or running." });
        return Accepted(new { provider = "hadith", scope = "all", status = "queued" });
    }
}

public sealed record QuranSyncRequest(string Scope = "catalog");
