namespace DeenTime.Core.Entities;

public sealed class PendingRegistration
{
    public Guid Id { get; set; }
    public Guid? InvitationId { get; set; }
    public MasjidInvitation? Invitation { get; set; }
    public string Email { get; set; } = "";
    public string NormalizedEmail { get; set; } = "";
    public string PasswordHash { get; set; } = "";
    public string PasswordSalt { get; set; } = "";
    public string OrganizationName { get; set; } = "";
    public string NormalizedName { get; set; } = "";
    public string WebsiteUrl { get; set; } = "";
    public string NormalizedWebsiteHost { get; set; } = "";
    public string AddressLine { get; set; } = "";
    public string City { get; set; } = "";
    public string State { get; set; } = "";
    public string ZipCode { get; set; } = "";
    public string AddressFingerprint { get; set; } = "";
    public string MasjidIdentityKey { get; set; } = "";
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public string TimezoneId { get; set; } = "America/Chicago";
    public string VerificationTokenHash { get; set; } = "";
    public DateTime VerificationExpiresAtUtc { get; set; }
    public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
}
