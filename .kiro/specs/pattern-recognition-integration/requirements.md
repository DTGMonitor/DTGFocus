# Requirements Document

## Introduction

This feature integrates the standalone Python/Streamlit pattern-recognition tool into the dtg-focus-vercel Next.js web application as an embedded popup component. The integration is triggered from the deformation update flow in the `DeformationTab` page. After a user confirms the archive-and-create-new-record step, a new prompt asks whether to run Pattern Recognition first to auto-fill the `AddDeformationForm`. The popup replicates the core UI/UX of the Streamlit app, calls a Next.js API route that spawns the existing Python pipeline, renders Plotly charts, and maps analysis results back into the deformation form fields. All analysis summary data is persisted in the `def_records.properties` JSONB column.

---

## Glossary

- **Pattern Recognition Popup (PRP)**: The React modal/overlay component that embeds the full pattern-recognition workflow inside the Next.js app.
- **VCP (Vertical Control Point)**: A single monitoring point represented by one uploaded Excel file and one velocity smoothing window.
- **Pipeline**: The sequence of Python modules — `preprocessor.py → phase_classifier.py → failure_predictor.py → visualizer.py` — that processes VCP data.
- **Analysis API**: The Next.js API route (`/api/pattern-recognition/analyze`) that receives uploaded files and parameters, spawns the Python pipeline, and returns JSON results.
- **ClassificationResult**: The Python dataclass (defined in `models.py`) that holds phase windows and `onset_of_failure` for a single VCP.
- **PredictionResult**: The Python dataclass that holds `predicted_failure_time`, `r2`, and regression data for Fukuzono or SLO Gradient methods.
- **VCPData**: The Python dataclass aggregating `PreprocessResult`, `ClassificationResult`, `PredictionResult` (Fukuzono), and `PredictionResult` (SLO) for one VCP.
- **Stage Summary**: A per-stage table (VCP × phase window) with min/max/Δ statistics for displacement, velocity, and inverse velocity.
- **Auto-fill**: The process of mapping pattern-recognition results to `AddDeformationForm` `initialValues` fields.
- **TYPE_MATRIX**: The configuration object in `config/formConfig.ts` that maps `def_type` strings to TARP levels and required form fields.
- **def_records**: The Supabase PostgreSQL table that stores deformation records, including a `properties` JSONB column.
- **pattern_recognition_summary**: The key under `def_records.properties` where analysis summary data is stored.
- **Longest VCP**: The VCP whose Progressive Failure phase window has the greatest total duration (sum of all Progressive Failure window durations for that VCP). When two VCPs have equal Progressive Failure duration, the VCP with the higher peak velocity in its Progressive Failure stage is used as the tiebreaker.
- **Onset of Failure**: The `onset_of_failure` timestamp from `ClassificationResult` — the start of the first confirmed Progressive Failure window.
- **DeformationTab**: The React component (`components/admin/Radar/Tabs/DeformationTab.jsx`) that owns the deformation update flow state.
- **AddDeformationForm**: The React component (`components/admin/Radar/Deformation/AddDeformationForm.tsx`) that accepts `initialValues` for pre-filling.
- **ConfirmDialog**: The reusable React dialog component (`components/admin/Radar/shared/ConfirmDialog.jsx`).

---

## Requirements

### Requirement 1: Pattern Recognition Prompt After Update Confirmation

**User Story:** As a site engineer, I want to be asked whether to run Pattern Recognition after confirming the deformation update, so that I can choose to auto-fill the new record form with analysis results instead of filling it manually.

#### Acceptance Criteria

1. WHEN the user confirms the "Update Deformation Record" `ConfirmDialog` in `DeformationTab`, THE `DeformationTab` SHALL display a second confirmation step before opening `AddDeformationForm`.
2. THE second confirmation step SHALL present the message "Would you like to run Pattern Recognition first to auto-fill the form?" with two action options: "Open Pattern Recognition" (primary confirm action) and "Fill Form Directly" (secondary cancel-equivalent action).
3. WHEN the user selects "Fill Form Directly", THE `DeformationTab` SHALL open `AddDeformationForm` immediately with the same `initialValues` as the existing update flow, without opening the Pattern Recognition Popup.
4. WHEN the user selects "Open Pattern Recognition", THE `DeformationTab` SHALL open the Pattern Recognition Popup (the pattern recognition modal/overlay) instead of `AddDeformationForm`, passing the same `precursor` ID and `initialValues` context that would have been passed to `AddDeformationForm`, and THE `DeformationTab` SHALL ensure that `AddDeformationForm` is not simultaneously open.
5. WHEN the user dismisses the second confirmation step (via Escape key or backdrop click), THE `DeformationTab` SHALL treat the action as "Fill Form Directly" and open `AddDeformationForm`.
6. THE second confirmation step SHALL use the same visual styling as the existing `ConfirmDialog` component: CSS variables `--dtg-bg-card` (panel background), `--dtg-text-primary` (title and button text), `--dtg-border-medium` (panel border and cancel button border), `--dtg-text-secondary` (message body text), and `--dtg-bg-secondary` (cancel button hover background).

