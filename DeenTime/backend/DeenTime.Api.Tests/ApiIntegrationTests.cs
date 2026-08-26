using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Npgsql;
using Xunit;
using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Infrastructure;
using DeenTime.Api.Services;
using DeenTime.Api.Services.IslamicContent;

namespace DeenTime.Api.Tests;

public sealed class ApiIntegrationTests : IAsyncLifetime
{
    private const string Password = "TestOnly-Password-1234";
    private readonly string databaseName = $"deentime_test_{Guid.NewGuid():N}";
    private string adminConnectionString = "";
    private string databaseConnectionString = "";
    private WebApplicationFactory<Program>? factory;
    private HttpClient? client;
    private readonly CapturingRegistrationEmailSender registrationEmailSender = new();
    private string organizationId = "";
    private string organizationSlug = "";

    public async Task InitializeAsync()
    {
        adminConnectionString = Environment.GetEnvironmentVariable("DEENTIME_TEST_POSTGRES_ADMIN")
            ?? "Host=127.0.0.1;Port=5432;Database=postgres;Username=postgres;Password=postgres;Pooling=false";
        var adminBuilder = new NpgsqlConnectionStringBuilder(adminConnectionString)
        {
            Database = "postgres",
            Pooling = false
        };
        adminConnectionString = adminBuilder.ConnectionString;

        await using (var admin = new NpgsqlConnection(adminConnectionString))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{databaseName}\"";
            await create.ExecuteNonQueryAsync();
        }

        var databaseBuilder = new NpgsqlConnectionStringBuilder(adminConnectionString)
        {
            Database = databaseName,
            Pooling = false
        };
        databaseConnectionString = databaseBuilder.ConnectionString;

        factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Testing");
            builder.UseSetting("ConnectionStrings:Default", databaseConnectionString);
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
                ["ConnectionStrings:Default"] = databaseConnectionString,
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
                services.RemoveAll<IRegistrationEmailSender>();
                services.AddSingleton<IRegistrationEmailSender>(registrationEmailSender);
                services.RemoveAll<QiblaProviderClient>();
                services.AddSingleton(new QiblaProviderClient(
                    new HttpClient(new QiblaLookupHandler())
                    {
                        BaseAddress = new Uri(IslamicContentOptions.RequiredAlAdhanBaseUrl)
                    },
                    new MemoryCache(new MemoryCacheOptions { SizeLimit = 100 }),
                    Options.Create(new IslamicContentOptions())));
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

        if (string.IsNullOrWhiteSpace(adminConnectionString)) return;

