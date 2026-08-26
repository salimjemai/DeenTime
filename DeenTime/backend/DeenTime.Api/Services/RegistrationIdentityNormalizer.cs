using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace DeenTime.Api.Services;

public sealed record NormalizedRegistrationIdentity(
    string Email,
    string Name,
    string WebsiteUrl,
    string WebsiteHost,
    string AddressFingerprint,
    string MasjidIdentityKey);

public static partial class RegistrationIdentityNormalizer
{
    public static bool TryCreate(
        string email,
        string organizationName,
        string websiteUrl,
        string addressLine,
        string city,
        string state,
        string zipCode,
        out NormalizedRegistrationIdentity? identity)
    {
        identity = null;
        var candidate = websiteUrl.Trim();
        if (!candidate.Contains("://", StringComparison.Ordinal)) candidate = $"https://{candidate}";
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            string.IsNullOrWhiteSpace(uri.IdnHost) ||
            !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        var host = uri.IdnHost.TrimEnd('.').ToLowerInvariant();
        if (host.StartsWith("www.", StringComparison.Ordinal)) host = host[4..];
        if (host.Length is 0 or > 253) return false;

        var normalizedName = NormalizeWords(organizationName);
        var normalizedAddress = string.Join('|',
            NormalizeWords(addressLine),
            NormalizeWords(city),
            NormalizeWords(state),
            NormalizeWords(zipCode));

        identity = new NormalizedRegistrationIdentity(
            email.Trim().ToLowerInvariant(),
            normalizedName,
            $"https://{host}",
            host,
            Hash(normalizedAddress),
            Hash($"{normalizedName}|{NormalizeWords(zipCode)}"));
        return true;
    }

    public static string CreateSlug(string name)
    {
        var decomposed = name.Normalize(NormalizationForm.FormD);
        var ascii = new string(decomposed.Where(character =>
            CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark).ToArray());
        var slug = NonAlphaNumeric().Replace(ascii.ToLowerInvariant(), "-").Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "masjid" : slug[..Math.Min(slug.Length, 70)];
    }

    public static string NormalizeWords(string value) =>
        Whitespace().Replace(value.Trim(), " ").ToUpperInvariant();

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    [GeneratedRegex(@"\s+")]
    private static partial Regex Whitespace();

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex NonAlphaNumeric();
}

public static class UsTimeZoneResolver
{
    private static readonly HashSet<string> Pacific = ["CA", "NV", "OR", "WA"];
    private static readonly HashSet<string> Mountain = ["AZ", "CO", "ID", "MT", "NM", "UT", "WY"];
    private static readonly HashSet<string> Central = ["AL", "AR", "IA", "IL", "KS", "LA", "MN", "MO", "MS", "ND", "NE", "OK", "SD", "TN", "TX", "WI"];

    public static string Resolve(string state, decimal longitude)
    {
        var normalized = state.Trim().ToUpperInvariant();
        if (normalized == "AK") return "America/Anchorage";
        if (normalized == "HI") return "Pacific/Honolulu";
        if (normalized == "AZ") return "America/Phoenix";
        if (normalized == "TX" && longitude < -103m) return "America/Denver";
        if (normalized == "FL") return longitude < -85.2m ? "America/Chicago" : "America/New_York";
        if (normalized == "KY") return longitude < -85.7m ? "America/Chicago" : "America/New_York";
        if (Pacific.Contains(normalized)) return "America/Los_Angeles";
        if (Mountain.Contains(normalized)) return "America/Denver";
        if (Central.Contains(normalized)) return "America/Chicago";
        return "America/New_York";
    }
}
