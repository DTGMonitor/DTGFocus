# Design Document: Comprehensive Radar Report

## Overview

The radar report generator currently ships exactly one usable layout — the 24h **Data Quality Assessment**. This feature adds a second, richer layout: the **Comprehensive** report, which pulls the Executive-Summary KPIs, the deformation event timeline, the data-quality radar chart, the availability donut, and a 24h alarm-cause breakdown into a single document, and reuses the Data Quality report's Glossary and Appendix verbatim.

The report is composed on the **measured-block pagination engine** proven in `PostBlastReportModal` (pattern recognition), not on the fixed-page engine used by `RadarTemplate`. The header, footer, and image-section idioms come from that same module.

### Key Design Goals

- **Extract, don't fork.** The pattern-recognition page frame (`PageSheet`, `FooterLogo`, `SectionBar`, palette, A4 constants, measure/paginate loop) is lifted into a shared module used by both the Post-Blast report and the new Comprehensive report. No copy-paste.
- **Reuse the real data path.** All sections read from the Supabase-backed `components/Radars/*` code path. The mock scaffolds under `components/admin/Radar/{Availability,DataQuality}` and `components/reports/*` are **not** extended.
- **Pure, testable derivations.** Timeline trimming, uptime, and alarm aggregation are side-effect-free functions in `utils/`, property-testable in isolation from React and Supabase.
- **No new chart library.** `recharts` (radar chart) and hand-rolled SVG (donut, pie) are already in the tree.
- **Category-driven template selection.** `RadarTemplate` currently ignores the `category` prop; this feature makes it honour `category`, which is the actual reason "only Data Quality is available."

---

## Terminology

- **Block** — one JSX node in the ordered array consumed by the pagination engine. Never split across pages.
- **Chain** — an ordered `root → current` list of `def_records` linked by `precursors[0]`.
- **Head record** — an active (`isactive='Yes'`) `def_records` row that is not referenced as a precursor by any other active record.
- **Granularity** — the report's aggregation window (`daily` / `weekly` / `monthly`), selected in the existing frequency picker.
- **Window** — the concrete `[start, end)` time interval implied by granularity + `endDate`.

---

## Architecture

### Why not extend `RadarTemplate`?

The two existing engines are structurally incompatible. The mockups are unambiguously in the pattern-recognition design language, so the Comprehensive report is built on that engine.

| | `RadarTemplate` (Data Quality) | `PostBlastReportModal` (Pattern Recog.) | Mockup needs |
|---|---|---|---|
| Layout | Fixed, hand-placed pages | Measured blocks, auto-paginated | **Auto** — variable-length sections |
| Page box | 1240×1754 px | 794×1123 px (A4 @ 96dpi) | A4 |
| Header | Teal gradient + SVG text | Logo + title + `Edition \| Author` | **Pattern recognition** |
| Footer | `Wall Folder: x` | DTG Focus mark + `Page N of M` | **Pattern recognition** |
| Export | One html2canvas per y-offset slice | Per-page canvas + vector print | Either |

`RadarTemplate` cannot express the mockups without being rewritten into the block model — at which point it *is* the other engine. Hence: extract the engine, write a new template against it.

### Component tree

```
ReportGeneratorModal                       (existing — components/admin/Reports/ReportTemplateModal.jsx)
└── ReportTemplateRenderer                 (existing — MODIFIED: pass `category` through)
    └── RadarTemplate                      (existing — MODIFIED: branch on `category`)
        ├── category='Data Quality'   → existing fixed-page layout   (UNCHANGED)
        └── category='Comprehensive'  → ComprehensiveRadarTemplate   (NEW)
            └── buildBlocks() →
                ├── HeaderBlock            (shared)
                ├── ExecutiveSummaryBlock  (NEW — 4 KPI tiles)
                ├── KeyFindingsBlock       (NEW)
                ├── DeformationBlock       (NEW — image + trimmed timeline)
                ├── DataQualityBlock       (NEW — radar chart + non-optimal table)
                ├── OperationalPerfBlock   (NEW — donut + alarm pie)
                ├── GlossaryBlock          (reused via getGlossaryForRadar)
                └── AppendixBlock[]        (reused idiom from RadarTemplate)
```

### New shared module: `components/admin/Radar/report/`

Extracted from `PostBlastReportModal.jsx` — currently module-private and therefore unreusable.

| Path | Exports | Source |
|---|---|---|
| `report/pageFrame.jsx` | `PageSheet`, `ReportPages`, `FooterLogo`, `SectionBar` | `PostBlastReportModal.jsx:1172-1256` |
| `report/constants.js` | `PAGE_W/H`, `PAD_X`, `PAD_TOP`, `FOOTER_RESERVE`, `BLOCK_GAP`, `CONTENT_W`, `USABLE_H`, palette (`NAVY`,`DARK`,`ACCENT`,`INK`,`MUTED`,`LINE`,`ZEBRA`) | `:64-83` |
| `report/useReportPagination.js` | `useReportPagination(blocks, deps) → pages: number[][]` | `:1033-1052` |
| `report/HeaderBlock.jsx` | `HeaderBlock({ title, company, siteName, metaItems, logoSrc, onImageLoad })` | `:800-826` |
| `report/pdfExport.js` | `loadPdfScripts`, `printLocal`, `generatePdfBlob`, `urlToDataUrl` | `:41-55, 239-252, 554-697` |

**`PostBlastReportModal` is refactored to import from this module** — behaviour-preserving, and it is the regression canary for the extraction.

#### Invariants that must survive extraction

These are non-obvious html2canvas/print workarounds already encoded in the source. Losing any of them silently corrupts the PDF:

