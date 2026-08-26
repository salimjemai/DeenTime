using System.Reflection;

namespace DeenTime.Api.Services;

public sealed record BuildInfo(
    string CommitSha,
    DateTime BuildTimeUtc,
    string SchemaVersion,
    string ApiVersion);

public static class BuildInfoProvider
{
    public const string CurrentSchemaVersion = "20260823092555_AddMasjidInvitations";

    public static BuildInfo Create(IConfiguration configuration)
    {
        var assembly = typeof(BuildInfoProvider).Assembly;
        var version = assembly.GetName().Version?.ToString() ?? "0.0.0";
        var buildTime = DateTime.TryParse(configuration["Build:TimeUtc"], out var configured)
            ? configured.ToUniversalTime()
            : File.GetLastWriteTimeUtc(assembly.Location);

        return new BuildInfo(
            configuration["Build:CommitSha"] ?? "local",
            buildTime == default ? DateTime.UtcNow : buildTime,
            CurrentSchemaVersion,
            configuration["Build:ApiVersion"] ?? version);
    }
}
