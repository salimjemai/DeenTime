import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from './claims.js';
import type { SessionUser } from './jwt.service.js';

export type AuthorizationPolicy = 'Admin' | 'SuperUser';

export interface AuthorizeOptions {
  policy?: AuthorizationPolicy;
  roles?: string[];
}

export const AUTHORIZE_METADATA = 'iqamatime:authorize';
export const ALLOW_ANONYMOUS_METADATA = 'iqamatime:allow-anonymous';

/** [Authorize] / [Authorize("Admin")] / [Authorize("SuperUser")]. */
export const Authorize = (policy?: AuthorizationPolicy) => SetMetadata(AUTHORIZE_METADATA, { policy } satisfies AuthorizeOptions);

/** [Authorize(Roles = "Admin,Editor")]. */
export const AuthorizeRoles = (...roles: string[]) => SetMetadata(AUTHORIZE_METADATA, { roles } satisfies AuthorizeOptions);

/** [AllowAnonymous] — the handler ignores class-level authorization. */
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_METADATA, true);

/** The authenticated session user, or null on anonymous endpoints. */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): SessionUser | null => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user ?? null;
});
