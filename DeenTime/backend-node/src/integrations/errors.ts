/**
 * Errors raised by the third-party integrations. They stand in for the exceptions
 * the .NET services let escape (HttpRequestException / InvalidOperationException),
 * which the controllers turn into 503 responses.
 */

/** A provider call failed (network error, timeout, unexpected status or body); callers map it to 503. */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'ProviderUnavailableError';
  }
}

/** InvalidOperationException from CyberPanelEmailSender: delivery disabled or credentials incomplete; callers map it to 503. */
export class EmailNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailNotConfiguredError';
  }
}

/** HttpRequestException("Email could not be sent.") wrapping the SMTP failure; callers map it to 503. */
export class EmailDeliveryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EmailDeliveryError';
  }
}
