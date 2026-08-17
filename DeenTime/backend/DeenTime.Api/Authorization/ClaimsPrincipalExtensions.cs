using System.Security.Claims;

namespace DeenTime.Api.Authorization;

public static class ClaimsPrincipalExtensions
{
    public static bool CanAccessOrganization(this ClaimsPrincipal principal, Guid organizationId) =>
        Guid.TryParse(principal.FindFirst("orgId")?.Value, out var authenticatedOrganizationId) &&
        authenticatedOrganizationId == organizationId;
}
