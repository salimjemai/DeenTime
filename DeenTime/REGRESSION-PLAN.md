# DeenTime regression report and repair plan

Date: 2026-08-18  
Scope: Prayer Times, Iqama, Design, Hijri, Publish, Content, and public TV/widget views

## Executive finding

The reported six-screen outage was reproducible, but it was not six independent feature failures. The local machine was running mismatched and conflicting infrastructure:

1. A host `DeenTime.Api` process had occupied `127.0.0.1:8080` for almost two days and was configured for PostgreSQL on port `55432`, where no database was running.
2. Docker also published a different API on port `8080`, but its database container had lost its Compose network attachment.
3. The Docker API image was built on 2026-04-27 while the Angular frontend was current. The old API did not have the current Content/public-display endpoints and still had an older Iqama contract.
4. The browser held a JWT whose organization id belonged to the stale database. The frontend guard accepted the token merely because it existed, even though that organization did not exist in the current database.
5. `/health/ready` returned HTTP 200 while the API could not connect to PostgreSQL, hiding the outage.

After stopping only the verified stale host API, recreating the database container/network, rebuilding the API from current source, and using Quick Login to obtain a current JWT, all six admin routes loaded. The TV, full widget, and compact widget also loaded.

## Regression results

| Area | Original result | Clean-stack result | Remaining problem |
|---|---|---|---|
| Prayer Times | Failed with “Could not load prayer times. Check criteria are set.” | PASS: all seven calculated times load for 2026-08-18 | Error copy falsely blames criteria for infrastructure, authorization, and not-found failures. Maghrib uses the misspelled icon id `wb_twighlight`. |
| Iqama | Year and current schedule calls failed | PASS: year history and active schedule load | Only Fajr is configured. Dhuhr, Asr, Maghrib, Isha, and Jumu’ah are data gaps and remain “Not set.” The UI needs setup/readiness guidance. |
| Design | Settings shell loaded but today’s preview was unavailable | PASS: settings and live preview load with Adhan/start and Iqama columns | No image is currently configured. Save/upload write paths were not changed during this read-focused regression. |
| Hijri | Appeared empty | PASS: 16 generated rows contain valid editable Hijri dates | A year labelled “2026” displays Dec 2025 through Mar 2027 without explaining the buffer. Load errors are silently swallowed. |
| Publish | Admin shell loaded with a generic HTTP error and no share data | PASS: artifacts, TV settings, previews, TV, full widget, and compact widget load | Copied iframe snippets contain relative sources such as `/w/admin`; pasted on a masjid’s external site, these point at the masjid domain instead of DeenTime and fail. Missing Iqama/Jumu’ah data also appears publicly. |
| Content | Summary failed; counters stayed at zero | PARTIAL: summary and Qur’an random ayah work on current API | Hadith provider credential is absent from the runtime, import is disabled, books return an empty list, and random Hadith returns 404. No per-masjid API client token/key system exists; the public content API is only IP-rate-limited. |
| Automated checks | Not protecting these flows | FAIL/PARTIAL | Angular: 1 of 2 tests fails because the generated title assertion is stale. Backend: no test projects, so `dotnet test` executes zero tests. There are no end-to-end tests. Lint, backend build, frontend production build, and current Docker API build pass. |

## Confirmed defects

### P0 — Restore trustworthy runtime behavior

1. **Readiness endpoint always lies**
   - `Program.cs` maps `/health/ready` to an unconditional `200 ready`.
   - It stayed green while login returned a PostgreSQL connection-refused exception.
   - Required fix: real readiness checks for database connectivity and completed migrations; return 503 when dependencies are unavailable. Keep `/health/live` process-only.

2. **No deterministic one-command development startup**
   - Host API, Docker API, multiple database ports, and an old image can coexist.
   - Required fix: one supported command that checks port ownership, starts/rebuilds the intended database and API, waits on real readiness, then starts Angular. Fail with a precise message if another process owns a required port.

