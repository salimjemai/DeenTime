using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

// DeenTime.Core/Entities/PrayerTimingCriteria.cs
namespace DeenTime.Core.Entities;

public sealed class PrayerTimingCriteria
{
    public Guid Id { get; set; }
    public Guid OrganizationId { get; set; }
    public string Method { get; set; } = "ISNA";             // calc method
    public string JuristicMethodAsr { get; set; } = "Other"; // Hanafi/Shafi'i/Maliki/Other
    public decimal Latitude { get; set; }
    public decimal Longitude { get; set; }
    public string TimezoneId { get; set; } = "America/Chicago";
    public bool DstObserved { get; set; } = true;
    public DateOnly? DstBegins { get; set; }
    public DateOnly? DstEnds { get; set; }
    public string ZipCode { get; set; } = "";
    public int MinutesAfterZawal { get; set; } = 1;
    public int MinutesAfterMaghrib { get; set; } = 2;
    public int KhutbahTimeMinutes { get; set; } = 30;
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
    public Organization Organization { get; set; } = default!;
}