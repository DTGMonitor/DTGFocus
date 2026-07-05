# Design Document: Pattern Recognition Integration

## Overview

This feature integrates the standalone Python/Streamlit pattern-recognition pipeline into the `dtg-focus-vercel` Next.js application as an embedded popup component. The integration is triggered from the deformation update flow in `DeformationTab`. After a user confirms the archive-and-create-new-record step, a second prompt asks whether to run Pattern Recognition first. If chosen, the Pattern Recognition Popup (PRP) opens, runs the Python pipeline via a Next.js API route, renders Plotly charts and a stage summary, and maps results back into `AddDeformationForm` via a pure auto-fill mapper function.

### Key Design Goals

- **Zero new Python dependencies** — the existing pipeline modules are invoked as a subprocess; no Python web framework is added.
- **No new JS libraries** — Plotly React (`react-plotly.js`) is already available; `fetch` + `AbortController` handle the API call; no new state management library is introduced.
- **Minimal DeformationTab changes** — a single new state machine step is inserted between the existing update-confirm and add-form steps.
- **Pure auto-fill mapper** — `buildAutoFillInitialValues` is a side-effect-free function, making it straightforward to property-test.
- **Summary stored in JSONB** — `pattern_recognition_summary` is merged into `def_records.properties` only when auto-fill was used and no manual edits followed.

---

## Architecture

### Component Tree

```
DeformationTab (state owner)
├── DeformationList
├── EditModal
├── ConfirmDialog (hard-delete)
├── ConfirmDialog (update confirm — existing)
├── ConfirmDialog (PR prompt — NEW, step between update confirm and form)
├── PatternRecognitionPopup (NEW, full-screen modal)
│   ├── PRP Header (title + close ×)
│   ├── FileUploadPanel
│   │   └── VCPConfigRow[] (one per uploaded file)
│   │       └── SmoothingWindowTable
│   ├── AnalysisParametersPanel (collapsible)
│   ├── RunAnalysisButton + LoadingIndicator
│   └── ResultsArea (shown after successful analysis)
│       ├── VCPSelector (tab strip, shown when ≥2 VCPs)
│       ├── CombinedChart (react-plotly.js, per active VCP)
│       │   └── DownloadChartButton
│       ├── MultiVCPComparisonChart (react-plotly.js, shown when ≥2 VCPs)
│       │   └── DownloadChartButton
│       ├── VCPSummaryTable (one row per VCP)
│       ├── StageSummaryTable (per-stage statistics)
│       ├── StageEditor (editable stage table for active VCP)
│       │   ├── ApplyStageLabelButton
│       │   └── ResetToAutoButton
│       └── UseResultsButton ("Use Results to Fill Form")
└── AddDeformationForm (existing, opened after PRP or directly)
```

### New Files to Create

| Path | Purpose |
|------|---------|
| `components/admin/Radar/PatternRecognition/PatternRecognitionPopup.jsx` | Full-screen modal — file upload, params, results |
| `components/admin/Radar/PatternRecognition/FileUploadPanel.jsx` | File input + per-file VCPConfigRow list |
| `components/admin/Radar/PatternRecognition/VCPConfigRow.jsx` | Per-file name prefix + smoothing window table |
| `components/admin/Radar/PatternRecognition/AnalysisParametersPanel.jsx` | Collapsible params panel with validation |
| `components/admin/Radar/PatternRecognition/ResultsArea.jsx` | Charts + tables + stage editor + use-results button |
| `components/admin/Radar/PatternRecognition/StageEditor.jsx` | Editable stage table with Apply/Reset |
| `components/admin/Radar/PatternRecognition/VCPSummaryTable.jsx` | Per-VCP summary (onset, predictions, R²) |
| `components/admin/Radar/PatternRecognition/StageSummaryTable.jsx` | Per-stage statistics table |
| `app/api/pattern-recognition/analyze/route.js` | Next.js API route — spawns Python subprocess |
| `app/api/pattern-recognition/classify-manual/route.js` | API route for `classify_from_manual_windows` |
| `utils/patternRecognitionMapper.ts` | Pure `buildAutoFillInitialValues` function |
| `utils/patternRecognitionSerializer.ts` | Helpers for serialising/deserialising API response |

### Existing Files to Modify