1. Block spacing uses `marginBottom`, **never** flex `gap` — html2canvas 1.x ignores flex gap.
2. `PageSheet` sets `lineHeight: 1.25` explicitly — default `normal` shifts text baselines in the raster.
3. All colours are inline hex — CSS vars / Tailwind classes do not resolve in html2canvas.
4. `.pbr-page` is forced to `height: 1120px !important` in the print path — a hair under A4, so the forced break never spills a blank page.
5. Every `<img>` carries `onLoad={bumpMeasure}` — re-paginates once real dimensions land.
6. `document.title` is swapped during iframe print — Chromium takes the PDF filename from the top document.

### Data flow

```
SensorDetail / RadarMonitoring
   │  sensor  { wallfolder_id, radar_number, site_name, brand, quality,
   │            normalised_score, timezone, dqp_record_id, … }
   ▼
ReportGeneratorModal  ── category='Comprehensive', frequency → granularity
   │                     reportInfo { generatedBy, site, company, period, … }
   ▼
useComprehensiveReportData(sensor, window)     ← NEW hook, one fetch orchestrator
   ├── dqp_values + parameters      → buildRadarData()          (existing)
   ├── def_records (active heads)   → resolveTimelineChain()    (existing)
   │                                → trimChain()               (NEW, pure)
   ├── downtime_records             → computeAvailability()     (NEW, pure)
   ├── alarm_regions → alarm_records→ aggregateAlarmCauses()    (NEW, pure)
   └── RPC get_alarm_stats_by_shift → valid/total
   ▼
ComprehensiveRadarTemplate → buildBlocks() → useReportPagination → PageSheet[]
   ▼
printLocal()  (user download, vector)  +  generatePdfBlob() → Supabase `Reports` bucket
```

### Integration gap 1 — `reportInfo` is silently dropped

`RadarTemplate` is declared `({ data, sensor, exportMode })` (`RadarReportTemplates.jsx:117`). Both call sites pass `reportInfo` (`ReportTemplateModal.jsx:29` and `:302`) — **it is never destructured**. Everything the modal computes (`generatedBy`, `site`, `company`, `period`) is therefore discarded, and the template re-derives its own date with `new Date()` at `:119`.

This directly blocks the mockup header, whose `Author` and `Greatland Gold – Telfer Gold Mine Operations` subtitle exist **only** in `reportInfo`. `ComprehensiveRadarTemplate` must accept and destructure it:

```js
ComprehensiveRadarTemplate({ data, sensor, reportInfo, exportMode = false })
```

