# Implementation Plan: Fog Monitoring

## Overview

Built in five increments — schema, ingest, algorithm, API, UI — each verified
before the next began. All code tasks are complete; what remains is deployment
and two items that cannot be closed without a live endpoint and live data.

**Verification status at completion:** 104 fog tests passing, `tsc --noEmit`
clean project-wide, ESLint clean, `next build` compiled successfully with all
six API routes. The UI is reached as the FOG MONITOR tab of `/admin/Radar`.
The ingest path has been exercised end to end against the live endpoint.

> The pre-existing failure in `__tests__/comprehensive-radar-report.render.test.jsx`
> was confirmed to fail identically with all fog work stashed. It is unrelated.

---

## Tasks

- [x] 1. Schema (migrations 001–004, hand-run in the Supabase SQL Editor)
  - [x] 1.1 `001_fog_schema.sql` — `weather_stations`, `weather_readings`, `fog_assessments`, `poll_runs`
    - Unique `(mac_address, observed_at)` for upsert; index on `(mac_address, observed_at DESC)`.
    - Partial unique index `weather_stations_one_active_per_site` — this is what lets every read route resolve "the site's station" with no tie-break.
    - RLS: authenticated SELECT only. Writes are expressed by the **absence** of an INSERT/UPDATE/DELETE policy; the service role bypasses RLS.
    - `prune_weather_history()` — readings 90 days, poll_runs 30 days, assessments never. Scheduled via `pg_cron` when the extension is present, guarded so the migration still runs when it is not.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_
  - [x] 1.2 `002_rainfall_views.sql` — `weather_rain_steps`, `weather_rain_hourly`, `weather_rain_daily`
    - Deltas across the whole series, reset detection, 20-minute trust window, 45-minute coverage floor.
    - Daily totals as `MAX(rain_daily_mm)` per station-local day — survives polling holes that would make a sum under-report.
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_
  - [x] 1.3 `003_hysteresis_state.sql` — `raw_verdict`, `hysteresis_held`, `pressure_delta_hpa`
    - Added mid-build: the scorer is pure, so "two consecutive readings agreeing" is unrecoverable without storing the pre-hysteresis verdict.
    - _Requirements: 8.3, 8.4_
  - [x] 1.4 `004_bind_station.sql` — `bind_weather_station()` RPC
    - Atomic deactivate-then-activate. A partial unique index cannot be deferred, so the two statements must share a transaction.
    - _Requirements: 11.7, 11.8_

- [x] 2. Ingest layer (`lib/weather/`)
  - [x] 2.1 `units.ts` — F→C, mph→km/h, inHg→hPa, in→mm; propagates null, never coerces to zero. _Requirements: 3.1, 3.2, 3.5_
  - [x] 2.2 `solar.ts` — NOAA position, Haurwitz clear-sky GHI, clearness index. Pure. _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [x] 2.3 `geo.ts` — haversine and a deliberately generous bounding box. _Requirements: 13.10_
  - [x] 2.4 `parse.ts` — Zod schemas, the `hl` trap, scalar slimming, fail-soft field coercion. _Requirements: 1.4, 1.5, 2.1, 2.2, 2.3, 2.4_
  - [x] 2.5 `derive.ts` — record → `weather_readings` row in SI; timestamp sanity bounds. _Requirements: 2.5, 3.3, 3.4, 3.6_
  - [x] 2.6 `ambient.ts` — the only I/O. Server-only guard at import, 204 handling, single transient retry. _Requirements: 1.1, 1.2, 1.3, 1.6, 1.7_
  - [x] 2.7 Promote `zod` from a transitive to a direct dependency
  - [x] 2.8 `__tests__/fog-ingest.test.ts` — the `hl` block yielding exactly one record, SI derivation, the dew point fallback, and a source scan asserting no `"use client"` file imports `ambient.ts`
  - [x] 2.9 `psychrometrics.ts` — dew point from temperature and humidity
    - **The live station does not report `dewPoint`.** Its full `lastData` key
      set is: `stationtype, dateutc, tempf, humidity, windspeedmph, windgustmph,
      maxdailygust, winddir, winddir_avg10m, uv, solarradiation, hourlyrainin,
      eventrainin, dailyrainin, weeklyrainin, monthlyrainin, yearlyrainin,
      battrain, baromrelin, baromabsin, type, created_at, feelsLike, dateutc5,
      tz, hl`. No dew point, and no `windspdmph_avg10m` either.
    - DPD is the quantity every gate and every Index A component keys off, so
      without a fallback the scorer discards every reading as unusable and
      reports INSUFFICIENT_HISTORY permanently.
    - Magnus-Tetens with Alduchov & Eskridge coefficients. This is not an
      invented signal: the specification states dew point is derived from
      temperature and humidity rather than measured, so computing it locally
      preserves the semantics it already had — and makes Requirement 14.4
      (DPD and RH are one measurement, never two) plainer than before.
    - _Requirements: 3.5, 14.4_
  - [x] 2.10 `__tests__/fog-discovery.test.ts` — the `$publicBox` bracketed
    encoding, the `[lon, lat]` corner order, the `{ data: [...] }` envelope,
    radius filtering, and 204 handling. Runs under `@jest-environment node`,
    because `ambient.ts` refuses to load where `window` exists.

