using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.OutputCaching;
using DeenTime.Api.Requests.Iqama;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class IqamaController : ControllerBase
	{
		public record IqamaUpsertRequest(Guid OrganizationId, DateOnly Date, SalahType Salah, TimeOnly Time, string? Note);
		private readonly AppDbContext _db;
		public IqamaController(AppDbContext db) { _db = db; }

		[HttpGet]
		[OutputCache(PolicyName = "public-read")]
		public async Task<IActionResult> List([FromQuery] Guid orgId, [FromQuery] int year)
		{
			var items = await _db.IqamaEntries.AsNoTracking()
				.Where(i => i.OrganizationId == orgId && i.Date.Year == year)
				.OrderBy(i => i.Date).ThenBy(i => i.Salah).ToListAsync();
			var grouped = items.GroupBy(i => i.Date.Month).OrderBy(g => g.Key).ToDictionary(g => g.Key, g => g.ToList());
			return Ok(grouped);
		}

		[HttpPost]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Create([FromBody] IqamaUpsertRequest req)
		{
			var entity = new IqamaEntry
			{
				Id = Guid.NewGuid(), OrganizationId = req.OrganizationId, Date = req.Date,
				Salah = req.Salah, Time = req.Time, Note = req.Note
			};
			_db.IqamaEntries.Add(entity);
			await _db.SaveChangesAsync();
			return Created($"/api/v1/iqama/{entity.Id}", entity);
		}

		[HttpPut("{id:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Update(Guid id, [FromBody] IqamaUpsertRequest req)
		{
			var existing = await _db.IqamaEntries.FirstOrDefaultAsync(i => i.Id == id);
			if (existing is null) return NotFound();
			existing.OrganizationId = req.OrganizationId; existing.Date = req.Date; existing.Salah = req.Salah;
			existing.Time = req.Time; existing.Note = req.Note; existing.UpdatedAtUtc = DateTime.UtcNow;
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpDelete("{id:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Delete(Guid id)
		{
			var existing = await _db.IqamaEntries.FirstOrDefaultAsync(i => i.Id == id);
			if (existing is null) return NotFound();
			_db.IqamaEntries.Remove(existing);
			await _db.SaveChangesAsync();
			return NoContent();
		}
	}
}
