# Design Document: Fog Monitoring

## The constraint everything follows from

`https://lightning.ambientweather.net/devices/{mac}` returns **current
conditions only**. There is no history endpoint, no bulk export, no backfill. A
reading not captured at the moment it was published does not exist anywhere
afterwards.

Every structural decision below is downstream of that one fact:

| Decision | Because |
|---|---|
| `weather_readings` is append-only and irreplaceable | A missed minute cannot be recovered |
| The poll opens its audit row before doing any work | A silently dead poller is the failure that matters |
| One station's failure never aborts another's | Each failure costs a permanent gap |
| Ingest keeps records missing dew point | They still carry valid wind, rain and radiation |
| Every write is idempotent | A retry must always be safe |
| `fog_assessments` is never pruned | It is the only record that outlives the readings |

---

## The endpoint, as actually observed

Two shapes, and they are not the same:

| Call | Answers | Record location |
|---|---|---|
| `GET /devices/{mac}` | the device object directly | nested under `lastData` |
| `GET /devices?$publicBox…` | `{ "data": [ … ] }` | `lastData` of each element |

The search envelope is easy to miss: parsing it as a bare array yields zero
candidates on a perfectly good HTTP 200, which is indistinguishable from "no
stations nearby".

`$publicBox` is a FeathersJS query and takes the **bracketed nested form** —
`$publicBox[0][0]`, `$publicBox[0][1]`, `$publicBox[1][0]`, `$publicBox[1][1]`.
A JSON array in one parameter returns `400 BadRequest`. Each corner is
**`[longitude, latitude]`**; the reverse returns `500 Longitude/latitude is out
of bounds`, which is also what proves element 0 is longitude.

---

## Layers

```
                      ┌──────────────────────────────────────────┐
  Vercel Cron ───────▶│ POST/GET /api/weather/poll   CRON_SECRET  │
  every 5 min         └────────────────────┬─────────────────────┘
                                           │
                                  lib/weather/poll.ts
                          (concurrency 3, per-station isolation)
                                           │
       ┌───────────────────────────────────┼───────────────────────────────┐
       ▼                                   ▼                               ▼
  ambient.ts                          derive.ts                      fogIndex.ts
  the only I/O                    record ──▶ SI row                 readings ──▶ verdict
  server-only guard               solar geometry at                 PURE: no clock,
  204 ⇒ not-found                 the station's coords              no db, no fetch
       │                                   │                               │
       └────────────── parse.ts ───────────┘                    config/fogConstants.ts
                       zod + the `hl` trap                        every tunable, injectable
                                           │
                                  repository.ts
                          (takes a client: service role OR session)
                                           │
                    ┌──────────────────────┴───────────────────────┐
                    ▼                                              ▼
        weather_readings  ──▶  weather_rain_hourly           fog_assessments
        90-day retention       weather_rain_daily            kept forever
                               (SQL views, migration 002)    + constants used
                                           │
       ┌───────────────────────────────────┴───────────────────────────────┐
       ▼                        ▼                        ▼                 ▼
  /sites/[id]/weather    /sites/[id]/fog       /sites/[id]/rainfall   /stations/*
       └──────────── RLS via the caller's session ───────┘         admin + service role
                                           │
                                  components/admin/Fog/
```

---

## Trap 1 — the `hl` block

A device response embeds a nested `hl` object: the station's rolling 24-hour
high/low summary. It **also carries a `dateutc` key**, so a naive recursive
search for "objects with a dateutc" finds two records and invents a second,
bogus observation dated identically to the real one.

The `hl` block gives itself away by its value shapes — its `tempf` is an object
`{h, l, c, s, ht, lt}` rather than a bare number.

**Rule (load-bearing, in `lib/weather/parse.ts`):** a dictionary is a
measurement record only if `dateutc` is a number **and** `tempf` is a number.
Once accepted, do not recurse into it — the `hl` block lives *inside* the
record, and descending would find it anyway.

The type test is a strict `typeof === 'number'`, never a coercion. A coercion
would eventually accept some future summary shape and quietly double the record
count.

---

## Trap 2 — `hourlyrainin` is a rate

`hourlyrainin` is the instantaneous rate the station is currently seeing, in
inches per hour. It is **not** an accumulation. Summing it over a window
produces a number that looks plausible and means nothing.

Real hourly totals come from deltas of the daily accumulator:

```
hourly_total(h) = dailyrainin(end of h) − dailyrainin(start of h)
```

with two sub-traps:

**Reset.** `dailyrainin` returns to zero at local midnight in the **station's**
timezone — `Asia/Singapore` (UTC+8) for ASBSAR1, which is neither UTC nor
necessarily the site's zone. A negative delta *is* that reset, and the correct
step is the end value on its own.

**Gaps.** An hour nobody polled is `null`, never `0`. "No rain recorded" and "no
recording" are opposite operational facts.

### Coverage rule

A step spanning more than **20 minutes** is untrusted (three consecutive missed
polls at a five-minute cadence). An hour needs **45 of its 60 minutes** covered
to report a number.

