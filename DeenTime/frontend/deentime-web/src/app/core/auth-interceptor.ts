import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const token = typeof localStorage === 'undefined' ? null : localStorage.getItem('token');
  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authReq).pipe(
    catchError(error => {
      if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403) && !req.url.includes('/auth/login') && !req.url.includes('/auth/register')) {
        if (typeof localStorage !== 'undefined') localStorage.removeItem('token');
        router.navigate(['/login'], { queryParams: { reason: error.status === 403 ? 'organization-unavailable' : 'session-expired' } });
      }
      return throwError(() => error);
    })
  );
};