---

### Requirement 2: Pattern Recognition Popup — File Upload and VCP Configuration

**User Story:** As a site engineer, I want to upload Excel deformation files and configure VCP parameters inside the popup, so that I can run the same analysis workflow I previously used in the standalone Streamlit app.

#### Acceptance Criteria

1. THE Pattern_Recognition_Popup SHALL render as a full-screen modal overlay using CSS variables `--dtg-bg-card` (background), `--dtg-text-primary` (primary text), `--dtg-border-medium` (borders), and `--dtg-text-secondary` (secondary text) to match the SensorDetail page dark theme.
2. THE Pattern_Recognition_Popup SHALL provide a file upload control that accepts one or more `.xlsx` or `.xls` files, with one file representing one physical VCP.
3. WHEN one or more files are uploaded and each file contains at least 4 non-null numeric data points in a parseable deformation column, THE Pattern_Recognition_Popup SHALL display a per-file configuration row containing: a VCP name prefix text input (pre-filled with the filename without extension), and a velocity smoothing window table where each row is one window value in minutes (minimum 2 minutes, maximum 1440 minutes, up to 10 rows per file). Files that do not meet the 4-point threshold SHALL NOT have a configuration row displayed.
4. WHEN the user adds or removes rows in the smoothing window table for a file, THE Pattern_Recognition_Popup SHALL update the count of independent VCP analyses for that file, where each (file × window) pair produces one independent VCP analysis.
5. WHEN a file is uploaded and successfully parsed, THE Pattern_Recognition_Popup SHALL display the detected data range as ISO 8601 local timestamps (start and end) and the estimated sampling interval in minutes (computed as the median time delta between consecutive readings).
6. IF a file upload fails to parse as a valid Excel workbook, THEN THE Pattern_Recognition_Popup SHALL attempt to extract the first column with at least 4 non-null numeric values as the deformation series. IF no such column exists, THEN THE Pattern_Recognition_Popup SHALL display an inline error message for that file (e.g. "No usable deformation column found") and exclude it from analysis without blocking other files.
7. THE Pattern_Recognition_Popup SHALL provide a close (×) button in the header that dismisses the popup without modifying any deformation records and without triggering the `AddDeformationForm`.

---

### Requirement 3: Pattern Recognition Popup — Analysis Parameters Panel

**User Story:** As a site engineer, I want to configure analysis parameters before running the pipeline, so that I can tune the classification and forecasting behaviour for the specific dataset.

#### Acceptance Criteria

1. THE Pattern_Recognition_Popup SHALL display an analysis parameters panel containing the following controls with their default values: smoothing window (readings, default 7), IV Method R² warning threshold (default 0.80), IV tail fraction (default 0.20), IV onset R² threshold (default 0.75), long smoothing window (default 24), velocity threshold % of peak (default 3%), acceleration multiplier (default 2.5), minimum segment readings (default 12), and a forecasting enable/disable toggle (default enabled).
2. WHEN the forecasting toggle is enabled, THE Pattern_Recognition_Popup SHALL additionally display: Fukuzono Inverse Velocity enable/disable (default enabled), SLO Gradient enable/disable (default disabled), SLO rolling window (default 5), SLO critical threshold in mm/day² (default 50.0), SLO tail fraction (default 0.30), and SLO R² warning threshold (default 0.70).
3. WHEN the forecasting toggle is disabled, THE Pattern_Recognition_Popup SHALL hide all forecasting-specific controls and SHALL NOT include forecasting parameters in the next "Run Analysis" request. WHEN the forecasting toggle is enabled, THE Pattern_Recognition_Popup SHALL always include all forecasting parameters in the "Run Analysis" request, using the currently displayed values (or defaults if the user has not explicitly changed them).
4. WHEN the user changes a parameter value, THE Pattern_Recognition_Popup SHALL NOT re-run the pipeline automatically; the pipeline SHALL only re-run when the user explicitly clicks "Run Analysis".
5. WHEN the user enters a parameter value, THE Pattern_Recognition_Popup SHALL validate the value on change against the following ranges: smoothing window ≥ 1; R² warning threshold 0.0–1.0; IV tail fraction 0.01–0.50; IV onset R² threshold 0.50–0.99; long smoothing window 3–200; velocity threshold 1–30 (%); acceleration multiplier 1.0–10.0; minimum segment 2–100; SLO rolling window 3–50; SLO critical threshold 0.1–10000.0; SLO tail fraction 0.01–1.0; SLO R² warning threshold 0.0–1.0. IF a value is outside its valid range, THEN THE Pattern_Recognition_Popup SHALL display an inline validation error adjacent to that control and disable the "Run Analysis" button until all values are within range.

