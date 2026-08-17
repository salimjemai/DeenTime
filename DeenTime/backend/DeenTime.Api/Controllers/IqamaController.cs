using DeenTime.Core.Entities;
using DeenTime.Core.Enums;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeenTime.Api.Requests.Iqama;
using DeenTime.Api.Authorization;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/[controller]")]
	public sealed class IqamaController : ControllerBase
	{
		private readonly AppDbContext _db;
		public IqamaController(AppDbContext db) { _db = db; }

		[HttpGet]
		public async Task<IActionResult> List([FromQuery] Guid orgId, [FromQuery] int year)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var items = await _db.IqamaEntries.AsNoTracking()
				.Where(i => i.OrganizationId == orgId && i.Date.Year == year)
				.OrderBy(i => i.Date).ThenBy(i => i.Salah).ToListAsync();
			return Ok(items);
		}

		[HttpGet("current")]
		public async Task<IActionResult> Current(
			[FromQuery] Guid orgId,
			[FromQuery] DateOnly? date,
			CancellationToken cancellationToken)
		{
			if (!User.CanAccessOrganization(orgId)) return Forbid();
			var effectiveDate = date ?? DateOnly.FromDateTime(DateTime.UtcNow);
			var history = await _db.IqamaEntries.AsNoTracking()
				.Where(entry => entry.OrganizationId == orgId && entry.Date <= effectiveDate)
				.OrderBy(entry => entry.Date)
				.ThenBy(entry => entry.UpdatedAtUtc)
				.ToListAsync(cancellationToken);

			var current = history
				.GroupBy(entry => entry.Salah)
				.Select(group => group.Last())
				.OrderBy(entry => SalahOrder(entry.Salah))
				.ToArray();
			return Ok(current);
		}

		[HttpPut("schedule")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> UpdateSchedule(
			[FromBody] IqamaScheduleUpsertRequest req,
			CancellationToken cancellationToken)
		{
			if (!User.CanAccessOrganization(req.OrganizationId)) return Forbid();
			if (req.Entries is null || req.Entries.Length == 0)
				return BadRequest("Add at least one Iqama time.");
			if (req.Entries.Length > 9)
				return BadRequest("A schedule can contain at most nine prayer entries.");
			if (req.Entries.GroupBy(entry => entry.Salah).Any(group => group.Count() > 1))
				return BadRequest("Each prayer can appear only once for an effective date.");
			if (req.Entries.Any(entry => entry.OffsetMinutes is < 0 or > 180))
				return BadRequest("Minutes after prayer start must be between 0 and 180.");

			var salahs = req.Entries.Select(entry => entry.Salah).ToArray();
			var existing = await _db.IqamaEntries
				.Where(entry => entry.OrganizationId == req.OrganizationId &&
					entry.Date == req.EffectiveDate && salahs.Contains(entry.Salah))
				.ToDictionaryAsync(entry => entry.Salah, cancellationToken);

			foreach (var item in req.Entries)
			{
				if (!existing.TryGetValue(item.Salah, out var entity))
				{
					entity = new IqamaEntry
					{
						Id = Guid.NewGuid(),
						OrganizationId = req.OrganizationId,
						Date = req.EffectiveDate,
						Salah = item.Salah
					};
					_db.IqamaEntries.Add(entity);
				}

				entity.Time = item.Time;
				entity.OffsetMinutes = item.OffsetMinutes;
				entity.Note = string.IsNullOrWhiteSpace(item.Note) ? null : item.Note.Trim();
				entity.UpdatedAtUtc = DateTime.UtcNow;
			}

			await _db.SaveChangesAsync(cancellationToken);
			var saved = req.Entries
				.Select(item => existing.GetValueOrDefault(item.Salah) ??
					_db.IqamaEntries.Local.First(entry => entry.OrganizationId == req.OrganizationId &&
						entry.Date == req.EffectiveDate && entry.Salah == item.Salah))
				.OrderBy(entry => SalahOrder(entry.Salah))
				.ToArray();
			return Ok(saved);
		}

		[HttpPost]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Create([FromBody] IqamaUpsertRequest req)
		{
			if (!User.CanAccessOrganization(req.OrganizationId)) return Forbid();
			if (req.OffsetMinutes is < 0 or > 180) return BadRequest("Minutes after prayer start must be between 0 and 180.");
			if (await _db.IqamaEntries.AnyAsync(entry => entry.OrganizationId == req.OrganizationId && entry.Date == req.Date && entry.Salah == req.Salah))
				return Conflict("An Iqama entry already exists for that prayer and effective date.");
			var entity = new IqamaEntry
			{
				Id = Guid.NewGuid(), OrganizationId = req.OrganizationId, Date = req.Date,
				Salah = req.Salah, Time = req.Time, Note = req.Note, OffsetMinutes = req.OffsetMinutes
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
			if (!User.CanAccessOrganization(existing.OrganizationId) || req.OrganizationId != existing.OrganizationId) return Forbid();
			if (req.OffsetMinutes is < 0 or > 180) return BadRequest("Minutes after prayer start must be between 0 and 180.");
			existing.Date = req.Date; existing.Salah = req.Salah;
			existing.Time = req.Time; existing.Note = req.Note; existing.UpdatedAtUtc = DateTime.UtcNow;
			existing.OffsetMinutes = req.OffsetMinutes;
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpDelete("{id:guid}")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> Delete(Guid id)
		{
			var existing = await _db.IqamaEntries.FirstOrDefaultAsync(i => i.Id == id);
			if (existing is null) return NotFound();
			if (!User.CanAccessOrganization(existing.OrganizationId)) return Forbid();
			_db.IqamaEntries.Remove(existing);
			await _db.SaveChangesAsync();
			return NoContent();
		}

		private static int SalahOrder(SalahType salah) => salah switch
		{
			SalahType.Fajr => 0,
			SalahType.Dhuhr => 1,
			SalahType.Asr => 2,
			SalahType.Maghrib => 3,
			SalahType.Isha => 4,
			SalahType.Jumuah => 5,
			SalahType.Jumuah2nd => 6,
			SalahType.Jumuah3rd => 7,
			SalahType.Jumuah4th => 8,
			_ => 99
		};
	}
}
