using Hangfire.Dashboard;

namespace DeenTime.Api.Authorization;

public sealed class HangfireSuperUserAuthorizationFilter : IDashboardAuthorizationFilter
{
    public bool Authorize(DashboardContext context)
    {
        var user = context.GetHttpContext().User;
        return user.Identity?.IsAuthenticated == true && user.IsInRole("SuperUser");
    }
}
