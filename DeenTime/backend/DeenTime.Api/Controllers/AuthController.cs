using Microsoft.AspNetCore.Mvc;
using DeenTime.Api.Requests.Auth;
using DeenTime.Core.Entities;
using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using DeenTime.Core.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;
using DeenTime.Api.Services;

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Route("api/v1/[controller]")]
	public sealed class AuthController : ControllerBase
	{
		private static readonly (string Hash, string Salt) DummyPassword = new Pbkdf2PasswordHasher().HashPassword("not-a-real-password");

		public sealed record SessionResponse(
			string UserId,
			string? Email,
			string? DisplayName,
			Guid OrganizationId,
			string OrganizationSlug,
			string OrganizationName,
			string[] Roles);

		[HttpGet("config")]
			public IActionResult Config([FromServices] IOptions<CaptchaOptions> captcha) => Ok(new
			{
				captchaEnabled = captcha.Value.Enabled,
				captchaSiteKey = captcha.Value.Enabled ? captcha.Value.SiteKey : null,
				addressAutocompleteEnabled = HttpContext.RequestServices
					.GetRequiredService<GoogleAddressResolver>().IsEnabled
			});

		[HttpGet("invitations/{token}")]
		[EnableRateLimiting("auth-verify")]
		public async Task<IActionResult> Invitation(
			string token,
			[FromServices] AppDbContext db,
			CancellationToken cancellationToken)
		{
			if (string.IsNullOrWhiteSpace(token) || token.Length > 512)
				return BadRequest(new { code = "invitation_invalid", message = "This invitation is invalid or has expired." });

			var invitation = await db.MasjidInvitations.AsNoTracking().FirstOrDefaultAsync(
				item => item.InvitationTokenHash == HashToken(token), cancellationToken);
			if (invitation is null || invitation.ExpiresAtUtc <= DateTime.UtcNow ||
				invitation.RevokedAtUtc is not null || invitation.AcceptedAtUtc is not null)
				return BadRequest(new { code = "invitation_invalid", message = "This invitation is invalid or has expired." });

			return Ok(new
			{
				invitation.Email,
				invitation.OrganizationName,
				invitation.WebsiteUrl,
				invitation.AddressLine,
				invitation.City,
				invitation.State,
				invitation.ZipCode,
				invitation.ExpiresAtUtc
			});
		}

		[HttpPost("register")]
		[EnableRateLimiting("auth-register")]
		public async Task<IActionResult> Register(
			[FromBody] RegisterRequest req,
			[FromServices] AppDbContext db,
			[FromServices] IConfiguration cfg,
			[FromServices] IPasswordHasher hasher,
				[FromServices] ICaptchaVerifier captcha,
				[FromServices] PostalCodeResolver postalCodes,
				[FromServices] GoogleAddressResolver addresses,
				[FromServices] IRegistrationEmailSender emailSender,
			[FromServices] IWebHostEnvironment environment,
			CancellationToken cancellationToken)
		{
			if (!await captcha.VerifyAsync(req.CaptchaToken, "register", HttpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken))
				return BadRequest(new { code = "captcha_failed", message = "Please complete the security verification and try again." });

				var addressLine = req.AddressLine.Trim();
				var city = req.City.Trim();
				var state = req.State.Trim();
				var zipCode = req.ZipCode.Trim();
				if (addresses.IsEnabled)
				{
					if (string.IsNullOrWhiteSpace(req.AddressPlaceId))
					{
						ModelState.AddModelError(nameof(req.AddressPlaceId), "Choose a verified address from the suggestions.");
						return ValidationProblem(ModelState);
					}

					VerifiedAddress? verifiedAddress;
					try
					{
						verifiedAddress = await addresses.ResolveAsync(req.AddressPlaceId, null, cancellationToken);
					}
					catch (HttpRequestException)
					{
						return Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Address verification is temporarily unavailable.");
					}

					if (verifiedAddress is null)
					{
						ModelState.AddModelError(nameof(req.AddressPlaceId), "Choose a complete U.S. street address from the suggestions.");
						return ValidationProblem(ModelState);
					}

					addressLine = verifiedAddress.AddressLine;
					city = verifiedAddress.City;
					state = verifiedAddress.State;
					zipCode = verifiedAddress.PostalCode;
				}

				if (!RegistrationIdentityNormalizer.TryCreate(
						req.Email, req.OrganizationName, req.WebsiteUrl, addressLine, city, state, zipCode,
						out var identity) || identity is null)
			{
				ModelState.AddModelError(nameof(req.WebsiteUrl), "Enter a valid masjid website address.");
				return ValidationProblem(ModelState);
			}

			MasjidInvitation? invitation = null;
			var now = DateTime.UtcNow;
			if (!string.IsNullOrWhiteSpace(req.InvitationToken))
			{
				invitation = await db.MasjidInvitations.FirstOrDefaultAsync(
					item => item.InvitationTokenHash == HashToken(req.InvitationToken), cancellationToken);
				if (invitation is null || invitation.ExpiresAtUtc <= now || invitation.RevokedAtUtc is not null || invitation.AcceptedAtUtc is not null)
					return BadRequest(new { code = "invitation_invalid", message = "This invitation is invalid or has expired." });
				if (!string.Equals(invitation.NormalizedEmail, identity.Email, StringComparison.Ordinal))
					return BadRequest(new { code = "invitation_email_mismatch", message = "Register with the email address that received this invitation." });
			}
			else
			{
				invitation = await db.MasjidInvitations.FirstOrDefaultAsync(item =>
					item.NormalizedEmail == identity.Email && item.AcceptedAtUtc == null &&
					item.RevokedAtUtc == null && item.ExpiresAtUtc > now,
					cancellationToken);
			}

				var postalCode = PostalCodeResolver.NormalizeUsPostalCode(zipCode)!;
			PostalCodeLocation? location;
			try
			{
				location = await postalCodes.ResolveUsAsync(postalCode, cancellationToken);
			}
			catch (HttpRequestException)
			{
				return Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Location verification is temporarily unavailable.");
			}

			if (location is null)
			{
				ModelState.AddModelError(nameof(req.ZipCode), "That U.S. ZIP code could not be found.");
				return ValidationProblem(ModelState);
			}
				if (!string.Equals(location.StateAbbreviation, state, StringComparison.OrdinalIgnoreCase))
			{
				ModelState.AddModelError(nameof(req.State), "The state does not match the ZIP code.");
				return ValidationProblem(ModelState);
			}

			await db.PendingRegistrations
				.Where(item => item.VerificationExpiresAtUtc <= DateTime.UtcNow)
				.ExecuteDeleteAsync(cancellationToken);

			var existingEmail = await db.AppUsers.AnyAsync(user => user.Email == identity.Email, cancellationToken);
			var existingMasjid = await db.Organizations.AnyAsync(org =>
				org.NormalizedWebsiteHost == identity.WebsiteHost ||
				org.AddressFingerprint == identity.AddressFingerprint ||
				org.MasjidIdentityKey == identity.MasjidIdentityKey,
				cancellationToken);
			var pendingDuplicate = await db.PendingRegistrations.AnyAsync(item =>
				item.NormalizedEmail == identity.Email ||
				item.NormalizedWebsiteHost == identity.WebsiteHost ||
				item.AddressFingerprint == identity.AddressFingerprint ||
				item.MasjidIdentityKey == identity.MasjidIdentityKey,
				cancellationToken);
			if (existingEmail || existingMasjid || pendingDuplicate)
				return Conflict(new { code = "registration_unavailable", message = "This email or masjid is already registered or awaiting verification." });

			var rawToken = Base64Url(RandomNumberGenerator.GetBytes(32));
			var (passwordHash, passwordSalt) = hasher.HashPassword(req.Password);
			var pending = new PendingRegistration
			{
				Id = Guid.NewGuid(),
				InvitationId = invitation?.Id,
				Email = identity.Email,
				NormalizedEmail = identity.Email,
				PasswordHash = passwordHash,
				PasswordSalt = passwordSalt,
				OrganizationName = req.OrganizationName.Trim(),
				NormalizedName = identity.Name,
				WebsiteUrl = identity.WebsiteUrl,
				NormalizedWebsiteHost = identity.WebsiteHost,
					AddressLine = addressLine,
					City = city,
				State = location.StateAbbreviation,
				ZipCode = location.PostalCode,
				AddressFingerprint = identity.AddressFingerprint,
				MasjidIdentityKey = identity.MasjidIdentityKey,
				Latitude = location.Latitude,
				Longitude = location.Longitude,
				TimezoneId = UsTimeZoneResolver.Resolve(location.StateAbbreviation, location.Longitude),
				VerificationTokenHash = HashToken(rawToken),
				VerificationExpiresAtUtc = DateTime.UtcNow.AddMinutes(30)
			};
			if (invitation is not null) invitation.RegistrationStartedAtUtc = DateTime.UtcNow;
			db.PendingRegistrations.Add(pending);
			try
			{
				await db.SaveChangesAsync(cancellationToken);
			}
			catch (DbUpdateException)
			{
				return Conflict(new { code = "registration_unavailable", message = "This email or masjid is already registered or awaiting verification." });
			}

			var publicBaseUrl = (cfg["Frontend:PublicBaseUrl"] ?? "http://127.0.0.1:4200").TrimEnd('/');
			var verificationUrl = $"{publicBaseUrl}/verify-email?token={Uri.EscapeDataString(rawToken)}";
			try
			{
				await emailSender.SendVerificationAsync(pending.Email, pending.OrganizationName, verificationUrl, cancellationToken);
			}
			catch (Exception exception) when (exception is HttpRequestException or InvalidOperationException)
			{
				db.PendingRegistrations.Remove(pending);
				if (invitation is not null) invitation.RegistrationStartedAtUtc = null;
				await db.SaveChangesAsync(cancellationToken);
				return Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Verification email could not be sent.");
			}

			return Accepted(new
			{
				message = "Check your email to verify the administrator account.",
				verificationRequired = true,
				developmentVerificationUrl = environment.IsDevelopment() ? verificationUrl : null
			});
		}

		[HttpPost("verify-email")]
		[EnableRateLimiting("auth-verify")]
		public async Task<IActionResult> VerifyEmail(
			[FromBody] VerifyEmailRequest req,
			[FromServices] AppDbContext db,
			[FromServices] IConfiguration cfg,
			CancellationToken cancellationToken)
		{
			var pending = await db.PendingRegistrations.FirstOrDefaultAsync(
				item => item.VerificationTokenHash == HashToken(req.Token),
				cancellationToken);
			if (pending is null || pending.VerificationExpiresAtUtc <= DateTime.UtcNow)
			{
				if (pending is not null)
				{
					db.PendingRegistrations.Remove(pending);
					await db.SaveChangesAsync(cancellationToken);
				}
				return BadRequest(new { code = "verification_invalid", message = "The verification link is invalid or has expired." });
			}

			var duplicateExists = await db.AppUsers.AnyAsync(user => user.Email == pending.NormalizedEmail, cancellationToken) ||
				await db.Organizations.AnyAsync(org =>
					org.NormalizedWebsiteHost == pending.NormalizedWebsiteHost ||
					org.AddressFingerprint == pending.AddressFingerprint ||
					org.MasjidIdentityKey == pending.MasjidIdentityKey,
					cancellationToken);
			if (duplicateExists)
				return Conflict(new { code = "registration_unavailable", message = "This email or masjid has already been registered." });

			await using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);
			var user = new AppUser
			{
				Id = Guid.NewGuid().ToString(), Email = pending.NormalizedEmail, DisplayName = pending.Email,
				PasswordHash = pending.PasswordHash, PasswordSalt = pending.PasswordSalt
			};
			var slugBase = RegistrationIdentityNormalizer.CreateSlug(pending.OrganizationName);
			var slug = await db.Organizations.AnyAsync(org => org.Slug == slugBase, cancellationToken)
				? $"{slugBase}-{RandomNumberGenerator.GetHexString(4).ToLowerInvariant()}"
				: slugBase;
			var org = new Organization
			{
				Id = Guid.NewGuid(), Slug = slug, Name = pending.OrganizationName, NormalizedName = pending.NormalizedName,
				WebsiteUrl = pending.WebsiteUrl, NormalizedWebsiteHost = pending.NormalizedWebsiteHost,
				AddressLine = pending.AddressLine, City = pending.City, State = pending.State, ZipCode = pending.ZipCode,
				Email = pending.Email, AddressFingerprint = pending.AddressFingerprint,
				MasjidIdentityKey = pending.MasjidIdentityKey, AdminUserId = user.Id
			};
			MasjidInvitation? invitation = null;
			if (pending.InvitationId is not null)
			{
				invitation = await db.MasjidInvitations.FirstOrDefaultAsync(item => item.Id == pending.InvitationId, cancellationToken);
				if (invitation is not null)
				{
					invitation.AcceptedAtUtc = DateTime.UtcNow;
					invitation.OrganizationId = org.Id;
				}
			}
			db.AppUsers.Add(user);
			db.Organizations.Add(org);
			db.OrgUsers.Add(new OrgUser
			{
				Id = Guid.NewGuid(), OrganizationId = org.Id, Issuer = cfg["Auth:Issuer"] ?? "local",
				Subject = user.Id, Email = pending.Email, DisplayName = pending.Email, Roles = ["Admin"]
			});
			db.PrayerTimingCriteria.Add(new PrayerTimingCriteria
			{
				Id = Guid.NewGuid(), OrganizationId = org.Id, Method = "ISNA", JuristicMethodAsr = "Other",
				Latitude = pending.Latitude, Longitude = pending.Longitude, TimezoneId = pending.TimezoneId,
				DstObserved = pending.TimezoneId is not ("America/Phoenix" or "Pacific/Honolulu"),
				ZipCode = pending.ZipCode, MinutesAfterZawal = 5, MinutesAfterMaghrib = 1, KhutbahTimeMinutes = 20
			});
			db.DesignSettings.Add(new DesignSettings
			{
				Id = Guid.NewGuid(), OrganizationId = org.Id,
				IqamaHeadings = ["FAJR", "IQM*", "SUNRISE", "DUHUR", "IQM*", "ASR", "IQM*", "SUNSET", "ISHA", "IQM*"],
				FooterHtml = $"© {DateTime.UtcNow.Year} {org.Name} · IqamaTime", Theme = "default"
			});
			db.PendingRegistrations.Remove(pending);
			try
			{
				await db.SaveChangesAsync(cancellationToken);
				await transaction.CommitAsync(cancellationToken);
			}
			catch (DbUpdateException)
			{
				await transaction.RollbackAsync(cancellationToken);
				return Conflict(new { code = "registration_unavailable", message = "This email or masjid has already been registered." });
			}

			return Ok(new { token = IssueJwt(cfg, user, org.Id, ["Admin"]) });
		}

		[HttpPost("login")]
		[EnableRateLimiting("auth-login")]
		public async Task<IActionResult> Login(
			[FromBody] LoginRequest req,
			[FromServices] AppDbContext db,
			[FromServices] IConfiguration cfg,
			[FromServices] IPasswordHasher hasher,
			[FromServices] ICaptchaVerifier captcha,
			[FromServices] LoginAttemptThrottle throttle,
			CancellationToken cancellationToken)
		{
			if (!await captcha.VerifyAsync(req.CaptchaToken, "login", HttpContext.Connection.RemoteIpAddress?.ToString(), cancellationToken))
				return BadRequest(new { code = "captcha_failed", message = "Please complete the security verification and try again." });

			var email = req.Email.Trim().ToLowerInvariant();
			if (!throttle.CanAttempt(email, out var retryAfter))
			{
				Response.Headers["Retry-After"] = Math.Max(1, (int)Math.Ceiling(retryAfter.TotalSeconds)).ToString();
				return StatusCode(StatusCodes.Status429TooManyRequests, new { message = "Too many failed attempts. Try again later." });
			}

			var user = await db.AppUsers.FirstOrDefaultAsync(u => u.Email == email, cancellationToken);
			var passwordValid = user is not null
				? hasher.Verify(req.Password, user.PasswordHash, user.PasswordSalt)
				: hasher.Verify(req.Password, DummyPassword.Hash, DummyPassword.Salt);
			if (user is null || !passwordValid)
			{
				throttle.RecordFailure(email);
				return Unauthorized();
			}
			var membership = await db.OrgUsers.Include(x => x.Organization)
				.FirstOrDefaultAsync(x => x.Subject == user.Id, cancellationToken);
			if (membership?.Organization is null) return Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization unavailable", detail: "This account is not assigned to an active organization.");
			var orgId = membership.OrganizationId;
			var roles = membership.Roles ?? Array.Empty<string>();
			var isSuperUser = roles.Contains("SuperUser", StringComparer.OrdinalIgnoreCase);
			if (!isSuperUser && !string.Equals(membership.Organization.AdminUserId, user.Id, StringComparison.Ordinal))
				roles = roles.Where(role => !string.Equals(role, "Admin", StringComparison.OrdinalIgnoreCase)).ToArray();
			if (hasher.NeedsRehash(user.PasswordHash))
			{
				(user.PasswordHash, user.PasswordSalt) = hasher.HashPassword(req.Password);
				await db.SaveChangesAsync(cancellationToken);
			}
			throttle.Reset(email);
			var token = IssueJwt(cfg, user, orgId, roles);
			return Ok(new { token });
		}

		[Authorize]
		[HttpGet("session")]
		public async Task<IActionResult> Session([FromServices] AppDbContext db, CancellationToken cancellationToken)
		{
			var subject = User.FindFirstValue(JwtRegisteredClaimNames.Sub)
				?? User.FindFirstValue(ClaimTypes.NameIdentifier)
				?? User.FindFirstValue("sub");
			var issuer = User.FindFirstValue(JwtRegisteredClaimNames.Iss)
				?? User.FindFirstValue("iss");
			if (string.IsNullOrWhiteSpace(subject)) return Unauthorized();

			if (!Guid.TryParse(User.FindFirstValue("orgId"), out var organizationId))
				return Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization unavailable", detail: "The session does not contain an active organization.");

			var membershipQuery = db.OrgUsers.Include(x => x.Organization)
				.Where(x => x.Subject == subject && x.OrganizationId == organizationId);
			if (!string.IsNullOrWhiteSpace(issuer))
				membershipQuery = membershipQuery.Where(x => x.Issuer == issuer);

			var membership = await membershipQuery.FirstOrDefaultAsync(cancellationToken);
			if (membership?.Organization is null)
				return Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization unavailable", detail: "Your session no longer has access to this organization.");

			membership.LastSeenUtc = DateTime.UtcNow;
			await db.SaveChangesAsync(cancellationToken);
			return Ok(new SessionResponse(
				subject,
				membership.Email,
				membership.DisplayName,
				membership.Organization.Id,
				membership.Organization.Slug,
				membership.Organization.Name,
				membership.Roles ?? Array.Empty<string>()));
		}

		[HttpPost("forgot")]
		[EnableRateLimiting("auth-register")]
		public IActionResult Forgot([FromBody] ForgotRequest req)
		{
			return Ok();
		}

		[HttpPost("reset")]
		[EnableRateLimiting("auth-register")]
		public IActionResult Reset([FromBody] ResetRequest req)
		{
			return Ok();
		}

		private static string IssueJwt(IConfiguration cfg, AppUser user, Guid orgId, string[] roles)
		{
			var key = cfg["Auth:SigningKey"] ?? throw new InvalidOperationException("Auth:SigningKey missing");
			var issuer = cfg["Auth:Issuer"] ?? "deentime";
			var audience = cfg["Auth:Audience"] ?? "DeenTime.Api";
			var claims = new List<Claim>
			{
				new(JwtRegisteredClaimNames.Sub, user.Id),
				new(JwtRegisteredClaimNames.Email, user.Email ?? string.Empty),
				new("orgId", orgId.ToString()),
				new("email", user.Email ?? string.Empty)
			};
			claims.AddRange(roles.Select(r => new Claim("role", r)));
			var creds = new SigningCredentials(new SymmetricSecurityKey(Encoding.UTF8.GetBytes(key)), SecurityAlgorithms.HmacSha256);
			var jwt = new JwtSecurityToken(issuer, audience, claims, expires: DateTime.UtcNow.AddHours(12), signingCredentials: creds);
			return new JwtSecurityTokenHandler().WriteToken(jwt);
		}

		private static string HashToken(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
		private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
	}
}
