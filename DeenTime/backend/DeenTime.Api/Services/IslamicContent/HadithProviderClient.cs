using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace DeenTime.Api.Services.IslamicContent;

public sealed record HadithProviderBook(
    int Id,
    string Slug,
    string Name,
    string WriterName,
    string? AboutWriter,
    string? WriterDeath,
    int HadithCount,
    int ChapterCount);

public sealed record HadithProviderChapter(
    int Id,
    string BookSlug,
    int ChapterNumber,
    string? Arabic,
    string? English,
    string? Urdu);

public sealed record HadithProviderRecord(
    int Id,
    string HadithNumber,
    string BookSlug,
    int? ChapterNumber,
    int? Volume,
    string? Status,
    string? EnglishNarrator,
    string? UrduNarrator,
    string? English,
    string? Urdu,
    string? Arabic,
    string? HeadingEnglish,
    string? HeadingUrdu,
    string? HeadingArabic);

public sealed record HadithProviderPage(
    int CurrentPage,
    int LastPage,
    int PerPage,
    int Total,
    IReadOnlyList<HadithProviderRecord> Records);

public sealed class HadithProviderClient
{
    public const string ProviderName = "hadithapi";
    public static readonly string[] Languages = ["ar", "en", "ur"];

    private readonly HttpClient _http;
    private readonly IslamicContentOptions _options;
    private readonly SemaphoreSlim _requestGate = new(1, 1);
    private DateTimeOffset _nextRequestAtUtc = DateTimeOffset.MinValue;

