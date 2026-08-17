using DeenTime.Contracts.Timings;
using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;

namespace DeenTime.Api.Services;

public sealed class QuestPdfGenerator(AppDbContext db, IPrayerTimeCalculator calc) : IPdfGenerator
{
    public Task<byte[]> GenerateMonthlyPdfAsync(Guid orgId, int year, int month, PdfSize size, PdfOrientation orientation)
    {
        var dates = Enumerable.Range(1, DateTime.DaysInMonth(year, month))
            .Select(day => new DateOnly(year, month, day))
            .ToArray();
        return GeneratePdfAsync(orgId, $"{new DateOnly(year, month, 1):MMMM yyyy}", dates, size, orientation);
    }

    public async Task<byte[]> GenerateRamadanPdfAsync(Guid orgId, int year, PdfSize size, PdfOrientation orientation)
    {
        var maps = await db.HijriMonthMaps.AsNoTracking()
            .Where(h => h.OrganizationId == orgId && h.Year == year)
            .ToDictionaryAsync(h => (h.Year, h.Month));
        var dates = Enumerable.Range(1, DateTime.IsLeapYear(year) ? 366 : 365)
            .Select(day => new DateOnly(year, 1, 1).AddDays(day - 1))
            .Where(date => GetHijriDate(date, maps).Month == 9)
            .ToArray();

        if (dates.Length == 0) throw new InvalidOperationException($"Could not determine Ramadan dates for {year}.");
        var hijriYear = GetHijriDate(dates[0], maps).Year;
        return await GeneratePdfAsync(orgId, $"Ramadan {hijriYear} / {year}", dates, size, orientation);
    }

