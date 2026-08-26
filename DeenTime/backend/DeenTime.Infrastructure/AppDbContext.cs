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
    public DbSet<QuranEdition> QuranEditions => Set<QuranEdition>();
    public DbSet<IslamicContentCacheEntry> IslamicContentCacheEntries => Set<IslamicContentCacheEntry>();
    public DbSet<IslamicContentSyncState> IslamicContentSyncStates => Set<IslamicContentSyncState>();
    public DbSet<HadithBook> HadithBooks => Set<HadithBook>();
    public DbSet<HadithChapter> HadithChapters => Set<HadithChapter>();
    public DbSet<HadithRecord> HadithRecords => Set<HadithRecord>();
    public DbSet<ApiClient> ApiClients => Set<ApiClient>();
    public DbSet<ApiClientUsage> ApiClientUsage => Set<ApiClientUsage>();
    public DbSet<PendingRegistration> PendingRegistrations => Set<PendingRegistration>();
    public DbSet<MasjidInvitation> MasjidInvitations => Set<MasjidInvitation>();

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
            .WithOne(ou => ou.Organization)
            .HasForeignKey(ou => ou.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<Organization>()
            .HasMany<ApiClient>()
            .WithOne(client => client.Organization)
            .HasForeignKey(client => client.OrganizationId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<ApiClient>().HasIndex(client => new { client.OrganizationId, client.Name }).IsUnique();
        b.Entity<ApiClient>().HasIndex(client => client.KeyPrefix).IsUnique();
        b.Entity<ApiClient>().Property(client => client.Scopes).HasColumnType("text[]");
        b.Entity<ApiClientUsage>().HasIndex(usage => new { usage.ApiClientId, usage.UsedAtUtc });
        b.Entity<ApiClientUsage>().HasOne(usage => usage.ApiClient)
            .WithMany()
            .HasForeignKey(usage => usage.ApiClientId)
            .OnDelete(DeleteBehavior.Cascade);

        b.Entity<OrgUser>()
            .HasIndex(x => new { x.OrganizationId, x.Issuer, x.Subject })
            .IsUnique();

        b.Entity<AppUser>().Property(u => u.Email).HasMaxLength(320);
        b.Entity<AppUser>().HasIndex(u => u.Email).IsUnique();
        b.Entity<Organization>().Property(o => o.Name).HasMaxLength(160);
        b.Entity<Organization>().Property(o => o.NormalizedName).HasMaxLength(160);
        b.Entity<Organization>().Property(o => o.NormalizedWebsiteHost).HasMaxLength(253);
        b.Entity<Organization>().Property(o => o.AddressFingerprint).HasMaxLength(64);
        b.Entity<Organization>().Property(o => o.MasjidIdentityKey).HasMaxLength(64);
        b.Entity<Organization>().Property(o => o.AdminUserId).HasMaxLength(120);
        b.Entity<Organization>().HasIndex(o => o.NormalizedWebsiteHost).IsUnique()
            .HasFilter("\"NormalizedWebsiteHost\" IS NOT NULL");
        b.Entity<Organization>().HasIndex(o => o.AddressFingerprint).IsUnique()
            .HasFilter("\"AddressFingerprint\" IS NOT NULL");
        b.Entity<Organization>().HasIndex(o => o.MasjidIdentityKey).IsUnique()
            .HasFilter("\"MasjidIdentityKey\" IS NOT NULL");
        b.Entity<Organization>().HasIndex(o => o.Name);
        b.Entity<PrayerTimingCriteria>().HasIndex(c => new { c.OrganizationId });
        b.Entity<Organization>().HasIndex(o => o.Slug).IsUnique();
        b.Entity<IqamaEntry>().HasIndex(i => new { i.OrganizationId, i.Date, i.Salah }).IsUnique();
        b.Entity<DesignSettings>().HasIndex(d => new { d.OrganizationId }).IsUnique();
        b.Entity<DesignSettings>().Property(d => d.TvFontScale).HasDefaultValue(100);
        b.Entity<DesignSettings>().Property(d => d.WidgetFontScale).HasDefaultValue(100);
        b.Entity<DesignSettings>().Property(d => d.CompactFontScale).HasDefaultValue(100);
        b.Entity<DesignSettings>().Property(d => d.TvFontFamily).HasDefaultValue("system");
        b.Entity<DesignSettings>().Property(d => d.WidgetFontFamily).HasDefaultValue("system");
        b.Entity<DesignSettings>().Property(d => d.CompactFontFamily).HasDefaultValue("system");
        b.Entity<TvDisplayConfig>().HasIndex(t => new { t.OrganizationId }).IsUnique();
        b.Entity<TvDisplayConfig>().Property(t => t.ClockFontScale).HasDefaultValue(160);
        b.Entity<HijriMonthMap>().HasIndex(h => new { h.OrganizationId, h.Year, h.Month }).IsUnique();
        b.Entity<PublishArtifact>().HasIndex(p => new { p.OrganizationId, p.Year, p.Month });

        b.Entity<QuranEdition>().HasKey(e => e.Identifier);
        b.Entity<QuranEdition>().Property(e => e.Identifier).HasMaxLength(120);
        b.Entity<QuranEdition>().Property(e => e.Language).HasMaxLength(12);
        b.Entity<QuranEdition>().Property(e => e.Format).HasMaxLength(24);
        b.Entity<QuranEdition>().Property(e => e.Type).HasMaxLength(40);
        b.Entity<QuranEdition>().Property(e => e.Direction).HasMaxLength(8);
        b.Entity<QuranEdition>().HasIndex(e => new { e.Language, e.Format, e.Type });

        b.Entity<IslamicContentCacheEntry>().Property(e => e.Provider).HasMaxLength(40);
        b.Entity<IslamicContentCacheEntry>().Property(e => e.CacheKey).HasMaxLength(600);
        b.Entity<IslamicContentCacheEntry>().Property(e => e.PayloadJson).HasColumnType("jsonb");
        b.Entity<IslamicContentCacheEntry>().Property(e => e.ContentType).HasMaxLength(80);
        b.Entity<IslamicContentCacheEntry>().HasIndex(e => new { e.Provider, e.CacheKey }).IsUnique();
        b.Entity<IslamicContentCacheEntry>().HasIndex(e => e.ExpiresAtUtc);

        b.Entity<IslamicContentSyncState>().HasKey(s => s.Key);
        b.Entity<IslamicContentSyncState>().Property(s => s.Key).HasMaxLength(120);
        b.Entity<IslamicContentSyncState>().Property(s => s.Provider).HasMaxLength(40);
        b.Entity<IslamicContentSyncState>().Property(s => s.Scope).HasMaxLength(40);
        b.Entity<IslamicContentSyncState>().Property(s => s.Status).HasMaxLength(24);

        b.Entity<HadithBook>().HasKey(h => h.ProviderId);
        b.Entity<HadithBook>().Property(h => h.ProviderId).ValueGeneratedNever();
        b.Entity<HadithBook>().Property(h => h.BookSlug).HasMaxLength(80);
        b.Entity<HadithBook>().HasIndex(h => h.BookSlug).IsUnique();

        b.Entity<HadithChapter>().Property(h => h.BookSlug).HasMaxLength(80);
        b.Entity<HadithChapter>().HasIndex(h => new { h.BookSlug, h.ChapterNumber }).IsUnique();
        b.Entity<HadithChapter>().HasIndex(h => h.ProviderId);

        b.Entity<HadithRecord>().Property(h => h.BookSlug).HasMaxLength(80);
        b.Entity<HadithRecord>().Property(h => h.HadithNumber).HasMaxLength(80);
        b.Entity<HadithRecord>().Property(h => h.Status).HasMaxLength(80);
        b.Entity<HadithRecord>().HasIndex(h => new { h.BookSlug, h.HadithNumber }).IsUnique();
        b.Entity<HadithRecord>().HasIndex(h => new { h.BookSlug, h.ChapterNumber });
        b.Entity<HadithRecord>().HasIndex(h => h.Status);
        b.Entity<HadithRecord>().HasIndex(h => h.ProviderId);

        b.Entity<PendingRegistration>().Property(p => p.Email).HasMaxLength(320);
        b.Entity<PendingRegistration>().Property(p => p.NormalizedEmail).HasMaxLength(320);
        b.Entity<PendingRegistration>().Property(p => p.OrganizationName).HasMaxLength(160);
        b.Entity<PendingRegistration>().Property(p => p.NormalizedName).HasMaxLength(160);
        b.Entity<PendingRegistration>().Property(p => p.WebsiteUrl).HasMaxLength(2048);
        b.Entity<PendingRegistration>().Property(p => p.NormalizedWebsiteHost).HasMaxLength(253);
        b.Entity<PendingRegistration>().Property(p => p.AddressLine).HasMaxLength(240);
        b.Entity<PendingRegistration>().Property(p => p.City).HasMaxLength(120);
        b.Entity<PendingRegistration>().Property(p => p.State).HasMaxLength(2);
        b.Entity<PendingRegistration>().Property(p => p.ZipCode).HasMaxLength(10);
        b.Entity<PendingRegistration>().Property(p => p.AddressFingerprint).HasMaxLength(64);
        b.Entity<PendingRegistration>().Property(p => p.MasjidIdentityKey).HasMaxLength(64);
        b.Entity<PendingRegistration>().Property(p => p.VerificationTokenHash).HasMaxLength(64);
        b.Entity<PendingRegistration>().HasIndex(p => p.NormalizedEmail).IsUnique();
        b.Entity<PendingRegistration>().HasIndex(p => p.NormalizedWebsiteHost).IsUnique();
        b.Entity<PendingRegistration>().HasIndex(p => p.AddressFingerprint).IsUnique();
        b.Entity<PendingRegistration>().HasIndex(p => p.MasjidIdentityKey).IsUnique();
        b.Entity<PendingRegistration>().HasIndex(p => p.VerificationTokenHash).IsUnique();
        b.Entity<PendingRegistration>().HasIndex(p => p.VerificationExpiresAtUtc);

        b.Entity<MasjidInvitation>().Property(i => i.Email).HasMaxLength(320);
        b.Entity<MasjidInvitation>().Property(i => i.NormalizedEmail).HasMaxLength(320);
        b.Entity<MasjidInvitation>().Property(i => i.OrganizationName).HasMaxLength(160);
        b.Entity<MasjidInvitation>().Property(i => i.NormalizedOrganizationName).HasMaxLength(160);
        b.Entity<MasjidInvitation>().Property(i => i.WebsiteUrl).HasMaxLength(2048);
        b.Entity<MasjidInvitation>().Property(i => i.AddressLine).HasMaxLength(240);
        b.Entity<MasjidInvitation>().Property(i => i.City).HasMaxLength(120);
        b.Entity<MasjidInvitation>().Property(i => i.State).HasMaxLength(2);
        b.Entity<MasjidInvitation>().Property(i => i.ZipCode).HasMaxLength(10);
        b.Entity<MasjidInvitation>().Property(i => i.InvitationTokenHash).HasMaxLength(64);
        b.Entity<MasjidInvitation>().Property(i => i.InvitedBySubject).HasMaxLength(120);
        b.Entity<MasjidInvitation>().HasIndex(i => i.InvitationTokenHash).IsUnique();
        b.Entity<MasjidInvitation>().HasIndex(i => i.NormalizedEmail);
        b.Entity<MasjidInvitation>().HasIndex(i => i.ExpiresAtUtc);
        b.Entity<MasjidInvitation>().HasOne(i => i.Organization)
            .WithMany()
            .HasForeignKey(i => i.OrganizationId)
            .OnDelete(DeleteBehavior.SetNull);
        b.Entity<PendingRegistration>().HasOne(p => p.Invitation)
            .WithMany()
            .HasForeignKey(p => p.InvitationId)
            .OnDelete(DeleteBehavior.SetNull);
    }
}
