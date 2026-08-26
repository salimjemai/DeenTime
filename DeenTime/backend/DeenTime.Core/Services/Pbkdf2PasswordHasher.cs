using System.Security.Cryptography;
using System.Text;

namespace DeenTime.Core.Services;

public sealed class Pbkdf2PasswordHasher : IPasswordHasher
{
    private const int CurrentIterations = 600_000;
    private const int LegacyIterations = 100_000;
    private const string Prefix = "pbkdf2-sha256";

    public (string Hash, string Salt) HashPassword(string password)
    {
        var saltBytes = RandomNumberGenerator.GetBytes(16);
        var hashBytes = Rfc2898DeriveBytes.Pbkdf2(password, saltBytes, CurrentIterations, HashAlgorithmName.SHA256, 32);
        return ($"{Prefix}${CurrentIterations}${Convert.ToBase64String(hashBytes)}", Convert.ToBase64String(saltBytes));
    }

    public bool Verify(string password, string hash, string salt)
    {
        try
        {
            var saltBytes = Convert.FromBase64String(salt);
            var iterations = LegacyIterations;
            var encodedHash = hash;
            var parts = hash.Split('$', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length == 3 && parts[0] == Prefix && int.TryParse(parts[1], out var parsedIterations))
            {
                iterations = parsedIterations;
                encodedHash = parts[2];
            }
            if (iterations is < LegacyIterations or > 1_000_000) return false;

            var expectedHash = Convert.FromBase64String(encodedHash);
            if (expectedHash.Length != 32) return false;
            var hashBytes = Rfc2898DeriveBytes.Pbkdf2(password, saltBytes, iterations, HashAlgorithmName.SHA256, 32);
            return CryptographicOperations.FixedTimeEquals(hashBytes, expectedHash);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    public bool NeedsRehash(string hash) => !hash.StartsWith($"{Prefix}${CurrentIterations}$", StringComparison.Ordinal);
}
