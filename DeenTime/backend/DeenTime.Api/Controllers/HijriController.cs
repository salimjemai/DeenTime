using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.OutputCaching;
using DeenTime.Core.Services;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class HijriController : ControllerBase
	{
		public record HijriUpsertRequest(Guid OrganizationId, int Year, int Month, int HijriDayOnFirst, bool Locked);
		private readonly AppDbContext _db;
		public HijriController(AppDbContext db) { _db = db; }

		[HttpGet("{orgId:guid}")]
		[OutputCache(PolicyName = "public-read")]
		public async Task<IActionResult> Get(Guid orgId, [FromQuery] string from, [FromQuery] string to)
		{
			if (!DateOnly.TryParse(from + "-01", out var fromDate) || !DateOnly.TryParse(to + "-01", out var toDate))
				return BadRequest("Invalid YYYY-MM range");
			var (fy, fm) = (fromDate.Year, fromDate.Month);
			var (ty, tm) = (toDate.Year, toDate.Month);
			var all = await _db.HijriMonthMaps.AsNoTracking()
				.Where(h => h.OrganizationId == orgId)
				.Where(h => (h.Year > fy || (h.Year == fy && h.Month >= fm)) && (h.Year < ty || (h.Year == ty && h.Month <= tm)))
				.OrderBy(h => h.Year).ThenBy(h => h.Month)
				.ToListAsync();
			return Ok(all);
		}

		[HttpPost]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Create([FromBody] HijriUpsertRequest req)
		{
			var entity = new HijriMonthMap
			{
				Id = Guid.NewGuid(), OrganizationId = req.OrganizationId,
				Year = req.Year, Month = req.Month, HijriDayOnFirst = req.HijriDayOnFirst, Locked = req.Locked
			};
			_db.HijriMonthMaps.Add(entity);
			await _db.SaveChangesAsync();
			return Created($"/api/v1/hijri/{entity.Id}", entity);
		}

		[HttpPut("{id:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Update(Guid id, [FromBody] HijriUpsertRequest req)
		{
			var existing = await _db.HijriMonthMaps.FirstOrDefaultAsync(h => h.Id == id);
			if (existing is null) return NotFound();
			existing.OrganizationId = req.OrganizationId;
			existing.Year = req.Year;
			existing.Month = req.Month;
			existing.HijriDayOnFirst = req.HijriDayOnFirst;
			existing.Locked = req.Locked;
			existing.UpdatedAtUtc = DateTime.UtcNow;
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpPost("regenerate/{orgId:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Regenerate(Guid orgId, [FromQuery] string from, [FromQuery] string to, [FromServices] IHijriService hijri)
		{
			if (!DateOnly.TryParse(from + "-01", out var f) || !DateOnly.TryParse(to + "-01", out var t)) return BadRequest("Invalid range");
			var existing = await _db.HijriMonthMaps.Where(h => h.OrganizationId == orgId &&
					(h.Year > f.Year || (h.Year == f.Year && h.Month >= f.Month)) &&
					(h.Year < t.Year || (h.Year == t.Year && h.Month <= t.Month)))
					.ToListAsync();
			var locked = existing.Where(x => x.Locked).ToDictionary(x => (x.Year, x.Month));
			_db.HijriMonthMaps.RemoveRange(existing.Where(x => !x.Locked));
			var generated = hijri.Generate(orgId, f, t).Where(m => !locked.ContainsKey((m.Year, m.Month)));
			await _db.HijriMonthMaps.AddRangeAsync(generated);
			await _db.SaveChangesAsync();
			return Ok(new { regenerated = generated.Count(), preservedLocked = locked.Count });
		}
	}
}
