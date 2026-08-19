using DeenTime.Api.Services;
using DeenTime.Api.Validators;
using DeenTime.Core.Entities;
using DeenTime.Core.Services;
using System.Net;
using Xunit;

namespace DeenTime.Api.Tests;

public sealed class PrayerTimeCalculatorTests
{
    [Fact]
    public void Cedar_Park_ISNA_schedule_stays_in_the_correct_local_day()
    {
        var criteria = new PrayerTimingCriteria
        {
            Method = "ISNA",
            JuristicMethodAsr = "Other",
            ZipCode = "78613",
            Latitude = 30.5052m,
            Longitude = -97.8203m,
            TimezoneId = "America/Chicago",
            DstObserved = true,
            MinutesAfterZawal = 5,
            MinutesAfterMaghrib = 1,
            KhutbahTimeMinutes = 20
        };

        var result = new IsnaCalculator().Compute(criteria, new DateOnly(2026, 8, 19));

        Assert.Equal(new TimeOnly(5, 50), result.Fajr);
        Assert.Equal(new TimeOnly(7, 0), result.Sunrise);
        Assert.Equal(new TimeOnly(13, 40), result.Dhuhr);
        Assert.Equal(new TimeOnly(17, 11), result.Asr);
        Assert.Equal(new TimeOnly(20, 10), result.Maghrib);
        Assert.Equal(new TimeOnly(21, 20), result.Isha);
    }

    [Theory]
    [InlineData("78613", "78613")]
    [InlineData("78613-1234", "78613")]
    [InlineData(" 78613 ", "78613")]
    [InlineData("Cedar Park", null)]
    public void US_postal_codes_are_normalized_safely(string input, string? expected)
    {
        Assert.Equal(expected, PostalCodeResolver.NormalizeUsPostalCode(input));
    }

    [Fact]
    public async Task Cedar_Park_postal_lookup_preserves_the_negative_longitude()
    {
        const string response = """
            {
              "post code": "78613",
              "country": "United States",
              "places": [{
                "place name": "Cedar Park",
                "state": "Texas",
                "state abbreviation": "TX",
                "latitude": "30.5052",
                "longitude": "-97.8203"
              }]
            }
            """;
        using var client = new HttpClient(new JsonHandler(response))
        {
            BaseAddress = new Uri("https://postal.test/")
        };

        var result = await new PostalCodeResolver(client).ResolveUsAsync("78613");

        Assert.NotNull(result);
        Assert.Equal("Cedar Park", result.City);
        Assert.Equal(30.5052m, result.Latitude);
        Assert.Equal(-97.8203m, result.Longitude);
    }

    [Fact]
    public void Criteria_validation_rejects_out_of_range_coordinates()
    {
        var result = new PrayerTimingCriteriaValidator().Validate(new PrayerTimingCriteria
        {
            Latitude = 30.5052m,
            Longitude = 197.8203m,
            TimezoneId = "America/Chicago"
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.PropertyName == nameof(PrayerTimingCriteria.Longitude));
    }

    private sealed class JsonHandler(string response) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Assert.Equal("https://postal.test/us/78613", request.RequestUri?.ToString());
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(response, System.Text.Encoding.UTF8, "application/json")
            });
        }
    }
}
