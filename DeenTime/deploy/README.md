# Staging deployment (no Docker)

GitHub Actions tests the Angular and .NET applications, publishes a
**self-contained linux-x64 build** of the API and a static Angular bundle,
copies both tarballs to the server over SSH, and runs `deploy-staging.sh`
there. The server needs **no Docker and no .NET runtime**:

- The API runs as a user-level **systemd** service (`deentime-api`) bound to
  `127.0.0.1:18080`, from `~/deentime/current/api` (a symlink into
  `~/deentime/releases/<sha>`; a failed health check flips the symlink back to
  the previous release).
- The Angular build is rsynced into the OpenLiteSpeed document root and served
  directly by OpenLiteSpeed, which also terminates TLS and proxies API paths.
- Uploads persist across releases in `~/deentime/shared/uploads`, symlinked
  into each release at `wwwroot/uploads`.

## One-time server preparation

1. Ask the hosting administrator (the `iqama6368` account is not a sudoer) to
   install the native tools and libraries, let the deployment user's services
   outlive its SSH sessions, and grant that user access to the existing
   CyberPanel document root:

   ```bash
   apt-get update
   apt-get install -y acl rsync libfontconfig1 fonts-liberation fonts-dejavu-core
   loginctl enable-linger iqama6368
   setfacl -R -m u:iqama6368:rwx /home/iqama.momyum.com/public_html
   setfacl -d -m u:iqama6368:rwx /home/iqama.momyum.com/public_html
   ```

   If CyberPanel reports a different document root, use that exact path in
   both ACL commands and in `DEENTIME_WEB_ROOT` below. The deployment account
   needs create, replace, and delete access there because releases are synced
   atomically with `rsync --delete`.

2. Ensure PostgreSQL is reachable from the server (native install or managed)
   and note the connection string.

3. As the deployment user, create the persistent directory layout:

   ```bash
   mkdir -p ~/deentime/incoming ~/deentime/shared/uploads
   ```

   The deployment script installs and refreshes the user-level systemd unit
   automatically on every release.

4. Copy `.env.staging.example` to `~/deentime/.env.staging`, fill in the
   secrets (including `DEENTIME_WEB_ROOT`, the OpenLiteSpeed document root),
   and `chmod 600` it.

5. Configure the `iqama.momyum.com` virtual host in OpenLiteSpeed / CyberPanel
   (see below). OpenLiteSpeed keeps terminating the existing Let's Encrypt
   certificate.

6. Add the public half of a dedicated deployment key to
   `~/.ssh/authorized_keys` for `iqama6368`. Add only its private half to the
   GitHub repository secret named `STAGING_SSH_PRIVATE_KEY`. Do not put the
   server password, database password, SMTP password, or signing key in the
   workflow file.

7. Push to `main` (or run the workflow manually). GitHub Actions performs the
   build, tests, transfer, service restart, rollback-on-failure, and public
   HTTPS verification. No container runtime or container registry is used.

## OpenLiteSpeed virtual host

The nginx container used to do three things; they move into the vhost config:

**1. Proxy API paths to the .NET service.** Define an External App of type
*Web Server* named `deentime-api` with address `127.0.0.1:18080`, then add a
rewrite-based proxy (vhost → Rewrite, or `.htaccess` with rewriting enabled):

```apache
RewriteEngine On

# API, health checks, public endpoints, and uploaded files go to the API.
RewriteRule ^/?(api|health|public|uploads)(/.*)?$ http://deentime-api/$1$2 [P,L]

# SPA fallback: anything that is not a real file is index.html.
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [L]
```

**2. Security headers.** In the vhost's *Context* for `/` (or Header
Operations), add:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com
```

The TV display and embeddable widget routes (`/tv`, `/w`, `/w2`) must remain
embeddable in iframes: add separate contexts for those URIs that omit
`X-Frame-Options` and set `frame-ancestors *` in the CSP instead.

**3. No-store caching for the app shell.** Add contexts for `/index.html` and
`/ngsw.json` with `Cache-Control: no-store` so PWA updates roll out promptly.

Also set the vhost's max request body size to at least 20 MB to match the
previous upload limit.

## Each deployment

The workflow pins the server's ED25519 host key, copies
`deentime-api-<sha>.tar.gz` and `deentime-web-<sha>.tar.gz` into
`~/deentime/incoming/`, and runs `deploy-staging.sh <sha>`, which:

1. unpacks the release into `~/deentime/releases/<sha>`,
2. links the shared uploads directory into it,
3. flips the `~/deentime/current` symlink and restarts `deentime-api`,
4. health-checks `http://127.0.0.1:18080/health/ready` (rolling back the
   symlink and restarting on failure),
5. rsyncs the Angular build into `DEENTIME_WEB_ROOT`, and
6. keeps the five most recent releases for rollback.

Afterwards the workflow verifies the public website, `/health/ready`, and
`/api/version` over HTTPS.
