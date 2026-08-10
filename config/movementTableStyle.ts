// movementTableStyle.ts
//
// Which SHAPE the Tabulation report's movement table takes.
//
// Two tables answer two different questions, and which one a client is asking
// is a property of the RADAR, not of the site:
//
//   'chain'   One row per active deformation chain. The DTG standard, and what
//             every SSR/MSR wall prints. An area with nothing moving has no
//             active record and therefore no row, so the table is exactly the
//             list of findings the site has to act on — and two chains on one
//             wall stay two rows rather than collapsing to the worst.
//
//   'roster'  One row per registered monitoring point (monitoring_areas),
//             with the active chains merged in. A point sitting at TARP 1 still
//             prints, because on these radars the client reads the table as a
//             checklist of every point and the absence of a row is not evidence
//             the point was checked.
//
// The distinction is NOT cosmetic. Nothing in the system lowers a record back
// to TARP 1 — when a movement ends the analyst archives it (isactive = 'No') —
// so under 'chain' a calm area simply disappears. 'roster' is what lets the
// report say "checked, nothing happening" instead of saying nothing at all.
//
// Resolution order (see `resolveMovementTableStyle`):
//
//   1. radars.movement_table_style, when the sensor row carries it
//   2. RADAR_MOVEMENT_TABLE_OVERRIDES, keyed by radar number
//   3. the radar FAMILY default — PS prints the roster
//   4. 'chain'
//
// Step 3 is what makes a newly commissioned PS radar correct without anyone
// remembering to set a flag, and steps 1-2 are what let a single radar of any
// family be reported either way. Same shape as SITE_RISK_DISPLAY_OVERRIDES in
// config/riskDisplay.ts, which resolves the same kind of per-client choice.

import { classifyRadar, type RadarFamily } from './radarParameterSets';

export type MovementTableStyle = 'chain' | 'roster';

/** What a radar prints when nothing else decides. */
export const DEFAULT_MOVEMENT_TABLE_STYLE: MovementTableStyle = 'chain';

/**
 * Family defaults.
 *
 * Only PS is listed. A PS wall is monitored as a fixed set of points that the
 * client reads in full every day; an SSR/MSR wall is monitored as a scan area
 * on which findings appear and are closed out. Families absent from this map
 * take DEFAULT_MOVEMENT_TABLE_STYLE.
 */
export const FAMILY_MOVEMENT_TABLE_STYLE: Partial<Record<RadarFamily, MovementTableStyle>> = {
    PS: 'roster'
};

/**
 * Per-radar overrides, keyed by lower-cased radar number.
 *
 * For the radar whose client wants the other table than its family prints —
 * an SSR handed to a client who reports per point, or a PS whose client only
 * wants live findings. Empty by design: the family default has been right for
 * every radar so far, and an entry here is a decision someone made about one
 * client that should be visible in one place rather than buried in the DB.
 */
export const RADAR_MOVEMENT_TABLE_OVERRIDES: Record<string, MovementTableStyle> = {};

export const isMovementTableStyle = (value: unknown): value is MovementTableStyle =>
    value === 'chain' || value === 'roster';

/**
 * The style a radar NUMBER implies, before any stored choice is considered.
 *
 * Exported on its own because the Add Sensor modal needs it while the radar is
 * still being typed and has no row anywhere yet — typing "PS2000" should flip
 * the selector to Roster the way it already flips the DQP parameter set.
 */
export const movementTableStyleForRadar = (radarNumber?: string | null): MovementTableStyle => {
    const key = String(radarNumber ?? '').trim().toLowerCase();
    if (!key) return DEFAULT_MOVEMENT_TABLE_STYLE;
    return (
        RADAR_MOVEMENT_TABLE_OVERRIDES[key] ??
        FAMILY_MOVEMENT_TABLE_STYLE[classifyRadar(key)] ??
        DEFAULT_MOVEMENT_TABLE_STYLE
    );
};

/** The fields of a sensor row this module reads. */
export interface MovementStyleSensorLike {
    radar_number?: string | null;
    /**
     * `radars.movement_table_style`. Present only once
     * `latest_radar_wall_folders` exposes the column — until then the family
     * default below carries the feature, which is why this is optional rather
     * than required.
     */
    movement_table_style?: string | null;
}

export const resolveMovementTableStyle = (
    sensor: MovementStyleSensorLike | null | undefined
): MovementTableStyle => {
    const stored = sensor?.movement_table_style;
    if (isMovementTableStyle(stored)) return stored;
    return movementTableStyleForRadar(sensor?.radar_number);
};

/** Does this radar's report need a monitoring-area roster at all? */
export const usesAreaRoster = (sensor: MovementStyleSensorLike | null | undefined): boolean =>
    resolveMovementTableStyle(sensor) === 'roster';

/**
 * The selector in the Add Sensor modal.
 *
 * Worded as what the READER of the report sees, not as the internal key: an
 * operator commissioning a radar knows which table their client expects, and
 * has no reason to know what a "chain head" is.
 */
export const MOVEMENT_TABLE_STYLE_OPTIONS: ReadonlyArray<{
    value: MovementTableStyle;
    label: string;
    hint: string;
}> = [
    {
        value: 'chain',
        label: 'Active movements only',
        hint: 'One row per active deformation. Areas with nothing moving are not listed.'
    },
    {
        value: 'roster',
        label: 'All monitoring points',
        hint: 'One row per registered point, every day. Quiet points print as TARP 1 / No Significant.'
    }
];

export const movementTableStyleLabel = (style: MovementTableStyle): string =>
    MOVEMENT_TABLE_STYLE_OPTIONS.find((o) => o.value === style)?.label ?? style;
