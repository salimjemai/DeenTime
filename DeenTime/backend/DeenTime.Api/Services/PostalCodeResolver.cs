using System.Globalization;
using System.Collections.Concurrent;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace DeenTime.Api.Services;

public sealed record PostalCodeLocation(
    string PostalCode,
    string City,
    string State,
    string StateAbbreviation,
    string Country,
    decimal Latitude,
    decimal Longitude);

public sealed partial class PostalCodeResolver(HttpClient client)
{
    private static readonly ConcurrentDictionary<string, PostalCodeLocation> Cache = new(StringComparer.Ordinal);

    public static string? NormalizeUsPostalCode(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var match = UsPostalCodePattern().Match(value.Trim());
        return match.Success ? match.Groups[1].Value : null;
    }

    public async Task<PostalCodeLocation?> ResolveUsAsync(string postalCode, CancellationToken cancellationToken = default)
    {
        var normalized = NormalizeUsPostalCode(postalCode);
        if (normalized is null) return null;
        if (Cache.TryGetValue(normalized, out var cached)) return cached;

        using var response = await client.GetAsync($"us/{Uri.EscapeDataString(normalized)}", cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();

        var result = await response.Content.ReadFromJsonAsync<PostalCodeResponse>(cancellationToken: cancellationToken);
        var place = result?.Places.FirstOrDefault();
        if (place is null ||
            !decimal.TryParse(place.Latitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude) ||
            !decimal.TryParse(place.Longitude, NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude))
        {
            return null;
        }

        var location = new PostalCodeLocation(
            result!.PostalCode,
            place.City,
            place.State,
            place.StateAbbreviation,
            result.Country,
            latitude,
            longitude);
        Cache[normalized] = location;
        return location;
    }

    [GeneratedRegex(@"^(\d{5})(?:-\d{4})?$")]
    private static partial Regex UsPostalCodePattern();

    private sealed record PostalCodeResponse(
        [property: JsonPropertyName("post code")] string PostalCode,
        [property: JsonPropertyName("country")] string Country,
        [property: JsonPropertyName("places")] PostalCodePlace[] Places);

    private sealed record PostalCodePlace(
        [property: JsonPropertyName("place name")] string City,
        [property: JsonPropertyName("state")] string State,
        [property: JsonPropertyName("state abbreviation")] string StateAbbreviation,
        [property: JsonPropertyName("latitude")] string Latitude,
        [property: JsonPropertyName("longitude")] string Longitude);
}
