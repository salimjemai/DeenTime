# Self-hosting IqamaTime on a Windows PC

One Windows service runs both the API and the Angular site on
`http://localhost:8080`. PostgreSQL runs alongside it. A tunnel (ngrok now,
Cloudflare Tunnel once you own a domain) publishes it to the internet without
opening router ports or exposing your home IP.

```
Internet ──HTTPS──> tunnel provider ──> ngrok/cloudflared on the PC ──> http://localhost:8080 (DeenTime service)
                                                                                └── PostgreSQL 127.0.0.1:5432
```

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
winget install PostgreSQL.PostgreSQL.16     # note the "postgres" password you choose
winget install ngrok.ngrok                   # or: winget install Cloudflare.cloudflared
```

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
It creates the `deentime` role and database, installs the **DeenTime** Windows
service (starts automatically, restarts on failure, depends on PostgreSQL),
and health-checks it. Re-run the same command with a new zip to update; the
settings file and uploads are preserved.

Verify: http://localhost:8080 shows the site, http://localhost:8080/api/version
shows the build.

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
    addr: 8080
    domain: something.ngrok-free.app
```

then `ngrok service start`. Re-run `install-deentime.ps1 -PublicUrl
https://something.ngrok-free.app` if you did not pass the URL the first time
(it only updates the settings when the file does not exist — otherwise edit
`Frontend.PublicBaseUrl`, `Cors.AllowedOrigins` and `SuperUser.WebsiteUrl` in
`appsettings.Production.json` and `Restart-Service DeenTime`).

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
    service: http://localhost:8080
  - service: http_status:404
```

You get real HTTPS, no interstitial, no bandwidth cap, and your home IP stays
hidden. Update the public URL in `appsettings.Production.json` and restart the
service.

## Registering masjids

Email delivery is off by default (`EmailDelivery.Enabled=false`), so
registration links are written to the log instead of emailed. After someone
registers, open the newest file in `C:\DeenTime\logs`, find the line
containing `verification URL for`, and open that link. To send real emails,
fill in the `EmailDelivery` section (any SMTP account) and set `Enabled` to
true.

## Operations

```powershell
Get-Service DeenTime                # status
Restart-Service DeenTime
Get-Content C:\DeenTime\logs\api-*.log -Tail 50
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" -U deentime -h 127.0.0.1 deentime > backup.sql   # backup
```

Things to know about home hosting: the site is down whenever the PC is off,
asleep, or the internet drops; keep Windows Update from auto-restarting during
prayer-time hours; and take a database backup before each update.
