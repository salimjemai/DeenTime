# IqamaTime

## Deterministic local startup

From the repository root, run:

```bash
./DeenTime/scripts/start-local.sh
```

The launcher verifies native PostgreSQL on port 5432, builds and starts the Node.js API (`DeenTime/backend-node`) on port 8080, waits for database-backed readiness, and then starts Angular at `http://127.0.0.1:4200`. `DEENTIME_API_RUNTIME=dotnet ./DeenTime/scripts/start-local.sh` starts the original ASP.NET Core API instead (kept for parity checks). It generates an ephemeral JWT signing key and local super-user password when those values are not supplied. The generated password is printed once by the launcher; it is not stored in the repository.

Optional secrets are supplied through the environment or an untracked local `.env` file. Copy `DeenTime/.env.example` as a reference. Set `DEENTIME_HADITH_API_KEY` only in a secret store or shell environment; the upstream provider key is never sent to browsers or committed.

Runtime checks:

- API liveness: `http://127.0.0.1:8080/health/live`
- API readiness: `http://127.0.0.1:8080/health/ready`
- API build/schema metadata: `http://127.0.0.1:8080/api/version`
- Angular: `http://127.0.0.1:4200`

A Node.js (NestJS + Prisma) + Angular 20 platform for mosque organizations to compute daily prayer times, manage iqama schedules, maintain Hijri month maps, design publishable PDFs, and serve public TV/widget views.

## Legacy IqamaTime migration coverage

| Legacy area | IqamaTime coverage | Modern improvement |
|-------------|-------------------|--------------------|
| Profile | Organization identity, address, contact details and calculation criteria | One organization-scoped admin workspace with live validation |
| Iqama | Effective-date schedules for Fajr, Dhuhr, Asr, Maghrib, Isha and up to four Jumu'ah services | Fast five-prayer editor, fixed or prayer-relative times, recurring rules and history |
| Design | Shared image, published headings, footer and theme | One upload propagates immediately to TV, full widget, compact widget and previews |
| Timings | Daily and monthly calculated prayer starts | Multiple calculation methods, juristic settings and live previews |
| Hijri | Month mapping and manual adjustments | Lockable month mappings and controlled regeneration |
| Publish | TV link, two website widgets and downloadable monthly timetable | Responsive TV, modern widgets, embed code, monthly/Ramadan PDFs and output controls |
| Legacy URLs | `/clock`, `iqama-widget.php`, `iqama-widget2.php` | Compatibility redirects preserve existing masjid integrations |

IqamaTime also adds the Quran/Hadith content library and rate-limited public JSON APIs without removing the migrated scheduling workflows.

---

## Projects

| Path | Description |
|------|-------------|
| `backend-node` | **The API**: NestJS 12 + Prisma 7 on PostgreSQL (see `backend-node/README.md`) |
| `frontend/deentime-web` | Angular 20 PWA |
| `backend/DeenTime.Api` | Original ASP.NET Core 9 Web API — reference implementation kept for parity checks until retired |
| `backend/DeenTime.Core` | Original domain entities and services (ISNA calculator, Hijri service) |
| `backend/DeenTime.Infrastructure` | Original EF Core DbContext and migrations (the schema the Node API inherits) |
| `backend/DeenTime.Contracts` | Original shared DTOs |

---

## Quick start

```bash
cd DeenTime
./scripts/start-local.sh
```

- API: http://localhost:8080
- Health: http://localhost:8080/health/live
- Angular: http://127.0.0.1:4200

The script expects a local PostgreSQL (`brew install postgresql@16 && brew services start postgresql@16` on macOS), creates the `deentime` database and the `postgres` role if missing, builds and starts the Node.js API, then starts the Angular dev server. The DB schema is applied automatically at API startup (SQL migrations under `backend-node/prisma/migrations`; a database created by the original EF Core migrations is adopted as is).

---

## Local development (manual)

