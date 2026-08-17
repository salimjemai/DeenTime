using DeenTime.Core.Services;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Route("api/v1/[controller]")]
	public sealed class TimingsController : ControllerBase
	{
		private readonly AppDbContext _db;
		private readonly IPrayerTimeCalculator _calc;
		public TimingsController(AppDbContext db, IPrayerTimeCalculator calc)
		{
			_db = db; 
            _calc = calc;
		}

		[HttpGet]
        public async Task<IActionResult> Get([FromQuery] string orgId, [FromQuery] DateOnly date)
        {
            var org = await FindOrganization(orgId);
            if (org?.Criteria is null) return NotFound();
            var result = _calc.Compute(org.Criteria, date);
            return Ok(result);
        }

        [HttpGet("range")]
        public async Task<IActionResult> GetRange([FromQuery] string orgId, [FromQuery] DateOnly from, [FromQuery] DateOnly to)
        {
            if (to < from) return BadRequest("Invalid range");
            var org = await FindOrganization(orgId);
            if (org?.Criteria is null) return NotFound();
            var dates = Enumerable.Range(0, (to.DayNumber - from.DayNumber) + 1).Select(offset => from.AddDays(offset));
            var results = dates.Select(d => _calc.Compute(org.Criteria!, d)).ToArray();
			return Ok(results);
		}

        [HttpGet("today")]
        public async Task<IActionResult> Today([FromQuery] string orgId)
        {
            var org = await FindOrganization(orgId);
            if (org?.Criteria is null) return NotFound();
            var tz = TimeZoneInfo.FindSystemTimeZoneById(org.Criteria.TimezoneId);
            var localNow = TimeZoneInfo.ConvertTime(DateTime.UtcNow, tz);
			var date = DateOnly.FromDateTime(localNow);
            var result = _calc.Compute(org.Criteria, date);
            return Ok(result);
        }

        private Task<DeenTime.Core.Entities.Organization?> FindOrganization(string idOrSlug)
        {
            if (Guid.TryParse(idOrSlug, out var id))
            {
                return _db.Organizations
                    .Include(o => o.Criteria)
                    .FirstOrDefaultAsync(o => o.Id == id);
            }

            return _db.Organizations
                .Include(o => o.Criteria)
                .FirstOrDefaultAsync(o => o.Slug == idOrSlug);
        }
    }
}
