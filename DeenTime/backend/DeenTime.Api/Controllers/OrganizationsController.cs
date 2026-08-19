using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeenTime.Api.Responses.Pagination;
using DeenTime.Api.Requests.Organizations;
using DeenTime.Core.Enums;
using DeenTime.Api.Authorization;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Authorize]
	[Route("api/v1/orgs")]
	public sealed class OrganizationsController : ControllerBase
	{
		private readonly AppDbContext _db;
		public OrganizationsController(AppDbContext db) { _db = db; }

		[HttpGet]
		public async Task<IActionResult> List([FromQuery] string? search, [FromQuery] int page)
		{
			IQueryable<Organization> q = _db.Organizations.AsNoTracking();
			if (!string.IsNullOrWhiteSpace(search))
				q = q.Where(o => EF.Functions.ILike(o.Name, $"%{search}%"));
			if (page <= 0) page = 1;
			const int pageSize = 20;
			var total = await q.CountAsync();
			var items = await q.OrderBy(o => o.Name).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
			return Ok(new PagedResult<Organization>(items, page, pageSize, total));
		}

		[HttpGet("{idOrSlug}")]
		public async Task<IActionResult> Get(string idOrSlug)
		{
			Organization? org = null;
			if (Guid.TryParse(idOrSlug, out var id))
				org = await _db.Organizations.Include(x => x.Criteria).AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
			else
				org = await _db.Organizations.Include(x => x.Criteria).AsNoTracking().FirstOrDefaultAsync(x => x.Slug == idOrSlug);
			return org is not null ? Ok(org) : NotFound();
		}

		[Authorize("Admin")]
		[HttpPut("{id:guid}")]
		public async Task<IActionResult> Update(Guid id, [FromBody] OrganizationUpdateRequest input)
		{
			var existing = await _db.Organizations.Include(x => x.Criteria).FirstOrDefaultAsync(x => x.Id == id);
			if (existing is null) return NotFound();
			existing.Name = input.Name; existing.AddressLine = input.AddressLine;
			existing.City = input.City; existing.State = input.State; existing.ZipCode = input.ZipCode;
			existing.Phone = input.Phone; existing.WebsiteUrl = input.WebsiteUrl; existing.Email = input.Email;
			existing.SocialUrl = input.SocialUrl; existing.UpdatedAtUtc = DateTime.UtcNow;
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpGet("{id:guid}/criteria")]
		public async Task<IActionResult> GetCriteria(Guid id)
		{
			var existing = await _db.PrayerTimingCriteria.AsNoTracking().FirstOrDefaultAsync(c => c.OrganizationId == id);
			return existing is not null ? Ok(existing) : NotFound();
		}

		[HttpPut("{id:guid}/criteria")]
		public async Task<IActionResult> PutCriteria(Guid id, [FromBody] PrayerTimingCriteria input)
		{
			var existing = await _db.PrayerTimingCriteria.FirstOrDefaultAsync(c => c.OrganizationId == id);
			if (existing is null)
			{
				input.Id = Guid.NewGuid();
				input.OrganizationId = id;
				input.UpdatedAtUtc = DateTime.UtcNow;
				_db.PrayerTimingCriteria.Add(input);
			}
			else
			{
				existing.Method = input.Method;
				existing.JuristicMethodAsr = input.JuristicMethodAsr;
				existing.Latitude = input.Latitude;
				existing.Longitude = input.Longitude;
				existing.TimezoneId = input.TimezoneId;
				existing.DstObserved = input.DstObserved;
				existing.DstBegins = input.DstBegins;
				existing.DstEnds = input.DstEnds;
				existing.ZipCode = input.ZipCode;
				existing.MinutesAfterZawal = input.MinutesAfterZawal;
				existing.MinutesAfterMaghrib = input.MinutesAfterMaghrib;
				existing.KhutbahTimeMinutes = input.KhutbahTimeMinutes;
				existing.UpdatedAtUtc = DateTime.UtcNow;
			}
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpDelete("{id:guid}/criteria")]
		[Authorize(Roles = "Admin,Editor")]
		public async Task<IActionResult> DeleteCriteria(Guid id)
		{
			var existing = await _db.PrayerTimingCriteria.FirstOrDefaultAsync(c => c.OrganizationId == id);
			if (existing is null) return NoContent();
			_db.PrayerTimingCriteria.Remove(existing);
			await _db.SaveChangesAsync();
			return NoContent();
		}

		[HttpGet("{id:guid}/readiness")]
		public async Task<IActionResult> Readiness(Guid id, CancellationToken cancellationToken)
		{
			if (!User.CanAccessOrganization(id)) return Forbid();
			var organization = await _db.Organizations.AsNoTracking()
				.Include(item => item.Criteria)
				.Include(item => item.Design)
				.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
			if (organization is null) return NotFound();

			var today = DateOnly.FromDateTime(DateTime.UtcNow);
			var active = await _db.IqamaEntries.AsNoTracking()
				.Where(item => item.OrganizationId == id && item.Date <= today)
				.GroupBy(item => item.Salah)
				.Select(group => group.OrderByDescending(item => item.Date).ThenByDescending(item => item.UpdatedAtUtc).First())
				.ToArrayAsync(cancellationToken);
			var daily = new[] { SalahType.Fajr, SalahType.Dhuhr, SalahType.Asr, SalahType.Maghrib, SalahType.Isha };
			var dailyChecks = daily.ToDictionary(
				prayer => prayer.ToString(),
				prayer => active.Any(item => item.Salah == prayer));
			var jumuahCount = active.Count(item => item.Salah is SalahType.Jumuah or SalahType.Jumuah2nd or SalahType.Jumuah3rd or SalahType.Jumuah4th);
			var checks = new
			{
				criteria = organization.Criteria is not null,
				dailyIqama = dailyChecks,
				jumuah = jumuahCount > 0,
				design = organization.Design is not null && !string.IsNullOrWhiteSpace(organization.Design.HeaderImageUrl),
				publicPreview = organization.Criteria is not null
			};
			return Ok(new
			{
				readyToPublish = checks.criteria && checks.dailyIqama.Values.All(value => value) && checks.jumuah && checks.design,
				checks,
				jumuahCount,
				effectiveDate = today
			});
		}
	}
}
