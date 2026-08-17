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
		public record RamadanPdfGenerateRequest(Guid OrgId, int Year, PdfSize Size, PdfOrientation Orientation);
		private readonly AppDbContext _db;
		public PublishController(AppDbContext db) { _db = db; }

		[HttpGet("embed-code/{orgId:guid}")]
		public async Task<IActionResult> EmbedCode(Guid orgId)
		{
			var org = await _db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orgId);
			if (org is null) return NotFound();

			var widgetUrl = $"/w/{org.Slug}";
			var compactWidgetUrl = $"/w2/{org.Slug}";
			var tvUrl = $"/tv/{org.Slug}";
			var iframe = $"<iframe src=\"{widgetUrl}\" title=\"{org.Name} prayer times\" width=\"420\" height=\"900\" loading=\"lazy\" style=\"max-width:100%;border:0\"></iframe>";
			var compactIframe = $"<iframe src=\"{compactWidgetUrl}\" title=\"{org.Name} compact prayer times\" width=\"360\" height=\"800\" loading=\"lazy\" style=\"max-width:100%;border:0\"></iframe>";
			var script = $"<a href=\"{tvUrl}\">Open {org.Name} TV display</a>";
			return Ok(new { widgetUrl, compactWidgetUrl, tvUrl, iframe, compactIframe, script });
		}

		[HttpGet("tv-config/{orgId:guid}")]
		public async Task<IActionResult> TvConfig(Guid orgId)
		{
			var cfg = await _db.TvDisplayConfigs.AsNoTracking().FirstOrDefaultAsync(t => t.OrganizationId == orgId)
				?? new TvDisplayConfig { Id = Guid.NewGuid(), OrganizationId = orgId };
			return Ok(cfg);
		}

		[HttpPut("tv-config/{orgId:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> UpdateTvConfig(Guid orgId, [FromBody] TvDisplayConfig req)
		{
			var cfg = await _db.TvDisplayConfigs.FirstOrDefaultAsync(t => t.OrganizationId == orgId);
			if (cfg is null)
			{
				cfg = new TvDisplayConfig { Id = Guid.NewGuid(), OrganizationId = orgId };
				_db.TvDisplayConfigs.Add(cfg);
			}

			cfg.ShowSeconds = req.ShowSeconds;
			cfg.ShowHijri = req.ShowHijri;
			cfg.AccentColor = string.IsNullOrWhiteSpace(req.AccentColor) ? "#00AEEF" : req.AccentColor;
			cfg.AutoRefreshSeconds = Math.Clamp(req.AutoRefreshSeconds, 15, 3600);
			await _db.SaveChangesAsync();
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

		[HttpPost("pdf/ramadan")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> GenerateRamadanPdf([FromBody] RamadanPdfGenerateRequest req, [FromServices] IPdfGenerator pdfs, [FromServices] IStorageService storage)
		{
			var bytes = await pdfs.GenerateRamadanPdfAsync(req.OrgId, req.Year, req.Size, req.Orientation);
			var key = $"artifacts/{req.OrgId}/ramadan-{req.Year}-{req.Size}-{Guid.NewGuid()}.pdf";
			var url = await storage.UploadAsync(key, "application/pdf", bytes);
			var artifact = new PublishArtifact
			{
				Id = Guid.NewGuid(), OrganizationId = req.OrgId, Year = req.Year, Month = 0,
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
