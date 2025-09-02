using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace DeenTime.Api.Services;

public sealed class QuestPdfGenerator(AppDbContext db) : IPdfGenerator
{
	public async Task<byte[]> GenerateMonthlyPdfAsync(Guid orgId, int year, int month, PdfSize size, PdfOrientation orientation)
	{
		var org = await db.Organizations.Include(o => o.Design).FirstAsync(o => o.Id == orgId);
		var iqama = await db.IqamaEntries.Where(i => i.OrganizationId == orgId && i.Date.Year == year && i.Date.Month == month)
			.OrderBy(i => i.Date).ThenBy(i => i.Salah).ToListAsync();

		var baseSize = size == PdfSize.Letter ? PageSizes.Letter : new PageSize(792, 1224);
		var pageSize = orientation == PdfOrientation.Landscape ? new PageSize(baseSize.Height, baseSize.Width) : baseSize;

		var doc = Document.Create(container =>
		{
			container.Page(page =>
			{
				page.Size(pageSize);
				page.PageColor(Colors.White);
				page.Margin(20);

				page.Header().Row(row =>
				{
					row.RelativeItem().Text(org.Name).FontSize(22).Bold();
					row.ConstantItem(120).AlignRight().Text($"{year}-{month:00}").FontSize(14);
				});

				page.Content().Table(table =>
				{
					table.ColumnsDefinition(cols =>
					{
						cols.RelativeColumn(2);
						cols.RelativeColumn(2);
						cols.RelativeColumn(2);
						cols.RelativeColumn(6);
					});

					table.Header(h =>
					{
						h.Cell().Element(CellHeader).Text("Date");
						h.Cell().Element(CellHeader).Text("Salah");
						h.Cell().Element(CellHeader).Text("Iqama");
						h.Cell().Element(CellHeader).Text("Note");
					});

					foreach (var e in iqama)
					{
						table.Cell().Element(CellBody).Text(e.Date.ToString("ddd MMM d"));
						table.Cell().Element(CellBody).Text(e.Salah.ToString());
						table.Cell().Element(CellBody).Text(e.Time.ToString("HH:mm"));
						table.Cell().Element(CellBody).Text(e.Note ?? string.Empty);
					}
				});

				page.Footer().AlignCenter().Text(org.Design?.FooterHtml ?? string.Empty).FontSize(10);
			});

			static IContainer CellHeader(IContainer c) => c.DefaultTextStyle(x => x.SemiBold()).PaddingVertical(6).BorderBottom(1).BorderColor(Colors.Grey.Medium);
			static IContainer CellBody(IContainer c) => c.PaddingVertical(4).BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2);
		});

		return doc.GeneratePdf();
	}
}