3. **Frontend/backend version drift is invisible**
   - The old container returned 404 for `/api/v1/islamic-content/*` and `/public/display/*`, plus 405 for current Iqama, while the current frontend expected all of them.
   - Required fix: build metadata/version endpoint (commit SHA, build time, schema version), display/log mismatch clearly, and make the local start command rebuild when source is newer than the image.

### P1 — Fix user-facing correctness

4. **Authentication guard validates presence, not validity**
   - `authGuard` accepts any non-empty token. It does not check expiration, structure, server validity, or whether the claimed organization still exists.
   - `authInterceptor` adds the token but does not centrally handle 401/403 or an invalid organization.
   - Required fix: validate JWT expiry client-side, add a bootstrap/session endpoint, resolve the active organization before activating admin routes, canonicalize `/org/:id/...`, and clear/re-login on invalid sessions. Show a dedicated “organization unavailable” state instead of six unrelated feature errors.

5. **Feature errors discard the real cause**
   - Prayer Times always says criteria are missing.
   - Hijri silently ignores load failures.
   - Publish and Design hide several request failures behind empty/spinner states.
   - Required fix: shared API error mapping for offline/503, unauthorized, forbidden, not found, validation, and unexpected errors. Preserve a correlation id for support and expose an actionable retry.

6. **Publish embed snippets are not portable**
   - The backend returns relative `iframe src` and TV links even though `Frontend:PublicBaseUrl` exists.
   - Required fix: generate absolute, environment-configured HTTPS URLs and HTML-encode organization names/attributes. Add a test that inserts the snippet into a document hosted on a different origin and confirms it still loads DeenTime.

7. **Content is only partially operational**
   - Qur’an proxy/random content works.
   - Hadith is unconfigured and has no imported records.
   - The product requirement for masjid API consumer tokens is not implemented.
   - Required fix: inject the Hadith provider credential through an uncommitted secret/environment variable; add a startup/configuration diagnostic; run resumable catalogue/import jobs; show progress and failures. Implement first-party API clients with hashed keys or OAuth client credentials, scopes, quotas, rotation/revocation, usage audit, and per-client rate limits. Never expose the upstream provider credential.

8. **A technically healthy schedule can still be unpublishable**
   - The demo organization has criteria but only one Iqama entry and no Jumu’ah services.
   - Required fix: organization readiness checklist/onboarding for criteria, five daily Iqamas, Jumu’ah services, design image/theme, and public preview. Distinguish “not configured” from “system failure.”

### P2 — Quality and UX cleanup

9. **Hydration warning on every route**
   - Every tested page logs Angular `NG0505` because client hydration is enabled while `ng serve` supplies no serialized SSR state.
   - Required fix: make the browser/server application configs consistent, or omit hydration for the CSR development build.

10. **Prayer icon typo**
    - Replace `wb_twighlight` with a valid Material symbol and add a small rendering assertion.

11. **Hijri year scope is unclear**
    - Either limit the table to the selected Gregorian year or clearly label the Dec-to-Mar buffer and why it is needed.

12. **Regression suite is effectively absent**
    - Replace the stale generated Angular test.
    - Add backend test projects and browser end-to-end coverage described below.

13. **Production build relies on live Google Fonts retrieval**
    - The first production build failed without network access; it passed when network access was allowed.
    - Self-host Material icon fonts or explicitly cache/vendor them so builds are reproducible.

## Execution plan

### Phase 1 — Make the stack deterministic and observable

1. Add a single documented local launcher (script/Make target/npm task) for database, current API image, migrations, readiness wait, and Angular.
2. Add database and API health checks to Compose; make API depend on database health.
3. Implement real `/health/ready` database/schema checks and keep `/health/live` process-only.
4. Add `/api/version` (or equivalent) with frontend/API build and schema metadata.
5. Add a port-conflict preflight and remove obsolete Compose configuration.

Acceptance:

