/**
 * Which DQP parameters apply to which radar model, and what a freshly
 * commissioned sensor's dqp_values should look like.
 *
 * The `parameters` table is a 3-level tree:
 *   level 0 - id 1, "Overall"
 *   level 1 - groups (System Health, Scan Area, Photograph, ...), weight is null
 *   level 2 - leaves, each carrying a weight; all leaf weights sum to 1.0
 *
 * Only leaves are scored directly. Parent rows carry the sum of their
 * children's value_numeric, matching what the Postgres rollup trigger
 * produces. Excluded parameters get no row at all.
 */

export type RadarFamily = 'PS' | 'MSR' | 'XT' | 'FX' | 'ALL';

export interface ParameterRow {
  id: number;
  name?: string;
  parent_id: number | null;
  level: number;
  weight: number | null;
}

export interface DqpValueRow {
  dqp_record_id: number;
  parameter_id: number;
  value: string;
  value_numeric: number;
}

/**
 * Parameters that do not apply to each radar family. A group is only listed
 * when every one of its children is listed too (e.g. XT drops "Visual Data"
 * (8) along with its children 27 and 28).
 */
const EXCLUDED_PARAMETER_IDS: Record<RadarFamily, readonly number[]> = {
  // SSR...FX and anything unrecognised (e.g. SSR530Omni) get the full set.
  FX: [],
  ALL: [],
  XT: [8, 15, 27, 28],
  PS: [4, 5, 7, 10, 14, 16, 17, 18, 19, 22, 23, 24, 25, 26],
  MSR: [4, 5, 10, 15, 16, 17, 18, 19, 22, 23, 24, 26, 27],
};

/**
 * Prefix rules win over suffix rules, so an "MSR...XT" would be treated as
 * MSR. Names matching nothing fall back to the full parameter set rather
 * than being rejected.
 */
export function classifyRadar(radarNumber: string): RadarFamily {
  const name = (radarNumber || '').trim();
  if (/^ps/i.test(name)) return 'PS';
  if (/^msr/i.test(name)) return 'MSR';
  if (/xt$/i.test(name)) return 'XT';
  if (/fx$/i.test(name)) return 'FX';
  return 'ALL';
}

export function excludedParameterIds(radarNumber: string): Set<number> {
  return new Set(EXCLUDED_PARAMETER_IDS[classifyRadar(radarNumber)]);
}

/** Human-readable summary for the modal, e.g. "SSR-XT - 24 of 28 parameters". */
export function describeParameterSet(radarNumber: string, total: number): string {
  const family = classifyRadar(radarNumber);
  const dropped = EXCLUDED_PARAMETER_IDS[family].length;
  const label =
    family === 'ALL' ? 'Full set' : family === 'PS' ? 'PS' : family === 'MSR' ? 'MSR' : `SSR-${family}`;
  return `${label} - ${total - dropped} of ${total} parameters`;
}

/**
 * Build the seed dqp_values for a new sensor: every applicable parameter set
 * to "Optimal". Leaves score 1.0 x weight; parents get the sum of the
 * children that survived exclusion.
 */
export function buildInitialDqpValues(
  radarNumber: string,
  parameters: ParameterRow[],
  dqpRecordId: number
): DqpValueRow[] {
  const excluded = excludedParameterIds(radarNumber);
  const included = parameters.filter((p) => !excluded.has(p.id));

  const numericById = new Map<number, number>();

  // Leaves: "Optimal" scores 1.0, so value_numeric is just the weight.
  for (const p of included) {
    if (p.level === 2) numericById.set(p.id, Number(p.weight) || 0);
  }

  // Level 1 groups: sum of their surviving children.
  for (const p of included) {
    if (p.level !== 1) continue;
    const sum = included
      .filter((c) => c.level === 2 && c.parent_id === p.id)
      .reduce((acc, c) => acc + (numericById.get(c.id) ?? 0), 0);
    numericById.set(p.id, sum);
  }

  // Level 0 "Overall": sum of the surviving groups.
  for (const p of included) {
    if (p.level !== 0) continue;
    const sum = included
      .filter((c) => c.level === 1 && c.parent_id === p.id)
      .reduce((acc, c) => acc + (numericById.get(c.id) ?? 0), 0);
    numericById.set(p.id, sum);
  }

  return included.map((p) => ({
    dqp_record_id: dqpRecordId,
    parameter_id: p.id,
    value: 'Optimal',
    // Float noise: 0.06+0.08+0.13+0.04 lands on 0.30000000000000004 otherwise.
    value_numeric: Number((numericById.get(p.id) ?? 0).toFixed(6)),
  }));
}