- [x] 3. Algorithm
  - [x] 3.1 `config/fogConstants.ts` — every tunable in one injectable object. _Requirements: 6.12_
  - [x] 3.2 `lib/weather/fogIndex.ts` — Index A, Index B, verdict resolution, hysteresis, per-component availability, typed InsufficientHistory. _Requirements: 6.*, 7.*, 8.*, 9.*, 10.*_
  - [x] 3.3 `lib/weather/rainfall.ts` — TypeScript twin of the SQL rule, so it is testable without Postgres. _Requirements: 4.1, 4.3_
  - [x] 3.4 `__tests__/fog-scoring.test.ts` — 27 tests
    - Clear afternoon (gate fired, score 0); pre-dawn saturation ≥ 70; dead calm scoring exactly 5; post-sunrise Index B overriding a sub-threshold Index A; insufficient history carrying live conditions.
    - Purity: identical output for identical input, input never mutated, order-independent, constants injectable.
  - [x] 3.5 `__tests__/fog-solar.test.ts` — 16 tests against known geometry (equinox, both solstices at Greenwich, local midnight, noon symmetry, the 4-minutes-per-degree longitude shift)
  - [x] 3.6 `__tests__/fog-rainfall.test.ts` — 13 tests including the midnight reset landing at 16:00 UTC for a UTC+8 station

- [x] 4. API and scheduling
  - [x] 4.1 `lib/supabaseRoute.ts` — RLS-scoped route client + `authenticate()`. _Requirements: 11.3_
  - [x] 4.2 `lib/weather/repository.ts` — all DB access, client injected so service-role and session paths are distinguishable
  - [x] 4.3 `lib/weather/poll.ts` — concurrency 3, per-station isolation, audit opened before work. _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8_
  - [x] 4.4 `POST|GET /api/weather/poll` — Vercel Cron issues GET, the spec calls for POST; both export one handler. _Requirements: 12.1, 12.2, 12.3_
  - [x] 4.5 `GET /api/sites/[id]/weather`
  - [x] 4.6 `GET /api/sites/[id]/fog` — assessment, 24 h series, and the thresholds so the chart shades against the same value the score used
  - [x] 4.7 `GET /api/sites/[id]/rainfall?range=24h|7d` — fills the hour grid itself; the view only emits hours that contain readings. _Requirements: 13.8_
  - [x] 4.8 `POST /api/stations/discover` — returns candidates, never binds. _Requirements: 13.11_
  - [x] 4.9 `POST /api/stations/bind` — **not in the original route list**; §6 requires a binding UI and discover deliberately does not bind. Probes the station before binding.
  - [x] 4.10 `vercel.json` — `*/5 * * * *` cron entry
  - [x] 4.11 `__tests__/fog-poll.test.ts` — 10 tests: concurrency never exceeds 3, a slow station does not stall its neighbours, failures contained, error samples capped, audit opened first, previous state read strictly before the scored instant

