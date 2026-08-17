using Microsoft.AspNetCore.Mvc;
using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;
using System.Globalization;
using DeenTime.Contracts.Timings;
using DeenTime.Core.Entities;
using DeenTime.Core.Enums;

namespace DeenTime.Api.Controllers
{
    [ApiController]
    [Route("public")]
    public sealed class PublicController : ControllerBase
    {
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
        public async Task<IActionResult> Display(string slug)
        {
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
                ?? new DeenTime.Core.Entities.TvDisplayConfig { OrganizationId = org.Id };

            var monthlyPdfUrl = await _db.PublishArtifacts
                .AsNoTracking()
                .Where(p => p.OrganizationId == org.Id && p.Year == date.Year && p.Month == date.Month)
                .OrderByDescending(p => p.CreatedAtUtc)
                .Select(p => p.StorageUrl)
                .FirstOrDefaultAsync();

            return Ok(new
            {
                organization = new { org.Name, org.Slug, org.AddressLine, org.City, org.State },
                date,
                timezoneId = org.Criteria.TimezoneId,
                timings,
                iqama,
                monthlyPdfUrl,
                design = org.Design is null ? null : new
                {
                    org.Design.HeaderImageUrl,
                    BackgroundImageUrl = org.Design.HeaderImageUrl,
                    org.Design.IqamaHeadings,
                    org.Design.FooterHtml,
                    org.Design.Theme
                },
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

        [HttpGet("widget/{slug}")]
        public IActionResult Widget(string slug)
        {
			return RedirectToFrontend($"/w/{Uri.EscapeDataString(slug)}");
		}

		[HttpGet("tv/{slug}")]
		public IActionResult Tv(string slug)
		{
			return RedirectToFrontend($"/tv/{Uri.EscapeDataString(slug)}");
		}

        [HttpGet("/clock")]
        public IActionResult LegacyClock([FromQuery] string masjid) =>
            RedirectToFrontend($"/tv/{Uri.EscapeDataString(masjid)}");

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

        private IActionResult RedirectToFrontend(string path)
        {
            var baseUrl = (_configuration["Frontend:PublicBaseUrl"] ?? string.Empty).TrimEnd('/');
            return Redirect($"{baseUrl}{path}");
        }

        private static object? BuildHijriDate(DeenTime.Core.Entities.HijriMonthMap? map, DateOnly gregorianDate)
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
                DateTime hijriBase;
                if (map is not null && map.HijriMonthOnFirst > 0 && map.HijriYearOnFirst > 1)
                    hijriBase = calendar.ToDateTime(map.HijriYearOnFirst, map.HijriMonthOnFirst, map.HijriDayOnFirst, 0, 0, 0, 0);
                else
                    hijriBase = new DateTime(gregorianDate.Year, gregorianDate.Month, 1);

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
                SalahType.Fajr => timings.Fajr,
                SalahType.Dhuhr => timings.Dhuhr,
                SalahType.Asr => timings.Asr,
                SalahType.Maghrib => timings.Maghrib,
                SalahType.Isha => timings.Isha,
                _ => entry.Time
            };
            return prayerStart.AddMinutes(entry.OffsetMinutes.Value);
        }
	}
}
