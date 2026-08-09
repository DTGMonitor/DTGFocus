// riskDisplay.ts
//
// How a sensor's overall risk is WORDED and COLOURED.
//
// Every surface used to say the same thing — the highest TARP level across the
// active deformation records — because that is what the email engine stores on
// `def_records.tarp_level`. But a TARP level is a NOTIFICATION decision, and the
// three sites do not notify the same way:
//
//   Telfer         quotes the TARP number for everything, blast and rain included
//   Leonora        quotes it only for the levels that demand a response (3 and 4);
//                  anything below is reported as the deformation type it is
//   Hidden Valley  never quotes a number at all — it names the band colour
//                  ("Red Notification", "Yellow Notification")
//
// A Hidden Valley board reading "TARP 3" is telling the operator something their
// TARP chart does not contain. So the risk LABEL is resolved per site here, and
// every surface (report tile, key findings, checklist board, sensor detail)
// reads it from this one module rather than formatting `tarp_level` itself.
//
// Two things are deliberately kept apart:
//
//   colour  the more severe of the deformation type's band and the record's own
//           TARP level, so it can never under-state what is on screen. At most
//           sites the two agree, because the level is derived FROM the type. At
//           a site whose levels are alarm thresholds they diverge — a linear
//           trend on a red alarm is TARP 4 — and the higher one wins.
//   label   follows the site's notification logic, above.
//
// The TARP badge on an individual record is unaffected: where a record carries a
// TARP level it is still shown, at every site. This module governs the sensor's
// ROLLED-UP risk, not the provenance of each record.

import type { TarpColour } from './tarpDocument';

/**
 * The bands a deformation can be reported in.
 *
 * 'darkred' is NOT a TARP-document band — no chart has a row for it. It is the
 * one deformation the ranking puts ABOVE the red band (Rapid Movement), so it
 * needs a rank and an ink of its own; see RISK_ORDER below.
 */
export type RiskColour = TarpColour | 'darkred';

/**
 * Deformation type → band colour.
 *
 * The ranking, worst first (RISK_ORDER):
 *
 *   darkred  Rapid Movement — the ground is moving now, faster than a trend.
 *            Outranks everything, including a TARP 4.
 *   red      trends that demand an immediate response
 *   orange   trends that are developing
 *   yellow   a trend or event that is understood and bounded (a regressive
 *            trend is decelerating; a blast or rainfall event has a known cause)
 *   grey     Fall of Ground — rock fall, failure, material detachment. Past
 *            tense: the ground has already moved, so there is no trend left to
 *            escalate. Still ranks above green, because something happened.
 *   green    TARP 1 — nothing active.
 */
export const DEF_TYPE_COLOUR: Record<string, RiskColour> = {
    'Rapid Movement': 'darkred',
    Progressive: 'red',
    'Linear Accelerating': 'red',
    Linear: 'orange',
    Regressive: 'yellow',
    'Blast Event': 'yellow',
    'Rainfall Event': 'yellow',
    // Fall of Ground.
    'Rock Fall': 'grey',
    Failure: 'grey',
    'Material Detachment': 'grey',
    // Not in the client wording, but it is a TYPE_MATRIX type and has to land
    // somewhere: a forecast is a prediction about a failure, not a live trend.
    Forecast: 'grey'
};

/**
 * Keyword fallback, most specific first, for values that are not TYPE_MATRIX
 * keys — historical records and free-typed types. Order is load-bearing:
 * 'linear accelerating' must be tested before 'linear' or the accelerating case
 * would be coloured a band too calm.
 */
const COLOUR_KEYWORD_RULES: Array<[string, RiskColour]> = [
    ['rapid movement', 'darkred'],
    ['linear accelerating', 'red'],
    ['progressive', 'red'],
    ['linear', 'orange'],
    ['regressive', 'yellow'],
    ['blast', 'yellow'],
    ['rainfall', 'yellow'],
    ['rock fall', 'grey'],
    ['material detachment', 'grey'],
    ['failure', 'grey'],
    ['forecast', 'grey']
];

/** Band colour of a deformation type, or null when the type is unrecognised. */
export const defTypeColour = (defType?: string | null): RiskColour | null => {
    const key = String(defType ?? '').trim();
    if (!key) return null;
    const exact = DEF_TYPE_COLOUR[key];
    if (exact) return exact;

    const lower = key.toLowerCase();
    for (const [needle, colour] of COLOUR_KEYWORD_RULES) {
        if (lower.includes(needle)) return colour;
    }
    return null;
};

