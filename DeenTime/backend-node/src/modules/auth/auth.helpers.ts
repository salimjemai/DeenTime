import type { AppConfig } from '../../config/configuration.js';
import { EmailDeliveryError, EmailNotConfiguredError, ProviderUnavailableError } from '../../integrations/errors.js';

/** (cfg["Frontend:PublicBaseUrl"] ?? "http://127.0.0.1:4200").TrimEnd('/'). */
export function frontendBaseUrl(config: AppConfig): string {
  return (config.get('Frontend:PublicBaseUrl') ?? 'http://127.0.0.1:4200').replace(/\/+$/, '');
}

/** The `HttpRequestException or InvalidOperationException` filter around IRegistrationEmailSender calls. */
export function isEmailDeliveryFailure(error: unknown): boolean {
  return error instanceof EmailNotConfiguredError || error instanceof EmailDeliveryError || error instanceof ProviderUnavailableError;
}

/** NullIfBlank / NullIfEmpty: null for a missing or whitespace value, otherwise the trimmed text. */
export function nullIfBlank(value: string | null | undefined): string | null {
  return value === null || value === undefined || value.trim() === '' ? null : value.trim();
}