    public HadithProviderClient(HttpClient http, IOptions<IslamicContentOptions> options)
    {
        _http = http;
        _options = options.Value;
    }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_options.HadithApiKey);

    public async Task<IReadOnlyList<HadithProviderBook>> GetBooksAsync(CancellationToken cancellationToken = default)
    {
        using var document = await GetDocumentAsync("books", null, cancellationToken);
        var books = FindArray(document.RootElement, "books");
        return books
            .Select(item => new HadithProviderBook(
                GetInt(item, "id") ?? 0,
                GetString(item, "bookSlug", "book_slug", "slug") ?? "",
                GetString(item, "bookName", "book_name", "name") ?? "",
                GetString(item, "writerName", "writer_name") ?? "",
                GetString(item, "aboutWriter", "about_writer"),
                GetString(item, "writerDeath", "writer_death"),
                GetInt(item, "hadiths_count", "hadithCount", "hadith_count") ?? 0,
                GetInt(item, "chapters_count", "chapterCount", "chapter_count") ?? 0))
            .Where(book => book.Id > 0 && !string.IsNullOrWhiteSpace(book.Slug))
            .ToArray();
    }

    public async Task<IReadOnlyList<HadithProviderChapter>> GetChaptersAsync(
        string bookSlug,
        CancellationToken cancellationToken = default)
    {
        EnsureSlug(bookSlug);
        using var document = await GetDocumentAsync($"{bookSlug}/chapters", null, cancellationToken);
        var chapters = FindArray(document.RootElement, "chapters");
        return chapters
            .Select(item => new HadithProviderChapter(
                GetInt(item, "id") ?? 0,
                GetString(item, "bookSlug", "book_slug") ?? bookSlug,
                GetInt(item, "chapterNumber", "chapter_number") ?? 0,
                GetString(item, "chapterArabic", "chapter_arabic"),
                GetString(item, "chapterEnglish", "chapter_english"),
                GetString(item, "chapterUrdu", "chapter_urdu")))
            .Where(chapter => chapter.ChapterNumber > 0)
            .ToArray();
    }

    public async Task<HadithProviderPage> GetHadithPageAsync(
        string bookSlug,
        int page,
        int pageSize = 200,
        CancellationToken cancellationToken = default)
    {
        EnsureSlug(bookSlug);
        if (page < 1) throw new ArgumentOutOfRangeException(nameof(page));
        pageSize = Math.Clamp(pageSize, 1, 200);

        using var document = await GetDocumentAsync(
            "hadiths",
            new Dictionary<string, string?>
            {
                ["book"] = bookSlug,
                ["paginate"] = pageSize.ToString(CultureInfo.InvariantCulture),
                ["page"] = page.ToString(CultureInfo.InvariantCulture)
            },
            cancellationToken);

        if (!TryFindProperty(document.RootElement, "hadiths", out var envelope) || envelope.ValueKind != JsonValueKind.Object)
            throw new IslamicContentProviderException("The Hadith provider returned an unexpected response.");

        var records = FindArray(envelope, "data")
            .Select(item => ParseHadith(item, bookSlug))
            .Where(item => item.Id > 0 && !string.IsNullOrWhiteSpace(item.HadithNumber))
            .ToArray();

        return new HadithProviderPage(
            GetInt(envelope, "current_page", "currentPage") ?? page,
            Math.Max(1, GetInt(envelope, "last_page", "lastPage") ?? page),
            GetInt(envelope, "per_page", "perPage") ?? pageSize,
            GetInt(envelope, "total") ?? records.Length,
            records);
    }

    private async Task<JsonDocument> GetDocumentAsync(
        string relativePath,
        IReadOnlyDictionary<string, string?>? parameters,
        CancellationToken cancellationToken)
    {
        if (!IsConfigured)
            throw new IslamicContentProviderException("The Hadith provider key has not been configured on the server.");

        var query = new List<KeyValuePair<string, string?>>();
        if (parameters is not null) query.AddRange(parameters);
        query.Add(new KeyValuePair<string, string?>("apiKey", _options.HadithApiKey));

        var uri = relativePath.TrimStart('/') + "?" + string.Join("&", query.Select(pair =>
            $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value ?? string.Empty)}"));

        const int maxAttempts = 8;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            await _requestGate.WaitAsync(cancellationToken);
            try
            {
                var throttleDelay = _nextRequestAtUtc - DateTimeOffset.UtcNow;
                if (throttleDelay > TimeSpan.Zero)
                    await Task.Delay(throttleDelay, cancellationToken);

                using var response = await _http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
                _nextRequestAtUtc = DateTimeOffset.UtcNow.AddMilliseconds(850);

                if (response.StatusCode == HttpStatusCode.TooManyRequests)
                {
                    var retryAfter = response.Headers.RetryAfter?.Delta
                        ?? (response.Headers.RetryAfter?.Date - DateTimeOffset.UtcNow)
                        ?? TimeSpan.FromSeconds(Math.Min(60, 3 * Math.Pow(2, attempt - 1)));
                    if (retryAfter < TimeSpan.FromSeconds(2)) retryAfter = TimeSpan.FromSeconds(2);
                    if (retryAfter > TimeSpan.FromMinutes(2)) retryAfter = TimeSpan.FromMinutes(2);
                    _nextRequestAtUtc = DateTimeOffset.UtcNow.Add(retryAfter);

                    if (attempt == maxAttempts)
                        throw new IslamicContentProviderException(
                            "The Hadith provider rate limit remained active after automatic retries.");
                    continue;
                }

                if (!response.IsSuccessStatusCode)
                    throw new IslamicContentProviderException(
                        $"The Hadith provider returned HTTP {(int)response.StatusCode} ({response.StatusCode}).");

                await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
                return await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new IslamicContentProviderException("The Hadith provider timed out.");
            }
            catch (JsonException ex)
            {
                throw new IslamicContentProviderException("The Hadith provider returned an invalid response.", ex);
            }
            catch (HttpRequestException ex)
            {
                if (attempt == maxAttempts)
                    throw new IslamicContentProviderException("The Hadith provider is currently unavailable.", ex);
                _nextRequestAtUtc = DateTimeOffset.UtcNow.AddSeconds(Math.Min(30, attempt * 2));
            }
            finally
            {
                _requestGate.Release();
            }
        }

        throw new IslamicContentProviderException("The Hadith provider is currently unavailable.");
    }

    private static HadithProviderRecord ParseHadith(JsonElement item, string fallbackBookSlug)
    {
        int? chapterNumber = GetInt(item, "chapterNumber", "chapter_number");
        if (TryFindProperty(item, "chapter", out var chapter) && chapter.ValueKind == JsonValueKind.Object)
            chapterNumber ??= GetInt(chapter, "chapterNumber", "chapter_number", "id");
        chapterNumber ??= GetInt(item, "chapterId", "chapter_id");

        return new HadithProviderRecord(
            GetInt(item, "id") ?? 0,
            GetString(item, "hadithNumber", "hadith_number") ?? "",
            GetString(item, "bookSlug", "book_slug") ?? fallbackBookSlug,
            chapterNumber,
            GetInt(item, "volume"),
            GetString(item, "status"),
            GetString(item, "englishNarrator", "english_narrator"),
            GetString(item, "urduNarrator", "urdu_narrator"),
            GetString(item, "hadithEnglish", "hadith_english"),
            GetString(item, "hadithUrdu", "hadith_urdu"),
            GetString(item, "hadithArabic", "hadith_arabic"),
            GetString(item, "headingEnglish", "heading_english"),
            GetString(item, "headingUrdu", "heading_urdu"),
            GetString(item, "headingArabic", "heading_arabic"));
    }

    private static IReadOnlyList<JsonElement> FindArray(JsonElement root, string propertyName)
    {
        if (TryFindProperty(root, propertyName, out var direct) && direct.ValueKind == JsonValueKind.Array)
            return direct.EnumerateArray().ToArray();

        if (TryFindProperty(root, "data", out var data) && data.ValueKind == JsonValueKind.Object &&
            TryFindProperty(data, propertyName, out var nested) && nested.ValueKind == JsonValueKind.Array)
            return nested.EnumerateArray().ToArray();

        return [];
    }

    private static string? GetString(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (!TryFindProperty(element, name, out var value) || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                continue;
            return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
        }
        return null;
    }

    private static int? GetInt(JsonElement element, params string[] names)
    {
        var value = GetString(element, names);
        if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number)) return number;
        if (decimal.TryParse(value, NumberStyles.Number, CultureInfo.InvariantCulture, out var decimalNumber))
            return (int)decimalNumber;
        return null;
    }

    private static bool TryFindProperty(JsonElement element, string name, out JsonElement value)
    {
        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in element.EnumerateObject())
            {
                if (property.Name.Equals(name, StringComparison.OrdinalIgnoreCase))
                {
                    value = property.Value;
                    return true;
                }
            }
        }
        value = default;
        return false;
    }

    private static void EnsureSlug(string slug)
    {
        if (string.IsNullOrWhiteSpace(slug) || slug.Length > 80 ||
            slug.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_')))
            throw new ArgumentException("Invalid Hadith book slug.", nameof(slug));
    }
}
