# IqamaTime API (Node.js)

Node.js implementation of the IqamaTime / DeenTime API: NestJS 12, TypeScript,
Prisma 7 on PostgreSQL. It is a drop-in replacement for the original ASP.NET Core
API in `../backend` — same routes, JSON payloads, JWT format, password hashes,
database schema, configuration keys and scripts — so the Angular app in
`../frontend/deentime-web` and every deployment script keep working unchanged.

## Run locally

```bash
# from DeenTime/ (PostgreSQL must be listening on 127.0.0.1:5432)
scripts/start-local.sh            # Node API on http://127.0.0.1:8080 + Angular on :4200
DEENTIME_API_RUNTIME=dotnet scripts/start-local.sh   # the original .NET API instead
```

Manual run:

```bash
cd backend-node
npm ci
npm run prisma:generate
npm run build
ConnectionStrings__Default="Host=localhost;Port=5432;Database=deentime;Username=postgres;Password=postgres" \
Auth__SigningKey="<at least 32 characters>" \
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:8080 \
node dist/main.js
```

## Configuration

Identical to the .NET API: `appsettings.json`, `appsettings.{Environment}.json`
(`ASPNETCORE_ENVIRONMENT`, `DOTNET_ENVIRONMENT` or `NODE_ENV` pick the environment;
`Development` enables the on-screen verification/reset links) and environment
variables with `__` separators (`ConnectionStrings__Default`, `Auth__SigningKey`,
`SuperUser__Email`, `SuperUser__Password`, `Support__Email`,
`EmailDelivery__Enabled`, `Storage__ConnectionString`, `IslamicContent__HadithApiKey`,
`Frontend__PublicBaseUrl`, `Cors__AllowedOrigins__0`, `Build__CommitSha`, ...).
`ASPNETCORE_URLS` (or `Urls` / `PORT`) sets the listen address.

## Database and migrations

`prisma/schema.prisma` describes the tables created by the Entity Framework
migrations. On start the API applies pending SQL migrations from
`prisma/migrations` (recorded in `_prisma_migrations`); a database that already
carries the EF schema gets the baseline marked as applied without changes.
`/health/ready` reports pending migrations and returns 503 until they are applied.

Developer workflow for schema changes:

```bash
cd backend-node
npx prisma migrate dev --name add_something   # edits schema.prisma → SQL migration
npm run prisma:generate
```
Then update `CURRENT_SCHEMA_VERSION` in `src/domain/build-info.ts`.

The Prisma CLI reads `DATABASE_URL` from `backend-node/.env` (see `.env.example`);
the running API never uses that file.

## Static hosting

When `wwwroot/` contains the Angular production build, the API serves it with the
same rules as the self-hosted .NET package: `no-store` for `index.html` and
`ngsw.json`, SPA fallback for unknown routes except `/api`, `/health`, `/public`,
`/uploads`, `/jobs` and `/swagger`, and `frame-ancestors *` for `/tv`, `/w`, `/w2`.

## Tests

```bash
npm test                 # unit tests (vitest)
npm run test:e2e         # integration tests: one throwaway PostgreSQL database per file
npm run parity           # compare responses with the .NET API (see test/parity)
```
Integration tests use `DEENTIME_TEST_POSTGRES_ADMIN`
(default `postgresql://postgres:postgres@127.0.0.1:5432/postgres`).

## Layout

- `src/config` – appsettings/env loader
- `src/common` – errors (ProblemDetails), JSON helpers, auth guards, rate limits, validation
- `src/prisma` – Prisma service, migration runner
- `src/domain` – prayer-time calculator, Hijri calendar, password hashing, identity rules
- `src/integrations` – postal codes, Google Places, Turnstile, email, storage, Qur'an/Hadith/Qibla providers
- `src/modules` – one module per .NET controller
- `src/startup` – migrations, backfill and super-user seeding
- `test/` – integration tests and parity script

See `CONVENTIONS.md` for the porting rules.
