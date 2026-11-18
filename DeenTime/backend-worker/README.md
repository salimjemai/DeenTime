# MasjidHub API on Cloudflare Workers + D1

Port of `../backend-node` (NestJS + Prisma + PostgreSQL) to a single Worker: Hono router,
zod validation, raw SQL on D1, no ORM, no Node built-ins (`nodejs_compat` is not required).
Routes, status codes, headers and JSON bodies must stay identical to backend-node; the
Angular app in `../frontend/deentime-web` is not changed.

Status: the foundation (`src/core`, `src/domain`, `health`) is complete. The other modules
are registered stubs waiting to be ported.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Applies migrations to the local D1, then `wrangler dev` on http://127.0.0.1:8788 with local D1 + KV (`wrangler.local-dev.jsonc`, local use only) |
| `npm test` | vitest inside workerd (`@cloudflare/vitest-plugin`) against a local D1 with `migrations/` applied |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | esbuild → `dist/_worker.js` (one ESM file for a Pages advanced-mode upload); prints raw and gzip size |
| `npm run db:migrate:local` | Applies `migrations/*.sql` to the local D1 |

Bindings the deployed worker needs: `DB` (D1), `UPLOADS` (KV), `ASSETS` (Pages assets).
The build injects `Build:CommitSha` (git HEAD, or `BUILD_COMMIT_SHA`) and the build time.

## Layout

```
src/index.ts          Worker entry: API paths → app, everything else → env.ASSETS
src/app.ts            createApp(): pipeline + register(app) of every module
src/core/             errors, http pipeline, config, jwt, auth, password-hasher, rate-limit, validation, db, json
src/common/           one-line re-exports (json, errors, paged-result) so files copied from backend-node import unchanged
src/domain/           pure domain code copied from backend-node, with its specs and fixtures
src/modules/<name>.ts one file per backend-node module, exporting register(app)
src/modules/<name>/   optional helpers of that module (schemas, mappers, queries)
migrations/           D1 schema
test/support/         createTestApp() harness
```

API paths (case-insensitive, as in the Pages proxy worker): `/api/*`, `/public/*`,
`/uploads/*`, `/health/*`, `/jobs`, `/jobs/*`, `/clock`, `/iqama-widget.php`,
`/iqama-widget2.php`.

## Writing a module

Edit only your own `src/modules/<name>.ts` and `src/modules/<name>/`. `app.ts` already calls
your `register`. Example covering every convention:

```ts
import { authorize, canAccessOrganization } from '../core/auth.js';
import { config, currentUser, db, type App } from '../core/context.js';
import { fromJsonArray, newId, normalizeId, now, toJsonArray } from '../core/db.js';
import { forbidden, notFound } from '../core/errors.js';
import { rateLimit } from '../core/rate-limit.js';
import { parseBody } from '../core/validation.js';
import { updateSchema } from './things/things.schemas.js'; // copied from backend-node as-is

export function register(app: App): void {
  app.put('/api/v1/things/:orgId', rateLimit('expensive'), authorize('Admin'), async (c) => {
    const orgId = normalizeId(c.req.param('orgId'));
    if (!canAccessOrganization(currentUser(c), orgId)) throw forbidden();
    const input = await parseBody(c, updateSchema);
    const row = await db(c).first<{ Id: string; Tags: string }>('SELECT "Id", "Tags" FROM "Things" WHERE "OrganizationId" = ?', orgId);
    if (!row) throw notFound();
    await db(c).run('UPDATE "Things" SET "Tags" = ?, "UpdatedAtUtc" = ? WHERE "Id" = ?', toJsonArray(input.tags), now(), row.Id);
    return c.json({ id: row.Id, tags: input.tags, supportEmail: config(c).get('Support:Email') ?? null });
  });
}
```

**Routes.** Register full paths on `app` (`app.get/post/put/delete`). Static segments must be
lower-case (`test/routes.spec.ts` checks this); matching is then case-insensitive and ignores
one trailing slash, like Express. `c.req.param()` returns the caller's spelling.
NestJS answers `@Post` with **201** unless the controller says `@HttpCode`; pass the status
explicitly: `c.json(body, 201)`.

