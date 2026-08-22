using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260819061000_EnlargeDefaultTvClock")]
    public partial class EnlargeDefaultTvClock : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "ClockFontScale",
                table: "TvDisplayConfigs",
                type: "integer",
                nullable: false,
                defaultValue: 160,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 130);

            migrationBuilder.Sql(
                """
                UPDATE "TvDisplayConfigs"
                SET "ClockFontScale" = 160
                WHERE "ClockFontScale" = 130;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                UPDATE "TvDisplayConfigs"
                SET "ClockFontScale" = 130
                WHERE "ClockFontScale" = 160;
                """);

            migrationBuilder.AlterColumn<int>(
                name: "ClockFontScale",
                table: "TvDisplayConfigs",
                type: "integer",
                nullable: false,
                defaultValue: 130,
                oldClrType: typeof(int),
                oldType: "integer",
                oldDefaultValue: 160);
        }
    }
}
