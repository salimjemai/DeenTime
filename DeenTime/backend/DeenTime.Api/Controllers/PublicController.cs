using DeenTime.Contracts.Timings;
using DeenTime.Core.Entities;
using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;

namespace DeenTime.Api.Controllers;

[ApiController]
[Route("public")]
public sealed class PublicController : ControllerBase
{
    private static readonly string[] SupportedThemes = ["default", "dark", "classic"];
    private static readonly string[] SupportedLayouts = ["tv", "widget", "compact"];
    private readonly AppDbContext _db;
    private readonly IPrayerTimeCalculator _calculator;
    private readonly IConfiguration _configuration;

    public PublicController(AppDbContext db, IPrayerTimeCalculator calculator, IConfiguration configuration)
    {
        _db = db;
        _calculator = calculator;
        _configuration = configuration;
    }

    [HttpGet("display/{slug}")]
    public async Task<IActionResult> Display(
        string slug,
        [FromQuery] string? locale = null,
        [FromQuery] string? theme = null,
        [FromQuery] int? fontScale = null,
        [FromQuery] string? layout = null)
    {
        var parameterError = ValidateDisplayParameters(locale, theme, fontScale, layout);
        if (parameterError is not null) return parameterError;

        var org = await _db.Organizations
            .AsNoTracking()
            .Include(o => o.Criteria)
            .Include(o => o.Design)
            .FirstOrDefaultAsync(o => o.Slug == slug);

        if (org?.Criteria is null) return NotFound();

        var timezone = TimeZoneInfo.FindSystemTimeZoneById(org.Criteria.TimezoneId);
        var localNow = TimeZoneInfo.ConvertTime(DateTime.UtcNow, timezone);
        var date = DateOnly.FromDateTime(localNow);
        var timings = _calculator.Compute(org.Criteria, date);

        var iqamaHistory = await _db.IqamaEntries
            .AsNoTracking()
            .Where(i => i.OrganizationId == org.Id && i.Date <= date)
            .OrderBy(i => i.Date)
            .ToListAsync();
        var iqama = iqamaHistory
            .GroupBy(i => i.Salah)
            .Select(group => group.Last())
            .OrderBy(i => i.Time)
            .ThenBy(i => i.Salah)
            .Select(i => new
            {
                salah = i.Salah.ToString(),
                time = ResolveIqamaTime(i, timings).ToString("HH:mm"),
                salahTime = i.Salah.ToString().StartsWith("Jumuah", StringComparison.Ordinal)
                    ? ResolveIqamaTime(i, timings).AddMinutes(org.Criteria.KhutbahTimeMinutes).ToString("HH:mm")
                    : null,
                note = i.OffsetMinutes.HasValue ? $"+{i.OffsetMinutes} minutes" : i.Note,
                effectiveDate = i.Date
            })
            .ToArray();

        var hijri = await _db.HijriMonthMaps
            .AsNoTracking()
            .FirstOrDefaultAsync(h => h.OrganizationId == org.Id && h.Year == date.Year && h.Month == date.Month);

        var tvConfig = await _db.TvDisplayConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.OrganizationId == org.Id)
            ?? new TvDisplayConfig { OrganizationId = org.Id };

        var monthlyPdfUrl = await _db.PublishArtifacts
            .AsNoTracking()
            .Where(p => p.OrganizationId == org.Id && p.Year == date.Year && p.Month == date.Month)
            .OrderByDescending(p => p.CreatedAtUtc)
            .Select(p => p.StorageUrl)
            .FirstOrDefaultAsync();

        var savedDesign = org.Design;
        var savedTheme = NormalizeTheme(savedDesign?.Theme);
        var displayDesign = new
        {
            headerImageUrl = VersionedAssetUrl(savedDesign?.HeaderImageUrl, savedDesign?.UpdatedAtUtc),
            backgroundImageUrl = VersionedAssetUrl(savedDesign?.HeaderImageUrl, savedDesign?.UpdatedAtUtc),
            iqamaHeadings = savedDesign?.IqamaHeadings ?? Array.Empty<string>(),
            footerHtml = savedDesign?.FooterHtml,
            theme = theme is null ? savedTheme : NormalizeTheme(theme),
            tvFontScale = EffectiveScale(savedDesign?.TvFontScale ?? 100, "tv", layout, fontScale),
            widgetFontScale = EffectiveScale(savedDesign?.WidgetFontScale ?? 100, "widget", layout, fontScale),
            compactFontScale = EffectiveScale(savedDesign?.CompactFontScale ?? 100, "compact", layout, fontScale),
            tvFontFamily = NormalizeFontFamily(savedDesign?.TvFontFamily),
            widgetFontFamily = NormalizeFontFamily(savedDesign?.WidgetFontFamily),
            compactFontFamily = NormalizeFontFamily(savedDesign?.CompactFontFamily),
            locale = locale ?? "en-US"
        };