| Path | Change |
|------|--------|
| `components/admin/Radar/Tabs/DeformationTab.jsx` | Add PR-prompt state, PRP open/close state, pass context to PRP, wire auto-fill callback |
| `components/admin/Radar/Deformation/AddDeformationForm.tsx` | Accept `patternRecognitionSummary` prop; include it in `properties` payload; track manual-edit flag |

---

## Data Flow Diagrams

### Main Update → PR → Auto-fill Flow

```
User clicks "Update" on a deformation record
        │
        ▼
ConfirmDialog: "Update Deformation Record?"
        │ onConfirm
        ▼
[NEW] ConfirmDialog: "Would you like to run Pattern Recognition first?"
        │                           │
        │ "Open Pattern Recognition" │ "Fill Form Directly" / Escape / backdrop
        ▼                           ▼
PatternRecognitionPopup opens   AddDeformationForm opens
(precursors + initialValues ctx)  (same initialValues as before)
        │
        │ User uploads files, configures params, clicks "Run Analysis"
        ▼
POST /api/pattern-recognition/analyze
        │
        │ Python subprocess: preprocessor → phase_classifier → failure_predictor → visualizer
        ▼
JSON response (VCP results + Plotly figures)
        │
        │ User reviews charts, optionally edits stages
        │ (stage edits → POST /api/pattern-recognition/classify-manual)
        │
        │ User clicks "Use Results to Fill Form"
        ▼
buildAutoFillInitialValues(vcpResults, precursorsInitialValues)
        │
        ▼
PatternRecognitionPopup unmounts
AddDeformationForm opens with merged initialValues
        │
        │ User reviews, submits (no manual edits → summary included)
        ▼
Supabase INSERT: def_records with properties.pattern_recognition_summary
```

### Stage Edit Flow

```
User edits stage label in StageEditor
        │
        │ User clicks "Apply Stage Labels"
        ▼
POST /api/pattern-recognition/classify-manual
  body: { windows: [{phase, start, end}, ...], vcpName, smoothingWindow }
        │
        ▼
Python: classify_from_manual_windows(velocity_smooth, windows_spec)
        │
        ▼
Updated ClassificationResult + new combined chart figure JSON
        │
        ▼
PRP updates: combined chart, stage summary table, onset_of_failure display
```

---

## Components and Interfaces

### DeformationTab — New State

```javascript
// New state additions to DeformationTab
const [showPRPrompt, setShowPRPrompt] = useState(false);   // PR prompt step
const [showPRP, setShowPRP] = useState(false);             // PRP open/close
const [prpContext, setPrpContext] = useState(null);        // { precursors, initialValues }
```

**Updated `handleUpdateConfirm`:**
```javascript
const handleUpdateConfirm = () => {
  if (!updateTarget) return;
  setPendingPrecursors(updateTarget.id);
  setUpdateTarget(null);
  setShowPRPrompt(true);   // NEW: show PR prompt instead of directly opening form
};
```

**New handlers:**
```javascript
const handlePRPromptOpenPRP = () => {
  setShowPRPrompt(false);
  setPrpContext({ precursors: pendingPrecursors, initialValues: addFormInitialValues });
  setShowPRP(true);
};

const handlePRPromptFillDirectly = () => {
  setShowPRPrompt(false);
  setShowAddForm(true);
};

const handlePRPClose = () => {
  setShowPRP(false);
  setPrpContext(null);
  setPendingPrecursors(null);
};

const handlePRPUseResults = (autoFillValues, summary) => {
  setShowPRP(false);
  setPrpContext(null);
  // addFormInitialValues is already derived from pendingPrecursors;
  // autoFillValues has been merged with precursors context by the mapper.
  setAutoFillValues(autoFillValues);
  setPatternRecognitionSummary(summary);
  setShowAddForm(true);
};
```

### PatternRecognitionPopup — Props Interface

```typescript
interface PatternRecognitionPopupProps {
  isOpen: boolean;
  precursors: string | number | null;
  precursorsInitialValues: Partial<FormDataState> | undefined;
  timezone: string;
  onClose: () => void;
  onUseResults: (autoFillValues: Partial<FormDataState>, summary: PRSummary) => void;
}
```

### PatternRecognitionPopup — Internal State

