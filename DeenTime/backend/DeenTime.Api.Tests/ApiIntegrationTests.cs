using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;
using Xunit;
using Xunit.Sdk;
using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Infrastructure;
using DeenTime.Api.Services;

namespace DeenTime.Api.Tests;

public sealed class ApiIntegrationTests : IAsyncLifetime
{
    private const string Password = "TestOnly-Password-1234";
    private readonly PostgreSqlContainer database = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("deentime_test")
        .WithUsername("postgres")
        .WithPassword("postgres")
        .Build();
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;
    private string organizationId = "";
    private string organizationSlug = "";

    public async Task InitializeAsync()
    {
        try
        {
            await database.StartAsync();
        }
        catch (Exception exception)
        {
            throw SkipException.ForSkip($"PostgreSQL integration tests require Docker: {exception.Message}");
        }

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Default", database.GetConnectionString());
            builder.UseSetting("Auth:Issuer", "deentime-test");
            builder.UseSetting("Auth:Audience", "deentime-api-test");
            builder.UseSetting("Auth:SigningKey", "test-signing-key-that-is-long-enough-123456");
            builder.UseSetting("Frontend:PublicBaseUrl", "https://public.deentime.test");
            builder.UseSetting("SuperUser:Email", "admin@deentime.test");
            builder.UseSetting("SuperUser:Password", Password);
            builder.UseSetting("SuperUser:OrgName", "Integration Mosque");
            builder.UseSetting("SuperUser:Latitude", "30.5119418");
            builder.UseSetting("SuperUser:Longitude", "-97.8177601");
            builder.UseSetting("SuperUser:TimezoneId", "America/Chicago");
            builder.ConfigureAppConfiguration((_, configuration) => configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = database.GetConnectionString(),
                ["Auth:Issuer"] = "deentime-test",
                ["Auth:Audience"] = "deentime-api-test",
                ["Auth:SigningKey"] = "test-signing-key-that-is-long-enough-123456",
                ["Frontend:PublicBaseUrl"] = "https://public.deentime.test",
                ["SuperUser:Email"] = "admin@deentime.test",
                ["SuperUser:Password"] = Password,
                ["SuperUser:OrgName"] = "Integration Mosque",
                ["SuperUser:Latitude"] = "30.5119418",
                ["SuperUser:Longitude"] = "-97.8177601",
                ["SuperUser:TimezoneId"] = "America/Chicago"
            }));
            builder.ConfigureServices(services =>
            {
                services.RemoveAll<PostalCodeResolver>();
                services.AddSingleton(new PostalCodeResolver(new HttpClient(new PostalLookupHandler())
                {
                    BaseAddress = new Uri("https://postal.test/")
                }));
            });
        });
        client = factory.CreateClient();
        var login = await client.PostAsJsonAsync("/api/v1/auth/login", new { email = "admin@deentime.test", password = Password });
        login.EnsureSuccessStatusCode();
        using var loginBody = JsonDocument.Parse(await login.Content.ReadAsStringAsync());
        var token = loginBody.RootElement.GetProperty("token").GetString();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        using var organizations = JsonDocument.Parse(await (await client.GetAsync("/api/v1/orgs?search=&page=1")).Content.ReadAsStringAsync());
        organizationId = organizations.RootElement.GetProperty("items")[0].GetProperty("id").GetString()!;
        organizationSlug = organizations.RootElement.GetProperty("items")[0].GetProperty("slug").GetString()!;
    }

    public async Task DisposeAsync()
    {
        client?.Dispose();
        factory?.Dispose();
        await database.DisposeAsync();
    }

    [Fact]
    public async Task Readiness_and_version_report_the_current_stack()
    {
        var readiness = await client!.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, readiness.StatusCode);
        using var readinessBody = JsonDocument.Parse(await readiness.Content.ReadAsStringAsync());
        Assert.Equal("ready", readinessBody.RootElement.GetProperty("status").GetString());

        var version = await client.GetFromJsonAsync<JsonElement>("/api/version");
        Assert.Equal("20260819050000_RenameDefaultBranding", version.GetProperty("schemaVersion").GetString());
        Assert.False(string.IsNullOrWhiteSpace(version.GetProperty("apiVersion").GetString()));
    }

    [Fact]
    public async Task US_zip_is_authoritative_when_prayer_criteria_are_saved()
    {
        var update = await client!.PutAsJsonAsync($"/api/v1/orgs/{organizationId}/criteria", new
        {
            organizationId,
            zipCode = "78613",
            method = "ISNA",
            juristicMethodAsr = "Other",
            latitude = 30.5052,
            longitude = 30.5052,
            timezoneId = "America/Chicago",
            dstObserved = true,
            minutesAfterZawal = 5,
            minutesAfterMaghrib = 1,
            khutbahTimeMinutes = 20
        });
        Assert.Equal(HttpStatusCode.NoContent, update.StatusCode);

        var saved = await client!.GetFromJsonAsync<JsonElement>($"/api/v1/orgs/{organizationId}/criteria");
        Assert.Equal(30.5052m, saved.GetProperty("latitude").GetDecimal());
        Assert.Equal(-97.8203m, saved.GetProperty("longitude").GetDecimal());
    }

    [Fact]
    public async Task Session_rejects_stale_organization_claim_and_embed_is_portable()
    {
        var session = await client!.GetFromJsonAsync<JsonElement>("/api/v1/auth/session");
        Assert.Equal(organizationId, session.GetProperty("organizationId").GetString());

        var embed = await client!.GetFromJsonAsync<JsonElement>($"/api/v1/publish/embed-code/{organizationId}");
        var iframe = embed.GetProperty("iframe").GetString()!;
        Assert.Contains("src=\"https://public.deentime.test/w/", iframe);
        Assert.Contains("title=\"IqamaTime", iframe);
        Assert.Contains("Integration Mosque prayer times", iframe);
        Assert.Contains("Integration Mosque", WebUtility.HtmlDecode(iframe));

        var dynamicEmbed = await client!.GetFromJsonAsync<JsonElement>(
            $"/api/v1/publish/embed-code/{organizationId}?publicOrigin=https%3A%2F%2Fiqamatime.example");
        var dynamicIframe = dynamicEmbed.GetProperty("iframe").GetString()!;
        Assert.Contains("src=\"https://iqamatime.example/w/", dynamicIframe);
        Assert.DoesNotContain("public.deentime.test", dynamicIframe);
    }

    [Fact]
    public async Task Design_persists_independent_typography_and_public_query_overrides_are_bounded()
    {
        var design = await client!.GetFromJsonAsync<JsonElement>($"/api/v1/design/{organizationId}");
        Assert.Equal(100, design.GetProperty("tvFontScale").GetInt32());
        Assert.Equal("system", design.GetProperty("compactFontFamily").GetString());

        var update = await client!.PutAsJsonAsync($"/api/v1/design/{organizationId}", new
        {
            headerImageUrl = "https://cdn.example.test/masjid.jpg",
            iqamaHeadings = new[] { "FAJR", "IQM*" },
            footerHtml = "<p>IqamaTime</p>",
            theme = "classic",
            tvFontScale = 75,
            widgetFontScale = 125,
            compactFontScale = 160,
            tvFontFamily = "classic-serif",
            widgetFontFamily = "modern-sans",
            compactFontFamily = "system"
        });
        Assert.Equal(HttpStatusCode.NoContent, update.StatusCode);

        var saved = await client!.GetFromJsonAsync<JsonElement>($"/api/v1/design/{organizationId}");
        Assert.Equal(75, saved.GetProperty("tvFontScale").GetInt32());
        Assert.Equal(125, saved.GetProperty("widgetFontScale").GetInt32());
        Assert.Equal(160, saved.GetProperty("compactFontScale").GetInt32());

        var invalidDesign = await client!.PutAsJsonAsync($"/api/v1/design/{organizationId}", new
        {
            iqamaHeadings = Array.Empty<string>(),
            theme = "classic",
            tvFontScale = 77,
            widgetFontScale = 125,
            compactFontScale = 160,
            tvFontFamily = "system",
            widgetFontFamily = "modern-sans",
            compactFontFamily = "system"
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidDesign.StatusCode);

        using var publicClient = factory!.CreateClient();
        var publicDisplay = await publicClient.GetFromJsonAsync<JsonElement>($"/public/display/{organizationSlug}?layout=compact&fontScale=155");
        var publicDesign = publicDisplay.GetProperty("design");
        Assert.Equal(75, publicDesign.GetProperty("tvFontScale").GetInt32());
        Assert.Equal(125, publicDesign.GetProperty("widgetFontScale").GetInt32());
        Assert.Equal(155, publicDesign.GetProperty("compactFontScale").GetInt32());
        var imageUrl = publicDesign.GetProperty("headerImageUrl").GetString()!;
        Assert.StartsWith("https://cdn.example.test/masjid.jpg?", imageUrl);
        Assert.Contains("v=", imageUrl);

        Assert.Equal(HttpStatusCode.BadRequest, (await publicClient.GetAsync($"/public/display/{organizationSlug}?fontScale=74")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await publicClient.GetAsync($"/public/display/{organizationSlug}?theme=neon")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await publicClient.GetAsync($"/public/display/{organizationSlug}?layout=wall")).StatusCode);
    }

    [Fact]
    public async Task Discovery_is_anonymous_and_encodes_names_in_absolute_snippets()
    {
        var update = await client!.PutAsJsonAsync($"/api/v1/orgs/{organizationId}", new
        {
            name = "Mosque <East> & Community",
            addressLine = "1 Main St",
            city = "Austin",
            state = "TX",
            zipCode = "78701",
            phone = "",
            websiteUrl = "",
            email = "",
            socialUrl = ""
        });
        Assert.Equal(HttpStatusCode.NoContent, update.StatusCode);

        using var publicClient = factory!.CreateClient();
        var discovery = await publicClient.GetFromJsonAsync<JsonElement>($"/public/organizations/{organizationSlug}/displays");
        var widget = discovery.GetProperty("displays").GetProperty("widget");
        Assert.StartsWith("https://public.deentime.test/w/", widget.GetProperty("url").GetString());
        var iframe = widget.GetProperty("iframe").GetString()!;
        Assert.Contains("IqamaTime", iframe);
        Assert.Contains("&lt;East&gt;", iframe);
        Assert.Contains("&amp; Community", iframe);
        Assert.DoesNotContain("src=\"/w/", iframe);
        Assert.Equal(75, discovery.GetProperty("supportedParameters").GetProperty("fontScale").GetProperty("min").GetInt32());
        Assert.Equal(HttpStatusCode.OK, (await publicClient.GetAsync($"/public/display/{organizationSlug}")).StatusCode);
    }

    [Fact]
    public async Task Public_display_keeps_saved_iqama_visible_before_adhan_criteria_are_configured()
    {
        var partialOrganizationId = Guid.NewGuid();
        const string partialSlug = "partial-schedule";
        await using (var scope = factory!.Services.CreateAsyncScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            db.Organizations.Add(new Organization
            {
                Id = partialOrganizationId,
                Slug = partialSlug,
                Name = "Partial Schedule Mosque"
            });
            var effectiveDate = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-1);
            db.IqamaEntries.AddRange(
                new IqamaEntry
                {
                    Id = Guid.NewGuid(), OrganizationId = partialOrganizationId, Date = effectiveDate,
                    Salah = SalahType.Fajr, Time = new TimeOnly(6, 15)
                },
                new IqamaEntry
                {
                    Id = Guid.NewGuid(), OrganizationId = partialOrganizationId, Date = effectiveDate,
                    Salah = SalahType.Maghrib, OffsetMinutes = 5
                });
            await db.SaveChangesAsync();
        }

        using var publicClient = factory!.CreateClient();
        var display = await publicClient.GetFromJsonAsync<JsonElement>($"/public/display/{partialSlug}");
        Assert.Equal(JsonValueKind.Null, display.GetProperty("timings").ValueKind);
        var iqama = display.GetProperty("iqama").EnumerateArray().ToArray();
        var fajr = iqama.Single(item => item.GetProperty("salah").GetString() == "Fajr");
        var maghrib = iqama.Single(item => item.GetProperty("salah").GetString() == "Maghrib");
        Assert.Equal("06:15", fajr.GetProperty("time").GetString());
        Assert.Equal(JsonValueKind.Null, maghrib.GetProperty("time").ValueKind);
        Assert.Equal(5, maghrib.GetProperty("offsetMinutes").GetInt32());
    }

    [Fact]
    public async Task Client_credentials_are_scoped_metered_and_revocable()
    {
        using var publicClient = factory!.CreateClient();
        var capabilities = await publicClient.GetFromJsonAsync<JsonElement>("/public/content/capabilities");
        Assert.Equal(
            "/public/content/quran/showcase/ayah/{number}/recitation/{edition}",
            capabilities.GetProperty("quran").GetProperty("showcaseRecitation").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await publicClient.GetAsync("/public/content/hadith/books")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client!.GetAsync("/public/content/hadith/books")).StatusCode);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await client.GetAsync("/public/content/quran/showcase/ayah/0/recitation/ar.alafasy")).StatusCode);

        var create = await client.PostAsJsonAsync($"/api/v1/orgs/{organizationId}/api-clients", new
        {
            name = "External website",
            scopes = new[] { "content:read" },
            requestsPerMinute = 5
        });
        create.EnsureSuccessStatusCode();
        var createJson = await create.Content.ReadAsStringAsync();
        Assert.DoesNotContain("secretHash", createJson, StringComparison.OrdinalIgnoreCase);
        using var created = JsonDocument.Parse(createJson);
        var key = created.RootElement.GetProperty("clientKey").GetString()!;
        Assert.StartsWith("iqt_", key);
        var clientId = created.RootElement.GetProperty("client").GetProperty("id").GetGuid();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/public/content/hadith/books");
        request.Headers.Add("X-IqamaTime-Client-Key", key);
        var authorized = await publicClient.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, authorized.StatusCode);

        using var legacyRequest = new HttpRequestMessage(HttpMethod.Get, "/public/content/hadith/books");
        legacyRequest.Headers.Add("X-DeenTime-Client-Key", key);
        Assert.Equal(HttpStatusCode.OK, (await publicClient.SendAsync(legacyRequest)).StatusCode);

        var revoke = await client!.PostAsync($"/api/v1/orgs/{organizationId}/api-clients/{clientId}/revoke", null);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        using var revokedRequest = new HttpRequestMessage(HttpMethod.Get, "/public/content/hadith/books");
        revokedRequest.Headers.Add("X-IqamaTime-Client-Key", key);
        var revoked = await publicClient.SendAsync(revokedRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
    }

    private sealed class PostalLookupHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
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
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(response, System.Text.Encoding.UTF8, "application/json")
            });
        }
    }
}
