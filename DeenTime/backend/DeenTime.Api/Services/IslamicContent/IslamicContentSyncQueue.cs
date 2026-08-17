using System.Collections.Concurrent;
using System.Threading.Channels;

namespace DeenTime.Api.Services.IslamicContent;

public sealed record IslamicContentSyncRequest(string Provider, string Scope, DateTime RequestedAtUtc);

public interface IIslamicContentSyncQueue
{
    bool TryQueue(string provider, string scope);
    IAsyncEnumerable<IslamicContentSyncRequest> ReadAllAsync(CancellationToken cancellationToken);
    void MarkCompleted(string provider);
}

public sealed class IslamicContentSyncQueue : IIslamicContentSyncQueue
{
    private readonly Channel<IslamicContentSyncRequest> _channel = Channel.CreateUnbounded<IslamicContentSyncRequest>(
        new UnboundedChannelOptions { SingleReader = true, SingleWriter = false });
    private readonly ConcurrentDictionary<string, byte> _queuedProviders = new(StringComparer.OrdinalIgnoreCase);

    public bool TryQueue(string provider, string scope)
    {
        provider = provider.Trim().ToLowerInvariant();
        scope = scope.Trim().ToLowerInvariant();
        if (!_queuedProviders.TryAdd(provider, 0)) return false;

        if (_channel.Writer.TryWrite(new IslamicContentSyncRequest(provider, scope, DateTime.UtcNow)))
            return true;

        _queuedProviders.TryRemove(provider, out _);
        return false;
    }

    public IAsyncEnumerable<IslamicContentSyncRequest> ReadAllAsync(CancellationToken cancellationToken) =>
        _channel.Reader.ReadAllAsync(cancellationToken);

    public void MarkCompleted(string provider) => _queuedProviders.TryRemove(provider, out _);
}