```typescript
// File upload state
const [uploadedFiles, setUploadedFiles] = useState<VCPFileConfig[]>([]);

// Analysis parameters state
const [params, setParams] = useState<AnalysisParams>(DEFAULT_PARAMS);
const [paramErrors, setParamErrors] = useState<Record<string, string>>({});

// Analysis results state
const [vcpResults, setVcpResults] = useState<VCPResult[]>([]);
const [isAnalysing, setIsAnalysing] = useState(false);
const [analysisError, setAnalysisError] = useState<string | null>(null);
const [activeVcpIndex, setActiveVcpIndex] = useState(0);

// Stage editor state (per active VCP)
const [manualStages, setManualStages] = useState<StageRow[] | null>(null); // null = using auto
const [isApplyingStages, setIsApplyingStages] = useState(false);
const [isResettingStages, setIsResettingStages] = useState(false);

// Manual-edit tracking for summary omission (Req 9.4)
const [hasManualEdits, setHasManualEdits] = useState(false);
```

### VCPFileConfig Interface

```typescript
interface VCPFileConfig {
  file: File;
  vcpNamePrefix: string;          // pre-filled with filename without extension
  smoothingWindows: number[];     // array of window values in minutes
  parseInfo: {
    dataStart: string;            // ISO 8601 local
    dataEnd: string;              // ISO 8601 local
    samplingIntervalMinutes: number;
    rowCount: number;
  } | null;
  parseError: string | null;
}
```

### VCPResult Interface (API response shape, client-side)

```typescript
interface VCPResult {
  vcpName: string;
  smoothingWindow: number;
  windows: WindowResult[];
  onsetOfFailure: string | null;   // ISO 8601 string
  fukuzono: {
    predictedFailureTime: string | null;
    r2: number | null;
    lowR2Warning: boolean;
  } | null;
  slo: {
    predictedFailureTime: string | null;
  } | null;
  stageSummaryRows: StageSummaryRow[];
  combinedChartJson: object;       // parsed Plotly figure JSON
  errors: string[];
}

interface MultiVCPResult {
  comparisonChartJson: object;     // parsed Plotly figure JSON
}

interface WindowResult {
  phase: string;
  start: string;   // ISO 8601
  end: string;     // ISO 8601
  duration: string; // "Xd Yh Zm"
}

interface StageSummaryRow {
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
```

---

## Data Models

### API Request — `/api/pattern-recognition/analyze`

