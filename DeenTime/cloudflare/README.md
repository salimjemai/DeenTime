# Masjid site on Cloudflare

This folder runs the masjid admin site at **https://jemaiinnovations.com/masjid/** as
one Cloudflare Worker:

- `/masjid/` and every page under it: the Angular app (built with `--base-href /masjid/`)
- `/masjid/api/v1/*`: the masjid API on a D1 database (see `../docs/masjid-api.md`)
- `/masjid/m/{slug}`: a masjid's public page; add `?embed=1` for the website widget

Sign-up and sign-in use the shared Jemai Innovations auth service that Mushaf+ also
uses (`../docs/shared-auth-contract.md`). This Worker never sees a password.

Nothing in this folder is secret. Nothing here has been deployed.

## One-time setup (Salim)

1. In Cloudflare, make sure `jemaiinnovations.com` is a zone on your account with its
   DNS proxied (orange cloud). The route `jemaiinnovations.com/masjid*` only takes
   over that path; the rest of the domain keeps working as it does now.
2. Create the database: `npx wrangler d1 create deentime`. Copy the printed
   `database_id` into `wrangler.jsonc` in place of the zeros, and commit that change
   (a D1 id is not a secret).
3. Create an API token with **Account > Workers Scripts > Edit**, **Account > D1 > Edit**
   and **Zone > Workers Routes > Edit** for `jemaiinnovations.com`. No DNS permission.
4. In GitHub, add the repository secrets `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` (or put them on the `cloudflare-production` environment).
5. Once the shared auth service is live at `https://api.jemaiinnovations.com`, run the
   **Cloudflare (masjid site)** workflow from the Actions tab with **deploy** ticked. It
   tests, builds, applies the D1 migrations and deploys.
6. Check `https://deentime.<your-subdomain>.workers.dev/masjid/` first, then
   `https://jemaiinnovations.com/masjid/`.

Rollback: Workers > deentime > Deployments lets you roll back to an earlier version,
or delete the route to hand `/masjid` back to whatever served it before.

## Working on it

```bash
cd DeenTime/backend-node && npm ci          # the Worker reuses its prayer-time calculator
cd ../cloudflare && npm ci
npm test                                    # API tests on an in-memory SQLite copy of D1
npm run build:web && node scripts/prepare-assets.mjs
npm run db:migrate:local
npx wrangler dev --var AUTH_API_BASE:http://127.0.0.1:8788   # point at a local auth service
```

## Renaming the app

The product name is in one place: `DeenTime/brand.json`. The web app's title, the
sign-in pages, the public page footer and the API's `/config` all read it.
