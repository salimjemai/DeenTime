# DeenTime — plain-Ubuntu deployment (srv1 / 70.36.101.120)

The app runs on a plain **Ubuntu 24.04** VPS with **nginx + systemd + PostgreSQL** —
no CyberPanel, no OpenLiteSpeed, no user-linger problems. This replaces the
CyberPanel/OpenLiteSpeed approach in `deploy/README.md` for this box.

## Server
- Host: `srv1.cyberpersons.com` — **70.36.101.120** (CyberPanel Cloud "CyberVirt" server)
- OS: Ubuntu 24.04 LTS, root SSH via key `~/.ssh/deentime_newbox_ed25519`
- Access: `ssh -i ~/.ssh/deentime_newbox_ed25519 root@70.36.101.120`

## Layout
```
/opt/deentime/releases/<sha>/api/   # self-contained linux-x64 .NET API build
/opt/deentime/current -> releases/<sha>
/opt/deentime/shared/uploads/       # persistent uploads (symlinked into each release's wwwroot/uploads)
/var/www/deentime/                  # Angular static bundle (dist/deentime-web/browser)
/etc/deentime/deentime.env          # secrets (chmod 600, owned by deentime) — DB pw, signing key, superuser
/etc/systemd/system/deentime-api.service
/etc/nginx/sites-available/deentime
```

## Services (all enabled = start on boot)
- `deentime-api` — the API, runs as user `deentime`, listens on `127.0.0.1:5080`, `Restart=always`
- `nginx` — serves `/var/www/deentime`, proxies `/api /health /public /uploads` → `127.0.0.1:5080`, SPA fallback
- `postgresql` — DB `iqama`, role `iqama_user` (127.0.0.1:5432)

## Build (on a machine with .NET 10 SDK + Node)
```
# API (self-contained, no runtime needed on server)
cd backend/DeenTime.Api
dotnet publish -c Release -r linux-x64 --self-contained true -o <out>/api
# Frontend (static)
cd frontend/deentime-web && npm ci && npm run build   # -> dist/deentime-web/browser
```

## Redeploy
```
SHA=$(git rev-parse --short HEAD)
ssh -i ~/.ssh/deentime_newbox_ed25519 root@70.36.101.120 "mkdir -p /opt/deentime/releases/$SHA/api"
rsync -az -e "ssh -i ~/.ssh/deentime_newbox_ed25519" <out>/api/  root@70.36.101.120:/opt/deentime/releases/$SHA/api/
rsync -az --delete -e "ssh -i ~/.ssh/deentime_newbox_ed25519" frontend/deentime-web/dist/deentime-web/browser/ root@70.36.101.120:/var/www/deentime/
ssh -i ~/.ssh/deentime_newbox_ed25519 root@70.36.101.120 "
  ln -sfn /opt/deentime/releases/$SHA /opt/deentime/current
  mkdir -p /opt/deentime/releases/$SHA/api/wwwroot
  rm -rf /opt/deentime/releases/$SHA/api/wwwroot/uploads
  ln -s /opt/deentime/shared/uploads /opt/deentime/releases/$SHA/api/wwwroot/uploads
  chmod +x /opt/deentime/releases/$SHA/api/DeenTime.Api
  chown -R deentime:deentime /opt/deentime
  systemctl restart deentime-api"
```

## Still TODO (see chat)
1. Point a domain at 70.36.101.120 and issue HTTPS (certbot / nginx). App is HTTP-only right now.
2. Re-enable in `/etc/deentime/deentime.env` once on the real domain: `Captcha__Enabled`,
   `EmailDelivery__Enabled` (+ SMTP), `GooglePlaces__Enabled` (+ key). Restart the service after edits.
3. Destroy the redundant VPS `ef3qm5o7 / 74.81.40.152` to stop its ~$15/mo charge.
4. Change the seeded superuser password; consider `ufw` + disabling SSH password auth.
