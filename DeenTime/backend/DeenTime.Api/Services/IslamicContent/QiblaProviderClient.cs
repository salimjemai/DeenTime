using System.Globalization;
using System.Net;
using System.Text.Json;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace DeenTime.Api.Services.IslamicContent;

public sealed record QiblaCoordinates(double Latitude, double Longitude, double Direction);

public sealed record QiblaDirectionPayload(
    QiblaCoordinates Data,
    bool FromCache,
    DateTime RetrievedAtUtc);

public sealed record QiblaCompassPayload(
    byte[] Content,
    string ContentType,
    DateTime RetrievedAtUtc);

public sealed class QiblaProviderClient(
    HttpClient http,
    IMemoryCache cache,
    IOptions<IslamicContentOptions> options)
{
    public const string ProviderName = "AlAdhan";
    public const string ProviderOrganization = "Islamic Network";
    public const string OpenApiVersion = "3.1.0";
    public const string OpenApiDocumentUrl = "https://api.aladhan.com/v1/documentation/openapi/qibla/yaml";
    public const string DirectionEndpointTemplate = "/qibla/{latitude}/{longitude}";
    public const string CompassEndpointTemplate = "/qibla/{latitude}/{longitude}/compass";

    public static readonly string[] OfficialServers =
    [
        "https://api.aladhan.com/v1",
        "https://aladhan.api.islamic.network/v1/",
        "https://aladhan.api.alislam.ru/v1/"
    ];

    public static readonly string[] UpstreamCompression = ["gzip", "zstd"];

    private const int MaximumCompassBytes = 2_000_000;
    private readonly IslamicContentOptions settings = options.Value;

    public async Task<QiblaDirectionPayload> GetDirectionAsync(
        double latitude,
        double longitude,
        CancellationToken cancellationToken = default)
    {
        EnsureValidCoordinates(latitude, longitude);
        var latitudePath = FormatCoordinate(latitude);
        var longitudePath = FormatCoordinate(longitude);
        var cacheKey = $"qibla:{latitudePath}:{longitudePath}";

        if (cache.TryGetValue<QiblaDirectionPayload>(cacheKey, out var cached) && cached is not null)
            return cached with { FromCache = true };

        try
        {
            using var response = await http.GetAsync(
                $"qibla/{latitudePath}/{longitudePath}",
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            if (response.StatusCode != HttpStatusCode.OK)
                throw new IslamicContentProviderException(
                    $"The Qibla provider returned HTTP {(int)response.StatusCode}.");

            var json = await response.Content.ReadAsStringAsync(cancellationToken);
            var data = ParseDirection(json);
            var payload = new QiblaDirectionPayload(data, FromCache: false, DateTime.UtcNow);
            cache.Set(cacheKey, payload, new MemoryCacheEntryOptions
            {
                AbsoluteExpirationRelativeToNow = TimeSpan.FromDays(Math.Clamp(settings.QiblaCacheDays, 1, 365)),
                Size = 1
            });
            return payload;
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new IslamicContentProviderException("The Qibla provider timed out.", exception);
        }
        catch (HttpRequestException exception)
        {
            throw new IslamicContentProviderException("The Qibla provider is currently unavailable.", exception);
        }
    }

    public async Task<QiblaCompassPayload> GetCompassAsync(
        double latitude,
        double longitude,
        CancellationToken cancellationToken = default)
    {
        EnsureValidCoordinates(latitude, longitude);
        var latitudePath = FormatCoordinate(latitude);
        var longitudePath = FormatCoordinate(longitude);

        try
        {
            using var response = await http.GetAsync(
                $"qibla/{latitudePath}/{longitudePath}/compass",
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
            if (response.StatusCode != HttpStatusCode.OK)
                throw new IslamicContentProviderException(
                    $"The Qibla compass provider returned HTTP {(int)response.StatusCode}.");

            var contentType = response.Content.Headers.ContentType?.MediaType;
            if (!string.Equals(contentType, "image/png", StringComparison.OrdinalIgnoreCase))
                throw new IslamicContentProviderException("The Qibla provider returned an unexpected compass format.");
            if (response.Content.Headers.ContentLength is > MaximumCompassBytes)
                throw new IslamicContentProviderException("The Qibla compass image exceeded the safe response limit.");

            var content = await response.Content.ReadAsByteArrayAsync(cancellationToken);
            if (content.Length == 0 || content.Length > MaximumCompassBytes)
                throw new IslamicContentProviderException("The Qibla compass image was empty or too large.");

            return new QiblaCompassPayload(content, "image/png", DateTime.UtcNow);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new IslamicContentProviderException("The Qibla compass provider timed out.", exception);
        }
        catch (HttpRequestException exception)
        {
            throw new IslamicContentProviderException("The Qibla compass provider is currently unavailable.", exception);
        }
    }

    public static bool AreValidCoordinates(double latitude, double longitude) =>
        double.IsFinite(latitude) && double.IsFinite(longitude) &&
        latitude is >= -90 and <= 90 && longitude is >= -180 and <= 180;

    public static string FormatCoordinate(double value)
    {
        var rounded = Math.Round(value, 6, MidpointRounding.AwayFromZero);
        if (rounded == 0) rounded = 0;
        return rounded.ToString("0.######", CultureInfo.InvariantCulture);
    }

    private static void EnsureValidCoordinates(double latitude, double longitude)
    {
        if (!AreValidCoordinates(latitude, longitude))
            throw new ArgumentOutOfRangeException(
                nameof(latitude),
                "Latitude must be between -90 and 90, and longitude must be between -180 and 180.");
    }

    private static QiblaCoordinates ParseDirection(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (!root.TryGetProperty("code", out var code) || code.GetInt32() != 200 ||
                !root.TryGetProperty("data", out var data) ||
                !data.TryGetProperty("latitude", out var latitudeNode) ||
                !data.TryGetProperty("longitude", out var longitudeNode) ||
                !data.TryGetProperty("direction", out var directionNode))
                throw new IslamicContentProviderException("The Qibla provider returned an incomplete response.");

            var latitude = latitudeNode.GetDouble();
            var longitude = longitudeNode.GetDouble();
            var direction = directionNode.GetDouble();
            if (!AreValidCoordinates(latitude, longitude) || !double.IsFinite(direction) || direction is < 0 or >= 360)
                throw new IslamicContentProviderException("The Qibla provider returned invalid direction data.");

            return new QiblaCoordinates(latitude, longitude, direction);
        }
        catch (JsonException exception)
        {
            throw new IslamicContentProviderException("The Qibla provider returned invalid JSON.", exception);
        }
    }
}
