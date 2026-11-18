# MasjidHub on Cloudflare

Public address: https://masjidhub.jemaiinnovations.com

## Architecture

Everything runs on Cloudflare's free plan; no PC or server has to stay on.

```
browser ──HTTPS──> Cloudflare Pages project "masjidhub"  (masjidhub.jemaiinnovations.com)
                     ├─ static Angular site: /login, /org/…, /tv/:slug, /w/:slug, /w2/:slug
                     └─ _worker.js = the API (backend-worker, Hono):
                          /api/* /public/* /uploads/* /health/* /jobs
                          /clock /iqama-widget.php /iqama-widget2.php
                            ├─ D1 database "masjidhub"        (binding DB)
                            └─ KV namespace "masjidhub-uploads" (binding UPLOADS, uploaded images)
```

- The API is `backend-worker/`, a port of `backend-node/` to Workers + D1 with the same
  routes and responses. Its README lists the conventions and the known differences.
- Bindings and plain settings are in `frontend/deentime-web/wrangler.toml`. The only
  secret is `Auth__SigningKey` (`npx wrangler pages secret put Auth__SigningKey --project-name=masjidhub`).
- Email and Turnstile are switched off. Email, when enabled, goes through Resend's HTTP
  API (`EmailDelivery__ApiKey` as a Pages secret); Workers cannot use SMTP. While it is
  off, invitations and password-reset emails answer 503, as in backend-node.

### Day-to-day commands

Run from `backend-worker/` on any PC with `npx wrangler login` done:

| Task | Command |
|------|---------|
| Set or reset an account's password | `node scripts/set-password.mjs` (asks for the email and password on the terminal) |
| Load Qur'an / hadith content into D1 | `node scripts/sync-content.mjs --help` (the Worker cannot run the bulk sync itself) |
| Copy data from the old PostgreSQL database | `node scripts/migrate-from-postgres.mjs --apply --remote --cwd ../frontend/deentime-web` (empties the D1 tables first) |
| Apply schema migrations | `npx wrangler d1 migrations apply masjidhub --remote` from `frontend/deentime-web/` |

Passwords: Workers cannot verify the 600,000-iteration hashes backend-node created, so
every account copied from PostgreSQL needs its password set once with `set-password.mjs`
(or through "forgot password" once email is enabled). New hashes use 100,000 iterations.

### Deploying

```bash
cd DeenTime/backend-worker && npm ci && npm test && npm run build
cd ../frontend/deentime-web && npm ci
npm run build -- --configuration production
npm run pages:prepare
npx wrangler pages deploy --project-name=masjidhub --branch=main
```

Use `--branch=<anything else>` for a preview at `https://<branch>.masjidhub-740.pages.dev`
(it uses the same D1 database). The GitHub workflow *Deploy MasjidHub web to Cloudflare
Pages* does the same on manual dispatch once `CLOUDFLARE_API_TOKEN` (Pages Edit + D1 Edit)
and `CLOUDFLARE_ACCOUNT_ID` are stored as repository secrets. Roll back in the dashboard:
Workers & Pages > masjidhub > Deployments > Rollback (the database is not rolled back).

### Limits of the free plan

- 100,000 requests a day and about 10 ms of CPU per request. Sign-in (password hashing)
  and PDF generation use more CPU than that; Cloudflare tolerated it in testing, but if
  they start failing with error 1102 the fix is the Workers Paid plan.
- D1: 100,000 row writes a day (a full hadith import must be split over days with `--books`).
- No background jobs: content sync runs from a PC with `scripts/sync-content.mjs`.

---

# Fallback: API on an origin machine behind a Cloudflare Tunnel

This was the first setup and still works: `npm run pages:prepare -- --api=tunnel` uploads
the proxy worker (`frontend/deentime-web/cloudflare/_worker.js`) instead of the API, and
the NestJS API + PostgreSQL run on a machine you control. The scheduled tasks
**MasjidHub API** and **MasjidHub Tunnel** on the original PC are stopped but still
registered (`C:MasjidHubmasjidhub-origin.ps1 uninstall` removes them). The rest of
this document describes that setup.

## One-time setup

### 1. Origin machine (Windows)

Needs Node.js 22+ (`winget install OpenJS.NodeJS.LTS`), PostgreSQL 16 with the `deentime`
database, and cloudflared (`winget install Cloudflare.cloudflared`). No elevated
PowerShell is required. From the repository checkout:

