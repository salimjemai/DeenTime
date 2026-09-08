# Self-hosting IqamaTime on a Windows PC (IIS)

IIS hosts the whole app: the ASP.NET Core API and the Angular site come from
one IIS website ("DeenTime") on port 80, managed in IIS Manager. PostgreSQL
runs alongside it. A tunnel (ngrok now, Cloudflare Tunnel once you own a
domain) publishes it to the internet without opening router ports or exposing
your home IP.

```
Internet ──HTTPS──> tunnel provider ──> ngrok/cloudflared on the PC ──> http://localhost:80 (IIS site "DeenTime")
                                                                                └── PostgreSQL 127.0.0.1:5432
```

(An alternative installer, `install-deentime.ps1`, runs the same build as a
plain Windows service on port 8080 without IIS. Use one or the other.)

## 1. Build the release (on the Mac)

```bash
cd DeenTime
./deploy/windows/build-windows-release.sh
```

Produces `dist/deentime-windows-<sha>.zip` containing the self-contained
win-x64 API with the production Angular bundle in `app\wwwroot`, plus the
install script and settings template. Copy the zip to the PC.

## 2. Prepare the PC (once)

In an elevated PowerShell:

```powershell
winget install PostgreSQL.PostgreSQL.16      # note the "postgres" password you choose
winget install Microsoft.DotNet.HostingBundle.9   # ASP.NET Core Module for IIS
winget install ngrok.ngrok                    # or: winget install Cloudflare.cloudflared
```

The installer script turns on the IIS features itself. If IIS was already
installed before the Hosting Bundle, run `iisreset` once afterwards.

Power settings: **Settings → System → Power** → set *Sleep* to **Never** on
plugged-in power, so the service stays reachable.

## 3. Install / update the IIS site

Unzip the release, open an elevated PowerShell in the unzipped folder:

```powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install-deentime-iis.ps1 -PublicUrl https://YOUR-TUNNEL-HOSTNAME
```

On the first run it asks for the PostgreSQL `postgres` password, the site
admin (super user) email and password, and writes
`C:\DeenTime\app\appsettings.Production.json` — the only file holding secrets.
It creates the `deentime` role and database, creates the **DeenTime** app pool
(No Managed Code, Always Running) and the **DeenTime** website on port 80
pointing at `C:\DeenTime\app`, stops the IIS "Default Web Site" so it cannot
shadow ours, grants the app pool identity access to uploads and logs, and
health-checks it. Re-run the same command with a new zip to update; the
settings file and uploads are preserved.

Verify: http://localhost shows the site, http://localhost/api/version shows
the build. In IIS Manager (`inetmgr`) you will see the site and app pool.

Pass `-HttpPort 8080` if something else already owns port 80 on the PC.

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
| API + site | IIS website **DeenTime**, app pool **DeenTime**, in-process (`DeenTime.Api.exe` inside `w3wp.exe`) | Serves `/api/*`, `/health/*`, `/public/*`, `/uploads/*` and the Angular files from `C:\DeenTime\app\wwwroot`. |
| Background worker | Same IIS process — the Islamic-content sync worker is a hosted service inside the API | No separate service to install. The app pool is *Always Running* with no idle timeout and the site is *preloaded*, so the worker runs continuously, including after a reboot. |
| Job dashboard | `/jobs` (Hangfire), only if `Hangfire:ConnectionString` is set in settings | Optional; nothing schedules jobs through it today, so leave it unset. |

Startup order after a reboot: PostgreSQL service → IIS (World Wide Web
Publishing Service) → the DeenTime app pool preloads → migrations → worker.
If the app ever starts before PostgreSQL is ready it retries the readiness
check; `Restart-WebAppPool DeenTime` forces a fresh start.

## Registering masjids

Email delivery is off by default (`EmailDelivery.Enabled=false`), so
registration links are written to the log instead of emailed. After someone
registers, open the newest file in `C:\DeenTime\logs`, find the line
containing `verification URL for`, and open that link. To send real emails,
fill in the `EmailDelivery` section (any SMTP account) and set `Enabled` to
true.

## Operations

```powershell
Get-Website DeenTime; Get-WebAppPoolState DeenTime     # status
Restart-WebAppPool DeenTime                              # restart the app
Get-Content C:\DeenTime\logs\api-*.log -Tail 50          # app log (stdout*.log = IIS module log)
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U deentime -h 127.0.0.1 deentime > backup.sql   # backup
```

Things to know about home hosting: the site is down whenever the PC is off,
asleep, or the internet drops; keep Windows Update from auto-restarting during
prayer-time hours; and take a database backup before each update.
