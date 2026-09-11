# Self-hosting IqamaTime on a Windows PC

One Windows service ("DeenTime", hosted by NSSM) runs the Node.js API, which
also serves the Angular site, on port 8080. PostgreSQL runs alongside it. A
tunnel (ngrok now, Cloudflare Tunnel once you own a domain) publishes it to the
internet without opening router ports or exposing your home IP.

```
Internet ──HTTPS──> tunnel provider ──> ngrok/cloudflared on the PC ──> http://localhost:8080 (service "DeenTime": node.exe)
                                                                                └── PostgreSQL 127.0.0.1:5432
```

(`install-deentime-iis.ps1` is the installer for the retired .NET build and
needs `app\DeenTime.Api.exe`; it does not apply to the Node.js release.)

## 1. Build the release

**On the Windows PC itself** (needs Node.js 22 LTS:
`winget install OpenJS.NodeJS.LTS`):

```powershell
cd D:\Git\DeenTime\DeenTime
.\deploy\windows\build-windows-release.ps1
```

Produces `dist\deentime-windows\` with the built API (`app\dist`, production
`app\node_modules`, `app\prisma`), the production Angular bundle in
`app\wwwroot`, the installers and the settings template. Nothing to copy;
install straight from that folder.

**Or on a Mac/Linux machine:** `./deploy/windows/build-windows-release.sh`
produces `dist/deentime-windows-<sha>.zip`; copy and unzip it on the PC.

## 2. Prepare the PC (once)

In an elevated PowerShell:

```powershell
winget install PostgreSQL.PostgreSQL.16      # note the "postgres" password you choose
winget install OpenJS.NodeJS.LTS             # Node.js runtime for the API
winget install NSSM.NSSM                     # runs node.exe as a Windows service
winget install ngrok.ngrok                    # or: winget install Cloudflare.cloudflared
```

Open a new PowerShell afterwards so `node` and `nssm` are on PATH.

Power settings: **Settings → System → Power** → set *Sleep* to **Never** on
plugged-in power, so the service stays reachable.

## 3. Install / update the service

Unzip the release, open an elevated PowerShell in the unzipped folder:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-deentime.ps1 -PublicUrl https://YOUR-TUNNEL-HOSTNAME
```

On the first run it asks for the PostgreSQL `postgres` password, the site
admin (super user) email and password, and writes
`C:\DeenTime\app\appsettings.Production.json` — the only file holding secrets.
It creates the `deentime` role and database, copies the build to
`C:\DeenTime\app`, registers the **DeenTime** Windows service (NSSM running
`node.exe dist\main.js`, automatic start, restarts on failure, depends on
PostgreSQL, logs in `C:\DeenTime\logs\deentime-api.log`) and health-checks it.
Re-run the same command with a new zip to update; the settings file and
uploads are preserved.

Verify: http://localhost:8080 shows the site, http://localhost:8080/api/version
shows the build. `nssm status DeenTime` reports the service state.

## 4. Publish to the internet

### Option A — ngrok (works today, no domain needed)

Sign in at https://dashboard.ngrok.com, copy your authtoken, and claim the
free static domain offered under *Domains* (looks like
`something.ngrok-free.app`). Then, in an elevated PowerShell:

```powershell
ngrok config add-authtoken <token>
ngrok service install --config "$env:LOCALAPPDATA\ngrok\ngrok.yml"
```

Put this in that `ngrok.yml`:

```yaml
version: 3
agent:
  authtoken: <token>
tunnels:
  deentime:
    proto: http
    addr: 80
    domain: something.ngrok-free.app
```

then `ngrok service start`. Re-run `install-deentime-iis.ps1 -PublicUrl
https://something.ngrok-free.app` if you did not pass the URL the first time
(it only updates the settings when the file does not exist — otherwise edit
`Frontend.PublicBaseUrl`, `Cors.AllowedOrigins` and `SuperUser.WebsiteUrl` in
`appsettings.Production.json` and `Restart-WebAppPool DeenTime`).

