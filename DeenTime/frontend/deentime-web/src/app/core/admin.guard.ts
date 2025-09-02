import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';

function hasAdminRole(): boolean {
  const token = localStorage.getItem('token');
  if (!token) return false;
  const payload = token.split('.')[1];
  try {
    const json = JSON.parse(atob(payload));
    const roles = ([] as string[]).concat(json['role'] ?? json['roles'] ?? []);
    return roles.some(r => /admin/i.test(r));
  } catch {
    return false;
  }
}

export const adminGuard: CanActivateFn = () => {
  if (hasAdminRole()) return true;
  return inject(Router).createUrlTree(['/login']);
};
