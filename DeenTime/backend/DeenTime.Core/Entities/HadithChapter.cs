namespace DeenTime.Core.Entities;

public sealed class HadithChapter
{
    public Guid Id { get; set; }
    public int ProviderId { get; set; }
    public string BookSlug { get; set; } = "";
    public int ChapterNumber { get; set; }
    public string? ChapterEnglish { get; set; }
    public string? ChapterUrdu { get; set; }
    public string? ChapterArabic { get; set; }
    public DateTime SyncedAtUtc { get; set; } = DateTime.UtcNow;
}
