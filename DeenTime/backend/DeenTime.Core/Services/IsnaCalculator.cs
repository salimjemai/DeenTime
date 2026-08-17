using DeenTime.Contracts.Timings;
using DeenTime.Core.Entities;

namespace DeenTime.Core.Services;

/// <summary>
/// Computes daily prayer times using the organization's selected calculation method.
/// Asr is Shafi'i/Maliki (shadow factor 1) by default; Hanafi uses factor 2.
/// </summary>
public sealed class IsnaCalculator : IPrayerTimeCalculator
{
    public PrayerTimesDto Compute(PrayerTimingCriteria c, DateOnly date)
    {
        double lat = (double)c.Latitude;
        double lng = (double)c.Longitude;

        // Days since J2000.0
        double D = JulianDay(date.Year, date.Month, date.Day) - 2451545.0;

        // Solar mean anomaly and mean longitude (degrees)
        double g = ToRad(357.529 + 0.98560028 * D);
        double q = 280.459 + 0.98564736 * D;
        double L = ToRad(q + 1.915 * Math.Sin(g) + 0.020 * Math.Sin(2 * g));

        // Obliquity of the ecliptic and solar declination
        double e    = ToRad(23.439 - 0.00000036 * D);
        double decl = Math.Asin(Math.Sin(e) * Math.Sin(L));

        // Right ascension (hours)
        double RA = Math.Atan2(Math.Cos(e) * Math.Sin(L), Math.Cos(L)) * 12.0 / Math.PI;
        if (RA < 0) RA += 24.0;

        // Equation of time (hours)
        double EqT = (q / 15.0) - RA;
        if (EqT >  12) EqT -= 24;
        if (EqT < -12) EqT += 24;

        // Solar noon in UTC hours
        double noon = 12.0 - lng / 15.0 - EqT;

        // Hour angle for a given altitude (degrees); returns hours
        double HourAngle(double altDeg)
        {
            double cosH = (Math.Sin(ToRad(altDeg)) - Math.Sin(ToRad(lat)) * Math.Sin(decl))
                          / (Math.Cos(ToRad(lat)) * Math.Cos(decl));
            if (cosH <= -1) return 12.0;
            if (cosH >= 1)  return 0.0;
            return ToDeg(Math.Acos(cosH)) / 15.0;
        }

        var method = c.Method.Replace(" ", string.Empty).Replace("-", string.Empty).ToLowerInvariant();
        (double fajrAngle, double ishaAngle, int? fixedIshaMinutes) = method switch
        {
            "karachi" => (18.0, 18.0, (int?)null),
            "mwl" or "muslimworldleague" => (18.0, 17.0, null),
            "ummalqura" => (18.5, 0.0, 90),
            "egyptian" => (19.5, 17.5, null),
            "gulf" => (19.5, 0.0, 90),
            "kuwait" => (18.0, 17.5, null),
            "qatar" => (18.0, 0.0, 90),
            "tehran" => (17.7, 14.0, null),
            "jafari" => (16.0, 14.0, null),
            _ => (15.0, 15.0, null)
        };
        double fajrHours = noon - HourAngle(-fajrAngle);

        // Sunrise: sun at -0.8333° (accounts for refraction + solar disk radius)
        double sunriseHours = noon - HourAngle(-0.8333);

        // Dhuhr: solar noon + configured offset
        double dhuhrHours  = noon + c.MinutesAfterZawal / 60.0;

        // Asr: Shafi'i (factor 1) or Hanafi (factor 2)
        int    shadow      = c.JuristicMethodAsr.Equals("Hanafi", StringComparison.OrdinalIgnoreCase) ? 2 : 1;
        double asrAlt      = ToDeg(Math.Atan(1.0 / (shadow + Math.Tan(Math.Abs(decl - ToRad(lat))))));
        double asrHours    = noon + HourAngle(asrAlt);

        // Sunset: sun at -0.8333°
        double sunsetHours = noon + HourAngle(-0.8333);

        // Maghrib: sunset + configured offset
        double maghribHours = sunsetHours + c.MinutesAfterMaghrib / 60.0;
        double ishaHours = fixedIshaMinutes.HasValue
            ? sunsetHours + fixedIshaMinutes.Value / 60.0
            : noon + HourAngle(-ishaAngle);

        // Convert UTC decimal hours to local TimeOnly
        var tz       = TimeZoneInfo.FindSystemTimeZoneById(c.TimezoneId);
        var midnightUtc = new DateTime(date.Year, date.Month, date.Day, 0, 0, 0, DateTimeKind.Utc);

        TimeOnly ToLocal(double utcHour)
        {
            var utc = midnightUtc.AddHours(utcHour);
            DateTime local;
            if (!c.DstObserved)
            {
                local = utc.Add(tz.BaseUtcOffset);
            }
            else if (c.DstBegins.HasValue && c.DstEnds.HasValue)
            {
                var customDst = date >= c.DstBegins.Value && date < c.DstEnds.Value;
                local = utc.Add(tz.BaseUtcOffset).AddHours(customDst ? 1 : 0);
            }
            else
            {
                local = TimeZoneInfo.ConvertTimeFromUtc(utc, tz);
            }
            return new TimeOnly(local.Hour, local.Minute);
        }

        return new PrayerTimesDto(
            date,
            ToLocal(fajrHours),
            ToLocal(sunriseHours),
            ToLocal(dhuhrHours),
            ToLocal(asrHours),
            ToLocal(maghribHours),
            ToLocal(sunsetHours),
            ToLocal(ishaHours));
    }

    static double JulianDay(int y, int m, int d)
    {
        if (m <= 2) { y--; m += 12; }
        int A = y / 100;
        int B = 2 - A + A / 4;
        return Math.Floor(365.25 * (y + 4716)) + Math.Floor(30.6001 * (m + 1)) + d + B - 1524.5;
    }

    static double ToRad(double deg) => deg * Math.PI / 180.0;
    static double ToDeg(double rad) => rad * 180.0 / Math.PI;
}
