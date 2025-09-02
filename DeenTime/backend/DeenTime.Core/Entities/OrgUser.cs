using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Core.Entities
{
    public sealed class OrgUser {
        public Guid Id { get; set; }
        public Guid OrganizationId { get; set; }

        // External identity linkage
        public string Issuer { get; set; } = "";    // e.g., https://YOUR_IDP/
        public string Subject { get; set; } = "";   // sub claim from JWT

        // Optional convenience fields
        public string? Email { get; set; }
        public string? DisplayName { get; set; }
        public string[] Roles { get; set; } = [];   // or a join table if you prefer
        public DateTime LastSeenUtc { get; set; } = DateTime.UtcNow;

        public Organization Organization { get; set; } = default!;
    }
}