```powershell
cd DeenTime
powershell -ExecutionPolicy Bypass -File .\deploy\cloudflare\masjidhub-origin.ps1 deploy
```

`deploy` builds `backend-node`, installs it to `C:\MasjidHub\app` and, the first time,
creates `C:\MasjidHub\masjidhub.env` from [`masjidhub.env.example`](../deploy/cloudflare/masjidhub.env.example)
with a freshly generated JWT signing key and proxy key (neither is printed). That file is
the only place production secrets live; it is readable by your Windows account only.
Open it to add what you want switched on: a dedicated database role, SMTP, Turnstile.
The settings that matter behind Cloudflare are already filled in:

| Setting | Value | Why |
|---------|-------|-----|
| `Frontend__PublicBaseUrl` | `https://masjidhub.jemaiinnovations.com` | Emails, embed codes, iframe URLs and API redirects use the public address, never the tunnel hostname. |
| `Cors__AllowedOrigins__0` | same | The site calls its own origin, so CORS is not exercised in normal use; this keeps the allow-list correct. |
| `Proxy__ClientIpHeader` + `Proxy__SharedKey` | `X-MasjidHub-Client-IP` + generated | Behind the tunnel every request arrives from `127.0.0.1`. Without this, all visitors would share one rate-limit window (10 sign-ins a minute for everyone) and Turnstile would be told the wrong address. The header is believed only from loopback and only with the key. |
| `Captcha__ExpectedHostnames__0` | `masjidhub.jemaiinnovations.com` when Turnstile is enabled | Turnstile reports the hostname the widget ran on, which is the public site. Add that hostname to the widget in the Cloudflare dashboard too. |

The API is started with `ASPNETCORE_ENVIRONMENT=Production` and bound to
`127.0.0.1:5080`, so it is not reachable from the network except through the tunnel.
(Port 8080 stays free for local development.)

### 2. Tunnel

```powershell
cloudflared tunnel login          # opens a browser: sign in and pick jemaiinnovations.com (the link expires after about 8 minutes)
powershell -ExecutionPolicy Bypass -File C:\MasjidHub\masjidhub-origin.ps1 tunnel-setup
powershell -ExecutionPolicy Bypass -File C:\MasjidHub\masjidhub-origin.ps1 install
```

`tunnel-setup` creates the tunnel `masjidhub`, adds the DNS record
`masjidhub-origin.jemaiinnovations.com` for it and writes
`C:\MasjidHub\cloudflared\config.yml` ([template](../deploy/cloudflare/cloudflared-config.example.yml)).
The hostname is deliberately one level below the zone: the free Universal SSL
certificate does not cover `origin.masjidhub.jemaiinnovations.com`.

`install` registers two scheduled tasks, **MasjidHub API** and **MasjidHub Tunnel**, and
starts them. Run from a normal PowerShell they start when you sign in to Windows; run
`install` once from an elevated PowerShell to have them start at boot with nobody signed
in. Set Windows power options so the PC does not sleep.

### 3. Pages project

The site is a Direct Upload Pages project named `masjidhub`, production branch `main`,
deployed with Wrangler. Its own address is `https://masjidhub-740.pages.dev`. The project
already exists; to create it again from scratch run
`npx wrangler pages project create masjidhub --production-branch=main --force` (without
`--force`, Wrangler 4.164 and later try to create a Workers project instead and fail).
The workflow does the same if the project is missing.