Limits of the free ngrok tier: an interstitial "you are about to visit" page
on first visit for browsers, and bandwidth caps. Fine for testing and for the
TV/widget links; not ideal for a public masjid site.

### Option B — Cloudflare Tunnel (recommended once you own a domain)

Buy any domain (about $10/year) and add it to a free Cloudflare account. Then:

```powershell
cloudflared tunnel login
cloudflared tunnel create deentime
cloudflared tunnel route dns deentime iqama.YOURDOMAIN.com
cloudflared service install
```

with `%USERPROFILE%\.cloudflared\config.yml`:

```yaml
tunnel: deentime
credentials-file: C:\Users\YOU\.cloudflared\<tunnel-id>.json
ingress:
  - hostname: iqama.YOURDOMAIN.com
    service: http://localhost:80
  - service: http_status:404
```

You get real HTTPS, no interstitial, no bandwidth cap, and your home IP stays
hidden. Update the public URL in `appsettings.Production.json` and restart the
app pool.

## What runs where

| Piece | On the PC | Notes |
|-------|-----------|-------|
| Database | PostgreSQL 16 Windows service (`postgresql-x64-16`), `127.0.0.1:5432`, database `deentime`, role `deentime` | Created by the installer. Schema migrations run automatically when the app starts. |
| API + site | Windows service **DeenTime** (NSSM → `node.exe C:\DeenTime\app\dist\main.js`) on `127.0.0.1:8080` | Serves `/api/*`, `/health/*`, `/public/*`, `/uploads/*` and the Angular files from `C:\DeenTime\app\wwwroot`. |
| Background worker | Same process — the Islamic-content sync worker runs inside the API | No separate service to install; it runs whenever the service runs, including after a reboot. |
| Job status | `/jobs` (super user only) lists queued syncs and their state | Replaces the former Hangfire dashboard. |

Startup order after a reboot: PostgreSQL service → DeenTime service →
migrations → worker. If the app starts before PostgreSQL is ready it exits and
NSSM restarts it after 5 seconds; `Restart-Service DeenTime` forces a fresh
start.

## The administrator account

The `SuperUser` section of `appsettings.Production.json` defines the IqamaTime
administrator. Its `Email` and `Password` are authoritative: on every start the
API creates the account if it is missing, renames the seeded account when the
email changes, and replaces the stored password when the password changes. To
change either, edit the file and `Restart-WebAppPool DeenTime`.

`Support.Email` (optionally `Support.Phone` / `Support.Url`) is shown on the
sign-in page so a masjid without an invitation knows whom to contact. The
installer sets it to the administrator email.

## Registering masjids

Masjids join by invitation only. Sign in as the administrator, open
**Masjids** (`/admin`), and send an invitation with the masjid administrator's
email and the masjid name. The invited email opens the link, chooses a
password, completes the masjid details, verifies the email address, and then
signs in; prayer-time criteria and the display design are created at
verification, so the masjid is ready to use on first sign-in.

Email delivery is off by default (`EmailDelivery.Enabled=false`), so the
invitation link is shown on the Masjids page right after it is created ("Send
this link to …") for you to forward yourself, and links are also written to the
log. For the verification link, open the newest file in `C:\DeenTime\logs`,
find the line containing `verification URL for`, and pass that link on (or open
it). To send real emails, fill in the `EmailDelivery` section (any SMTP
account) and set `Enabled` to true.

## Operations

```powershell
Get-Website DeenTime; Get-WebAppPoolState DeenTime     # status
Restart-WebAppPool DeenTime                              # restart the app
Get-Content C:\DeenTime\logs\deentime-api.log -Tail 50   # API log (stdout/stderr captured by NSSM)
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U deentime -h 127.0.0.1 deentime > backup.sql   # backup
```

Things to know about home hosting: the site is down whenever the PC is off,
asleep, or the internet drops; keep Windows Update from auto-restarting during
prayer-time hours; and take a database backup before each update.
