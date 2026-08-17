namespace DeenTime.Api.Services.IslamicContent;

public sealed class IslamicContentProviderException(string message, Exception? innerException = null)
    : Exception(message, innerException);
