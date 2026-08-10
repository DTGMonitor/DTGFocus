# Requirements Document

## Introduction

The Fog Monitoring feature binds each Site to a nearby public Ambient Weather
Station, polls that station on a schedule, accumulates the readings, and scores
a two-part fog index from the accumulated history.

The constraint that shapes every requirement below: **the data source returns
current conditions only and has no history endpoint.** A reading not captured at
the moment it was published is gone permanently. Everything about the storage,
polling, retention and error handling exists to lose as little as possible.

The bound station for the initial deployment is `C8:C9:A3:0F:C7:FD` (ASBSAR1) at
−2.5034, 121.5176 in East Luwu, South Sulawesi. Its `baromrelin` equals its
`baromabsin` at 26.639 inHg — the owner never applied a sea-level offset, so that
is raw absolute pressure of about 902 hPa, placing the station near 950 m. The
fog regime there is highland radiation and valley fog, not coastal advection.

Scope is **ingest, score, display**. Forecasting, prediction and machine learning
are explicitly out of scope.

---

## Glossary

- **Station**: A public Ambient Weather weather station, identified by MAC address.
- **Site**: An existing row in `public.clients` (`id`, `site_name`, `latitude`, `longitude`, `timezone`).
- **Reading**: One observation from a Station, stored in `weather_readings`.
- **Assessment**: One scoring result, stored in `fog_assessments`.
- **Open Endpoint**: `https://lightning.ambientweather.net`, the undocumented, unversioned API behind the ambientweather.net web app.
- **Index A**: Fog potential, 0–100, valid 24 hours, computed from preconditions.
- **Index B**: Fog confirmation, daytime only, computed from radiation suppression.
- **DPD**: Dew point depression, `temperature − dew point`, in °C.
- **kt**: Clearness index, measured global horizontal irradiance ÷ clear-sky irradiance.
- **Gate**: A hard veto that forces the Index A total to zero.
- **Poll**: One cycle of the scheduled job that fetches every active Station.
- **Verdict**: The published state — one of FOG, FOG_LIKELY, AMBIGUOUS, NOT_FOG, NO_FOG, INSUFFICIENT_HISTORY.

---

## Requirements

### Requirement 1: Data Source Access

**User Story:** As the platform, I want to read public station data without owning
hardware, so that a Site can be monitored without capital expenditure.

#### Acceptance Criteria

1. THE system SHALL read station data from the Open Endpoint and SHALL NOT require an Ambient Weather API key.
2. THE system SHALL call the Open Endpoint only from server-side code (route handlers or server actions). The Open Endpoint sends no CORS headers, so a browser call cannot succeed.
3. WHEN the Open Endpoint returns HTTP 204 or an empty body, THE system SHALL surface a distinct "station not found" error and SHALL NOT attempt to parse the body as JSON.
4. THE system SHALL validate every Open Endpoint response with a schema and SHALL NOT assume any field is present.
5. WHEN a single field fails validation, THE system SHALL drop that field and retain the rest of the record rather than rejecting the whole response.
6. THE system SHALL issue at most one request per Station per Poll.
7. THE system SHALL retry only transient failures (network, timeout, HTTP 5xx, HTTP 429), at most once, and SHALL NOT retry an HTTP 204.

### Requirement 2: Response Parsing

**User Story:** As the platform, I want to extract exactly the real observations
from an untrusted payload, so that a summary block is never mistaken for a
measurement.

#### Acceptance Criteria

1. THE system SHALL treat a dictionary as a measurement record only IF `dateutc` is a number AND `tempf` is a number.
2. WHEN a dictionary is accepted as a measurement record, THE system SHALL NOT recurse into it. The nested `hl` 24-hour summary block also carries a `dateutc` key and would otherwise be captured as a second, bogus record.
3. THE system SHALL apply a strict type test (`typeof === 'number'`), not a numeric coercion, when identifying records.
4. THE system SHALL strip all nested values before persisting, retaining scalars only.
5. THE system SHALL reject a record whose `dateutc` is earlier than 2000-01-01 or more than 24 hours ahead of the Poll instant.

