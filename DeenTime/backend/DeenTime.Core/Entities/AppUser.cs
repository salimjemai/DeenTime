namespace DeenTime.Core.Entities;

public sealed class AppUser
{
    public string Id { get; set; } = ""; // match external IdP subject or GUID if local
    public string? DisplayName { get; set; }
    public string? Email { get; set; }
    public string PasswordHash { get; set; } = ""; // PBKDF2 hash
    public string PasswordSalt { get; set; } = ""; // base64
}