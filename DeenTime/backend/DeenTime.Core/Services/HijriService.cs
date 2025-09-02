using DeenTime.Core.Entities;

namespace DeenTime.Core.Services;

public sealed class HijriService : IHijriService
{
	public IEnumerable<HijriMonthMap> Generate(Guid orgId, DateOnly from, DateOnly to)
	{
		var months = new List<HijriMonthMap>();
		var cursor = new DateOnly(from.Year, from.Month, 1);
		var end = new DateOnly(to.Year, to.Month, 1);
		while (cursor <= end)
		{
			months.Add(new HijriMonthMap
			{
				Id = Guid.NewGuid(),
				OrganizationId = orgId,
				Year = cursor.Year,
				Month = cursor.Month,
				HijriDayOnFirst = 1,
				Locked = false
			});
			cursor = cursor.AddMonths(1);
		}
		return months;
	}
}