/** 'TARP 4' → 4. 0 for a blank, suppressed or unparseable level. */
export const tarpPriority = (tarpLabel?: string | null): number => {
    const match = String(tarpLabel ?? '').match(/TARP\s*([1-4])\b/i);
    return match ? Number(match[1]) : 0;
};

/** Band colour of a TARP level on its own. */
const TARP_LEVEL_COLOUR: Record<number, RiskColour> = { 4: 'red', 3: 'orange', 2: 'yellow', 1: 'green' };

/**
 * Severity order used to pick which record speaks for the sensor, and to sort
 * any list of records worst-first. One scale, so the board, the timeline, the
 * checklist and the report cannot disagree about what "worst" means.
 *
 * Rapid Movement sits above red rather than inside it: a TARP 4 is a trend that
 * warrants evacuation, a rapid movement is the ground already going. The two
 * must not tie, or a sensor with both would headline whichever was newer.
 */
export const COLOUR_RANK: Record<RiskColour, number> = {
    darkred: 5,
    red: 4,
    orange: 3,
    yellow: 2,
    grey: 1,
    green: 0
};

/** The same ranking as an ordered list, worst first — for legends and pickers. */
export const RISK_ORDER: RiskColour[] = ['darkred', 'red', 'orange', 'yellow', 'grey', 'green'];

/**
 * Is `colour` at or above `floor` on the ranking?
 *
 * Every "does this need attention" test used to read `colour === 'red'`, which
 * was the whole truth while red was the top band and became a silent omission
 * the moment one was added above it — a rapid movement would have dropped out of
 * the attention count. Asking the rank instead means a band added later is
 * inherited by these gates rather than forgotten by them.
 */
export const atLeastBand = (colour: RiskColour | null | undefined, floor: RiskColour): boolean =>
    (COLOUR_RANK[colour as RiskColour] ?? -1) >= COLOUR_RANK[floor];

/**
 * Bands that no TARP chart carries a row for, so they can never be printed as a
 * band NAME — the record names itself instead ("Rapid Movement", "Rock Fall").
 */
const UNNAMED_BANDS = new Set<RiskColour>(['darkred', 'grey']);

export interface RiskRecordLike {
    def_type?: string | null;
    tarp_level?: string | null;
    created_at?: string | null;
    location?: string | null;
}

/**
 * The band a single record sits in — the more severe of what the ground is
 * doing and what the site is being notified at.
 *
 * The two used to be the same fact, because every site derived its level FROM
 * the type: Progressive was TARP 4, Linear was TARP 3, and reading the type
 * alone lost nothing. A site whose levels are alarm thresholds breaks that
 * (see TarpLevelSource in tarpPolicy.ts) — a linear trend on a red alarm is
 * TARP 4 — and colouring by the type alone printed that card orange while its
 * own badge read TARP 4.
 *
 * Taking the higher of the two means the colour can never under-state a record:
 * a red alarm shows red whatever shape the trend is, and a progressive trend
 * stays red even where the site notifies it at a lower level.
 */
export const recordColour = (record: RiskRecordLike): RiskColour => {
    const fromType = defTypeColour(record?.def_type);
    const fromLevel = TARP_LEVEL_COLOUR[tarpPriority(record?.tarp_level)] ?? null;

    if (!fromType) return fromLevel ?? 'grey';
    if (!fromLevel) return fromType;
    return COLOUR_RANK[fromLevel] > COLOUR_RANK[fromType] ? fromLevel : fromType;
};

// ---------------------------------------------------------------------------
// Site notification logic
// ---------------------------------------------------------------------------

/**
 * 'tarp'         DTG standard — the highest TARP level, 'TARP 1' when none.
 * 'tarp-major'   Only TARP 3 and 4 are quoted; below that the deformation type.
 * 'notification' Never quotes a TARP level; names the band colour instead.
 */
export type RiskDisplayMode = 'tarp' | 'tarp-major' | 'notification';

export const DEFAULT_RISK_DISPLAY_MODE: RiskDisplayMode = 'tarp';

