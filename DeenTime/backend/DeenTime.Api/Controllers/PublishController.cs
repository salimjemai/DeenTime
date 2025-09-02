using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeenTime.Api.Requests.Publish;
using DeenTime.Core.Services;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class PublishController : ControllerBase
	{
		public record PdfGenerateRequest(Guid OrgId, int Year, int Month, PdfSize Size, PdfOrientation Orientation);
		private readonly AppDbContext _db;
		public PublishController(AppDbContext db) { _db = db; }

		[HttpGet("embed-code/{orgId:guid}")]
		public IActionResult EmbedCode(Guid orgId)
		{
			var iframe = $"<iframe src=\"/public/widget/{orgId}\" width=\"100%\" height=\"600\"></iframe>";
			var script = "<script>/* init widget */</script>";
			return Ok(new { iframe, script });
		}

		[HttpGet("tv-config/{orgId:guid}")]
		public async Task<IActionResult> TvConfig(Guid orgId)
		{
			var cfg = await _db.TvDisplayConfigs.AsNoTracking().FirstOrDefaultAsync(t => t.OrganizationId == orgId)
				?? new TvDisplayConfig { Id = Guid.NewGuid(), OrganizationId = orgId };
			return Ok(cfg);
		}

		[HttpPost("pdf/generate")]
		public async Task<IActionResult> GeneratePdf([FromBody] PdfGenerateRequest req, [FromServices] IPdfGenerator pdfs, [FromServices] IStorageService storage)
		{
			var bytes = await pdfs.GenerateMonthlyPdfAsync(req.OrgId, req.Year, req.Month, req.Size, req.Orientation);
			var key = $"artifacts/{req.OrgId}/{req.Year}-{req.Month}-{Guid.NewGuid()}.pdf";
			var url = await storage.UploadAsync(key, "application/pdf", bytes);
			var artifact = new PublishArtifact
			{
				Id = Guid.NewGuid(), OrganizationId = req.OrgId, Year = req.Year, Month = req.Month,
				Size = req.Size, Orientation = req.Orientation, StorageUrl = url
			};
			_db.PublishArtifacts.Add(artifact);
			await _db.SaveChangesAsync();
			return Ok(artifact);
		}

		[HttpGet("artifacts")]
		public async Task<IActionResult> ListArtifacts([FromQuery] Guid orgId, [FromQuery] int year)
		{
			var list = await _db.PublishArtifacts.AsNoTracking()
				.Where(p => p.OrganizationId == orgId && p.Year == year)
				.OrderByDescending(p => p.CreatedAtUtc)
				.ToListAsync();
			return Ok(list);
		}

		[HttpGet("pdf/{artifactId:guid}")]
		public async Task<IActionResult> GetPdf(Guid artifactId)
		{
			var a = await _db.PublishArtifacts.AsNoTracking().FirstOrDefaultAsync(p => p.Id == artifactId);
			if (a is null) return NotFound();
			return Redirect(a.StorageUrl);
		}
	}
}
