using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace DeenTime.Api.Services.IslamicContent;

public sealed record QuranProviderPayload(
    string Json,
    string ContentType,
    int StatusCode,
    bool FromCache,
    bool IsStale,
    DateTime RetrievedAtUtc);

public sealed class QuranProviderClient
{
    public const string ProviderName = "alquran-cloud";

    public static readonly string[] EndpointTemplates =
    [
        "/ayah/random",
        "/ayah/random/{edition}",
        "/ayah/random/editions/{editions}",
        "/ayah/{number}",
        "/ayah/{number}/{edition}",
        "/ayah/{number}/editions/{editions}",
        "/edition",
        "/edition/type",
        "/edition/type/{type}",
        "/edition/format",
        "/edition/format/{format}",
        "/edition/language",
        "/edition/language/{lang}",
        "/hizbQuarter/{number}",
        "/hizbQuarter/{number}/{edition}",
        "/juz/{number}",
        "/juz/{number}/{edition}",
        "/manzil/{number}",
        "/manzil/{number}/{edition}",
        "/meta",
        "/page/{number}",
        "/page/{number}/{edition}",
        "/quran",
        "/quran/{edition}",
        "/ruku/{number}",
        "/ruku/{number}/{edition}",
        "/sajda",
        "/sajda/{edition}",
        "/search/{word}",
        "/search/{word}/{surah}",
        "/search/{word}/{surah}/{language}",
        "/surah",
        "/surah/{number}",
        "/surah/{number}/{edition}",
        "/surah/{number}/editions/{editions}"
    ];

    private static readonly Regex[] AllowedPaths =
    [
        PathRegex(@"ayah/random"),
        PathRegex(@"ayah/random/[^/]+"),
        PathRegex(@"ayah/random/editions/[^/]+"),
        PathRegex(@"ayah/\d+"),
        PathRegex(@"ayah/\d+/[^/]+"),
        PathRegex(@"ayah/\d+/editions/[^/]+"),
        PathRegex(@"edition"),
        PathRegex(@"edition/(?:type|format|language)"),
        PathRegex(@"edition/(?:type|format|language)/[^/]+"),
        PathRegex(@"(?:hizbQuarter|juz|manzil|page|ruku)/\d+"),
        PathRegex(@"(?:hizbQuarter|juz|manzil|page|ruku)/\d+/[^/]+"),
        PathRegex(@"meta"),
        PathRegex(@"quran"),
        PathRegex(@"quran/[^/]+"),
        PathRegex(@"sajda"),
        PathRegex(@"sajda/[^/]+"),
        PathRegex(@"search/[^/]+"),
        PathRegex(@"search/[^/]+/(?:all|\d+)"),
        PathRegex(@"search/[^/]+/(?:all|\d+)/[^/]+"),
        PathRegex(@"surah"),
        PathRegex(@"surah/\d+"),
        PathRegex(@"surah/\d+/[^/]+"),
        PathRegex(@"surah/\d+/editions/[^/]+")
    ];

    private static readonly HashSet<string> AllowedQueryKeys =
        new(StringComparer.OrdinalIgnoreCase) { "type", "format", "language", "offset", "limit" };

    private readonly HttpClient _http;
    private readonly IDbContextFactory<AppDbContext> _dbFactory;
    private readonly IslamicContentOptions _options;

    public QuranProviderClient(
        HttpClient http,
        IDbContextFactory<AppDbContext> dbFactory,
        IOptions<IslamicContentOptions> options)
    {
        _http = http;
        _dbFactory = dbFactory;
        _options = options.Value;
    }

    public static bool IsDocumentedPath(string path)
    {
        var normalized = NormalizePath(path);
        return normalized is not null && AllowedPaths.Any(regex => regex.IsMatch(normalized));
    }