---

### Requirement 4: Pattern Recognition Popup — Run Analysis via Backend API

**User Story:** As a site engineer, I want the popup to call a backend API that runs the Python pipeline, so that the analysis executes server-side using the existing validated Python modules.

#### Acceptance Criteria

1. WHEN the user clicks "Run Analysis" and all parameter values are valid and at least one file is configured, THE Pattern_Recognition_Popup SHALL send a `multipart/form-data` POST request to `/api/pattern-recognition/analyze` containing all uploaded file binaries and the current parameter values as form fields.
2. THE Analysis_API SHALL run the Python pipeline (`preprocessor → phase_classifier → failure_predictor → visualizer`) for each VCP and return a JSON response containing: per-VCP `ClassificationResult` windows, `onset_of_failure`, `PredictionResult` data (Fukuzono and SLO), stage summary table rows, and Plotly figure JSON serialised via `fig.to_json()`.
3. WHILE the analysis is running, THE Pattern_Recognition_Popup SHALL display a loading indicator and disable the "Run Analysis" button. WHEN the response is received, THE Pattern_Recognition_Popup SHALL re-enable the "Run Analysis" button and hide the loading indicator.
4. IF the Analysis API returns an HTTP error status or a pipeline error for a specific VCP, THEN THE Pattern_Recognition_Popup SHALL display the error message inline for that VCP and continue displaying results for any successfully processed VCPs. IF all VCPs fail for any reason (HTTP error, pipeline error, or otherwise), THEN THE Pattern_Recognition_Popup SHALL display a top-level error message and leave the results area empty.
5. THE Analysis_API SHALL complete processing for a single VCP with a dataset of up to 10,000 readings within 60 seconds when the server is not under load from other concurrent requests.
6. IF the uploaded file size exceeds 50 MB (the limit defined in `AppConfig.max_file_size_bytes`), THEN THE Analysis_API SHALL return HTTP 400 with a JSON body containing a non-empty `"error"` string field describing the size violation, without processing the file.
7. THE Pattern_Recognition_Popup SHALL enforce a client-side request timeout of 90 seconds. IF the Analysis API does not respond within 90 seconds, THEN THE Pattern_Recognition_Popup SHALL abort the request, display a timeout error message, and re-enable the "Run Analysis" button.

---

### Requirement 5: Pattern Recognition Popup — Results Display

**User Story:** As a site engineer, I want to see the Plotly charts and stage summary table inside the popup, so that I can review the analysis results before deciding to use them to fill the form.

#### Acceptance Criteria

1. WHEN analysis results are available for a VCP, THE Pattern_Recognition_Popup SHALL render the per-VCP combined chart (displacement / velocity / inverse velocity with phase-coloured bands) by passing the Plotly figure JSON returned by the Analysis API directly to the Plotly rendering library without client-side transformation.
2. THE Pattern_Recognition_Popup SHALL render the per-stage summary table with the following columns: VCP, Stage, Start, End, Duration, Deformation min (mm), Deformation max (mm), Deformation Δ (mm), Velocity min (mm/day), Velocity max (mm/day), Velocity Δ (mm/day), Inverse Velocity min (day/mm), Inverse Velocity max (day/mm), Inverse Velocity Δ (day/mm). Cells with no data SHALL display "N/A".
3. WHERE two or more VCPs have been successfully analysed, THE Pattern_Recognition_Popup SHALL render the multi-VCP comparison chart (three rows: displacement / velocity / inverse velocity, one trace per VCP). WHERE only one VCP is present, THE multi-VCP comparison chart SHALL NOT be rendered.
4. WHERE two or more VCPs are present, THE Pattern_Recognition_Popup SHALL display a VCP selector control (e.g. tab strip or dropdown) immediately when the popup opens, without requiring any additional user interaction. WHEN the user selects a different VCP, THE Pattern_Recognition_Popup SHALL update the displayed combined chart and stage editor to reflect the selected VCP.
5. THE chart rendering SHALL use the `plotly_dark` template (as set in the Plotly figure JSON returned by the API) to match the SensorDetail page dark theme.
6. WHEN `onset_of_failure` is present in the analysis result for the active VCP, THE Pattern_Recognition_Popup SHALL display it as a labelled annotation on the combined chart. WHEN Fukuzono `predicted_failure_time` is present, THE Pattern_Recognition_Popup SHALL display it as a labelled annotation. WHEN SLO `predicted_failure_time` is present, THE Pattern_Recognition_Popup SHALL display it as a labelled annotation. These annotations are embedded in the Plotly figure JSON returned by the API and require no additional client-side rendering logic.

