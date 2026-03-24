using DeenTime.Core.Services;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;

namespace DeenTime.Api.Services;

/// <summary>
/// Stores uploaded files on the local filesystem under wwwroot/uploads/.
/// Used as a fallback when Azure Blob Storage is not configured (development / single-server).
/// For production deployments with multiple instances, use AzureBlobStorageService.
/// </summary>
public sealed class LocalStorageService : IStorageService
{
    private readonly string _basePath;
    private readonly IHttpContextAccessor _http;

    public LocalStorageService(IWebHostEnvironment env, IHttpContextAccessor http)
    {
        _basePath = Path.Combine(env.WebRootPath ?? env.ContentRootPath, "uploads");
        Directory.CreateDirectory(_basePath);
        _http = http;
    }

    public async Task<string> UploadAsync(string key, string contentType, byte[] data)
    {
        var relative = key.Replace('/', Path.DirectorySeparatorChar);
        var full = Path.Combine(_basePath, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        await File.WriteAllBytesAsync(full, data);

        var req = _http.HttpContext?.Request;
        var baseUrl = req is not null ? $"{req.Scheme}://{req.Host}" : string.Empty;
        return $"{baseUrl}/uploads/{key}";
    }

    public Task<(string UploadUrl, string PublicUrl)> CreatePresignedUploadAsync(string key, string contentType)
    {
        var req = _http.HttpContext?.Request;
        var baseUrl = req is not null ? $"{req.Scheme}://{req.Host}" : string.Empty;
        var url = $"{baseUrl}/uploads/{key}";
        return Task.FromResult((url, url));
    }
}