### Requirement 3: Unit Handling

**User Story:** As a developer, I want one conversion boundary, so that no two
parts of the system disagree about what a number means.

#### Acceptance Criteria

1. THE system SHALL convert to SI at ingest and SHALL NOT convert on read.
2. THE system SHALL apply: `T °C = (tempf − 32) × 5/9`; `U km/h = mph × 1.609344`; `P hPa = inHg × 33.86389`; `mm = in × 25.4`.
3. THE system SHALL prefer `windspdmph_avg10m` over `windspeedmph` when both are present.
4. THE system SHALL store rainfall in millimetres and SHALL preserve the imperial originals in the raw payload column.
5. WHEN a measurement is absent, THE system SHALL store null and SHALL NOT substitute zero.
6. THE system SHALL NOT present `baromrelin` as mean sea-level pressure. On a station with no sea-level offset it is absolute pressure.

### Requirement 4: Rainfall Derivation

**User Story:** As an Admin, I want correct hourly and daily rainfall, so that
antecedent moisture can be judged.

#### Acceptance Criteria

1. THE system SHALL treat `hourlyrainin` as an instantaneous RATE in inches per hour and SHALL NOT sum it over time.
2. THE system SHALL derive hourly totals from deltas of `dailyrainin`.
3. WHEN a delta of `dailyrainin` is negative, THE system SHALL treat it as the local-midnight counter reset and SHALL take the end value alone as that step's total.
4. THE system SHALL bucket hours by the **Station's** own timezone (its `tz` field), not by UTC and not by the Site's timezone.
5. THE system SHALL derive hourly totals in a SQL view or materialized table, not in React.
6. WHEN an hour has insufficient observation coverage, THE system SHALL report null and SHALL NOT report zero.
7. THE system SHALL treat a step spanning more than 20 minutes as untrusted and SHALL exclude it from both the sum and the coverage total.
8. THE system SHALL require at least 45 of an hour's 60 minutes to be covered before reporting a total.
9. THE system SHALL compute daily totals as the maximum `dailyrainin` observed within the Station's local day.

### Requirement 5: Solar Geometry

**User Story:** As the scoring function, I want solar position at the sensor, so
that the clearness index means something.

#### Acceptance Criteria

1. THE system SHALL compute solar elevation with the NOAA approximation from the reading's UTC timestamp and the **Station's** latitude and longitude, not the Site's.
2. THE system SHALL compute clear-sky global horizontal irradiance with the Haurwitz model: `GHI = 1098 × cosZ × exp(−0.059 / cosZ)`, and SHALL return zero when `cosZ ≤ 0.02`.
3. THE system SHALL compute `kt = solarradiation / GHI_clear` only when `GHI_clear > 20` W/m², and SHALL return null otherwise.
4. THE system SHALL NOT clamp `kt` at 1.0. Cloud-edge enhancement genuinely exceeds the clear-sky model.

### Requirement 6: Index A — Fog Potential

**User Story:** As an Admin, I want a 0–100 score of fog potential, so that I can
judge overnight risk before it materialises.

#### Acceptance Criteria

