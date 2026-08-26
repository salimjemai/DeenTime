using System.Net;
using System.Text;
using DeenTime.Api.Services;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;
using Xunit;

namespace DeenTime.Api.Tests;

public sealed class GoogleAddressResolverTests
{
    [Fact]
    public async Task Search_and_details_return_a_complete_verified_us_address()
    {
        var handler = new GooglePlacesHandler();
        var resolver = new GoogleAddressResolver(
            new HttpClient(handler) { BaseAddress = new Uri("https://places.googleapis.test/") },
            Options.Create(new GooglePlacesOptions { Enabled = true, ApiKey = "test-key" }),
            new MemoryCache(new MemoryCacheOptions()));

        var suggestions = await resolver.SearchAsync("14300 Rountree", "session-1");
        var suggestion = Assert.Single(suggestions);
        Assert.Equal("place-123", suggestion.PlaceId);

        var address = await resolver.ResolveAsync(suggestion.PlaceId, "session-1");
        Assert.NotNull(address);
        Assert.Equal("14300 Rountree Ranch Ln", address.AddressLine);
        Assert.Equal("Austin", address.City);
        Assert.Equal("TX", address.State);
        Assert.Equal("78717", address.PostalCode);

        Assert.Same(address, await resolver.ResolveAsync(suggestion.PlaceId, null));
        Assert.Equal(2, handler.RequestCount);
    }

    private sealed class GooglePlacesHandler : HttpMessageHandler
    {
        public int RequestCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestCount++;
            var json = request.Method == HttpMethod.Post
                ? """
                  {"suggestions":[{"placePrediction":{"placeId":"place-123","text":{"text":"14300 Rountree Ranch Ln, Austin, TX 78717, USA"}}}]}
                  """
                : """
                  {
                    "id":"place-123",
                    "formattedAddress":"14300 Rountree Ranch Ln, Austin, TX 78717, USA",
                    "addressComponents":[
                      {"longText":"14300","shortText":"14300","types":["street_number"]},
                      {"longText":"Rountree Ranch Ln","shortText":"Rountree Ranch Ln","types":["route"]},
                      {"longText":"Austin","shortText":"Austin","types":["locality"]},
                      {"longText":"Texas","shortText":"TX","types":["administrative_area_level_1"]},
                      {"longText":"78717","shortText":"78717","types":["postal_code"]},
                      {"longText":"United States","shortText":"US","types":["country"]}
                    ],
                    "location":{"latitude":30.5119418,"longitude":-97.8177601}
                  }
                  """;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(json, Encoding.UTF8, "application/json")
            });
        }
    }
}