- [x] 5. UI (`components/admin/Fog/`)
  - [x] 5.1 Validate the palette before writing chart code
    - `--chart-1` failed the dark lightness band and light contrast. Snapped to `#d2691e`/`#3498db` (light) and `#d95926`/`#3987e5` (dark); all checks pass on the real card surfaces. Tokens appended to `app/globals.css` with the measurements recorded.
  - [x] 5.2 `fogPresentation.ts` — verdict→status mapping, gap-breaking, saturation spans, formatters
  - [x] 5.3 `DataAgeBadge.tsx` — on every view. _Requirements: 13.12_
  - [x] 5.4 `FogStatusCard.tsx` — verdict, meter with thresholds, breakdown, Index B state, gate panel, hysteresis explanation. _Requirements: 13.1, 13.2, 13.3, 13.4_
  - [x] 5.5 `ConvergenceChart.tsx` — one axis, tight domain, numeric time axis, gap breaks, saturation shading, table view. _Requirements: 13.5, 13.6, 13.14_
  - [x] 5.6 `RainfallPanel.tsx` — hourly bars with muted bands over unwatched hours, 7-day totals, table view. _Requirements: 13.7, 13.8, 13.14_
  - [x] 5.7 `ConditionsTile.tsx` — labels pressure as absolute and says dew point is derived from humidity. _Requirements: 13.9, 14.4_
  - [x] 5.8 `StationBinding.tsx` — sensor coverage shown as prominently as distance; flags stations that can never run Index B. _Requirements: 13.10_
  - [x] 5.9 `FogMonitor.tsx`, registered as a tab in the admin shell
    - One filter row above everything it scopes; refetches hold the previous render at reduced opacity; age recomputed client-side. _Requirements: 13.13_
    - **Wiring note:** `components/admin/Radar/Radar.jsx` is a state switch, not a
      router. It keys a hard-coded `components` map by the last segment of each
      `adminMenuItems` path and renders `components[activeComponent]`. A menu
      entry with no matching key renders `undefined` — a tab that opens blank,
      with no 404 and no console error. The first attempt shipped exactly that,
      plus a `WiFog` icon from the `wi` pack, which `IconMapper` does not
      register (it resolves to null silently).
    - A standalone `app/admin/FogMonitor/page.tsx` route was created and then
      removed: no sibling admin feature has one, and it rendered the component
      without the shell's header and navigation.
  - [x] 5.10 `lib/weather/staleness.ts` — the stale threshold, extracted so server and client share one definition
  - [x] 5.11 `__tests__/fog-ui.test.tsx` — 16 tests: gap breaking, shading never spanning a hole, stale said in words, measurable-vs-earned, Index B unavailable, gate keeping the breakdown, held verdict explained, and `0.00` distinguishable from "not measured"

- [x] 6. Specification documents (`requirements.md`, `design.md`, `tasks.md`)

---

## Notes

- Each task references the requirements it satisfies, for traceability.
- Tasks 1.1–1.4 are manual Supabase SQL Editor steps. They have no corresponding
  code change and must be run in numeric order.
- Task 3 (the algorithm) is pure and has no dependency on tasks 1 or 4 — it can
  be developed and fully tested with no database and no network. That is the
  point of keeping it pure.
- Task 1.3 was discovered mid-build, not planned: hysteresis needs prior state,
  and a pure scorer cannot hold it. Anything that needs to persist scorer state
  will surface the same way.
- The `$publicBox` query format was verified against the live endpoint, not
  inferred. See O1 for the three ways the first attempt was wrong.
- ASBSAR1 does not report `dewPoint`, so it is computed from temperature and
  humidity. See task 2.9 — without it, nothing scores.
- Test files are named `fog-*.test.*` so `npx jest __tests__/fog-` runs the
  feature's whole suite.
- `__tests__/fog-ingest.test.ts` and `__tests__/fog-ui.test.tsx` each carry a
  source-scanning architectural test (no client import of `ambient.ts`; no admin
  menu entry without a registered component). Both guard failure modes that
  produce no error at runtime — they simply do the wrong thing quietly.

## Deployment (manual — not code tasks)

- [ ] D1. Run migrations **001 → 004 in order** in the Supabase SQL Editor. All are idempotent and safe to re-run.
  - Migration 002's final block uses `ALTER VIEW … SET (security_invoker = true)`, which needs **Postgres 15+**. On 14, drop those three lines.
- [ ] D2. Enable the `pg_cron` extension (Database → Extensions) if the nightly prune is wanted. Migration 001 prints a notice and continues without it.
- [ ] D3. Set `CRON_SECRET` in **both** `.env.local` and the Vercel project
  environment, to the same value. **The poll returns HTTP 500 without it, by
  design** — this route writes with the service role and makes outbound
  requests. `npm run poll:fog` prints a generated value if the variable is
  missing.
