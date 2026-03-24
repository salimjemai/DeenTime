# DeenTime

A .NET 9 + Angular 20 platform for mosque organizations to compute daily prayer times, manage iqama schedules, maintain Hijri month maps, design publishable PDFs, and serve public TV/widget views.

---

## Projects

| Path | Description |
|------|-------------|
| `backend/DeenTime.Api` | ASP.NET Core 9 Web API |
| `backend/DeenTime.Core` | Domain entities and services (ISNA calculator, Hijri service) |
| `backend/DeenTime.Infrastructure` | EF Core DbContext (PostgreSQL via Npgsql) |
| `backend/DeenTime.Contracts` | Shared DTOs |
| `frontend/deentime-web` | Angular 20 PWA (SSR enabled) |

---

## Quick start (Docker)

```bash
cd DeenTime
docker compose up --build
```

- API: http://localhost:8080
- Swagger: http://localhost:8080/swagger  _(development mode only)_
- Health: http://localhost:8080/health/live

The `docker-compose.yml` spins up PostgreSQL 16 and the API together. The DB schema is applied automatically on first run via EF Core migrations.

---

## Local development (without Docker)

### Prerequisites
- .NET 9 SDK
- PostgreSQL 16 (or via `docker compose up db`)
- Node.js 20+ / Angular CLI 20

### 1 — API

```bash
cd DeenTime

# Apply migrations (needs a running Postgres)
dotnet ef database update \
  --project backend/DeenTime.Infrastructure \
  --startup-project backend/DeenTime.Api

# Run
dotnet run --project backend/DeenTime.Api/DeenTime.Api.csproj
```

Swagger UI: http://localhost:5000/swagger

The `appsettings.Development.json` includes a pre-set signing key and local DB connection string so the API works out of the box against a default Postgres install.

### 2 — Angular frontend

```bash
cd DeenTime/frontend/deentime-web
npm install
npm start          # ng serve — http://localhost:4200
```

---

## Configuration

All secrets are injected via environment variables (12-factor). Key settings:

| Key | Description |
|-----|-------------|
| `ConnectionStrings__Default` | PostgreSQL connection string |
| `Auth__SigningKey` | HMAC-SHA256 signing key (≥ 32 chars). Set for local-JWT mode. |
| `Auth__Authority` | OIDC authority URL. Set to use an external IDP instead of local JWT. |
| `Auth__Issuer` | JWT issuer claim |
| `Auth__Audience` | JWT audience claim |
| `Storage__ConnectionString` | Azure Blob Storage connection string. Omit to use local filesystem. |
| `Storage__Container` | Blob container name (default: `deentime`) |
| `Storage__CdnBase` | Optional CDN base URL for blob public URLs |
| `Cors__AllowedOrigins__0` | Allowed CORS origin(s) |
| `Hangfire__ConnectionString` | PostgreSQL connection string for Hangfire. Omit to disable. |

For production, set `Auth__SigningKey` (or `Auth__Authority`) and `ConnectionStrings__Default` via secrets manager / environment — never commit these.

---

## API reference

### Auth
| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/v1/auth/register` | Creates user + org, returns JWT |
| POST | `/api/v1/auth/login` | Returns JWT |
| POST | `/api/v1/auth/forgot` | Stub — implement email delivery |
| POST | `/api/v1/auth/reset` | Stub — implement token validation |

### Organizations
| Method | Path |
|--------|------|
| GET | `/api/v1/orgs?search=&page=` |
| GET | `/api/v1/orgs/{id or slug}` |
| PUT | `/api/v1/orgs/{id}` _(Admin)_ |
| GET | `/api/v1/orgs/{id}/criteria` |
| PUT | `/api/v1/orgs/{id}/criteria` |

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
| POST | `/api/v1/iqama` |
| PUT | `/api/v1/iqama/{id}` |
| DELETE | `/api/v1/iqama/{id}` |

### Design
| Method | Path |
|--------|------|
| GET | `/api/v1/design/{orgId}` |
| PUT | `/api/v1/design/{orgId}` |
| POST | `/api/v1/files/header-image?orgId=` |

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
| GET | `/api/v1/publish/artifacts?orgId=&year=` |
| GET | `/api/v1/publish/pdf/{artifactId}` |

### Public (unauthenticated)
| Method | Path |
|--------|------|
| GET | `/public/widget/{slug}` |
| GET | `/public/tv/{slug}` |

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
| `IqamaEntry` | OrganizationId, Date, Salah, Time, Note |
| `DesignSettings` | OrganizationId, HeaderImageUrl, IqamaHeadings[], FooterHtml, Theme |
| `HijriMonthMap` | OrganizationId, Year, Month, HijriDayOnFirst, Locked |
| `PublishArtifact` | OrganizationId, Year, Month, Size, Orientation, StorageUrl |
| `TvDisplayConfig` | OrganizationId, ShowSeconds, ShowHijri, AccentColor, AutoRefreshSeconds |
| `OrgUser` | OrganizationId, Issuer, Subject (JWT sub), Roles[] |
| `AppUser` | Email (unique), PasswordHash, PasswordSalt |

---

## Prayer time algorithm

`IsnaCalculator` implements the full ISNA solar-angle method:

- **Fajr / Isha**: 15° below the horizon
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
- [ ] Implement email delivery in `AuthController.Forgot` / `Reset`
- [ ] Run `dotnet ef database update` on deploy (or use migration bundles)
- [ ] Secure `/jobs` (Hangfire dashboard) behind authentication or remove in non-background deployments

---

## UML diagrams

Diagrams (class, component, sequence, deployment) are in [DeenTime/uml/](DeenTime/uml/).
