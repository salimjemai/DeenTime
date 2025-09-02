using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;

namespace DeenTime.Core.Entities
{
    public sealed class TvDisplayConfig
    {
        public Guid Id { get; set; }
        public Guid OrganizationId { get; set; }
        public bool ShowSeconds { get; set; } = true;
        public bool ShowHijri { get; set; } = true;
        public string AccentColor { get; set; } = "#00AEEF";
        public int AutoRefreshSeconds { get; set; } = 30;
    }
}
