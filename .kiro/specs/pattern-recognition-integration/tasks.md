# Implementation Plan: Pattern Recognition Integration

## Overview

Integrate the standalone Python pattern-recognition pipeline into the dtg-focus-vercel Next.js app as an embedded popup triggered from the deformation update flow. The implementation proceeds in dependency order: serialisation utilities and the Python runner first, then the API routes, then the auto-fill mapper, then the React components from leaf to root, and finally the DeformationTab and AddDeformationForm wiring.

## Tasks

- [x] 1. Python runner script and serialisation utilities
  - [x] 1.1 Create `scripts/run_pattern_recognition.py`
    - Read file paths and params JSON from `stdin`
    - Call `preprocessor.preprocess()`, `phase_classifier.classify()`, `failure_predictor.predict_fukuzono()`, `failure_predictor.predict_slo_gradient()`, `visualizer.build_combined_chart()`, `visualizer.build_multi_vcp_chart()`, `visualizer.build_stage_summary()` for each (file × smoothing-window) VCP pair
    - Serialise all `pd.Timestamp` values to ISO 8601 strings via `serialise_timestamp()`
    - Serialise Plotly figures via `fig.to_json()` and embed the parsed object in the output
    - Serialise `pd.Series` objects as `{"x": [...ISO strings...], "y": [...numbers...]}` — no other format permitted
    - Write the complete JSON result to `stdout`; write any unhandled exception message (no stack trace) to `stderr` and exit with code 1
    - _Requirements: 4.2, 11.1, 11.2, 11.3_

  - [x]* 1.2 Write property test for serialisation round-trip (Property 1)
    - **Property 1: Serialisation Round-Trip**
    - Generate arbitrary pipeline output objects with random `pd.Timestamp` values and numeric series; assert that after serialisation and JSON parse, all timestamps are valid ISO 8601 strings and all numerics differ from originals by ≤ 1×10⁻⁹
    - Tag: `// Feature: pattern-recognition-integration, Property 1: serialisation round-trip preserves all values`
    - **Validates: Requirements 11.1, 11.2, 11.4**

- [x] 2. Next.js API route — `/api/pattern-recognition/analyze`
  - [x] 2.1 Create `app/api/pattern-recognition/analyze/route.js`
    - Parse `multipart/form-data` using `request.formData()`; extract `files[]` and all parameter fields listed in the design's API request table
    - Enforce 50 MB per-file limit before spawning Python; return HTTP 400 `{ "error": "..." }` on violation
    - Return HTTP 400 `{ "error": "No files uploaded." }` when `files[]` is empty
    - Return HTTP 400 `{ "error": "Missing required parameter: ..." }` for absent required params
    - Write uploaded files to `os.tmpdir()` with unique names; clean up with `Promise.allSettled` after subprocess completes
    - Spawn `scripts/run_pattern_recognition.py` via `child_process.spawn`; pipe params JSON to `stdin`; collect `stdout` as the result JSON
    - Implement per-VCP 60-second timeout via `Promise.race`; on timeout set `errors: ["Processing timed out after 60 seconds"]` for that VCP and continue others
    - On Python exit code 1, return HTTP 500 `{ "error": "Analysis failed. Please try again." }` (no stack trace)
    - Return HTTP 200 with the parsed JSON result on success
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 11.1, 11.2, 11.3, 11.5, 11.6_

  - [x]* 2.2 Write property test for file size enforcement (Property 2)
    - **Property 2: File Size Enforcement**
    - Generate arbitrary file sizes above and below `AppConfig.max_file_size_bytes` (50 MB); assert HTTP 400 iff `size > 50 * 1024 * 1024`
    - Tag: `// Feature: pattern-recognition-integration, Property 2: file size > 50 MB always returns HTTP 400`
    - **Validates: Requirements 4.6, 11.5**

  - [x]* 2.3 Write property test for API error shape (Property 7)
    - **Property 7: API Error Shape**
    - Generate arbitrary combinations of missing required fields; assert HTTP 400 with non-empty `"error"` string
    - Generate arbitrary Python exception messages; assert HTTP 500 with non-empty `"error"` string containing no Python stack traces, module paths, or internal variable names
    - Tag: `// Feature: pattern-recognition-integration, Property 7: API error responses always have non-empty error field`
    - **Validates: Requirements 11.5, 11.6**