The existing `RadarTemplate` Data Quality branch is left as-is (it doesn't use them). The modal's Radar branch (`:435-451`) already populates `reportInfo` correctly and needs no change.

### Integration gap 2 — the modal's export path is incompatible

`saveReportToSupabase` (`ReportTemplateModal.jsx:231-425`) rasterizes by **slicing one tall container at fixed y-offsets**:

```js
const pageHeight = isRadarTemplate ? 1754 : 720;                    // :253
const totalPages = isRadarTemplate ? radarTotalPages : 5;           // :254
for (let i = 0; i < totalPages; i++) {
  const yOffset = i * pageHeight;                                   // :324
  await window.html2canvas(container, { y: yOffset, height: pageHeight, ... });
}
```

This requires the page count to be **known in advance** and every page to be **exactly `pageHeight` tall**. The block engine satisfies neither: page count is discovered by measurement, and pages are 1123px. Worse, the appendix page math is duplicated — computed at `:247-250` in the modal *and* independently at `RadarReportTemplates.jsx:218` in the template. If those two expressions ever drift, the loop crops the wrong page ranges.

The Comprehensive branch therefore **must not reuse this path**. It uses the extracted `generatePdfBlob()`, which captures per `.pbr-page` element and derives the count from the DOM, eliminating the duplicated math:

```js
const pageEls = Array.from(container.querySelectorAll('.pbr-page'));
for (let i = 0; i < pageEls.length; i++) { await window.html2canvas(pageEls[i], { scale: 2, ... }); }
```

`saveReportToSupabase` gains a branch on `category === 'Comprehensive'` delegating to the shared exporter. The Data Quality and InSAR paths are untouched.

> **Pre-existing risk, unchanged by this design.** html2canvas and jsPDF are injected from **cdnjs at click time** with no fallback (`ReportTemplateModal.jsx:259-280`) — report generation hard-fails offline or if cdnjs is blocked. `package.json` lists `html2pdf`/`html2pdf.js` as dependencies that are never used. Out of scope; worth a separate ticket.

---

## Section Designs

### 1. Header, Footer, Image sections (req 1)

Reused from the shared module. The header is **block index 0 and appears on page 1 only**; the footer is absolutely positioned inside **every** `PageSheet`.

Header is fully data-driven off `metaItems`, so the mockup's `Edition | Author` line is configuration, not new code:

```js
const metaItems = [
  { label: 'Edition', value: fmtLongDate(new Date(endDate)) },
  { label: 'Author',  value: displayName },
  { label: 'Sensor',  value: sensor.radar_number },
];
```

**The header logo is the CLIENT's, not DTG's** — DTG's mark belongs to the footer, and the header identifies who the report is *for*. Sourced from `clients.logo_path` and rewritten `../CompanyLogo/…` → `/logo/…` by `normalizeLogoPath`, the same path the Post-Blast report uses (`PatternRecognitionPopup.jsx:645`). Falls back to the DTG mark when a client has no logo on file. `ReportTemplateModal`'s existing `clients` select had to gain `logo_path`. The export path inlines it via `urlToDataUrl` first — html2canvas cannot fetch mid-rasterization, so a network `<img>` would snapshot blank.

> **Correction to the brief.** The literal string `DAILY RADAR REPORTING SERVICES` does not exist in either repo. The header renders `` `${analysisTitle.toUpperCase()} REPORT` ``, so the mockup title is produced by passing `analysisTitle="Daily Radar Reporting Services"`. Likewise the subtitle is `company – siteName` (mockup: `Greatland Gold – Telfer Gold Mine Operations`), not a fixed tagline. The footer string is exact: `Advanced Geotechnical Data Analytics. Powered by DTG Focus`.

**Image sections** follow the pattern-recognition idiom exactly: data-URL sources (never object URLs or raw remote URLs — html2canvas cannot fetch during rasterization), `maxHeight` cap so a figure always fits one page, `onLoad={bumpMeasure}`, and the `SectionBar` + borderless-top box wrapper. Supabase Storage images are converted via `urlToDataUrl()` **before** export, mirroring `RadarTemplate`'s existing `createSignedUrl` → fetch → data-URL step.

#### Upload + zone drawing

The Deformation figure carries the **full pit-viewport interaction from the Post-Blast report**: drag-and-drop or file-picker upload, and click-to-draw labelled polygon zones. Extracted into `report/useImageAnnotation.js` (state + handlers) and `report/AnnotatedImage.jsx` (viewport + toolbar), and `PostBlastReportModal` now consumes them, so there is one implementation rather than two.

It is seeded with the sensor's deformation heatmap from Storage, once — a later refetch must not clobber an analyst's upload. Points are stored as **percentages** of the image box against a `viewBox="0 0 100 100" preserveAspectRatio="none"` overlay, so annotations land identically at preview and export size.

Two non-obvious constraints, both load-bearing:

1. **The annotation state is owned by the caller (`ReportTemplateModal`), not the template.** The export mounts a *second* instance of the template in a detached container; template-local state would start empty there and the uploaded image would silently vanish from the PDF.
2. **Blocks are built twice — interactive for the page, static for the measurement layer.** Both are mounted simultaneously, so one shared interactive set would bind `imageRef` twice and the hidden measurement copy would win, making every click measure against an off-screen element. This is why `PostBlastReportModal` has `buildBlocks(interactive)`; the Comprehensive template mirrors it.

The toolbar is screen-only and lives outside the paginated paper, so it never reaches the PDF.

### 2. Executive Summary KPIs (req 2)

Four tiles, matching the mockup left→right.

| Tile | Value | Source | Notes |
|---|---|---|---|
| **Risk Level** | `TARP 4` + `Critical` | `def_records.tarp_level` → max of `getRiskPriority()` | Same live recomputation as `SensorDetail.jsx:213-231`; empty → `TARP 1` |
| **Data Quality** | `Sub-Optimal` + `85.00%` | `latest_radar_wall_folders.quality`, `normalised_score` | `(normalised_score * 100).toFixed(2)` — mirrors `SensorDetail.jsx:1505` |
| **System Uptime** | `98.13%` | `computeAvailability(downtime_records, window)` | See granularity below |
| **Alarm Events** | `0/55` (Valid/Total) | RPC `get_alarm_stats_by_shift`, summed across regions | See open question OQ-3 |

> **Correction made during implementation (supersedes Requirement 2.9).** Tile colours were specified to come from `getRiskColor` / `getQualityColor` in `config/statusConfig.ts`. Those helpers return **Tailwind class strings** (`'bg-red-500/20 text-red-400 border-red-500/30'`), not colours. The export paths render into a bare print iframe / detached container with no stylesheet, so the classes resolve to nothing and html2canvas rasterizes them as transparent — the tiles would print colourless. Report colours must be inline hex.
>
> The implementation instead uses `report/severity.js`, whose values mirror the `C` map in `RadarReportTemplates.jsx` — the palette the existing Data Quality PDF already prints, so the two radar reports stay consistent. `getStatusDefinition` (which returns text, not classes) is still reused as specified.

#### Uptime and granularity — the significant gap

**There is no granularity concept in the codebase today.** `grep -i granularity` returns zero hits. The only real uptime computation is `RadarDetail.jsx:646-743`, hardcoded to a fixed 24h window in **two** places that must both be parameterised:

```js
const windowStart = new Date(Date.now() - 24 * 60 * 60 * 1000);  // :650  ← window
const totalWindowHours = 24;                                      // :703  ← denominator
```

This design extracts and generalises that logic into a pure function:

```js
// utils/reportAvailability.js
computeAvailability(records, windowStart, windowEnd) → {
  mechanical: { [reason]: { hours: number, percentage: number } },
  useOf:      { [reason]: { hours: number, percentage: number } },
  uptimePercentage: number,
}
```

Preserving the existing (and easy-to-miss) two-denominator rule:

- `totalWindowHours = (windowEnd - windowStart) / 3.6e6` — no longer a literal `24`.
- Mechanical reasons (`Maintenance`, `Relocation`, `Radar System Issue`): `pct = hours / totalWindowHours * 100`.
- `availableHours = totalWindowHours - totalMechanicalHours`.
- Use-of reasons (`Connection`, `PMP Issue`): `pct = hours / availableHours * 100`, falling back to `totalWindowHours` when `availableHours <= 0`.
- `mechanicalAvailability = 100 - Σ(mechanical pct)` and `useOfAvailability = 100 - Σ(use-of pct)` — the two gauge rings, mirroring `gaugelive.jsx:18-26`. Both forced to `0` when the radar is off.
- `uptimePercentage = (totalWindowHours - totalDowntimeHours) / totalWindowHours * 100`, clamped to `[0,100]`.

> **Correction made during implementation.** This section previously specified `uptimePercentage = 100 - Σ(all percentages)`. That is wrong: mechanical percentages are over the window while use-of percentages are over `availableHours`, so summing them adds figures with different denominators and can exceed 100 for a radar that was mostly up. Overall uptime is therefore derived from **hours**, not percentages. The two ring figures keep their own denominators, exactly as the live gauge computes them.

> **Inherited behaviour, deliberately preserved.** Overlapping downtime records are **not** merged — two `Maintenance` records covering the same 12h both count in full, so a reason's hours can exceed the window. `RadarDetail` has always done this. Every percentage is clamped to `[0,100]`, so the effect degrades to "fully down" rather than producing nonsense. Merging intervals would be more correct but would change numbers the live dashboard has shown for as long as it has existed — a separate decision, not a silent side-effect of this feature. Property 5 asserts per-**record** clipping, which is the invariant that actually holds.

Records are overlap-clipped against the window (`max(from, windowStart)` → `min(to ?? windowEnd, windowEnd)`), exactly as `RadarDetail.jsx:679-699` does today.

Granularity maps from the **existing frequency picker** (`daily`/`weekly`/`monthly` at `ReportTemplateModal.jsx:110-114`) — no new UI control:

| Frequency | Window |
|---|---|
| `daily` | `endDate − 24h → endDate` |
| `weekly` | `endDate − 7d → endDate` |
| `monthly` | `endDate − 30d → endDate` |

**Returning `hours`/`percentage` as `number`, not `string`, is an intentional break** from the current shape (`RadarDetail.jsx:719-730` emits `.toFixed()` strings that `gaugelive.jsx:19` defensively re-wraps in `Number()`). Formatting moves to the render layer. `GaugeLive` keeps working either way because of that existing `Number()` coercion, but the call site is updated to pass numbers.

### 3. Deformation section (req 3)

An image block (the 3D-DTM heatmap from Storage bucket `Deformation`, path `${Company}/${Site}/${WallFolder}.jpg` per `RadarDetail.jsx:765-767`) followed by the trimmed event timeline.

#### Chain trimming rule

Full chains are resolved with the existing `resolveTimelineChain()` (`utils/tabHelpers.js:155-214`), which returns `root → current`. The report then trims:

> Show the **current** node, plus its **precursors that occurred within the latest 24 hours**, plus **one** node of context immediately preceding that recent set.

Worked against the brief's examples (`D` = current):

| Full chain | Recent (≤24h) | Rendered | Why |
|---|---|---|---|
| `A→B→C→D`, `C` and `D` within 24h | `C, D` | **`B→C→D`** | `C,D` recent + `B` as the one context node |
| `A→B→C→D`, only `D` within 24h | `D` | **`C→D`** | `D` recent + `C` as the one context node |

Formalised as a pure function:

```js
// utils/reportTimeline.js
trimChain(chain, now, windowMs = 24*3600*1000) → object[]
```

```
recentStartIdx = min{ i : chain[i].created_at >= now - windowMs }   // scanning from the tail
if no node is recent           → return last 2 nodes (or 1 if chain.length === 1)
contextIdx = max(0, recentStartIdx - 1)
return chain.slice(contextIdx)
```

Edge cases: single-node chain → that node alone; every node recent → whole chain (no context node exists to prepend).

**`isRoot` / `isCurrent` badges are positional** (`TimelineView.jsx:64-66`) — computed as `index === 0` / `index === chain.length - 1`. After trimming, `index 0` is no longer the true root, so the report **must not reuse `TimelineView`'s badge logic**. The mockup confirms this: the first node shows a `Root` chip only because it genuinely is the root. The report renders `Current` on the tail, and `Root` on the head **only when the trimmed head is also the true chain head** (`contextIdx === 0`).

Per-node fields (mockup ↔ DB): `def_type` (title), `tarp_level` (badge), `location`, `created_at` → "Detected", `resolveDetectedBy(detected_by, crosscheckers)` → "By".

**Performance.** `resolveTimelineChain` is N+1 (one round-trip per ancestor, plus one per `related`). For a single sensor's head records this is acceptable — the Data Quality report already tolerates comparable latency. If the report is later batched across sensors (see the report scheduler spec), this must become a recursive-CTE RPC. Flagged, not solved here.

### 4. Data Quality radar chart (req 4)

Reuses `RadarMetricsChart` (`components/Radars/Live/RadarMetricChart.jsx`) and `buildRadarData()` (`components/Radars/Live/radarChart.js:21-43`) as-is. Library is `recharts`, already a dependency.

**The axis count is 5–7, not fixed** (`radarChart.js:24-31`):
- `Visual Data` is dropped for `XT` radars.
- `Photograph` is dropped for non-`GroundProbe` brands.

The block must not assume a pentagon. The mockup happens to show 6 axes.

**Blocker — the `record.parameters` tree is built inside `RadarGallery.jsx:437-627`, not in a reusable function.** `buildRadarData(record)` needs that tree, but the pivot logic is entangled with gallery-specific fetching. This design extracts the pivot into:

```js
// utils/buildRadarRecord.js
buildRadarRecord({ wallFolderRow, dqpValues, parameters }) → record
```

called by both `RadarGallery` and the report hook. This is the largest single refactor in the feature and the main source of regression risk — `RadarGallery` is a live-monitoring surface.

> **Pre-existing bug found during design (out of scope, but blocks a clean extraction).** In the pivot, level-0/1 entries are keyed by raw `p.name` (`RadarGallery.jsx:509`, e.g. `"System Health"`) while level-2 parent lookup strips spaces (`:536`, `"SystemHealth"`). They never match, so a **duplicate placeholder parent** is created for every multi-word parameter. `buildRadarData` reads the spaced key and works; `getIssues()` (`RadarDetail.jsx:135-160`) walks `children` off the placeholder. The extraction must **preserve this behaviour verbatim** to avoid changing what the live gallery renders. Fixing it is a separate ticket. See OQ-4.

**Recharts + html2canvas — resolved (Task 1).** The predicted risk was raster fidelity of recharts' SVG. That is **not** the problem: recharts' default axis ticks are plain `<text>`, not `foreignObject`, and rasterize fine. No PNG pre-render is needed.

The real blocker is `ResponsiveContainer`. `RadarMetricsChart` wraps its chart in `<ResponsiveContainer width="100%" height="80%">` (`RadarMetricChart.jsx:74`), which measures its **parent**. In the hidden measurement layer and the detached export container the parent has no resolved height, so `height="80%"` computes to **0** and the chart renders blank into the PDF.

Fix: `RadarMetricsChart` takes optional `width`/`height` props. When both are supplied it renders `RadarChart` directly at that fixed pixel size, bypassing `ResponsiveContainer` entirely, and disables entry animation so a snapshot can't catch a half-drawn polygon. The live dashboard passes neither and is untouched. This keeps Requirement 4.1 satisfied — the report reuses the existing component and its existing data builder, rather than forking a print-only chart.

**Axis labels are drawn outside the polygon**, so a chart box sized to the polygon clips them — `Atm. Correction` and `Scan Area` were rendering as `rection` and `Scan A`. `RadarMetricsChart` therefore also accepts `outerRadius`, `margin`, `tickFontSize` and `tickColor`, all defaulting to today's live values. The report passes a `{ left: 54, right: 54 }` margin to reserve label room, a reduced `72%` radius, and an 8px tick. The label length that drives this is `Atm. Correction`, the longest in `PARAMETER_LABELS`.

(Also hardened while there: `record.parameters.Overall?.value` → `record.parameters?.Overall?.value`. The former throws outright when `parameters` is undefined.)

### 5. Data Quality detailed table — every group, failures first (req 5)

> Requirement 5 was revised after the first visual review: the table prints every
> assessed group, not only the failing ones, with optimal groups collapsed to a
> single line. `buildStatusGroups` supersedes the `buildNonOptimalGroups` filter
> sketched below — it applies the same `isNonOptimal` predicate, but as a flag
> and a sort key rather than as a filter. See requirements.md for the rationale.

Filter and presentation reused from `RadarTemplate` (`RadarReportTemplates.jsx:195-198`):

```js
data.filter(item =>
  item.value !== 'Optimal' && item.value !== 'N/A' && item.value !== null &&
  item.parameter?.level !== 0 && item.parameter?.level !== 1
)
```

Rendered with the existing grouped layout: coloured status bar, uppercase group name, `➤` note bullets with `(Appendix X)` cross-references, and the `Sub-Parameter Status` legend row — i.e. `RadarReportTemplates.jsx:298-388`, restyled to the A4 block metrics. `getStatusStyle` and `getStatusDefinition` are reused unchanged.

The mockup's `SCAN AREA` / `VISUAL DATA` rows are exactly this component with `Optimal` groups filtered out.

### 6. Data Availability donut (req 6)

Reuses `GaugeLive` (`components/Radars/Live/gaugelive.jsx`) — hand-rolled inline SVG, no chart library, so it rasterizes cleanly. Fed from `computeAvailability()` (§2).

> **Correction to the brief.** The requested labels `Convection` and `PWP Issue` **do not exist** — `grep -i "convection\|PWP Issue"` returns zero hits repo-wide. The canonical five downtime reasons (`SensorDetail.jsx:1545`) are `Radar System Issue`, `Maintenance`, `Relocation`, **`Connection`**, **`PMP Issue`** (PMP as in the "Reboot PMP" downtime action). Split: 3 → Mechanical Availability, 2 → Use of Availability. This design uses the code's names. See OQ-2.

### 7. Alarm cause pie chart, latest 24h (req 7)

New block. Data path is two-step because **`alarm_records` has no direct wall-folder FK** — canonical implementation at `AlarmTab.jsx:64-106`:

1. `alarm_regions.select('id, name, alarmtype').eq('wallfolder', sensor.wallfolder_id)` → `regionIds`; short-circuit to empty when none.
2. `alarm_records.select('id, triggered_at, alarm_region, location, reason, cause, detected_by').in('alarm_region', regionIds).gte('triggered_at', since).order('triggered_at', { ascending: false })`

**Filter on `triggered_at`, not `created_at`** — the latter is row-insert time and the two can disagree.

```js
// utils/reportAlarms.js
aggregateAlarmCauses(records) → { cause: string, count: number, percentage: number }[]
```

Causes come from `alarm_records.cause`, validated against the two-level `CAUSE_OPTIONS` taxonomy keyed by `reason` (`config/formConfig.ts:436-449`). All eight causes in the mockup are `reason='False'` entries.

> **Correction to the brief.** Mockup/brief label → actual enum: `Blasting` → `Blasting Event`; `Diurnal` → `Diurnal Pattern`; `Sandstorm` → `Sandstorm Event`; `Atmospheric` → `Rapid Atmospheric Changes`; `Link Down` → `Step After Link Down`; `Water` → `Water Refraction` (possibly also `Rainfall Event` — see OQ-5). `Machinery Activity` and `Vegetation` match exactly.

> **The mockup's pie is wrong and must not be replicated.** Its slice labels read `Machinery Activity: 3500`, `Vegetation: 1500%`, `Atmospheric: 2000%` — raw counts rendered with a `%` suffix, summing far past 100. The implementation renders **either** count **or** percentage per slice, with `percentage = count / total * 100`, and the two agree by construction. (The truncated `egetation` / `mospheric` / `Sandstorm: 800%` labels also indicate clipped text — the pie block reserves label width.)

The pie is hand-rolled SVG in the `GaugeLive` idiom (arc paths via `strokeDasharray` on a circle, or explicit `path` arcs), keeping the zero-dependency, raster-safe property. Slice colours come from the categorical palette; `getCatConfig` / `getTypeConfig` in `statusConfig.ts` are reused if their cardinality suffices, else a local 8-colour constant.

### 8. Section title for §6 + §7 (req 8)

The brief asks whether `Performance Matrix` is a good name. **It is not** — "matrix" implies a grid/table, and the section is two charts; the term also has an established, different meaning in geotechnical monitoring.

The section contains availability (uptime, downtime attribution) and alarm causes (nuisance-alarm attribution). Both answer *"how well did the monitoring system itself perform, and why did it underperform?"* — neither is about slope behaviour.

**Recommendation: `System Performance`.** It is accurate, plain, and reads as the natural sibling of the adjacent `Data Quality` and `Deformation/Event` headings.

Alternatives, if a different emphasis is wanted:

| Option | Reads as | Trade-off |
|---|---|---|
| **`System Performance`** ✅ | Uptime + alarm behaviour of the radar | Recommended — accurate, sits naturally beside `Data Quality` |
| `Operational Performance` | Performance of the monitoring operation | Slightly broader; hints at crew/process, not just the instrument |
| `Availability & Alarms` | Literally the two subsections | Unambiguous but flat; doesn't generalise if a third chart is added |
| `Performance Matrix` ❌ | — | Rejected: "matrix" implies a grid; misleading |

Confirm before implementation — it is a one-constant change either way. See OQ-1.

### 9. Glossary and Appendix (req 9)

Reused from the Data Quality template with no logic changes, restyled to A4 block metrics.

- **Glossary** — `getGlossaryForRadar(sensor.radar_number)` (`config/glossaryConfig.ts:148`). Already radar-model aware (`PS`/`XT`/`FX`/`SARx`/`Omni` via `parseRadarType`), so the term list self-adjusts per sensor. Rendered as `RadarReportTemplates.jsx:461-467`.
- **Appendix** — items where `notes && (image || appendix)`, sorted by `parameter.id`, lettered `A, B, C…` via `getLetter()`, with `(Appendix X)` back-references from the §5 table (`RadarReportTemplates.jsx:200-219, 479-527`). Figure captions: `Figure {n}. {caption ?? parameter.name}`.
- **Disclaimer** — the existing `Disclaimer` component, on the final page only.

Under the block engine, `ITEMS_PER_PAGE = 2` appendix chunking is **no longer needed** — each appendix item becomes one block and the paginator places it. The `maxHeight: 450px` image cap is retained (as `PIT_MAX_H`-style constant) so a single item always fits a page.

---

## Components and Interfaces

### New components

| Component | Path | Props |
|---|---|---|
| `ComprehensiveRadarTemplate` | `components/admin/Reports/ComprehensiveRadarTemplate.jsx` | `{ data, sensor, reportInfo, exportMode = false }` |
| `ExecutiveSummaryBlock` | `.../report/blocks/ExecutiveSummary.jsx` | `{ risk, quality, uptime, alarms }` |
| `KeyFindingsBlock` | `.../report/blocks/KeyFindings.jsx` | `{ findings: {text, detail, tone}[] }` |
| `DeformationBlock` | `.../report/blocks/Deformation.jsx` | `{ imageDataUrl, chain, crosscheckers, timezone }` |
| `DataQualityBlock` | `.../report/blocks/DataQuality.jsx` | `{ radarRecord, groups, appendixByParamId }` |
| `SystemPerformanceBlock` | `.../report/blocks/SystemPerformance.jsx` | `{ availability, alarmCauses }` |
| `AlarmCausePie` | `.../report/blocks/AlarmCausePie.jsx` | `{ slices: {cause, count, percentage}[], size }` |

### Shared module (extracted from `PostBlastReportModal.jsx`)

| Export | Signature |
|---|---|
| `PageSheet` | `({ blocks, idxs, pageNum, total }) → JSX` |
| `ReportPages` | `({ blocks, pages }) → JSX` |
| `FooterLogo` | `() → JSX` |
| `SectionBar` | `({ title }) → JSX` |
| `HeaderBlock` | `({ title, company, siteName, metaItems, logoSrc, onImageLoad }) → JSX` |
| `useReportPagination` | `(deps: any[]) → { pages, measureRef, measureLayer, bumpMeasure }` |
| `resolvePages` | `(pages, blocks) → number[][]` — pre-measurement fallback |
| `useImageAnnotation` | `(initialImage) → { image, boundaries, draft, color, handleDrop, addPoint, … }` |
| `AnnotatedImage` | `({ image, boundaries, draft, interactive, imageRef, … }) → JSX` |
| `AnnotationToolbar` | `({ annotation, label }) → JSX` — screen-only |
| `generatePdfBlob` | `(pagesNode, pageWidth) → Promise<Blob>` |
| `printLocal` | `(pagesNode, title) → Promise<void>` |
| `urlToDataUrl` | `(url: string) → Promise<string>` |

### New pure functions

| Function | Path | Signature |
|---|---|---|
| `trimChain` | `utils/reportTimeline.js` | `(chain, now, windowMs?) → object[]` |
| `computeAvailability` | `utils/reportAvailability.js` | `(records, windowStart, windowEnd) → { mechanical, useOf, uptimePercentage }` |
| `aggregateAlarmCauses` | `utils/reportAlarms.js` | `(records) → { cause, count, percentage }[]` |
| `buildRadarRecord` | `utils/buildRadarRecord.js` | `({ wallFolderRow, dqpValues, parameters }) → record` |

### Reused unchanged

`RadarMetricsChart`, `buildRadarData`, `GaugeLive`, `resolveTimelineChain`, `normalizePrecursorss` *(note the double-s — that is the real exported name)*, `resolveDetectedBy`, `getGlossaryForRadar`, `getStatusDefinition`, `getStatusStyle`, `getRiskColor`, `getQualityColor`, `CAUSE_OPTIONS`, `TYPE_MATRIX`.

### Modified

| File | Change |
|---|---|
| `ReportTemplateModal.jsx` | `ReportTemplateRenderer` passes `category`; `saveReportToSupabase` branches to the shared exporter for Comprehensive |
| `RadarReportTemplates.jsx` | `RadarTemplate` branches on `category` → delegates to `ComprehensiveRadarTemplate` |
| `PostBlastReportModal.jsx` | Imports the extracted module instead of module-private copies (behaviour-preserving) |
| `RadarGallery.jsx` | Calls extracted `buildRadarRecord` instead of the inline pivot (behaviour-preserving) |

---

## Data Models

No schema changes. All reads use existing tables/views/RPCs.

| Source | Kind | Used for |
|---|---|---|
| `latest_radar_wall_folders` | view | Sensor identity, `quality`, `normalised_score`, `brand`, `timezone` |
| `parameters` | table | Parameter tree (`id, name, parent_id, level, weight`) |
| `dqp_values` | table | Per-parameter `value`, `notes`, `appendix`, `caption`, `image:client_images(image_url)` |
| `def_records` | table | Deformation chain — `precursors INT[]`, `tarp_level`, `def_type`, `isactive` |
| `downtime_records` | table | Availability — `from`, `to` (nullable = ongoing), `reason` |
| `alarm_regions` | table | Region lookup by `wallfolder` |
| `alarm_records` | table | Alarms — `triggered_at`, `reason`, `cause` |
| `get_alarm_stats_by_shift` | RPC | Valid/total counts |
| Storage `Deformation` | bucket | Heatmap image |
| Storage `Radar` | bucket | Appendix images |
| Storage `Reports` | bucket | PDF archive destination |

The `reports` row written on save reuses the existing insert at `ReportTemplateModal.jsx:375-387` with `category: 'comprehensive'`.

### Stale documentation corrected during this design

- `.kiro/specs/sensor-detail-tabs-redesign/design.md:293` types `def_records.precursors` as `uuid` FK. It is **`INT[]`** — `utils/tabHelpers.js:118-121` is authoritative and explicitly tolerates the legacy scalar shape.
- The same doc (`:311-319`) names `alarm_regions.wallfolder_id`. The column actually queried is **`wallfolder`** (`AlarmTab.jsx:75`, `SensorDetail.jsx:377`).

---

## Correctness Properties

Invariants that must hold for arbitrary inputs. These are the property-test targets (consistent with the existing `__tests__/*.pbt.test.js` suite).

### Property 1: Trimmed chain is a contiguous suffix

For any `chain` and `now`, `trimChain(chain, now)` is a non-empty contiguous suffix of `chain` and always contains `chain[chain.length - 1]`. It never reorders, never drops the current node, and never returns nodes absent from the input.

**Validates: Requirements 3.3, 3.6, 3.7, 3.8**

### Property 2: Trim includes every recent node

Every node with `created_at >= now - windowMs` appears in the output. The trim only ever adds context *before* the recent set.

**Validates: Requirements 3.3, 3.4, 3.5**

### Property 3: Root badge is truthful

The `Root` badge renders **iff** the trimmed head is `chain[0]`. This is what breaks if `TimelineView`'s positional `index === 0` logic is reused post-trim.

**Validates: Requirements 3.9**

### Property 4: Uptime is a bounded complement of downtime

`uptimePercentage ∈ [0, 100]` for any record set, and equals `100 - Σ(all reason percentages)` clamped to that range. Radar off ⇒ exactly `0`.

**Validates: Requirements 2.5, 2.8**

### Property 5: Downtime clipping is window-bounded

No record contributes more hours than the window spans; records fully outside contribute exactly `0`; `to = null` is treated as "ongoing" and clips to `windowEnd`, never to `now`.

**Validates: Requirements 6.7, 2.7**

### Property 6: Availability denominators stay consistent

Mechanical percentages are over `totalWindowHours`; use-of percentages are over `availableHours = totalWindowHours - totalMechanicalHours`, falling back to `totalWindowHours` when `availableHours <= 0`. Never divides by zero.

**Validates: Requirements 6.5, 6.6**

### Property 7: Alarm percentages are a partition

For non-empty input, `Σ percentage === 100` within float tolerance, and `Σ count === records.length`. No record is dropped, including causes outside `CAUSE_OPTIONS`.

**Validates: Requirements 7.5, 7.9**

### Property 8: KPI and chart agreement

The Alarm Events tile numerator/denominator and the pie's total derive from the **same** record set, so they cannot contradict each other (contingent on OQ-3(a)). Likewise the System Uptime tile and the donut both read one `computeAvailability()` result.

**Validates: Requirements 2.6, 6.4**

### Property 9: Pagination loses nothing

`pages.flat()` is exactly `[0..blocks.length-1]` in order — every block appears on exactly one page, none duplicated or dropped, regardless of measured heights.

**Validates: Requirements 11.2, 9.7**

### Property 10: Preview equals export

The page count and block-to-page assignment are identical between the on-screen preview and both export paths, since all three consume the same `pages` array.

**Validates: Requirements 11.1, 11.3**

---

## Error Handling

| Condition | Behaviour | Rationale |
|---|---|---|
| `data` has no level-0 row | Render `—` in the Data Quality tile; do not throw | `RadarTemplate:289` calls `overallStatus.toLowerCase()` unguarded and **crashes** today. The new template must not inherit this. |
| `getStatusDefinition(unknown)` | Fall back to a neutral definition | Has no `default` case (`statusConfig.ts:227-235`) — returns `undefined`. Safe at `:289` via `?.`, but `:429`/`:445` would throw. |
| No deformation records | Omit the timeline, keep the section with an empty state | A quiet sensor is normal, not an error |
| `resolveTimelineChain` partial failure | Render the partial chain + the existing `'Timeline may be incomplete.'` notice | Matches `tabHelpers.js:155-214`, which returns partial chains with `error` set |
| Chain exceeds `maxDepth = 50` | Truncate, surface the same notice | Existing guard |
| No alarm regions for the wall folder | Empty pie block, `0/0` tile | `AlarmTab.jsx:83-86` already short-circuits on this |
| Zero alarms in window | Empty state, **not** a NaN/zero-radius pie | `percentage = count/total` divides by zero |
| `availableHours <= 0` | Fall back to `totalWindowHours` denominator | Preserves `RadarDetail.jsx:727` behaviour |
| Storage image missing / signed URL fails | Skip the image block, keep the section | Report must still generate |
| `urlToDataUrl` fails | Fall back to the raw URL | Existing behaviour |
| cdnjs unreachable | Surface the failure in the modal's `message` | Pre-existing hard dependency; at minimum it must not fail silently |
| Recharts/SVG rasterizes blank | Caught by the §4 prototype gate | The reason that task is scheduled first |

**Signed-URL expiry** is not an error path: URLs expire in 1h but images are rasterized into the PDF at capture time, so expiry degrades only a long-lived preview, never a saved PDF.

---

## Testing Strategy

The three pure functions carry the feature's real logic and are tested in isolation, consistent with the existing `__tests__/*.pbt.test.js` property-test suite.

**`trimChain(chain, now, windowMs)`** — the brief's two worked examples become explicit cases:
- `A→B→C→D` with `C,D` recent → `[B,C,D]`
- `A→B→C→D` with `D` recent → `[C,D]`
- Single-node chain → `[D]`
- No recent nodes → last 2
- All nodes recent → whole chain
- Property: output is always a non-empty contiguous **suffix** of the input, and always contains the tail.

**`computeAvailability(records, start, end)`**:
- Ongoing downtime (`to = null`) clips to `windowEnd`.
- Records straddling either window edge clip correctly.
- Records fully outside contribute 0.
- `availableHours <= 0` (fully mechanically down) falls back to the `totalWindowHours` denominator without dividing by zero.
- Property: `uptimePercentage ∈ [0, 100]` for arbitrary record sets.
- **Regression:** for a 24h window, output matches current `RadarDetail.jsx:646-743` numbers exactly.

**`aggregateAlarmCauses(records)`**:
- Empty → `[]` (and the block renders an empty state, not a NaN pie).
- `Σ percentage === 100` (within float tolerance) whenever `records.length > 0`.
- Unknown `cause` values outside `CAUSE_OPTIONS` are bucketed, not dropped.

**Visual/integration** (manual, per the `/verify` flow): generate a Comprehensive report against a sensor with a ≥4-node deformation chain, ≥1 non-optimal parameter, ≥1 appendix image, and ≥8 distinct alarm causes; confirm preview and exported PDF agree page-for-page and no block is clipped. `PostBlastReportModal` is re-generated unchanged as the extraction canary.

---

## Open Questions

All resolved — recorded here for traceability.

**OQ-1 — Section title (req 8). → `System Performance`.** "Matrix" implies a grid; the section is two charts. Lives in `SECTION_TITLE_SYSTEM_PERFORMANCE` (`report/constants.js`).

**OQ-2 — Downtime labels (req 6). → The code's names.** The brief's `Convection` / `PWP Issue` do not exist anywhere in the repo or DB; the canonical reasons are `Connection` and `PMP Issue`. Treated as typos.

**OQ-3 — Alarm KPI window (req 2 vs req 7). → Option (a).** The tile now derives from the same 24h `alarm_records` set as the pie, via `countValidTotal`, so the two agree by construction (Property 8). This also drops the shift-scoped `get_alarm_stats_by_shift` RPC and with it its hardcoded `_user_timezone: 'Asia/Jakarta'`.

**OQ-4 — Radar-chart extraction risk (req 4). → Preserve verbatim.** `pivotParameterTree` reproduces the key collision exactly, including the duplicate placeholder parents that `getIssues()` depends on. A regression test pins the behaviour so the move is provably inert. The fix is a separate ticket.

**OQ-5 — `Water` cause mapping (req 7). → Two slices.** `Water Refraction` and `Rainfall Event` are distinct causes with distinct operational responses; merging them would hide which one drove the alarms. The pie renders the raw `cause` values.

**OQ-6 — Report trigger surface. → Sensor-scoped.** Launches from the existing `ReportGeneratorModal`. The N+1 chain resolution stays a documented note, not a blocker.

---

## Scope Boundaries

**In scope:** the Comprehensive template, the shared report module extraction, the three pure derivation functions, the `buildRadarRecord` pivot extraction, and category-based template selection.

**Explicitly out of scope:**
- Fixing the `RadarGallery` key-collision bug (OQ-4).
- Replacing the mock surfaces `components/admin/Radar/{Availability,DataQuality}` and `components/reports/*`.
- MTBF / MTTR / incident metrics — these appear in mock UI but **have no database columns at all**.
- Quality-trend-over-time charts — `get_overall_per_radar_day` returns an ordinal rank, not a percentage.
- Converting chain resolution to a recursive-CTE RPC (revisit if OQ-6 turns out to be site-wide).
- Any change to the Data Quality or InSAR templates beyond the `category` branch.