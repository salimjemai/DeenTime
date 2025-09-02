using DeenTime.Core.Enums;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Core.Entities
{
    public sealed class PublishArtifact
    {
        public Guid Id { get; set; }
        public Guid OrganizationId { get; set; }
        public int Year { get; set; }
        public int Month { get; set; }
        public PdfSize Size { get; set; }
        public PdfOrientation Orientation { get; set; }
        public string StorageUrl { get; set; } = "";  // where the PDF is stored
        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    }
}
