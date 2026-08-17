namespace DeenTime.Core.Entities;

public sealed class HadithBook
{
    public int ProviderId { get; set; }
    public string BookSlug { get; set; } = "";
    public string BookName { get; set; } = "";
    public string WriterName { get; set; } = "";
    public string? AboutWriter { get; set; }
    public string? WriterDeath { get; set; }
    public int HadithCount { get; set; }
    public int ChapterCount { get; set; }
    public DateTime SyncedAtUtc { get; set; } = DateTime.UtcNow;
}
