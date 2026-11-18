import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { CloudAuthService } from './cloud-auth.service';

/** Adds the shared-auth bearer token to our own APIs only, never to third parties. */
export const cloudAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(CloudAuthService);
  const token = auth.token();
  if (!token || !auth.isOwnApi(req.url)) return next(req);
  return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
