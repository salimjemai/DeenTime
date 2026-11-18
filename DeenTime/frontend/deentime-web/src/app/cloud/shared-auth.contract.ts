/**
 * The shared Jemai Innovations sign-up / sign-in API, used by this app and Mushaf+.
 * Keep every path in this one object so lining up with the shared backend is a
 * one-file change. See DeenTime/docs/shared-auth-contract.md.
 */
export const SHARED_AUTH_PATHS = {
  signUp: '/v1/auth/signup',
  signIn: '/v1/auth/signin',
  me: '/v1/auth/me',
  signOut: '/v1/auth/signout',
  forgotPassword: '/v1/auth/forgot',
  resetPassword: '/v1/auth/reset'
} as const;

/** What the shared service supports today. Password reset is not built there yet. */
export const SHARED_AUTH_FEATURES = {
  passwordReset: false
} as const;

/** The shared service requires a display name at sign-up (family members see it). */
export const DISPLAY_NAME_MAX = 60;

export interface CloudUser {
  id: string;
  email: string;
  displayName: string;
}

export interface CloudAuthResponse {
  token: string;
  /** Unix milliseconds; sessions last 60 days. */
  expiresAt?: number;
  user?: CloudUser;
}

/** Reads {error:{message}} (shared contract), {message} or a plain title from an HTTP error. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = error as { status?: number; error?: { error?: { message?: string }; message?: string; title?: string } };
  const message = e?.error?.error?.message ?? e?.error?.message ?? e?.error?.title;
  if (message) return message;
  if (e?.status === 0) return 'The service could not be reached. Check your connection and try again.';
  if (e?.status === 401) return 'That email and password do not match.';
  if (e?.status === 409) return 'An account with this email already exists. Sign in instead.';
  if (e?.status === 429) return 'Too many attempts. Wait a minute and try again.';
  return fallback;
}

/** Field messages from a 422 {error:{fields}} response. */
export function fieldErrors(error: unknown): Record<string, string> {
  const e = error as { error?: { error?: { fields?: Record<string, string> } } };
  return e?.error?.error?.fields ?? {};
}
