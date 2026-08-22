using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    [DbContext(typeof(AppDbContext))]
    [Migration("20260819060000_AddTvClockFontScale")]
    public partial class AddTvClockFontScale : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "ClockFontScale",
                table: "TvDisplayConfigs",
                type: "integer",
                nullable: false,
                defaultValue: 130);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ClockFontScale",
                table: "TvDisplayConfigs");
        }
    }
}
