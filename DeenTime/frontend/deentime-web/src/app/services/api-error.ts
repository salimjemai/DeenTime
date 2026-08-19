import { HttpErrorResponse } from '@angular/common/http';

export type ApiErrorKind = 'offline' | 'unauthorized' | 'forbidden' | 'not-found' | 'validation' | 'unavailable' | 'unexpected';

export interface ApiErrorState {
  kind: ApiErrorKind;
  message: string;
  correlationId?: string;
}

export function describeApiError(error: unknown, fallback = 'The request could not be completed.'): ApiErrorState {
  const response = error as HttpErrorResponse;
  const status = response?.status ?? 0;
  const payload = response?.error as { detail?: string; title?: string; error?: string; errors?: Record<string, string[]>; correlationId?: string } | undefined;
  const validation = payload?.errors
    ? Object.values(payload.errors).flat().filter(Boolean).join(' ')
    : undefined;
  const message = validation || payload?.detail || payload?.error || payload?.title || fallback;
  const correlationId = response?.headers?.get('X-Correlation-Id') ?? payload?.correlationId;
  const kind: ApiErrorKind = !status ? 'offline'
    : status === 401 ? 'unauthorized'
    : status === 403 ? 'forbidden'
    : status === 404 ? 'not-found'
    : status === 422 || status === 400 ? 'validation'
    : status === 503 ? 'unavailable'
    : 'unexpected';
  const action = kind === 'offline' ? 'Check your connection and try again.'
    : kind === 'unavailable' ? 'The service is starting or temporarily unavailable. Try again shortly.'
    : kind === 'unauthorized' ? 'Your session expired. Sign in again.'
    : kind === 'forbidden' ? 'Your account does not have access to this organization.'
    : kind === 'not-found' ? 'The requested data is not configured yet.'
    : '';
  return { kind, message: [message, action].filter(Boolean).join(' '), correlationId: correlationId ?? undefined };
}

export function apiErrorMessage(error: unknown, fallback: string) {
  return describeApiError(error, fallback).message;
}