- [ ] D4. Confirm the Vercel plan supports a `*/5` schedule. Hobby is daily-only; minute-level cron needs Pro.
- [ ] D5. Set `latitude` and `longitude` on the East Luwu site row in `public.clients` if not already present — discovery refuses without them.
- [ ] D6. Bind `C8:C9:A3:0F:C7:FD` (ASBSAR1) via `/admin/FogMonitor`. Enter elevation ≈ 950 m manually; the endpoint does not report it.
- [ ] D7. Accumulate history. **Vercel Cron never fires against `npm run dev`**,
  so locally nothing polls unless you run the poller yourself:

  ```
  npm run poll:fog                  # every 5 min against localhost:3000
  npm run poll:fog -- --once        # a single cycle
  npm run poll:fog -- --url https://your-app.vercel.app
  ```

  Leave it running in a terminal. It is unrelated to the browser — readings
  accumulate in Postgres, so refreshing the page, switching tabs, or closing
  the tab entirely changes nothing.

  ASBSAR1 publishes a new observation about every five minutes (measured, not
  assumed), so 8 readings is roughly 40 minutes of wall clock. Polling faster
  does not help: the upsert on `(mac_address, observed_at)` rewrites the same
  row, and the endpoint has no history to backfill from.

  Expect the first score to be heavily capped. Persistence needs 90 minutes,
  the radiative precondition needs 3 hours plus a daytime kt, and the moisture
  reservoir needs 24 hours — the status card reports this as "N of 100
  measurable" rather than pretending the score is complete.

---

## Open items

- [x] O1. **`$publicBox` format and corner order — RESOLVED against the live
  endpoint.** All three assumptions in the first implementation were wrong, and
  each failed differently:
  - **Encoding.** A JSON array in one parameter (`$publicBox=[[a,b],[c,d]]`)
    returns `400 {"name":"BadRequest","message":"Invalid query parameter $publicBox"}`.
    This is a FeathersJS service and wants the bracketed nested form:
    `$publicBox[0][0]`, `$publicBox[0][1]`, `$publicBox[1][0]`, `$publicBox[1][1]`.
  - **Order.** Each corner is `[longitude, latitude]`. The reverse returns
    `500 {"message":"Longitude/latitude is out of bounds, lng: -2.8652 lat: 121.158"}`,
    which is also what proves element 0 is read as longitude.
  - **Envelope.** The device search answers `{ "data": [ … ] }`, not a bare
    array — unlike `/devices/{mac}`, which answers the object directly. Parsing
    it as an array returned zero candidates on a perfectly good 200, which is
    indistinguishable from "no stations nearby".

  The two-ordering fallback is deleted; discovery is one request. Pinned by
  `__tests__/fog-discovery.test.ts`.

- [ ] O2. **The charts have not been visually inspected.** The colour is validated
  computationally and the behaviour is under test, but label collisions, tick
  crowding at 168 hourly bars, and whether the saturation bands read correctly
  against the lines are unverified — they need migrations applied and a poll cycle
  before anything renders, and there is no browser automation in this project.
  **To close:** after D7, open `/admin/FogMonitor` and do a layout pass.

- [ ] O3. **The rainfall rule exists twice** — `weather_rain_hourly` (SQL,
  production) and `lib/weather/rainfall.ts` (TypeScript, test oracle). Both files
  cross-reference each other, which is the only current defence against drift.
  **To close:** an integration test against a scratch Supabase project asserting
  the view and the oracle agree on a fixture.

- [ ] O4. **Calibration.** Every threshold is a literature default from largely
  coastal-advection sources; this station is highland radiation fog at ~950 m.
  `fog_assessments` retains the constants each row was scored under so history can
  be re-scored without re-fetching. Start with the calm-wind AMBIGUOUS branch —
  valley air goes calm overnight, so it will fire often.
  **Note the ordering constraint:** readings prune at 90 days, assessments never. A
  campaign spanning a wet season needs `weather_readings` archived before the
  window closes.

---

## Task Dependency Graph

Waves are ordered by what must exist before a task can be verified, not by what
must exist before it can be written. Wave 0 has no prerequisites at all: the
algorithm (3.1–3.2) is pure, so it is fully testable before any table exists.

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "2.3", "2.7", "3.1"] },
    { "id": 1, "tasks": ["2.4", "3.2", "3.3", "5.1"] },
    { "id": 2, "tasks": ["1.3", "2.5", "2.8", "3.4", "3.5", "3.6", "5.2"] },
    { "id": 3, "tasks": ["1.4", "2.6", "4.1", "4.2", "5.3", "5.10"] },
    { "id": 4, "tasks": ["4.3", "5.4", "5.5", "5.6", "5.7"] },
    { "id": 5, "tasks": ["4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "5.8"] },
    { "id": 6, "tasks": ["5.9", "5.11", "6"] }
  ]
}
```

Critical path: `3.1 → 3.2 → 3.4` (the algorithm and its tests) and
`1.1 → 1.3 → 4.2 → 4.3 → 4.4` (schema through poll). Everything in wave 5's
route group is independent of everything else in that wave and could be built
in parallel.

Task 5.9 sits last because it wires the feature into
`components/admin/Radar/Radar.jsx`, which cannot be verified until the
components it registers exist.