Untrusted steps are excluded from *both* the sum and the coverage total, so the
two stay consistent: an hour containing a long gap loses exactly the coverage
that would have justified reporting the partial total it still holds.

Deltas are taken across the **whole ordered series**, not within hour buckets —
rain falling between the last reading of one hour and the first of the next
belongs to the later hour and would otherwise vanish entirely.

### Known duplication

The rule exists twice: `weather_rain_hourly` (SQL, migration 002 — the
production path) and `lib/weather/rainfall.ts` (TypeScript — the test oracle,
because §7 requires a midnight-reset test and Jest has no Postgres). Both files
cross-reference each other. **If a threshold moves in one, it must move in the
other.** The proper fix is an integration test against a scratch Supabase
project asserting the two agree on a fixture; until then the comments are the
only defence.

---

## Trap 3 — dew point is not an independent signal, and may not arrive at all

Ambient computes `dewPoint` server-side from `tempf` and `humidity`. It is a
derived value, not a second sensor.

**And ASBSAR1 does not send it.** Verified against the live endpoint — the full
`lastData` key set is:

```
stationtype, dateutc, tempf, humidity, windspeedmph, windgustmph, maxdailygust,
winddir, winddir_avg10m, uv, solarradiation, hourlyrainin, eventrainin,
dailyrainin, weeklyrainin, monthlyrainin, yearlyrainin, battrain, baromrelin,
baromabsin, type, created_at, feelsLike, dateutc5, tz, hl
```

No `dewPoint`, and no `windspdmph_avg10m` either. Since DPD is what every gate
and every Index A component keys off, the scorer would have discarded every
reading as unusable and reported INSUFFICIENT_HISTORY forever.

`lib/weather/psychrometrics.ts` reconstructs it with Magnus-Tetens (Alduchov &
Eskridge coefficients), and `derive.ts` prefers the station's own value whenever
one is present. This is not an invented signal — the specification already
states the field is derived from temperature and humidity rather than measured,
so computing it locally preserves exactly the semantics it had.

The missing `windspdmph_avg10m` is handled by the existing fallback to
`windspeedmph`, but it is worth knowing: the 2-7 km/h optimal band was defined
on a ten-minute mean, and an instantaneous sample of that flow crosses the band
edge on gust alone. Expect the wind component to be noisier here than the
thresholds assume, and treat it as a calibration target.

Nothing in the scoring may treat DPD and relative humidity as two corroborating
pieces of evidence. Humidity is carried for display only and is never scored.
The UI says so out loud on the humidity tile, because an operator reading "RH
99%" next to "DPD 0.1 °C" would otherwise reasonably assume two instruments
agreed.

---

## Trap 4 — pressure is absolute, not MSLP

ASBSAR1's `baromrelin` equals its `baromabsin` at 26.639 inHg. The owner never
applied a sea-level offset, so this is raw absolute pressure of about 902 hPa.

The station's own metadata confirms the inference and sharpens it:
`info.coords.elevation` reads **1024.8 m**, not the ~950 m the pressure alone
suggested. Highland radiation fog, as expected.

Only the **3-hour delta** is ever scored, so the missing offset is harmless to
the index. It is *not* safe to display as mean sea-level pressure, where it
would be wrong by about 100 hPa. The conditions tile labels it "station
pressure · absolute, not reduced to sea level".

---

## The scoring function

`lib/weather/fogIndex.ts` is **strictly pure**: readings in, assessment out. No
fetch, no database, no `Date.now()`. The evaluation instant is an argument.

This is not stylistic. The thresholds are uncalibrated literature defaults, so
the feature's whole future is a recalibration campaign that re-scores stored
history under new constants and compares. That is only possible if scoring is
deterministic.

### Constants are injected

Every tunable lives in `config/fogConstants.ts` and is passed into the scorer.
The scorer holds no numbers of its own. Each assessment stores the constants it
was scored under, because a re-score is only comparable if you know what the
original was scored *under*.

### Component availability

Each component reports `available` — whether the data needed to reach its
**maximum** exists:

| Component | Available when |
|---|---|
| Saturation | always (DPD is required to score at all) |
| Persistence | history spans ≥ 90 min |
| Wind | wind is reported |
| Thermal plateau | a reading ≥ 35 min old exists |
| Radiative | both peak daytime kt and Δp/3h are computable |
| Reservoir | history spans ≥ 24 h |

The UI shows "85 earned · 80 of 100 measurable". A card showing 85/100 without
that claims more confidence than the data supports.

### The counterintuitive rule

**Wind below 2 km/h scores 5 points, not more.** Dead calm produces *dew*, not
fog: without mechanical mixing there is nothing to distribute radiative cooling
through a layer deep enough to become fog. Raising this is the single easiest
way to make the index wrong, and there is a test named for it.

### Hysteresis

A published verdict does not change on one reading:

```
published(t) = raw(t)          if raw(t) == published(t−1)
             = raw(t)          if raw(t) == raw(t−1)     ← second agreeing reading
             = published(t−1)  otherwise                 ← held
```