**Method:** `POST`  
**Content-Type:** `multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `files[]` | File (binary) | One or more `.xlsx`/`.xls` files |
| `vcpConfigs` | JSON string | Array of `{fileName, vcpNamePrefix, smoothingWindows: number[]}` |
| `smoothingWindow` | string (number) | Global preprocessor smoothing window |
| `longSmoothWindow` | string (number) | Long smoothing window for classifier |
| `vLowFrac` | string (number) | Velocity threshold fraction |
| `aMultiplier` | string (number) | Acceleration multiplier |
| `minSegmentPts` | string (number) | Minimum segment readings |
| `ivR2Threshold` | string (number) | IV onset R² threshold |
| `r2WarningThreshold` | string (number) | IV method R² warning threshold |
| `fukuzonoTailFraction` | string (number) | IV tail fraction |
| `enableForecasting` | string ("true"/"false") | Master forecasting toggle |
| `enableFukuzono` | string ("true"/"false") | Fukuzono method toggle |
| `enableSloGradient` | string ("true"/"false") | SLO Gradient method toggle |
| `sloRollingWindow` | string (number) | SLO rolling window |
| `sloCriticalThreshold` | string (number) | SLO critical threshold |
| `sloTailFraction` | string (number) | SLO tail fraction |
| `sloR2WarningThreshold` | string (number) | SLO R² warning threshold |

### API Response — `/api/pattern-recognition/analyze`

**Success (HTTP 200):**

```json
{
  "vcps": [
    {
      "vcpName": "VCP-01",
      "smoothingWindow": 7,
      "windows": [
        { "phase": "Linear", "start": "2024-01-01T00:00:00", "end": "2024-02-01T00:00:00", "duration": "31d 0h 0m" },
        { "phase": "Progressive Failure", "start": "2024-02-01T00:00:00", "end": "2024-03-01T00:00:00", "duration": "29d 0h 0m" }
      ],
      "onsetOfFailure": "2024-02-01T00:00:00",
      "fukuzono": {
        "predictedFailureTime": "2024-03-05T12:00:00",
        "r2": 0.92,
        "lowR2Warning": false
      },
      "slo": {
        "predictedFailureTime": "2024-03-06T08:00:00"
      },
      "stageSummaryRows": [ /* StageSummaryRow objects */ ],
      "combinedChartJson": { /* Plotly figure JSON from fig.to_json() */ },
      "errors": []
    }
  ],
  "multiVcpComparisonChartJson": { /* Plotly figure JSON, null if <2 VCPs */ }
}
```

**Error (HTTP 400 or 500):**

```json
{ "error": "Human-readable error message" }
```

### API Request — `/api/pattern-recognition/classify-manual`

**Method:** `POST`  
**Content-Type:** `application/json`

```json
{
  "vcpName": "VCP-01",
  "smoothingWindow": 7,
  "fileIndex": 0,
  "windows": [
    { "phase": "Linear", "start": "2024-01-01T00:00:00", "end": "2024-02-01T00:00:00" },
    { "phase": "Progressive Failure", "start": "2024-02-01T00:00:00", "end": "2024-03-01T00:00:00" }
  ]
}
```

**Response (HTTP 200):**

```json
{
  "windows": [ /* updated WindowResult objects */ ],
  "onsetOfFailure": "2024-02-01T00:00:00",
  "combinedChartJson": { /* updated Plotly figure JSON */ },
  "stageSummaryRows": [ /* updated StageSummaryRow objects */ ]
}
```

### `pattern_recognition_summary` Schema (stored in `def_records.properties`)

```json
{
  "pattern_recognition_summary": {
    "vcps": [
      {
        "name": "VCP-01",
        "windows": [
          { "phase": "Progressive Failure", "start": "2024-02-01T00:00:00", "end": "2024-03-01T00:00:00" }
        ],
        "onset_of_failure": "2024-02-01T00:00:00"
      }
    ],
    "fukuzono": [
      { "vcp_name": "VCP-01", "predicted_failure_time": "2024-03-05T12:00:00", "r2": 0.92 }
    ],
    "slo": [
      { "vcp_name": "VCP-01", "predicted_failure_time": "2024-03-06T08:00:00" }
    ],
    "stage_summary": [ /* StageSummaryRow objects with ISO 8601 strings and JSON numbers */ ]
  }
}
```

---

## Auto-fill Mapper Algorithm

The mapper is implemented as a pure function in `utils/patternRecognitionMapper.ts`.

```typescript
/**
 * buildAutoFillInitialValues
 *
 * Maps pattern-recognition VCP results to AddDeformationForm initialValues.
 * Merges with precursors initialValues, where Location and alarmRegions
 * from the precursors take precedence (Requirement 8.13).
 *
 * @param vcpResults   - Array of VCPResult from the analysis API
 * @param precursorsInitialValues - initialValues derived from the precursors record
 * @param timezone     - Client timezone string (e.g. "Australia/Perth")
 * @returns Partial<FormDataState> ready to pass as initialValues to AddDeformationForm
 */
export function buildAutoFillInitialValues(
  vcpResults: VCPResult[],
  precursorsInitialValues: Partial<FormDataState> | undefined,
  timezone: string
): Partial<FormDataState>
```

### Step 1 — Select the Longest VCP (Requirement 8.1)

```
longestVcp = vcpResults.reduce((best, current) => {
  const pfDuration = totalProgressiveFailureDuration(current.windows)  // sum of all PF window durations in ms
  const bestPfDuration = totalProgressiveFailureDuration(best.windows)

  if (pfDuration > bestPfDuration) return current
  if (pfDuration === bestPfDuration) {
    // Tiebreaker: higher peak velocity in PF stage
    return peakVelocityInPF(current) >= peakVelocityInPF(best) ? current : best
  }
  return best
})
```

`peakVelocityInPF` is derived from `stageSummaryRows` — the `"Velocity max (mm/day)"` value for the row(s) with `Stage === "Progressive Failure"` for that VCP.

### Step 2 — Determine Type (Requirement 8.4)

```
finalPhase = longestVcp.windows[longestVcp.windows.length - 1].phase

PHASE_TO_TYPE_MAP = {
  "Progressive Failure": "Progressive",
  "Linear":              "Linear",
  "Regressive":          "Regressive",
  "No Significant Movement": "Linear",
  "Unclassified":        "Linear",
}