    private async Task<byte[]> GeneratePdfAsync(Guid orgId, string periodTitle, DateOnly[] dates, PdfSize size, PdfOrientation orientation)
    {
        var org = await db.Organizations
            .Include(o => o.Criteria)
            .Include(o => o.Design)
            .FirstAsync(o => o.Id == orgId);
        if (org.Criteria is null)
            throw new InvalidOperationException("Prayer timing criteria must be set before generating PDFs.");

        var start = dates.Min();
        var end = dates.Max();
        var dailyTimes = dates.ToDictionary(date => date, date => calc.Compute(org.Criteria, date));
        var iqamaList = await db.IqamaEntries
            .Where(i => i.OrganizationId == orgId && i.Date <= end)
            .OrderBy(i => i.Date)
            .ToListAsync();
        var maps = await db.HijriMonthMaps.AsNoTracking()
            .Where(h => h.OrganizationId == orgId && h.Year >= start.Year && h.Year <= end.Year)
            .ToDictionaryAsync(h => (h.Year, h.Month));

        var baseSize = size == PdfSize.Letter ? PageSizes.Letter : new PageSize(792, 1224);
        var pageSize = orientation == PdfOrientation.Landscape ? new PageSize(baseSize.Height, baseSize.Width) : baseSize;
        string[] defaults = ["FAJR", "IQM*", "SUNRISE", "DUHUR", "IQM*", "ASR", "IQM*", "SUNSET", "ISHA", "IQM*"];
        var configured = org.Design?.IqamaHeadings is { Length: 10 } custom ? custom : defaults;
        string[] headers = ["DATE", "DAY", "HIJRI", .. configured];
        var headerBg = Colors.BlueGrey.Darken3;
        var altRowBg = Colors.Grey.Lighten4;
        float fontSize = size == PdfSize.Tabloid ? 9f : 7.5f;

        var doc = Document.Create(container =>
        {
            container.Page(page =>
            {
                page.Size(pageSize);
                page.PageColor(Colors.White);
                page.Margin(20);
                page.Header().Column(col =>
                {
                    col.Item().AlignCenter().Text("Prayer Timings").FontSize(22).Bold();
                    col.Item().AlignCenter().Text($"({periodTitle})").FontSize(12);
                    col.Item().AlignCenter().Text(org.Name).FontSize(16).Bold();
                    var address = string.Join(" ", new[] { org.AddressLine, org.City, org.State, org.ZipCode }.Where(value => !string.IsNullOrWhiteSpace(value)));
                    if (!string.IsNullOrWhiteSpace(address)) col.Item().AlignCenter().Text(address).FontSize(9);
                    var contacts = new List<string>();
                    if (!string.IsNullOrWhiteSpace(org.Phone)) contacts.Add($"Phone: {org.Phone}");
                    if (!string.IsNullOrWhiteSpace(org.Email)) contacts.Add($"Email: {org.Email}");
                    if (!string.IsNullOrWhiteSpace(org.WebsiteUrl)) contacts.Add($"Web: {org.WebsiteUrl}");
                    if (contacts.Count > 0) col.Item().AlignCenter().Text(string.Join("     ", contacts)).FontSize(8);
                    col.Item().PaddingVertical(8);
                });

                page.Content().Table(table =>
                {
                    table.ColumnsDefinition(cols =>
                    {
                        cols.ConstantColumn(36);
                        cols.ConstantColumn(28);
                        cols.ConstantColumn(48);
                        for (var i = 0; i < 10; i++) cols.RelativeColumn();
                    });
                    table.Header(header =>
                    {
                        foreach (var heading in headers)
                            header.Cell().Background(headerBg).Padding(3).AlignCenter().Text(heading).FontColor(Colors.White).FontSize(fontSize).Bold();
                    });

                    for (var index = 0; index < dates.Length; index++)
                    {
                        var date = dates[index];
                        PrayerTimesDto times = dailyTimes[date];
                        var hijri = GetHijriDate(date, maps);
                        string IqamaFor(SalahType salah)
                        {
                            var entry = iqamaList.LastOrDefault(candidate => candidate.Salah == salah && candidate.Date <= date);
                            return entry is null ? string.Empty : ResolveIqamaTime(entry, times).ToString("h:mm");
                        }
                        string[] cells =
                        [
                            date.ToString("MM/dd"), date.ToString("ddd"), $"{hijri.Day}/{hijri.Month}/{hijri.Year}",
                            times.Fajr.ToString("h:mm"), IqamaFor(SalahType.Fajr), times.Sunrise.ToString("h:mm"),
                            times.Dhuhr.ToString("h:mm"), IqamaFor(SalahType.Dhuhr), times.Asr.ToString("h:mm"),
                            IqamaFor(SalahType.Asr), times.Sunset.ToString("h:mm"), times.Isha.ToString("h:mm"), IqamaFor(SalahType.Isha)
                        ];
                        var background = index % 2 == 1 ? altRowBg : Colors.White;
                        foreach (var cell in cells)
                            table.Cell().Background(background).Padding(2).AlignCenter().Text(cell).FontSize(fontSize);
                    }
                });

                var footer = StripHtml(org.Design?.FooterHtml);
                if (!string.IsNullOrWhiteSpace(footer)) page.Footer().AlignCenter().Text(footer).FontSize(9);
            });
        });
        return doc.GeneratePdf();
    }

    private static (int Day, int Month, int Year) GetHijriDate(DateOnly date, IReadOnlyDictionary<(int Year, int Month), HijriMonthMap> maps)
    {
        var calendar = new HijriCalendar();
        DateTime current;
        if (maps.TryGetValue((date.Year, date.Month), out var map) && map.HijriMonthOnFirst > 0 && map.HijriYearOnFirst > 1)
        {
            var first = calendar.ToDateTime(map.HijriYearOnFirst, map.HijriMonthOnFirst, map.HijriDayOnFirst, 0, 0, 0, 0);
            current = first.AddDays(date.Day - 1);
        }
        else
        {
            current = date.ToDateTime(TimeOnly.MinValue);
        }
        return (calendar.GetDayOfMonth(current), calendar.GetMonth(current), calendar.GetYear(current));
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

    private static string StripHtml(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return string.Empty;
        return WebUtility.HtmlDecode(Regex.Replace(value, "<[^>]+>", " ")).Trim();
    }
}