**Order of route middleware** is backend-node's guard order: `rateLimit(...)` first, then
`authorize(...)`.

**Authorize** (`core/auth.ts`). A missing or invalid token is 401 and a failed policy is 403,
both with an empty body.

| backend-node | here |
| --- | --- |
| `@Authorize()` | `authorize()` |
| `@Authorize('Admin')` / `@Authorize('SuperUser')` | `authorize('Admin')` / `authorize('SuperUser')` |
| `@AuthorizeRoles('Admin', 'Editor')` | `authorizeRoles('Admin', 'Editor')` |
| class-level + handler-level | list both: `authorize(), authorize('SuperUser')` |
| `@AllowAnonymous()` | no middleware |
| `@CurrentUser()` | `currentUser(c)` (null when anonymous) or `requireUser(c)` (401 when anonymous) |
| `canAccessOrganization`, `hasRole`, `isSuperUser`, `satisfiesAdminPolicy` | same names, same arguments |
| `JwtService.issue / verify` | `await jwt(c).issue(user, organizationId, roles)` / `await jwt(c).verify(token)` |

The session user is `{ sub, email, orgId, roles, issuer }`, set for every request that carries
a valid `Authorization: Bearer` token, including anonymous routes.

**Rate limit** (`core/rate-limit.ts`). `rateLimit('public' | 'auth-login' | 'auth-register' |
'auth-verify' | 'locations' | 'expensive')`, same limits as backend-node, 429 with an empty
body. `public` counts in the isolate's memory; the others count in the D1 table
`RateLimitWindows` (one write per request). IP policies partition on `clientAddress(c)`
(`CF-Connecting-IP`, `"unknown"` if absent or not an IP); `expensive` on `<orgId>:<sub>`.

**Validate** (`core/validation.ts`). `await parseBody(c, schema)` reads the body (JSON,
form-encoded, or `{}`), applies the zod schema and throws backend-node's 400
`{ title, status, errors }` with PascalCase keys. `validate(schema, value)` does the same for
a value you already have (query strings). `readBody(c)` returns the raw parsed body.
zod is the same major (4) as backend-node, so `*.schemas.ts` files copy over unchanged;
their `../../common/json.js` import resolves through `src/common/`.

**Throw problems** (`core/errors.ts`, same function names as backend-node):
`problem(status, title?, detail?)`, `validationProblem(errors)`, `modelValidationProblem(errors)`,
`notFound(body?)`, `unauthorized(body?)`, `forbidden()`, `badRequest(body)`,
`badRequestText(message)`, `conflict(body)`, `serviceUnavailable(body)`, `tooManyRequests(body?)`.
Throw them; the pipeline renders them, adds `traceId` where backend-node does, and turns any
other error into the 500 problem with the correlation id.

**Respond.** `c.json(body, status?)` for JSON (the pipeline sets
`application/json; charset=utf-8`), `text(c, body, status?, contentType?)` and `empty(c, status?)`
from `core/http.ts`, `c.redirect(url, 302)` for redirects. Correlation id, security headers
and CORS are applied to every response by the pipeline; do not set them in a module.