mappedType = PHASE_TO_TYPE_MAP[finalPhase] ?? "Linear"
```

### Step 3 — Extract PF Stage Statistics

```
pfRows = longestVcp.stageSummaryRows.filter(r => r.Stage.startsWith("Progressive Failure"))
// If multiple PF rows (e.g. "Progressive Failure 1", "Progressive Failure 2"), use the one with highest Vmax

pfVmax = max(pfRows.map(r => r["Velocity max (mm/day)"]))  // null if no PF rows
pfVmin = pfRows[argmax(pfRows, "Velocity max (mm/day)")]["Velocity min (mm/day)"]  // null if no PF rows
```

### Step 4 — Build Mapped Values

```typescript
const mapped: Partial<FormDataState> = {
  Type: mappedType,
  Start: longestVcp.onsetOfFailure
    ? isoToDatetimeLocal(longestVcp.onsetOfFailure, timezone)
    : "",
  VCP: String(longestVcp.smoothingWindow),
};

// Progressive / Linear Accelerating fields
if (["Progressive", "Linear Accelerating"].includes(mappedType) && pfVmax != null) {
  mapped.Vmax = String(pfVmax);
  mapped.Vmin = pfVmin != null ? String(pfVmin) : "";
  mapped.InverseVelocity1 = pfVmax !== 0 ? String(round(1 / pfVmax, 4)) : "";
}

// Linear fields
if (mappedType === "Linear") {
  const linearRows = longestVcp.stageSummaryRows.filter(r => r.Stage.startsWith("Linear"));
  const linearVmax = linearRows.length > 0
    ? max(linearRows.map(r => r["Velocity max (mm/day)"]))
    : null;
  mapped.AverageVelocity = linearVmax != null ? String(linearVmax) : "";
}

// Forecast fields
if (longestVcp.fukuzono?.predictedFailureTime) {
  mapped.ForecastResult1 = isoToDatetimeLocal(longestVcp.fukuzono.predictedFailureTime, timezone);
}
if (longestVcp.slo?.predictedFailureTime) {
  mapped.ForecastResult2 = isoToDatetimeLocal(longestVcp.slo.predictedFailureTime, timezone);
}
```

### Step 5 — Merge with Precursors (Requirement 8.13)

```typescript
return {
  ...mapped,
  // Precursors fields always take precedence
  Location: precursorsInitialValues?.Location ?? mapped.Location ?? "",
  alarmRegions: precursorsInitialValues?.alarmRegions ?? [],
  WallFolderID: precursorsInitialValues?.WallFolderID ?? mapped.WallFolderID,
};
```

---

## State Management Design

### DeformationTab State Machine

The update flow is extended with two new states:

```
IDLE
  │ handleUpdate(record)
  ▼
UPDATE_CONFIRM (existing ConfirmDialog)
  │ handleUpdateConfirm()
  ▼
PR_PROMPT (NEW ConfirmDialog)
  ├─ "Open Pattern Recognition" → PRP_OPEN
  └─ "Fill Form Directly" / Escape / backdrop → ADD_FORM_OPEN

PRP_OPEN (PatternRecognitionPopup)
  ├─ onClose() → IDLE (discard, no records modified)
  └─ onUseResults(values, summary) → ADD_FORM_OPEN (with auto-fill)

ADD_FORM_OPEN (AddDeformationForm)
  ├─ onClose() → IDLE
  └─ onSuccess() → IDLE + fetchDeformationRecords()
```

State variables controlling this machine:

```javascript
// Existing
const [updateTarget, setUpdateTarget] = useState(null);
const [pendingPrecursors, setPendingPrecursors] = useState(null);
const [showAddForm, setShowAddForm] = useState(false);

