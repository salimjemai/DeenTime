using DeenTime.Core.Entities;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

// DeenTime.Core/Entities/Organization.cs
namespace DeenTime.Core.Entities;

public sealed class Organization
{
    public Guid Id { get; set; }
    public string Slug { get; set; } = "";  // unique
    public string Name { get; set; } = "";
    public string? AddressLine { get; set; }
    public string? City { get; set; }
    public string? State { get; set; }
    public string? ZipCode { get; set; }
    public string? Phone { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Email { get; set; }
    public string? SocialUrl { get; set; }
    public PrayerTimingCriteria? Criteria { get; set; }
    public DesignSettings? Design { get; set; }
    public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
}