1. WHEN `rain_rate > 0.2` mm/h, OR `DPD > DPD_SAT`, OR `wind > WIND_VETO`, THE system SHALL force the Index A total to zero and SHALL record which Gates fired.
2. WHEN a Gate fires, THE system SHALL still record each component's earned points, so that a near miss remains visible in the calibration record.
3. THE system SHALL score Saturation as 30 / 20 / 10 points for DPD ≤ 0.3 / ≤ 0.8 / ≤ 1.5 °C.
4. THE system SHALL score Persistence as 15 / 10 / 5 points for an unbroken saturated run of ≥ 90 / ≥ 60 / ≥ 30 minutes, counting backwards from the newest reading and breaking at the first reading above `DPD_SAT`.
5. THE system SHALL score Wind as 20 points for 2–7 km/h, 10 points for 7–11 km/h, and 5 points for either below 2 km/h or 11–15 km/h.
6. THE system SHALL award only 5 points for wind below 2 km/h. Dead calm produces dew, not fog: without mechanical mixing, radiative cooling is not distributed through a layer.
7. THE system SHALL score Thermal Plateau as 20 / 10 points when the air is saturated and `|dT/dt| < 0.2` / `< 0.4` °C/h.
8. THE system SHALL compute `dT/dt` from the newest reading and the newest reading at least 35 minutes older. IF no such reading exists, THEN THE system SHALL score the component zero and SHALL NOT extrapolate.
9. THE system SHALL score Radiative Precondition as 10 points when peak daytime `kt > 0.6` AND `|Δp| over 3 h < 0.5` hPa, and 5 points when only one holds.
10. THE system SHALL compute peak daytime `kt` as the maximum over the last 24 hours among readings with solar elevation above 20°.
11. THE system SHALL score Moisture Reservoir as 5 points when rain fell 6–24 hours ago AND no rain fell in the last hour.
12. THE system SHALL hold all thresholds in a single exported configuration object, so that recalibration requires no change to the scoring logic.

### Requirement 7: Index B — Fog Confirmation

**User Story:** As an Admin, I want daytime confirmation from measured radiation,
so that a prediction can be replaced by an observation.

#### Acceptance Criteria

1. THE system SHALL evaluate Index B only when solar elevation exceeds 8° AND a clearness index is available.
2. WHEN `kt < 0.25` AND `DPD < 0.5` °C, THE system SHALL report FOG CONFIRMED.
3. WHEN `kt < 0.30` AND `DPD > 2.0` °C, THE system SHALL report NOT FOG (low stratus or overcast).
4. WHEN `kt > 0.4` AND a saturation run is active, THE system SHALL report FOG DISSIPATING.
5. THE system SHALL expose whether Index B was available and, when it was not, SHALL distinguish "sun below the elevation threshold" from "station reports no solar radiation".
6. THE system SHALL NOT publish FOG DISSIPATING as a Verdict. It describes a transition and has no slot in the resolution order; it SHALL be surfaced as an annotation.

### Requirement 8: Verdict Resolution

**User Story:** As an Admin, I want one unambiguous verdict, so that the display
is actionable.

#### Acceptance Criteria

1. THE system SHALL resolve the Verdict in this order: (a) any Gate fired → NO_FOG with the gate list as the reason; (b) Index B FOG CONFIRMED → FOG; (c) Index B NOT FOG → NOT_FOG; (d) Index A ≥ 70 → FOG_LIKELY; (e) Index A 45–69 → AMBIGUOUS; (f) otherwise → NO_FOG.
2. WHEN the Verdict is AMBIGUOUS AND wind is below 2 km/h, THE system SHALL append a note that dew is more likely than fog.
3. THE system SHALL NOT change the published Verdict on a single reading. A change SHALL require two consecutive readings that agree.
4. THE system SHALL persist the pre-hysteresis Verdict, so that the damping is reproducible and a re-score is deterministic.
5. WHEN the previous Verdict was INSUFFICIENT_HISTORY, THE system SHALL adopt the new Verdict immediately. There was no established state to protect.

### Requirement 9: Minimum Data

**User Story:** As an Admin, I want the system to refuse to score rather than
guess, so that an early score is not mistaken for a confident one.

#### Acceptance Criteria

1. WHEN fewer than 8 readings exist in the window, THE system SHALL return a typed InsufficientHistory result and SHALL NOT produce a score.
2. THE InsufficientHistory result SHALL carry the current DPD, temperature and dew point, so that live conditions remain displayable.
3. THE system SHALL expose per-component availability, so that the display can distinguish a component that scored low from one that could not yet be measured.
4. THE system SHALL persist InsufficientHistory results. "The poller ran but could not score" and "the poller did not run" are different operational facts.

### Requirement 10: Purity and Testability

**User Story:** As a developer, I want the scoring function to be pure, so that
historical re-scoring under new constants is deterministic.

#### Acceptance Criteria

