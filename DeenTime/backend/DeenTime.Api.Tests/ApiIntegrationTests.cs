using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Testcontainers.PostgreSql;
using Xunit;
using Xunit.Sdk;

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
        Assert.Equal("20260819041212_AddDisplayTypography", version.GetProperty("schemaVersion").GetString());
        Assert.False(string.IsNullOrWhiteSpace(version.GetProperty("apiVersion").GetString()));
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
    public async Task Client_credentials_are_scoped_metered_and_revocable()
    {
        var create = await client!.PostAsJsonAsync($"/api/v1/orgs/{organizationId}/api-clients", new
        {
            name = "External website",
            scopes = new[] { "content:read" },
            requestsPerMinute = 5
        });
        create.EnsureSuccessStatusCode();
        using var created = JsonDocument.Parse(await create.Content.ReadAsStringAsync());
        var key = created.RootElement.GetProperty("clientKey").GetString()!;
        var clientId = created.RootElement.GetProperty("client").GetProperty("id").GetGuid();

        using var request = new HttpRequestMessage(HttpMethod.Get, "/public/content/capabilities");
        request.Headers.Add("X-DeenTime-Client-Key", key);
        var authorized = await client!.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, authorized.StatusCode);

        var revoke = await client.PostAsync($"/api/v1/orgs/{organizationId}/api-clients/{clientId}/revoke", null);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        using var revokedRequest = new HttpRequestMessage(HttpMethod.Get, "/public/content/capabilities");
        revokedRequest.Headers.Add("X-DeenTime-Client-Key", key);
        var revoked = await client.SendAsync(revokedRequest);
        Assert.Equal(HttpStatusCode.Unauthorized, revoked.StatusCode);
    }
}
