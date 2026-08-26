using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using DeenTime.Api.Requests.Admin;
using DeenTime.Api.Services;
using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Controllers;

[ApiController]
[Authorize("SuperUser")]
[Route("api/v1/admin/masjids")]
public sealed class AdminMasjidsController : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromServices] AppDbContext db, CancellationToken cancellationToken)
    {
        var now = DateTime.UtcNow;
        var invitations = await db.MasjidInvitations.AsNoTracking().ToArrayAsync(cancellationToken);
        var pending = await db.PendingRegistrations.AsNoTracking()
            .Where(item => item.InvitationId != null && item.VerificationExpiresAtUtc > now)
            .Select(item => item.InvitationId!.Value)
            .ToArrayAsync(cancellationToken);
        var pendingIds = pending.ToHashSet();
        var organizations = await db.Organizations.AsNoTracking().ToArrayAsync(cancellationToken);
        var memberships = await db.OrgUsers.AsNoTracking().ToArrayAsync(cancellationToken);
        var superUserOrgIds = memberships
            .Where(item => item.Roles.Contains("SuperUser", StringComparer.OrdinalIgnoreCase))
            .Select(item => item.OrganizationId)
            .ToHashSet();
        var linkedOrganizationIds = invitations
            .Where(item => item.OrganizationId.HasValue)
            .Select(item => item.OrganizationId!.Value)
            .ToHashSet();
        var adminEmails = memberships
            .Where(item => item.Roles.Contains("Admin", StringComparer.OrdinalIgnoreCase))
            .GroupBy(item => item.OrganizationId)
            .ToDictionary(group => group.Key, group => group.First().Email);

        var rows = invitations.Select(invitation =>
        {
            var status = StatusFor(invitation, pendingIds.Contains(invitation.Id), now);
            return new MasjidAdminRow(
                invitation.Id,
                invitation.OrganizationId,
                invitation.OrganizationName,
                invitation.Email,
                invitation.WebsiteUrl,
                invitation.City,
                invitation.State,
                status,
                "Invitation",
                invitation.SentAtUtc,
                invitation.ExpiresAtUtc,
                invitation.RegistrationStartedAtUtc,
                invitation.AcceptedAtUtc,
                invitation.SendCount,
                status is "InvitationSent" or "Expired" or "EmailVerificationExpired",
                status is "InvitationSent" or "AwaitingEmailVerification" or "EmailVerificationExpired") ;
        }).ToList();

        rows.AddRange(organizations
            .Where(org => !superUserOrgIds.Contains(org.Id) && !linkedOrganizationIds.Contains(org.Id))
            .Select(org => new MasjidAdminRow(
                org.Id,
                org.Id,
                org.Name,
                adminEmails.GetValueOrDefault(org.Id) ?? org.Email ?? "",
                org.WebsiteUrl,
                org.City,
                org.State,
                "Registered",
                "SelfRegistration",
                null,
                null,
                null,
                org.UpdatedAtUtc,
                0,
                false,
                false)));

        rows = rows
            .OrderBy(row => row.Status == "Registered" ? 1 : 0)
            .ThenByDescending(row => row.InvitedAtUtc ?? row.RegisteredAtUtc)
            .ToList();

        return Ok(new
        {
            summary = new
            {
                total = rows.Count,
                registered = rows.Count(row => row.Status == "Registered"),
                invited = rows.Count(row => row.Status == "InvitationSent"),
                awaitingEmailVerification = rows.Count(row => row.Status is "AwaitingEmailVerification" or "EmailVerificationExpired"),
                expired = rows.Count(row => row.Status == "Expired"),
                revoked = rows.Count(row => row.Status == "Revoked")
            },
            items = rows
        });
    }

    [HttpPost("invitations")]
    [EnableRateLimiting("expensive")]
    public async Task<IActionResult> Invite(
        [FromBody] CreateMasjidInvitationRequest request,
        [FromServices] AppDbContext db,
        [FromServices] IConfiguration configuration,
        [FromServices] IRegistrationEmailSender emailSender,
        [FromServices] IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var email = request.Email.Trim().ToLowerInvariant();
        var normalizedName = RegistrationIdentityNormalizer.NormalizeWords(request.OrganizationName);
        var now = DateTime.UtcNow;
        var activeInviteExists = await db.MasjidInvitations.AnyAsync(item =>
            item.NormalizedEmail == email && item.AcceptedAtUtc == null && item.RevokedAtUtc == null && item.ExpiresAtUtc > now,
            cancellationToken);
        var registeredExists = await db.AppUsers.AnyAsync(item => item.Email == email, cancellationToken) ||
            await db.Organizations.AnyAsync(item => item.NormalizedName == normalizedName, cancellationToken);
        var pendingExists = await db.PendingRegistrations.AnyAsync(item => item.NormalizedEmail == email, cancellationToken);
        if (activeInviteExists || registeredExists || pendingExists)
            return Conflict(new { code = "invitation_unavailable", message = "This email or masjid is already registered, invited, or awaiting verification." });

        var website = NormalizeOptionalWebsite(request.WebsiteUrl);
        if (!string.IsNullOrWhiteSpace(request.WebsiteUrl) && website is null)
        {
            ModelState.AddModelError(nameof(request.WebsiteUrl), "Enter a valid masjid website address.");
            return ValidationProblem(ModelState);
        }
        if (website is not null && await db.Organizations.AnyAsync(org => org.NormalizedWebsiteHost == new Uri(website).IdnHost, cancellationToken))
            return Conflict(new { code = "invitation_unavailable", message = "This masjid website is already registered." });

        var rawToken = Base64Url(RandomNumberGenerator.GetBytes(32));
        var invitation = new MasjidInvitation
        {
            Id = Guid.NewGuid(),
            Email = email,
            NormalizedEmail = email,
            OrganizationName = request.OrganizationName.Trim(),
            NormalizedOrganizationName = normalizedName,
            WebsiteUrl = website,
            AddressLine = NullIfEmpty(request.AddressLine),
            City = NullIfEmpty(request.City),
            State = NullIfEmpty(request.State)?.ToUpperInvariant(),
            ZipCode = NullIfEmpty(request.ZipCode),
            InvitationTokenHash = HashToken(rawToken),
            InvitedBySubject = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
                ?? User.FindFirstValue(ClaimTypes.NameIdentifier)
                ?? "unknown",
            CreatedAtUtc = now,
            SentAtUtc = now,
            ExpiresAtUtc = now.AddDays(7)
        };
        db.MasjidInvitations.Add(invitation);
        await db.SaveChangesAsync(cancellationToken);

        var invitationUrl = InvitationUrl(configuration, rawToken);
        try
        {
            await emailSender.SendInvitationAsync(email, invitation.OrganizationName, invitationUrl, cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException)
        {
            db.MasjidInvitations.Remove(invitation);
            await db.SaveChangesAsync(cancellationToken);
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Invitation email could not be sent.");
        }

        return Created($"/api/v1/admin/masjids/invitations/{invitation.Id}", new
        {
            invitation.Id,
            invitation.Email,
            invitation.OrganizationName,
            status = "InvitationSent",
            invitation.ExpiresAtUtc,
            developmentInvitationUrl = environment.IsDevelopment() ? invitationUrl : null
        });
    }

    [HttpPost("invitations/{id:guid}/resend")]
    [EnableRateLimiting("expensive")]
    public async Task<IActionResult> Resend(
        Guid id,
        [FromServices] AppDbContext db,
        [FromServices] IConfiguration configuration,
        [FromServices] IRegistrationEmailSender emailSender,
        [FromServices] IWebHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        var invitation = await db.MasjidInvitations.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (invitation is null) return NotFound();
        if (invitation.AcceptedAtUtc is not null || invitation.RevokedAtUtc is not null)
            return Conflict(new { message = "A completed or revoked invitation cannot be resent." });
        if (await db.PendingRegistrations.AnyAsync(item =>
                item.InvitationId == invitation.Id && item.VerificationExpiresAtUtc > DateTime.UtcNow,
                cancellationToken))
            return Conflict(new { message = "This masjid already has an active email-verification link." });

        var rawToken = Base64Url(RandomNumberGenerator.GetBytes(32));
        var now = DateTime.UtcNow;
        invitation.InvitationTokenHash = HashToken(rawToken);
        invitation.SentAtUtc = now;
        invitation.ExpiresAtUtc = now.AddDays(7);
        invitation.RegistrationStartedAtUtc = null;
        invitation.SendCount++;

        var invitationUrl = InvitationUrl(configuration, rawToken);
        try
        {
            await emailSender.SendInvitationAsync(invitation.Email, invitation.OrganizationName, invitationUrl, cancellationToken);
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException)
        {
            return Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Invitation email could not be sent.");
        }

        return Ok(new
        {
            message = "Invitation resent.",
            invitation.ExpiresAtUtc,
            developmentInvitationUrl = environment.IsDevelopment() ? invitationUrl : null
        });
    }

    [HttpPost("invitations/{id:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid id, [FromServices] AppDbContext db, CancellationToken cancellationToken)
    {
        var invitation = await db.MasjidInvitations.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (invitation is null) return NotFound();
        if (invitation.AcceptedAtUtc is not null)
            return Conflict(new { message = "A completed invitation cannot be revoked." });
        invitation.RevokedAtUtc ??= DateTime.UtcNow;
        await db.PendingRegistrations
            .Where(item => item.InvitationId == invitation.Id)
            .ExecuteDeleteAsync(cancellationToken);
        await db.SaveChangesAsync(cancellationToken);
        return NoContent();
    }

    private static string StatusFor(MasjidInvitation invitation, bool hasPendingVerification, DateTime now)
    {
        if (invitation.AcceptedAtUtc is not null) return "Registered";
        if (invitation.RevokedAtUtc is not null) return "Revoked";
        if (invitation.ExpiresAtUtc <= now) return "Expired";
        if (hasPendingVerification) return "AwaitingEmailVerification";
        if (invitation.RegistrationStartedAtUtc is not null) return "EmailVerificationExpired";
        return "InvitationSent";
    }

    private static string InvitationUrl(IConfiguration configuration, string rawToken) =>
        $"{(configuration["Frontend:PublicBaseUrl"] ?? "http://127.0.0.1:4200").TrimEnd('/')}/login?invite={Uri.EscapeDataString(rawToken)}";

    private static string? NormalizeOptionalWebsite(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var candidate = value.Trim();
        if (!candidate.Contains("://", StringComparison.Ordinal)) candidate = $"https://{candidate}";
        if (!Uri.TryCreate(candidate, UriKind.Absolute, out var uri) ||
            uri.Scheme is not ("http" or "https") || string.IsNullOrWhiteSpace(uri.IdnHost) || !string.IsNullOrEmpty(uri.UserInfo))
            return null;
        var host = uri.IdnHost.TrimEnd('.').ToLowerInvariant();
        if (host.StartsWith("www.", StringComparison.Ordinal)) host = host[4..];
        return $"https://{host}";
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
    private static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private sealed record MasjidAdminRow(
        Guid Id,
        Guid? OrganizationId,
        string OrganizationName,
        string Email,
        string? WebsiteUrl,
        string? City,
        string? State,
        string Status,
        string Source,
        DateTime? InvitedAtUtc,
        DateTime? ExpiresAtUtc,
        DateTime? RegistrationStartedAtUtc,
        DateTime? RegisteredAtUtc,
        int SendCount,
        bool CanResend,
        bool CanRevoke);
}
