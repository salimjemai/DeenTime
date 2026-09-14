import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_ANONYMOUS_METADATA, AUTHORIZE_METADATA, type AuthorizeOptions } from './authorize.decorator.js';
import { hasRole, isSuperUser, satisfiesAdminPolicy, type AuthenticatedRequest } from './claims.js';
import { JsonResponseException } from '../errors.js';

/**
 * Enforces [Authorize] metadata the way ASP.NET Core does: every class-level and
 * handler-level requirement must pass (AND), [AllowAnonymous] on the handler wins,
 * a missing/invalid token is 401 with an empty body and a failed policy is 403.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();
    if (this.reflector.get<boolean>(ALLOW_ANONYMOUS_METADATA, handler)) return true;

    const requirements = [
      this.reflector.get<AuthorizeOptions | undefined>(AUTHORIZE_METADATA, controller),
      this.reflector.get<AuthorizeOptions | undefined>(AUTHORIZE_METADATA, handler),
    ].filter((item): item is AuthorizeOptions => item !== undefined);
    if (requirements.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.user ?? null;
    if (!user) throw new JsonResponseException(401, '');

    for (const requirement of requirements) {
      if (requirement.policy === 'Admin' && !satisfiesAdminPolicy(user)) throw new JsonResponseException(403, '');
      if (requirement.policy === 'SuperUser' && !isSuperUser(user)) throw new JsonResponseException(403, '');
      if (requirement.roles?.length && !hasRole(user, ...requirement.roles)) throw new JsonResponseException(403, '');
    }
    return true;
  }
}
