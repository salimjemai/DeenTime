import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.hasValidToken()) {
    auth.clearSession();
    return router.createUrlTree(['/login'], { queryParams: { reason: 'session-expired' } });
  }

  return auth.validateSession().pipe(
    map(session => {
      const parts = state.url.split(/[?#]/)[0].split('/').filter(Boolean);
      const orgIndex = parts.indexOf('org');
      if (orgIndex >= 0 && parts[orgIndex + 1] !== session.organizationId) {
        return router.createUrlTree(['/org', session.organizationId, ...parts.slice(orgIndex + 2)]);
      }
      return true;
    }),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { reason: 'organization-unavailable' } })))
  );
};