- [x] 3. Next.js API route — `/api/pattern-recognition/classify-manual`
  - [x] 3.1 Create `app/api/pattern-recognition/classify-manual/route.js`
    - Accept JSON body `{ vcpName, smoothingWindow, fileIndex, windows: [{phase, start, end}] }`
    - Validate that `windows` is a non-empty array and each entry has a valid `phase` from `PHASE_LABELS`; return HTTP 400 on validation failure
    - Spawn the Python runner in "classify-manual" mode, passing the stored preprocessed velocity series for the referenced VCP (keyed by `fileIndex` + `smoothingWindow`) and the supplied `windows_spec`
    - Call `classify_from_manual_windows(velocity_smooth, windows_spec)` in the runner; rebuild the combined chart via `build_combined_chart()`; rebuild stage summary via `build_stage_summary()`
    - Return HTTP 200 `{ windows, onsetOfFailure, combinedChartJson, stageSummaryRows }` with all timestamps as ISO 8601 strings
    - _Requirements: 6.3, 6.4, 6.5, 11.1, 11.3_

- [x] 4. Auto-fill mapper
  - [x] 4.1 Create `utils/patternRecognitionMapper.ts`
    - Implement `buildAutoFillInitialValues(vcpResults, precursorInitialValues, timezone)` as a pure function with no side effects
    - Step 1 — select Longest VCP: sum all Progressive Failure window durations per VCP; use peak velocity in PF stage as tiebreaker for equal durations (derive from `stageSummaryRows["Velocity max (mm/day)"]`)
    - Step 2 — determine `Type` via `PHASE_TO_TYPE_MAP` applied to the final window's phase of the Longest VCP
    - Step 3 — extract PF stage stats: `pfVmax`, `pfVmin` from the PF `stageSummaryRows` row with highest `Velocity max`
    - Step 4 — build mapped values: `Type`, `Start` (onset → `isoToDatetimeLocal`), `VCP` (smoothing window), `Vmax`, `Vmin`, `InverseVelocity1` (`round(1/Vmax, 4)` bypassing form auto-compute), `AverageVelocity` (for Linear type), `ForecastResult1`, `ForecastResult2`
    - Step 5 — merge with precursor: `Location` and `alarmRegions` from precursor always take precedence
    - When no PF stage exists: set `Type` to "Linear"; leave `Vmax`, `Vmin`, `AverageVelocity`, `InverseVelocity1` as empty strings
    - Export `PHASE_TO_TYPE_MAP` constant for use in tests
    - _Requirements: 8.1, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13_

  - [x]* 4.2 Write property test for Longest VCP selection (Property 3)
    - **Property 3: Longest VCP Selection**
    - Generate arbitrary arrays of VCP results with random PF window durations and peak velocities; assert the selected Longest VCP has the maximum total PF duration, with peak velocity as tiebreaker
    - Tag: `// Feature: pattern-recognition-integration, Property 3: longest VCP selection is correct for any input set`
    - **Validates: Requirements 8.1**

  - [x]* 4.3 Write property test for auto-fill mapper field mapping (Property 4)
    - **Property 4: Auto-fill Mapper Field Mapping**
    - Generate arbitrary VCP results and precursor `initialValues`; assert all field mapping rules hold simultaneously: `Type`, `Start`, `VCP`, `Vmax`, `Vmin`, `InverseVelocity1 = round(1/Vmax, 4)`, `Location` and `alarmRegions` from precursor
    - Tag: `// Feature: pattern-recognition-integration, Property 4: auto-fill mapper produces correct field values for any VCP results`
    - **Validates: Requirements 8.1, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.13**

- [x] 5. Checkpoint — backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. PatternRecognitionPopup sub-components — file upload
  - [x] 6.1 Create `components/admin/Radar/PatternRecognition/VCPConfigRow.jsx`
    - Render a VCP name prefix text input (pre-filled with filename without extension)
    - Render a smoothing window table: each row is one integer value in minutes (min 2, max 1440); support add/remove rows (up to 10 per file)
    - Display detected data range (ISO 8601 local start/end) and estimated sampling interval in minutes when `parseInfo` is provided
    - Display `parseError` inline when present
    - Accept props: `fileConfig` (VCPFileConfig shape), `onChange(updatedConfig)`, `onRemove()`
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

  - [x] 6.2 Create `components/admin/Radar/PatternRecognition/FileUploadPanel.jsx`
    - Render a file input accepting `.xlsx` and `.xls` files (multiple)
    - On file selection, attempt to parse each file client-side to extract data range, sampling interval, and row count; set `parseError` for files with no usable deformation column (< 4 non-null numeric points)
    - Render one `VCPConfigRow` per successfully parsed file
    - Accept props: `uploadedFiles`, `onFilesChange(updatedFiles)`
    - _Requirements: 2.2, 2.3, 2.5, 2.6_