/**
 * Keyed by lower-cased site name, mirroring SITE_TARP_POLICY_OVERRIDES in
 * tarpPolicy.ts. This is a presentation choice, not a TARP-document fact — the
 * same document can be worded as a number or as a colour — so it lives here and
 * not on `tarp_documents`. A site absent from the map uses the DTG standard.
 */
export const SITE_RISK_DISPLAY_OVERRIDES: Record<string, RiskDisplayMode> = {
    // Genesis Minerals — quotes a TARP level only when one must be responded to.
    leonora: 'tarp-major',
    // Newmont — names the band colour; the chart carries no TARP numbers.
    'hidden valley': 'notification'
};

/** The fields of a sensor row this module reads. */
export interface RiskSensorLike {
    site_name?: string | null;
    /** The view's stored risk — the highest TARP level. */
    risk?: string | null;
    /** Reserved for a future `sites.risk_display` column; overrides the map below. */
    risk_display?: string | null;
    site?: { risk_display?: string | null } | null;
}

export const getRiskDisplayMode = (sensor: RiskSensorLike | null | undefined): RiskDisplayMode => {
    const fromDb = sensor?.risk_display || sensor?.site?.risk_display;
    if (fromDb && (fromDb === 'tarp' || fromDb === 'tarp-major' || fromDb === 'notification')) {
        return fromDb;
    }
    const siteName = String(sensor?.site_name || '').trim().toLowerCase();
    return SITE_RISK_DISPLAY_OVERRIDES[siteName] ?? DEFAULT_RISK_DISPLAY_MODE;
};

/** What every mode falls back to when nothing is active on the sensor. */
export const NO_SIGNIFICANT = 'No Significant';

/** The DTG-standard "nothing active" level. Only 'tarp' mode quotes it. */
export const NO_RISK_TARP = 'TARP 1';

/**
 * Plain-language severity of a band, for the sub-line under a risk value.
 *
 * Grey is 'Event Recorded' rather than 'No Significant': a rock fall is not a
 * severity the reader should skim past, it just is not an escalating trend.
 *
 * Darkred shares red's 'Critical': it outranks red on the scale, but there is no
 * word above critical that a response plan acts on differently. The colour and
 * the event's own name carry the distinction.
 */
const COLOUR_SUBTITLE: Record<RiskColour, string> = {
    darkred: 'Critical',
    red: 'Critical',
    orange: 'Moderate Risk',
    yellow: 'Intermediate Risk',
    grey: 'Event Recorded',
    green: 'No Significant'
};

export interface RiskPresentation {
    /** What to print: 'TARP 4' | 'Regressive' | 'Red Notification' | 'No Significant'. */
    label: string;
    /** Band colour — see `recordColour`. Drives every colour on screen and in print. */
    colour: RiskColour;
    /** Plain-language severity, for the tile sub-line. */
    subtitle: string;
    /** The driving record's own TARP level, '' when it carries none. Drives the TARP badge. */
    tarpLevel: string;
    /** The record the label and colour were read from, null when nothing is active. */
    driver: RiskRecordLike | null;
    mode: RiskDisplayMode;
}

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

/** Most recent first, for tie-breaking between records of equal severity. */
const newer = (a: RiskRecordLike, b: RiskRecordLike) =>
    new Date(b?.created_at ?? 0).getTime() - new Date(a?.created_at ?? 0).getTime();

/** The record that speaks for the sensor on the colour scale. */
const worstByColour = (records: RiskRecordLike[]): RiskRecordLike | null =>
    records.reduce<RiskRecordLike | null>((worst, r) => {
        if (!worst) return r;
        const diff = COLOUR_RANK[recordColour(r)] - COLOUR_RANK[recordColour(worst)];
        if (diff !== 0) return diff > 0 ? r : worst;
        const byTarp = tarpPriority(r.tarp_level) - tarpPriority(worst.tarp_level);
        if (byTarp !== 0) return byTarp > 0 ? r : worst;
        return newer(r, worst) < 0 ? r : worst;
    }, null);

/** The record carrying the highest TARP level, or null when none carries one. */
const worstByTarp = (records: RiskRecordLike[]): RiskRecordLike | null =>
    records.reduce<RiskRecordLike | null>((worst, r) => {
        if (tarpPriority(r.tarp_level) === 0) return worst;
        if (!worst) return r;
        const diff = tarpPriority(r.tarp_level) - tarpPriority(worst.tarp_level);
        if (diff !== 0) return diff > 0 ? r : worst;
        const byColour = COLOUR_RANK[recordColour(r)] - COLOUR_RANK[recordColour(worst)];
        if (byColour !== 0) return byColour > 0 ? r : worst;
        return newer(r, worst) < 0 ? r : worst;
    }, null);

