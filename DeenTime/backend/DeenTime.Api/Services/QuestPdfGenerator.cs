using DeenTime.Contracts.Timings;
using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace DeenTime.Api.Services;

public sealed class QuestPdfGenerator(AppDbContext db, IPrayerTimeCalculator calc) : IPdfGenerator
{
	public async Task<byte[]> GenerateMonthlyPdfAsync(Guid orgId, int year, int month, PdfSize size, PdfOrientation orientation)
	{
		// ── Load org with related data ────────────────────────────────────
		var org = await db.Organizations
			.Include(o => o.Criteria)
			.Include(o => o.Design)
			.FirstAsync(o => o.Id == orgId);

		if (org.Criteria is null)
			throw new InvalidOperationException("Prayer timing criteria must be set before generating PDFs.");

		// ── Compute salah times for every day of the month ────────────────
		int daysInMonth = DateTime.DaysInMonth(year, month);
		var dailyTimes = new PrayerTimesDto[daysInMonth];
		for (int d = 1; d <= daysInMonth; d++)
			dailyTimes[d - 1] = calc.Compute(org.Criteria, new DateOnly(year, month, d));

		// ── Load iqama entries for the month, indexed by (date, salah) ────
		var iqamaList = await db.IqamaEntries
			.Where(i => i.OrganizationId == orgId && i.Date.Year == year && i.Date.Month == month)
			.ToListAsync();
		var iqamaLookup = iqamaList.ToDictionary(i => (i.Date, i.Salah), i => i.Time);

		// ── Load Hijri map for the month ──────────────────────────────────
		var hijriMap = await db.HijriMonthMaps.AsNoTracking()
			.FirstOrDefaultAsync(h => h.OrganizationId == orgId && h.Year == year && h.Month == month);
		int hijriDayOnFirst = hijriMap?.HijriDayOnFirst ?? 1;

		// ── Page size ─────────────────────────────────────────────────────
		var baseSize = size == PdfSize.Letter ? PageSizes.Letter : new PageSize(792, 1224);
		var pageSize = orientation == PdfOrientation.Landscape
			? new PageSize(baseSize.Height, baseSize.Width)
			: baseSize;

		// ── Column headers matching iqamatime.com layout ──────────────────
		string monthAbbrev = new DateOnly(year, month, 1).ToString("MMM").ToUpper();
		string[] headers = [monthAbbrev, "DAY", "HIJRI", "FAJR", "IQM*", "SUNRISE", "DUHUR", "IQM*", "ASR", "IQM*", "SUNSET", "ISHA", "IQM*"];

		// ── Build document ────────────────────────────────────────────────
		var headerBg  = Colors.Grey.Darken3;
		var altRowBg  = Colors.Grey.Lighten4;
		float fontSize = size == PdfSize.Tabloid ? 9f : 7.5f;

		var doc = Document.Create(container =>
		{
			container.Page(page =>
			{
				page.Size(pageSize);
				page.PageColor(Colors.White);
				page.Margin(20);

				// ── Header: org info ──────────────────────────────────────
				page.Header().Column(col =>
				{
					col.Item().AlignCenter().Text("Prayer Timings").FontSize(22).Bold();
					col.Item().AlignCenter().Text($"({new DateOnly(year, month, 1):MMMM yyyy})").FontSize(12);
					col.Item().AlignCenter().Text(org.Name).FontSize(16).Bold();

					// Address line
					var addressParts = new[] { org.AddressLine, org.City, org.State, org.ZipCode }
						.Where(s => !string.IsNullOrWhiteSpace(s));
					var address = string.Join(" ", addressParts);
					if (!string.IsNullOrWhiteSpace(address))
						col.Item().AlignCenter().Text(address).FontSize(9);

					// Contact row
					var contactParts = new List<string>();
					if (!string.IsNullOrWhiteSpace(org.Phone))   contactParts.Add($"Phone: {org.Phone}");
					if (!string.IsNullOrWhiteSpace(org.Email))   contactParts.Add($"Email: {org.Email}");
					if (!string.IsNullOrWhiteSpace(org.SocialUrl)) contactParts.Add($"Social: {org.SocialUrl}");
					if (!string.IsNullOrWhiteSpace(org.WebsiteUrl)) contactParts.Add($"Web: {org.WebsiteUrl}");
					if (contactParts.Count > 0)
						col.Item().AlignCenter().Text(string.Join("     ", contactParts)).FontSize(8);

					col.Item().PaddingVertical(8);
				});

				// ── Content: prayer table ─────────────────────────────────
				page.Content().Table(table =>
				{
					table.ColumnsDefinition(cols =>
					{
						cols.ConstantColumn(30);  // Day of month
						cols.ConstantColumn(28);  // Day name
						cols.ConstantColumn(32);  // Hijri
						cols.RelativeColumn();    // Fajr
						cols.RelativeColumn();    // Fajr IQM
						cols.RelativeColumn();    // Sunrise
						cols.RelativeColumn();    // Dhuhr
						cols.RelativeColumn();    // Dhuhr IQM
						cols.RelativeColumn();    // Asr
						cols.RelativeColumn();    // Asr IQM
						cols.RelativeColumn();    // Sunset
						cols.RelativeColumn();    // Isha
						cols.RelativeColumn();    // Isha IQM
					});

					// ── Table header row ──────────────────────────────────
					table.Header(h =>
					{
						foreach (var hdr in headers)
						{
							h.Cell().Background(headerBg).Padding(3).AlignCenter()
								.Text(hdr).FontColor(Colors.White).FontSize(fontSize).Bold();
						}
					});

					// ── Data rows ─────────────────────────────────────────
					for (int d = 0; d < daysInMonth; d++)
					{
						var pt   = dailyTimes[d];
						var date = new DateOnly(year, month, d + 1);
						int hijriDay = hijriDayOnFirst + d;   // simplified sequential Hijri day

						string IqamaFor(SalahType s) =>
							iqamaLookup.TryGetValue((date, s), out var t) ? t.ToString("h:mm") : "";

						var bg = d % 2 == 1 ? altRowBg : Colors.White;

						string[] cells =
						[
							(d + 1).ToString("00"),
							date.ToString("ddd"),
							$"{hijriDay}/{month}",
							pt.Fajr.ToString("h:mm"),
							IqamaFor(SalahType.Fajr),
							pt.Sunrise.ToString("h:mm"),
							pt.Dhuhr.ToString("h:mm"),
							IqamaFor(SalahType.Dhuhr),
							pt.Asr.ToString("h:mm"),
							IqamaFor(SalahType.Asr),
							pt.Sunset.ToString("h:mm"),
							pt.Isha.ToString("h:mm"),
							IqamaFor(SalahType.Isha),
						];

						foreach (var cell in cells)
						{
							table.Cell().Background(bg).Padding(2).AlignCenter()
								.Text(cell).FontSize(fontSize);
						}
					}
				});

				// ── Footer ────────────────────────────────────────────────
				page.Footer().AlignCenter()
					.Text(org.Design?.FooterHtml ?? string.Empty).FontSize(9);
			});
		});

		return doc.GeneratePdf();
	}
}