        NpgsqlConnection.ClearAllPools();
        await using var admin = new NpgsqlConnection(adminConnectionString);
        await admin.OpenAsync();
        await using (var terminate = admin.CreateCommand())
        {
            terminate.CommandText = "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @databaseName AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("databaseName", databaseName);
            await terminate.ExecuteNonQueryAsync();
        }
        await using (var drop = admin.CreateCommand())
        {
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{databaseName}\"";
            await drop.ExecuteNonQueryAsync();
        }
    }

    [Fact]
    public async Task Readiness_and_version_report_the_current_stack()
    {
        var readiness = await client!.GetAsync("/health/ready");
        Assert.Equal(HttpStatusCode.OK, readiness.StatusCode);
        using var readinessBody = JsonDocument.Parse(await readiness.Content.ReadAsStringAsync());
        Assert.Equal("ready", readinessBody.RootElement.GetProperty("status").GetString());

        var version = await client.GetFromJsonAsync<JsonElement>("/api/version");
        Assert.Equal("20260823092555_AddMasjidInvitations", version.GetProperty("schemaVersion").GetString());
        Assert.False(string.IsNullOrWhiteSpace(version.GetProperty("apiVersion").GetString()));
    }

    [Fact]
    public async Task Registration_verifies_email_creates_one_admin_and_blocks_duplicate_masjid()
    {
        using var anonymous = factory!.CreateClient();
        var registration = await anonymous.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = "new-admin@masjid.test",
            password = "A-strong-test-password-1234",
            confirmPassword = "A-strong-test-password-1234",
            organizationName = "Cedar Park Test Masjid",
            websiteUrl = "https://www.cedar-park-test.example/about",
            addressLine = "123 Masjid Way",
            city = "Cedar Park",
            state = "TX",
            zipCode = "78613"
        });
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);
        Assert.NotNull(registrationEmailSender.LastVerificationUrl);

        var verificationUri = new Uri(registrationEmailSender.LastVerificationUrl!);
        var token = Uri.UnescapeDataString(verificationUri.Query["?token=".Length..]);
        var verify = await anonymous.PostAsJsonAsync("/api/v1/auth/verify-email", new { token });
        verify.EnsureSuccessStatusCode();
        using var verifyBody = JsonDocument.Parse(await verify.Content.ReadAsStringAsync());
        var adminToken = verifyBody.RootElement.GetProperty("token").GetString();

        using var masjidAdmin = factory.CreateClient();
        masjidAdmin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", adminToken);
        var organizations = await masjidAdmin.GetFromJsonAsync<JsonElement>("/api/v1/orgs?page=1");
        Assert.Equal(1, organizations.GetProperty("total").GetInt32());
        var ownOrganizationId = organizations.GetProperty("items")[0].GetProperty("id").GetGuid();
        Assert.NotEqual(Guid.Parse(organizationId), ownOrganizationId);

        var criteria = await masjidAdmin.GetFromJsonAsync<JsonElement>($"/api/v1/orgs/{ownOrganizationId}/criteria");
        Assert.Equal("78613", criteria.GetProperty("zipCode").GetString());
        Assert.Equal(30.5052m, criteria.GetProperty("latitude").GetDecimal());
        Assert.Equal(-97.8203m, criteria.GetProperty("longitude").GetDecimal());

        Assert.Equal(HttpStatusCode.Forbidden, (await masjidAdmin.GetAsync($"/api/v1/orgs/{organizationId}")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await masjidAdmin.GetAsync($"/api/v1/orgs/{organizationId}/criteria")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await masjidAdmin.GetAsync("/api/v1/islamic-content/summary")).StatusCode);

        var duplicate = await anonymous.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = "different-admin@masjid.test",
            password = "A-different-test-password-1234",
            confirmPassword = "A-different-test-password-1234",
            organizationName = "Cedar Park Test Masjid",
            websiteUrl = "https://cedar-park-test.example",
            addressLine = "123 Masjid Way",
            city = "Cedar Park",
            state = "TX",
            zipCode = "78613"
        });
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);
    }

    [Fact]
    public async Task Registration_rejects_invalid_email_and_weak_password_and_allows_public_zip_lookup()
    {
        using var anonymous = factory!.CreateClient();
        var location = await anonymous.GetFromJsonAsync<JsonElement>("/api/v1/locations/postal-code/78613");
        Assert.Equal("Cedar Park", location.GetProperty("city").GetString());
        Assert.Equal("TX", location.GetProperty("stateAbbreviation").GetString());

        var invalidEmail = await anonymous.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = "not-an-email",
            password = "A-strong-test-password-1234",
            confirmPassword = "A-strong-test-password-1234",
            organizationName = "Invalid Email Masjid",
            websiteUrl = "https://invalid-email.example",
            addressLine = "100 Test Way",
            city = "Cedar Park",
            state = "TX",
            zipCode = "78613"
        });
        Assert.Equal(HttpStatusCode.BadRequest, invalidEmail.StatusCode);

        var weakPassword = await anonymous.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = "weak-password@masjid.test",
            password = "alllowercasepassword",
            confirmPassword = "alllowercasepassword",
            organizationName = "Weak Password Masjid",
            websiteUrl = "https://weak-password.example",
            addressLine = "101 Test Way",
            city = "Cedar Park",
            state = "TX",
            zipCode = "78613"
        });
        Assert.Equal(HttpStatusCode.BadRequest, weakPassword.StatusCode);
    }

    [Fact]
    public async Task Super_user_invites_masjid_and_tracks_registration_and_email_verification()
    {
        var invite = await client!.PostAsJsonAsync("/api/v1/admin/masjids/invitations", new
        {
            email = "invited-admin@masjid.test",
            organizationName = "Invited Test Masjid",
            websiteUrl = "https://invited-test.example",
            addressLine = "456 Invitation Lane",
            city = "Cedar Park",
            state = "TX",
            zipCode = "78613"
        });
        Assert.Equal(HttpStatusCode.Created, invite.StatusCode);
        Assert.NotNull(registrationEmailSender.LastInvitationUrl);

        var invitationUri = new Uri(registrationEmailSender.LastInvitationUrl!);
        var invitationToken = Uri.UnescapeDataString(invitationUri.Query["?invite=".Length..]);
        using var anonymous = factory!.CreateClient();
        var prefill = await anonymous.GetFromJsonAsync<JsonElement>($"/api/v1/auth/invitations/{Uri.EscapeDataString(invitationToken)}");
        Assert.Equal("invited-admin@masjid.test", prefill.GetProperty("email").GetString());
        Assert.Equal("Invited Test Masjid", prefill.GetProperty("organizationName").GetString());

        var registration = await anonymous.PostAsJsonAsync("/api/v1/auth/register", new
        {
            email = "invited-admin@masjid.test",
            password = "An-invited-test-password-1234",
            confirmPassword = "An-invited-test-password-1234",
            organizationName = "Invited Test Masjid",
            websiteUrl = "https://invited-test.example",
            addressLine = "456 Invitation Lane",
            city = "Cedar Park",
            state = "TX",
            zipCode = "78613",
            invitationToken
        });
        Assert.Equal(HttpStatusCode.Accepted, registration.StatusCode);

        var dashboardBeforeVerification = await client!.GetFromJsonAsync<JsonElement>("/api/v1/admin/masjids");
        var invitedBeforeVerification = dashboardBeforeVerification.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("email").GetString() == "invited-admin@masjid.test");
        Assert.Equal("AwaitingEmailVerification", invitedBeforeVerification.GetProperty("status").GetString());

        var verificationUri = new Uri(registrationEmailSender.LastVerificationUrl!);
        var verificationToken = Uri.UnescapeDataString(verificationUri.Query["?token=".Length..]);
        var verify = await anonymous.PostAsJsonAsync("/api/v1/auth/verify-email", new { token = verificationToken });
        verify.EnsureSuccessStatusCode();
        using var verifyBody = JsonDocument.Parse(await verify.Content.ReadAsStringAsync());
        var masjidAdminToken = verifyBody.RootElement.GetProperty("token").GetString();

        var dashboardAfterVerification = await client!.GetFromJsonAsync<JsonElement>("/api/v1/admin/masjids");
        var invitedAfterVerification = dashboardAfterVerification.GetProperty("items").EnumerateArray()
            .Single(item => item.GetProperty("email").GetString() == "invited-admin@masjid.test");
        Assert.Equal("Registered", invitedAfterVerification.GetProperty("status").GetString());
        Assert.Equal("Invitation", invitedAfterVerification.GetProperty("source").GetString());
        Assert.NotEqual(Guid.Empty, invitedAfterVerification.GetProperty("organizationId").GetGuid());

        using var masjidAdmin = factory.CreateClient();
        masjidAdmin.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", masjidAdminToken);
        Assert.Equal(HttpStatusCode.Forbidden, (await masjidAdmin.GetAsync("/api/v1/admin/masjids")).StatusCode);
    }

    [Fact]
    public async Task Header_upload_rejects_spoofed_image_content()
    {
        using var content = new MultipartFormDataContent();
        var fakeImage = new ByteArrayContent("<script>alert('not an image')</script>"u8.ToArray());
        fakeImage.Headers.ContentType = new("image/png");
        content.Add(fakeImage, "file", "header.png");

        var response = await client!.PostAsync($"/api/v1/design/files/header-image?orgId={organizationId}", content);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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
        Assert.Contains($"/w/{organizationSlug}/daily", embed.GetProperty("dailyWidgetUrl").GetString());
        Assert.Contains($"/w/{organizationSlug}/jumuah", embed.GetProperty("jumuahWidgetUrl").GetString());
        Assert.Contains($"/w/{organizationSlug}/daily", WebUtility.HtmlDecode(embed.GetProperty("dailyIframe").GetString()!));
        Assert.Contains($"/w/{organizationSlug}/jumuah", WebUtility.HtmlDecode(embed.GetProperty("jumuahIframe").GetString()!));
        Assert.Contains("data-iqamatime-auto-height", iframe);
        Assert.Contains("/iqamatime-embed.js", iframe);

        var dynamicEmbed = await client!.GetFromJsonAsync<JsonElement>(
            $"/api/v1/publish/embed-code/{organizationId}?publicOrigin=https%3A%2F%2Fiqamatime.example");
        var dynamicIframe = dynamicEmbed.GetProperty("iframe").GetString()!;
        Assert.Contains("src=\"https://iqamatime.example/w/", dynamicIframe);
        Assert.DoesNotContain("public.deentime.test", dynamicIframe);
        Assert.StartsWith("https://iqamatime.example/w/", dynamicEmbed.GetProperty("dailyWidgetUrl").GetString());
        Assert.StartsWith("https://iqamatime.example/w/", dynamicEmbed.GetProperty("jumuahWidgetUrl").GetString());
        Assert.Contains("https://iqamatime.example/iqamatime-embed.js", dynamicIframe);
    }

    [Fact]
    public async Task Tv_clock_scale_is_saved_independently_and_bounded()
    {
        var defaults = await client!.GetFromJsonAsync<JsonElement>($"/api/v1/publish/tv-config/{organizationId}");
        Assert.Equal(160, defaults.GetProperty("clockFontScale").GetInt32());

        var savedResponse = await client!.PutAsJsonAsync($"/api/v1/publish/tv-config/{organizationId}", new
        {
            id = "",
            organizationId,
            showSeconds = true,
            showHijri = true,
            accentColor = "#00AEEF",
            clockFontScale = 250,
            autoRefreshSeconds = 30
        });
        savedResponse.EnsureSuccessStatusCode();
        using var savedBody = JsonDocument.Parse(await savedResponse.Content.ReadAsStringAsync());
        Assert.Equal(200, savedBody.RootElement.GetProperty("clockFontScale").GetInt32());

        var display = await client!.GetFromJsonAsync<JsonElement>($"/public/display/{organizationSlug}?layout=tv");
        Assert.Equal(200, display.GetProperty("tvConfig").GetProperty("clockFontScale").GetInt32());
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
        Assert.EndsWith("/daily", discovery.GetProperty("displays").GetProperty("daily").GetProperty("url").GetString());
        Assert.EndsWith("/jumuah", discovery.GetProperty("displays").GetProperty("jumuah").GetProperty("url").GetString());
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
        var qiblaCapabilities = capabilities.GetProperty("qibla");
        Assert.Equal(
            "https://api.aladhan.com/v1",
            qiblaCapabilities.GetProperty("selectedUpstreamServer").GetString());
        Assert.Equal("3.1.0", qiblaCapabilities.GetProperty("openApiVersion").GetString());
        Assert.Equal(2, qiblaCapabilities.GetProperty("routes").GetArrayLength());
        Assert.Equal(HttpStatusCode.OK, (await publicClient.GetAsync("/public/content/qibla/metadata")).StatusCode);
        using (var preflight = new HttpRequestMessage(HttpMethod.Options, "/public/content/qibla/30.5052/-97.8203"))
        {
            preflight.Headers.Add("Origin", "https://masjid.example");
            preflight.Headers.Add("Access-Control-Request-Method", "GET");
            preflight.Headers.Add("Access-Control-Request-Headers", "Authorization, X-IqamaTime-Client-Key");
            var preflightResponse = await publicClient.SendAsync(preflight);
            Assert.Equal(HttpStatusCode.NoContent, preflightResponse.StatusCode);
            Assert.Contains("*", preflightResponse.Headers.GetValues("Access-Control-Allow-Origin"));
            Assert.Contains(
                "X-IqamaTime-Client-Key",
                preflightResponse.Headers.GetValues("Access-Control-Allow-Headers").Single(),
                StringComparison.OrdinalIgnoreCase);
            Assert.Contains(
                "Authorization",
                preflightResponse.Headers.GetValues("Access-Control-Allow-Headers").Single(),
                StringComparison.OrdinalIgnoreCase);
        }
        Assert.Equal(
            HttpStatusCode.Unauthorized,
            (await publicClient.GetAsync("/public/content/qibla/30.5052/-97.8203")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await publicClient.GetAsync("/public/content/hadith/books")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client!.GetAsync("/public/content/hadith/books")).StatusCode);
        var qibla = await client.GetFromJsonAsync<JsonElement>("/public/content/qibla/30.5052/-97.8203");
        Assert.Equal(43.36991455214116, qibla.GetProperty("data").GetProperty("direction").GetDouble(), 10);
        Assert.Equal("degrees", qibla.GetProperty("data").GetProperty("directionUnit").GetString());
        Assert.EndsWith(
            "/public/content/qibla/30.5052/-97.8203/compass",
            qibla.GetProperty("data").GetProperty("compassUrl").GetString());
        var compass = await client.GetAsync("/public/content/qibla/30.5052/-97.8203/compass");
        Assert.Equal(HttpStatusCode.OK, compass.StatusCode);
        Assert.Equal("image/png", compass.Content.Headers.ContentType?.MediaType);
        Assert.Equal(
            HttpStatusCode.BadRequest,
            (await client.GetAsync("/public/content/qibla/91/0")).StatusCode);
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

    private sealed class CapturingRegistrationEmailSender : IRegistrationEmailSender
    {
        public string? LastVerificationUrl { get; private set; }
        public string? LastInvitationUrl { get; private set; }

        public Task SendVerificationAsync(string email, string organizationName, string verificationUrl, CancellationToken cancellationToken)
        {
            LastVerificationUrl = verificationUrl;
            return Task.CompletedTask;
        }

        public Task SendInvitationAsync(string email, string organizationName, string invitationUrl, CancellationToken cancellationToken)
        {
            LastInvitationUrl = invitationUrl;
            return Task.CompletedTask;
        }
    }

    private sealed class QiblaLookupHandler : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (request.RequestUri?.AbsolutePath.EndsWith("/compass", StringComparison.OrdinalIgnoreCase) == true)
            {
                byte[] png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
                var image = new ByteArrayContent(png);
                image.Headers.ContentType = new("image/png");
                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = image });
            }

            const string response = """
                {
                  "code": 200,
                  "status": "OK",
                  "data": {
                    "latitude": 30.5052,
                    "longitude": -97.8203,
                    "direction": 43.36991455214116
                  }
                }
                """;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(response, System.Text.Encoding.UTF8, "application/json")
            });
        }
    }
}
