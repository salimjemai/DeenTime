# DeenTime

A .NET 9 + Angular 20 platform for mosque organizations to compute daily prayer times, manage iqama schedules, maintain Hijri month maps, design publishable PDFs, and serve public TV/widget views.

## Legacy IqamaTime migration coverage

| Legacy area | DeenTime coverage | Modern improvement |
|-------------|-------------------|--------------------|
| Profile | Organization identity, address, contact details and calculation criteria | One organization-scoped admin workspace with live validation |
| Iqama | Effective-date schedules for Fajr, Dhuhr, Asr, Maghrib, Isha and up to four Jumu'ah services | Fast five-prayer editor, fixed or prayer-relative times, recurring rules and history |
| Design | Shared image, published headings, footer and theme | One upload propagates immediately to TV, full widget, compact widget and previews |
| Timings | Daily and monthly calculated prayer starts | Multiple calculation methods, juristic settings and live previews |
| Hijri | Month mapping and manual adjustments | Lockable month mappings and controlled regeneration |
| Publish | TV link, two website widgets and downloadable monthly timetable | Responsive TV, modern widgets, embed code, monthly/Ramadan PDFs and output controls |
| Legacy URLs | `/clock`, `iqama-widget.php`, `iqama-widget2.php` | Compatibility redirects preserve existing masjid integrations |

DeenTime also adds the Quran/Hadith content library and rate-limited public JSON APIs without removing the migrated scheduling workflows.

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
- Node.js 20.19+, 22.12+, or 24+ (Angular CLI is installed locally)

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
| `DesignSettings` | OrganizationId, HeaderImageUrl, IqamaHeadings[], FooterHtml, Theme |
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
- [ ] Implement email delivery in `AuthController.Forgot` / `Reset`
- [ ] Run `dotnet ef database update` on deploy (or use migration bundles)
- [ ] Secure `/jobs` (Hangfire dashboard) behind authentication or remove in non-background deployments

---

## UML diagrams

Diagrams (class, component, sequence, deployment) are in [DeenTime/uml/](DeenTime/uml/).