---

### Requirement 6: Pattern Recognition Popup — Stage Editor

**User Story:** As a site engineer, I want to relabel stages and adjust stage boundaries inside the popup, so that I can correct the automatic classification before using the results to fill the form.

#### Acceptance Criteria

1. WHEN analysis results are available for the active VCP, THE Pattern_Recognition_Popup SHALL display an editable stage table below the combined chart with one row per detected phase window, showing: stage label (editable dropdown), start time (read-only, ISO 8601 local format), end time (read-only, ISO 8601 local format), and duration (read-only, formatted as `Xd Yh Zm`).
2. THE stage label dropdown in each row SHALL offer exactly the following options in order: "No Significant Movement", "Linear", "Progressive Failure", "Regressive", "Unclassified".
3. WHEN the user changes one or more stage labels and clicks "Apply Stage Labels", THE Pattern_Recognition_Popup SHALL disable the "Reset to Auto" button while the API request is in-flight, send the revised stage list to the Analysis API using the `classify_from_manual_windows` endpoint, and upon a successful response update the combined chart and stage summary table to reflect the new segmentation. WHEN the user clicks "Reset to Auto", THE Pattern_Recognition_Popup SHALL disable the "Apply Stage Labels" button while the revert operation is in-flight.
4. THE Pattern_Recognition_Popup SHALL display a "Reset to Auto" button. WHEN the user clicks "Reset to Auto", THE Pattern_Recognition_Popup SHALL discard all manual stage edits and revert the stage table, combined chart, and summary table to the automatically detected segmentation from the most recent "Run Analysis" response.
5. WHEN the stage table is updated (either via "Apply Stage Labels" or "Reset to Auto"), THE Pattern_Recognition_Popup SHALL set the displayed `onset_of_failure` to the `start_time` of the first row whose stage label is "Progressive Failure" in the updated segmentation. IF no row has the label "Progressive Failure", THEN `onset_of_failure` SHALL be displayed as "—".

---

### Requirement 7: Pattern Recognition Popup — Export Chart as PNG

**User Story:** As a site engineer, I want to download the Plotly chart as a PNG image, so that I can include it in reports or share it with colleagues.

#### Acceptance Criteria

1. WHEN a Plotly chart is rendered in the Pattern_Recognition_Popup, THE Pattern_Recognition_Popup SHALL display a "Download Chart" button adjacent to that chart. IF no chart is currently rendered, THE "Download Chart" button SHALL NOT be visible.
2. WHEN the user clicks "Download Chart" for a specific chart, THE Pattern_Recognition_Popup SHALL invoke the Plotly `downloadImage` API. WHEN the API call succeeds, THE Pattern_Recognition_Popup SHALL initiate the browser file download of the PNG.
3. IF the Plotly `downloadImage` API call throws a JavaScript error, THEN THE Pattern_Recognition_Popup SHALL display an inline error message (e.g. "Chart download failed. Please try again.") adjacent to the button. IF the API call fails but the browser can generate the PNG through other means, THE download SHALL still proceed.
4. THE exported PNG filename SHALL follow the format `{sanitised_vcp_name}_{YYYY-MM-DD}.png`, where `sanitised_vcp_name` is the VCP name with spaces replaced by underscores and all characters other than alphanumerics, hyphens, and underscores removed, and `YYYY-MM-DD` is the client's local date at the time the button is clicked.
5. THE PNG export SHALL execute entirely in the browser without any server round-trip.
6. WHEN multiple charts are rendered simultaneously (e.g. per-VCP combined chart and multi-VCP comparison chart), each chart SHALL have its own independent "Download Chart" button that exports only that specific chart.

---

