using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIslamicContentLibrary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "HadithBooks",
                columns: table => new
                {
                    ProviderId = table.Column<int>(type: "integer", nullable: false),
                    BookSlug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    BookName = table.Column<string>(type: "text", nullable: false),
                    WriterName = table.Column<string>(type: "text", nullable: false),
                    AboutWriter = table.Column<string>(type: "text", nullable: true),
                    WriterDeath = table.Column<string>(type: "text", nullable: true),
                    HadithCount = table.Column<int>(type: "integer", nullable: false),
                    ChapterCount = table.Column<int>(type: "integer", nullable: false),
                    SyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HadithBooks", x => x.ProviderId);
                });

            migrationBuilder.CreateTable(
                name: "HadithChapters",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderId = table.Column<int>(type: "integer", nullable: false),
                    BookSlug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ChapterNumber = table.Column<int>(type: "integer", nullable: false),
                    ChapterEnglish = table.Column<string>(type: "text", nullable: true),
                    ChapterUrdu = table.Column<string>(type: "text", nullable: true),
                    ChapterArabic = table.Column<string>(type: "text", nullable: true),
                    SyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HadithChapters", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "HadithRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProviderId = table.Column<int>(type: "integer", nullable: false),
                    HadithNumber = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    BookSlug = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    ChapterNumber = table.Column<int>(type: "integer", nullable: true),
                    Volume = table.Column<int>(type: "integer", nullable: true),
                    Status = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: true),
                    EnglishNarrator = table.Column<string>(type: "text", nullable: true),
                    UrduNarrator = table.Column<string>(type: "text", nullable: true),
                    HadithEnglish = table.Column<string>(type: "text", nullable: true),
                    HadithUrdu = table.Column<string>(type: "text", nullable: true),
                    HadithArabic = table.Column<string>(type: "text", nullable: true),
                    HeadingEnglish = table.Column<string>(type: "text", nullable: true),
                    HeadingUrdu = table.Column<string>(type: "text", nullable: true),
                    HeadingArabic = table.Column<string>(type: "text", nullable: true),
                    SyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_HadithRecords", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "IslamicContentCacheEntries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    CacheKey = table.Column<string>(type: "character varying(600)", maxLength: 600, nullable: false),
                    PayloadJson = table.Column<string>(type: "jsonb", nullable: false),
                    ContentType = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    RetrievedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IslamicContentCacheEntries", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "IslamicContentSyncStates",
                columns: table => new
                {
                    Key = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Provider = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Scope = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Status = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    ProcessedItems = table.Column<int>(type: "integer", nullable: false),
                    TotalItems = table.Column<int>(type: "integer", nullable: false),
                    Message = table.Column<string>(type: "text", nullable: true),
                    StartedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CompletedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    UpdatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IslamicContentSyncStates", x => x.Key);
                });

            migrationBuilder.CreateTable(
                name: "QuranEditions",
                columns: table => new
                {
                    Identifier = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    Language = table.Column<string>(type: "character varying(12)", maxLength: 12, nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    EnglishName = table.Column<string>(type: "text", nullable: false),
                    Format = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    Type = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    Direction = table.Column<string>(type: "character varying(8)", maxLength: 8, nullable: true),
                    SyncedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_QuranEditions", x => x.Identifier);
                });

            migrationBuilder.CreateIndex(
                name: "IX_HadithBooks_BookSlug",
                table: "HadithBooks",
                column: "BookSlug",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HadithChapters_BookSlug_ChapterNumber",
                table: "HadithChapters",
                columns: new[] { "BookSlug", "ChapterNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HadithChapters_ProviderId",
                table: "HadithChapters",
                column: "ProviderId");

            migrationBuilder.CreateIndex(
                name: "IX_HadithRecords_BookSlug_ChapterNumber",
                table: "HadithRecords",
                columns: new[] { "BookSlug", "ChapterNumber" });

            migrationBuilder.CreateIndex(
                name: "IX_HadithRecords_BookSlug_HadithNumber",
                table: "HadithRecords",
                columns: new[] { "BookSlug", "HadithNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_HadithRecords_ProviderId",
                table: "HadithRecords",
                column: "ProviderId");

            migrationBuilder.CreateIndex(
                name: "IX_HadithRecords_Status",
                table: "HadithRecords",
                column: "Status");

            migrationBuilder.CreateIndex(
                name: "IX_IslamicContentCacheEntries_ExpiresAtUtc",
                table: "IslamicContentCacheEntries",
                column: "ExpiresAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_IslamicContentCacheEntries_Provider_CacheKey",
                table: "IslamicContentCacheEntries",
                columns: new[] { "Provider", "CacheKey" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_QuranEditions_Language_Format_Type",
                table: "QuranEditions",
                columns: new[] { "Language", "Format", "Type" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "HadithBooks");

            migrationBuilder.DropTable(
                name: "HadithChapters");

            migrationBuilder.DropTable(
                name: "HadithRecords");

            migrationBuilder.DropTable(
                name: "IslamicContentCacheEntries");

            migrationBuilder.DropTable(
                name: "IslamicContentSyncStates");

            migrationBuilder.DropTable(
                name: "QuranEditions");
        }
    }
}
