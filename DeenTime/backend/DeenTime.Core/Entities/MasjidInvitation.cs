namespace DeenTime.Core.Entities;

public sealed class MasjidInvitation
{
    public Guid Id { get; set; }
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public string OrganizationName { get; set; } = "";
    public string NormalizedOrganizationName { get; set; } = "";
    public string? WebsiteUrl { get; set; }
    public string? AddressLine { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? ZipCode { get; set; }
    public string InvitationTokenHash { get; set; } = "";
    public string InvitedBySubject { get; set; } = "";
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime SentAtUtc { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAtUtc { get; set; }
    public DateTime? RegistrationStartedAtUtc { get; set; }
    public DateTime? AcceptedAtUtc { get; set; }
    public DateTime? RevokedAtUtc { get; set; }
    public int SendCount { get; set; } = 1;
    public Guid? OrganizationId { get; set; }
    public Organization? Organization { get; set; }
}
