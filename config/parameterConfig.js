import { classifyRadar } from './radarParameterSets';

/**
 * Which statuses each DQP row is allowed to take.
 *
 * Keys are matched against `parameters.name` as it comes out of the database.
 * Several rows have been renamed since this file was written ("Signal Strength
 * (Amplitude)" -> "Signal Quality", "Enhanced Deformation Mask" -> "EDM", ...)
 * and an unmatched key falls through to "all four statuses allowed" in
 * DqpTable, which is how the renamed rows quietly regained checkboxes their
 * source document never offered. Both the current and the historical name are
 * therefore listed, sharing one array so the two can never drift apart.
 */

const OPTIMAL_CRITICAL = ["Optimal", "Critical"];
const OPTIMAL_SUBOPTIMAL = ["Optimal", "Sub-Optimal"];
const OPTIMAL_SUBOPTIMAL_CRITICAL = ["Optimal", "Sub-Optimal", "Critical"];
const OPTIMAL_ACCEPTABLE_CRITICAL = ["Optimal", "Acceptable", "Critical"];
const OPTIMAL_ACCEPTABLE_SUBOPTIMAL = ["Optimal", "Acceptable", "Sub-Optimal"];
const ALL_STATUSES = ["Optimal", "Acceptable", "Sub-Optimal", "Critical"];

export const PARAMETER_CONFIG = {
    "Data Availability": OPTIMAL_CRITICAL,
    "SSR Type & Scan Mode": OPTIMAL_SUBOPTIMAL,
    "Signal Strength (Amplitude)": OPTIMAL_CRITICAL,
    "Signal Quality": OPTIMAL_CRITICAL,
    "Scan Area": OPTIMAL_ACCEPTABLE_CRITICAL,
    "Scan Area Coverage": OPTIMAL_ACCEPTABLE_CRITICAL,
    "Vector Loss": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Coherence": ALL_STATUSES,
    "Image Alignment": OPTIMAL_SUBOPTIMAL_CRITICAL,
    "Camera Alignment": OPTIMAL_SUBOPTIMAL,
    "Photo Quality": OPTIMAL_SUBOPTIMAL_CRITICAL,
    "Sky and Short Range Masks": OPTIMAL_SUBOPTIMAL_CRITICAL,
    "Sky-Short Range": OPTIMAL_SUBOPTIMAL_CRITICAL,
    "Enhanced Deformation Mask": ALL_STATUSES,
    "EDM": ALL_STATUSES,
    // Scored on the Reutech ladder for every radar, which adds an Acceptable
    // band for "functional, but minor optimisation would help".
    "Alarm Settings and Notifications": ALL_STATUSES,
    "Alarm Settings": ALL_STATUSES,
    "Manual/Alarm Masks": ALL_STATUSES,
    "Atmospheric Correction Source": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Correction Source": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Dynamic Stable Reference Areas": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "DSRA": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Stable Reference Area Spread": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "SRA Spread": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Atmospheric Refractivity": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Refractivity": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Atmospheric Correction Graph": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    "Geo-Positioning": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    // SSR default. The DTM is supporting data on an SSR and never carries a
    // Critical band; on PS and Reutech it is load-bearing - see FAMILY_OVERRIDES.
    "3D-DTM": OPTIMAL_ACCEPTABLE_SUBOPTIMAL,
    //MSR
    "MSR System Status": OPTIMAL_SUBOPTIMAL_CRITICAL,
    "Confidence and Coverage": OPTIMAL_ACCEPTABLE_CRITICAL,
    "Data Flags": OPTIMAL_SUBOPTIMAL_CRITICAL,
    "CCTV Availability": OPTIMAL_SUBOPTIMAL,
    "Masks": OPTIMAL_CRITICAL,
    "MSR Atmospheric Correction": OPTIMAL_ACCEPTABLE_CRITICAL
};

/**
 * Rows whose bands depend on the radar, because the same measurement carries
 * different weight per product. Keyed by name, then by radar family.
 */
const FAMILY_OVERRIDES = {
    "3D-DTM": {
        // Reutech scores the DTM on its own three-band ladder, with no Acceptable.
        MSR: OPTIMAL_SUBOPTIMAL_CRITICAL,
        // On PS the DTM is the frame the data is read against, so it can fail
        // critically the way it can on a Reutech.
        PS: ALL_STATUSES,
    },
};

/** The statuses `name` may take on `radarNumber`. Undefined means "unconstrained". */
export function getAllowedStatuses(name, radarNumber) {
    const override = FAMILY_OVERRIDES[name]?.[classifyRadar(radarNumber || '')];
    return override || PARAMETER_CONFIG[name];
}

/** Parent id of the Alarms group, whose rows may be left blank. */
const NA_PARENT_ID = 6;

/** The Reutech Masks row, which the sheet scores at 100% when no mask is needed. */
const NA_PARAMETER_IDS = new Set([36]);

/**
 * Whether a row may be left with every box unticked, which is stored as "N/A".
 * Every other row on N/A means "not assessed yet" and is flagged.
 */
export function canBeNotApplicable(parameter) {
    if (!parameter) return false;
    return parameter.parent_id === NA_PARENT_ID || NA_PARAMETER_IDS.has(parameter.id);
}
