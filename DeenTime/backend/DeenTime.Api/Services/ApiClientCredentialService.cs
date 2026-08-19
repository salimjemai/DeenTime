using System.Security.Cryptography;
using System.Text;
using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Services;

public sealed record CreatedApiClient(ApiClient Client, string ClientKey);
public sealed record ApiClientValidation(bool IsValid, string? Error, ApiClient? Client);

public sealed class ApiClientCredentialService(AppDbContext db)
{
    public static readonly string[] SupportedScopes = ["content:read"];

    public async Task<CreatedApiClient> CreateAsync(
        Guid organizationId,
        string name,
        IEnumerable<string> scopes,
        int requestsPerMinute,
        CancellationToken cancellationToken)
    {
        var normalizedScopes = NormalizeScopes(scopes);
        var id = Guid.NewGuid();
        var secret = Base64Url(RandomNumberGenerator.GetBytes(32));
        var key = $"iqt_{id:N}_{secret}";
        var client = new ApiClient
        {
            Id = id,
            OrganizationId = organizationId,
            Name = name.Trim(),
            KeyPrefix = key[..Math.Min(key.Length, 18)],
            SecretHash = Hash(secret),
            Scopes = normalizedScopes,
            RequestsPerMinute = Math.Clamp(requestsPerMinute, 1, 10_000)
        };
        db.ApiClients.Add(client);
        await db.SaveChangesAsync(cancellationToken);
        return new CreatedApiClient(client, key);
    }

    public async Task<CreatedApiClient?> RotateAsync(Guid organizationId, Guid clientId, CancellationToken cancellationToken)
    {
        var client = await db.ApiClients.FirstOrDefaultAsync(
            item => item.Id == clientId && item.OrganizationId == organizationId,
            cancellationToken);
        if (client is null || client.RevokedAtUtc is not null) return null;

        var secret = Base64Url(RandomNumberGenerator.GetBytes(32));
        client.KeyPrefix = $"iqt_{client.Id:N}_{secret}"[..18];
        client.SecretHash = Hash(secret);
        client.LastUsedAtUtc = null;
        await db.SaveChangesAsync(cancellationToken);
        return new CreatedApiClient(client, $"iqt_{client.Id:N}_{secret}");
    }

    public async Task<bool> RevokeAsync(Guid organizationId, Guid clientId, CancellationToken cancellationToken)
    {
        var client = await db.ApiClients.FirstOrDefaultAsync(
            item => item.Id == clientId && item.OrganizationId == organizationId,
            cancellationToken);
        if (client is null) return false;
        client.RevokedAtUtc ??= DateTime.UtcNow;
        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<ApiClientValidation> ValidateAsync(
        string rawKey,
        string requiredScope,
        string endpoint,
        CancellationToken cancellationToken)
    {
        var parts = rawKey.Split('_', 3, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 3 || (parts[0] != "iqt" && parts[0] != "dtc") || !Guid.TryParseExact(parts[1], "N", out var clientId))
            return new(false, "The API client key is malformed.", null);

        var client = await db.ApiClients.FirstOrDefaultAsync(item => item.Id == clientId, cancellationToken);
        if (client is null || client.RevokedAtUtc is not null)
            return new(false, "The API client key is revoked or unknown.", null);
        if (!client.Scopes.Contains(requiredScope, StringComparer.OrdinalIgnoreCase))
            return new(false, $"The API client does not have the '{requiredScope}' scope.", client);

        var expected = Convert.FromHexString(client.SecretHash);
        var actual = Convert.FromHexString(Hash(parts[2]));
        if (!CryptographicOperations.FixedTimeEquals(expected, actual))
            return new(false, "The API client key is invalid.", null);

        var since = DateTime.UtcNow.AddMinutes(-1);
        var used = await db.ApiClientUsage.CountAsync(
            item => item.ApiClientId == client.Id && item.UsedAtUtc >= since,
            cancellationToken);
        if (used >= client.RequestsPerMinute)
            return new(false, "The API client quota has been reached. Try again later.", client);

        client.LastUsedAtUtc = DateTime.UtcNow;
        db.ApiClientUsage.Add(new ApiClientUsage
        {
            Id = Guid.NewGuid(),
            ApiClientId = client.Id,
            Endpoint = endpoint.Length > 200 ? endpoint[..200] : endpoint
        });
        await db.SaveChangesAsync(cancellationToken);
        return new(true, null, client);
    }

    private static string[] NormalizeScopes(IEnumerable<string> scopes) => scopes
        .Select(scope => scope.Trim().ToLowerInvariant())
        .Where(scope => SupportedScopes.Contains(scope, StringComparer.OrdinalIgnoreCase))
        .Distinct(StringComparer.OrdinalIgnoreCase)
        .ToArray();

    private static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
