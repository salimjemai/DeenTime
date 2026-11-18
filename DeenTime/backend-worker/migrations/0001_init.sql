-- MasjidHub schema for Cloudflare D1 (SQLite).
-- Translation of backend-node/prisma/migrations/0_baseline/migration.sql. Table, column,
-- index and constraint names are identical to PostgreSQL so rows can be copied across.
--
-- Column formats (see README.md "Column formats"):
--   uuid            TEXT     lowercase 8-4-4-4-12
--   timestamptz     TEXT     ISO-8601 UTC with milliseconds, "2026-11-18T09:30:00.000Z" (Date.toISOString())
--   date            TEXT     "YYYY-MM-DD"
--   time            TEXT     "HH:mm:ss"
--   text[]          TEXT     JSON array of strings, '["Admin"]'
--   jsonb           TEXT     JSON document
--   decimal         REAL
--   bigint          INTEGER
--   boolean         INTEGER  0 or 1
--   varchar(n)      TEXT     (length is not enforced by SQLite; the zod schemas enforce it)

CREATE TABLE "ApiClientUsage" (
    "Id" TEXT NOT NULL,
    "ApiClientId" TEXT NOT NULL,
    "Endpoint" TEXT NOT NULL,
    "UsedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_ApiClientUsage" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_ApiClientUsage_ApiClients_ApiClientId" FOREIGN KEY ("ApiClientId") REFERENCES "ApiClients"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "ApiClients" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "KeyPrefix" TEXT NOT NULL,
    "SecretHash" TEXT NOT NULL,
    "Scopes" TEXT,
    "RequestsPerMinute" INTEGER NOT NULL,
    "CreatedAtUtc" TEXT NOT NULL,
    "LastUsedAtUtc" TEXT,
    "RevokedAtUtc" TEXT,
    CONSTRAINT "PK_ApiClients" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_ApiClients_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "AppUsers" (
    "Id" TEXT NOT NULL,
    "DisplayName" TEXT,
    "Email" TEXT,
    "PasswordHash" TEXT NOT NULL,
    "PasswordSalt" TEXT NOT NULL,
    "PasswordResetExpiresAtUtc" TEXT,
    "PasswordResetTokenHash" TEXT,
    CONSTRAINT "PK_AppUsers" PRIMARY KEY ("Id")
);

CREATE TABLE "DesignSettings" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "HeaderImageUrl" TEXT,
    "IqamaHeadings" TEXT,
    "FooterHtml" TEXT,
    "Theme" TEXT NOT NULL,
    "UpdatedAtUtc" TEXT NOT NULL,
    "CompactFontFamily" TEXT NOT NULL DEFAULT 'system',
    "CompactFontScale" INTEGER NOT NULL DEFAULT 100,
    "TvFontFamily" TEXT NOT NULL DEFAULT 'system',
    "TvFontScale" INTEGER NOT NULL DEFAULT 100,
    "WidgetFontFamily" TEXT NOT NULL DEFAULT 'system',
    "WidgetFontScale" INTEGER NOT NULL DEFAULT 100,
    CONSTRAINT "PK_DesignSettings" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_DesignSettings_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "HadithBooks" (
    "ProviderId" INTEGER NOT NULL,
    "BookSlug" TEXT NOT NULL,
    "BookName" TEXT NOT NULL,
    "WriterName" TEXT NOT NULL,
    "AboutWriter" TEXT,
    "WriterDeath" TEXT,
    "HadithCount" INTEGER NOT NULL,
    "ChapterCount" INTEGER NOT NULL,
    "SyncedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_HadithBooks" PRIMARY KEY ("ProviderId")
);

CREATE TABLE "HadithChapters" (
    "Id" TEXT NOT NULL,
    "ProviderId" INTEGER NOT NULL,
    "BookSlug" TEXT NOT NULL,
    "ChapterNumber" INTEGER NOT NULL,
    "ChapterEnglish" TEXT,
    "ChapterUrdu" TEXT,
    "ChapterArabic" TEXT,
    "SyncedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_HadithChapters" PRIMARY KEY ("Id")
);

CREATE TABLE "HadithRecords" (
    "Id" TEXT NOT NULL,
    "ProviderId" INTEGER NOT NULL,
    "HadithNumber" TEXT NOT NULL,
    "BookSlug" TEXT NOT NULL,
    "ChapterNumber" INTEGER,
    "Volume" INTEGER,
    "Status" TEXT,
    "EnglishNarrator" TEXT,
    "UrduNarrator" TEXT,
    "HadithEnglish" TEXT,
    "HadithUrdu" TEXT,
    "HadithArabic" TEXT,
    "HeadingEnglish" TEXT,
    "HeadingUrdu" TEXT,
    "HeadingArabic" TEXT,
    "SyncedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_HadithRecords" PRIMARY KEY ("Id")
);

CREATE TABLE "HijriMonthMaps" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "Year" INTEGER NOT NULL,
    "Month" INTEGER NOT NULL,
    "HijriDayOnFirst" INTEGER NOT NULL,
    "Locked" INTEGER NOT NULL,
    "UpdatedAtUtc" TEXT NOT NULL,
    "HijriMonthOnFirst" INTEGER NOT NULL DEFAULT 1,
    "HijriYearOnFirst" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "PK_HijriMonthMaps" PRIMARY KEY ("Id")
);

