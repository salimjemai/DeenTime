namespace DeenTime.Core.Entities;

public sealed class ApiClientUsage
{
    public Guid Id { get; set; }
    public Guid ApiClientId { get; set; }
    public string Endpoint { get; set; } = "";
    public DateTime UsedAtUtc { get; set; } = DateTime.UtcNow;
    public ApiClient? ApiClient { get; set; }
}
