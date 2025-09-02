// DeenTime.Core/Services/IPrayerTimeCalculator.cs
using DeenTime.Core.Entities;
using DeenTime.Contracts.Timings;

namespace DeenTime.Core.Services;

public interface IPrayerTimeCalculator
{
    PrayerTimesDto Compute(PrayerTimingCriteria c, DateOnly date);
}