// New
const [showPRPrompt, setShowPRPrompt] = useState(false);
const [showPRP, setShowPRP] = useState(false);
const [prpAutoFillValues, setPrpAutoFillValues] = useState(null);
const [prpSummary, setPrpSummary] = useState(null);
```

The `addFormInitialValues` memo is extended to also spread `prpAutoFillValues` when present:

```javascript
const addFormInitialValues = useMemo(() => {
  if (prpAutoFillValues) return prpAutoFillValues;  // auto-fill takes precedence
  if (!precursorsRecord) return undefined;
  return {
    WallFolderID: precursorsRecord.wallfolder_id || sensor.wallfolder_id,
    Location: precursorsRecord.location || '',
    alarmRegions: Array.isArray(precursorsRecord.alarm) ? precursorsRecord.alarm : [],
  };
}, [precursorsRecord, sensor?.wallfolder_id, prpAutoFillValues]);
```

### AddDeformationForm — Summary Storage

`AddDeformationForm` receives two new optional props:

```typescript
patternRecognitionSummary?: PRSummary | null;
onFieldChange?: () => void;  // called on any user edit after auto-fill
```

A `hasManualEdits` ref tracks whether the user has changed any field after the form was opened with auto-fill values. If `hasManualEdits` is true at submit time, `pattern_recognition_summary` is omitted from the `properties` payload.

```typescript
// In handleSubmit:
const properties: Record<string, any> = { ...dynamicFieldProperties };
if (patternRecognitionSummary && !hasManualEdits) {
  properties.pattern_recognition_summary = patternRecognitionSummary;
}
```

---

## Next.js API Route Design

### `/api/pattern-recognition/analyze/route.js`

**Technology choices:**
- `child_process.spawn` (Node.js built-in) to invoke the Python subprocess
- `formidable` or Next.js built-in `request.formData()` for multipart parsing
- 50 MB file size limit enforced before spawning Python
- 60-second per-VCP timeout via `AbortController` on the subprocess

**Implementation outline:**

```javascript
// app/api/pattern-recognition/analyze/route.js
import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export const config = { api: { bodyParser: false } };

export async function POST(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files[]');

    // Enforce 50 MB limit (Req 4.6, 11.5)
    for (const file of files) {
      if (file.size > 50 * 1024 * 1024) {
        return NextResponse.json(
          { error: `File "${file.name}" exceeds the 50 MB size limit.` },
          { status: 400 }
        );
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No files uploaded.' }, { status: 400 });
    }

    // Write files to temp directory
    const tempPaths = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const tempPath = path.join(tmpdir(), `pr_${Date.now()}_${file.name}`);
      await writeFile(tempPath, buffer);
      tempPaths.push(tempPath);
    }

    // Build params object from form fields
    const params = extractParams(formData);

    // Spawn Python runner script
    const result = await runPythonPipeline(tempPaths, params);

    // Cleanup temp files
    await Promise.allSettled(tempPaths.map(p => unlink(p)));

    return NextResponse.json(result);

  } catch (err) {
    console.error('Pattern recognition API error:', err);
    return NextResponse.json(
      { error: 'Analysis failed. Please try again.' },
      { status: 500 }
    );
  }
}
```

**Python runner script** (`scripts/run_pattern_recognition.py`):

The API route spawns a dedicated Python runner script that:
1. Reads file paths and params from `stdin` as JSON
2. Calls `preprocessor.preprocess()`, `phase_classifier.classify()`, `failure_predictor.predict_fukuzono()`, `failure_predictor.predict_slo_gradient()`, `visualizer.build_combined_chart()`, `visualizer.build_multi_vcp_chart()`, `visualizer.build_stage_summary()`
3. Serialises all `pd.Timestamp` values to ISO 8601 strings
4. Serialises Plotly figures via `fig.to_json()`
5. Writes the JSON result to `stdout`

**Serialisation rules (Requirement 11):**

```python
import json
import pandas as pd

def serialise_timestamp(ts):
    """Convert pd.Timestamp to ISO 8601 string."""
    if ts is None:
        return None
    if isinstance(ts, pd.Timestamp):
        return ts.isoformat()
    return str(ts)

def serialise_series(series):
    """Convert pd.Series with DatetimeIndex to {x: [...], y: [...]}."""
    if series is None or series.empty:
        return {"x": [], "y": []}
    return {
        "x": [ts.isoformat() for ts in series.index],
        "y": [float(v) if not pd.isna(v) else None for v in series.values]
    }
