# Staging deployment (self-hosted srv1)

Staging runs on our own plain **Ubuntu 24.04** VPS (`srv1`, **70.36.101.120**)
with **nginx + systemd + PostgreSQL + Node.js 22**. No CyberPanel, no
OpenLiteSpeed and no Docker. The API is the Node.js implementation in
`backend-node` (the original .NET API in `backend` is kept for parity checks
only and is not deployed).

GitHub Actions (`.github/workflows/staging-ci-cd.yml`) tests the Angular and
Node.js applications, packages the built API (`dist/`, production
`node_modules/`, `prisma/`, `appsettings.json`) and a static Angular bundle,
copies both tarballs to the server over key-authenticated SSH, and runs
`deploy-staging.sh` there.

## Server layout

```
/opt/deentime/releases/<sha>/api/   self-contained API build
/opt/deentime/releases/<sha>/web/   Angular bundle for that release
/opt/deentime/current -> releases/<sha>
/opt/deentime/shared/uploads/       persistent uploads, symlinked into each release at wwwroot/uploads
/opt/deentime/incoming/             tarballs dropped by the workflow
/opt/deentime/deploy-staging.sh     release script (refreshed on every deploy)
/opt/deentime/deentime-api.service  unit file (refreshed on every deploy)
/var/www/deentime/                  Angular static bundle served by nginx
/etc/deentime/deentime.env          secrets (chmod 600, root) — see .env.staging.example
/etc/systemd/system/deentime-api.service
/etc/nginx/sites-available/deentime see staging-nginx.conf
```

Services (all enabled at boot):

- `deentime-api` — the API, runs as user `deentime`, listens on `127.0.0.1:5080`.
- `nginx` — serves `/var/www/deentime`, proxies `/api /health /public /uploads`
  to the API, SPA fallback to `index.html`.
- `postgresql` — database `iqama`, role `iqama_user`, on `127.0.0.1:5432`.

## One-time server preparation

Already done on srv1; listed here so the box can be rebuilt.

```bash
apt-get update
apt-get install -y nginx postgresql rsync curl certbot python3-certbot-nginx
# Node.js 22 LTS (NodeSource) for the API
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs
useradd --system --home /opt/deentime --shell /usr/sbin/nologin deentime
mkdir -p /opt/deentime/incoming /opt/deentime/shared/uploads /var/www/deentime /etc/deentime
chown -R deentime:deentime /opt/deentime/shared
install -m 600 /dev/null /etc/deentime/deentime.env   # then fill from .env.staging.example
install -m 644 staging-nginx.conf /etc/nginx/sites-available/deentime
ln -sf /etc/nginx/sites-available/deentime /etc/nginx/sites-enabled/deentime
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
```

Create the database and role in PostgreSQL to match `ConnectionStrings__Default`.

## GitHub secrets

The workflow signs in as `root` with an SSH key and pins the server's ED25519
host key. Generate a dedicated key, authorize it on the server, and store the
private half in the repository secret `STAGING_SSH_PRIVATE_KEY`:

```bash
ssh-keygen -t ed25519 -N "" -C github-actions-deentime -f ./gha_deploy_key
ssh root@70.36.101.120 "cat >> /root/.ssh/authorized_keys" < ./gha_deploy_key.pub
gh secret set STAGING_SSH_PRIVATE_KEY --repo salimjemai/DeenTime < ./gha_deploy_key
rm ./gha_deploy_key ./gha_deploy_key.pub
```

If the server is ever rebuilt, update `DEPLOY_HOST_KEY` in the workflow with
the output of `ssh-keyscan -t ed25519 70.36.101.120`.

## Each deployment

On every push to `main` (or a manual run) the workflow copies
`deploy-staging.sh`, `deentime-api.service`, `deentime-api-<sha>.tar.gz` and
`deentime-web-<sha>.tar.gz` to the server and runs `deploy-staging.sh <sha>`,
which:

1. unpacks the release into `/opt/deentime/releases/<sha>`,
2. links the shared uploads directory into it and writes `release.env`
   (commit SHA and build time, surfaced by `/api/version`),
3. installs the unit file, flips the `current` symlink, restarts `deentime-api`,
4. health-checks `http://127.0.0.1:5080/health/ready` (rolling back the
   symlink and restarting on failure),
5. rsyncs the Angular build into `/var/www/deentime`, and
6. keeps the five most recent releases for rollback.

Afterwards the workflow verifies `/`, `/health/ready` and `/api/version` at
`STAGING_URL`.

## HTTPS

The app is currently served over plain HTTP at http://70.36.101.120. A trusted
certificate needs a hostname: Let's Encrypt does not issue certificates for a
bare IP through certbot. To enable HTTPS:

1. Point a DNS `A` record for a domain you control at `70.36.101.120`.
2. On the server, set `server_name <domain>;` in
   `/etc/nginx/sites-available/deentime`, then run:

   ```bash
   certbot --nginx -d <domain> --redirect --hsts --agree-tos -m <email> -n
   ```

   certbot adds the `listen 443 ssl` block, an HTTP-to-HTTPS redirect, and a
   renewal timer.
3. In `/etc/deentime/deentime.env`, set `Frontend__PublicBaseUrl`,
   `Cors__AllowedOrigins__0`, `SuperUser__WebsiteUrl` and
   `Captcha__ExpectedHostnames__0` to the new origin, then
   `systemctl restart deentime-api`.
4. Change `STAGING_URL` in the workflow to `https://<domain>`.

## The administrator account

`SuperUser__Email` / `SuperUser__Password` in `deentime.env` define the
IqamaTime administrator (super user). They are authoritative: on every start
the API creates the account if it is missing, renames the seeded account when
the email changes, grants the SuperUser role if the email belongs to an existing
user, and replaces the stored password hash when the password changes. To
rotate the password, edit `deentime.env` and `systemctl restart deentime-api`.

`Support__Email` (and optionally `Support__Phone` / `Support__Url`) is shown on
the sign-in page so a masjid without an invitation knows whom to contact.

## Registering masjids on staging

Masjids are registered by invitation only. The administrator signs in, opens
**Masjids** (`/admin`), and sends an invitation with the masjid administrator's
email and the masjid name. The invited email opens the link, chooses a
password, completes the masjid details, verifies the email address, and then
signs in; the prayer-time criteria and display design are created at
verification, so the masjid is ready to use on first sign-in.

The server has no mail server, so `EmailDelivery__Enabled=false` and
`EmailDelivery__LogLinksWhenDisabled=true` make the API write the links to the
journal instead of failing. Invitation links are also returned to the
administrator in the Masjids page ("Send this link to …") so they can be passed
on by hand. Verification links can be fetched with:

```bash
journalctl -u deentime-api --no-pager | grep "URL for" | tail -1
```

## Rollback by hand

```bash
ls /opt/deentime/releases            # pick a previous <sha>
ln -sfn /opt/deentime/releases/<sha> /opt/deentime/current
systemctl restart deentime-api
rsync -a --delete /opt/deentime/releases/<sha>/web/ /var/www/deentime/
```

## Hardening still to do

- `ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable` — the firewall is
  off and the API log already shows bots probing for PHP exploits.
- Disable SSH password authentication once the deploy key is in place.
- Change the seeded superuser password.
