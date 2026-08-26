using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Security.Claims;
using System.Text;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Mvc;
using Azure.Storage.Blobs;
using DeenTime.Api.Services;
using Serilog;
using OpenTelemetry.Trace;
using Hangfire;
using Hangfire.PostgreSql;
using QuestPDF.Infrastructure;
using DeenTime.Api.Services.IslamicContent;
using System.Net;
using FluentValidation;
using System.Threading.RateLimiting;
using DeenTime.Api.Authorization;


var b = WebApplication.CreateBuilder(args);

// QuestPDF community license
QuestPDF.Settings.License = LicenseType.Community;

// Serilog
b.Host.UseSerilog((ctx, services, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

b.Services.AddDbContextFactory<AppDbContext>(o => o.UseNpgsql(b.Configuration.GetConnectionString("Default")));
b.Services.AddSingleton<DatabaseReadiness>();
b.Services.AddScoped<ApiClientCredentialService>();
b.Services.AddSingleton<LoginAttemptThrottle>();

b.Services.AddOptions<CaptchaOptions>()
  .Bind(b.Configuration.GetSection(CaptchaOptions.SectionName))
  .Validate(options => !options.Enabled ||
      (!string.IsNullOrWhiteSpace(options.SiteKey) && !string.IsNullOrWhiteSpace(options.SecretKey)),
      "Captcha site and secret keys are required when CAPTCHA is enabled.")
  .ValidateOnStart();
b.Services.AddHttpClient<ICaptchaVerifier, TurnstileCaptchaVerifier>(client =>
{
  client.BaseAddress = new Uri("https://challenges.cloudflare.com/");
  client.Timeout = TimeSpan.FromSeconds(10);
});

b.Services.AddOptions<EmailDeliveryOptions>()
  .Bind(b.Configuration.GetSection(EmailDeliveryOptions.SectionName))
  .Validate(options => !options.Enabled ||
      (!string.IsNullOrWhiteSpace(options.Host) && !string.IsNullOrWhiteSpace(options.Username) &&
       !string.IsNullOrWhiteSpace(options.Password) && !string.IsNullOrWhiteSpace(options.FromAddress)),
      "CyberPanel SMTP host, username, password, and sender are required when email delivery is enabled.")
  .ValidateOnStart();
b.Services.AddSingleton<IRegistrationEmailSender, CyberPanelEmailSender>();

b.Services.AddOptions<GooglePlacesOptions>()
  .Bind(b.Configuration.GetSection(GooglePlacesOptions.SectionName))
  .Validate(options => !options.Enabled || !string.IsNullOrWhiteSpace(options.ApiKey),
      "Google Places API key is required when address autocomplete is enabled.")
  .ValidateOnStart();
b.Services.AddHttpClient<GoogleAddressResolver>(client =>
{
  client.BaseAddress = new Uri("https://places.googleapis.com/");
  client.Timeout = TimeSpan.FromSeconds(10);
  client.DefaultRequestHeaders.UserAgent.ParseAdd("IqamaTime/1.0");
});

b.Services.AddOptions<IslamicContentOptions>()
  .Bind(b.Configuration.GetSection(IslamicContentOptions.SectionName))
  .Validate(options =>
      string.Equals(
          options.QuranBaseUrl.TrimEnd('/') + "/",
          IslamicContentOptions.RequiredQuranBaseUrl,
      StringComparison.OrdinalIgnoreCase),
      $"IslamicContent:QuranBaseUrl must use the primary server {IslamicContentOptions.RequiredQuranBaseUrl}")
  .Validate(options =>
      string.Equals(
          options.AlAdhanBaseUrl.TrimEnd('/') + "/",
          IslamicContentOptions.RequiredAlAdhanBaseUrl,
          StringComparison.OrdinalIgnoreCase),
      $"IslamicContent:AlAdhanBaseUrl must use the primary server {IslamicContentOptions.RequiredAlAdhanBaseUrl}")
  .ValidateOnStart();

b.Services.AddMemoryCache(options => options.SizeLimit = 5_000);

b.Services.AddHttpClient<QuranProviderClient>((services, client) =>
  {
    var options = services.GetRequiredService<Microsoft.Extensions.Options.IOptions<IslamicContentOptions>>().Value;
    client.BaseAddress = new Uri(options.QuranBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromMinutes(3);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("DeenTime/1.0");
  })
  .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
  {
    AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
    PooledConnectionLifetime = TimeSpan.FromMinutes(10)
  });

b.Services.AddHttpClient<QiblaProviderClient>((services, client) =>
  {
    var options = services.GetRequiredService<Microsoft.Extensions.Options.IOptions<IslamicContentOptions>>().Value;
    client.BaseAddress = new Uri(options.AlAdhanBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromSeconds(20);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("IqamaTime/1.0");
    client.DefaultRequestHeaders.AcceptEncoding.ParseAdd("gzip");
  })
  .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
  {
    AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
    PooledConnectionLifetime = TimeSpan.FromMinutes(10)
  });

// HadithAPI requires its key in the query string. Remove HttpClient logging so
// request URIs can never place that server-side secret in application logs.
b.Services.AddHttpClient<HadithProviderClient>((services, client) =>
  {
    var options = services.GetRequiredService<Microsoft.Extensions.Options.IOptions<IslamicContentOptions>>().Value;
    client.BaseAddress = new Uri(options.HadithBaseUrl.TrimEnd('/') + "/");
    client.Timeout = TimeSpan.FromMinutes(3);
    client.DefaultRequestHeaders.UserAgent.ParseAdd("DeenTime/1.0");
  })
  .RemoveAllLoggers()
  .ConfigurePrimaryHttpMessageHandler(() => new SocketsHttpHandler
  {
    AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
    PooledConnectionLifetime = TimeSpan.FromMinutes(10)
  });

b.Services.AddHttpClient<PostalCodeResolver>(client =>
{
  client.BaseAddress = new Uri("https://api.zippopotam.us/");
  client.Timeout = TimeSpan.FromSeconds(10);
  client.DefaultRequestHeaders.UserAgent.ParseAdd("IqamaTime/1.0");
});

b.Services.AddSingleton<IIslamicContentSyncQueue, IslamicContentSyncQueue>();
b.Services.AddScoped<IslamicContentSyncService>();
b.Services.AddHostedService<IslamicContentSyncWorker>();

var authAuthority = b.Configuration["Auth:Authority"];
var authAudience  = b.Configuration["Auth:Audience"];
var signingKey    = b.Configuration["Auth:SigningKey"];

var authBuilder = b.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme);
if (!string.IsNullOrWhiteSpace(authAuthority))
{
  authBuilder.AddJwtBearer(o => {
    o.Authority = authAuthority;
    o.Audience  = authAudience;
  });
}
else if (!string.IsNullOrWhiteSpace(signingKey))
{
  if (Encoding.UTF8.GetByteCount(signingKey) < 32)
    throw new InvalidOperationException("Auth:SigningKey must contain at least 32 bytes.");
  authBuilder.AddJwtBearer(o => {
    o.TokenValidationParameters = new TokenValidationParameters
    {
      ValidateIssuer = !string.IsNullOrWhiteSpace(b.Configuration["Auth:Issuer"]),
      ValidIssuer = b.Configuration["Auth:Issuer"],
      ValidateAudience = !string.IsNullOrWhiteSpace(authAudience),
      ValidAudience = authAudience,
      ValidateIssuerSigningKey = true,
      IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(signingKey)),
      ValidateLifetime = true
    };
  });
}
else
{
  throw new InvalidOperationException("Auth:SigningKey or Auth:Authority must be configured before the API can start.");
}

