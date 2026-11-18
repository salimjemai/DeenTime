# Masjid admin API (shared backend + D1)

Served by the one shared backend at `https://api.jemaiinnovations.com/v1/masjid`, next to
accounts and Mushaf+ family groups. The code is `cloudflare/masjid-module/` (handler
`handleMasjidApi()`); `cloudflare/masjid-module/README.md` says how it is mounted there.
The schema is `cloudflare/masjid-module/migrations/0002_masjids.sql` (tables `masjids`,
`masjid_admins`, `masjid_messages`), in the shared D1 after its `0001_init.sql`, with
user ids referencing `users(id) ON DELETE CASCADE`.

Signed in means a valid bearer token from the shared sign-in (see `shared-auth-contract.md`).

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/config` | anyone | calculation and Asr methods |
| GET | `/public/masjids/{slug}` | anyone (CORS `*`) | public details, today's and tomorrow's prayer and iqama times, active messages, widget settings |
| GET | `/locate/postal-code?country=US&code=78613` | anyone | city, region, latitude, longitude (zippopotam.us) |
| GET | `/me/masjids` | signed in | masjids the user manages |
| POST | `/masjids` | signed in | create a masjid (name and timezone required); creator becomes owner |
| GET | `/masjids/{id}` | masjid admin | full details |
| PATCH | `/masjids/{id}` | masjid admin | partial update: details, `iqama`, `jumuah`, `widget` (PUT also works) |
| DELETE | `/masjids/{id}` | owner | delete the masjid and its messages |
| GET | `/masjids/{id}/messages` | masjid admin | all messages |
| POST | `/masjids/{id}/messages` | masjid admin | `{title, body?, startsOn?, endsOn?, pinned?}` |
| PATCH | `/masjids/{id}/messages/{messageId}` | masjid admin | replace a message (PUT also works) |
| DELETE | `/masjids/{id}/messages/{messageId}` | masjid admin | delete a message |

Iqama rules per prayer: `{mode: "none"}`, `{mode: "fixed", time: "13:30"}` or
`{mode: "offset", minutes: 20}` (minutes after the adhan, 0 to 120).
Jumu'ah: up to four `"HH:mm"` times. Widget: `{theme: "light"|"dark", accent: "#rrggbb",
showIqama, showMessages, showJumuah}`.

Mushaf+ can read a masjid's public page from `/v1/masjid/public/masjids/{slug}` and link people
to `https://jemaiinnovations.com/masjid/m/{slug}`.

Not yet here (still only in the Node API): hijri month maps, monthly and Ramadan PDFs,
TV display designs, Quran/Hadith content, multiple admins per masjid (the table exists,
no invite flow yet).
