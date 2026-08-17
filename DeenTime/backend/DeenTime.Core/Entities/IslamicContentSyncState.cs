namespace DeenTime.Core.Entities;

public sealed class IslamicContentSyncState
{
    public string Key { get; set; } = "";
    public string Provider { get; set; } = "";
    public string Scope { get; set; } = "";
    public string Status { get; set; } = "idle";
    public int ProcessedItems { get; set; }
    public int TotalItems { get; set; }
    public string? Message { get; set; }
    public DateTime? StartedAtUtc { get; set; }
    public DateTime? CompletedAtUtc { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}
