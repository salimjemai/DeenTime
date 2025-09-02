using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DeenTime.Api.Responses.Pagination;
using DeenTime.Api.Requests.Organizations;

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
	}
}