Driven from two stored columns (`verdict`, `raw_verdict`) rather than a rolling
counter, so it stays a pure function of prior state and a re-score is
reproducible. Coming out of `INSUFFICIENT_HISTORY` is never damped — there was
no established state to protect.

### `FOG_DISSIPATING` is not a verdict

Both the written resolution order and the Python prototype's verdict chain
compute it and then fall through to the score-based branches. It is surfaced as
`indexB.signal` and appended to the reason, never published as a verdict.

---

## Divergences from the Python prototype

The written specification was treated as authoritative where the two disagreed.

| Behaviour | `fog_report.py` | Implemented | Why |
|---|---|---|---|
| Moisture reservoir | rain 6–24 h ago | rain 6–24 h ago **and none in the last hour** | The spec's table states the quiet period; rain an hour ago is a wet surface, not a reservoir |
| Wind 11–15 km/h | 0 points | 5 points | The spec's table states it. Only observable in 11–12 km/h, since >12 is vetoed |
| Record missing dew point | dropped at ingest | kept at ingest, filtered at scoring | Ingest is irreplaceable; the record still carries valid wind, rain, radiation |
| `wind_dir` | `winddir` | `winddir_avg10m` preferred | Wind *speed* uses the 10-minute average; pairing it with an instantaneous bearing misdescribes one vector |

---

## Security posture

`middleware.ts` excludes `/api` from its matcher:

```
'/((?!api|_next/static|_next/image|favicon.ico).*)'
```

so **nothing authenticates an API route unless the route does it itself**.

| Route | Client | Authorisation |
|---|---|---|
| `/api/weather/poll` | service role | `CRON_SECRET`, constant-time compare |
| `/api/sites/[id]/*` | caller's session (RLS) | authenticated |
| `/api/stations/discover` | caller's session | admin |
| `/api/stations/bind` | service role | admin, after a live probe |

A read route reaching for `supabaseServer` would be publicly readable data
behind an authentication check that only *looks* present. A missing
`CRON_SECRET` is a hard 500, not an open door — the poll writes with the service
role and makes outbound requests on our behalf.

### Why binding is an RPC

`weather_stations_one_active_per_site` is a **partial** unique index, and
partial unique indexes cannot be declared deferrable — Postgres checks them row
by row. That rules out the obvious one-liner:

```sql
UPDATE weather_stations SET is_active = (mac_address = $1) WHERE site_id = $2;
```

because row order is unspecified: if the new station flips to true before the
old one flips to false, the index rejects the statement.

Deactivate-then-activate from the route means two round trips with a window
where a crash leaves the site with **no** active station — and an unpolled site
loses history permanently. `bind_weather_station()` (migration 004) does both in
one transaction.

---

## Display decisions

**Colour was validated, not chosen.** The project's `--chart-*` tokens failed:
`--chart-1` (#e67e22) sits outside the dark lightness band (OKLCH L 0.696 >
0.67) and falls to 2.85:1 on white. The fog tokens are the same hue families
snapped per mode and validated against the actual card surfaces:

| Mode | Temperature | Dew point | CVD ΔE | Normal ΔE | Contrast |
|---|---|---|---|---|---|
| light (#ffffff) | `#d2691e` | `#3498db` | 25.0 | 28.9 | ≥ 3:1 |
| dark (#2a2a2a) | `#d95926` | `#3987e5` | 26.8 | 31.8 | ≥ 3:1 |

Verdicts wear the reserved **status** scale (good/warning/serious/critical), never
a categorical hue, always with an icon and a label — so a verdict can never be
mistaken for a chart series, and the two sub-3:1 light-mode steps stay legible.

**The convergence chart has one axis and a tight domain.** Both series are °C;
a second scale would invent a gap or close one. A zero-based axis would squash a
0.1 °C separation to nothing — and that separation is the entire question.

**Lines break on gaps over 20 minutes** and saturation shading never spans a
hole. Drawing through a gap asserts we know what the air did.

**Data age recomputes client-side every 30 seconds.** The server stamps an age
when it answers, but the page holds that answer for five minutes; left alone the
badge would insist "1 min ago" while the reading went half an hour stale. That
badge is the only thing standing between an operator and a status card
confidently asserting "no fog" from air measured at midnight.

---

## Calibration path

The thresholds are literature defaults derived largely from coastal advection
regimes. East Luwu is highland radiation and valley fog at ~950 m. Expect all of
them to move.

The schema is built for it: `fog_assessments` stores the full component
breakdown, the gate list, and the constants each row was scored under, so
historical readings can be re-scored under new constants without re-fetching
anything.

**One tension to plan around:** readings prune at 90 days but assessments are
kept forever. A re-score can only run against readings. A recalibration campaign
spanning a wet season needs `weather_readings` archived before the window
closes.

`hysteresis_held` is worth watching: long runs of held verdicts mean a threshold
is sitting on the data's noise floor.

The first thing to look at, once a few weeks of assessments exist, is the
**calm-wind AMBIGUOUS branch**. Valley air goes calm overnight, so that branch
will fire often, and whether "likely dew rather than fog" is actually right
there is the most valuable single thing observation can tell us.
