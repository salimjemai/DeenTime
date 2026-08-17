namespace DeenTime.Core.Entities;

public sealed class QuranEdition
{
    public string Identifier { get; set; } = "";
    public string Language { get; set; } = "";
    public string Name { get; set; } = "";
    public string EnglishName { get; set; } = "";
    public string Format { get; set; } = "";
    public string Type { get; set; } = "";
    public string? Direction { get; set; }
    public DateTime SyncedAtUtc { get; set; } = DateTime.UtcNow;
}
