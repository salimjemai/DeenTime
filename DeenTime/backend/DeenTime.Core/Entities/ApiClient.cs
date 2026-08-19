namespace DeenTime.Core.Entities;

public sealed class ApiClient
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Name { get; set; } = "";
    public string KeyPrefix { get; set; } = "";
    public string SecretHash { get; set; } = "";
    public string[] Scopes { get; set; } = [];
    public int RequestsPerMinute { get; set; } = 60;
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
    public Organization? Organization { get; set; }
}
