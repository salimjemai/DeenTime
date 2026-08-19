using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeenTime.Api.Requests.Publish;
using DeenTime.Core.Services;
using DeenTime.Api.Authorization;
using System.Net;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class PublishController : ControllerBase
	{
		public record RamadanPdfGenerateRequest(Guid OrgId, int Year, PdfSize Size, PdfOrientation Orientation);
		private readonly AppDbContext _db;
		private readonly IConfiguration _configuration;
		private readonly IWebHostEnvironment _environment;
		public PublishController(AppDbContext db, IConfiguration configuration, IWebHostEnvironment environment) { _db = db; _configuration = configuration; _environment = environment; }

		[HttpGet("embed-code/{orgId:guid}")]
		public async Task<IActionResult> EmbedCode(Guid orgId)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var org = await _db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orgId);
			if (org is null) return NotFound();

			var widgetUrl = PublicUrl($"/w/{Uri.EscapeDataString(org.Slug)}");
			var compactWidgetUrl = PublicUrl($"/w2/{Uri.EscapeDataString(org.Slug)}");
			var tvUrl = PublicUrl($"/tv/{Uri.EscapeDataString(org.Slug)}");
			var encodedName = WebUtility.HtmlEncode(org.Name);
			var encodedTitle = WebUtility.HtmlEncode($"IqamaTime · {org.Name} prayer times");
			var iframe = $"<iframe src=\"{WebUtility.HtmlEncode(widgetUrl)}\" title=\"{encodedTitle}\" width=\"420\" height=\"900\" loading=\"lazy\" style=\"max-width:100%;border:0\"></iframe>";
			var compactIframe = $"<iframe src=\"{WebUtility.HtmlEncode(compactWidgetUrl)}\" title=\"{WebUtility.HtmlEncode($"IqamaTime · {org.Name} compact prayer times")}\" width=\"360\" height=\"800\" loading=\"lazy\" style=\"max-width:100%;border:0\"></iframe>";
			var script = $"<a href=\"{WebUtility.HtmlEncode(tvUrl)}\">Open {encodedName} IqamaTime TV display</a>";
			return Ok(new { widgetUrl, compactWidgetUrl, tvUrl, iframe, compactIframe, script });
		}

		[HttpGet("tv-config/{orgId:guid}")]
		public async Task<IActionResult> TvConfig(Guid orgId)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var cfg = await _db.TvDisplayConfigs.AsNoTracking().FirstOrDefaultAsync(t => t.OrganizationId == orgId)
				?? new TvDisplayConfig { Id = Guid.NewGuid(), OrganizationId = orgId };
			return Ok(cfg);
		}

		[HttpPut("tv-config/{orgId:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> UpdateTvConfig(Guid orgId, [FromBody] TvDisplayConfig req)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
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
			if (!User.CanAccessOrganization(req.OrgId)) return Forbid();
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
			if (!User.CanAccessOrganization(req.OrgId)) return Forbid();
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
			if (!User.CanAccessOrganization(orgId)) return Forbid();
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
			if (!User.CanAccessOrganization(a.OrganizationId)) return Forbid();
			return Redirect(a.StorageUrl);
		}

		private string PublicUrl(string path)
		{
			var configured = _configuration["Frontend:PublicBaseUrl"]?.TrimEnd('/');
			if (!Uri.TryCreate(configured, UriKind.Absolute, out var baseUri) ||
				baseUri.Scheme is not ("http" or "https"))
				throw new InvalidOperationException("Frontend:PublicBaseUrl must be an absolute http(s) URL.");
			if (!_environment.IsDevelopment() && (baseUri.Scheme != Uri.UriSchemeHttps || baseUri.Host is "localhost" or "127.0.0.1" or "::1"))
				throw new InvalidOperationException("Production public display URLs must use a non-local HTTPS origin.");
			return new Uri(baseUri, path.TrimStart('/')).ToString();
		}
	}
}
