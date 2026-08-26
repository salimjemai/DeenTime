import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth';

export const superUserGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.validateSession().pipe(
    map(() => auth.hasSuperUserRole()
      ? true
      : router.createUrlTree(['/login'], { queryParams: { reason: 'super-user-required' } })),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { reason: 'organization-unavailable' } })))
  );
};