### Requirement 8: Auto-fill — Mapping Analysis Results to AddDeformationForm

**User Story:** As a site engineer, I want to click "Use Results to Fill Form" after reviewing the analysis, so that the deformation form is pre-populated with values derived from the pattern-recognition output.

#### Acceptance Criteria

1. THE Auto_Fill_Mapper SHALL define the Longest VCP as the VCP with the greatest total duration of all "Progressive Failure" windows in its classification result. WHERE two VCPs have equal Progressive Failure duration, the VCP with the higher peak velocity in its Progressive Failure stage SHALL be used as the tiebreaker.
2. WHEN the user clicks "Use Results to Fill Form", THE Pattern_Recognition_Popup SHALL close (unmount from the DOM).
3. WHEN the Pattern_Recognition_Popup closes via "Use Results to Fill Form", THE `DeformationTab` SHALL open `AddDeformationForm` with `initialValues` populated by the Auto_Fill_Mapper output.
4. THE Auto_Fill_Mapper SHALL set the `Type` field using the final (last by end time) phase label of the Longest VCP's classification, mapped as: "Progressive Failure" → "Progressive"; "Linear" → "Linear"; "Regressive" → "Regressive"; "No Significant Movement" → "Linear"; "Unclassified" → "Linear".
5. THE Auto_Fill_Mapper SHALL set the `Start` field to the `onset_of_failure` ISO 8601 timestamp of the Longest VCP, converted to the user's client timezone using `isoToDatetimeLocal`.
6. THE Auto_Fill_Mapper SHALL set the `VCP` field (for mapped `Type` values "Progressive", "Linear Accelerating", and "Linear") to the smoothing window in minutes of the Longest VCP.
7. THE Auto_Fill_Mapper SHALL set the `Vmax` field (for mapped `Type` values "Progressive" and "Linear Accelerating") to the "Velocity max (mm/day)" value from the Progressive Failure stage statistics of the Longest VCP.
8. THE Auto_Fill_Mapper SHALL set the `Vmin` field (for mapped `Type` values "Progressive" and "Linear Accelerating") to the "Velocity min (mm/day)" value from the Progressive Failure stage statistics of the Longest VCP.
9. THE Auto_Fill_Mapper SHALL set the `AverageVelocity` field (for mapped `Type` value "Linear") to the "Velocity max (mm/day)" value from the Linear stage statistics of the Longest VCP.
10. THE Auto_Fill_Mapper SHALL set `InverseVelocity1` directly to `round(1 / Vmax, 4)` when `Vmax` is available and non-zero, bypassing the form's auto-compute effect. IF `Vmax` is unavailable or zero, THEN `InverseVelocity1` SHALL be left unchanged (empty string) in `initialValues`.
11. IF Fukuzono `predicted_failure_time` is available, THEN THE Auto_Fill_Mapper SHALL set `ForecastResult1` to that timestamp converted to the user's client timezone using `isoToDatetimeLocal`. IF SLO `predicted_failure_time` is available, THEN THE Auto_Fill_Mapper SHALL set `ForecastResult2` to that timestamp converted to the user's client timezone.
12. IF no Progressive Failure stage exists for the Longest VCP, THEN THE Auto_Fill_Mapper SHALL set `Type` to "Linear" and leave `Vmax`, `Vmin`, `AverageVelocity`, and `InverseVelocity1` as empty strings in `initialValues`.
13. THE Auto_Fill_Mapper SHALL merge the pattern-recognition-derived values with the precursor record's `initialValues`, where `Location` and `alarmRegions` from the precursor record take precedence and all other fields are filled from the pattern-recognition output.

---

### Requirement 9: Summary Data Storage in def_records

**User Story:** As a site engineer, I want the pattern-recognition summary data to be saved with the deformation record, so that the analysis results are permanently linked to the record for future reference.

#### Acceptance Criteria

