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
using Microsoft.AspNetCore.RateLimiting;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class PublishController : ControllerBase
	{
		public record RamadanPdfGenerateRequest(Guid OrgId, int Year, PdfSize Size, PdfOrientation Orientation);
		public record TvDisplayConfigUpdateRequest(
			bool ShowSeconds,
			bool ShowHijri,
			string? AccentColor,
			int ClockFontScale = 160,
			int AutoRefreshSeconds = 30);
		private readonly AppDbContext _db;
		private readonly IConfiguration _configuration;
		private readonly IWebHostEnvironment _environment;
		public PublishController(AppDbContext db, IConfiguration configuration, IWebHostEnvironment environment) { _db = db; _configuration = configuration; _environment = environment; }

		[HttpGet("embed-code/{orgId:guid}")]
		public async Task<IActionResult> EmbedCode(Guid orgId, [FromQuery] string? publicOrigin = null)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var org = await _db.Organizations.AsNoTracking().FirstOrDefaultAsync(o => o.Id == orgId);
			if (org is null) return NotFound();

			var origin = PublicOrigin(publicOrigin);
			var combinedWidgetUrl = PublicUrl(origin, $"/w/{Uri.EscapeDataString(org.Slug)}");
			var dailyWidgetUrl = PublicUrl(origin, $"/w/{Uri.EscapeDataString(org.Slug)}/daily");
			var jumuahWidgetUrl = PublicUrl(origin, $"/w/{Uri.EscapeDataString(org.Slug)}/jumuah");
			var widgetUrl = combinedWidgetUrl;
			var compactWidgetUrl = PublicUrl(origin, $"/w2/{Uri.EscapeDataString(org.Slug)}");
			var tvUrl = PublicUrl(origin, $"/tv/{Uri.EscapeDataString(org.Slug)}");
			var encodedName = WebUtility.HtmlEncode(org.Name);
			var encodedTitle = WebUtility.HtmlEncode($"IqamaTime · {org.Name} prayer times");
			var combinedIframe = WidgetIframe(origin, combinedWidgetUrl, encodedTitle, "420", "900");
			var dailyIframe = WidgetIframe(origin, dailyWidgetUrl, WebUtility.HtmlEncode($"IqamaTime · {org.Name} daily prayer times"), "420", "720");
			var jumuahIframe = WidgetIframe(origin, jumuahWidgetUrl, WebUtility.HtmlEncode($"IqamaTime · {org.Name} Friday prayer times"), "420", "560");
			var iframe = combinedIframe;
			var compactIframe = WidgetIframe(origin, compactWidgetUrl, WebUtility.HtmlEncode($"IqamaTime · {org.Name} compact prayer times"), "360", "800");
			var script = $"<a href=\"{WebUtility.HtmlEncode(tvUrl)}\">Open {encodedName} IqamaTime TV display</a>";
			return Ok(new
			{
				widgetUrl,
				combinedWidgetUrl,
				dailyWidgetUrl,
				jumuahWidgetUrl,
				compactWidgetUrl,
				tvUrl,
				iframe,
				combinedIframe,
				dailyIframe,
				jumuahIframe,
				compactIframe,
				script
			});
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
		public async Task<IActionResult> UpdateTvConfig(Guid orgId, [FromBody] TvDisplayConfigUpdateRequest req)
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
			cfg.ClockFontScale = Math.Clamp(req.ClockFontScale, 80, 200);
			cfg.AutoRefreshSeconds = Math.Clamp(req.AutoRefreshSeconds, 15, 3600);
			await _db.SaveChangesAsync();
			return Ok(cfg);
		}

		[HttpPost("pdf/generate")]
		[Authorize(Roles = "Admin,Editor")]
		[EnableRateLimiting("expensive")]
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
		[EnableRateLimiting("expensive")]
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

		private Uri PublicOrigin(string? requestedOrigin)
		{
			var candidate = string.IsNullOrWhiteSpace(requestedOrigin)
				? _configuration["Frontend:PublicBaseUrl"]
				: requestedOrigin;
			if (!Uri.TryCreate(candidate?.TrimEnd('/'), UriKind.Absolute, out var baseUri) ||
				baseUri.Scheme is not ("http" or "https"))
				throw new InvalidOperationException("The public app address must be an absolute http(s) URL.");
			if (!_environment.IsDevelopment() && (baseUri.Scheme != Uri.UriSchemeHttps || baseUri.Host is "localhost" or "127.0.0.1" or "::1"))
				throw new InvalidOperationException("Production public display URLs must use a non-local HTTPS origin.");
			return new Uri(baseUri.GetLeftPart(UriPartial.Authority) + "/");
		}

		private static string PublicUrl(Uri origin, string path) =>
			new Uri(origin, path.TrimStart('/')).AbsoluteUri;

		private static string WidgetIframe(Uri origin, string url, string title, string width, string height)
		{
			var scriptUrl = PublicUrl(origin, "/iqamatime-embed.js");
			return $"<iframe src=\"{WebUtility.HtmlEncode(url)}\" title=\"{title}\" width=\"{WebUtility.HtmlEncode(width)}\" height=\"{WebUtility.HtmlEncode(height)}\" loading=\"lazy\" data-iqamatime-auto-height style=\"display:block;max-width:100%;border:0;overflow:hidden\"></iframe><script async src=\"{WebUtility.HtmlEncode(scriptUrl)}\"></script>";
		}
	}
}
