# Let's create four .puml files with the corrected UML code so the user can render them in VS Code.

uml_files = {
    "component.puml": """@startuml
skinparam componentStyle rectangle
skinparam packageStyle rectangle
title DeenTime – High‑level Component Diagram (Option A)

package "Clients" {
  component "PWA (Angular)\\nfrontend/deentime-web" as PWA
  component "Mobile (Capacitor)\\niOS / Android" as Mobile
  component "Desktop (Tauri)\\nWindows / macOS" as Desktop
}

node "Internet" as NET

package "DeenTime.Api (.NET 8 Minimal API)" as API {
  component "Middleware Pipeline\\nAuth(JWT), CORS, RateLimiter(public), OutputCache, Compression, Swagger" as MW
  component "GET /api/v1/orgs" as Orgs
  component "GET /api/v1/orgs/{id}" as OrgById
  component "GET /api/v1/timings" as Timings
  component "GET /health/*" as Health
}

package "DeenTime.Core" as CORE {
  component "IsnaCalculator" as Calc
  () "IPrayerTimeCalculator" as ICalc
  Calc -- ICalc : provides
}

package "DeenTime.Infrastructure" as INFRA {
  component "AppDbContext" as DbCtx
  database "Relational DB\\n(SQL Server / Postgres / MySQL)" as DB
  DbCtx -down- DB : EF Core
}

package "DeenTime.Contracts" as CONTRACTS {
  component "PrayerTimesDto"
}

cloud "OIDC Provider (Authority)\\nAuth:Authority + Audience=deentime-api" as IDP

' Clients reach API over the Internet
PWA --> NET
Mobile --> NET
Desktop --> NET
NET --> API : HTTPS (CORS-allowed origins)

' Pipeline and endpoints
API --> MW
API --> Orgs
API --> OrgById
API --> Timings
API --> Health

' Data & services
Orgs --> DbCtx
OrgById --> DbCtx
Timings --> DbCtx : Load Org + Criteria
Timings ..> ICalc : uses
API --> IDP : Validate JWT / get JWKS
@enduml
""",
    "class.puml": """@startuml
title DeenTime – Core Domain & Infrastructure Classes

package "DeenTime.Core.Entities" {
  class Organization {
    +Id: Guid
    +Name: string
    +AddressLine: string?
    +City: string?
    +State: string?
    +ZipCode: string?
    +Phone: string?
    +WebsiteUrl: string?
    +Email: string?
    +SocialUrl: string?
    +Criteria: PrayerTimingCriteria?
    +UpdatedAtUtc: DateTime
  }

  class PrayerTimingCriteria {
    +Id: Guid
    +OrganizationId: Guid
    +Organization: Organization
    +ZipCode: string
    +Method: string = "ISNA"
    +JuristicMethodAsr: string = "Other"
    +Latitude: decimal
    +Longitude: decimal
    +MinutesAfterZawal: int = 1
    +MinutesAfterMaghrib: int = 2
    +KhutbahTimeMinutes: int = 30
    +TimezoneId: string = "America/Chicago"
    +DstObserved: bool = true
    +DstBegins: DateOnly?
    +DstEnds: DateOnly?
    +UpdatedAtUtc: DateTime
  }
}

package "DeenTime.Contracts.Timings" {
  class PrayerTimesDto <<record>> {
    +Date: DateOnly
    +Fajr: TimeOnly
    +Dhuhr: TimeOnly
    +Asr: TimeOnly
    +Maghrib: TimeOnly
    +Isha: TimeOnly
  }
}

package "DeenTime.Core.Services" {
  interface IPrayerTimeCalculator {
    +Compute(c: PrayerTimingCriteria, date: DateOnly): PrayerTimesDto
  }
  class IsnaCalculator {
    +Compute(...): PrayerTimesDto
  }
  IPrayerTimeCalculator <|.. IsnaCalculator
}

package "DeenTime.Infrastructure" {
  class AppDbContext {
    +Organizations: DbSet<Organization>
    +PrayerTimingCriteria: DbSet<PrayerTimingCriteria>
    ..ModelCreating..
    HasOne(Organization.Criteria) WithOne(PrayerTimingCriteria.Organization)
    HasForeignKey(PrayerTimingCriteria.OrganizationId)
    Index(Organization.Name)
    Index(PrayerTimingCriteria.OrganizationId)
  }
}

Organization "1" -- "0..1" PrayerTimingCriteria : one-to-one
@enduml
""",
    "sequence.puml": """@startuml
title DeenTime – GET /api/v1/timings Flow

actor User
participant "Angular App\\n(deentime-web)" as Web
participant "OIDC Provider\\n(Authority)" as IDP
participant "DeenTime.Api\\n(Middleware Pipeline)" as API
participant "RateLimiter\\n(public)" as RL
participant "OutputCache\\n(15m TTL)" as Cache
participant "AppDbContext\\n(EF Core)" as Db
participant "IPrayerTimeCalculator\\n(IsnaCalculator)" as Calc

User -> Web : Open app
Web -> IDP : (if needed) OIDC Auth (PKCE)
IDP --> Web : id_token + access_token (JWT)

Web -> API : GET /api/v1/timings?orgId=...&date=...\\nAuthorization: Bearer <JWT>
API -> RL : Check quota (60/5s)
RL --> API : Allowed

API -> Cache : Lookup timings:{orgId}:{date}
alt cache hit
  Cache --> API : PrayerTimesDto
  API --> Web : 200 OK (cached JSON)
else cache miss
  API -> Db : Load Organization.Include(Criteria) by orgId
  alt not found
    Db --> API : null
    API --> Web : 404 NotFound
  else found
    Db --> API : Organization + Criteria
    API -> Calc : Compute(criteria, date)
    Calc --> API : PrayerTimesDto
    API -> Cache : Store (15m)
    API --> Web : 200 OK (JSON)
  end
end
@enduml
""",
    "deployment.puml": """@startuml
title DeenTime – Deployment Diagram

node "User Device" {
  artifact "PWA (Angular)\\nserved via CDN" as PWA
  artifact "Capacitor App\\niOS / Android" as Cap
  artifact "Tauri Desktop\\nWin / macOS" as Tauri
}

cloud "Public Internet" as NET

node "Static Hosting + CDN" as CDN {
  artifact "deentime-web build\\n(dist/)" as STATIC
}

node "App Host\\n(Azure App Service / Container)" as APP {
  component "DeenTime.Api\\n(.NET 8)" as API
  queue "OutputCache\\n(in-memory)" as CACHE
  artifact "RateLimiter\\n(Fixed window)" as RL
}

database "Relational DB\\n(SQL Server / Postgres / MySQL)" as DB
cloud "OIDC Provider" as IDP

PWA -- NET
Cap -- NET
Tauri -- NET

PWA --> CDN : HTTPS (static assets)
PWA --> API : HTTPS (CORS)
Cap --> API : HTTPS (CORS)
Tauri --> API : HTTPS (CORS)

API --> DB : EF Core (TCP)
API --> IDP : OIDC discovery / JWKS
API ..> CACHE
API ..> RL
@enduml
"""
}

import os
from pathlib import Path

# Write generated PlantUML files into a local 'uml' folder next to this script
script_dir = Path(__file__).parent.resolve()
output_dir = script_dir / "uml"
output_dir.mkdir(parents=True, exist_ok=True)

for filename, content in uml_files.items():
  (output_dir / filename).write_text(content, encoding="utf-8")

print(f"Wrote {len(uml_files)} UML files to: {output_dir}")
for p in sorted(output_dir.glob("*.puml")):
  print(f" - {p.name}")
