# Shared sign-up / sign-in contract

Deen Time does not keep passwords. Accounts live in the shared Jemai Innovations
auth service, which Mushaf+ also uses (being built in the MushafPlus repository as
a Cloudflare Worker + D1). This file is what the Deen Time web app and Worker assume.
If the shared service settles on different paths, change two places:

- web app: `frontend/deentime-web/src/app/cloud/shared-auth.contract.ts` (`SHARED_AUTH_PATHS`)
  and `authApiUrl` in `src/environments/environment.cloudflare.ts`
- Worker: `AUTH_API_BASE` and `AUTH_ME_PATH` in `cloudflare/wrangler.jsonc`

Base URL assumed: `https://api.jemaiinnovations.com`. JSON in and out. Sessions are a
bearer token sent as `Authorization: Bearer <token>`.

Confirmed with the Mushaf+ backend (Worker `mushafplus-api`, D1 `mushafplus`, branch
`claude/project-thread-n6yp2t` in salimjemai/MushafPlus, `backend/`) on 2026-11-18:

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/v1/auth/signup` | `{email, password, displayName}` (name 1 to 60 chars, required) | `201 {token, expiresAt, user}`; `409 email_taken`; `400` on bad input |
| POST | `/v1/auth/signin` | `{email, password}` | `200 {token, expiresAt, user}`; `401 invalid_credentials`; `429 too_many_attempts` after 10 bad passwords in 15 minutes |
| GET | `/v1/auth/me` (alias of `/v1/me`) | none | `200 {user}`; `401 unauthorized` or `session_expired` |
| POST | `/v1/auth/signout` | none | `200 {"ok": true}` |

`user` is `{id, email, displayName, createdAt}`. `expiresAt` is Unix milliseconds;
sessions last 60 days. The token is opaque (43 characters, base64url); the service
stores only its SHA-256. Errors are `{error: {code, message}}`.

Not in the shared service yet: password reset (`/v1/auth/forgot`, `/v1/auth/reset`).
The web app hides "Forgot your password?" until `SHARED_AUTH_FEATURES.passwordReset`
is turned on.

Deen Time never writes to the shared `users` or `sessions` tables.

CORS: the shared service must allow `https://jemaiinnovations.com` (the Deen Time site
is served at `/masjid/` on that origin) with the `Authorization` and `Content-Type`
headers.

The Deen Time Worker checks a token by calling `GET /v1/auth/me` with it (cached for
60 seconds). A service binding named `AUTH` to the shared Worker is used when present.
