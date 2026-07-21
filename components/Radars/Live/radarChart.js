const SCORE_MAP = {
  "Optimal": 5,
  "Acceptable": 3,
  "Sub-Optimal": 2,
  "Critical": 1,
  "N/A": 0
};

/**
 * Axis key from a DB parameter name: "System Health" -> "SystemHealth".
 * RadarMetricChart's PARAMETER_LABELS maps these back to display labels.
 */
const axisKey = (name) => String(name || "").replace(/\s+/g, "");

/**
 * Build the spider-chart series from a record's ACTUAL level-1 parameters.
 *
 * Which parameters apply is a property of the radar model and lives in the
 * database: a sensor is seeded (see config/radarParameterSets.ts) with
 * dqp_values rows only for the parameters that apply to it, so an SSR...XT
 * simply has no "Visual Data" row and an MSR has no "Photograph"/"Masks" rows.
 * Reading the axes off the record therefore needs no per-model rules here —
 * add a radar family to radarParameterSets.ts and this chart follows.
 *
 * Only entries created from a real level-1 dqp_values row become axes.
 * pivotParameterTree also emits placeholder level-1 entries (see the keying
 * note in utils/buildRadarRecord.js) which hold children but no value; those
 * are keyed by a name that differs from the entry's own `name` — spaces
 * stripped, or "Parent_<id>" when the parent row is missing entirely — which
 * is what the `key === p.name` test filters out.
 *
 * Axes are ordered by parameter id, i.e. the order the parameters table
 * defines, so every radar draws its axes in the same rotation.
 */
export function buildRadarData(record) {
  const parameters = record?.parameters || {};

  return Object.entries(parameters)
    .filter(([key, p]) => p && p.level === 1 && key === p.name)
    .sort(([, a], [, b]) => (a.id ?? 0) - (b.id ?? 0))
    .map(([, p]) => {
      const status = (p.value || "").trim();

      return {
        subject: axisKey(p.name),
        score: SCORE_MAP[status] ?? 0,
        fullMark: 5,
        status
      };
    });
}