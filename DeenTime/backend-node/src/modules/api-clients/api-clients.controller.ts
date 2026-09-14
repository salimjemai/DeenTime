import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { z } from 'zod';
import { Authorize, CurrentUser } from '../../common/auth/authorize.decorator.js';
import { canAccessOrganization } from '../../common/auth/claims.js';
import type { SessionUser } from '../../common/auth/jwt.service.js';
import { badRequest, forbidden, notFound, validationProblem } from '../../common/errors.js';
import { isGuid } from '../../common/json.js';
import { validated } from '../../common/zod-validation.pipe.js';
import type { ApiClient } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ApiClientCredentialService } from './api-client-credential.service.js';

/** CreateRequest(string Name, string[]? Scopes, int RequestsPerMinute = 60). */
const createSchema = z.object({
  name: z.string().nullable().optional(),
  scopes: z.array(z.string()).nullable().optional(),
  requestsPerMinute: z.number().int().optional(),
});

/** ApiClientResponse: the entity without its secret hash. */
export interface ApiClientResponse {
  id: string;
  organizationId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  requestsPerMinute: number;
  createdAtUtc: Date;
  lastUsedAtUtc: Date | null;
  revokedAtUtc: Date | null;
}

export function toApiClientResponse(client: ApiClient): ApiClientResponse {
  return {
    id: client.id,
    organizationId: client.organizationId,
    name: client.name,
    keyPrefix: client.keyPrefix,
    scopes: client.scopes,
    requestsPerMinute: client.requestsPerMinute,
    createdAtUtc: client.createdAtUtc,
    lastUsedAtUtc: client.lastUsedAtUtc,
    revokedAtUtc: client.revokedAtUtc,
  };
}

/** {organizationId:guid} / {clientId:guid} route constraints: anything else is 404. */
function requireGuid(value: string): string {
  if (!isGuid(value)) throw notFound();
  return value.toLowerCase();
}

@Controller('api/v1/orgs/:organizationId/api-clients')
@Authorize('Admin')
export class ApiClientsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: ApiClientCredentialService,
  ) {}

  @Get()
  async list(@Param('organizationId') organizationIdParam: string, @CurrentUser() user: SessionUser | null) {
    const organizationId = requireGuid(organizationIdParam);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const clients = await this.prisma.apiClient.findMany({ where: { organizationId }, orderBy: { name: 'asc' } });
    return { data: clients.map(toApiClientResponse), supportedScopes: ApiClientCredentialService.supportedScopes };
  }

  @Post()
  @HttpCode(200)
  async create(
    @Param('organizationId') organizationIdParam: string,
    @Body(validated(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() user: SessionUser | null,
  ) {
    const organizationId = requireGuid(organizationIdParam);
    if (body.name === null || body.name === undefined) throw validationProblem({ Name: ['The Name field is required.'] });
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    if (body.name.trim().length === 0) throw badRequest({ error: 'A client name is required.' });

    const created = await this.credentials.create(organizationId, body.name, body.scopes ?? ['content:read'], body.requestsPerMinute ?? 60);
    return { client: toApiClientResponse(created.client), clientKey: created.clientKey };
  }

  @Post(':clientId/rotate')
  @HttpCode(200)
  async rotate(@Param('organizationId') organizationIdParam: string, @Param('clientId') clientIdParam: string, @CurrentUser() user: SessionUser | null) {
    const organizationId = requireGuid(organizationIdParam);
    const clientId = requireGuid(clientIdParam);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    const rotated = await this.credentials.rotate(organizationId, clientId);
    if (rotated === null) throw notFound();
    return { client: toApiClientResponse(rotated.client), clientKey: rotated.clientKey };
  }

  @Post(':clientId/revoke')
  @HttpCode(204)
  async revoke(@Param('organizationId') organizationIdParam: string, @Param('clientId') clientIdParam: string, @CurrentUser() user: SessionUser | null): Promise<void> {
    const organizationId = requireGuid(organizationIdParam);
    const clientId = requireGuid(clientIdParam);
    if (!canAccessOrganization(user, organizationId)) throw forbidden();
    if (!(await this.credentials.revoke(organizationId, clientId))) throw notFound();
  }
}
