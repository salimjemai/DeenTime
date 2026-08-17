using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddIslamicContentPayloadSize : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "PayloadBytes",
                table: "IslamicContentCacheEntries",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.Sql(
                """
                UPDATE "IslamicContentCacheEntries"
                SET "PayloadBytes" = octet_length("PayloadJson"::text);
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PayloadBytes",
                table: "IslamicContentCacheEntries");
        }
    }
}
