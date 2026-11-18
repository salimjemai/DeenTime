# Masjid module for the shared backend

Salim chose one backend: the masjid admin API runs inside the shared Jemai Innovations
Worker (`mushafplus-api` at `https://api.jemaiinnovations.com`, D1 `mushafplus`), next
to accounts and family groups. This folder is that code, kept here so Deen Time's tests
run on it. It has no npm dependencies and no secrets.

## Moving it into the shared backend

The Mushaf+ backend (`MushafPlus/backend`) owns that Worker, so these steps are done
there, not from this repository.

1. Copy `src/*.ts` to `backend/src/masjid/`.
2. Copy `migrations/0002_masjids.sql` to `backend/migrations/0002_masjids.sql`. It runs
   after `0001_init.sql` and references `users(id) ON DELETE CASCADE`, so deleting an
   account deletes the masjids it owns. It never writes to `users` or `sessions`.
3. Copy `test-shared/masjid.test.ts` to `backend/test/masjid.test.ts`.
4. Mount it in `backend/src/index.ts`, at the top of `dispatch()`:

```ts
import { requireUser } from './auth';
import { handleMasjidApi } from './masjid/masjid-api';

// inside dispatch(), right after `const url = new URL(request.url);`
if (url.pathname.startsWith('/v1/masjid/')) {
  return handleMasjidApi(request, url.pathname.slice('/v1/masjid'.length), {
    db: env.DB,
    verify: (req) => requireUser(req, env),
  });
}
```

`requireUser` throws the backend's own `ApiError` (401 `unauthorized` or
`session_expired`); the module answers with that error as it is.

Checked on 2026-11-18 against `claude/project-thread-n6yp2t` (commit aadc738): with
the four steps applied in a scratch copy, `tsc --noEmit` passes and all 35 tests pass
(the backend's 34 plus `masjid.test.ts`, which signs up, sets up a masjid, edits it,
reads the public page and deletes the account).

Two things to know in that Worker: its wrapper sets `cache-control: no-store` on every
answer, so the public page is not cached for 60 seconds as the module asks; and its
CORS list allows GET, POST, PATCH and DELETE, which is all the web app uses.

## Routes

See `../../docs/masjid-api.md`. Everything is under `/v1/masjid`.

## Tests here

`npm test` in `DeenTime/cloudflare` runs `test/` on an in-memory SQLite copy of D1 with a
stand-in `users` table. `src/prayer-times.ts` is a copy of
`backend-node/src/domain/prayer-times.ts`; `src/timezone.ts` does the same job with
`Intl` instead of luxon (checked equal to the luxon version across ten zones for 2026).
