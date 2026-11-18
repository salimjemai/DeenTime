import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { CloudAuthService } from './cloud-auth.service';

export const cloudAuthGuard: CanActivateFn = (_route, state) => {
  const auth = inject(CloudAuthService);
  const router = inject(Router);
  return auth.current().pipe(map(user => user ? true : router.createUrlTree(['/login'], { queryParams: { next: state.url } })));
};
