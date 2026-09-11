import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

const anonymousAuthPaths = ['/auth/login', '/auth/register', '/auth/verify-email', '/auth/forgot', '/auth/reset', '/auth/config'];

/**
 * Only a rejected session should send the user back to sign-in:
 * - 401 on a protected API call means the token is missing, expired or invalid;
 * - 403 matters only on the session check itself (the organization is gone). Any other
 *   403 is a permission problem the calling page should surface, not a lost session;
 * - the public content/display APIs answer 401 when a client key is missing, never
 *   because the dashboard session died.
 */
export function isLostSession(url: string, status: number): boolean {
  if (status !== 401 && status !== 403) return false;
  if (url.includes('/public/')) return false;
  if (anonymousAuthPaths.some(path => url.includes(path))) return false;
  return status === 401 || url.includes('/auth/session');
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('token');
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authReq).pipe(
    catchError(error => {
      if (error instanceof HttpErrorResponse && isLostSession(req.url, error.status)) {
        if (typeof localStorage !== 'undefined') localStorage.removeItem('token');
        router.navigate(['/login'], { queryParams: { reason: error.status === 403 ? 'organization-unavailable' : 'session-expired' } });
      }
      return throwError(() => error);
    })
  );
};
