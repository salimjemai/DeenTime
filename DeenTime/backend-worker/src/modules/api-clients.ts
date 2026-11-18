import { z } from 'zod';
import { authorize, canAccessOrganization } from '../core/auth.js';
import { currentUser, db, type App } from '../core/context.js';
import { fromJsonArray } from '../core/db.js';
import { badRequest, forbidden, notFound, validationProblem } from '../core/errors.js';
import { empty } from '../core/http.js';
import { isGuid } from '../core/json.js';
import { parseBody } from '../core/validation.js';
import { ApiClientCredentialService, apiClientCredentials, type ApiClient } from './api-clients/credentials.js';

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
  createdAtUtc: string;
  lastUsedAtUtc: string | null;
  revokedAtUtc: string | null;
}

export function toApiClientResponse(client: Omit<ApiClient, 'secretHash'>): ApiClientResponse {
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

interface ListRow {
  Id: string;
  OrganizationId: string;
  Name: string;
  KeyPrefix: string;
  Scopes: string | null;
  RequestsPerMinute: number;
  CreatedAtUtc: string;
  LastUsedAtUtc: string | null;
  RevokedAtUtc: string | null;
}

/**
 * /api/v1/orgs/:organizationId/api-clients: public content API credentials.
 * Port of backend-node/src/modules/api-clients/api-clients.controller.ts.
 */
export function register(app: App): void {
  app.get('/api/v1/orgs/:organizationId/api-clients', authorize('Admin'), async (c) => {
    const organizationId = requireGuid(c.req.param('organizationId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const rows = await db(c).all<ListRow>(
      'SELECT "Id", "OrganizationId", "Name", "KeyPrefix", "Scopes", "RequestsPerMinute", "CreatedAtUtc", "LastUsedAtUtc", "RevokedAtUtc" FROM "ApiClients" WHERE "OrganizationId" = ? ORDER BY "Name" COLLATE NOCASE ASC, "Name" ASC',
      organizationId,
    );
    const data = rows.map((row) =>
      toApiClientResponse({
        id: row.Id,
        organizationId: row.OrganizationId,
        name: row.Name,
        keyPrefix: row.KeyPrefix,
        scopes: fromJsonArray(row.Scopes),
        requestsPerMinute: row.RequestsPerMinute,
        createdAtUtc: row.CreatedAtUtc,
        lastUsedAtUtc: row.LastUsedAtUtc ?? null,
        revokedAtUtc: row.RevokedAtUtc ?? null,
      }),
    );
    return c.json({ data, supportedScopes: ApiClientCredentialService.supportedScopes });
  });

  app.post('/api/v1/orgs/:organizationId/api-clients', authorize('Admin'), async (c) => {
    const body = await parseBody(c, createSchema);
    const organizationId = requireGuid(c.req.param('organizationId'));
    if (body.name === null || body.name === undefined) throw validationProblem({ Name: ['The Name field is required.'] });
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    if (body.name.trim().length === 0) throw badRequest({ error: 'A client name is required.' });

    const created = await apiClientCredentials(c).create(organizationId, body.name, body.scopes ?? ['content:read'], body.requestsPerMinute ?? 60);
    return c.json({ client: toApiClientResponse(created.client), clientKey: created.clientKey });
  });

  app.post('/api/v1/orgs/:organizationId/api-clients/:clientId/rotate', authorize('Admin'), async (c) => {
    const organizationId = requireGuid(c.req.param('organizationId'));
    const clientId = requireGuid(c.req.param('clientId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    const rotated = await apiClientCredentials(c).rotate(organizationId, clientId);
    if (rotated === null) throw notFound();
    return c.json({ client: toApiClientResponse(rotated.client), clientKey: rotated.clientKey });
  });

  app.post('/api/v1/orgs/:organizationId/api-clients/:clientId/revoke', authorize('Admin'), async (c) => {
    const organizationId = requireGuid(c.req.param('organizationId'));
    const clientId = requireGuid(c.req.param('clientId'));
    if (!canAccessOrganization(currentUser(c), organizationId)) throw forbidden();
    if (!(await apiClientCredentials(c).revoke(organizationId, clientId))) throw notFound();
    return empty(c, 204);
  });
}
