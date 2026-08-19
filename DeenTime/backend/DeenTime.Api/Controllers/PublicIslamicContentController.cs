using DeenTime.Api.Responses.Pagination;
using DeenTime.Api.Services.IslamicContent;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using System.Text.Json.Nodes;
using DeenTime.Api.Services;

namespace DeenTime.Api.Controllers;

[ApiController]
[EnableRateLimiting("public")]
[Route("public/content")]
public sealed class PublicIslamicContentController(
    QuranProviderClient quranClient,
    IDbContextFactory<AppDbContext> dbFactory,
    ApiClientCredentialService credentials) : ControllerBase
{
    [HttpGet("capabilities")]
    public async Task<IActionResult> Capabilities(CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        return Ok(new
        {
        apiVersion = "v1",
        quran = new
        {
            provider = "AlQuran Cloud",
            upstreamServer = IslamicContentOptions.RequiredQuranBaseUrl.TrimEnd('/'),
            endpointBase = "/public/content/quran",
            endpointTemplates = QuranProviderClient.EndpointTemplates,
            queryParameters = new[] { "type", "format", "language", "offset", "limit" },
            showcaseRandom = "/public/content/quran/showcase/random",
            behavior = "Provider-compatible JSON with local caching and stale-data fallback"
        },
        hadith = new
        {
            endpointBase = "/public/content/hadith",
            languages = HadithProviderClient.Languages,
            routes = new[]
            {
                "GET /books",
                "GET /books/{bookSlug}/chapters",
                "GET /hadiths",
                "GET /hadiths/{providerId}",
                "GET /hadiths/random"
            }
        }
        });
    }

    [HttpGet("quran/showcase/random")]
    public async Task<IActionResult> CachedRandomAyah(CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        string[] identifiers = ["quran-uthmani", "en.sahih", "ar.alafasy"];
        var keys = identifiers.Select(identifier => $"/quran/{identifier}").ToArray();
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var payloads = await db.IslamicContentCacheEntries.AsNoTracking()
            .Where(entry => entry.Provider == QuranProviderClient.ProviderName && keys.Contains(entry.CacheKey))
            .ToDictionaryAsync(entry => entry.CacheKey, entry => entry.PayloadJson, cancellationToken);

        if (payloads.Count == identifiers.Length)
        {
            var number = Random.Shared.Next(1, 6237);
            var ayahs = identifiers
                .Select(identifier => FindAyah(payloads[$"/quran/{identifier}"], number))
                .Where(ayah => ayah is not null)
                .Select(ayah => ayah!)
                .ToArray();
            if (ayahs.Length == identifiers.Length)
            {
                Response.Headers["X-DeenTime-Source"] = "cache";
                return Ok(new { code = 200, status = "OK", data = ayahs });
            }
        }

        try
        {
            var fallback = await quranClient.GetAsync(
                "ayah/random/editions/quran-uthmani,en.sahih,ar.alafasy",
                cancellationToken: cancellationToken);
            Response.Headers["X-DeenTime-Source"] = fallback.FromCache ? "cache" : "provider";
            return new ContentResult
            {
                Content = fallback.Json,
                ContentType = fallback.ContentType,
                StatusCode = fallback.StatusCode
            };
        }
        catch (IslamicContentProviderException exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = exception.Message });
        }
    }

    [HttpGet("quran/{**path}")]
    [Produces("application/json")]
    public async Task<IActionResult> Quran(string path, CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        try
        {
            var query = Request.Query.SelectMany(pair => pair.Value
                .Where(value => value is not null)
                .Select(value => new KeyValuePair<string, string?>(pair.Key, value)));
            var payload = await quranClient.GetAsync(path, query, cancellationToken: cancellationToken);

            Response.Headers["X-DeenTime-Source"] = payload.FromCache ? "cache" : "provider";
            Response.Headers["X-DeenTime-Retrieved"] = payload.RetrievedAtUtc.ToString("O");
            if (payload.IsStale) Response.Headers["Warning"] = "110 - Response is stale";

            return new ContentResult
            {
                Content = payload.Json,
                ContentType = payload.ContentType,
                StatusCode = payload.StatusCode
            };
        }
        catch (ArgumentException exception)
        {
            return BadRequest(new { error = exception.Message });
        }
        catch (IslamicContentProviderException exception)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = exception.Message });
        }
    }

    [HttpGet("hadith/books")]
    public async Task<IActionResult> Books(CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var books = await db.HadithBooks.AsNoTracking()
            .OrderBy(book => book.ProviderId)
            .Select(book => new
            {
                id = book.ProviderId,
                slug = book.BookSlug,
                name = book.BookName,
                writerName = book.WriterName,
                aboutWriter = book.AboutWriter,
                writerDeath = book.WriterDeath,
                hadithCount = book.HadithCount,
                chapterCount = book.ChapterCount,
                languages = HadithProviderClient.Languages,
                syncedAtUtc = book.SyncedAtUtc
            })
            .ToArrayAsync(cancellationToken);
        return Ok(new { data = books, total = books.Length });
    }

    [HttpGet("hadith/books/{bookSlug}/chapters")]
    public async Task<IActionResult> Chapters(string bookSlug, CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var bookExists = await db.HadithBooks.AsNoTracking()
            .AnyAsync(book => book.BookSlug == bookSlug, cancellationToken);
        if (!bookExists) return NotFound(new { error = "Hadith book not found." });

        var chapters = await db.HadithChapters.AsNoTracking()
            .Where(chapter => chapter.BookSlug == bookSlug)
            .OrderBy(chapter => chapter.ChapterNumber)
            .Select(chapter => new
            {
                id = chapter.ProviderId,
                bookSlug = chapter.BookSlug,
                chapterNumber = chapter.ChapterNumber,
                chapterArabic = chapter.ChapterArabic,
                chapterEnglish = chapter.ChapterEnglish,
                chapterUrdu = chapter.ChapterUrdu
            })
            .ToArrayAsync(cancellationToken);
        return Ok(new { data = chapters, total = chapters.Length });
    }

    [HttpGet("hadith/hadiths")]
    public async Task<IActionResult> Hadiths(
        [FromQuery] string? book,
        [FromQuery] int? chapter,
        [FromQuery] string? status,
        [FromQuery] string? search,
        [FromQuery] string? language,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 20,
        CancellationToken cancellationToken = default)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        page = Math.Max(1, page);
        pageSize = Math.Clamp(pageSize, 1, 100);
        if (search?.Length > 200) return BadRequest(new { error = "Search is limited to 200 characters." });
        if (!IsSupportedLanguage(language)) return BadRequest(new { error = "Language must be ar, en, or ur." });

        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var query = FilterHadiths(db.HadithRecords.AsNoTracking(), book, chapter, status, search, language);
        var total = await query.CountAsync(cancellationToken);
        var records = await ProjectHadiths(query
                .OrderBy(record => record.BookSlug)
                .ThenBy(record => record.ProviderId)
                .Skip((page - 1) * pageSize)
                .Take(pageSize))
            .ToArrayAsync(cancellationToken);

        return Ok(new PagedResult<PublicHadithRecord>(records, page, pageSize, total));
    }

    [HttpGet("hadith/hadiths/random")]
    public async Task<IActionResult> RandomHadith(
        [FromQuery] string? book,
        [FromQuery] int? chapter,
        [FromQuery] string? status,
        [FromQuery] string? language,
        CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        if (!IsSupportedLanguage(language)) return BadRequest(new { error = "Language must be ar, en, or ur." });

        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var query = FilterHadiths(db.HadithRecords.AsNoTracking(), book, chapter, status, null, language);
        var total = await query.CountAsync(cancellationToken);
        if (total == 0) return NotFound(new { error = "No hadith matched the requested filters." });

        var offset = Random.Shared.Next(total);
        var record = await ProjectHadiths(query.OrderBy(item => item.ProviderId).Skip(offset).Take(1))
            .FirstAsync(cancellationToken);
        return Ok(new { data = record });
    }

    [HttpGet("hadith/hadiths/{providerId:int}")]
    public async Task<IActionResult> Hadith(int providerId, CancellationToken cancellationToken)
    {
        var denied = await ValidateClientAsync(cancellationToken);
        if (denied is not null) return denied;
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var record = await ProjectHadiths(db.HadithRecords.AsNoTracking()
                .Where(item => item.ProviderId == providerId)
                .Take(1))
            .FirstOrDefaultAsync(cancellationToken);
        return record is null ? NotFound(new { error = "Hadith not found." }) : Ok(new { data = record });
    }

    private static IQueryable<DeenTime.Core.Entities.HadithRecord> FilterHadiths(
        IQueryable<DeenTime.Core.Entities.HadithRecord> query,
        string? book,
        int? chapter,
        string? status,
        string? search,
        string? language)
    {
        if (!string.IsNullOrWhiteSpace(book)) query = query.Where(record => record.BookSlug == book);
        if (chapter.HasValue) query = query.Where(record => record.ChapterNumber == chapter.Value);
        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(record => record.Status == status);

        query = language?.ToLowerInvariant() switch
        {
            "ar" => query.Where(record => !string.IsNullOrEmpty(record.HadithArabic)),
            "ur" => query.Where(record => !string.IsNullOrEmpty(record.HadithUrdu)),
            "en" => query.Where(record => !string.IsNullOrEmpty(record.HadithEnglish)),
            _ => query
        };
        if (string.IsNullOrWhiteSpace(search)) return query;

        var pattern = $"%{search.Trim()}%";
        return language?.ToLowerInvariant() switch
        {
            "ar" => query.Where(record => record.HadithArabic != null && EF.Functions.ILike(record.HadithArabic, pattern)),
            "ur" => query.Where(record => record.HadithUrdu != null && EF.Functions.ILike(record.HadithUrdu, pattern)),
            "en" => query.Where(record => record.HadithEnglish != null && EF.Functions.ILike(record.HadithEnglish, pattern)),
            _ => query.Where(record =>
                (record.HadithArabic != null && EF.Functions.ILike(record.HadithArabic, pattern)) ||
                (record.HadithEnglish != null && EF.Functions.ILike(record.HadithEnglish, pattern)) ||
                (record.HadithUrdu != null && EF.Functions.ILike(record.HadithUrdu, pattern)) ||
                (record.EnglishNarrator != null && EF.Functions.ILike(record.EnglishNarrator, pattern)))
        };
    }

    private static IQueryable<PublicHadithRecord> ProjectHadiths(
        IQueryable<DeenTime.Core.Entities.HadithRecord> query) =>
        query.Select(record => new PublicHadithRecord(
            record.ProviderId,
            record.HadithNumber,
            record.BookSlug,
            record.ChapterNumber,
            record.Volume,
            record.Status,
            record.EnglishNarrator,
            record.UrduNarrator,
            record.HadithEnglish,
            record.HadithUrdu,
            record.HadithArabic,
            record.HeadingEnglish,
            record.HeadingUrdu,
            record.HeadingArabic,
            record.SyncedAtUtc));

    private static bool IsSupportedLanguage(string? language) =>
        string.IsNullOrWhiteSpace(language) || HadithProviderClient.Languages.Contains(language, StringComparer.OrdinalIgnoreCase);

    private async Task<IActionResult?> ValidateClientAsync(CancellationToken cancellationToken)
    {
        var key = Request.Headers["X-DeenTime-Client-Key"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(key)) return null;
        var validation = await credentials.ValidateAsync(key, "content:read", Request.Path, cancellationToken);
        return validation.IsValid
            ? null
            : Unauthorized(new { error = validation.Error ?? "The API client key is not authorized." });
    }

    private static JsonObject? FindAyah(string json, int number)
    {
        var data = JsonNode.Parse(json)?["data"]?.AsObject();
        var surahs = data?["surahs"]?.AsArray();
        var edition = data?["edition"];
        if (surahs is null || edition is null) return null;

        foreach (var surahNode in surahs)
        {
            var surah = surahNode?.AsObject();
            var ayahs = surah?["ayahs"]?.AsArray();
            if (surah is null || ayahs is null) continue;

            foreach (var ayahNode in ayahs)
            {
                var ayah = ayahNode?.AsObject();
                if (ayah?["number"]?.GetValue<int>() != number) continue;

                var result = ayah.DeepClone().AsObject();
                result["edition"] = edition.DeepClone();
                result["surah"] = new JsonObject
                {
                    ["number"] = surah["number"]?.DeepClone(),
                    ["name"] = surah["name"]?.DeepClone(),
                    ["englishName"] = surah["englishName"]?.DeepClone(),
                    ["englishNameTranslation"] = surah["englishNameTranslation"]?.DeepClone(),
                    ["revelationType"] = surah["revelationType"]?.DeepClone()
                };
                return result;
            }
        }
        return null;
    }
}

public sealed record PublicHadithRecord(
    int Id,
    string HadithNumber,
    string BookSlug,
    int? ChapterNumber,
    int? Volume,
    string? Status,
    string? EnglishNarrator,
    string? UrduNarrator,
    string? HadithEnglish,
    string? HadithUrdu,
    string? HadithArabic,
    string? HeadingEnglish,
    string? HeadingUrdu,
    string? HeadingArabic,
    DateTime SyncedAtUtc);
