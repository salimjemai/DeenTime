# DeenTime

Overview

DeenTime is a .NET 8 + Angular application for managing mosque organizations, computing daily prayer times, editing iqama schedules, maintaining Hijri month maps, designing publishable PDFs, and serving public TV/widget views.

Projects

- backend/DeenTime.Api: ASP.NET Core Web API (Controllers)
- backend/DeenTime.Core: Entities and domain services
- backend/DeenTime.Infrastructure: EF Core DbContext and configuration
- backend/DeenTime.Contracts: Cross-project DTOs
- frontend: Angular app (to be scaffolded)

Run locally

1) API
- dotnet run --project DeenTime/backend/DeenTime.Api/DeenTime.Api.csproj
- Swagger: http://localhost:5000/swagger

2) Angular (example)
- npm i -g @angular/cli
- ng new deentime --routing --style=scss
- cd deentime && npm i @angular/material
- ng serve --open

Key API endpoints

Auth
- POST /api/v1/auth/register
- POST /api/v1/auth/login
- POST /api/v1/auth/forgot
- POST /api/v1/auth/reset

Organizations + Criteria
- GET /api/v1/orgs?search=&page=
- GET /api/v1/orgs/{id or slug}
- PUT /api/v1/orgs/{id}
- GET /api/v1/orgs/{id}/criteria
- PUT /api/v1/orgs/{id}/criteria

Timings (computed)
- GET /api/v1/timings?orgId=&date=YYYY-MM-DD
- GET /api/v1/timings/range?orgId=&from=&to=
- GET /api/v1/timings/today?orgId=

Iqama
- GET /api/v1/iqama?orgId=&year=YYYY
- POST /api/v1/iqama
- PUT /api/v1/iqama/{id}
- DELETE /api/v1/iqama/{id}

Design
- GET /api/v1/design/{orgId}
- PUT /api/v1/design/{orgId}
- POST /api/v1/files/header-image?orgId= (presigned recommended)

Hijri
- GET /api/v1/hijri/{orgId}?from=YYYY-MM&to=YYYY-MM
- POST /api/v1/hijri
- PUT /api/v1/hijri/{id}
- POST /api/v1/hijri/regenerate/{orgId}?from=&to=

Publish
- GET /api/v1/publish/embed-code/{orgId}
- GET /api/v1/publish/tv-config/{orgId}
- POST /api/v1/publish/pdf/generate
- GET /api/v1/publish/artifacts?orgId=&year=
- GET /api/v1/publish/pdf/{artifactId}

Public
- GET /public/widget/:slug
- GET /public/tv/:slug

Entities (EF Core)

- Organization(Id, Slug, Name, Address..., Criteria, Design, UpdatedAtUtc)
- PrayerTimingCriteria(Id, OrganizationId, Method, JuristicMethodAsr, Latitude, Longitude, TimezoneId, DstObserved, DstBegins, DstEnds, ZipCode, MinutesAfterZawal, MinutesAfterMaghrib, KhutbahTimeMinutes, UpdatedAtUtc)
- IqamaEntry(Id, OrganizationId, Date, Salah, Time, Note, UpdatedAtUtc)
- DesignSettings(Id, OrganizationId, HeaderImageUrl, IqamaHeadings[], FooterHtml, Theme, UpdatedAtUtc)
- HijriMonthMap(Id, OrganizationId, Year, Month, HijriDayOnFirst, Locked, UpdatedAtUtc)
- PublishArtifact(Id, OrganizationId, Year, Month, Size, Orientation, StorageUrl, CreatedAtUtc)
- TvDisplayConfig(Id, OrganizationId, ShowSeconds, ShowHijri, AccentColor, AutoRefreshSeconds)
- OrgUser(Id, OrganizationId, UserId, Role)

Services

- IPrayerTimeCalculator / IsnaCalculator: produces PrayerTimesDto (placeholder values by default)
- IHijriService / HijriService: generates HijriMonthMap rows for a range; controller preserves Locked rows

Caching and rate limiting

- OutputCache policy "public-read" (10 min) used on timings, iqama list, design get, hijri get, artifacts
- Rate limiter policy "public" available and can be applied where needed

Auth and roles

- JWT validation configured via JwtBearer with Authority/Audience
- Write endpoints require roles (Admin/Editor)
- For local issuance, implement token creation in AuthController or integrate ASP.NET Core Identity

Storage (uploads/artifacts)

- Local upload in sample; recommended: S3/Azure Blob with presigned PUT URLs
- Endpoint returns { uploadUrl, publicUrl }; client PUTs file to storage; then update entity with publicUrl

Frontend outline (Angular)

- Routes: /login, /org/:slug/{profile|iqama|design|publish|hijri|timings}, /tv/:slug, /w/:slug
- Auth guard checks token; interceptor adds Authorization header
- Services: timings, iqama, design, hijri, publish, orgs, auth
- Forms: reactive forms for design and IQAMA; call respective endpoints

Dev tips

- Keep DB indices: Organization(Slug) unique; IqamaEntry(OrganizationId, Date, Salah) unique; PublishArtifact(OrganizationId, Year, Month)
- Add proper prayer time algorithm and PDF generation (QuestPDF) for production