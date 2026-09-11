# backend-node conventions

Node.js port of `DeenTime/backend/DeenTime.Api` (ASP.NET Core). The port must be a
drop-in replacement: same routes, status codes, JSON field names (camelCase), enum
names, messages, headers and side effects. The .NET code is the source of truth;
read it before porting anything.

## Toolchain
- NestJS 12, TypeScript 6 (strict), **ESM**: every relative import needs a `.js`
  suffix (`import { x } from './file.js'`). Build with `npm run build` (tsc via
  `nest build`), unit tests with `npx vitest run [files]` (`*.spec.ts` next to the
  code), lint with `npm run lint` (oxlint).
- No `any`, no unused code, explicit return types on exported functions.
- Prisma 7 client is generated into `src/generated/prisma` (`npx prisma generate`).
  Import `PrismaService` from `src/prisma/prisma.service.ts`; it extends
  `PrismaClient` and exposes `pool` (pg) for raw SQL.

## Configuration
`AppConfig` (`src/config/configuration.ts`) reads `appsettings.json`,
`appsettings.{Environment}.json` and env vars with `__` separators, exactly like
.NET. Use `config.get('Section:Key')`, `getBoolean`, `getInt`, `getArray`,
`getSection`, `isDevelopment()`. Inject it as a constructor parameter (`AppConfig`).

## Database
`prisma/schema.prisma` maps the EF tables. Models are singular PascalCase
(`Organization`, `AppUser`, `IqamaEntry`, `PrayerTimingCriteria`, `DesignSettings`,
`HijriMonthMap`, `PublishArtifact`, `TvDisplayConfig`, `OrgUser`, `QuranEdition`,
`IslamicContentCacheEntry`, `IslamicContentSyncState`, `HadithBook`, `HadithChapter`,
`HadithRecord`, `ApiClient`, `ApiClientUsage`, `PendingRegistration`,
`MasjidInvitation`); fields are camelCase (`organizationId`, `updatedAtUtc`).
Relation fields: `organization`, `criteria`, `design`, `members`, `iqamaEntries`,
`apiClients`, `artifacts`, `invitations`, `usage`, `invitation`,
`pendingRegistrations`, `apiClient`.
- Ids are generated in code with `randomUUID()` (no DB defaults).
- `date` columns are UTC-midnight `Date`s; `time` columns are `1970-01-01THH:mm:ssZ`
  `Date`s; use the helpers in `src/common/json.ts` (`formatDateOnly`, `parseDateOnly`,
  `timeOnlyFromDb`, `timeOnlyToDb`, `formatTimeOnly` = "HH:mm:ss", `formatTimeShort` =
  "HH:mm", `formatTimeClock` = "h:mm").
- Enums are stored as integers and serialized by name: `salahToDb/salahFromDb/parseSalah`
  (`Fajr`=1 … `Jumuah4th`=10), `enumToDb/enumFromDb/parseEnum` with `PDF_SIZES`
  (`Letter`,`Tabloid`) and `PDF_ORIENTATIONS` (`Portrait`,`Landscape`).
- `numeric` columns come back as Prisma `Decimal`: convert with `toNumber()`; when
  writing, pass a `string`/`number`.
- `BigInt` columns (`IslamicContentCacheEntry.payloadBytes`) must be converted with
  `Number()` before serializing.
- Entity JSON: System.Text.Json serialized the whole entity (camelCase) including
  navigation properties as `null` when not loaded — build response objects
  explicitly with the exact field list from the .NET entity/DTO.

## HTTP conventions
- Controllers use Nest decorators; routes are case-insensitive lower-case
  (`api/v1/orgs`, `public/display/:slug`). Class-level `[Route]` prefixes become the
  `@Controller('api/v1/iqama')` argument.
- Authorization: `@Authorize()` (any signed-in user), `@Authorize('Admin')`,
  `@Authorize('SuperUser')`, `@AuthorizeRoles('Admin','Editor')`, `@AllowAnonymous()`
  from `src/common/auth/authorize.decorator.ts`. Class + handler requirements are
  both enforced (AND). The current user: `@CurrentUser() user: SessionUser | null`
  (`sub`, `email`, `orgId`, `roles`, `issuer`). Helpers in `src/common/auth/claims.ts`:
  `canAccessOrganization(user, orgId)`, `isSuperUser(user)`, `hasRole(user, ...roles)`,
  `satisfiesAdminPolicy(user)`.
- Rate limiting: `@RateLimit('public' | 'auth-login' | 'auth-register' | 'auth-verify' |
  'locations' | 'expensive')` from `src/common/rate-limit.ts` (class or handler).
- Validation: zod schemas + `@Body(validated(schema))` (`src/common/zod-validation.pipe.ts`);
  failures become 400 `ValidationProblemDetails` with PascalCase keys. Reproduce the
  FluentValidation rules/messages from `backend/DeenTime.Api/Validators/*.cs`. Query
  params arrive as strings — parse them yourself.
- Errors (`src/common/errors.ts`): `problem(status, title?, detail?)` (ProblemDetails,
  `application/problem+json`), `validationProblem(errors)`, `badRequest(body)`,
  `badRequestText('plain string')`, `conflict(body)`, `notFound(body?)`, `unauthorized(body?)`,
  `forbidden()` (403 ProblemDetails), `serviceUnavailable(body)`, `tooManyRequests(body?)`.
  Throw them; the global filter renders them. `NotFoundException` etc. from Nest are
  rendered too but prefer the helpers to keep bodies identical to .NET.
- Status codes: `@HttpCode(204)` for NoContent, `@HttpCode(202)` for Accepted, 201 with a
  `Location` header via `@Res({ passthrough: true })`.
- Never log secrets (Hadith API key, SMTP password, client keys).

## Tests
- Unit tests: vitest, deterministic, no network (inject `fetch`/`baseUrl` so
  providers can be stubbed).
- Reference data: the .NET API is running at http://127.0.0.1:8080 (anonymous
  endpoints can be compared directly) and the dev database is
  `postgresql://postgres:postgres@127.0.0.1:5432/deentime` (do not modify data).
