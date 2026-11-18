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

| Method | Path | Body | Answer |
|---|---|---|---|
| POST | `/v1/auth/signup` | `{email, password, displayName?}` | `201 {token, user}`; `409` if the email exists |
| POST | `/v1/auth/signin` | `{email, password}` | `200 {token, user}`; `401` on wrong credentials |
| GET | `/v1/auth/me` | none | `200 {user}`; `401` when the token is missing or expired |
| POST | `/v1/auth/signout` | none | `204` |
| POST | `/v1/auth/forgot` | `{email}` | `202`, same answer whether or not the email exists |
| POST | `/v1/auth/reset` | `{token, newPassword}` | `200` |

`user` is `{id, email, displayName}`. Errors are `{error: {code, message}}`, and a
validation error may add `fields: {name: message}`.

CORS: the shared service must allow `https://jemaiinnovations.com` (the Deen Time site
is served at `/masjid/` on that origin) with the `Authorization` and `Content-Type`
headers.

The Deen Time Worker checks a token by calling `GET /v1/auth/me` with it (cached for
60 seconds). A service binding named `AUTH` to the shared Worker is used when present.
