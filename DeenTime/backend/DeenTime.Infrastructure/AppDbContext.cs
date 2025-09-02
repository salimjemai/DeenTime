using DeenTime.Core.Entities;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Infrastructure;

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Organization> Organizations => Set<Organization>();
    public DbSet<PrayerTimingCriteria> PrayerTimingCriteria => Set<PrayerTimingCriteria>();
    public DbSet<IqamaEntry> IqamaEntries => Set<IqamaEntry>();
    public DbSet<DesignSettings> DesignSettings => Set<DesignSettings>();
    public DbSet<HijriMonthMap> HijriMonthMaps => Set<HijriMonthMap>();
    public DbSet<PublishArtifact> PublishArtifacts => Set<PublishArtifact>();
    public DbSet<TvDisplayConfig> TvDisplayConfigs => Set<TvDisplayConfig>();
    public DbSet<OrgUser> OrgUsers => Set<OrgUser>();
    public DbSet<AppUser> AppUsers => Set<AppUser>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<Organization>()
            .HasOne(o => o.Criteria)
            .WithOne(c => c.Organization)
            .HasForeignKey<PrayerTimingCriteria>(c => c.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<Organization>()
            .HasOne(o => o.Design)
            .WithOne(d => d.Organization)
            .HasForeignKey<DesignSettings>(d => d.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<Organization>()
            .HasMany<IqamaEntry>()
            .WithOne(i => i.Organization)
            .HasForeignKey(i => i.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<Organization>()
            .HasMany<PublishArtifact>()
            .WithOne()
            .HasForeignKey(p => p.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<Organization>()
            .HasMany<OrgUser>()
            .WithOne()
            .HasForeignKey(ou => ou.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<OrgUser>()
            .HasIndex(x => new { x.OrganizationId, x.Issuer, x.Subject })
            .IsUnique();


        b.Entity<AppUser>().HasIndex(u => u.Email).IsUnique();
        b.Entity<Organization>().HasIndex(o => o.Name);
        b.Entity<PrayerTimingCriteria>().HasIndex(c => new { c.OrganizationId });
        b.Entity<Organization>().HasIndex(o => o.Slug).IsUnique();
        b.Entity<IqamaEntry>().HasIndex(i => new { i.OrganizationId, i.Date, i.Salah }).IsUnique();
        b.Entity<DesignSettings>().HasIndex(d => new { d.OrganizationId }).IsUnique();
        b.Entity<TvDisplayConfig>().HasIndex(t => new { t.OrganizationId }).IsUnique();
        b.Entity<HijriMonthMap>().HasIndex(h => new { h.OrganizationId, h.Year, h.Month }).IsUnique();
        b.Entity<PublishArtifact>().HasIndex(p => new { p.OrganizationId, p.Year, p.Month });
    }
}