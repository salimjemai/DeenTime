using DeenTime.Api.Authorization;
using DeenTime.Api.Services;
using DeenTime.Infrastructure;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Controllers;

[ApiController]
[Authorize("Admin")]
[Route("api/v1/orgs/{organizationId:guid}/api-clients")]
public sealed class ApiClientsController(
    AppDbContext db,
    ApiClientCredentialService credentials) : ControllerBase
{
    public sealed record CreateRequest(string Name, string[]? Scopes, int RequestsPerMinute = 60);

    [HttpGet]
    public async Task<IActionResult> List(Guid organizationId, CancellationToken cancellationToken)
    {
        if (!User.CanAccessOrganization(organizationId)) return Forbid();
        var clients = await db.ApiClients.AsNoTracking()
            .Where(client => client.OrganizationId == organizationId)
            .OrderBy(client => client.Name)
            .Select(client => new
            {
                client.Id,
                client.Name,
                client.KeyPrefix,
                client.Scopes,
                client.RequestsPerMinute,
                client.CreatedAtUtc,
                client.LastUsedAtUtc,
                client.RevokedAtUtc
            })
            .ToArrayAsync(cancellationToken);
        return Ok(new { data = clients, supportedScopes = ApiClientCredentialService.SupportedScopes });
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid organizationId, [FromBody] CreateRequest request, CancellationToken cancellationToken)
    {
        if (!User.CanAccessOrganization(organizationId)) return Forbid();
        if (string.IsNullOrWhiteSpace(request.Name)) return BadRequest(new { error = "A client name is required." });
        var created = await credentials.CreateAsync(
            organizationId,
            request.Name,
            request.Scopes ?? ["content:read"],
            request.RequestsPerMinute,
            cancellationToken);
        return Ok(new { client = created.Client, clientKey = created.ClientKey });
    }

    [HttpPost("{clientId:guid}/rotate")]
    public async Task<IActionResult> Rotate(Guid organizationId, Guid clientId, CancellationToken cancellationToken)
    {
        if (!User.CanAccessOrganization(organizationId)) return Forbid();
        var rotated = await credentials.RotateAsync(organizationId, clientId, cancellationToken);
        return rotated is null ? NotFound() : Ok(new { client = rotated.Client, clientKey = rotated.ClientKey });
    }

    [HttpPost("{clientId:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid organizationId, Guid clientId, CancellationToken cancellationToken)
    {
        if (!User.CanAccessOrganization(organizationId)) return Forbid();
        return await credentials.RevokeAsync(organizationId, clientId, cancellationToken) ? NoContent() : NotFound();
    }
}