```

### `/api/pattern-recognition/classify-manual/route.js`

Accepts the manual stage windows, re-runs `classify_from_manual_windows` via the Python runner, and returns the updated classification result + new combined chart figure JSON.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Serialisation Round-Trip

*For any* valid pipeline output object containing `pd.Timestamp` values and `pd.Series` objects, serialising it to JSON via the Analysis API serialiser and then parsing the JSON back SHALL produce an object where all timestamp values are valid ISO 8601 strings and all numeric values differ from the originals by no more than 1×10⁻⁹.

**Validates: Requirements 11.1, 11.2, 11.4**

### Property 2: File Size Enforcement

*For any* uploaded file whose size in bytes exceeds `AppConfig.max_file_size_bytes` (50 MB), the Analysis API SHALL return HTTP 400 with a JSON body containing a non-empty `"error"` string field, without invoking the Python pipeline.

**Validates: Requirements 4.6, 11.5**

### Property 3: Longest VCP Selection

*For any* set of VCP results with varying Progressive Failure window durations, `buildAutoFillInitialValues` SHALL select as the Longest VCP the one with the greatest total Progressive Failure duration. *For any* two VCPs with equal Progressive Failure duration, the one with the higher peak velocity in its Progressive Failure stage SHALL be selected.

**Validates: Requirements 8.1**

### Property 4: Auto-fill Mapper Field Mapping

*For any* set of VCP results and precursors `initialValues`, `buildAutoFillInitialValues` SHALL produce an `initialValues` object where:
- `Type` is the correct mapping of the final phase label of the Longest VCP per the `PHASE_TO_TYPE_MAP`
- `Start` is the `onset_of_failure` of the Longest VCP converted to the client timezone
- `VCP` is the smoothing window in minutes of the Longest VCP
- `Vmax` is the maximum velocity from the Progressive Failure stage of the Longest VCP (when applicable)
- `Vmin` is the minimum velocity from the Progressive Failure stage of the Longest VCP (when applicable)
- `InverseVelocity1` equals `round(1 / Vmax, 4)` when `Vmax` is available and non-zero
- `Location` and `alarmRegions` are taken from the precursors `initialValues`, not from the PR output

**Validates: Requirements 8.1, 8.4, 8.5, 8.6, 8.7, 8.8, 8.10, 8.13**

### Property 5: Stage Editor Onset Derivation

*For any* list of stage windows passed to the stage editor, the displayed `onset_of_failure` SHALL equal the `start_time` of the first window whose `phase` is `"Progressive Failure"`. *For any* stage list containing no `"Progressive Failure"` window, `onset_of_failure` SHALL be displayed as `"—"`.

**Validates: Requirements 6.5**

### Property 6: Summary Storage Integrity

*For any* existing `properties` object in `def_records`, merging `pattern_recognition_summary` into it SHALL preserve all pre-existing keys and their values without modification.

**Validates: Requirements 9.5**

### Property 7: API Error Shape

*For any* request to the Analysis API that is missing required fields (no files, or absent parameter fields), the API SHALL return HTTP 400 with a JSON body where the `"error"` field is a non-empty string. *For any* unhandled Python pipeline exception, the API SHALL return HTTP 500 with a JSON body where the `"error"` field is a non-empty string containing no Python stack traces, module paths, or internal variable names.

**Validates: Requirements 11.5, 11.6**

---

## Error Handling

### Client-Side (PatternRecognitionPopup)

| Scenario | Handling |
|----------|---------|
| File parse failure | Inline error per file; other files proceed normally |
| API HTTP 4xx | Display error message inline for affected VCP(s) |
| API HTTP 5xx | Display top-level error; results area remains empty |
| 90-second timeout | Abort request via `AbortController`; display timeout message; re-enable Run Analysis |
| Plotly `downloadImage` throws | Inline error adjacent to Download Chart button |
| Stage apply API failure | Re-enable Apply button; display inline error in stage editor |
| All VCPs fail | Top-level error message; "Use Results to Fill Form" button disabled |

### Server-Side (API Route)

| Scenario | Response |
|----------|---------|
| File > 50 MB | HTTP 400 `{ "error": "File ... exceeds the 50 MB size limit." }` |
| No files uploaded | HTTP 400 `{ "error": "No files uploaded." }` |
| Missing required params | HTTP 400 `{ "error": "Missing required parameter: ..." }` |
| Python subprocess timeout (60s per VCP) | Per-VCP error in response; other VCPs still returned |
| Python unhandled exception | HTTP 500 `{ "error": "Analysis failed. Please try again." }` (no stack trace) |
| Temp file write failure | HTTP 500 `{ "error": "Failed to process uploaded file." }` |

### Subprocess Timeout Strategy

Each VCP is processed independently. The Node.js API route uses a `Promise.race` between the subprocess result and a 60-second timeout per VCP. If a VCP times out, its result includes `errors: ["Processing timed out after 60 seconds"]` and the other VCPs continue.

---

## Testing Strategy

### Unit Tests (example-based)

- `buildAutoFillInitialValues` with concrete VCP result fixtures covering each `Type` mapping
- `buildAutoFillInitialValues` with no Progressive Failure stage (fallback to "Linear")
- `buildAutoFillInitialValues` merge precedence (Location and alarmRegions from precursors)
- `DeformationTab` state transitions: update confirm → PR prompt → PRP open / fill directly
- `PatternRecognitionPopup` parameter validation: each parameter at its boundary values
- `StageEditor` onset derivation: first PF row, no PF row
- API route: file size enforcement at exactly 50 MB and 50 MB + 1 byte
- API route: missing fields return HTTP 400 with non-empty error

### Property-Based Tests (using `fast-check`)

Property-based testing is appropriate here because the feature contains several pure functions with large input spaces (serialisation, auto-fill mapping, stage onset derivation) where 100+ iterations will reveal edge cases that example tests miss.

**Library:** `fast-check` (TypeScript/JavaScript)  
**Minimum iterations:** 100 per property test  
**Tag format:** `// Feature: pattern-recognition-integration, Property N: <property_text>`

