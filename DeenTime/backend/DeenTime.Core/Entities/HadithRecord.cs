namespace DeenTime.Core.Entities;

public sealed class HadithRecord
{
    public Guid Id { get; set; }
    public int ProviderId { get; set; }
    public string HadithNumber { get; set; } = "";
    public string BookSlug { get; set; } = "";
    public int? ChapterNumber { get; set; }
    public int? Volume { get; set; }
    public string? Status { get; set; }
    public string? EnglishNarrator { get; set; }
    public string? UrduNarrator { get; set; }
    public string? HadithEnglish { get; set; }
    public string? HadithUrdu { get; set; }
    public string? HadithArabic { get; set; }
    public string? HeadingEnglish { get; set; }
    public string? HeadingUrdu { get; set; }
    public string? HeadingArabic { get; set; }
    public DateTime SyncedAtUtc { get; set; } = DateTime.UtcNow;
}