/** The worst band present anywhere in the list. 'green' for an empty list. */
const worstColour = (records: RiskRecordLike[]): RiskColour =>
    records.reduce<RiskColour>((worst, r) => {
        const c = recordColour(r);
        return COLOUR_RANK[c] > COLOUR_RANK[worst] ? c : worst;
    }, 'green');

/**
 * @param floor  The worst band across ALL active records, when the driver was
 *   chosen by something other than the colour scale.
 *
 *   In 'tarp' mode the driver is whichever record carries the highest TARP
 *   LEVEL, and that need not be the worst record on the board: a rapid movement
 *   carries no level at all, so a sensor showing both it and a TARP 4 would take
 *   its colour from the TARP 4 and print red for a darkred situation. Same shape
 *   of error, one band down, for a Progressive TARP 2 sitting beside a
 *   Regressive TARP 3. The floor is what stops the tile under-stating the board.
 */
const present = (
    label: string,
    driver: RiskRecordLike | null,
    mode: RiskDisplayMode,
    floor: RiskColour = 'green'
): RiskPresentation => {
    const own = driver ? recordColour(driver) : 'green';
    const colour = COLOUR_RANK[floor] > COLOUR_RANK[own] ? floor : own;
    return {
        label,
        colour,
        subtitle: COLOUR_SUBTITLE[colour],
        tarpLevel: driver && tarpPriority(driver.tarp_level) > 0 ? String(driver.tarp_level) : '',
        driver,
        mode
    };
};

/**
 * Roll a sensor's ACTIVE deformation records up into the one risk line its site
 * expects to read.
 *
 * @param records  active def_records rows ({def_type, tarp_level, created_at})
 * @param sensorOrMode  a sensor row (site_name is read from it) or a mode directly
 */
export function resolveRiskPresentation(
    records: RiskRecordLike[] | null | undefined,
    sensorOrMode: RiskSensorLike | RiskDisplayMode | null | undefined
): RiskPresentation {
    const mode: RiskDisplayMode =
        typeof sensorOrMode === 'string' ? sensorOrMode : getRiskDisplayMode(sensorOrMode);

    const active = (records ?? []).filter(Boolean);

    if (mode === 'notification') {
        const driver = worstByColour(active);
        if (!driver) return present(NO_SIGNIFICANT, null, mode);
        const colour = recordColour(driver);
        // The band name alone — "Orange", not "Orange Notification". The tile it
        // sits in is already labelled Risk, and the longer form crowded the
        // checklist column. Grey and darkred have no band on the chart, so those
        // events name themselves ("Rapid Movement", "Rock Fall").
        const label = UNNAMED_BANDS.has(colour)
            ? String(driver.def_type || NO_SIGNIFICANT)
            : titleCase(colour);
        return present(label, driver, mode);
    }

    const floor = worstColour(active);

    if (mode === 'tarp-major') {
        const byTarp = worstByTarp(active);
        // Only a level that demands a response is quoted as one — unless
        // something outranks the whole TARP scale, which no level can express.
        if (byTarp && tarpPriority(byTarp.tarp_level) >= 3 && floor !== 'darkred') {
            return present(String(byTarp.tarp_level), byTarp, mode, floor);
        }
        const driver = worstByColour(active);
        if (!driver) return present(NO_SIGNIFICANT, null, mode);
        return present(String(driver.def_type || NO_SIGNIFICANT), driver, mode);
    }

    // 'tarp' — the DTG standard.
    // A rapid movement sits ABOVE the TARP scale, so there is no level that
    // states it: quoting the highest one on the sensor would headline "TARP 4"
    // — or, with nothing else active, "TARP 1" — for the worst thing on the
    // board. It is the one case where even a tarp-mode site names the event.
    if (floor === 'darkred') {
        const driver = worstByColour(active);
        return present(String(driver?.def_type || NO_SIGNIFICANT), driver, mode, floor);
    }

    const byTarp = worstByTarp(active);
    if (byTarp) return present(String(byTarp.tarp_level), byTarp, mode, floor);
    // Active records that carry no level (a rock fall, a suppressed event) still
    // colour the tile, but the level itself is the no-risk baseline.
    const driver = worstByColour(active);
    return present(NO_RISK_TARP, driver, mode);
}