CREATE TABLE "IqamaEntries" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "Date" TEXT NOT NULL,
    "Salah" INTEGER NOT NULL,
    "Time" TEXT NOT NULL,
    "Note" TEXT,
    "UpdatedAtUtc" TEXT NOT NULL,
    "OffsetMinutes" INTEGER,
    CONSTRAINT "PK_IqamaEntries" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_IqamaEntries_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "IslamicContentCacheEntries" (
    "Id" TEXT NOT NULL,
    "Provider" TEXT NOT NULL,
    "CacheKey" TEXT NOT NULL,
    "PayloadJson" TEXT NOT NULL,
    "ContentType" TEXT NOT NULL,
    "RetrievedAtUtc" TEXT NOT NULL,
    "ExpiresAtUtc" TEXT NOT NULL,
    "PayloadBytes" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PK_IslamicContentCacheEntries" PRIMARY KEY ("Id")
);

CREATE TABLE "IslamicContentSyncStates" (
    "Key" TEXT NOT NULL,
    "Provider" TEXT NOT NULL,
    "Scope" TEXT NOT NULL,
    "Status" TEXT NOT NULL,
    "ProcessedItems" INTEGER NOT NULL,
    "TotalItems" INTEGER NOT NULL,
    "Message" TEXT,
    "StartedAtUtc" TEXT,
    "CompletedAtUtc" TEXT,
    "UpdatedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_IslamicContentSyncStates" PRIMARY KEY ("Key")
);