        return Ok(new
        {
            organization = new { org.Name, org.Slug, org.AddressLine, org.City, org.State },
            date,
            timezoneId = org.Criteria.TimezoneId,
            timings,
            iqama,
            monthlyPdfUrl,
            design = displayDesign,
            hijri = BuildHijriDate(hijri, date),
            tvConfig = new
            {
                tvConfig.ShowSeconds,
                tvConfig.ShowHijri,
                tvConfig.AccentColor,
                tvConfig.AutoRefreshSeconds
            }
        });
    }

    [HttpGet("organizations/{slug}/displays")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> DiscoverDisplays(string slug)
    {
        var org = await _db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Slug == slug);
        if (org is null) return NotFound();

        var origin = PublicOrigin();
        var tvUrl = AbsoluteRoute(origin, $"/tv/{Uri.EscapeDataString(org.Slug)}");
        var widgetUrl = AbsoluteRoute(origin, $"/w/{Uri.EscapeDataString(org.Slug)}");
        var compactUrl = AbsoluteRoute(origin, $"/w2/{Uri.EscapeDataString(org.Slug)}");
        var encodedTitle = WebUtility.HtmlEncode($"IqamaTime · {org.Name} prayer times");

        return Ok(new
        {
            organization = new { org.Name, org.Slug },
            displays = new
            {
                tv = new { url = tvUrl, iframe = Iframe(tvUrl, encodedTitle, "100%", "720") },
                widget = new { url = widgetUrl, iframe = Iframe(widgetUrl, encodedTitle, "390", "920") },
                compact = new { url = compactUrl, iframe = Iframe(compactUrl, encodedTitle, "330", "820") }
            },
            supportedParameters = new
            {
                locale = new[] { "en-US", "ar", "ur" },
                theme = SupportedThemes,
                fontScale = new { min = 75, max = 160, step = 5 },
                layout = SupportedLayouts
            },
            defaults = new { theme = "default", fontScale = 100, locale = "en-US" },
            provider = "IqamaTime"
        });
    }

    [HttpGet("widget/{slug}")]
    public IActionResult Widget(string slug) => RedirectToFrontend($"/w/{Uri.EscapeDataString(slug)}");

    [HttpGet("tv/{slug}")]
    public IActionResult Tv(string slug) => RedirectToFrontend($"/tv/{Uri.EscapeDataString(slug)}");

    [HttpGet("/clock")]
    public IActionResult LegacyClock([FromQuery] string masjid) => RedirectToFrontend($"/tv/{Uri.EscapeDataString(masjid)}");

    [HttpGet("/iqama-widget.php")]
    [HttpGet("/iqama-widget2.php")]
    public IActionResult LegacyWidget()
    {
        var parts = (Request.QueryString.Value ?? string.Empty).Split('?', StringSplitOptions.RemoveEmptyEntries);
        var slug = parts.Length >= 2 ? parts[1] : Request.Query["masjid"].ToString();
        var compact = Request.Path.Value?.Contains("widget2", StringComparison.OrdinalIgnoreCase) == true;
        return string.IsNullOrWhiteSpace(slug)
            ? BadRequest("Missing organization slug")
            : RedirectToFrontend($"/{(compact ? "w2" : "w")}/{Uri.EscapeDataString(slug)}");
    }

    private IActionResult RedirectToFrontend(string path) => Redirect(AbsoluteRoute(PublicOrigin(), path));

    private Uri PublicOrigin()
    {
        var configured = _configuration["Frontend:PublicBaseUrl"];
        if (Uri.TryCreate(configured, UriKind.Absolute, out var configuredUri) &&
            (configuredUri.Scheme == Uri.UriSchemeHttp || configuredUri.Scheme == Uri.UriSchemeHttps))
            return EnsureProductionScheme(configuredUri);

        var forwardedProto = Request.Headers["X-Forwarded-Proto"].FirstOrDefault()?.Split(',')[0].Trim();
        var forwardedHost = Request.Headers["X-Forwarded-Host"].FirstOrDefault()?.Split(',')[0].Trim();
        var scheme = string.IsNullOrWhiteSpace(forwardedProto) ? Request.Scheme : forwardedProto;
        if (!string.Equals(scheme, "https", StringComparison.OrdinalIgnoreCase) &&
            !HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment())
            scheme = "https";
        var host = forwardedHost ?? Request.Host.Value;
        if (string.IsNullOrWhiteSpace(host) || host.Contains("@", StringComparison.Ordinal) || host.Contains('/', StringComparison.Ordinal))
            throw new InvalidOperationException("A safe public frontend origin is required for public display links.");
        if (!HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment() &&
            Uri.TryCreate($"{scheme}://{host}", UriKind.Absolute, out var fallbackOrigin) &&
            IsLoopbackHost(fallbackOrigin.Host))
            throw new InvalidOperationException("Production public display URLs must use a non-local HTTPS origin.");
        return new UriBuilder(scheme, host).Uri;
    }

    private Uri EnsureProductionScheme(Uri uri)
    {
        if (!HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment() && IsLoopbackHost(uri.Host))
            throw new InvalidOperationException("Production public display URLs must use a non-local HTTPS origin.");
        if (HttpContext.RequestServices.GetRequiredService<IWebHostEnvironment>().IsDevelopment() || uri.Scheme == Uri.UriSchemeHttps)
            return uri;
        var builder = new UriBuilder(uri) { Scheme = Uri.UriSchemeHttps, Port = uri.IsDefaultPort ? -1 : uri.Port };
        return builder.Uri;
    }

    private static bool IsLoopbackHost(string host) =>
        string.Equals(host, "localhost", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, "127.0.0.1", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(host, "::1", StringComparison.OrdinalIgnoreCase);

    private static string AbsoluteRoute(Uri origin, string path) => new Uri(origin, path.TrimStart('/')).ToString();

    private string? VersionedAssetUrl(string? value, DateTime? updatedAtUtc)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var url = Uri.TryCreate(value, UriKind.Absolute, out var absolute) ? absolute : new Uri(PublicOrigin(), value.TrimStart('/'));
        var version = (updatedAtUtc ?? DateTime.UtcNow).Ticks.ToString(CultureInfo.InvariantCulture);
        var builder = new UriBuilder(url);
        builder.Query = string.IsNullOrWhiteSpace(builder.Query) ? $"v={version}" : $"{builder.Query.TrimStart('?')}&v={version}";
        return builder.Uri.ToString();
    }

    private IActionResult? ValidateDisplayParameters(string? locale, string? theme, int? fontScale, string? layout)
    {
        if (locale is not null && !Regex.IsMatch(locale, "^[A-Za-z]{2,3}(?:-[A-Za-z]{2})?$"))
            return BadRequest("locale must be a supported language tag.");
        if (theme is not null && !SupportedThemes.Contains(NormalizeTheme(theme), StringComparer.OrdinalIgnoreCase))
            return BadRequest("theme must be default, dark, or classic.");
        if (fontScale is not null && (fontScale < 75 || fontScale > 160 || fontScale % 5 != 0))
            return BadRequest("fontScale must be between 75 and 160 in increments of 5.");
        if (layout is not null && !SupportedLayouts.Contains(layout, StringComparer.OrdinalIgnoreCase))
            return BadRequest("layout must be tv, widget, or compact.");
        return null;
    }

    private static int EffectiveScale(int saved, string displayLayout, string? requestedLayout, int? overrideScale) =>
        overrideScale.HasValue && string.Equals(displayLayout, requestedLayout, StringComparison.OrdinalIgnoreCase)
            ? overrideScale.Value
            : Math.Clamp(saved is >= 75 and <= 160 && saved % 5 == 0 ? saved : 100, 75, 160);

    private static string NormalizeTheme(string? theme) =>
        string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(theme)
            ? "default"
            : theme!.ToLowerInvariant();

    private static string NormalizeFontFamily(string? family) =>
        family is "modern-sans" or "classic-serif" ? family : "system";

    private static string Iframe(string url, string title, string width, string height) =>
        $"<iframe src=\"{WebUtility.HtmlEncode(url)}\" title=\"{title}\" width=\"{WebUtility.HtmlEncode(width)}\" height=\"{WebUtility.HtmlEncode(height)}\" loading=\"lazy\" style=\"border:0;max-width:100%;\"></iframe>";

    private static object? BuildHijriDate(HijriMonthMap? map, DateOnly gregorianDate)
    {
        string[] monthNames =
        [
            "Muharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani",
            "Jumada al-Awwal", "Jumada al-Thani", "Rajab", "Sha'ban",
            "Ramadan", "Shawwal", "Dhu al-Qi'dah", "Dhu al-Hijjah"
        ];
        var calendar = new HijriCalendar();
        try
        {
            var hijriBase = map is not null && map.HijriMonthOnFirst > 0 && map.HijriYearOnFirst > 1
                ? calendar.ToDateTime(map.HijriYearOnFirst, map.HijriMonthOnFirst, map.HijriDayOnFirst, 0, 0, 0, 0)
                : new DateTime(gregorianDate.Year, gregorianDate.Month, 1);
            var current = hijriBase.AddDays(gregorianDate.Day - 1);
            var day = calendar.GetDayOfMonth(current);
            var month = calendar.GetMonth(current);
            var year = calendar.GetYear(current);
            var monthName = monthNames[month - 1];
            return new { day, month, year, monthName, formatted = $"{monthName} {day}, {year}" };
        }
        catch (ArgumentOutOfRangeException)
        {
            return null;
        }
    }

    private static TimeOnly ResolveIqamaTime(IqamaEntry entry, PrayerTimesDto timings)
    {
        if (!entry.OffsetMinutes.HasValue) return entry.Time;
        var prayerStart = entry.Salah switch
        {
            DeenTime.Core.Enums.SalahType.Fajr => timings.Fajr,
            DeenTime.Core.Enums.SalahType.Dhuhr => timings.Dhuhr,
            DeenTime.Core.Enums.SalahType.Asr => timings.Asr,
            DeenTime.Core.Enums.SalahType.Maghrib => timings.Maghrib,
            DeenTime.Core.Enums.SalahType.Isha => timings.Isha,
            _ => entry.Time
        };
        return prayerStart.AddMinutes(entry.OffsetMinutes.Value);
    }
}
