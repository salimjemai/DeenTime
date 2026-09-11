namespace DeenTime.Api.Services;

/// <summary>
/// Public contact details shown on the sign-in page and in registration emails so a
/// masjid can reach the IqamaTime administrator to request an invitation or get help.
/// </summary>
public sealed class SupportOptions
{
    public const string SectionName = "Support";
    public string? Email { get; set; }
    public string? Phone { get; set; }
    public string? Url { get; set; }
}
