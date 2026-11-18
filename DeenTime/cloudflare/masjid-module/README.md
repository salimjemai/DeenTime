# Masjid module for the shared backend

Salim chose one backend: the masjid admin API runs inside the shared Jemai Innovations
Worker (`mushafplus-api` at `https://api.jemaiinnovations.com`, D1 `mushafplus`), next
to accounts and family groups. This folder is that code, kept here so Deen Time's tests
run on it. It has no npm dependencies and no secrets.

## Where it lives now

The live copy is in the shared backend: `MushafPlus/backend/src/masjid/` and
`backend/migrations/0002_masjids.sql` (MushafPlus PR #9, commit 82cb1fa, byte-for-byte
the same as this folder). It is mounted at the top of `dispatch()` in
`backend/src/index.ts`:

```ts
if (url.pathname.startsWith('/v1/masjid/')) {
  return handleMasjidApi(request, url.pathname.slice('/v1/masjid'.length), {
    db: env.DB,
    verify: (req) => requireUser(req, env),
  });
}
```

The Mushaf+ backend owns that copy and its end-to-end test (`backend/test/masjid.test.ts`).
If you change a file here, apply the same change there; the two must stay identical.
That Worker keeps the public page's `public, max-age=60` cache and its
`Access-Control-Allow-Origin: *`; signed-in answers stay `no-store`.

## Routes

See `../../docs/masjid-api.md`. Everything is under `/v1/masjid`.

## Tests here

`npm test` in `DeenTime/cloudflare` runs `test/` on an in-memory SQLite copy of D1 with a
stand-in `users` table. `src/prayer-times.ts` is a copy of
`backend-node/src/domain/prayer-times.ts`; `src/timezone.ts` does the same job with
`Intl` instead of luxon (checked equal to the luxon version across ten zones for 2026).
