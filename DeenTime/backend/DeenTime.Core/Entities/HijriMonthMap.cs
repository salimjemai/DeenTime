using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Core.Entities
{
    public sealed class HijriMonthMap
    {
        public Guid Id { get; set; }
        public Guid OrganizationId { get; set; }
        public int Year { get; set; }       // Gregorian year
        public int Month { get; set; }      // 1..12 Gregorian
        public int HijriDayOnFirst { get; set; }
        public int HijriMonthOnFirst { get; set; }
        public int HijriYearOnFirst { get; set; }
        public bool Locked { get; set; }          // prevent regen from overwriting manual fixes
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    }

}