b.Services.AddAuthorization(opts =>
  {
    opts.AddPolicy("Admin", p => p.RequireRole("Admin", "admin", "owner", "SuperUser"));
    opts.AddPolicy("SuperUser", p => p.RequireRole("SuperUser"));
  }
);
b.Services.AddEndpointsApiExplorer().AddSwaggerGen();
b.Services.AddOutputCache(o => {  o.AddPolicy("public-read", p => p.Expire(TimeSpan.FromMinutes(10)));});
b.Services.AddResponseCompression();
b.Services.AddControllers()
  .AddJsonOptions(o =>
  {
    o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter());
    o.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles;
  });
b.Services.AddFluentValidationAutoValidation();
b.Services.AddValidatorsFromAssemblyContaining<DeenTime.Api.Validators.DesignRequestValidator>();

// ProblemDetails for model validation
b.Services.Configure<ApiBehaviorOptions>(o =>
{
  o.InvalidModelStateResponseFactory = ctx =>
  {
    var errs = ctx.ModelState.Where(kvp => kvp.Value?.Errors.Count > 0)
      .ToDictionary(kvp => kvp.Key, kvp => kvp.Value!.Errors.Select(e => e.ErrorMessage).ToArray());
    return new BadRequestObjectResult(new ValidationProblemDetails(errs));
  };
});

