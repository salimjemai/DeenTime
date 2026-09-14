-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "ApiClientUsage" (
    "Id" UUID NOT NULL,
    "ApiClientId" UUID NOT NULL,
    "Endpoint" TEXT NOT NULL,
    "UsedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_ApiClientUsage" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "ApiClients" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "Name" TEXT NOT NULL,
    "KeyPrefix" TEXT NOT NULL,
    "SecretHash" TEXT NOT NULL,
    "Scopes" TEXT[],
    "RequestsPerMinute" INTEGER NOT NULL,
    "CreatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "LastUsedAtUtc" TIMESTAMPTZ(6),
    "RevokedAtUtc" TIMESTAMPTZ(6),

    CONSTRAINT "PK_ApiClients" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "AppUsers" (
    "Id" TEXT NOT NULL,
    "DisplayName" TEXT,
    "Email" VARCHAR(320),
    "PasswordHash" TEXT NOT NULL,
    "PasswordSalt" TEXT NOT NULL,
    "PasswordResetExpiresAtUtc" TIMESTAMPTZ(6),
    "PasswordResetTokenHash" VARCHAR(64),

    CONSTRAINT "PK_AppUsers" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "DesignSettings" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "HeaderImageUrl" TEXT,
    "IqamaHeadings" TEXT[],
    "FooterHtml" TEXT,
    "Theme" TEXT NOT NULL,
    "UpdatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "CompactFontFamily" TEXT NOT NULL DEFAULT 'system',
    "CompactFontScale" INTEGER NOT NULL DEFAULT 100,
    "TvFontFamily" TEXT NOT NULL DEFAULT 'system',
    "TvFontScale" INTEGER NOT NULL DEFAULT 100,
    "WidgetFontFamily" TEXT NOT NULL DEFAULT 'system',
    "WidgetFontScale" INTEGER NOT NULL DEFAULT 100,

    CONSTRAINT "PK_DesignSettings" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "HadithBooks" (
    "ProviderId" INTEGER NOT NULL,
    "BookSlug" VARCHAR(80) NOT NULL,
    "BookName" TEXT NOT NULL,
    "WriterName" TEXT NOT NULL,
    "AboutWriter" TEXT,
    "WriterDeath" TEXT,
    "HadithCount" INTEGER NOT NULL,
    "ChapterCount" INTEGER NOT NULL,
    "SyncedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_HadithBooks" PRIMARY KEY ("ProviderId")
);

-- CreateTable
CREATE TABLE "HadithChapters" (
    "Id" UUID NOT NULL,
    "ProviderId" INTEGER NOT NULL,
    "BookSlug" VARCHAR(80) NOT NULL,
    "ChapterNumber" INTEGER NOT NULL,
    "ChapterEnglish" TEXT,
    "ChapterUrdu" TEXT,
    "ChapterArabic" TEXT,
    "SyncedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_HadithChapters" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "HadithRecords" (
    "Id" UUID NOT NULL,
    "ProviderId" INTEGER NOT NULL,
    "HadithNumber" VARCHAR(80) NOT NULL,
    "BookSlug" VARCHAR(80) NOT NULL,
    "ChapterNumber" INTEGER,
    "Volume" INTEGER,
    "Status" VARCHAR(80),
    "EnglishNarrator" TEXT,
    "UrduNarrator" TEXT,
    "HadithEnglish" TEXT,
    "HadithUrdu" TEXT,
    "HadithArabic" TEXT,
    "HeadingEnglish" TEXT,
    "HeadingUrdu" TEXT,
    "HeadingArabic" TEXT,
    "SyncedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_HadithRecords" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "HijriMonthMaps" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "Year" INTEGER NOT NULL,
    "Month" INTEGER NOT NULL,
    "HijriDayOnFirst" INTEGER NOT NULL,
    "Locked" BOOLEAN NOT NULL,
    "UpdatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "HijriMonthOnFirst" INTEGER NOT NULL DEFAULT 1,
    "HijriYearOnFirst" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PK_HijriMonthMaps" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "IqamaEntries" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "Date" DATE NOT NULL,
    "Salah" INTEGER NOT NULL,
    "Time" TIME(6) NOT NULL,
    "Note" TEXT,
    "UpdatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "OffsetMinutes" INTEGER,

    CONSTRAINT "PK_IqamaEntries" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "IslamicContentCacheEntries" (
    "Id" UUID NOT NULL,
    "Provider" VARCHAR(40) NOT NULL,
    "CacheKey" VARCHAR(600) NOT NULL,
    "PayloadJson" JSONB NOT NULL,
    "ContentType" VARCHAR(80) NOT NULL,
    "RetrievedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "ExpiresAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "PayloadBytes" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "PK_IslamicContentCacheEntries" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "IslamicContentSyncStates" (
    "Key" VARCHAR(120) NOT NULL,
    "Provider" VARCHAR(40) NOT NULL,
    "Scope" VARCHAR(40) NOT NULL,
    "Status" VARCHAR(24) NOT NULL,
    "ProcessedItems" INTEGER NOT NULL,
    "TotalItems" INTEGER NOT NULL,
    "Message" TEXT,
    "StartedAtUtc" TIMESTAMPTZ(6),
    "CompletedAtUtc" TIMESTAMPTZ(6),
    "UpdatedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_IslamicContentSyncStates" PRIMARY KEY ("Key")
);

-- CreateTable
CREATE TABLE "MasjidInvitations" (
    "Id" UUID NOT NULL,
    "Email" VARCHAR(320) NOT NULL,
    "NormalizedEmail" VARCHAR(320) NOT NULL,
    "OrganizationName" VARCHAR(160) NOT NULL,
    "NormalizedOrganizationName" VARCHAR(160) NOT NULL,
    "WebsiteUrl" VARCHAR(2048),
    "AddressLine" VARCHAR(240),
    "City" VARCHAR(120),
    "State" VARCHAR(2),
    "ZipCode" VARCHAR(10),
    "InvitationTokenHash" VARCHAR(64) NOT NULL,
    "InvitedBySubject" VARCHAR(120) NOT NULL,
    "CreatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "SentAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "ExpiresAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "RegistrationStartedAtUtc" TIMESTAMPTZ(6),
    "AcceptedAtUtc" TIMESTAMPTZ(6),
    "RevokedAtUtc" TIMESTAMPTZ(6),
    "SendCount" INTEGER NOT NULL,
    "OrganizationId" UUID,

    CONSTRAINT "PK_MasjidInvitations" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "OrgUsers" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "Issuer" TEXT NOT NULL,
    "Subject" TEXT NOT NULL,
    "Email" TEXT,
    "DisplayName" TEXT,
    "Roles" TEXT[],
    "LastSeenUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_OrgUsers" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "Organizations" (
    "Id" UUID NOT NULL,
    "Slug" TEXT NOT NULL,
    "Name" VARCHAR(160) NOT NULL,
    "AddressLine" TEXT,
    "City" TEXT,
    "State" TEXT,
    "ZipCode" TEXT,
    "Phone" TEXT,
    "WebsiteUrl" TEXT,
    "Email" TEXT,
    "SocialUrl" TEXT,
    "UpdatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "AddressFingerprint" VARCHAR(64),
    "AdminUserId" VARCHAR(120),
    "MasjidIdentityKey" VARCHAR(64),
    "NormalizedName" VARCHAR(160) NOT NULL DEFAULT '',
    "NormalizedWebsiteHost" VARCHAR(253),

    CONSTRAINT "PK_Organizations" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "PendingRegistrations" (
    "Id" UUID NOT NULL,
    "Email" VARCHAR(320) NOT NULL,
    "NormalizedEmail" VARCHAR(320) NOT NULL,
    "PasswordHash" TEXT NOT NULL,
    "PasswordSalt" TEXT NOT NULL,
    "OrganizationName" VARCHAR(160) NOT NULL,
    "NormalizedName" VARCHAR(160) NOT NULL,
    "WebsiteUrl" VARCHAR(2048) NOT NULL,
    "NormalizedWebsiteHost" VARCHAR(253) NOT NULL,
    "AddressLine" VARCHAR(240) NOT NULL,
    "City" VARCHAR(120) NOT NULL,
    "State" VARCHAR(2) NOT NULL,
    "ZipCode" VARCHAR(10) NOT NULL,
    "AddressFingerprint" VARCHAR(64) NOT NULL,
    "MasjidIdentityKey" VARCHAR(64) NOT NULL,
    "Latitude" DECIMAL NOT NULL,
    "Longitude" DECIMAL NOT NULL,
    "TimezoneId" TEXT NOT NULL,
    "VerificationTokenHash" VARCHAR(64) NOT NULL,
    "VerificationExpiresAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "CreatedAtUtc" TIMESTAMPTZ(6) NOT NULL,
    "InvitationId" UUID,

    CONSTRAINT "PK_PendingRegistrations" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "PrayerTimingCriteria" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "Method" TEXT NOT NULL,
    "JuristicMethodAsr" TEXT NOT NULL,
    "Latitude" DECIMAL NOT NULL,
    "Longitude" DECIMAL NOT NULL,
    "TimezoneId" TEXT NOT NULL,
    "DstObserved" BOOLEAN NOT NULL,
    "DstBegins" DATE,
    "DstEnds" DATE,
    "ZipCode" TEXT NOT NULL,
    "MinutesAfterZawal" INTEGER NOT NULL,
    "MinutesAfterMaghrib" INTEGER NOT NULL,
    "KhutbahTimeMinutes" INTEGER NOT NULL,
    "UpdatedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_PrayerTimingCriteria" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "PublishArtifacts" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "Year" INTEGER NOT NULL,
    "Month" INTEGER NOT NULL,
    "Size" INTEGER NOT NULL,
    "Orientation" INTEGER NOT NULL,
    "StorageUrl" TEXT NOT NULL,
    "CreatedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_PublishArtifacts" PRIMARY KEY ("Id")
);

-- CreateTable
CREATE TABLE "QuranEditions" (
    "Identifier" VARCHAR(120) NOT NULL,
    "Language" VARCHAR(12) NOT NULL,
    "Name" TEXT NOT NULL,
    "EnglishName" TEXT NOT NULL,
    "Format" VARCHAR(24) NOT NULL,
    "Type" VARCHAR(40) NOT NULL,
    "Direction" VARCHAR(8),
    "SyncedAtUtc" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PK_QuranEditions" PRIMARY KEY ("Identifier")
);

-- CreateTable
CREATE TABLE "TvDisplayConfigs" (
    "Id" UUID NOT NULL,
    "OrganizationId" UUID NOT NULL,
    "ShowSeconds" BOOLEAN NOT NULL,
    "ShowHijri" BOOLEAN NOT NULL,
    "AccentColor" TEXT NOT NULL,
    "AutoRefreshSeconds" INTEGER NOT NULL,
    "ClockFontScale" INTEGER NOT NULL DEFAULT 160,

    CONSTRAINT "PK_TvDisplayConfigs" PRIMARY KEY ("Id")
);

-- CreateIndex
CREATE INDEX "IX_ApiClientUsage_ApiClientId_UsedAtUtc" ON "ApiClientUsage"("ApiClientId", "UsedAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "IX_ApiClients_KeyPrefix" ON "ApiClients"("KeyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "IX_ApiClients_OrganizationId_Name" ON "ApiClients"("OrganizationId", "Name");

-- CreateIndex
CREATE UNIQUE INDEX "IX_AppUsers_Email" ON "AppUsers"("Email");

-- CreateIndex
CREATE UNIQUE INDEX "IX_AppUsers_PasswordResetTokenHash" ON "AppUsers"("PasswordResetTokenHash") WHERE ("PasswordResetTokenHash" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "IX_DesignSettings_OrganizationId" ON "DesignSettings"("OrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IX_HadithBooks_BookSlug" ON "HadithBooks"("BookSlug");

-- CreateIndex
CREATE INDEX "IX_HadithChapters_ProviderId" ON "HadithChapters"("ProviderId");

-- CreateIndex
CREATE UNIQUE INDEX "IX_HadithChapters_BookSlug_ChapterNumber" ON "HadithChapters"("BookSlug", "ChapterNumber");

-- CreateIndex
CREATE INDEX "IX_HadithRecords_BookSlug_ChapterNumber" ON "HadithRecords"("BookSlug", "ChapterNumber");

-- CreateIndex
CREATE INDEX "IX_HadithRecords_ProviderId" ON "HadithRecords"("ProviderId");

-- CreateIndex
CREATE INDEX "IX_HadithRecords_Status" ON "HadithRecords"("Status");

-- CreateIndex
CREATE UNIQUE INDEX "IX_HadithRecords_BookSlug_HadithNumber" ON "HadithRecords"("BookSlug", "HadithNumber");

-- CreateIndex
CREATE UNIQUE INDEX "IX_HijriMonthMaps_OrganizationId_Year_Month" ON "HijriMonthMaps"("OrganizationId", "Year", "Month");

-- CreateIndex
CREATE UNIQUE INDEX "IX_IqamaEntries_OrganizationId_Date_Salah" ON "IqamaEntries"("OrganizationId", "Date", "Salah");

-- CreateIndex
CREATE INDEX "IX_IslamicContentCacheEntries_ExpiresAtUtc" ON "IslamicContentCacheEntries"("ExpiresAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "IX_IslamicContentCacheEntries_Provider_CacheKey" ON "IslamicContentCacheEntries"("Provider", "CacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "IX_MasjidInvitations_InvitationTokenHash" ON "MasjidInvitations"("InvitationTokenHash");

-- CreateIndex
CREATE INDEX "IX_MasjidInvitations_ExpiresAtUtc" ON "MasjidInvitations"("ExpiresAtUtc");

-- CreateIndex
CREATE INDEX "IX_MasjidInvitations_NormalizedEmail" ON "MasjidInvitations"("NormalizedEmail");

-- CreateIndex
CREATE INDEX "IX_MasjidInvitations_OrganizationId" ON "MasjidInvitations"("OrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "IX_OrgUsers_OrganizationId_Issuer_Subject" ON "OrgUsers"("OrganizationId", "Issuer", "Subject");

-- CreateIndex
CREATE UNIQUE INDEX "IX_Organizations_Slug" ON "Organizations"("Slug");

-- CreateIndex
CREATE UNIQUE INDEX "IX_Organizations_AddressFingerprint" ON "Organizations"("AddressFingerprint") WHERE ("AddressFingerprint" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "IX_Organizations_MasjidIdentityKey" ON "Organizations"("MasjidIdentityKey") WHERE ("MasjidIdentityKey" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "IX_Organizations_NormalizedWebsiteHost" ON "Organizations"("NormalizedWebsiteHost") WHERE ("NormalizedWebsiteHost" IS NOT NULL);

-- CreateIndex
CREATE INDEX "IX_Organizations_Name" ON "Organizations"("Name");

-- CreateIndex
CREATE UNIQUE INDEX "IX_PendingRegistrations_NormalizedEmail" ON "PendingRegistrations"("NormalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "IX_PendingRegistrations_NormalizedWebsiteHost" ON "PendingRegistrations"("NormalizedWebsiteHost");

-- CreateIndex
CREATE UNIQUE INDEX "IX_PendingRegistrations_AddressFingerprint" ON "PendingRegistrations"("AddressFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "IX_PendingRegistrations_MasjidIdentityKey" ON "PendingRegistrations"("MasjidIdentityKey");

-- CreateIndex
CREATE UNIQUE INDEX "IX_PendingRegistrations_VerificationTokenHash" ON "PendingRegistrations"("VerificationTokenHash");

-- CreateIndex
CREATE INDEX "IX_PendingRegistrations_InvitationId" ON "PendingRegistrations"("InvitationId");

-- CreateIndex
CREATE INDEX "IX_PendingRegistrations_VerificationExpiresAtUtc" ON "PendingRegistrations"("VerificationExpiresAtUtc");

-- CreateIndex
CREATE UNIQUE INDEX "IX_PrayerTimingCriteria_OrganizationId" ON "PrayerTimingCriteria"("OrganizationId");

-- CreateIndex
CREATE INDEX "IX_PublishArtifacts_OrganizationId_Year_Month" ON "PublishArtifacts"("OrganizationId", "Year", "Month");

-- CreateIndex
CREATE INDEX "IX_QuranEditions_Language_Format_Type" ON "QuranEditions"("Language", "Format", "Type");

-- CreateIndex
CREATE UNIQUE INDEX "IX_TvDisplayConfigs_OrganizationId" ON "TvDisplayConfigs"("OrganizationId");

-- AddForeignKey
ALTER TABLE "ApiClientUsage" ADD CONSTRAINT "FK_ApiClientUsage_ApiClients_ApiClientId" FOREIGN KEY ("ApiClientId") REFERENCES "ApiClients"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ApiClients" ADD CONSTRAINT "FK_ApiClients_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "DesignSettings" ADD CONSTRAINT "FK_DesignSettings_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "IqamaEntries" ADD CONSTRAINT "FK_IqamaEntries_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "MasjidInvitations" ADD CONSTRAINT "FK_MasjidInvitations_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "OrgUsers" ADD CONSTRAINT "FK_OrgUsers_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PendingRegistrations" ADD CONSTRAINT "FK_PendingRegistrations_MasjidInvitations_InvitationId" FOREIGN KEY ("InvitationId") REFERENCES "MasjidInvitations"("Id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PrayerTimingCriteria" ADD CONSTRAINT "FK_PrayerTimingCriteria_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "PublishArtifacts" ADD CONSTRAINT "FK_PublishArtifacts_Organizations_OrganizationId" FOREIGN KEY ("OrganizationId") REFERENCES "Organizations"("Id") ON DELETE CASCADE ON UPDATE NO ACTION;

