using DeenTime.Core.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Core.Entities
{
    public sealed class IqamaEntry
    {
        public Guid Id { get; set; }
        public Guid OrganizationId { get; set; }
        public DateOnly Date { get; set; }                  // each row in your list
        public SalahType Salah { get; set; }
        public TimeOnly Time { get; set; }                  // iqama time shown/printed
        public string? Note { get; set; }                   // optional (e.g., “Summer schedule”)
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
        public Organization Organization { get; set; } = default!;
    }
}