- A clean checkout starts with one command.
- Stopping PostgreSQL changes readiness to 503 and visibly marks the app unavailable.
- A stale API image or conflicting process cannot masquerade as a healthy current stack.

### Phase 2 — Repair session and organization routing

1. Add a current-session/current-organization API contract.
2. Validate token shape and expiration before route activation.
3. Verify server session and organization membership before rendering the shell.
4. Handle 401/403 centrally; handle missing organization with a selector or safe redirect.
5. Canonicalize all admin URLs to the organization id from the validated session.

Acceptance:

- Expired, malformed, wrong-database, and deleted-organization tokens never reach feature screens.
- The user sees one clear recovery action instead of six misleading errors.

### Phase 3 — Complete feature contracts and configuration

1. Return typed problem details from all feature APIs and map them to actionable UI states.
2. Make Publish return absolute, encoded embed URLs derived from configured public frontend origin.
3. Add the organization readiness checklist and require/encourage all five daily Iqamas plus Jumu’ah before publishing.
4. Configure Hadith securely, execute resumable imports, and expose accurate progress/last-error state.
5. Implement masjid API client credentials, scopes, quotas, revocation, and usage metrics for Content APIs.
6. Verify Design image upload propagates to TV, full widget, and compact widget with automated assertions.

Acceptance:

- External-domain iframe test passes.
- TV/widget show all configured Adhan, Iqama, and Jumu’ah values.
- Hadith catalogue/search/random endpoints return imported data.
- A revoked client token is rejected; valid scoped tokens work within quotas.

### Phase 4 — UI reliability cleanup

1. Remove the hydration warning.
2. Fix the Maghrib icon id.
3. Clarify the Hijri date range.
4. Standardize loading, empty, offline, permission, validation, and retry states.
5. Self-host required icon fonts for offline/reproducible builds.

### Phase 5 — Build the regression safety net

Backend:

- Add xUnit integration tests with a disposable PostgreSQL fixture/Testcontainers.
- Cover login/session, criteria/timings, current and yearly Iqama, Hijri generation/update, design/public display, publish/embed code, Content summary, Qur’an proxy, Hadith import/search, authorization, and real readiness.

Frontend:

- Replace the generated failing `app.spec.ts` assertion.
- Add service/component tests for typed success, empty, and error states.
- Add Playwright end-to-end tests that quick-login, visit all six admin tabs, and assert no generic failure banners.
- Test `/tv/:slug`, `/w/:slug`, and `/w2/:slug` for all prayer starts, five Iqamas, Hijri date, Jumu’ah, design background, and footer.

CI gate:

1. Build a fresh API image from the checked-out commit.
2. Start PostgreSQL and run migrations.
3. Run backend tests, Angular unit tests, lint, production build, and browser E2E.
4. Fail on console errors, API contract drift, missing migrations, unhealthy readiness, or frontend/backend version mismatch.

## Verification already completed

- Current API image rebuilt successfully from source.
- Backend solution build: PASS, zero warnings/errors.
- Backend tests: no test projects discovered (coverage gap).
- Angular lint: PASS.
- Angular production build: PASS with network access; fails when Google Fonts cannot be retrieved.
- Angular unit tests: FAIL, one stale generated expectation.
- Authenticated API probes: criteria, timings, Iqama year/current, design, Hijri, publish settings/artifacts, Content summary/status, and public display all return 200 on the current organization.
- Browser smoke test: all six admin routes render on the current organization.
- Public browser smoke test: TV, full widget, and compact widget render.
- Public Content probes: capabilities 200, random Qur’an 200, Hadith books 200 with empty data, random Hadith 404 because no records are imported.

## Guardrails for implementation

- Preserve existing user changes and database data.
- Do not commit provider keys or JWT signing secrets.
- Do not claim a feature is fixed solely because its page shell renders; verify its API contract and visible data.
- Keep legacy URL compatibility while correcting generated modern URLs.
- Complete with automated tests and a browser rerun of the full matrix above.
