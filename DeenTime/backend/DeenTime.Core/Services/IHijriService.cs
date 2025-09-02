using DeenTime.Core.Entities;

namespace DeenTime.Core.Services;

public interface IHijriService
{
	IEnumerable<HijriMonthMap> Generate(Guid orgId, DateOnly from, DateOnly to);
}


