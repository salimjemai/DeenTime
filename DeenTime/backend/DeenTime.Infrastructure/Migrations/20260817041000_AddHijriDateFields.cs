using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260817041000_AddHijriDateFields")]
public partial class AddHijriDateFields : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "HijriMonthOnFirst",
            table: "HijriMonthMaps",
            type: "integer",
            nullable: false,
            defaultValue: 1);

        migrationBuilder.AddColumn<int>(
            name: "OffsetMinutes",
            table: "IqamaEntries",
            type: "integer",
            nullable: true);

        migrationBuilder.AddColumn<int>(
            name: "HijriYearOnFirst",
            table: "HijriMonthMaps",
            type: "integer",
            nullable: false,
            defaultValue: 1);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "HijriMonthOnFirst", table: "HijriMonthMaps");
        migrationBuilder.DropColumn(name: "HijriYearOnFirst", table: "HijriMonthMaps");
        migrationBuilder.DropColumn(name: "OffsetMinutes", table: "IqamaEntries");
    }
}
