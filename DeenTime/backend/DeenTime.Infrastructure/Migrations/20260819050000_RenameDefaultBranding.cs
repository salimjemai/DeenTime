using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260819050000_RenameDefaultBranding")]
    public partial class RenameDefaultBranding : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE "Organizations"
                SET "Name" = 'IqamaTime Demo Mosque'
                WHERE "Name" = 'DeenTime Demo Mosque';

                UPDATE "DesignSettings"
                SET "FooterHtml" = REPLACE("FooterHtml", 'DeenTime Demo Mosque', 'IqamaTime Demo Mosque'),
                    "UpdatedAtUtc" = NOW()
                WHERE "FooterHtml" IS NOT NULL
                  AND "FooterHtml" LIKE '%DeenTime Demo Mosque%';
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE "Organizations"
                SET "Name" = 'DeenTime Demo Mosque'
                WHERE "Name" = 'IqamaTime Demo Mosque';

                UPDATE "DesignSettings"
                SET "FooterHtml" = REPLACE("FooterHtml", 'IqamaTime Demo Mosque', 'DeenTime Demo Mosque'),
                    "UpdatedAtUtc" = NOW()
                WHERE "FooterHtml" IS NOT NULL
                  AND "FooterHtml" LIKE '%IqamaTime Demo Mosque%';
                """);
        }
    }
}
