namespace DeenTime.Core.Entities;

public sealed class IslamicContentCacheEntry
{
    public Guid Id { get; set; }
    public string Provider { get; set; } = "";
    public string CacheKey { get; set; } = "";
    public string PayloadJson { get; set; } = "{}";
    public long PayloadBytes { get; set; }
    public string ContentType { get; set; } = "application/json";
    public DateTime RetrievedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAtUtc { get; set; }
}