**Serialize** (`core/json.ts`, same helpers as backend-node's `common/json.ts`). Build the
response object with the same property names and order as the backend-node mapper, then
`c.json` it. Use `formatDateOnly`, `formatTimeOnly`, `formatDateTime`, `salahFromDb`,
`enumFromDb`, `toNumber` exactly where the original mapper does.

**Query** (`core/db.ts`). `db(c)` returns the helper:

| Call | Result |
| --- | --- |
| `first<T>(sql, ...params)` | first row or `null` |
| `all<T>(sql, ...params)` | rows |
| `run(sql, ...params)` | `{ changes }` |
| `stmt(sql, ...params)` | bound statement for `batch` |
| `batch([stmt, ...])` | all statements in one transaction (all or nothing) |

Parameters are positional `?`; `undefined` binds NULL, booleans bind 0/1, a `Date` binds its
ISO string. Quote identifiers (`"Organizations"."Slug"`): names are PascalCase as in
PostgreSQL. Rows come back keyed by column name (`row.OrganizationId`), not Prisma's
camelCase. Also exported: `newId()`, `normalizeId(id)`, `now()`, `toJsonArray`, `fromJsonArray`,
`fromDbBool`, `isUniqueViolation(error)` (Prisma `P2002`).

Differences from Prisma/PostgreSQL to keep in mind:

- There is no interactive transaction. Read first, then write everything in one `batch`.
  Guard races with `WHERE` conditions and unique indexes, then check `changes`.
- Ids are text: lowercase request ids with `normalizeId` before binding (PostgreSQL `uuid`
  comparison ignores case, text comparison does not).
- `LIKE` is case-insensitive for ASCII in SQLite and there is no `ILIKE`. For Prisma
  `mode: 'insensitive'` use `LOWER(col) = LOWER(?)`; for a case-sensitive match use `=` or `GLOB`.
- Free-plan budget: about 10 ms CPU and 50 subrequests per request. Each D1 call is a
  subrequest; a `batch` is one. Fetch what a handler needs in as few queries as possible.

**Settings** (`core/config.ts`). `config(c).get('Section:Key')`, `getOrDefault`, `getBoolean`,
`getInt`, `getNumber`, `getArray`, `getSection`: the same API and names as backend-node.
Defaults are `appsettings.json` in this folder (bundled at build time); Worker variables and
secrets named `Section__Key` (`Auth__SigningKey`, `Cors__AllowedOrigins__0`) override them.
The free plan allows 64 variables per Worker.

**Passwords** (`core/password-hasher.ts`). `await hashPassword(password)` → `{ hash, salt }`;
`await verifyPassword(password, hash, salt)` → `'valid' | 'invalid' | 'unsupported'`;
`needsRehash(hash)`; `await burnPasswordCheck(password)` for unknown accounts (replaces
backend-node's `DUMMY_PASSWORD`). On `'unsupported'` the login handler must tell the user to
reset their password. See "Password hashing" below.

**Hashing.** `sha256HexLower(text)` in `core/sha256.ts` is synchronous;
`hashToken` / `sha256Hex` in `domain/registration-identity.ts` use it. Random bytes:
`randomBytes(n)` in `core/encoding.ts`.

**Test.** Put specs in `test/<module>.spec.ts` (or next to the code as `*.spec.ts`):

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './support/test-app.js';

describe('things', () => {
  let app: TestApp;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => { await app.reset(); });

  it('updates', async () => {
    const { token, organization } = await app.seed.signIn({ roles: ['Admin'] });
    const response = await app.request('PUT', `/api/v1/things/${organization.id}`, { token, json: { tags: ['a'] } });
    expect(response.status).toBe(200);
  });
});
```

`createTestApp({ settings })` takes settings by variable name (`{ Captcha__Enabled: 'true' }`).
`app.request(method, path, { json, token, headers, body })` goes through the worker entry.
`app.seed.user / organization / membership / signIn`, `app.token(user, orgId, roles)`,
`app.db`, `app.reset()`. Each test file gets its own migrated D1. Tests run in workerd, so
Node APIs (`node:fs`, `Buffer`) are not available in code under test.

## Column formats

Table, column and index names are identical to PostgreSQL. Values use these formats; data
copied from PostgreSQL must be converted to them.

| PostgreSQL | D1 | Format | JSON output |
| --- | --- | --- | --- |
| `uuid` | TEXT | lowercase `8-4-4-4-12` | the string |
| `timestamptz` | TEXT | ISO-8601 UTC with exactly 3 fractional digits and `Z`: `2026-11-18T09:30:00.000Z` (`Date.toISOString()`, `now()`) | the stored string as is; this is what backend-node emits |
| `date` | TEXT | `YYYY-MM-DD` | the stored string (`formatDateOnly`) |
| `time` | TEXT | `HH:mm:ss` | the stored string (`formatTimeOnly`) |
| `text[]` | TEXT | JSON array, `["Admin","Editor"]` | `fromJsonArray(value)` |
| `jsonb` | TEXT | JSON document | `JSON.parse(value)` |
| `decimal` | REAL | double | number, as backend-node's `toNumber` |
| `bigint` | INTEGER | integer | number |
| `boolean` | INTEGER | 0 / 1 | `fromDbBool(value)` |
| `varchar(n)` | TEXT | length not enforced by SQLite | the string |
| enums (`Salah`, `Size`, `Orientation`) | INTEGER | unchanged | `salahFromDb` / `enumFromDb` |

The fixed-width timestamp format sorts chronologically as text, so `<`, `>` and `ORDER BY`
work on it. In memory, `DateOnly` stays a UTC-midnight `Date` and `TimeOnly` an
`{ hour, minute, second }` object as in backend-node; convert at the query boundary with
`dateOnlyFromDb` / `dateOnlyToDb` / `timeOnlyFromDb` / `timeOnlyToDb`.

Foreign keys are enforced by D1 with the same `ON DELETE` rules as PostgreSQL.
`RateLimitWindows` exists only here.

## Password hashing

Stored format is unchanged: `pbkdf2-sha256$<iterations>$<base64>` plus a separate base64
salt; a bare base64 hash is the legacy 100,000-iteration format.

- New hashes use 100,000 iterations. backend-node verifies them, and would rewrite them at
  600,000 on the next login there, so do not run both APIs against the same accounts.
- Hashes above 100,000 iterations (everything backend-node wrote at 600,000) return
  `'unsupported'` without being computed. Those users must reset their password.
- Measured in local workerd 1.20261117: one 100,000-iteration hash takes 62–64 ms. Local
  workerd does not cap the iteration count (600,000 computed in 378 ms); the ceiling is
  enforced in `password-hasher.ts` (`MAX_SUPPORTED_ITERATIONS`). A platform
  `NotSupportedError` is also mapped to `'unsupported'`.
- 62 ms is over the free plan's 10 ms CPU allowance. Login, registration and password
  reset each compute one hash; whether production tolerates that has not been tested.

## Differences from backend-node

- No `ETag` / `304 Not Modified` on JSON responses (Express adds weak ETags).
- `OPTIONS` without an allowed `Origin` is 404; Express answers 200 with an `Allow` header
  on matched paths.
- `/health/ready` reports `schemaVersion: "0001_init"` (was `"0_baseline"`) and detects a
  pending migration by a table it creates (`MIGRATION_PROBES` in `modules/health/build-info.ts`).
- `/api/version` `buildTimeUtc` falls back to the isolate's first request time when no build
  time is configured or injected (backend-node used the entry file's mtime).
- The message inside the malformed-JSON 400 comes from workerd's `JSON.parse`.
- Compression, static files and the SPA fallback are done by Cloudflare, not by the worker.
- `appsettings.{Environment}.json` is not layered; only `appsettings.json` is bundled.
  Development values come from `vars` in `wrangler.local-dev.jsonc` or a `.dev.vars` file.

## Changes to files copied from backend-node

- `domain/registration-identity.ts`: `node:crypto` → `core/sha256.ts`; `base64Url` takes a
  `Uint8Array` instead of a `Buffer`.
- `domain/*.spec.ts`: fixtures are imported as JSON modules instead of `readFileSync`;
  `hijri-calendar.spec.ts` hashes with `core/sha256.ts`.
- `core/json.ts`: `timeOnlyFromDb` / `timeOnlyToDb` work on `HH:mm:ss` text; added
  `dateOnlyFromDb` / `dateOnlyToDb`; `formatDateTime` also accepts the stored string.
- `hijri-calendar.ts`, `hijri.ts`, `prayer-times.ts`, `timezone.ts`: unchanged.
