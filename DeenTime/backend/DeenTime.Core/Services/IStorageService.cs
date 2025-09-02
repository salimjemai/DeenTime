namespace DeenTime.Core.Services;

public interface IStorageService
{
	Task<(string UploadUrl, string PublicUrl)> CreatePresignedUploadAsync(string key, string contentType);
    Task<string> UploadAsync(string key, string contentType, byte[] data);
}


