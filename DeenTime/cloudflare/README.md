# Masjid site on Cloudflare

The masjid admin site lives at **https://jemaiinnovations.com/masjid/**. Salim chose one
backend, so it is split in two:

- **This folder's Worker (`deentime-web`)** serves only the Angular app (built with
  `--base-href /masjid/`), including `/masjid/m/{slug}`, a masjid's public page (add
  `?embed=1` for the website widget). It has no database and no secrets.
- **The shared backend** (`mushafplus-api` at `https://api.jemaiinnovations.com`, D1
  `mushafplus`) handles sign-up, sign-in and the masjid API under `/v1/masjid`. The masjid
  code for it is in `masjid-module/`, with steps for moving it there.

Nothing here has been deployed.

## One-time setup (Salim)

1. In Cloudflare, make sure `jemaiinnovations.com` is a zone on your account with its
   DNS proxied (orange cloud). The route `jemaiinnovations.com/masjid*` only takes
   over that path; the rest of the domain keeps working as it does now.
2. Create an API token with **Account > Workers Scripts > Edit** and
   **Zone > Workers Routes > Edit** for `jemaiinnovations.com`. No DNS permission.
3. In GitHub, add the repository secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` (or put them on the `cloudflare-production` environment).
4. Once the shared backend, with the masjid module in it, is live at
   `https://api.jemaiinnovations.com`, run the **Cloudflare (masjid site)** workflow from
   the Actions tab with **deploy** ticked. It tests, builds and deploys this site.
5. Check `https://deentime-web.<your-subdomain>.workers.dev/masjid/` first, then
   `https://jemaiinnovations.com/masjid/`.

Rollback: Workers > deentime-web > Deployments lets you roll back to an earlier version,
or delete the route to hand `/masjid` back to whatever served it before.

## Working on it

```bash
cd DeenTime/cloudflare && npm ci
npm run check && npm test                   # masjid module tests on an in-memory SQLite D1
npm run build:web && node scripts/prepare-assets.mjs
npx wrangler dev                            # site only; the API is the shared backend
```

## Renaming the app

The product name is in one place: `DeenTime/brand.json`. The web app's title, the
sign-in pages and the public page footer read it.