    public async Task<QuranProviderPayload> GetAsync(
        string path,
        IEnumerable<KeyValuePair<string, string?>>? query = null,
        bool forceRefresh = false,
        CancellationToken cancellationToken = default)
    {
        var normalizedPath = NormalizePath(path);
        if (normalizedPath is null || !AllowedPaths.Any(regex => regex.IsMatch(normalizedPath)))
            throw new ArgumentException("The requested path is not part of the documented AlQuran Cloud API.", nameof(path));

        var queryString = NormalizeQuery(query);
        var relativeUri = EscapePath(normalizedPath) + queryString;
        var cacheKey = "/" + normalizedPath + queryString;
        var isRandom = normalizedPath.StartsWith("ayah/random", StringComparison.OrdinalIgnoreCase);

        IslamicContentCacheEntry? cached = null;
        if (!isRandom)
        {
            await using var readDb = await _dbFactory.CreateDbContextAsync(cancellationToken);
            cached = await readDb.IslamicContentCacheEntries.AsNoTracking()
                .FirstOrDefaultAsync(
                    entry => entry.Provider == ProviderName && entry.CacheKey == cacheKey,
                    cancellationToken);

            if (!forceRefresh && cached is not null && cached.ExpiresAtUtc > DateTime.UtcNow)
                return FromCache(cached, isStale: false);
        }

        try
        {
            using var response = await _http.GetAsync(
                relativeUri,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            var contentType = response.Content.Headers.ContentType?.ToString() ?? "application/json; charset=utf-8";

            if (response.IsSuccessStatusCode)
            {
                EnsureValidJson(json);
                var retrievedAt = DateTime.UtcNow;
                if (!isRandom)
                    await UpsertCacheAsync(cacheKey, json, contentType, retrievedAt, cancellationToken);

                return new QuranProviderPayload(
                    json,
                    contentType,
                    (int)response.StatusCode,
                    FromCache: false,
                    IsStale: false,
                    retrievedAt);
            }

            if (cached is not null)
                return FromCache(cached, isStale: true);

            return new QuranProviderPayload(
                string.IsNullOrWhiteSpace(json) ? "{\"code\":502,\"status\":\"UPSTREAM ERROR\"}" : json,
                contentType,
                (int)response.StatusCode,
                FromCache: false,
                IsStale: false,
                DateTime.UtcNow);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested && cached is not null)
        {
            return FromCache(cached, isStale: true);
        }
        catch (HttpRequestException) when (cached is not null)
        {
            return FromCache(cached, isStale: true);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new IslamicContentProviderException("The Qur'an content provider is currently unavailable.", ex);
        }
    }

    private async Task UpsertCacheAsync(
        string cacheKey,
        string json,
        string contentType,
        DateTime retrievedAt,
        CancellationToken cancellationToken)
    {
        await using var db = await _dbFactory.CreateDbContextAsync(cancellationToken);
        var entry = await db.IslamicContentCacheEntries
            .FirstOrDefaultAsync(
                item => item.Provider == ProviderName && item.CacheKey == cacheKey,
                cancellationToken);

        if (entry is null)
        {
            entry = new IslamicContentCacheEntry
            {
                Id = Guid.NewGuid(),
                Provider = ProviderName,
                CacheKey = cacheKey
            };
            db.IslamicContentCacheEntries.Add(entry);
        }

        entry.PayloadJson = json;
        entry.PayloadBytes = Encoding.UTF8.GetByteCount(json);
        entry.ContentType = contentType;
        entry.RetrievedAtUtc = retrievedAt;
        entry.ExpiresAtUtc = retrievedAt.AddDays(Math.Clamp(_options.QuranCacheDays, 1, 365));

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException) when (entry.Id != Guid.Empty)
        {
            db.ChangeTracker.Clear();
            var concurrent = await db.IslamicContentCacheEntries
                .FirstOrDefaultAsync(
                    item => item.Provider == ProviderName && item.CacheKey == cacheKey,
                    cancellationToken);
            if (concurrent is null) throw;
            concurrent.PayloadJson = json;
            concurrent.PayloadBytes = Encoding.UTF8.GetByteCount(json);
            concurrent.ContentType = contentType;
            concurrent.RetrievedAtUtc = retrievedAt;
            concurrent.ExpiresAtUtc = entry.ExpiresAtUtc;
            await db.SaveChangesAsync(cancellationToken);
        }
    }

    private static QuranProviderPayload FromCache(IslamicContentCacheEntry entry, bool isStale) =>
        new(
            entry.PayloadJson,
            entry.ContentType,
            (int)HttpStatusCode.OK,
            FromCache: true,
            isStale,
            entry.RetrievedAtUtc);

    private static string? NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path) || path.Length > 500) return null;
        var normalized = path.Trim().Trim('/');
        if (normalized.Length == 0 || normalized.Contains('\\') || normalized.Contains('?') || normalized.Contains('#'))
            return null;
        if (normalized.Any(char.IsControl)) return null;
        if (normalized.Split('/').Any(segment => segment is "." or ".." || segment.Length == 0)) return null;
        return normalized;
    }

    private static string NormalizeQuery(IEnumerable<KeyValuePair<string, string?>>? query)
    {
        if (query is null) return string.Empty;

        var parameters = new List<KeyValuePair<string, string>>();
        foreach (var pair in query)
        {
            if (!AllowedQueryKeys.Contains(pair.Key) || string.IsNullOrWhiteSpace(pair.Value)) continue;
            var value = pair.Value.Trim();
            if (value.Length > 100) throw new ArgumentException($"Query parameter '{pair.Key}' is too long.");

            if (pair.Key.Equals("offset", StringComparison.OrdinalIgnoreCase) ||
                pair.Key.Equals("limit", StringComparison.OrdinalIgnoreCase))
            {
                if (!int.TryParse(value, out var number) || number < 0 || number > 10000)
                    throw new ArgumentException($"Query parameter '{pair.Key}' must be between 0 and 10000.");
            }
            else if (!Regex.IsMatch(value, @"^[\p{L}\p{N}._-]+$", RegexOptions.CultureInvariant))
            {
                throw new ArgumentException($"Query parameter '{pair.Key}' contains unsupported characters.");
            }

            parameters.Add(new KeyValuePair<string, string>(pair.Key.ToLowerInvariant(), value));
        }

        if (parameters.Count == 0) return string.Empty;
        return "?" + string.Join("&", parameters
            .OrderBy(pair => pair.Key, StringComparer.Ordinal)
            .ThenBy(pair => pair.Value, StringComparer.Ordinal)
            .Select(pair => $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));
    }

    private static string EscapePath(string path) =>
        string.Join('/', path.Split('/').Select(Uri.EscapeDataString));

    private static void EnsureValidJson(string json)
    {
        try
        {
            using var _ = JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            throw new IslamicContentProviderException("The Qur'an provider returned an invalid response.", ex);
        }
    }

    private static Regex PathRegex(string expression) =>
        new($"^(?:{expression})$", RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
}
