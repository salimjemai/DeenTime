using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Caching.Memory;

namespace DeenTime.Api.Services;

public sealed class LoginAttemptThrottle(IMemoryCache cache)
{
    private sealed class AttemptState
    {
        public object SyncRoot { get; } = new();
        public int Failures { get; set; }
        public DateTime WindowStartedUtc { get; set; } = DateTime.UtcNow;
        public DateTime? BlockedUntilUtc { get; set; }
    }

    public bool CanAttempt(string normalizedEmail, out TimeSpan retryAfter)
    {
        retryAfter = TimeSpan.Zero;
        if (!cache.TryGetValue<AttemptState>(Key(normalizedEmail), out var state) || state is null) return true;
        lock (state.SyncRoot)
        {
            if (state.BlockedUntilUtc is null || state.BlockedUntilUtc <= DateTime.UtcNow) return true;
            retryAfter = state.BlockedUntilUtc.Value - DateTime.UtcNow;
            return false;
        }
    }

    public void RecordFailure(string normalizedEmail)
    {
        var key = Key(normalizedEmail);
        var state = cache.GetOrCreate(key, entry =>
        {
            entry.SetSize(1);
            entry.SetSlidingExpiration(TimeSpan.FromHours(1));
            return new AttemptState();
        })!;
        lock (state.SyncRoot)
        {
            if (DateTime.UtcNow - state.WindowStartedUtc > TimeSpan.FromMinutes(15))
            {
                state.Failures = 0;
                state.WindowStartedUtc = DateTime.UtcNow;
                state.BlockedUntilUtc = null;
            }
            state.Failures++;
            if (state.Failures >= 5)
            {
                var minutes = Math.Min(15, 1 << Math.Min(state.Failures - 5, 4));
                state.BlockedUntilUtc = DateTime.UtcNow.AddMinutes(minutes);
            }
        }
    }

    public void Reset(string normalizedEmail) => cache.Remove(Key(normalizedEmail));

    private static string Key(string value) =>
        $"login-failures:{Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)))}";
}
