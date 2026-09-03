# Staging go-live runbook — iqama.momyum.com

Hand this to whoever has **root / CyberPanel admin** on the server
(`165.227.175.2`). The `iqama6368` deploy account cannot do these steps.

## What's broken and why

The API backend and the static site are both deployed and working in isolation,
but two server-config gaps keep the public site from functioning:

1. **The reverse proxy fails.** OpenLiteSpeed serves the Angular app, but every
   `/api`, `/health`, `/public`, `/uploads` request returns a **LiteSpeed 500**.
   Cause: the vhost rewrite proxies to a bare `http://127.0.0.1:18080/`, which
   OpenLiteSpeed's `[P]` flag does not support — it needs a **named External
   App**. (Verified: with the backend up and answering locally — `/health/ready`
   200, login a correct 401 — the public routes still 500 with an
   `x-turbo-charged-by: LiteSpeed` error page.)
2. **The backend stops when nobody is logged in.** `loginctl show-user
   iqama6368` reports `Linger=no`, so systemd tears down the user services the
   moment the last SSH session closes. The API must run unattended.

The API listens on `127.0.0.1:18080` as the systemd **user** unit
`deentime-api` (uid 1009).

---

## Fix 1 — make the proxy work

### Step 1a. Define the backend as an External App

**CyberPanel:** Websites → List Websites → `iqama.momyum.com` → Manage →
Configurations → **vHost Conf**, and add this block:

```
extprocessor deentime-api {
  type                    proxy
  address                 127.0.0.1:18080
  maxConns                100
  initTimeout             60
  retryTimeout            0
  respBuffer              0
}
```

(Root alternative: edit
`/usr/local/lsws/conf/vhosts/iqama.momyum.com/vhconf.conf` directly.)

### Step 1b. Point the rewrite at the External App

In the same vhost config's **rewrite rules**, replace the current proxy line:

```
# BEFORE (returns LiteSpeed 500):
RewriteRule ^/?(api|health|public|uploads)(/.*)?$ http://127.0.0.1:18080/$1$2 [P,L]
```

with the **named-app** form, and keep the SPA fallback below it:

```
RewriteEngine On

# API, health, public endpoints, and uploads go to the backend External App.
RewriteRule ^/?(api|health|public|uploads)(/.*)?$ http://deentime-api/$1$2 [P,L]

# SPA fallback: non-file, non-proxied paths return index.html.
RewriteCond %{REQUEST_URI} !^/(api|health|public|uploads)(/|$)
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ /index.html [L]
```

The only change from what's live is `127.0.0.1:18080` → `deentime-api`, plus the
External App block from 1a. (A context-based alternative is in
`deploy/staging-vhost.conf` if you prefer contexts over a rewrite proxy.)

### Step 1c. Restart LiteSpeed

```
/usr/local/lsws/bin/lswsctrl restart
```

---

## Fix 2 — keep the backend running unattended

```
# Enable lingering so the user's systemd services survive logout/reboot:
loginctl enable-linger iqama6368

# Start the API now under the (now-persistent) user manager:
sudo -u iqama6368 XDG_RUNTIME_DIR=/run/user/1009 systemctl --user restart deentime-api
```

Confirm:

```
loginctl show-user iqama6368 -p Linger        # expect: Linger=yes
sudo -u iqama6368 XDG_RUNTIME_DIR=/run/user/1009 systemctl --user is-active deentime-api   # expect: active
```

---

## Verify (from anywhere)

```
curl -s -o /dev/null -w '%{http_code}\n' https://iqama.momyum.com/login          # 200
curl -s -o /dev/null -w '%{http_code}\n' https://iqama.momyum.com/api/version     # 200 (was 500)
curl -s  https://iqama.momyum.com/health/ready                                    # {"ready":true,...}
```

Then load `https://iqama.momyum.com/login` in a browser and sign in — the POST to
`/api/v1/auth/login` should return 200/401 (real auth), never 500.

---

## Rollback

- Fix 1 is contained to the vhost config: remove the `extprocessor` block and
  restore the previous rewrite line, then `lswsctrl restart`.
- Fix 2: `loginctl disable-linger iqama6368`.
- Neither touches application data or releases.
