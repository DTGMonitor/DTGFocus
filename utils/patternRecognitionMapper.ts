/**
 * utils/patternRecognitionMapper.ts
 *
 * Pure auto-fill mapper for the Pattern Recognition Integration feature.
 * Maps VCP analysis results to AddDeformationForm initialValues.
 *
 * Requirements: 8.1, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13
 */


// ---------------------------------------------------------------------------
// Type definitions (matching the API response shape)
// ---------------------------------------------------------------------------

export interface WindowResult {
  phase: string;
  start: string; // ISO 8601
  end: string; // ISO 8601
  duration: string; // "Xd Yh Zm"
}

export interface StageSummaryRow {
  VCP: string;
  Stage: string;
  Start: string;
  End: string;
  Duration: string;
  "Deformation min (mm)": number | null;
  "Deformation max (mm)": number | null;
  "Deformation Δ (mm)": number | null;
  "Velocity min (mm/day)": number | null;
  "Velocity max (mm/day)": number | null;
  "Velocity Δ (mm/day)": number | null;
  "Inv. Velocity min (day/mm)": number | null;
  "Inv. Velocity max (day/mm)": number | null;
  "Inv. Velocity Δ (day/mm)": number | null;
}

export interface VCPResult {
  vcpName: string;
  smoothingWindow: number;
  windows: WindowResult[];
  onsetOfFailure: string | null; // ISO 8601 string
  fukuzono: {
    predictedFailureTime: string | null;
    r2: number | null;
    lowR2Warning: boolean;
  } | null;
  slo: {
    predictedFailureTime: string | null;
  } | null;
  stageSummaryRows: StageSummaryRow[];
  combinedChartJson: object;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maps the final phase label of the Longest VCP to the form's `Type` field.
 * Exported for use in tests (Requirement 8.4).
 */
export const PHASE_TO_TYPE_MAP: Record<string, string> = {
  "Progressive Failure": "Progressive",
  Linear: "Linear",
  Regressive: "Regressive",
  "No Significant Movement": "Linear",
  Unclassified: "Linear",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Round a number to `decimals` decimal places.
 * Uses the multiply-round-divide pattern to avoid floating-point drift.
 */
function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Velocity display-unit multiplier for a VCP, derived from its smoothing window
 * (minutes). The form interprets VCP < 1440 as mm/h and ≥ 1440 as mm/day, so we
 * fill values in that native unit — no forced mm/day conversion (issue 4).
 */
function velocityUnitFactor(smoothingWindow: number): number {
  return smoothingWindow < 1440 ? 1 / 24 : 1;
}

// ---------------------------------------------------------------------------
// Step 1 — Select the VCP that fills the form (issue 4)
// ---------------------------------------------------------------------------

/**
 * Select the VCP whose values fill the form:
 *   - exactly one VCP  → that VCP
 *   - more than one    → the one with the SHORTEST smoothing window
 *
 * Exported for use in tests.
 */
export function selectFormVcp(vcpResults: VCPResult[]): VCPResult {
  if (vcpResults.length === 0) {
    throw new Error("vcpResults must not be empty");
  }
  if (vcpResults.length === 1) return vcpResults[0];
  return vcpResults.reduce((best, current) =>
    current.smoothingWindow < best.smoothingWindow ? current : best
  );
}

/** The VCP with the LONGEST smoothing window (or the single VCP). */
export function selectLongestVcp(vcpResults: VCPResult[]): VCPResult {
  if (vcpResults.length === 0) {
    throw new Error("vcpResults must not be empty");
  }
  return vcpResults.reduce((best, current) =>
    current.smoothingWindow > best.smoothingWindow ? current : best
  );
}

/**
 * Format a pipeline timestamp for a datetime-local input WITHOUT timezone
 * conversion. The pipeline emits tz-naive ISO strings (local wall-clock), so we
 * use them directly — converting through the client timezone would shift the
 * value by the UTC offset (issue: forecast result was off by -8h).
 */
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return String(iso).replace("Z", "").slice(0, 16);
}

// ---------------------------------------------------------------------------
// Step 3 — Extract PF stage statistics
// ---------------------------------------------------------------------------

interface PFStats {
  pfVmax: number | null;
  pfVmin: number | null;
  pfDeltaDeformation: number | null;
}

/**
 * From the PF stageSummaryRows of a VCP, find the row with the highest
 * "Velocity max (mm/day)" and return its Vmax, Vmin and Δ deformation.
 */
function extractPFStats(vcp: VCPResult): PFStats {
  const pfRows = vcp.stageSummaryRows.filter((r) =>
    r.Stage.startsWith("Progressive Failure")
  );

  if (pfRows.length === 0) {
    return { pfVmax: null, pfVmin: null, pfDeltaDeformation: null };
  }

  // Find the row with the highest Velocity max
  const bestRow = pfRows.reduce((best, row) => {
    const rowVmax = row["Velocity max (mm/day)"] ?? -Infinity;
    const bestVmax = best["Velocity max (mm/day)"] ?? -Infinity;
    return rowVmax > bestVmax ? row : best;
  });

  return {
    pfVmax: bestRow["Velocity max (mm/day)"] ?? null,
    pfVmin: bestRow["Velocity min (mm/day)"] ?? null,
    pfDeltaDeformation: bestRow["Deformation Δ (mm)"] ?? null,
  };
}

/**
 * Build the per-VCP dual-form fields (VCP/Vmax/ForecastResult) in that VCP's
 * native velocity unit. Returns null when the VCP has no PF stage.
 */
function dualFieldsFor(vcp: VCPResult): {
  vcp: string;
  vmax: string;
  forecast: string;
} | null {
  const { pfVmax } = extractPFStats(vcp);
  if (pfVmax === null) return null;
  const vFac = velocityUnitFactor(vcp.smoothingWindow);
  const forecastIso =
    vcp.fukuzono?.predictedFailureTime ?? vcp.slo?.predictedFailureTime ?? null;
  return {
    vcp: String(vcp.smoothingWindow),
    vmax: String(round(pfVmax * vFac, 4)),
    forecast: isoToLocalInput(forecastIso),
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * buildAutoFillInitialValues
 *
 * Maps pattern-recognition VCP results to AddDeformationForm initialValues.
 * Pure function — no side effects.
 *
 * @param vcpResults            Array of VCPResult from the analysis API
 * @param precursorInitialValues initialValues derived from the precursor record
 * @param timezone              Client timezone string (e.g. "Australia/Perth")
 * @returns Record<string, any> ready to pass as initialValues to AddDeformationForm
 */
export function buildAutoFillInitialValues(
  vcpResults: VCPResult[],
  precursorInitialValues: Record<string, any> | undefined,
  timezone: string
): Record<string, any> {
  if (!vcpResults || vcpResults.length === 0) {
    return {
      ...(precursorInitialValues ?? {}),
    };
  }

  // Step 1 — Select the VCP that fills the form (single, or shortest window)
  const selected = selectFormVcp(vcpResults);

  // Velocity values are stored internally in mm/day; convert to the VCP's
  // native form unit (mm/h when window < 1440) so no conversion is needed in
  // the form (issue 4).
  const vFac = velocityUnitFactor(selected.smoothingWindow);

  // Step 2 — Determine Type from the final window's phase
  const finalWindow =
    selected.windows.length > 0
      ? selected.windows[selected.windows.length - 1]
      : null;
  const finalPhase = finalWindow?.phase ?? "Unclassified";
  const mappedType = PHASE_TO_TYPE_MAP[finalPhase] ?? "Linear";

  // Step 3 — Extract PF stage stats (mm/day)
  const { pfVmax, pfVmin } = extractPFStats(selected);

  // Determine whether a PF stage actually exists
  const hasPFStage = pfVmax !== null;

  // Step 4 — Build single-VCP values (Progressive / Linear forms)
  const mapped: Record<string, any> = {
    Type: hasPFStage ? mappedType : "Linear",
    // Start / forecast times are tz-naive wall-clock — used directly (no
    // timezone conversion, which previously shifted them by the UTC offset).
    Start: isoToLocalInput(selected.onsetOfFailure),
    VCP: String(selected.smoothingWindow),
  };

  if (hasPFStage) {
    // Velocity in the VCP's native unit (Req 8.7, 8.8 / issue 4)
    const vmaxDisp = pfVmax! * vFac;
    mapped.Vmax = String(round(vmaxDisp, 4));
    mapped.Vmin = pfVmin !== null ? String(round(pfVmin * vFac, 4)) : "";
    // InverseVelocity1 = round(1 / Vmax, 4) in the matching inverse unit.
    mapped.InverseVelocity1 =
      vmaxDisp !== 0 ? String(round(1 / vmaxDisp, 4)) : "";
  } else {
    // No PF stage — leave velocity fields as empty strings (Req 8.12)
    mapped.Vmax = "";
    mapped.Vmin = "";
    mapped.AverageVelocity = "";
    mapped.InverseVelocity1 = "";
  }

  // AverageVelocity for Linear type (Req 8.9), in the native unit
  const effectiveType = mapped.Type as string;
  if (effectiveType === "Linear") {
    const linearRows = selected.stageSummaryRows.filter((r) =>
      r.Stage.startsWith("Linear")
    );
    if (linearRows.length > 0) {
      const linearVmax = Math.max(
        ...linearRows.map((r) => r["Velocity max (mm/day)"] ?? -Infinity)
      );
      mapped.AverageVelocity =
        linearVmax !== -Infinity ? String(round(linearVmax * vFac, 4)) : "";
    } else {
      mapped.AverageVelocity = "";
    }
  }

  // ── Dual-VCP fields (Failure / Forecast forms) ───────────────────────────
  // Field "1" = SHORTEST VCP, field "2" = LONGEST VCP (matches the form's
  // SHORT/LONG email labels). When only one VCP is present, only field 1 is
  // filled. Vmax1/Vmax2 are in each VCP's native unit; the form derives
  // InverseVelocity1/2 from them automatically. MaximumDeformation (Δ
  // deformation) comes from the LONGEST VCP.
  const shortest = selectFormVcp(vcpResults);
  const longest = selectLongestVcp(vcpResults);

  const shortFields = dualFieldsFor(shortest);
  if (shortFields) {
    mapped.VCP1 = shortFields.vcp;
    mapped.Vmax1 = shortFields.vmax;
    if (shortFields.forecast) mapped.ForecastResult1 = shortFields.forecast;
  }

  if (vcpResults.length > 1) {
    const longFields = dualFieldsFor(longest);
    if (longFields) {
      mapped.VCP2 = longFields.vcp;
      mapped.Vmax2 = longFields.vmax;
      if (longFields.forecast) mapped.ForecastResult2 = longFields.forecast;
    }
  }

  // MaximumDeformation = Δ deformation of the longest VCP's PF stage.
  const longestPf = extractPFStats(longest);
  if (longestPf.pfDeltaDeformation !== null) {
    mapped.MaximumDeformation = String(round(longestPf.pfDeltaDeformation, 3));
  }

  // Step 5 — Merge with precursor (Req 8.13)
  // Location and alarmRegions from precursor always take precedence
  return {
    ...mapped,
    Location: precursorInitialValues?.Location ?? mapped.Location ?? "",
    alarmRegions: precursorInitialValues?.alarmRegions ?? [],
    ...(precursorInitialValues?.WallFolderID !== undefined
      ? { WallFolderID: precursorInitialValues.WallFolderID }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Summary builder for def_records.properties storage (Requirement 9.2)
// ---------------------------------------------------------------------------

/**
 * buildPatternRecognitionSummary
 *
 * Builds the `pattern_recognition_summary` object for storage in
 * `def_records.properties` JSONB column.
 *
 * @param vcpResults  Array of VCPResult from the analysis API
 * @returns Plain JSON-serialisable object matching the schema in Requirement 9.2
 */
export function buildPatternRecognitionSummary(vcpResults: VCPResult[]): object {
  const vcps = vcpResults.map((vcp) => ({
    name: vcp.vcpName,
    windows: vcp.windows.map((w) => ({
      phase: w.phase,
      start: w.start,
      end: w.end,
    })),
    onset_of_failure: vcp.onsetOfFailure,
  }));

  const fukuzono = vcpResults
    .filter((vcp) => vcp.fukuzono !== null)
    .map((vcp) => ({
      vcp_name: vcp.vcpName,
      predicted_failure_time: vcp.fukuzono!.predictedFailureTime,
      r2: vcp.fukuzono!.r2,
    }));

  const slo = vcpResults
    .filter((vcp) => vcp.slo !== null)
    .map((vcp) => ({
      vcp_name: vcp.vcpName,
      predicted_failure_time: vcp.slo!.predictedFailureTime,
    }));

  const stage_summary = vcpResults.flatMap((vcp) => vcp.stageSummaryRows);

  return {
    vcps,
    fukuzono,
    slo,
    stage_summary,
  };
}

// ---------------------------------------------------------------------------
// Summary merge into def_records.properties (Requirements 9.4, 9.5)
// ---------------------------------------------------------------------------

/**
 * mergeSummaryIntoProperties
 *
 * Conditionally attach `pattern_recognition_summary` to a `properties` object
 * destined for the `def_records.properties` JSONB column.
 *
 * The summary is added ONLY when it is non-null AND the form has not been
 * manually edited after auto-fill (Requirement 9.4). When omitted, the key is
 * absent entirely — never set to `null`. Existing keys are never overwritten
 * or removed; the merge is purely additive (Requirement 9.5).
 *
 * @param properties      Accumulated dynamic-field properties (mutated in place additively)
 * @param summary         The pattern_recognition_summary object, or null
 * @param hasManualEdits  Whether the user manually edited fields after auto-fill
 * @returns The same `properties` object, for chaining
 */
export function mergeSummaryIntoProperties(
  properties: Record<string, any>,
  summary: object | null | undefined,
  hasManualEdits: boolean
): Record<string, any> {
  if (summary != null && !hasManualEdits) {
    properties.pattern_recognition_summary = summary;
  }
  return properties;
}
