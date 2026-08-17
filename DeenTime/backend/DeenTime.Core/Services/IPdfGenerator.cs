using DeenTime.Core.Enums;

namespace DeenTime.Core.Services;

public interface IPdfGenerator
{
	Task<byte[]> GenerateMonthlyPdfAsync(Guid orgId, int year, int month, PdfSize size, PdfOrientation orientation);
	Task<byte[]> GenerateRamadanPdfAsync(Guid orgId, int year, PdfSize size, PdfOrientation orientation);
}