// Storage — Azure Blob when configured, local filesystem otherwise
var blobConn = b.Configuration["Storage:ConnectionString"];
if (!string.IsNullOrWhiteSpace(blobConn))
{
  b.Services.AddSingleton(new BlobServiceClient(blobConn));
  b.Services.AddSingleton<IStorageService, AzureBlobStorageService>();
}
else
{
  b.Services.AddHttpContextAccessor();
  b.Services.AddSingleton<IStorageService, LocalStorageService>();
}

b.Services.AddCors(o =>
{
  o.AddPolicy("DeenTimeCors", p => p
    .WithOrigins(b.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials());
  o.AddPolicy("PublicContentApiCors", p => p
    .AllowAnyOrigin()
    .WithMethods("GET", "OPTIONS")
    .WithHeaders("Accept", "Authorization", "Content-Type", "X-IqamaTime-Client-Key", "X-DeenTime-Client-Key")
    .WithExposedHeaders("X-IqamaTime-Source", "X-IqamaTime-Retrieved", "Warning"));
});
b.Services.AddRateLimiter(options =>
{
  options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
  options.AddPolicy("public", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
    _ => new FixedWindowRateLimiterOptions
    {
      Window = TimeSpan.FromSeconds(5), PermitLimit = 60, QueueLimit = 0, AutoReplenishment = true
    }));
  options.AddPolicy("auth-login", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
    _ => new FixedWindowRateLimiterOptions
    {
      Window = TimeSpan.FromMinutes(1), PermitLimit = 10, QueueLimit = 0, AutoReplenishment = true
    }));
  options.AddPolicy("auth-register", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
    _ => new FixedWindowRateLimiterOptions
    {
      Window = TimeSpan.FromMinutes(15), PermitLimit = 5, QueueLimit = 0, AutoReplenishment = true
    }));
  options.AddPolicy("auth-verify", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
    _ => new FixedWindowRateLimiterOptions
    {
      Window = TimeSpan.FromMinutes(5), PermitLimit = 10, QueueLimit = 0, AutoReplenishment = true
    }));
  options.AddPolicy("locations", context => RateLimitPartition.GetFixedWindowLimiter(
    context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
    _ => new FixedWindowRateLimiterOptions
    {
      Window = TimeSpan.FromMinutes(1), PermitLimit = 45, QueueLimit = 0, AutoReplenishment = true
    }));
  options.AddPolicy("expensive", context => RateLimitPartition.GetFixedWindowLimiter(
    $"{context.User.FindFirst("orgId")?.Value}:{context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value}",
    _ => new FixedWindowRateLimiterOptions
    {
      Window = TimeSpan.FromMinutes(10), PermitLimit = 5, QueueLimit = 0, AutoReplenishment = true
    }));
});
b.Services.AddProblemDetails();

// Domain services
b.Services.AddScoped<IPrayerTimeCalculator, IsnaCalculator>();
b.Services.AddScoped<IHijriService, HijriService>();
b.Services.AddScoped<IPasswordHasher, Pbkdf2PasswordHasher>();
b.Services.AddScoped<IPdfGenerator, QuestPdfGenerator>();

// OpenTelemetry (minimal tracing)
b.Services.AddOpenTelemetry().WithTracing(tp =>
{
    tp.AddAspNetCoreInstrumentation();
    if (b.Configuration.GetValue<bool>("OpenTelemetry:ConsoleExporter"))
        tp.AddConsoleExporter();
});

// Hangfire (optional — requires PostgreSQL connection string in Hangfire:ConnectionString)
var hfConn = b.Configuration["Hangfire:ConnectionString"];
if (!string.IsNullOrWhiteSpace(hfConn))
{
    b.Services.AddHangfire(config =>
        config.SetDataCompatibilityLevel(CompatibilityLevel.Version_180)
              .UseSimpleAssemblyNameTypeSerializer()
              .UseRecommendedSerializerSettings()
              .UsePostgreSqlStorage(o => o.UseNpgsqlConnection(hfConn)));
    b.Services.AddHangfireServer();
}

var app = b.Build();

if (string.IsNullOrWhiteSpace(app.Configuration["IslamicContent:HadithApiKey"]))
    app.Logger.LogWarning("Hadith provider is not configured. Set IslamicContent__HadithApiKey through a secret store or environment variable; it will never be returned to clients.");

