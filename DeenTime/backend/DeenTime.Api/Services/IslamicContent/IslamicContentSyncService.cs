using System.Collections.Concurrent;
using System.Text.Json;
using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Services.IslamicContent;

public sealed class IslamicContentSyncService(
    QuranProviderClient quranClient,
    HadithProviderClient hadithClient,
    IDbContextFactory<AppDbContext> dbFactory)
{
    public async Task RunAsync(IslamicContentSyncRequest request, CancellationToken cancellationToken)
    {
        try
        {
            switch (request.Provider)
            {
                case "quran":
                    await SyncQuranAsync(request.Scope, cancellationToken);
                    break;
                case "hadith":
                    await SyncHadithAsync(cancellationToken);
                    break;
                default:
                    throw new ArgumentException($"Unknown Islamic content provider '{request.Provider}'.");
            }
        }
        catch (Exception exception)
        {
            await SetStateAsync(
                request.Provider,
                request.Scope,
                "failed",
                message: SafeMessage(exception),
                completed: true,
                cancellationToken: CancellationToken.None);
            throw;
        }
    }

    private async Task SyncQuranAsync(string scope, CancellationToken cancellationToken)
    {
        if (scope is not ("catalog" or "text" or "all"))
            throw new ArgumentException("Qur'an sync scope must be catalog, text, or all.");

        await SetStateAsync("quran", scope, "running", 0, 1, "Downloading edition catalogue…", started: true,
            cancellationToken: cancellationToken);

        var catalogue = await FetchRequiredQuranAsync("edition", cancellationToken);
        var editions = ParseEditions(catalogue.Json);
        await ReplaceQuranEditionsAsync(editions, cancellationToken);

        var cataloguePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "meta", "surah", "edition/type", "edition/format", "edition/language"
        };
        foreach (var type in editions.Select(edition => edition.Type).Where(value => value.Length > 0).Distinct())
            cataloguePaths.Add($"edition/type/{type}");
        foreach (var format in editions.Select(edition => edition.Format).Where(value => value.Length > 0).Distinct())
            cataloguePaths.Add($"edition/format/{format}");
        foreach (var language in editions.Select(edition => edition.Language).Where(value => value.Length > 0).Distinct())
            cataloguePaths.Add($"edition/language/{language}");

        QuranEdition[] corpusEditions = scope switch
        {
            "catalog" => [],
            "text" => editions.Where(edition => edition.Format.Equals("text", StringComparison.OrdinalIgnoreCase)).ToArray(),
            _ => editions.ToArray()
        };

        var corpusPaths = corpusEditions.Select(edition => $"quran/{edition.Identifier}").ToArray();
        var paths = cataloguePaths.Concat(corpusPaths).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        var total = paths.Length + 1;
        var processed = 1;
        await SetStateAsync(
            "quran",
            scope,
            "running",
            processed,
            total,
            scope == "catalog" ? "Caching Qur'an metadata…" : $"Caching {corpusEditions.Length} complete edition payloads…",
            cancellationToken: cancellationToken);

        var progressLock = new SemaphoreSlim(1, 1);
        await Parallel.ForEachAsync(paths, new ParallelOptions
        {
            MaxDegreeOfParallelism = 4,
            CancellationToken = cancellationToken
        }, async (path, token) =>
        {
            await FetchRequiredQuranAsync(path, token);
            var current = Interlocked.Increment(ref processed);
            if (current % 5 != 0 && current != total) return;

            await progressLock.WaitAsync(token);
            try
            {
                await SetStateAsync(
                    "quran",
                    scope,
                    "running",
                    current,
                    total,
                    $"Cached {current:N0} of {total:N0} payloads",
                    cancellationToken: token);
            }
            finally
            {
                progressLock.Release();
            }
        });

        await SetStateAsync(
            "quran",
            scope,
            "complete",
            total,
            total,
            scope switch
            {
                "catalog" => $"{editions.Count:N0} editions and all catalogue metadata are ready.",
                "text" => $"{corpusEditions.Length:N0} complete text editions are ready.",
                _ => $"All {corpusEditions.Length:N0} text and audio edition payloads are ready."
            },
            completed: true,
            cancellationToken: cancellationToken);
    }

    private async Task SyncHadithAsync(CancellationToken cancellationToken)
    {
        if (!hadithClient.IsConfigured)
            throw new IslamicContentProviderException("The Hadith provider key has not been configured on the server.");

        var resumeAfter = await GetFailedRunStartAsync("hadith", cancellationToken);
        await SetStateAsync("hadith", "all", "running", 0, 1, "Downloading Hadith book catalogue…", started: true,
            cancellationToken: cancellationToken);

        var books = await hadithClient.GetBooksAsync(cancellationToken);
        var expectedTotal = Math.Max(1, books.Sum(book => book.HadithCount + book.ChapterCount));
        var processed = 0;
        await SetStateAsync(
            "hadith",
            "all",
            "running",
            0,
            expectedTotal,
            $"Importing {books.Count:N0} books in Arabic, English, and Urdu…",
            cancellationToken: cancellationToken);

        foreach (var book in books)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (resumeAfter.HasValue && await WasImportedDuringRunAsync(book, resumeAfter.Value, cancellationToken))
            {
                processed += book.ChapterCount + book.HadithCount;
                await SetStateAsync(
                    "hadith",
                    "all",
                    "running",
                    Math.Min(processed, expectedTotal),
                    expectedTotal,
                    $"Reused completed import: {book.Name}",
                    cancellationToken: cancellationToken);
                continue;
            }

            var chapters = await hadithClient.GetChaptersAsync(book.Slug, cancellationToken);
            IReadOnlyList<HadithProviderRecord> records = book.HadithCount == 0
                ? []
                : await DownloadHadithBookAsync(book, processed, expectedTotal, cancellationToken);
            await ReplaceHadithBookAsync(book, chapters, records, cancellationToken);

            processed += chapters.Count + records.Count;
            await SetStateAsync(
                "hadith",
                "all",
                "running",
                Math.Min(processed, expectedTotal),
                expectedTotal,
                $"Imported {book.Name}: {records.Count:N0} hadith",
                cancellationToken: cancellationToken);
        }

        await RemoveMissingHadithBooksAsync(books.Select(book => book.Slug).ToArray(), cancellationToken);
        var actualTotal = books.Sum(book => book.HadithCount + book.ChapterCount);
        await SetStateAsync(
            "hadith",
            "all",
            "complete",
            actualTotal,
            actualTotal,
            $"{books.Count:N0} books are ready with Arabic, English, and Urdu content.",
            completed: true,
            cancellationToken: cancellationToken);
    }

    private async Task<IReadOnlyList<HadithProviderRecord>> DownloadHadithBookAsync(
        HadithProviderBook book,
        int previouslyProcessed,
        int expectedTotal,
        CancellationToken cancellationToken)
    {
        var firstPage = await hadithClient.GetHadithPageAsync(book.Slug, 1, 200, cancellationToken);
        if (firstPage.LastPage <= 1) return firstPage.Records;

        var pages = new ConcurrentDictionary<int, IReadOnlyList<HadithProviderRecord>>();
        pages[1] = firstPage.Records;
        var downloaded = firstPage.Records.Count;
        var progressLock = new SemaphoreSlim(1, 1);

        await Parallel.ForEachAsync(
            Enumerable.Range(2, firstPage.LastPage - 1),
            new ParallelOptions { MaxDegreeOfParallelism = 2, CancellationToken = cancellationToken },
            async (pageNumber, token) =>
            {
                var page = await hadithClient.GetHadithPageAsync(book.Slug, pageNumber, 200, token);
                pages[pageNumber] = page.Records;
                var current = Interlocked.Add(ref downloaded, page.Records.Count);
                if (current % 1000 >= page.Records.Count && pageNumber != firstPage.LastPage) return;

                await progressLock.WaitAsync(token);
                try
                {
                    await SetStateAsync(
                        "hadith",
                        "all",
                        "running",
                        Math.Min(previouslyProcessed + current, expectedTotal),
                        expectedTotal,
                        $"Downloading {book.Name}: {current:N0} of {firstPage.Total:N0}",
                        cancellationToken: token);
                }
                finally
                {
                    progressLock.Release();
                }
            });

        return pages.OrderBy(page => page.Key).SelectMany(page => page.Value).ToArray();
    }

    private async Task ReplaceQuranEditionsAsync(
        IReadOnlyList<QuranEdition> editions,
        CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var existing = await db.QuranEditions.ToDictionaryAsync(edition => edition.Identifier, cancellationToken);
        var incomingIds = editions.Select(edition => edition.Identifier).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var edition in editions)
        {
            if (!existing.TryGetValue(edition.Identifier, out var current))
            {
                db.QuranEditions.Add(edition);
                continue;
            }

            current.Language = edition.Language;
            current.Name = edition.Name;
            current.EnglishName = edition.EnglishName;
            current.Format = edition.Format;
            current.Type = edition.Type;
            current.Direction = edition.Direction;
            current.SyncedAtUtc = edition.SyncedAtUtc;
        }

        db.QuranEditions.RemoveRange(existing.Values.Where(edition => !incomingIds.Contains(edition.Identifier)));
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task ReplaceHadithBookAsync(
        HadithProviderBook book,
        IReadOnlyList<HadithProviderChapter> chapters,
        IReadOnlyList<HadithProviderRecord> records,
        CancellationToken cancellationToken)
    {
        var distinctChapters = chapters
            .GroupBy(chapter => chapter.ChapterNumber)
            .Select(group => group.First())
            .ToArray();
        var distinctRecords = records
            .GroupBy(record => record.HadithNumber, StringComparer.OrdinalIgnoreCase)
            .Select(group => group.First())
            .ToArray();
        var syncedAt = DateTime.UtcNow;

        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        await db.HadithRecords.Where(record => record.BookSlug == book.Slug).ExecuteDeleteAsync(cancellationToken);
        await db.HadithChapters.Where(chapter => chapter.BookSlug == book.Slug).ExecuteDeleteAsync(cancellationToken);

        var storedBook = await db.HadithBooks.FirstOrDefaultAsync(item => item.ProviderId == book.Id, cancellationToken);
        if (storedBook is null)
        {
            storedBook = new HadithBook { ProviderId = book.Id };
            db.HadithBooks.Add(storedBook);
        }

        storedBook.BookSlug = book.Slug;
        storedBook.BookName = book.Name;
        storedBook.WriterName = book.WriterName;
        storedBook.AboutWriter = book.AboutWriter;
        storedBook.WriterDeath = book.WriterDeath;
        storedBook.HadithCount = distinctRecords.Length;
        storedBook.ChapterCount = distinctChapters.Length;
        storedBook.SyncedAtUtc = syncedAt;

        db.HadithChapters.AddRange(distinctChapters.Select(chapter => new HadithChapter
        {
            Id = Guid.NewGuid(),
            ProviderId = chapter.Id,
            BookSlug = book.Slug,
            ChapterNumber = chapter.ChapterNumber,
            ChapterArabic = chapter.Arabic,
            ChapterEnglish = chapter.English,
            ChapterUrdu = chapter.Urdu,
            SyncedAtUtc = syncedAt
        }));

        db.HadithRecords.AddRange(distinctRecords.Select(record => new HadithRecord
        {
            Id = Guid.NewGuid(),
            ProviderId = record.Id,
            HadithNumber = record.HadithNumber,
            BookSlug = book.Slug,
            ChapterNumber = record.ChapterNumber,
            Volume = record.Volume,
            Status = record.Status,
            EnglishNarrator = record.EnglishNarrator,
            UrduNarrator = record.UrduNarrator,
            HadithEnglish = record.English,
            HadithUrdu = record.Urdu,
            HadithArabic = record.Arabic,
            HeadingEnglish = record.HeadingEnglish,
            HeadingUrdu = record.HeadingUrdu,
            HeadingArabic = record.HeadingArabic,
            SyncedAtUtc = syncedAt
        }));

        await db.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private async Task RemoveMissingHadithBooksAsync(string[] currentSlugs, CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var missing = await db.HadithBooks
            .Where(book => !currentSlugs.Contains(book.BookSlug))
            .Select(book => book.BookSlug)
            .ToArrayAsync(cancellationToken);
        if (missing.Length == 0) return;

        await db.HadithRecords.Where(record => missing.Contains(record.BookSlug)).ExecuteDeleteAsync(cancellationToken);
        await db.HadithChapters.Where(chapter => missing.Contains(chapter.BookSlug)).ExecuteDeleteAsync(cancellationToken);
        await db.HadithBooks.Where(book => missing.Contains(book.BookSlug)).ExecuteDeleteAsync(cancellationToken);
    }

    private async Task<DateTime?> GetFailedRunStartAsync(string provider, CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        return await db.IslamicContentSyncStates.AsNoTracking()
            .Where(state => state.Key == provider && state.Status == "failed")
            .Select(state => state.StartedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
    }

    private async Task<bool> WasImportedDuringRunAsync(
        HadithProviderBook providerBook,
        DateTime runStartedAtUtc,
        CancellationToken cancellationToken)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        return await db.HadithBooks.AsNoTracking().AnyAsync(book =>
            book.BookSlug == providerBook.Slug &&
            book.HadithCount == providerBook.HadithCount &&
            book.SyncedAtUtc >= runStartedAtUtc,
            cancellationToken);
    }

    private async Task<QuranProviderPayload> FetchRequiredQuranAsync(string path, CancellationToken cancellationToken)
    {
        QuranProviderPayload? response = null;
        for (var attempt = 1; attempt <= 3; attempt++)
        {
            response = await quranClient.GetAsync(path, forceRefresh: true, cancellationToken: cancellationToken);
            if (response.StatusCode is >= 200 and < 300) return response;
            if (attempt < 3) await Task.Delay(TimeSpan.FromMilliseconds(350 * attempt), cancellationToken);
        }

        throw new IslamicContentProviderException(
            $"The Qur'an provider could not supply the documented endpoint '/{path}' (HTTP {response?.StatusCode}).");
    }

    private static IReadOnlyList<QuranEdition> ParseEditions(string json)
    {
        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Array)
            throw new IslamicContentProviderException("The Qur'an edition catalogue had an unexpected shape.");

        var now = DateTime.UtcNow;
        return data.EnumerateArray().Select(item => new QuranEdition
        {
            Identifier = JsonString(item, "identifier") ?? "",
            Language = JsonString(item, "language") ?? "",
            Name = JsonString(item, "name") ?? "",
            EnglishName = JsonString(item, "englishName") ?? "",
            Format = JsonString(item, "format") ?? "",
            Type = JsonString(item, "type") ?? "",
            Direction = JsonString(item, "direction"),
            SyncedAtUtc = now
        }).Where(edition => edition.Identifier.Length > 0).ToArray();
    }

    private async Task SetStateAsync(
        string provider,
        string scope,
        string status,
        int? processed = null,
        int? total = null,
        string? message = null,
        bool started = false,
        bool completed = false,
        CancellationToken cancellationToken = default)
    {
        await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
        var key = provider.ToLowerInvariant();
        var state = await db.IslamicContentSyncStates.FirstOrDefaultAsync(item => item.Key == key, cancellationToken);
        if (state is null)
        {
            state = new IslamicContentSyncState { Key = key, Provider = provider };
            db.IslamicContentSyncStates.Add(state);
        }

        state.Scope = scope;
        state.Status = status;
        if (processed.HasValue) state.ProcessedItems = processed.Value;
        if (total.HasValue) state.TotalItems = total.Value;
        state.Message = message;
        if (started)
        {
            state.StartedAtUtc = DateTime.UtcNow;
            state.CompletedAtUtc = null;
        }
        if (completed) state.CompletedAtUtc = DateTime.UtcNow;
        state.UpdatedAtUtc = DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
    }

    private static string? JsonString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetString()
            : null;

    private static string SafeMessage(Exception exception) => exception switch
    {
        ArgumentException => exception.Message,
        IslamicContentProviderException => exception.Message,
        _ => "Synchronization failed. See server logs for technical details."
    };
}
