using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPasswordReset : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "PasswordResetExpiresAtUtc",
                table: "AppUsers",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PasswordResetTokenHash",
                table: "AppUsers",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_AppUsers_PasswordResetTokenHash",
                table: "AppUsers",
                column: "PasswordResetTokenHash",
                unique: true,
                filter: "\"PasswordResetTokenHash\" IS NOT NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_AppUsers_PasswordResetTokenHash",
                table: "AppUsers");

            migrationBuilder.DropColumn(
                name: "PasswordResetExpiresAtUtc",
                table: "AppUsers");

            migrationBuilder.DropColumn(
                name: "PasswordResetTokenHash",
                table: "AppUsers");
        }
    }
}
