using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;

namespace DeenTime.Api.Services;

public sealed class CaptchaOptions
{
    public const string SectionName = "Captcha";
    public bool Enabled { get; set; }
    public string SiteKey { get; set; } = "";
    public string SecretKey { get; set; } = "";
    public string[] ExpectedHostnames { get; set; } = [];
}

public interface ICaptchaVerifier
{
    bool Enabled { get; }
    Task<bool> VerifyAsync(string? token, string action, string? remoteIp, CancellationToken cancellationToken);
}

public sealed class TurnstileCaptchaVerifier(HttpClient client, IOptions<CaptchaOptions> options) : ICaptchaVerifier
{
    private readonly CaptchaOptions settings = options.Value;
    public bool Enabled => settings.Enabled;

    public async Task<bool> VerifyAsync(string? token, string action, string? remoteIp, CancellationToken cancellationToken)
    {
        if (!settings.Enabled) return true;
        if (string.IsNullOrWhiteSpace(token) || token.Length > 2048 || string.IsNullOrWhiteSpace(settings.SecretKey)) return false;

        var fields = new Dictionary<string, string>
        {
            ["secret"] = settings.SecretKey,
            ["response"] = token
        };
        if (!string.IsNullOrWhiteSpace(remoteIp)) fields["remoteip"] = remoteIp;

        using var response = await client.PostAsync("turnstile/v0/siteverify", new FormUrlEncodedContent(fields), cancellationToken);
        if (!response.IsSuccessStatusCode) return false;
        var result = await response.Content.ReadFromJsonAsync<TurnstileResponse>(cancellationToken: cancellationToken);
        if (result?.Success != true || !string.Equals(result.Action, action, StringComparison.Ordinal)) return false;

        return settings.ExpectedHostnames.Length == 0 ||
            settings.ExpectedHostnames.Contains(result.Hostname, StringComparer.OrdinalIgnoreCase);
    }

    private sealed record TurnstileResponse(
        [property: JsonPropertyName("success")] bool Success,
        [property: JsonPropertyName("hostname")] string? Hostname,
        [property: JsonPropertyName("action")] string? Action,
        [property: JsonPropertyName("error-codes")] string[]? ErrorCodes);
}