- [x] 7. PatternRecognitionPopup sub-components — analysis parameters
  - [x] 7.1 Create `components/admin/Radar/PatternRecognition/AnalysisParametersPanel.jsx`
    - Render all parameters from Requirement 3.1 with their default values (smoothing window, IV R² warning, IV tail fraction, IV onset R², long smoothing window, velocity threshold %, acceleration multiplier, minimum segment readings, forecasting toggle)
    - When forecasting toggle is enabled, additionally render Fukuzono enable/disable, SLO enable/disable, SLO rolling window, SLO critical threshold, SLO tail fraction, SLO R² warning threshold (Requirement 3.2)
    - Validate each parameter on change against the ranges in Requirement 3.5; display inline error adjacent to the control; expose `hasErrors` boolean to parent
    - When forecasting toggle is disabled, hide all forecasting-specific controls (Requirement 3.3)
    - Accept props: `params`, `onParamsChange(updatedParams)`, `onValidationChange(hasErrors)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 8. PatternRecognitionPopup sub-components — results display
  - [x] 8.1 Create `components/admin/Radar/PatternRecognition/VCPSummaryTable.jsx`
    - Render one row per VCP: VCP name, onset of failure (ISO 8601 local or "N/A"), Fukuzono predicted time (hidden when forecasting disabled), SLO predicted time (hidden when forecasting disabled), IV R² (2 decimal places or "N/A")
    - Apply `--dtg-brand-orange` at 15% opacity background to the Longest VCP row (identified by `longestVcpName` prop)
    - Display "No Progressive Failure detected across all VCPs" message when no VCP has a PF stage
    - Accept props: `vcpResults`, `longestVcpName`, `forecastingEnabled`
    - _Requirements: 10.3, 10.4, 10.5_

  - [x] 8.2 Create `components/admin/Radar/PatternRecognition/StageSummaryTable.jsx`
    - Render the per-stage statistics table with columns: VCP, Stage, Start, End, Duration, Deformation min/max/Δ (mm), Velocity min/max/Δ (mm/day), Inverse Velocity min/max/Δ (day/mm)
    - Display "N/A" for null/undefined cells
    - Accept props: `stageSummaryRows` (array of `StageSummaryRow`)
    - _Requirements: 5.2_

  - [x] 8.3 Create `components/admin/Radar/PatternRecognition/StageEditor.jsx`
    - Render an editable table with one row per detected phase window: stage label dropdown (options: "No Significant Movement", "Linear", "Progressive Failure", "Regressive", "Unclassified"), start time (read-only ISO 8601 local), end time (read-only ISO 8601 local), duration (read-only `Xd Yh Zm`)
    - Derive and display `onset_of_failure` as the `start_time` of the first "Progressive Failure" row; display "—" when no PF row exists
    - Render "Apply Stage Labels" button (disabled while `isApplyingStages`) and "Reset to Auto" button (disabled while `isResettingStages`)
    - Accept props: `windows`, `autoWindows`, `isApplyingStages`, `isResettingStages`, `onApply(updatedWindows)`, `onReset()`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 8.4 Write property test for stage editor onset derivation (Property 5)
    - **Property 5: Stage Editor Onset Derivation**
    - Generate arbitrary lists of stage windows with random phase labels; assert `onset_of_failure` equals the `start_time` of the first "Progressive Failure" window, or "—" when none exists
    - Tag: `// Feature: pattern-recognition-integration, Property 5: onset_of_failure is start of first PF window or — if none`
    - **Validates: Requirements 6.5**

- [x] 9. PatternRecognitionPopup sub-components — chart rendering and download
  - [x] 9.1 Create `components/admin/Radar/PatternRecognition/ResultsArea.jsx`
    - Render `VCPSelector` (tab strip) when ≥ 2 VCPs are present; update active VCP on selection (Requirement 5.4)
    - Render the per-VCP combined chart using `react-plotly.js` by passing `combinedChartJson` directly to `<Plot data={...} layout={...} />` without client-side transformation (Requirement 5.1)
    - Render the multi-VCP comparison chart when ≥ 2 VCPs are present (Requirement 5.3, 10.1)
    - Render a "Download Chart" button adjacent to each chart; on click invoke `Plotly.downloadImage` with filename `{sanitised_vcp_name}_{YYYY-MM-DD}.png`; display inline error on failure (Requirements 7.1–7.6)
    - Render `VCPSummaryTable`, `StageSummaryTable`, and `StageEditor` for the active VCP
    - Render "Use Results to Fill Form" button; disable when no VCP has a PF stage (Requirement 10.5)
    - Accept props: `vcpResults`, `multiVcpComparisonChartJson`, `forecastingEnabled`, `longestVcpName`, `onApplyStages(vcpIndex, updatedWindows)`, `onResetStages(vcpIndex)`, `isApplyingStages`, `isResettingStages`, `onUseResults()`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.1, 10.2, 10.3, 10.4, 10.5_

