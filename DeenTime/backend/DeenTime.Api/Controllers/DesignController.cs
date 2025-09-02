using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.OutputCaching;
using DeenTime.Api.Requests.Design;
using DeenTime.Core.Services;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class DesignController : ControllerBase
	{
		public record DesignRequest(string? HeaderImageUrl, string[] IqamaHeadings, string? FooterHtml, string Theme);
		private readonly AppDbContext _db;
		public DesignController(AppDbContext db) { _db = db; }

		[HttpGet("{orgId:guid}")]
		[OutputCache(PolicyName = "public-read")]
		public async Task<IActionResult> Get(Guid orgId)
		{
			var design = await _db.DesignSettings.AsNoTracking().FirstOrDefaultAsync(d => d.OrganizationId == orgId);
			return design is not null ? Ok(design) : NotFound();
		}

		[HttpPut("{orgId:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Put(Guid orgId, [FromBody] DesignRequest req)
		{
			var design = await _db.DesignSettings.FirstOrDefaultAsync(d => d.OrganizationId == orgId);
			if (design is null)
			{
				design = new DesignSettings
				{
					Id = Guid.NewGuid(), OrganizationId = orgId,
					HeaderImageUrl = req.HeaderImageUrl,
					IqamaHeadings = req.IqamaHeadings ?? [],
					FooterHtml = req.FooterHtml,
					Theme = req.Theme
				};
				_db.DesignSettings.Add(design);
			}
			else
			{
				design.HeaderImageUrl = req.HeaderImageUrl;
				design.IqamaHeadings = req.IqamaHeadings ?? [];
				design.FooterHtml = req.FooterHtml;
				design.Theme = req.Theme;
				design.UpdatedAtUtc = DateTime.UtcNow;
			}
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpPost("files/header-image")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> UploadHeaderImage([FromQuery] Guid orgId, [FromServices] IStorageService storage, [FromQuery] string contentType = "image/jpeg")
		{
			var key = $"orgs/{orgId}/header-{Guid.NewGuid()}.jpg";
			var presigned = await storage.CreatePresignedUploadAsync(key, contentType);
			return Ok(new { uploadUrl = presigned.UploadUrl, publicUrl = presigned.PublicUrl });
		}
	}
}
