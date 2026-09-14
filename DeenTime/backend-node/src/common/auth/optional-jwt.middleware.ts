import type { NextFunction, Response } from 'express';
import type { JwtService } from './jwt.service.js';
import type { AuthenticatedRequest } from './claims.js';

/**
 * Populates req.user from a Bearer token when one is present and valid. Anonymous
 * endpoints can then inspect the user (the public content API does), while the
 * AuthGuard turns a missing user into 401 where [Authorize] applies.
 */
export function optionalJwt(jwt: JwtService) {
  return (request: AuthenticatedRequest, _response: Response, next: NextFunction): void => {
    const header = request.headers.authorization;
    if (typeof header === 'string' && /^Bearer\s+/i.test(header)) {
      request.user = jwt.verify(header.replace(/^Bearer\s+/i, '').trim());
    } else {
      request.user = null;
    }
    next();
  };
}