1. WHEN `AddDeformationForm` is submitted after an auto-fill from pattern recognition, THE `AddDeformationForm` SHALL include the pattern-recognition summary data in the `properties` JSONB payload under the key `pattern_recognition_summary`.
2. THE `pattern_recognition_summary` object SHALL contain the following fields: `vcps` (array of per-VCP objects each containing `name`, `windows` array of `{phase, start, end}` objects, `onset_of_failure`), `fukuzono` (array of per-VCP objects each containing `vcp_name`, `predicted_failure_time`, `r2`), `slo` (array of per-VCP objects each containing `vcp_name`, `predicted_failure_time`), and `stage_summary` (array of stage summary row objects matching the columns from `build_stage_summary`).
3. THE `pattern_recognition_summary` SHALL be a plain JSON-serialisable object: all timestamp values SHALL be ISO 8601 strings, all numeric values SHALL be JSON numbers, and no Python dataclass instances or `pd.Timestamp` objects SHALL be present.
4. IF the user fills the form directly (without running pattern recognition), THEN THE `AddDeformationForm` SHALL omit the `pattern_recognition_summary` key entirely from the `properties` payload — the key SHALL NOT be present with a `null` value. IF the user auto-fills the form via pattern recognition but then manually edits any field before submitting, THEN THE `AddDeformationForm` SHALL also omit the `pattern_recognition_summary` key from the `properties` payload.
5. THE `pattern_recognition_summary` key SHALL be merged into the `properties` object alongside existing dynamic field keys (e.g. `Vmax`, `VCP`, `AverageVelocity`) without overwriting or removing any of those keys.

---

### Requirement 10: Pattern Recognition Popup — Multi-VCP Comparison

**User Story:** As a site engineer, I want to compare multiple VCPs side-by-side in the popup, so that I can identify which VCP shows the most significant Progressive Failure pattern.

#### Acceptance Criteria

1. WHERE two or more VCPs (up to a maximum of 8) have been successfully analysed, THE Pattern_Recognition_Popup SHALL render the multi-VCP comparison chart with three rows (displacement / velocity / inverse velocity) and one trace per VCP, using the Plotly figure JSON returned by the Analysis API.
2. WHERE the multi-VCP comparison chart is rendered, THE chart SHALL use the `plotly_dark` template and the VCP colour palette embedded in the Plotly figure JSON (derived from `visualizer._VCP_COLORS`).
3. WHERE analysis results are available, THE Pattern_Recognition_Popup SHALL display a summary table with one row per VCP containing: VCP name, onset of failure (ISO 8601 local format or "N/A"), Fukuzono predicted time (ISO 8601 local format or "N/A"; column hidden when forecasting is disabled), SLO predicted time (ISO 8601 local format or "N/A"; column hidden when forecasting is disabled), and IV R² (numeric to 2 decimal places or "N/A").
4. WHERE at least one VCP has a Progressive Failure stage, THE Pattern_Recognition_Popup SHALL apply a distinct background colour (e.g. `--dtg-brand-orange` at 15% opacity) to the summary row of the Longest VCP to visually distinguish it from other rows.
5. WHERE no VCP has a Progressive Failure stage, THE Pattern_Recognition_Popup SHALL display an informational message "No Progressive Failure detected across all VCPs" and disable the "Use Results to Fill Form" button. WHERE at least one VCP has a Progressive Failure stage, THE "Use Results to Fill Form" button SHALL be enabled.

---

### Requirement 11: Round-Trip Data Integrity

**User Story:** As a developer, I want the JSON data exchanged between the Analysis API and the React frontend to faithfully represent the Python pipeline output, so that chart rendering and auto-fill mapping produce correct results.

#### Acceptance Criteria

1. THE Analysis_API SHALL serialise all `pd.Timestamp` values as ISO 8601 strings (e.g. `"2024-03-15T14:30:00"`) before including them in the JSON response body.
2. THE Analysis_API SHALL serialise all `pd.Series` objects used for chart traces as objects with two parallel arrays: `"x"` (array of ISO 8601 timestamp strings) and `"y"` (array of JSON numbers). This is the single canonical format; the dual-format alternative ("or separate x and y arrays") is not permitted.
3. THE Analysis_API SHALL serialise Plotly figures using `fig.to_json()` and include the resulting JSON string (or parsed object) in the response so that the frontend can pass it directly to the Plotly rendering library without any client-side transformation.
4. FOR ALL valid VCP inputs processed by the Analysis API, the returned JSON response SHALL satisfy: all keys present in the pipeline output are present in the JSON; all timestamp values are ISO 8601 strings; all numeric values are JSON numbers; and re-serialising the parsed JSON SHALL produce a JSON string where all numeric values differ from the originals by no more than 1×10⁻⁹.
5. THE Analysis_API SHALL return HTTP 400 with a JSON body containing a non-empty `"error"` string field when the request is missing required fields (no files uploaded, or required parameter fields absent).
6. THE Analysis_API SHALL return HTTP 500 with a JSON body containing a non-empty `"error"` string field when the Python pipeline raises an unhandled exception. The `"error"` field SHALL contain a user-facing message and SHALL NOT include Python stack traces, module paths, or internal variable names.