// Seed super user (dev / staging convenience account from appsettings)
await SeedSuperUserAsync(app);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger().UseSwaggerUI();
}

app.UseSerilogRequestLogging();
app.UseMiddleware<CorrelationIdMiddleware>();
app.Use(async (context, next) =>
{
  context.Response.Headers["X-Content-Type-Options"] = "nosniff";
  context.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
  context.Response.Headers["X-Frame-Options"] = "DENY";
  if (context.Request.Path.StartsWithSegments("/tv") ||
      context.Request.Path.StartsWithSegments("/w") ||
      context.Request.Path.StartsWithSegments("/w2"))
  {
    context.Response.Headers.Remove("X-Frame-Options");
    context.Response.Headers["Content-Security-Policy"] = "frame-ancestors *";
  }
  await next();
});
app.UseResponseCompression();
app.UseWhen(
  context => context.Request.Path.StartsWithSegments("/public/content"),
  branch => branch.UseCors("PublicContentApiCors"));
app.UseWhen(
  context => !context.Request.Path.StartsWithSegments("/public/content"),
  branch => branch.UseCors("DeenTimeCors"));
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.UseOutputCache();
app.UseStaticFiles();

if (!string.IsNullOrWhiteSpace(hfConn))
{
    app.UseHangfireDashboard("/jobs", new DashboardOptions
    {
        Authorization = [new HangfireSuperUserAuthorizationFilter()]
    });
}

// Endpoints
app.MapControllers();

app.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
app.MapGet("/health/ready", async (DatabaseReadiness readiness, CancellationToken cancellationToken) =>
{
    var result = await readiness.CheckAsync(cancellationToken);
    return result.Ready
        ? Results.Ok(result)
        : Results.Json(result, statusCode: StatusCodes.Status503ServiceUnavailable);
});
app.MapGet("/api/version", (IConfiguration configuration) => Results.Ok(BuildInfoProvider.Create(configuration)));

app.Run();

