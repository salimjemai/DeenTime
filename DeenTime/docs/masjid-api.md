# Masjid admin API (Cloudflare Worker + D1)

Served by `DeenTime/cloudflare` at `https://jemaiinnovations.com/masjid/api/v1`.
The handler is `handleMasjidApi()` in `cloudflare/src/masjid-api.ts`, written so the
shared Jemai Innovations Worker can mount the same routes if that is preferred. The D1
schema is `cloudflare/migrations/0002_masjids.sql` (tables `masjids`, `masjid_admins`,
`masjid_messages`); user ids are the shared auth service's ids.

Signed in means a valid shared-auth bearer token (see `shared-auth-contract.md`).

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/config` | anyone | brand name, auth base URL, calculation methods |
| GET | `/public/masjids/{slug}` | anyone (CORS `*`) | public details, today's and tomorrow's prayer and iqama times, active messages, widget settings |
| GET | `/locate/postal-code?country=US&code=78613` | anyone | city, region, latitude, longitude (zippopotam.us) |
| GET | `/me/masjids` | signed in | masjids the user manages |
| POST | `/masjids` | signed in | create a masjid (name and timezone required); creator becomes owner |
| GET | `/masjids/{id}` | masjid admin | full details |
| PUT | `/masjids/{id}` | masjid admin | partial update: details, `iqama`, `jumuah`, `widget` |
| DELETE | `/masjids/{id}` | owner | delete the masjid and its messages |
| GET | `/masjids/{id}/messages` | masjid admin | all messages |
| POST | `/masjids/{id}/messages` | masjid admin | `{title, body?, startsOn?, endsOn?, pinned?}` |
| PUT | `/masjids/{id}/messages/{messageId}` | masjid admin | replace a message |
| DELETE | `/masjids/{id}/messages/{messageId}` | masjid admin | delete a message |

Iqama rules per prayer: `{mode: "none"}`, `{mode: "fixed", time: "13:30"}` or
`{mode: "offset", minutes: 20}` (minutes after the adhan, 0 to 120).
Jumu'ah: up to four `"HH:mm"` times. Widget: `{theme: "light"|"dark", accent: "#rrggbb",
showIqama, showMessages, showJumuah}`.

Mushaf+ can read a masjid's public page from `/public/masjids/{slug}` and link people
to `https://jemaiinnovations.com/masjid/m/{slug}`.

Not yet here (still only in the Node API): hijri month maps, monthly and Ramadan PDFs,
TV display designs, Quran/Hadith content, multiple admins per masjid (the table exists,
no invite flow yet).