/**
 * The badge an INDIVIDUAL record should carry — on a timeline card, in the
 * deformation list.
 *
 * Records keep their `tarp_level` in the database at every site, including the
 * ones that quote no TARP numbers: the level is what derives the email's
 * [CRITICAL] / [MODERATE RISK] bracket, so emptying the column would cost the
 * severity as well as the wording. It must not be PRINTED at those sites
 * though — a Hidden Valley card reading "TARP 3" cites a number their chart
 * does not contain. There the badge names the band instead, exactly as their
 * TARP rows do.
 *
 * Returns '' when there is nothing to badge, and the caller renders no badge.
 */
export const recordBadgeLabel = (
    record: RiskRecordLike,
    sensorOrMode: RiskSensorLike | RiskDisplayMode | null | undefined
): string => {
    const mode: RiskDisplayMode =
        typeof sensorOrMode === 'string' ? sensorOrMode : getRiskDisplayMode(sensorOrMode);

    if (mode !== 'notification') return record?.tarp_level ? String(record.tarp_level) : '';

    // Grey and darkred carry no band on the chart, and the card already names
    // the event.
    const colour = recordColour(record ?? {});
    return UNNAMED_BANDS.has(colour) || colour === 'green' ? '' : titleCase(colour);
};

/**
 * Band colour of an already-resolved risk LABEL.
 *
 * For surfaces that hold a risk string and not the records behind it — the
 * `risk` column on `latest_radar_wall_folders`, a handover row. Reads a TARP
 * level, a band name ("Red Notification") or a deformation type, in that order.
 */
export const labelColour = (label?: string | null): RiskColour => {
    const text = String(label ?? '').trim();
    if (!text) return 'green';

    const level = tarpPriority(text);
    if (level > 0) return TARP_LEVEL_COLOUR[level];

    // RISK_ORDER, not Object.keys: worst-first is the order that makes the
    // prefix test safe as bands are added.
    const lower = text.toLowerCase();
    const band = RISK_ORDER.find((c) => lower.startsWith(c));
    if (band) return band;

    return defTypeColour(text) ?? 'green';
};

/**
 * A presentation built from a bare label, for callers that never had the
 * records. Carries no driver, so it cannot re-word the label — it only supplies
 * the colour and severity that go with what it was handed.
 */
export const presentationFromLabel = (
    label?: string | null,
    mode: RiskDisplayMode = DEFAULT_RISK_DISPLAY_MODE
): RiskPresentation => {
    const text = String(label ?? '').trim() || NO_SIGNIFICANT;
    const colour = labelColour(text);
    return {
        label: text,
        colour,
        subtitle: COLOUR_SUBTITLE[colour],
        tarpLevel: tarpPriority(text) > 0 ? text : '',
        driver: null,
        mode
    };
};

/**
 * What to show for a sensor whose deformation records have not loaded yet.
 *
 * The `risk` column on `latest_radar_wall_folders` is the highest TARP level, so
 * it is only the truth for sites that word their risk that way. Showing it on a
 * Hidden Valley sensor would print a TARP number their chart does not contain,
 * so those sites wait the one fetch out rather than flash a wrong label.
 */
export const pendingPresentation = (sensor: RiskSensorLike | null | undefined): RiskPresentation => {
    const mode = getRiskDisplayMode(sensor);
    if (mode === 'tarp') return presentationFromLabel(sensor?.risk, mode);
    return { label: '—', colour: 'grey', subtitle: '', tarpLevel: '', driver: null, mode };
};

/**
 * The Key Findings sentence for the risk bullet.
 *
 * One template for every mode: "Overall risk is on <label> – <severity>
 * condition." reads correctly whether the label is a TARP level, a band name or
 * a deformation type. Only the empty case needs its own wording.
 */
export const riskSentence = (presentation: RiskPresentation): string =>
    presentation.label === NO_SIGNIFICANT
        ? 'No significant deformation risk recorded for this period.'
        : `Overall risk is on ${presentation.label} – ${presentation.subtitle} condition.`;
