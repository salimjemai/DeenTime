/** IslamicContentProviderException: an upstream content provider failed or answered unexpectedly. */
export class IslamicContentProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IslamicContentProviderError';
  }
}

/**
 * System.ArgumentException / ArgumentOutOfRangeException. .NET appends
 * " (Parameter 'name')" to the message when a parameter name is supplied, and
 * that text reached API clients (400 bodies) and sync-state messages.
 */
export class ArgumentError extends Error {
  constructor(
    message: string,
    readonly paramName?: string,
  ) {
    super(paramName ? `${message} (Parameter '${paramName}')` : message);
    this.name = 'ArgumentError';
  }

  /** ArgumentOutOfRangeException(paramName) with the framework's default message. */
  static outOfRange(paramName: string, message = 'Specified argument was out of the range of valid values.'): ArgumentError {
    return new ArgumentError(message, paramName);
  }
}
