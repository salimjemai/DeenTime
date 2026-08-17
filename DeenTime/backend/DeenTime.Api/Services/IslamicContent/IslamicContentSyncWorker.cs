namespace DeenTime.Api.Services.IslamicContent;

public sealed class IslamicContentSyncWorker(
    IIslamicContentSyncQueue queue,
    IServiceScopeFactory scopeFactory,
    ILogger<IslamicContentSyncWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var request in queue.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                var syncService = scope.ServiceProvider.GetRequiredService<IslamicContentSyncService>();
                await syncService.RunAsync(request, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                logger.LogError(
                    exception,
                    "Islamic content synchronization failed for {Provider} ({Scope})",
                    request.Provider,
                    request.Scope);
            }
            finally
            {
                queue.MarkCompleted(request.Provider);
            }
        }
    }
}
