using DeenTime.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace DeenTime.Api.Services;

public sealed record DatabaseReadinessResult(
    bool Ready,
    string Status,
    string? Detail,
    string SchemaVersion,
    IReadOnlyCollection<string> PendingMigrations)
{
    public static DatabaseReadinessResult Unavailable(string detail) => new(
        false,
        "unavailable",
        detail,
        BuildInfoProvider.CurrentSchemaVersion,
        Array.Empty<string>());
}

public sealed class DatabaseReadiness(IDbContextFactory<AppDbContext> dbFactory)
{
    public async Task<DatabaseReadinessResult> CheckAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await using var db = await dbFactory.CreateDbContextAsync(cancellationToken);
            if (!await db.Database.CanConnectAsync(cancellationToken))
                return DatabaseReadinessResult.Unavailable("The database connection is unavailable.");

            var pending = (await db.Database.GetPendingMigrationsAsync(cancellationToken)).ToArray();
            return new DatabaseReadinessResult(
                pending.Length == 0,
                pending.Length == 0 ? "ready" : "migrations-pending",
                pending.Length == 0 ? null : "The database has not completed all application migrations.",
                BuildInfoProvider.CurrentSchemaVersion,
                pending);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            return DatabaseReadinessResult.Unavailable(exception.GetBaseException().Message);
        }
    }
}
