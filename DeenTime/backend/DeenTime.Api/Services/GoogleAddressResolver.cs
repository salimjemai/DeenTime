using System.Net.Http.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace DeenTime.Api.Services;

public sealed class GooglePlacesOptions
{
    public const string SectionName = "GooglePlaces";
    public bool Enabled { get; init; }
    public string ApiKey { get; init; } = string.Empty;
}

public sealed record AddressSuggestion(string PlaceId, string Description);

public sealed record VerifiedAddress(
    string PlaceId,
    string FormattedAddress,
    string AddressLine,
    string City,
    string State,
    string PostalCode,
    string Country,
    decimal Latitude,
    decimal Longitude);

public sealed class GoogleAddressResolver(
    HttpClient client,
    IOptions<GooglePlacesOptions> options,
    IMemoryCache cache)
{
    private readonly GooglePlacesOptions settings = options.Value;

    public bool IsEnabled => settings.Enabled && !string.IsNullOrWhiteSpace(settings.ApiKey);

    public async Task<IReadOnlyList<AddressSuggestion>> SearchAsync(
        string input,
        string sessionToken,
        CancellationToken cancellationToken = default)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(input) || input.Trim().Length < 4)
            return [];

        using var request = new HttpRequestMessage(HttpMethod.Post, "v1/places:autocomplete")
        {
            Content = JsonContent.Create(new
            {
                input = input.Trim(),
                includedRegionCodes = new[] { "us" },
                includedPrimaryTypes = new[] { "street_address" },
                languageCode = "en",
                sessionToken
            })
        };
        AddGoogleHeaders(request, "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text");

        using var response = await client.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        var result = await response.Content.ReadFromJsonAsync<AutocompleteResponse>(cancellationToken: cancellationToken);

        return result?.Suggestions
            .Select(item => item.PlacePrediction)
            .Where(item => item is not null && !string.IsNullOrWhiteSpace(item.PlaceId) && !string.IsNullOrWhiteSpace(item.Text?.Text))
            .Select(item => new AddressSuggestion(item!.PlaceId, item.Text!.Text))
            .Take(5)
            .ToArray() ?? [];
    }

    public async Task<VerifiedAddress?> ResolveAsync(
        string placeId,
        string? sessionToken,
        CancellationToken cancellationToken = default)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(placeId)) return null;
        var cacheKey = $"google-place:{placeId}";
        if (cache.TryGetValue(cacheKey, out VerifiedAddress? cached)) return cached;

        var uri = $"v1/places/{Uri.EscapeDataString(placeId)}?languageCode=en";
        if (!string.IsNullOrWhiteSpace(sessionToken))
            uri += $"&sessionToken={Uri.EscapeDataString(sessionToken)}";

        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        AddGoogleHeaders(request, "id,formattedAddress,addressComponents,location");
        using var response = await client.SendAsync(request, cancellationToken);
        if (response.StatusCode == System.Net.HttpStatusCode.NotFound) return null;
        response.EnsureSuccessStatusCode();

        var place = await response.Content.ReadFromJsonAsync<PlaceDetailsResponse>(cancellationToken: cancellationToken);
        if (place is null || !string.Equals(Component(place, "country")?.ShortText, "US", StringComparison.OrdinalIgnoreCase))
            return null;

        var streetNumber = Component(place, "street_number")?.LongText;
        var route = Component(place, "route")?.LongText;
        var subpremise = Component(place, "subpremise")?.LongText;
        var city = Component(place, "locality")?.LongText
            ?? Component(place, "postal_town")?.LongText
            ?? Component(place, "sublocality_level_1")?.LongText
            ?? Component(place, "administrative_area_level_2")?.LongText;
        var state = Component(place, "administrative_area_level_1")?.ShortText;
        var postalCode = Component(place, "postal_code")?.LongText;

        if (string.IsNullOrWhiteSpace(streetNumber) || string.IsNullOrWhiteSpace(route) ||
            string.IsNullOrWhiteSpace(city) || string.IsNullOrWhiteSpace(state) ||
            string.IsNullOrWhiteSpace(postalCode) || place.Location is null)
            return null;

        var addressLine = $"{streetNumber} {route}";
        if (!string.IsNullOrWhiteSpace(subpremise)) addressLine += $" #{subpremise}";

        var verified = new VerifiedAddress(
            place.Id,
            place.FormattedAddress,
            addressLine,
            city,
            state,
            postalCode,
            "US",
            place.Location.Latitude,
            place.Location.Longitude);
        cache.Set(cacheKey, verified, TimeSpan.FromMinutes(20));
        return verified;
    }

    private void AddGoogleHeaders(HttpRequestMessage request, string fieldMask)
    {
        request.Headers.Add("X-Goog-Api-Key", settings.ApiKey);
        request.Headers.Add("X-Goog-FieldMask", fieldMask);
    }

    private static AddressComponent? Component(PlaceDetailsResponse place, string type) =>
        place.AddressComponents.FirstOrDefault(component => component.Types.Contains(type, StringComparer.Ordinal));

    private sealed record AutocompleteResponse(
        [property: JsonPropertyName("suggestions")] AutocompleteSuggestion[] Suggestions);

    private sealed record AutocompleteSuggestion(
        [property: JsonPropertyName("placePrediction")] PlacePrediction? PlacePrediction);

    private sealed record PlacePrediction(
        [property: JsonPropertyName("placeId")] string PlaceId,
        [property: JsonPropertyName("text")] FormattableText? Text);

    private sealed record FormattableText([property: JsonPropertyName("text")] string Text);

    private sealed record PlaceDetailsResponse(
        [property: JsonPropertyName("id")] string Id,
        [property: JsonPropertyName("formattedAddress")] string FormattedAddress,
        [property: JsonPropertyName("addressComponents")] AddressComponent[] AddressComponents,
        [property: JsonPropertyName("location")] PlaceLocation? Location);

    private sealed record AddressComponent(
        [property: JsonPropertyName("longText")] string LongText,
        [property: JsonPropertyName("shortText")] string ShortText,
        [property: JsonPropertyName("types")] string[] Types);

    private sealed record PlaceLocation(
        [property: JsonPropertyName("latitude")] decimal Latitude,
        [property: JsonPropertyName("longitude")] decimal Longitude);
}
