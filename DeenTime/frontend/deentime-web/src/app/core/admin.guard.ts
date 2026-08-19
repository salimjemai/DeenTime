import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.validateSession().pipe(
    map(() => auth.hasAdminRole() ? true : router.createUrlTree(['/login'], { queryParams: { reason: 'forbidden' } })),
    catchError(() => of(router.createUrlTree(['/login'], { queryParams: { reason: 'organization-unavailable' } })))
  );
};
