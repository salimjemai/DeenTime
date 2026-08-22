using System.Net;
using System.Text;
using DeenTime.Api.Services.IslamicContent;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Xunit;

namespace DeenTime.Api.Tests;

public sealed class QiblaProviderClientTests
{
    [Fact]
    public async Task Direction_uses_the_documented_path_and_caches_stable_coordinates()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"code":200,"status":"OK","data":{"latitude":30.5052,"longitude":-97.8203,"direction":43.36991455214116}}""",
                Encoding.UTF8,
                "application/json")
        });
        var client = CreateClient(handler);

        var first = await client.GetDirectionAsync(30.5052, -97.8203);
        var cached = await client.GetDirectionAsync(30.5052, -97.8203);

        Assert.False(first.FromCache);
        Assert.True(cached.FromCache);
        Assert.Equal(43.36991455214116, first.Data.Direction, 10);
        Assert.Equal("/v1/qibla/30.5052/-97.8203", handler.LastRequestUri?.AbsolutePath);
        Assert.Equal(1, handler.RequestCount);
    }

    [Fact]
    public async Task Compass_requires_and_returns_the_documented_png_format()
    {
        byte[] png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(png)
            {
                Headers = { ContentType = new("image/png") }
            }
        });
        var client = CreateClient(handler);

        var result = await client.GetCompassAsync(19.071017570421, 72.838622286762);

        Assert.Equal("image/png", result.ContentType);
        Assert.Equal(png, result.Content);
        Assert.Equal("/v1/qibla/19.071018/72.838622/compass", handler.LastRequestUri?.AbsolutePath);
    }

    [Theory]
    [InlineData(91, 0)]
    [InlineData(-91, 0)]
    [InlineData(0, 181)]
    [InlineData(0, -181)]
    public void Coordinates_outside_the_globe_are_rejected(double latitude, double longitude)
    {
        Assert.False(QiblaProviderClient.AreValidCoordinates(latitude, longitude));
    }

    [Fact]
    public async Task Invalid_provider_data_is_not_forwarded_to_masjid_clients()
    {
        var handler = new StubHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"code":200,"status":"OK","data":{"latitude":30.5,"longitude":-97.8,"direction":999}}""",
                Encoding.UTF8,
                "application/json")
        });
        var client = CreateClient(handler);

        var exception = await Assert.ThrowsAsync<IslamicContentProviderException>(
            () => client.GetDirectionAsync(30.5, -97.8));

        Assert.Contains("invalid direction", exception.Message, StringComparison.OrdinalIgnoreCase);
    }

    private static QiblaProviderClient CreateClient(HttpMessageHandler handler) => new(
        new HttpClient(handler) { BaseAddress = new Uri(IslamicContentOptions.RequiredAlAdhanBaseUrl) },
        new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 }),
        Options.Create(new IslamicContentOptions()));

    private sealed class StubHandler(Func<HttpRequestMessage, HttpResponseMessage> responseFactory) : HttpMessageHandler
    {
        public int RequestCount { get; private set; }
        public Uri? LastRequestUri { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            RequestCount++;
            LastRequestUri = request.RequestUri;
            return Task.FromResult(responseFactory(request));
        }
    }
}
