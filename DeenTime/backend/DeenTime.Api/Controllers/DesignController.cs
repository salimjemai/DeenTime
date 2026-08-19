using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeenTime.Api.Requests.Design;
using DeenTime.Api.Authorization;
using DeenTime.Core.Services;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class DesignController : ControllerBase
	{
		private readonly AppDbContext _db;
		public DesignController(AppDbContext db) { _db = db; }

		[HttpGet("{orgId:guid}")]
		public async Task<IActionResult> Get(Guid orgId)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var design = await _db.DesignSettings.AsNoTracking().FirstOrDefaultAsync(d => d.OrganizationId == orgId);
			return design is not null ? Ok(design) : NotFound();
		}

		[HttpPut("{orgId:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Put(Guid orgId, [FromBody] DesignRequest req)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var design = await _db.DesignSettings.FirstOrDefaultAsync(d => d.OrganizationId == orgId);
			if (design is null)
			{
				design = new DesignSettings
				{
					Id = Guid.NewGuid(), OrganizationId = orgId,
					HeaderImageUrl = req.HeaderImageUrl,
					IqamaHeadings = req.IqamaHeadings ?? [],
					FooterHtml = req.FooterHtml,
					Theme = NormalizeTheme(req.Theme),
					TvFontScale = req.TvFontScale ?? 100,
					WidgetFontScale = req.WidgetFontScale ?? 100,
					CompactFontScale = req.CompactFontScale ?? 100,
					TvFontFamily = req.TvFontFamily ?? "system",
					WidgetFontFamily = req.WidgetFontFamily ?? "system",
					CompactFontFamily = req.CompactFontFamily ?? "system"
				};
				_db.DesignSettings.Add(design);
			}
			else
			{
				design.HeaderImageUrl = req.HeaderImageUrl ?? design.HeaderImageUrl;
				design.IqamaHeadings = req.IqamaHeadings ?? [];
				design.FooterHtml = req.FooterHtml;
				design.Theme = NormalizeTheme(req.Theme ?? design.Theme);
				design.TvFontScale = req.TvFontScale ?? design.TvFontScale;
				design.WidgetFontScale = req.WidgetFontScale ?? design.WidgetFontScale;
				design.CompactFontScale = req.CompactFontScale ?? design.CompactFontScale;
				design.TvFontFamily = req.TvFontFamily ?? design.TvFontFamily;
				design.WidgetFontFamily = req.WidgetFontFamily ?? design.WidgetFontFamily;
				design.CompactFontFamily = req.CompactFontFamily ?? design.CompactFontFamily;
				design.UpdatedAtUtc = DateTime.UtcNow;
			}
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpPost("files/header-image")]
		[Authorize(Roles = "Admin,Editor")]
		[RequestSizeLimit(8 * 1024 * 1024)]
		public async Task<IActionResult> UploadHeaderImage(
			[FromQuery] Guid orgId,
			[FromForm] IFormFile? file,
			[FromServices] IStorageService storage)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			if (file is null || file.Length == 0) return BadRequest("Choose an image first.");
			if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
				return BadRequest("Header image must be an image file.");

			var extension = Path.GetExtension(file.FileName);
			if (string.IsNullOrWhiteSpace(extension) || extension.Length > 6) extension = ".jpg";
			var key = $"orgs/{orgId}/header-{Guid.NewGuid()}{extension.ToLowerInvariant()}";
			await using var stream = file.OpenReadStream();
			using var memory = new MemoryStream();
			await stream.CopyToAsync(memory);
			var publicUrl = await storage.UploadAsync(key, file.ContentType, memory.ToArray());

			var design = await _db.DesignSettings.FirstOrDefaultAsync(d => d.OrganizationId == orgId);
			if (design is null)
			{
				design = new DesignSettings
				{
					Id = Guid.NewGuid(),
					OrganizationId = orgId,
					HeaderImageUrl = publicUrl,
					Theme = "default"
				};
				_db.DesignSettings.Add(design);
			}
			else
			{
				design.HeaderImageUrl = publicUrl;
				design.UpdatedAtUtc = DateTime.UtcNow;
			}
			await _db.SaveChangesAsync();

			return Ok(new
			{
				publicUrl,
				appliedTo = new[] { "tv", "widget", "compactWidget", "schedulePreview" }
			});
		}

		private static string NormalizeTheme(string? theme) =>
			string.Equals(theme, "light", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(theme)
				? "default"
				: theme!.ToLowerInvariant();
	}
}