1. THE scoring function SHALL take readings in and return an assessment out.
2. THE scoring function SHALL NOT fetch, SHALL NOT access the database, and SHALL NOT read the system clock.
3. THE scoring function SHALL accept the evaluation instant as an argument.
4. THE scoring function SHALL NOT mutate or reorder its input array.
5. THE scoring function SHALL produce identical output for identical input regardless of the order in which readings are supplied.

### Requirement 11: Storage

**User Story:** As an Admin, I want the accumulated history preserved, so that
the thresholds can eventually be calibrated against reality.

#### Acceptance Criteria

1. THE system SHALL enforce a unique constraint on `(mac_address, observed_at)` and SHALL upsert on conflict.
2. THE system SHALL index `weather_readings` on `(mac_address, observed_at DESC)`.
3. THE system SHALL permit any authenticated user to read readings and assessments, and SHALL permit writes only by the service role.
4. THE system SHALL prune `weather_readings` older than 90 days.
5. THE system SHALL retain `fog_assessments` indefinitely. It is the calibration record.
6. THE system SHALL store, on each Assessment, the constants it was scored under, so that a re-score under new constants is comparable to the original.
7. THE system SHALL permit at most one active Station per Site.
8. WHEN a Station is bound to a Site that already has one, THE system SHALL perform the change atomically and SHALL NOT leave the Site with no active Station.

### Requirement 12: Polling and Scheduling

**User Story:** As an Admin, I want reliable unattended collection, so that
history accumulates without intervention.

#### Acceptance Criteria

1. THE system SHALL run a poll every 5 minutes.
2. THE poll route SHALL run on the Node.js runtime, not edge.
3. THE poll route SHALL require a shared secret. IF the secret is not configured, THEN the route SHALL refuse to run.
4. THE system SHALL poll at most 3 Stations concurrently.
5. WHEN one Station fails, THE system SHALL continue polling the others.
6. THE system SHALL record each poll cycle: start time, stations attempted, succeeded, failed, and a bounded sample of errors.
7. THE system SHALL open the audit record before any Station is contacted, so that a cycle killed mid-flight still leaves evidence it began.
8. THE system SHALL be idempotent. Running twice within the same minute SHALL NOT duplicate readings or assessments.

### Requirement 13: Display

**User Story:** As an Admin, I want to read the fog state at a glance and know
how much to trust it.

#### Acceptance Criteria

1. THE system SHALL display the Verdict with colour coding, an icon, AND a text label. Colour SHALL NOT be the sole carrier of meaning.
2. THE system SHALL display Index A as a 0–100 meter with its decision thresholds marked.
3. THE system SHALL display the component breakdown as points earned against points available.
4. THE system SHALL display an explicit "Index B unavailable" state when it is night or the Station lacks a pyranometer.
5. THE system SHALL display a 24-hour chart of temperature and dew point on a single axis with the saturation window shaded.
6. THE system SHALL NOT draw a chart line across a polling gap longer than 20 minutes.
7. THE system SHALL display hourly rainfall for the last 24 hours in millimetres and daily totals for 7 days.
8. THE system SHALL render a missing hour as a gap and a dry hour as a zero-height mark, and the two SHALL be visually distinguishable.
9. THE system SHALL display current temperature, dew point, humidity, wind with direction, pressure, solar radiation and UV.
10. THE system SHALL allow an Admin to search Stations near a Site, see distance and available sensors, and bind one.
11. THE system SHALL NOT auto-bind a Station.
12. THE system SHALL display data age on every view, and SHALL mark a reading older than 15 minutes as stale.
13. THE system SHALL recompute displayed data age client-side while a response is held, so that a held page does not keep reporting a stale reading as fresh.
14. THE system SHALL provide a table view for every chart.

### Requirement 14: Non-Goals

1. THE system SHALL NOT forecast or predict fog.
2. THE system SHALL NOT integrate a third-party weather forecast.
3. THE system SHALL NOT apply machine learning.
4. THE system SHALL NOT treat dew point and relative humidity as two independent signals. Ambient computes dew point from temperature and humidity, so they are one measurement.