- [x] 10. PatternRecognitionPopup — main component
  - [x] 10.1 Create `components/admin/Radar/PatternRecognition/PatternRecognitionPopup.jsx`
    - Render as a full-screen modal overlay using CSS variables `--dtg-bg-card`, `--dtg-text-primary`, `--dtg-border-medium`, `--dtg-text-secondary` (Requirement 2.1)
    - Render PRP header with title and close (×) button; close dismisses without modifying records and without opening `AddDeformationForm` (Requirement 2.7)
    - Compose `FileUploadPanel`, `AnalysisParametersPanel`, "Run Analysis" button with loading indicator, and `ResultsArea`
    - On "Run Analysis" click: validate params (disable button if `hasErrors`), build `FormData` with all file binaries and parameter fields, POST to `/api/pattern-recognition/analyze` with 90-second `AbortController` timeout (Requirement 4.7)
    - While analysing: show loading indicator, disable "Run Analysis" button (Requirement 4.3)
    - On success: populate `vcpResults` state; compute `longestVcpName` via `buildAutoFillInitialValues` helper; show `ResultsArea`
    - On HTTP 4xx: display inline error per affected VCP; on HTTP 5xx or all VCPs failing: display top-level error (Requirement 4.4)
    - On 90-second timeout: abort, display timeout error, re-enable button (Requirement 4.7)
    - On "Apply Stage Labels": POST to `/api/pattern-recognition/classify-manual`; update `vcpResults[activeVcpIndex]` with response; disable "Reset to Auto" during in-flight (Requirement 6.3)
    - On "Reset to Auto": restore `vcpResults[activeVcpIndex]` to the original analysis response; disable "Apply Stage Labels" during reset (Requirement 6.4)
    - On "Use Results to Fill Form": call `buildAutoFillInitialValues(vcpResults, precursorInitialValues, timezone)`; build `pattern_recognition_summary` object; call `onUseResults(autoFillValues, summary)`; unmount (Requirement 8.2, 8.3)
    - Accept props: `isOpen`, `precursor`, `precursorInitialValues`, `timezone`, `onClose`, `onUseResults`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.3, 4.4, 4.7, 5.1–5.6, 6.3, 6.4, 8.2, 8.3, 10.1–10.5_

- [x] 11. Checkpoint — popup components complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. DeformationTab — PR prompt state machine extension
  - [x] 12.1 Modify `components/admin/Radar/Tabs/DeformationTab.jsx`
    - Add state variables: `showPRPrompt`, `showPRP`, `prpAutoFillValues`, `prpSummary`
    - Update `handleUpdateConfirm` to set `showPRPrompt(true)` instead of directly setting `showAddForm(true)`
    - Add `handlePRPromptOpenPRP`: set `showPRPrompt(false)`, set `showPRP(true)`
    - Add `handlePRPromptFillDirectly`: set `showPRPrompt(false)`, set `showAddForm(true)`
    - Add `handlePRPClose`: set `showPRP(false)`, clear `prpAutoFillValues`, clear `pendingPrecursor`
    - Add `handlePRPUseResults(autoFillValues, summary)`: set `prpAutoFillValues`, set `prpSummary`, set `showPRP(false)`, set `showAddForm(true)`
    - Extend `addFormInitialValues` memo to return `prpAutoFillValues` when present (takes precedence over precursor-derived values)
    - Render the PR prompt `ConfirmDialog` with `isOpen={showPRPrompt}`, title "Run Pattern Recognition?", message "Would you like to run Pattern Recognition first to auto-fill the form?", `confirmLabel="Open Pattern Recognition"`, `cancelLabel="Fill Form Directly"`, `onConfirm={handlePRPromptOpenPRP}`, `onCancel={handlePRPromptFillDirectly}` — Escape/backdrop maps to `onCancel` (Requirement 1.5)
    - Render `PatternRecognitionPopup` with `isOpen={showPRP}` and all required props; ensure `AddDeformationForm` is not simultaneously open when PRP is open (Requirement 1.4)
    - Pass `patternRecognitionSummary={prpSummary}` to `AddDeformationForm`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [x] 13. AddDeformationForm — summary storage and manual-edit tracking
  - [x] 13.1 Modify `components/admin/Radar/Deformation/AddDeformationForm.tsx`
    - Add `patternRecognitionSummary?: PRSummary | null` prop to `AddDeformationFormProps`
    - Add `hasManualEdits` ref (initialised to `false`)
    - Wrap `handleChange` to set `hasManualEdits.current = true` on any field change after the form is opened with `initialValues` from auto-fill
    - In `handleSubmit`, include `properties.pattern_recognition_summary = patternRecognitionSummary` only when `patternRecognitionSummary` is non-null and `hasManualEdits.current` is `false`
    - Ensure `pattern_recognition_summary` is merged alongside existing dynamic field keys without overwriting them (Requirement 9.5)
    - When `patternRecognitionSummary` is null or `hasManualEdits` is true, omit the key entirely — do not set it to `null` (Requirement 9.4)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 13.2 Write property test for summary storage integrity (Property 6)
    - **Property 6: Summary Storage Integrity**
    - Generate arbitrary `properties` objects with random keys and values; assert that after merging `pattern_recognition_summary`, all original keys and their values are unchanged
    - Tag: `// Feature: pattern-recognition-integration, Property 6: merging summary preserves all existing properties keys`
    - **Validates: Requirements 9.5**