**Property 1 — Serialisation Round-Trip**  
Generate arbitrary pipeline output objects with random `pd.Timestamp` values and numeric series. Assert that after serialisation and deserialisation, all timestamps are ISO 8601 strings and all numerics are within 1×10⁻⁹ of originals.  
*Tag: Feature: pattern-recognition-integration, Property 1: serialisation round-trip preserves all values*

**Property 2 — File Size Enforcement**  
Generate arbitrary file sizes above and below 50 MB. Assert that the API returns HTTP 400 iff size > 50 MB.  
*Tag: Feature: pattern-recognition-integration, Property 2: file size > 50 MB always returns HTTP 400*

**Property 3 — Longest VCP Selection**  
Generate arbitrary arrays of VCP results with random PF window durations and peak velocities. Assert that the selected Longest VCP has the maximum total PF duration, with peak velocity as tiebreaker.  
*Tag: Feature: pattern-recognition-integration, Property 3: longest VCP selection is correct for any input set*

**Property 4 — Auto-fill Mapper Field Mapping**  
Generate arbitrary VCP results and precursors initialValues. Assert all field mapping rules hold simultaneously (Type, Start, VCP, Vmax, Vmin, InverseVelocity1, Location, alarmRegions precedence).  
*Tag: Feature: pattern-recognition-integration, Property 4: auto-fill mapper produces correct field values for any VCP results*

**Property 5 — Stage Editor Onset Derivation**  
Generate arbitrary lists of stage windows with random phase labels. Assert onset = start of first PF window, or "—" if none.  
*Tag: Feature: pattern-recognition-integration, Property 5: onset_of_failure is start of first PF window or — if none*

**Property 6 — Summary Storage Integrity**  
Generate arbitrary `properties` objects with random keys and values. Assert that after merging `pattern_recognition_summary`, all original keys and values are unchanged.  
*Tag: Feature: pattern-recognition-integration, Property 6: merging summary preserves all existing properties keys*

**Property 7 — API Error Shape**  
Generate arbitrary combinations of missing required fields. Assert HTTP 400 with non-empty `"error"` string. Generate arbitrary Python exception messages. Assert HTTP 500 with non-empty `"error"` string containing no Python internals.  
*Tag: Feature: pattern-recognition-integration, Property 7: API error responses always have non-empty error field*

### Integration Tests

- End-to-end: upload a real `.xlsx` file, call `/api/pattern-recognition/analyze`, assert response shape
- Verify Plotly figure JSON contains `template: "plotly_dark"` and expected annotation types
- Verify `classify_from_manual_windows` endpoint returns updated classification matching supplied windows
- Verify `def_records.properties` contains `pattern_recognition_summary` after auto-fill submit
- Verify `pattern_recognition_summary` is absent when form is filled directly

### Technology Notes

- No new Python web framework is introduced; the pipeline is invoked via `child_process.spawn`
- `react-plotly.js` is used for chart rendering (already available in the project)
- `fast-check` is the chosen PBT library for JavaScript/TypeScript property tests
- `AbortController` (browser built-in) handles the 90-second client-side timeout
- The existing Supabase client is used for all database operations; no new DB client is introduced
