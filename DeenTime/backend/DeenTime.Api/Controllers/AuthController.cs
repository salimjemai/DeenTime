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

namespace DeenTime.Api.Controllers
{
	[ApiController]
	[Route("api/v1/[controller]")]
	public sealed class AuthController : ControllerBase
	{
		public sealed record SessionResponse(
			string UserId,
			string? Email,
			string? DisplayName,
			Guid OrganizationId,
			string OrganizationSlug,
			string OrganizationName,
			string[] Roles);

		[HttpPost("register")]
		public async Task<IActionResult> Register([FromBody] RegisterRequest req, [FromServices] AppDbContext db, [FromServices] IConfiguration cfg, [FromServices] IPasswordHasher hasher)
		{
			var email = req.Email.Trim().ToLowerInvariant();
			if (await db.AppUsers.AnyAsync(u => u.Email == email)) return Conflict("Email already exists");

			var (hash, salt) = hasher.HashPassword(req.Password);
			var user = new AppUser { Id = Guid.NewGuid().ToString(), Email = email, DisplayName = email, PasswordHash = hash, PasswordSalt = salt };
			db.AppUsers.Add(user);

			var org = new Organization { Id = Guid.NewGuid(), Slug = (req.OrganizationName ?? email.Split('@')[0]).ToLowerInvariant(), Name = req.OrganizationName ?? "My Organization" };
			db.Organizations.Add(org);

			db.OrgUsers.Add(new OrgUser { Id = Guid.NewGuid(), OrganizationId = org.Id, Issuer = cfg["Auth:Issuer"] ?? "local", Subject = user.Id, Email = email, DisplayName = user.DisplayName, Roles = new[] { "Admin" } });

			await db.SaveChangesAsync();
			var token = IssueJwt(cfg, user, org.Id, roles: new[] { "Admin" });
			return Ok(new { token });
		}

		[HttpPost("login")]
		public async Task<IActionResult> Login([FromBody] LoginRequest req, [FromServices] AppDbContext db, [FromServices] IConfiguration cfg, [FromServices] IPasswordHasher hasher)
		{
			var email = req.Email.Trim().ToLowerInvariant();
			var user = await db.AppUsers.FirstOrDefaultAsync(u => u.Email == email);
			if (user is null || !hasher.Verify(req.Password, user.PasswordHash, user.PasswordSalt)) return Unauthorized();
			var membership = await db.OrgUsers.Include(x => x.Organization)
				.FirstOrDefaultAsync(x => x.Subject == user.Id);
			if (membership?.Organization is null) return Problem(statusCode: StatusCodes.Status403Forbidden, title: "Organization unavailable", detail: "This account is not assigned to an active organization.");
			var orgId = membership.OrganizationId;
			var roles = membership.Roles ?? Array.Empty<string>();
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
		public IActionResult Forgot([FromBody] ForgotRequest req)
		{
			return Ok();
		}

		[HttpPost("reset")]
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
	}
}
