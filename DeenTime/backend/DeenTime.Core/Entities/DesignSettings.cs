using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Core.Entities
{
    public sealed class DesignSettings
    {
        public Guid Id { get; set; }
        public Guid OrganizationId { get; set; }
        public string? HeaderImageUrl { get; set; }    // blob/CDN path
        public string[] IqamaHeadings { get; set; } = Array.Empty<string>(); // e.g., ["Fajr","IQM*","Sunrise",...]
        public string? FooterHtml { get; set; }        // rich text for publish PDFs & widgets
        public string Theme { get; set; } = "light";   // allow dark/brand themes
        public DateTime UpdatedAtUtc { get; set; } = DateTime.UtcNow;
        public Organization Organization { get; set; } = default!;
    }

}
