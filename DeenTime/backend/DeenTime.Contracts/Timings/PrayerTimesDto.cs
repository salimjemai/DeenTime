using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Contracts.Timings;

public sealed record PrayerTimesDto(DateOnly Date, TimeOnly Fajr, TimeOnly Dhuhr, TimeOnly Asr, TimeOnly Maghrib, TimeOnly Isha);