### Prerequisites
- PostgreSQL 16
- Node.js 22.12+ (or 24+)
- .NET 9 SDK only if you want to run the original API for comparison

### 1 — API

```bash
cd DeenTime/backend-node
npm ci
npm run build
ConnectionStrings__Default="Host=localhost;Port=5432;Database=deentime;Username=postgres;Password=postgres" \
Auth__SigningKey="a-local-signing-key-of-at-least-32-characters" \
ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://127.0.0.1:8080 \
node dist/main.js
```

Migrations run at startup. `appsettings.Development.json` carries the local DB
connection string and defaults; secrets come from environment variables.

### 2 — Angular frontend

```bash
cd DeenTime/frontend/deentime-web
npm ci
npm start          # ng serve — http://localhost:4200
```

---

## Configuration

All secrets are injected via environment variables (12-factor). Key settings:

| Key | Description |
|-----|-------------|
| `ConnectionStrings__Default` | PostgreSQL connection string |
| `Auth__SigningKey` | HMAC-SHA256 signing key (≥ 32 chars). Set for local-JWT mode. |
| `Auth__Authority` | OIDC authority URL (original .NET API only; the Node.js API requires `Auth__SigningKey`). |
| `Auth__Issuer` | JWT issuer claim |
| `Auth__Audience` | JWT audience claim |
| `Storage__ConnectionString` | Azure Blob Storage connection string. Omit to use local filesystem. |
| `Storage__Container` | Blob container name (default: `deentime`) |
| `Storage__CdnBase` | Optional CDN base URL for blob public URLs |
| `Cors__AllowedOrigins__0` | Allowed CORS origin(s) |
| `Hangfire__ConnectionString` | Original .NET API only; the Node.js API runs its sync worker in-process and reports it at `/jobs`. |

For production, set `Auth__SigningKey` (or `Auth__Authority`) and `ConnectionStrings__Default` via secrets manager / environment — never commit these.

---

## API reference

