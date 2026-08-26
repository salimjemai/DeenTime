using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SecureRegistrationAndMasjidIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Name",
                table: "Organizations",
                type: "character varying(160)",
                maxLength: 160,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");

            migrationBuilder.AddColumn<string>(
                name: "AddressFingerprint",
                table: "Organizations",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "AdminUserId",
                table: "Organizations",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "MasjidIdentityKey",
                table: "Organizations",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "NormalizedName",
                table: "Organizations",
                type: "character varying(160)",
                maxLength: 160,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "NormalizedWebsiteHost",
                table: "Organizations",
                type: "character varying(253)",
                maxLength: 253,
                nullable: true);

            migrationBuilder.AlterColumn<string>(
                name: "Email",
                table: "AppUsers",
                type: "character varying(320)",
                maxLength: 320,
                nullable: true,
                oldClrType: typeof(string),
                oldType: "text",
                oldNullable: true);

            migrationBuilder.CreateTable(
                name: "PendingRegistrations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    NormalizedEmail = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    PasswordHash = table.Column<string>(type: "text", nullable: false),
                    PasswordSalt = table.Column<string>(type: "text", nullable: false),
                    OrganizationName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    NormalizedName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    WebsiteUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    NormalizedWebsiteHost = table.Column<string>(type: "character varying(253)", maxLength: 253, nullable: false),
                    AddressLine = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: false),
                    City = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    State = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: false),
                    ZipCode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    AddressFingerprint = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    MasjidIdentityKey = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Latitude = table.Column<decimal>(type: "numeric", nullable: false),
                    Longitude = table.Column<decimal>(type: "numeric", nullable: false),
                    TimezoneId = table.Column<string>(type: "text", nullable: false),
                    VerificationTokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    VerificationExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PendingRegistrations", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Organizations_AddressFingerprint",
                table: "Organizations",
                column: "AddressFingerprint",
                unique: true,
                filter: "\"AddressFingerprint\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Organizations_MasjidIdentityKey",
                table: "Organizations",
                column: "MasjidIdentityKey",
                unique: true,
                filter: "\"MasjidIdentityKey\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_Organizations_NormalizedWebsiteHost",
                table: "Organizations",
                column: "NormalizedWebsiteHost",
                unique: true,
                filter: "\"NormalizedWebsiteHost\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_AddressFingerprint",
                table: "PendingRegistrations",
                column: "AddressFingerprint",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_MasjidIdentityKey",
                table: "PendingRegistrations",
                column: "MasjidIdentityKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_NormalizedEmail",
                table: "PendingRegistrations",
                column: "NormalizedEmail",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_NormalizedWebsiteHost",
                table: "PendingRegistrations",
                column: "NormalizedWebsiteHost",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_VerificationExpiresAtUtc",
                table: "PendingRegistrations",
                column: "VerificationExpiresAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_VerificationTokenHash",
                table: "PendingRegistrations",
                column: "VerificationTokenHash",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PendingRegistrations");

            migrationBuilder.DropIndex(
                name: "IX_Organizations_AddressFingerprint",
                table: "Organizations");

            migrationBuilder.DropIndex(
                name: "IX_Organizations_MasjidIdentityKey",
                table: "Organizations");

            migrationBuilder.DropIndex(
                name: "IX_Organizations_NormalizedWebsiteHost",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "AddressFingerprint",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "AdminUserId",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "MasjidIdentityKey",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "NormalizedName",
                table: "Organizations");

            migrationBuilder.DropColumn(
                name: "NormalizedWebsiteHost",
                table: "Organizations");

            migrationBuilder.AlterColumn<string>(
                name: "Name",
                table: "Organizations",
                type: "text",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(160)",
                oldMaxLength: 160);

            migrationBuilder.AlterColumn<string>(
                name: "Email",
                table: "AppUsers",
                type: "text",
                nullable: true,
                oldClrType: typeof(string),
                oldType: "character varying(320)",
                oldMaxLength: 320,
                oldNullable: true);
        }
    }
}