- [x] 14. Checkpoint — full integration wired
  - Ensure all tests pass, ask the user if questions arise.
  - TypeScript typecheck (`tsc --noEmit`) passes with no errors; the full DeformationTab → PRP → AddDeformationForm flow compiles.
  - Existing jest suite passes (9/9). Installed missing peer dep `@testing-library/dom` (required by `@testing-library/react` v16) to unblock the suite.

- [x] 15. Integration tests
  - [x]* 15.1 Write integration test: analyze API end-to-end
    - Upload a real `.xlsx` fixture file to `/api/pattern-recognition/analyze`; assert response shape matches the design's API response schema; assert `combinedChartJson` contains `template: "plotly_dark"`
    - _Requirements: 4.1, 4.2, 5.5_

  - [x]* 15.2 Write integration test: classify-manual endpoint
    - Call `/api/pattern-recognition/classify-manual` with a known set of manual windows; assert the returned `windows` match the supplied phases and the `onsetOfFailure` equals the start of the first "Progressive Failure" window
    - _Requirements: 6.3, 6.5_

  - [x]* 15.3 Write integration test: summary stored and absent correctly
    - Submit `AddDeformationForm` with `patternRecognitionSummary` and no manual edits; assert `def_records.properties.pattern_recognition_summary` is present with correct shape
    - Submit `AddDeformationForm` filled directly (no summary); assert `pattern_recognition_summary` key is absent from `properties`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
    - NOTE: `AddDeformationForm.handleSubmit` was refactored to delegate the storage decision to the new pure helper `mergeSummaryIntoProperties(properties, summary, hasManualEdits)` in `utils/patternRecognitionMapper.ts` (single source of truth). 15.3 + Property 6 test that helper directly (present-with-summary, absent-when-null, absent-when-edited, never-null) rather than rendering the full form — avoids mocking Supabase/toast/router while covering the exact decision logic.

- [x] 16. Final checkpoint — all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Full suite green: **7 suites / 25 tests pass** (`npx jest`). `npx tsc --noEmit` clean.
  - New tests: serialisation round-trip (P1, real Python), analyze file-size + error-shape (P2/P7), mapper longest-VCP + field-mapping (P3/P4), stage-editor onset (P5), summary-merge integrity (P6) + storage scenarios (15.3), analyze/classify-manual E2E (15.1/15.2, real pipeline).
  - Dev deps added to support the suite: `@testing-library/dom`, `@types/jest`.
  - Minor fix surfaced while testing: `runWithTimeout` in both PR API routes now clears its timeout via `.finally()` so the 60s timer never dangles after the subprocess settles.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` with a minimum of 100 iterations per property
- The Python runner script must be co-located with the existing Python modules in `e:\Lintang\pattern-recognition\` or a path accessible to the Next.js server; adjust the spawn path in the API route accordingly
- `react-plotly.js` is already available in the project — no new JS library is needed
- `AbortController` is a browser built-in; no polyfill required for Next.js 13+
- The `isoToDatetimeLocal` utility already exists in `utils/tabHelpers.js` and must be imported by the mapper

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.1"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "6.1", "7.1"] },
    { "id": 5, "tasks": ["6.2", "8.1", "8.2", "8.3"] },
    { "id": 6, "tasks": ["8.4", "9.1"] },
    { "id": 7, "tasks": ["10.1"] },
    { "id": 8, "tasks": ["12.1"] },
    { "id": 9, "tasks": ["13.1"] },
    { "id": 10, "tasks": ["13.2", "15.1", "15.2", "15.3"] }
  ]
}
```