CREATE TABLE "MasjidInvitations" (
    "Id" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "NormalizedEmail" TEXT NOT NULL,
    "OrganizationName" TEXT NOT NULL,
    "NormalizedOrganizationName" TEXT NOT NULL,
    "WebsiteUrl" TEXT,
    "AddressLine" TEXT,
    "City" TEXT,
    "State" TEXT,
    "ZipCode" TEXT,
    "InvitationTokenHash" TEXT NOT NULL,
    "InvitedBySubject" TEXT NOT NULL,
    "CreatedAtUtc" TEXT NOT NULL,
    "SentAtUtc" TEXT NOT NULL,
    "ExpiresAtUtc" TEXT NOT NULL,
    "RegistrationStartedAtUtc" TEXT,
    "AcceptedAtUtc" TEXT,
    "RevokedAtUtc" TEXT,
    "SendCount" INTEGER NOT NULL,
    "OrganizationId" TEXT,
    CONSTRAINT "PK_MasjidInvitations" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_MasjidInvitations_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "OrgUsers" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "Issuer" TEXT NOT NULL,
    "Subject" TEXT NOT NULL,
    "Email" TEXT,
    "DisplayName" TEXT,
    "Roles" TEXT,
    "LastSeenUtc" TEXT NOT NULL,
    CONSTRAINT "PK_OrgUsers" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OrgUsers_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "Organizations" (
    "Id" TEXT NOT NULL,
    "Slug" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "AddressLine" TEXT,
    "City" TEXT,
    "State" TEXT,
    "ZipCode" TEXT,
    "Phone" TEXT,
    "WebsiteUrl" TEXT,
    "Email" TEXT,
    "SocialUrl" TEXT,
    "UpdatedAtUtc" TEXT NOT NULL,
    "AddressFingerprint" TEXT,
    "AdminUserId" TEXT,
    "MasjidIdentityKey" TEXT,
    "NormalizedName" TEXT NOT NULL DEFAULT '',
    "NormalizedWebsiteHost" TEXT,
    CONSTRAINT "PK_Organizations" PRIMARY KEY ("Id")
);

CREATE TABLE "PendingRegistrations" (
    "Id" TEXT NOT NULL,
    "Email" TEXT NOT NULL,
    "NormalizedEmail" TEXT NOT NULL,
    "PasswordHash" TEXT NOT NULL,
    "PasswordSalt" TEXT NOT NULL,
    "OrganizationName" TEXT NOT NULL,
    "NormalizedName" TEXT NOT NULL,
    "WebsiteUrl" TEXT NOT NULL,
    "NormalizedWebsiteHost" TEXT NOT NULL,
    "AddressLine" TEXT NOT NULL,
    "City" TEXT NOT NULL,
    "State" TEXT NOT NULL,
    "ZipCode" TEXT NOT NULL,
    "AddressFingerprint" TEXT NOT NULL,
    "MasjidIdentityKey" TEXT NOT NULL,
    "Latitude" REAL NOT NULL,
    "Longitude" REAL NOT NULL,
    "TimezoneId" TEXT NOT NULL,
    "VerificationTokenHash" TEXT NOT NULL,
    "VerificationExpiresAtUtc" TEXT NOT NULL,
    "CreatedAtUtc" TEXT NOT NULL,
    "InvitationId" TEXT,
    CONSTRAINT "PK_PendingRegistrations" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_PendingRegistrations_MasjidInvitations_InvitationId" FOREIGN KEY ("InvitationId") REFERENCES "MasjidInvitations"("Id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "PrayerTimingCriteria" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "Method" TEXT NOT NULL,
    "JuristicMethodAsr" TEXT NOT NULL,
    "Latitude" REAL NOT NULL,
    "Longitude" REAL NOT NULL,
    "TimezoneId" TEXT NOT NULL,
    "DstObserved" INTEGER NOT NULL,
    "DstBegins" TEXT,
    "DstEnds" TEXT,
    "ZipCode" TEXT NOT NULL,
    "MinutesAfterZawal" INTEGER NOT NULL,
    "MinutesAfterMaghrib" INTEGER NOT NULL,
    "KhutbahTimeMinutes" INTEGER NOT NULL,
    "UpdatedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_PrayerTimingCriteria" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_PrayerTimingCriteria_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "PublishArtifacts" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "Year" INTEGER NOT NULL,
    "Month" INTEGER NOT NULL,
    "Size" INTEGER NOT NULL,
    "Orientation" INTEGER NOT NULL,
    "StorageUrl" TEXT NOT NULL,
    "CreatedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_PublishArtifacts" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_PublishArtifacts_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "QuranEditions" (
    "Identifier" TEXT NOT NULL,
    "Language" TEXT NOT NULL,
    "Name" TEXT NOT NULL,
    "EnglishName" TEXT NOT NULL,
    "Format" TEXT NOT NULL,
    "Type" TEXT NOT NULL,
    "Direction" TEXT,
    "SyncedAtUtc" TEXT NOT NULL,
    CONSTRAINT "PK_QuranEditions" PRIMARY KEY ("Identifier")
);

CREATE TABLE "TvDisplayConfigs" (
    "Id" TEXT NOT NULL,
    "OrganizationId" TEXT NOT NULL,
    "ShowSeconds" INTEGER NOT NULL,
    "ShowHijri" INTEGER NOT NULL,
    "AccentColor" TEXT NOT NULL,
    "AutoRefreshSeconds" INTEGER NOT NULL,
    "ClockFontScale" INTEGER NOT NULL DEFAULT 160,
    CONSTRAINT "PK_TvDisplayConfigs" PRIMARY KEY ("Id")
);

CREATE INDEX "IX_ApiClientUsage_ApiClientId_UsedAtUtc" ON "ApiClientUsage"("ApiClientId", "UsedAtUtc");
CREATE UNIQUE INDEX "IX_ApiClients_KeyPrefix" ON "ApiClients"("KeyPrefix");
CREATE UNIQUE INDEX "IX_ApiClients_OrganizationId_Name" ON "ApiClients"("OrganizationId", "Name");
CREATE UNIQUE INDEX "IX_AppUsers_Email" ON "AppUsers"("Email");
CREATE UNIQUE INDEX "IX_AppUsers_PasswordResetTokenHash" ON "AppUsers"("PasswordResetTokenHash") WHERE "PasswordResetTokenHash" IS NOT NULL;
CREATE UNIQUE INDEX "IX_DesignSettings_OrganizationId" ON "DesignSettings"("OrganizationId");
CREATE UNIQUE INDEX "IX_HadithBooks_BookSlug" ON "HadithBooks"("BookSlug");
CREATE INDEX "IX_HadithChapters_ProviderId" ON "HadithChapters"("ProviderId");
CREATE UNIQUE INDEX "IX_HadithChapters_BookSlug_ChapterNumber" ON "HadithChapters"("BookSlug", "ChapterNumber");
CREATE INDEX "IX_HadithRecords_BookSlug_ChapterNumber" ON "HadithRecords"("BookSlug", "ChapterNumber");
CREATE INDEX "IX_HadithRecords_ProviderId" ON "HadithRecords"("ProviderId");
CREATE INDEX "IX_HadithRecords_Status" ON "HadithRecords"("Status");
CREATE UNIQUE INDEX "IX_HadithRecords_BookSlug_HadithNumber" ON "HadithRecords"("BookSlug", "HadithNumber");
CREATE UNIQUE INDEX "IX_HijriMonthMaps_OrganizationId_Year_Month" ON "HijriMonthMaps"("OrganizationId", "Year", "Month");
CREATE UNIQUE INDEX "IX_IqamaEntries_OrganizationId_Date_Salah" ON "IqamaEntries"("OrganizationId", "Date", "Salah");
CREATE INDEX "IX_IslamicContentCacheEntries_ExpiresAtUtc" ON "IslamicContentCacheEntries"("ExpiresAtUtc");
CREATE UNIQUE INDEX "IX_IslamicContentCacheEntries_Provider_CacheKey" ON "IslamicContentCacheEntries"("Provider", "CacheKey");
CREATE UNIQUE INDEX "IX_MasjidInvitations_InvitationTokenHash" ON "MasjidInvitations"("InvitationTokenHash");
CREATE INDEX "IX_MasjidInvitations_ExpiresAtUtc" ON "MasjidInvitations"("ExpiresAtUtc");
CREATE INDEX "IX_MasjidInvitations_NormalizedEmail" ON "MasjidInvitations"("NormalizedEmail");
CREATE INDEX "IX_MasjidInvitations_OrganizationId" ON "MasjidInvitations"("OrganizationId");
CREATE UNIQUE INDEX "IX_OrgUsers_OrganizationId_Issuer_Subject" ON "OrgUsers"("OrganizationId", "Issuer", "Subject");
CREATE UNIQUE INDEX "IX_Organizations_Slug" ON "Organizations"("Slug");
CREATE UNIQUE INDEX "IX_Organizations_AddressFingerprint" ON "Organizations"("AddressFingerprint") WHERE "AddressFingerprint" IS NOT NULL;
CREATE UNIQUE INDEX "IX_Organizations_MasjidIdentityKey" ON "Organizations"("MasjidIdentityKey") WHERE "MasjidIdentityKey" IS NOT NULL;
CREATE UNIQUE INDEX "IX_Organizations_NormalizedWebsiteHost" ON "Organizations"("NormalizedWebsiteHost") WHERE "NormalizedWebsiteHost" IS NOT NULL;
CREATE INDEX "IX_Organizations_Name" ON "Organizations"("Name");
CREATE UNIQUE INDEX "IX_PendingRegistrations_NormalizedEmail" ON "PendingRegistrations"("NormalizedEmail");
CREATE UNIQUE INDEX "IX_PendingRegistrations_NormalizedWebsiteHost" ON "PendingRegistrations"("NormalizedWebsiteHost");
CREATE UNIQUE INDEX "IX_PendingRegistrations_AddressFingerprint" ON "PendingRegistrations"("AddressFingerprint");
CREATE UNIQUE INDEX "IX_PendingRegistrations_MasjidIdentityKey" ON "PendingRegistrations"("MasjidIdentityKey");
CREATE UNIQUE INDEX "IX_PendingRegistrations_VerificationTokenHash" ON "PendingRegistrations"("VerificationTokenHash");
CREATE INDEX "IX_PendingRegistrations_InvitationId" ON "PendingRegistrations"("InvitationId");
CREATE INDEX "IX_PendingRegistrations_VerificationExpiresAtUtc" ON "PendingRegistrations"("VerificationExpiresAtUtc");
CREATE UNIQUE INDEX "IX_PrayerTimingCriteria_OrganizationId" ON "PrayerTimingCriteria"("OrganizationId");
CREATE INDEX "IX_PublishArtifacts_OrganizationId_Year_Month" ON "PublishArtifacts"("OrganizationId", "Year", "Month");
CREATE INDEX "IX_QuranEditions_Language_Format_Type" ON "QuranEditions"("Language", "Format", "Type");
CREATE UNIQUE INDEX "IX_TvDisplayConfigs_OrganizationId" ON "TvDisplayConfigs"("OrganizationId");

-- Fixed-window rate-limit counters (src/core/rate-limit.ts). Not part of the PostgreSQL schema.
CREATE TABLE "RateLimitWindows" (
    "Key" TEXT NOT NULL,
    "StartedAtMs" INTEGER NOT NULL,
    "Count" INTEGER NOT NULL,
    CONSTRAINT "PK_RateLimitWindows" PRIMARY KEY ("Key")
);

CREATE INDEX "IX_RateLimitWindows_StartedAtMs" ON "RateLimitWindows"("StartedAtMs");
