using Azure.Storage.Blobs;
using Azure.Storage.Sas;
using DeenTime.Core.Services;

namespace DeenTime.Api.Services;

public sealed class AzureBlobStorageService : IStorageService
{
	private readonly BlobServiceClient _client;
	private readonly string _container;
	private readonly string _cdnBase;

	public AzureBlobStorageService(BlobServiceClient client, IConfiguration cfg)
	{
		_client = client;
		_container = cfg["Storage:Container"] ?? "deentime";
		_cdnBase = cfg["Storage:CdnBase"] ?? string.Empty;
	}

	public async Task<(string UploadUrl, string PublicUrl)> CreatePresignedUploadAsync(string key, string contentType)
	{
		var container = _client.GetBlobContainerClient(_container);
		await container.CreateIfNotExistsAsync();
		var blob = container.GetBlobClient(key);


		var builder = new BlobSasBuilder
		{
			BlobContainerName = _container,
			BlobName = key,
			Resource = "b",
			StartsOn = DateTimeOffset.UtcNow.AddMinutes(-5),
			ExpiresOn = DateTimeOffset.UtcNow.AddMinutes(10),
			ContentType = contentType
		};
		builder.SetPermissions(BlobSasPermissions.Write | BlobSasPermissions.Create);
		var sas = blob.GenerateSasUri(builder);

		var publicUrl = string.IsNullOrEmpty(_cdnBase) ? blob.Uri.ToString() : $"{_cdnBase.TrimEnd('/')}/{key}";
		return (sas.ToString(), publicUrl);
	}

	public async Task<string> UploadAsync(string key, string contentType, byte[] data)
	{
		var container = _client.GetBlobContainerClient(_container);
		await container.CreateIfNotExistsAsync();
		var blob = container.GetBlobClient(key);
		using var ms = new MemoryStream(data);
		await blob.UploadAsync(ms, overwrite: true);
		if (!string.IsNullOrEmpty(contentType))
		{
			await blob.SetHttpHeadersAsync(new Azure.Storage.Blobs.Models.BlobHttpHeaders { ContentType = contentType });
		}
		return string.IsNullOrEmpty(_cdnBase) ? blob.Uri.ToString() : $"{_cdnBase.TrimEnd('/')}/{key}";
	}
}


