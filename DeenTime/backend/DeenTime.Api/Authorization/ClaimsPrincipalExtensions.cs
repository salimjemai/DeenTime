using System.Security.Claims;

namespace DeenTime.Api.Authorization;

public static class ClaimsPrincipalExtensions
{
    public static bool CanAccessOrganization(this ClaimsPrincipal principal, Guid organizationId) =>
        principal.IsInRole("SuperUser") ||
        (Guid.TryParse(principal.FindFirst("orgId")?.Value, out var authenticatedOrganizationId) &&
         authenticatedOrganizationId == organizationId);
}
