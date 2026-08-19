using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddDisplayTypography : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CompactFontFamily",
                table: "DesignSettings",
                type: "text",
                nullable: false,
                defaultValue: "system");

            migrationBuilder.AddColumn<int>(
                name: "CompactFontScale",
                table: "DesignSettings",
                type: "integer",
                nullable: false,
                defaultValue: 100);

            migrationBuilder.AddColumn<string>(
                name: "TvFontFamily",
                table: "DesignSettings",
                type: "text",
                nullable: false,
                defaultValue: "system");

            migrationBuilder.AddColumn<int>(
                name: "TvFontScale",
                table: "DesignSettings",
                type: "integer",
                nullable: false,
                defaultValue: 100);

            migrationBuilder.AddColumn<string>(
                name: "WidgetFontFamily",
                table: "DesignSettings",
                type: "text",
                nullable: false,
                defaultValue: "system");

            migrationBuilder.AddColumn<int>(
                name: "WidgetFontScale",
                table: "DesignSettings",
                type: "integer",
                nullable: false,
                defaultValue: 100);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CompactFontFamily",
                table: "DesignSettings");

            migrationBuilder.DropColumn(
                name: "CompactFontScale",
                table: "DesignSettings");

            migrationBuilder.DropColumn(
                name: "TvFontFamily",
                table: "DesignSettings");

            migrationBuilder.DropColumn(
                name: "TvFontScale",
                table: "DesignSettings");

            migrationBuilder.DropColumn(
                name: "WidgetFontFamily",
                table: "DesignSettings");

            migrationBuilder.DropColumn(
                name: "WidgetFontScale",
                table: "DesignSettings");
        }
    }
}
