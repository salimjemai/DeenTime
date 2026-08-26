using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DeenTime.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddMasjidInvitations : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "InvitationId",
                table: "PendingRegistrations",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "MasjidInvitations",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Email = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    NormalizedEmail = table.Column<string>(type: "character varying(320)", maxLength: 320, nullable: false),
                    OrganizationName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    NormalizedOrganizationName = table.Column<string>(type: "character varying(160)", maxLength: 160, nullable: false),
                    WebsiteUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    AddressLine = table.Column<string>(type: "character varying(240)", maxLength: 240, nullable: true),
                    City = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: true),
                    State = table.Column<string>(type: "character varying(2)", maxLength: 2, nullable: true),
                    ZipCode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: true),
                    InvitationTokenHash = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    InvitedBySubject = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    CreatedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    RegistrationStartedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    AcceptedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAtUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    SendCount = table.Column<int>(type: "integer", nullable: false),
                    OrganizationId = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_MasjidInvitations", x => x.Id);
                    table.ForeignKey(
                        name: "FK_MasjidInvitations_Organizations_OrganizationId",
                        column: x => x.OrganizationId,
                        principalTable: "Organizations",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.SetNull);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PendingRegistrations_InvitationId",
                table: "PendingRegistrations",
                column: "InvitationId");

            migrationBuilder.CreateIndex(
                name: "IX_MasjidInvitations_ExpiresAtUtc",
                table: "MasjidInvitations",
                column: "ExpiresAtUtc");

            migrationBuilder.CreateIndex(
                name: "IX_MasjidInvitations_InvitationTokenHash",
                table: "MasjidInvitations",
                column: "InvitationTokenHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_MasjidInvitations_NormalizedEmail",
                table: "MasjidInvitations",
                column: "NormalizedEmail");

            migrationBuilder.CreateIndex(
                name: "IX_MasjidInvitations_OrganizationId",
                table: "MasjidInvitations",
                column: "OrganizationId");

            migrationBuilder.AddForeignKey(
                name: "FK_PendingRegistrations_MasjidInvitations_InvitationId",
                table: "PendingRegistrations",
                column: "InvitationId",
                principalTable: "MasjidInvitations",
                principalColumn: "Id",
                onDelete: ReferentialAction.SetNull);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PendingRegistrations_MasjidInvitations_InvitationId",
                table: "PendingRegistrations");

            migrationBuilder.DropTable(
                name: "MasjidInvitations");

            migrationBuilder.DropIndex(
                name: "IX_PendingRegistrations_InvitationId",
                table: "PendingRegistrations");

            migrationBuilder.DropColumn(
                name: "InvitationId",
                table: "PendingRegistrations");
        }
    }
}
