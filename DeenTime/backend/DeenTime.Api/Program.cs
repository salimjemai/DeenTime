using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
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


var b = WebApplication.CreateBuilder(args);

// QuestPDF community license
QuestPDF.Settings.License = LicenseType.Community;

// Serilog
b.Host.UseSerilog((ctx, services, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

b.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(b.Configuration.GetConnectionString("Default")));

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

b.Services.AddAuthorization(opts =>
  {
    opts.AddPolicy("Admin", p => p.RequireClaim("role", "admin", "owner"));
  }
);
b.Services.AddEndpointsApiExplorer().AddSwaggerGen();
b.Services.AddOutputCache(o => {  o.AddPolicy("public-read", p => p.Expire(TimeSpan.FromMinutes(10)));});
b.Services.AddResponseCompression();
b.Services.AddControllers();
b.Services.AddFluentValidationAutoValidation();

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

b.Services.AddCors(o => o.AddPolicy("DeenTimeCors", p => p
  .WithOrigins(b.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [])
  .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));
b.Services.AddRateLimiter(_ => _.AddFixedWindowLimiter("public", o => {
  o.Window = TimeSpan.FromSeconds(5); o.PermitLimit = 60;
}));

// Domain services
b.Services.AddScoped<IPrayerTimeCalculator, IsnaCalculator>();
b.Services.AddScoped<IHijriService, HijriService>();
b.Services.AddScoped<IPasswordHasher, Pbkdf2PasswordHasher>();
b.Services.AddScoped<IPdfGenerator, QuestPdfGenerator>();

// OpenTelemetry (minimal tracing)
b.Services.AddOpenTelemetry().WithTracing(tp =>
{
    tp.AddAspNetCoreInstrumentation();
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

// Seed super user (dev / staging convenience account from appsettings)
await SeedSuperUserAsync(app);

if (app.Environment.IsDevelopment())
{
    app.UseSwagger().UseSwaggerUI();
}

app.UseSerilogRequestLogging();
app.UseResponseCompression();
app.UseCors("DeenTimeCors");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseOutputCache();
app.UseStaticFiles();

if (!string.IsNullOrWhiteSpace(hfConn))
{
    app.UseHangfireDashboard("/jobs");
}

// Endpoints
app.MapControllers();

app.MapGet("/health/live", () => Results.Ok("ok"));
app.MapGet("/health/ready", () => Results.Ok("ready"));

app.Run();

static async Task SeedSuperUserAsync(WebApplication app)
{
    var email    = app.Configuration["SuperUser:Email"];
    var password = app.Configuration["SuperUser:Password"];
    var orgName  = app.Configuration["SuperUser:OrgName"] ?? "Super Org";

    if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password)) return;

    await using var scope  = app.Services.CreateAsyncScope();
    var db                 = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var hasher             = scope.ServiceProvider.GetRequiredService<DeenTime.Core.Services.IPasswordHasher>();
    var cfg                = scope.ServiceProvider.GetRequiredService<IConfiguration>();

    await db.Database.MigrateAsync();

    email = email.Trim().ToLowerInvariant();
    if (await db.AppUsers.AnyAsync(u => u.Email == email)) return;

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
        Name = orgName
    };
    db.Organizations.Add(org);

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
