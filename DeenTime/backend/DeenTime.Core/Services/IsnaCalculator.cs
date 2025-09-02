using DeenTime.Contracts.Timings;
using DeenTime.Core.Entities;

namespace DeenTime.Core.Services;

public sealed class IsnaCalculator : IPrayerTimeCalculator
{
    public PrayerTimesDto Compute(PrayerTimingCriteria c, DateOnly date)
    {
        // TODO: implement proper solar-angle algorithm (ISNA) & juristic Asr
        // For now, a placeholder to keep the API flowing:
        return new PrayerTimesDto(
            date,
            new TimeOnly(5, 40), new TimeOnly(12, 58),
            new TimeOnly(16, 22), new TimeOnly(19, 31),
            new TimeOnly(20, 45));
    }
}