### Auth
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/v1/auth/register` | Creates user + org, returns JWT |
| POST | `/api/v1/auth/login` | Returns JWT |
| POST | `/api/v1/auth/forgot` | Emails a single-use reset link (30 min); same 202 whether or not the email exists |
| POST | `/api/v1/auth/reset` | Validates the link token and sets the new password |

### Organizations
| Method | Path |
|--------|------|
| GET | `/api/v1/orgs?search=&page=` |
| GET | `/api/v1/orgs/{id or slug}` |
| PUT | `/api/v1/orgs/{id}` _(Admin)_ |
| GET | `/api/v1/orgs/{id}/criteria` |
| PUT | `/api/v1/orgs/{id}/criteria` |
| DELETE | `/api/v1/orgs/{id}/criteria` |

### Timings (computed)
| Method | Path |
|--------|------|
| GET | `/api/v1/timings?orgId=&date=YYYY-MM-DD` |
| GET | `/api/v1/timings/range?orgId=&from=&to=` |
| GET | `/api/v1/timings/today?orgId=` |

### Iqama
| Method | Path |
|--------|------|
| GET | `/api/v1/iqama?orgId=&year=YYYY` |
| GET | `/api/v1/iqama/current?orgId=&date=YYYY-MM-DD` |
| PUT | `/api/v1/iqama/schedule` _(atomic five-prayer editor)_ |
| POST | `/api/v1/iqama` |
| PUT | `/api/v1/iqama/{id}` |
| DELETE | `/api/v1/iqama/{id}` |

### Design
| Method | Path |
|--------|------|
| GET | `/api/v1/design/{orgId}` |
| PUT | `/api/v1/design/{orgId}` |
| POST | `/api/v1/design/files/header-image?orgId=` _(uploads and applies to every public view)_ |

### Hijri
| Method | Path |
|--------|------|
| GET | `/api/v1/hijri/{orgId}?from=YYYY-MM&to=YYYY-MM` |
| POST | `/api/v1/hijri` |
| PUT | `/api/v1/hijri/{id}` |
| POST | `/api/v1/hijri/regenerate/{orgId}?from=&to=` |

### Publish
| Method | Path |
|--------|------|
| GET | `/api/v1/publish/embed-code/{orgId}` |
| GET | `/api/v1/publish/tv-config/{orgId}` |
| POST | `/api/v1/publish/pdf/generate` |
| POST | `/api/v1/publish/pdf/ramadan` |
| GET | `/api/v1/publish/artifacts?orgId=&year=` |
| GET | `/api/v1/publish/pdf/{artifactId}` |

### Public (unauthenticated)
| Method | Path |
|--------|------|
| GET | `/public/display/{slug}` |
| GET | `/public/widget/{slug}` _(redirects to `/w/{slug}`)_ |
| GET | `/public/tv/{slug}` _(redirects to `/tv/{slug}`)_ |
| GET | `/public/organizations/{slug}/displays` _(absolute public display URLs and iframe snippets)_ |
| GET | `/clock?masjid={slug}` _(legacy-compatible redirect)_ |
| GET | `/iqama-widget.php?...` and `/iqama-widget2.php?...` _(legacy-compatible redirects)_ |

### Health
| Method | Path |
|--------|------|
| GET | `/health/live` |
| GET | `/health/ready` |

---

## Data model

| Entity | Key fields |
|--------|-----------|
| `Organization` | Id, Slug (unique), Name, Address, Criteria, Design |
| `PrayerTimingCriteria` | Method, JuristicMethodAsr, Lat/Lng, TimezoneId, MinutesAfterZawal/Maghrib |
| `IqamaEntry` | OrganizationId, effective Date, Salah, Time or prayer-relative OffsetMinutes, Note |
| `DesignSettings` | OrganizationId, HeaderImageUrl, IqamaHeadings[], FooterHtml, Theme, per-layout font scales/families |
| `HijriMonthMap` | OrganizationId, Gregorian Year/Month, full Hijri date on the first, Locked |
| `PublishArtifact` | OrganizationId, Year, Month, Size, Orientation, StorageUrl |
| `TvDisplayConfig` | OrganizationId, ShowSeconds, ShowHijri, AccentColor, AutoRefreshSeconds |
| `OrgUser` | OrganizationId, Issuer, Subject (JWT sub), Roles[] |
| `AppUser` | Email (unique), PasswordHash, PasswordSalt |

---

## Prayer time algorithm

`IsnaCalculator` implements the solar-angle calculation used by the legacy service and supports ISNA, Karachi, Muslim World League, Umm al-Qura, Egyptian, Gulf, Kuwait, Qatar, Tehran, and Jafari presets:

- **Fajr / Isha**: method-specific angles or fixed intervals
- **Dhuhr**: solar noon + `MinutesAfterZawal`
- **Asr**: Shafi'i (shadow factor 1) or Hanafi (shadow factor 2), controlled by `JuristicMethodAsr`
- **Maghrib**: sunset + `MinutesAfterMaghrib`

Times are returned in the organization's configured IANA timezone.

---

## Production checklist

- [ ] Set strong `Auth__SigningKey` (≥ 32 chars) **or** configure `Auth__Authority` for an external OIDC provider
- [ ] Set `ConnectionStrings__Default` to your production PostgreSQL URL
- [ ] Set `Storage__ConnectionString` to Azure Blob Storage (omit to fall back to local disk — not suitable for multi-instance)
- [ ] Set `Cors__AllowedOrigins__0` to your production frontend domain
- [ ] Set `EmailDelivery__*` so verification, invitation and password-reset emails are delivered
- [ ] Let the API apply migrations at startup (it exits non-zero if they fail) and check `/health/ready`
- [ ] `/jobs` is a super-user-only JSON status endpoint in the Node.js API (no Hangfire dashboard)

---

## UML diagrams

Diagrams (class, component, sequence, deployment) are in [DeenTime/uml/](DeenTime/uml/).