static async Task SeedSuperUserAsync(WebApplication app)
{
    var email    = app.Configuration["SuperUser:Email"];
    var password = app.Configuration["SuperUser:Password"];
    var orgName  = app.Configuration["SuperUser:OrgName"] ?? "Super Org";

    await using var scope  = app.Services.CreateAsyncScope();
    var db                 = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var hasher             = scope.ServiceProvider.GetRequiredService<DeenTime.Core.Services.IPasswordHasher>();
    var cfg                = scope.ServiceProvider.GetRequiredService<IConfiguration>();

    await db.Database.MigrateAsync();

    var organizations = await db.Organizations.ToArrayAsync();
    var adminMemberships = await db.OrgUsers
        .AsNoTracking()
        .Where(membership => membership.Roles.Contains("Admin"))
        .OrderBy(membership => membership.Id)
        .ToArrayAsync();
    foreach (var organization in organizations)
    {
        organization.AdminUserId ??= adminMemberships
            .FirstOrDefault(membership => membership.OrganizationId == organization.Id)?.Subject;
        BackfillOrganizationIdentity(organization);
    }
    await db.SaveChangesAsync();

    if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password)) return;

    email = email.Trim().ToLowerInvariant();
    var existingUser = await db.AppUsers.FirstOrDefaultAsync(u => u.Email == email);
    if (existingUser is not null)
    {
        var existingOrganizations = await db.OrgUsers
            .Where(membership => membership.Subject == existingUser.Id)
            .Include(membership => membership.Organization)
            .Select(membership => membership.Organization)
            .ToArrayAsync();
        foreach (var existingOrganization in existingOrganizations)
        {
            if (existingOrganization is null) continue;
            existingOrganization.AdminUserId ??= existingUser.Id;
            BackfillOrganizationIdentity(existingOrganization);
        }
        await db.SaveChangesAsync();
        return;
    }

    var (hash, salt) = hasher.HashPassword(password);
    var user = new DeenTime.Core.Entities.AppUser
    {
        Id = Guid.NewGuid().ToString(),
        Email = email,
        DisplayName = "Super User",
        PasswordHash = hash,
        PasswordSalt = salt
    };
    db.AppUsers.Add(user);

    var org = new DeenTime.Core.Entities.Organization
    {
        Id   = Guid.NewGuid(),
        Slug = "admin",
        Name = orgName,
        NormalizedName = RegistrationIdentityNormalizer.NormalizeWords(orgName),
        AddressLine = app.Configuration["SuperUser:AddressLine"],
        City        = app.Configuration["SuperUser:City"],
        State       = app.Configuration["SuperUser:State"],
        ZipCode     = app.Configuration["SuperUser:ZipCode"],
        Phone       = app.Configuration["SuperUser:Phone"],
        Email       = app.Configuration["SuperUser:OrgEmail"],
        WebsiteUrl  = app.Configuration["SuperUser:WebsiteUrl"],
        SocialUrl   = app.Configuration["SuperUser:SocialUrl"],
        AdminUserId = user.Id,
    };
    BackfillOrganizationIdentity(org);
    db.Organizations.Add(org);

    // ── Seed default prayer timing criteria ───────────────────────────────
    var lat  = app.Configuration["SuperUser:Latitude"];
    var lng  = app.Configuration["SuperUser:Longitude"];
    var tzId = app.Configuration["SuperUser:TimezoneId"] ?? "America/Chicago";

    if (!string.IsNullOrWhiteSpace(lat) && !string.IsNullOrWhiteSpace(lng))
    {
        db.PrayerTimingCriteria.Add(new DeenTime.Core.Entities.PrayerTimingCriteria
        {
            Id                 = Guid.NewGuid(),
            OrganizationId     = org.Id,
            Method             = app.Configuration["SuperUser:Method"] ?? "ISNA",
            JuristicMethodAsr  = app.Configuration["SuperUser:JuristicMethodAsr"] ?? "Other",
            Latitude           = decimal.Parse(lat),
            Longitude          = decimal.Parse(lng),
            TimezoneId         = tzId,
            DstObserved        = true,
            ZipCode            = org.ZipCode ?? "",
            MinutesAfterZawal  = int.TryParse(app.Configuration["SuperUser:MinutesAfterZawal"], out var maz) ? maz : 5,
            MinutesAfterMaghrib = int.TryParse(app.Configuration["SuperUser:MinutesAfterMaghrib"], out var mam) ? mam : 1,
            KhutbahTimeMinutes = int.TryParse(app.Configuration["SuperUser:KhutbahTimeMinutes"], out var kt) ? kt : 20,
        });
    }

    // ── Seed default design settings ──────────────────────────────────────
    db.DesignSettings.Add(new DeenTime.Core.Entities.DesignSettings
    {
        Id              = Guid.NewGuid(),
        OrganizationId  = org.Id,
        IqamaHeadings   = new[] { "FAJR", "IQM*", "SUNRISE", "DUHUR", "IQM*", "ASR", "IQM*", "SUNSET", "ISHA", "IQM*" },
        FooterHtml      = $"© {DateTime.UtcNow.Year} {orgName} · IqamaTime",
        Theme           = "default",
    });

    db.OrgUsers.Add(new DeenTime.Core.Entities.OrgUser
    {
        Id             = Guid.NewGuid(),
        OrganizationId = org.Id,
        Issuer         = cfg["Auth:Issuer"] ?? "local",
        Subject        = user.Id,
        Email          = email,
        DisplayName    = user.DisplayName,
        Roles          = new[] { "Admin", "SuperUser" }
    });

    await db.SaveChangesAsync();
    app.Logger.LogInformation("Super user seeded: {Email}", email);
}

static void BackfillOrganizationIdentity(DeenTime.Core.Entities.Organization organization)
{
    organization.NormalizedName = RegistrationIdentityNormalizer.NormalizeWords(organization.Name);
    if (string.IsNullOrWhiteSpace(organization.WebsiteUrl) ||
        string.IsNullOrWhiteSpace(organization.AddressLine) ||
        string.IsNullOrWhiteSpace(organization.City) ||
        string.IsNullOrWhiteSpace(organization.State) ||
        string.IsNullOrWhiteSpace(organization.ZipCode))
        return;

    if (!RegistrationIdentityNormalizer.TryCreate(
            organization.Email ?? string.Empty,
            organization.Name,
            organization.WebsiteUrl,
            organization.AddressLine,
            organization.City,
            organization.State,
            organization.ZipCode,
            out var identity) || identity is null)
        return;

    organization.NormalizedWebsiteHost = identity.WebsiteHost;
    organization.AddressFingerprint = identity.AddressFingerprint;
    organization.MasjidIdentityKey = identity.MasjidIdentityKey;
}

public partial class Program { }