1. Create a Cloudflare API token with **Account > Cloudflare Pages > Edit** only (the
   same kind of token Mushaf+ uses; no DNS access) and store it with the account ID:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN --repo salimjemai/DeenTime
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo salimjemai/DeenTime
   ```

2. Give the Pages project the proxy key the origin generated, and keep GitHub in step
   (reads it from `C:\MasjidHub\masjidhub.env`, prints nothing):

   ```powershell
   powershell -ExecutionPolicy Bypass -File C:\MasjidHub\masjidhub-origin.ps1 push-proxy-key -GitHubRepo salimjemai/DeenTime
   ```

   This needs `npx wrangler login` (or `CLOUDFLARE_API_TOKEN` in the environment) and the
   Pages project to exist, so do it after the first deployment and then deploy once more.

3. Deploy (next section), then in the Cloudflare dashboard open **Workers & Pages >
   masjidhub > Custom domains > Set up a domain** and enter
   `masjidhub.jemaiinnovations.com`. Cloudflare adds the DNS record itself. Leave
   `mushafplus.jemaiinnovations.com` and the mail records alone.

## Deploying

**Website** (Angular site and proxy worker): GitHub > Actions > *Deploy MasjidHub web to
Cloudflare Pages* > Run workflow, or `gh workflow run deploy-cloudflare.yml`. It is manual
on purpose; nothing deploys on push. The workflow tests the worker, builds the production
bundle, checks it, publishes it and verifies the new deployment and the public address.
GitHub only offers the Run button once the workflow file is on the default branch.

The same thing from a checkout, for a first deployment or when Actions is unavailable:

```bash
cd DeenTime/frontend/deentime-web
npm ci
npm run pages:test
npm run build -- --configuration production
npm run pages:prepare
npx wrangler pages deploy --project-name=masjidhub --branch=main
```

**API** (on the origin PC, after pulling the code you want to run):

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\cloudflare\masjidhub-origin.ps1 deploy
```

It stages the new build, stops the API, swaps it in, starts it and waits for
`/health/ready`. If the new build does not become ready it switches back by itself.
Database migrations run when the API starts.

Check either side at any time:

```powershell
powershell -ExecutionPolicy Bypass -File C:\MasjidHub\masjidhub-origin.ps1 status
```

## Rolling back

- **Website:** Cloudflare dashboard > Workers & Pages > masjidhub > Deployments > pick an
  earlier production deployment > **Rollback to this deployment**. It takes effect
  immediately and does not touch the API.
- **API:** `masjidhub-origin.ps1 rollback` swaps `C:\MasjidHub\app.previous` back in (one
  previous build is kept; uploaded files move with the live build). A rollback does not
  undo database migrations, so take a `pg_dump` before deploying a build that adds one.
- **Everything off:** `masjidhub-origin.ps1 stop` stops the API and the tunnel; the site
  then shows the branded offline message. `uninstall` removes the scheduled tasks.

## Known limits

- **The API is down whenever the origin machine is off, asleep, restarting or offline.**
  The static site still loads from Cloudflare, but sign-in, the dashboard, and the data
  behind every TV display and widget return the 503 offline message until the machine is
  back. Moving the origin to an always-on VPS removes this limit without changing
  anything on the Cloudflare side except where the tunnel runs.
- Tasks registered without elevation only run while you are signed in to Windows.
- One origin, one process: rate limits and the content sync are in-process, and uploads
  are on that machine's disk. Back up `C:\MasjidHub\app\wwwroot\uploads` and the database.
- The tunnel hostname is public. The API ignores forwarded visitor addresses that arrive
  without the proxy key, so calling it directly gains nothing, but it is not blocked.
- Requests pass through Cloudflare's limits (100 MB request bodies, 100 s per request).

## How embedding and the service worker fit in

- `/tv/*`, `/w/*` and `/w2/*` are served with `Content-Security-Policy: frame-ancestors *`
  and without `X-Frame-Options`, so masjid websites can embed them. Every other page is
  sent with `X-Frame-Options: DENY` (`cloudflare/_headers`).
- The Angular service worker caches the app shell and assets only. It has no data
  groups, so API responses are never cached by it, and `ngsw-config.json` tells it not to
  answer `/api`, `/public`, `/uploads`, `/health`, `/jobs`, `/clock`, `/tv`, `/w` or `/w2`
  navigations from the cached shell: API links reach the proxy, and the public displays
  always get their embeddable headers from Pages.
- `iqamatime-embed.js`, the `X-IqamaTime-Client-Key` / `X-DeenTime-Client-Key` headers and
  the legacy `/clock` and `iqama-widget*.php` URLs keep their names so existing
  integrations keep working under the MasjidHub brand.

## Using a VPS as the origin

The staging VPS path in [`deploy/README.md`](../deploy/README.md) and
`.github/workflows/staging-ci-cd.yml` is unchanged. To put a Linux server behind the
same Pages site instead of the Windows PC: run the API there with the systemd unit, set
the same `Frontend__PublicBaseUrl`, `Cors__AllowedOrigins__0`, `Proxy__ClientIpHeader`
and `Proxy__SharedKey` values in `/etc/deentime/deentime.env`, install cloudflared as a
service with the tunnel's credentials and an ingress to `http://127.0.0.1:5080`, and
stop the tunnel on the PC. nginx is not needed in that setup.
