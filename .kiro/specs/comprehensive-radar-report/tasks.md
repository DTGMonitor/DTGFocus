# Implementation Plan: Comprehensive Radar Report

## Overview

Add a second radar report layout — **Comprehensive** — built on the measured-block pagination engine currently locked inside `PostBlastReportModal`. The work has four phases:

1. **De-risk** — prove recharts rasterizes into the PDF before anything is built on it (Task 1).
2. **Extract** — lift the page frame out of `PostBlastReportModal` and the parameter pivot out of `RadarGallery`, both behaviour-preserving (Tasks 2, 4).
3. **Derive** — three pure functions carrying the report's real logic, property-tested (Task 3).
4. **Compose & wire** — blocks, template, category selection, export branch (Tasks 5–9).

Tasks 2, 3 and 4 are independent of each other. Task 1 gates Task 6.4.

**Resolved open questions:** OQ-1 → `System Performance`. OQ-2 → code's names (`Connection`, `PMP Issue`). OQ-3 → **(a)** derive the alarm tile from the same 24h record set as the pie. OQ-4 → preserve gallery behaviour verbatim. OQ-5 → `Water Refraction` and `Rainfall Event` stay separate slices. OQ-6 → sensor-scoped.

---

## Tasks

- [x] 1. Prototype the recharts → PNG rasterization gate
  - Render `RadarMetricsChart` off-screen and rasterize it via html2canvas at `scale: 2`; inspect the output for blank/clipped SVG (recharts emits `foreignObject` labels that html2canvas 1.x handles poorly).
  - If faithful, keep live SVG in the block. If not, add `utils/rechartsToPng.js` exporting `chartToDataUrl(node) → Promise<string>`, mirroring the Plotly→PNG path at `PostBlastReportModal.jsx:307-343`, and have the block consume a data URL.
  - Record the outcome as a comment in `report/blocks/DataQuality.jsx`; it decides Task 6.4's shape.
  - _Requirements: 4.7_

- [x] 2. Extract the shared page frame from `PostBlastReportModal`
  - [x] 2.1 Create `components/admin/Radar/report/constants.js`
    - Move `PAGE_W`, `PAGE_H`, `PAD_X`, `PAD_TOP`, `FOOTER_RESERVE`, `BLOCK_GAP`, `CONTENT_W`, `USABLE_H` and the palette (`NAVY`, `DARK`, `ACCENT`, `INK`, `MUTED`, `LINE`, `ZEBRA`) from `PostBlastReportModal.jsx:64-83`.
    - Add `IMAGE_MAX_H = 560` (generalises `PIT_MAX_H`) and `SECTION_TITLE_SYSTEM_PERFORMANCE = 'System Performance'`.
    - _Requirements: 1.8, 8.1, 8.3_
  - [x] 2.2 Create `components/admin/Radar/report/pageFrame.jsx`
    - Move `PageSheet`, `ReportPages`, `FooterLogo`, `SectionBar` verbatim from `PostBlastReportModal.jsx:1172-1256`; export all four.
    - Preserve the html2canvas workarounds exactly: `marginBottom` not flex `gap`; explicit `lineHeight: 1.25`; inline hex only; the `.pbr-page` class name.
    - _Requirements: 1.1, 1.6_
  - [x] 2.3 Create `components/admin/Radar/report/HeaderBlock.jsx`
    - Generalise `PostBlastReportModal.jsx:800-826` into `HeaderBlock({ title, company, siteName, metaItems, logoSrc, onImageLoad })`.
    - Title renders `${title.toUpperCase()} REPORT`; subtitle `company – siteName`; `metaItems` drives the pipe-separated row.
    - _Requirements: 1.4, 1.5_
  - [x] 2.4 Create `components/admin/Radar/report/useReportPagination.js`
    - Move the measure-then-pack effect from `PostBlastReportModal.jsx:1033-1052` into `useReportPagination(blocks, deps) → { pages, measureRef, bumpMeasure }`.
    - Own the hidden measurement layer (`PostBlastReportModal.jsx:1147-1165`) so callers cannot forget `width: CONTENT_W`.
    - _Requirements: 11.1, 11.2_
  - [x] 2.5 Create `components/admin/Radar/report/pdfExport.js`
    - Move `loadScript`, `loadPdfScripts`, `urlToDataUrl`, `printLocal`, `generatePdfBlob` from `PostBlastReportModal.jsx:41-55, 239-252, 554-697`.
    - Keep the `document.title` swap, the `height: 1120px !important` print rule, the double-rAF + `img.complete` waits, and per-`.pbr-page` capture.
    - _Requirements: 11.3, 11.4_
  - [x] 2.6 Refactor `PostBlastReportModal.jsx` to import from the module
    - Delete the now-duplicated definitions; import instead. No behaviour change.
    - This is the extraction's regression canary — generate a Post-Blast report before and after and compare page count and layout.
    - _Requirements: 1.2, 1.3_

- [x] 3. Write the pure derivation functions and their property tests
  - [x] 3.1 `utils/reportTimeline.js` — `trimChain(chain, now, windowMs = 24*3600*1000)`
    - Scan from the tail for the earliest node with `created_at >= now - windowMs` → `recentStartIdx`; return `chain.slice(max(0, recentStartIdx - 1))`.
    - No recent node → last 2 nodes (or 1 if the chain has one). Also export `isTrimmedHeadTrueRoot(chain, trimmed)` for the `Root` badge.
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.9_
  - [x] 3.2 `utils/reportAvailability.js` — `computeAvailability(records, windowStart, windowEnd)`
    - Port `RadarDetail.jsx:646-743`, replacing the hardcoded `24` at `:650` (window) and `:703` (denominator) with the passed window.
    - Overlap-clip per record; `to = null` → `windowEnd`. Mechanical over `totalWindowHours`; use-of over `availableHours`, falling back to `totalWindowHours` when `<= 0`.
    - Fold in `gaugelive.jsx:18-26` so `uptimePercentage = clamp(100 - Σpct, 0, 100)`, and `0` when off.
    - Return `hours`/`percentage` as **numbers**; formatting belongs to the render layer.
    - _Requirements: 2.5, 2.7, 2.8, 6.4, 6.5, 6.6, 6.7_
  - [x] 3.3 `utils/reportAlarms.js` — `aggregateAlarmCauses(records)`
    - Group by `cause`, count, `percentage = count / total * 100`. Empty input → `[]`. Unknown causes bucketed, never dropped. Sort desc by count.
    - Also export `countValidTotal(records)` → `{ valid, total }` using `reason === 'Valid'` — this is OQ-3(a), replacing the shift-scoped RPC.
    - _Requirements: 2.6, 7.5, 7.6, 7.9_
  - [x] 3.4 Property tests — `__tests__/comprehensive-radar-report.pbt.test.js`
    - `fast-check`, ≥100 iterations, each tagged `// Feature: comprehensive-radar-report, Property N: <text>`.
    - **Property 1** — `trimChain` output is a non-empty contiguous suffix containing the tail. **Validates: Requirements 3.3, 3.6, 3.7, 3.8**
    - **Property 2** — every recent node survives the trim. **Validates: Requirements 3.3, 3.4, 3.5**
    - **Property 3** — `isTrimmedHeadTrueRoot` iff trimmed head is `chain[0]`. **Validates: Requirements 3.9**
    - **Property 4** — `uptimePercentage ∈ [0,100]`; off ⇒ 0. **Validates: Requirements 2.5, 2.8**
    - **Property 5** — no record contributes more than the window; outside ⇒ 0; `to=null` clips to `windowEnd`. **Validates: Requirements 6.7, 2.7**
    - **Property 6** — denominators per §6.5; never divides by zero. **Validates: Requirements 6.5, 6.6**
    - **Property 7** — `Σpercentage === 100` (tolerance) and `Σcount === records.length`. **Validates: Requirements 7.5, 7.9**
    - Unit cases: the brief's two worked examples (`A→B→C→D` with `C,D` recent → `B→C→D`; with `D` recent → `C→D`), single-node chain, and a 24h regression fixture matching current `RadarDetail` output.
    - _Requirements: 3.4, 3.5, 3.6_

- [x] 4. Extract the parameter pivot from `RadarGallery`
  - [x] 4.1 Create `utils/buildRadarRecord.js`
    - Move the pivot at `RadarGallery.jsx:493-627` into `buildRadarRecord({ wallFolderRow, dqpValues, parameters, wallFolderName }) → record`.
    - **Preserve behaviour verbatim, bugs included** (OQ-4): level-0/1 keyed by raw `p.name`, level-2 parent lookup stripping spaces (`:509` vs `:536`) — which creates a duplicate placeholder parent per multi-word parameter that `getIssues()` depends on. Do not fix here; leave a comment pointing at the follow-up ticket.
    - _Requirements: 4.5, 4.6_
  - [x] 4.2 Rewire `RadarGallery.jsx` to call it
    - Keep the fetching in place; replace only the pivot. Verify the live gallery renders identically.
    - _Requirements: 4.6_

- [x] 5. Build the data hook `useComprehensiveReportData(sensor, window)`
  - Create `components/admin/Reports/useComprehensiveReportData.js`. Fetches, in parallel where possible:
    - `parameters` + `dqp_values` → `buildRadarRecord` → `buildRadarData` (radar chart)
    - `def_records` active heads (excluding those referenced as precursors, per `DeformationTab.jsx:110-129`) → `resolveTimelineChain` → `trimChain`
    - `downtime_records` over the window → `computeAvailability`
    - `alarm_regions` by `wallfolder` → `alarm_records` by `triggered_at` over 24h → `aggregateAlarmCauses` + `countValidTotal`
    - `get_safe_crosscheckers` for `detected_by` name resolution
    - Storage `Deformation` signed URL → `urlToDataUrl`
  - Derive the window from `frequency`: `daily` 24h, `weekly` 7d, `monthly` 30d, ending at `endDate`.
  - Return `{ data, loading, error }`; never throw — partial data renders empty states.
  - _Requirements: 2.7, 3.2, 3.11, 3.12, 6.1, 7.2, 7.3, 7.8_

- [x] 6. Build the report blocks
  - [x] 6.1 `report/blocks/ExecutiveSummary.jsx` — four KPI tiles (Risk, Quality, Uptime, Alarms)
    - Risk from max `getRiskPriority(tarp_level)` over active records, `TARP 1` when none (`SensorDetail.jsx:213-231`). Quality `(normalised_score*100).toFixed(2)`. Colours from `statusConfig.ts`.
    - Guard the missing level-0 case — `RadarTemplate:289` throws on it today.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.9, 2.10_
  - [x] 6.2 `report/blocks/KeyFindings.jsx` — bulleted findings with sub-detail lines, per the mockup.
    - _Requirements: 2.1_
  - [x] 6.3 `report/blocks/Deformation.jsx` — image block + trimmed timeline
    - Node fields: `def_type`, `tarp_level` badge, `location`, detected timestamp, resolved `detected_by`. `Current` on the tail; `Root` only per `isTrimmedHeadTrueRoot` — **do not reuse `TimelineView`'s positional badge logic**.
    - Empty state when no records; incomplete-chain notice on partial resolution.
    - _Requirements: 3.1, 3.8, 3.9, 3.10, 3.11, 3.12, 1.9_
  - [x] 6.4 `report/blocks/DataQuality.jsx` — radar chart + non-optimal table
    - Chart via `RadarMetricsChart` (or the Task 1 PNG path). Must tolerate a 5–7 axis count.
    - Table reuses the `RadarTemplate:298-388` grouped presentation, filtered by the `:195-198` predicate, restyled to A4 metrics, with `(Appendix X)` cross-refs.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [x] 6.5 `report/blocks/AlarmCausePie.jsx` — hand-rolled SVG pie
    - Labels show cause + count **or** percentage, never a count with `%`. Reserve label width. Empty state at zero.
    - _Requirements: 7.1, 7.4, 7.5, 7.7, 7.8, 7.9_
  - [x] 6.6 `report/blocks/SystemPerformance.jsx` — `GaugeLive` donut + the pie, under `SECTION_TITLE_SYSTEM_PERFORMANCE`
    - _Requirements: 6.1, 6.2, 6.3, 8.1, 8.2, 8.3_
  - [x] 6.7 `report/blocks/Glossary.jsx` and `report/blocks/Appendix.jsx`
    - Glossary via `getGlossaryForRadar(sensor.radar_number)`. Appendix items filtered `notes && (image || appendix)`, sorted by `parameter.id`, lettered `A..`, captioned `Figure {n}. {caption}`; one block per item — no `ITEMS_PER_PAGE`. `Disclaimer` on the final page only.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [x] 7. Compose `ComprehensiveRadarTemplate`
  - Create `components/admin/Reports/ComprehensiveRadarTemplate.jsx` with `({ data, sensor, reportInfo, exportMode = false })` — **destructure `reportInfo`**; the existing `RadarTemplate` drops it, which is what starves the header of `Author`/`company`.
  - `buildBlocks()` order: Header → ExecutiveSummary → KeyFindings → Deformation → DataQuality → SystemPerformance → Glossary → Appendix[].
  - `metaItems`: `Edition` (report end date), `Author` (`reportInfo.generatedBy`), `Sensor` (`radar_number`). Title `Daily Radar Reporting Services`.
  - Paginate via `useReportPagination`; render `ReportPages`. Every `<img>` gets `onLoad={bumpMeasure}`.
  - _Requirements: 1.1, 1.4, 1.5, 1.7, 1.9, 11.1_

- [x] 8. Wire category selection and the export branch
  - [x] 8.1 Pass `category` through selection
    - `ReportTemplateRenderer` (`ReportTemplateModal.jsx:27-30`) forwards `category`; `RadarTemplate` accepts it and delegates to `ComprehensiveRadarTemplate` when `category === 'Comprehensive'`, else renders unchanged.
    - _Requirements: 10.1, 10.2, 10.3_
  - [x] 8.2 Branch the export path
    - In `saveReportToSupabase` (`:231-425`), route Comprehensive to the shared `generatePdfBlob` (per-`.pbr-page` capture) instead of the fixed y-offset slicer at `:323-357`, whose `pageHeight`/`totalPages` assumptions the block engine breaks.
    - Keep the `reports` insert and `Reports` upload; `category: 'comprehensive'`. Leave Data Quality and InSAR paths untouched.
    - Surface failures via the existing `message` state.
    - _Requirements: 10.4, 11.3, 11.4, 11.5, 11.6, 11.7_

- [ ] 9. Verify
  - [x] 9.1 Automated checks
    - `npm test` — 133 passing, 0 failures (44 property/unit + 16 render), no regressions in the existing suites.
    - `npx next lint` — 0 errors. `npx next build` — compiles clean.
    - _Requirements: 4.6_
  - [ ] 9.2 Browser check — Comprehensive report pagination
    - Needs a live sensor; not reachable from tests. Generate against a sensor with a ≥4-node chain, ≥1 non-optimal parameter, ≥1 appendix image, and multiple alarm causes.
    - Confirm the preview page count equals the exported page count and no block is clipped. jsdom performs no layout, so pagination fidelity is the one thing the suite cannot prove.
    - _Requirements: 11.1, 11.2_
  - [ ] 9.3 Browser check — extraction canaries
    - Regenerate a Post-Blast report and a Data Quality report; both must be unchanged.
    - Load the live radar gallery and confirm it renders identically after the pivot extraction.
    - _Requirements: 1.3, 4.6, 11.6_

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1", "2.1", "3.1", "3.2", "3.3", "4.1"] },
    { "id": 1, "tasks": ["2.2", "2.4", "2.5", "3.4", "4.2"] },
    { "id": 2, "tasks": ["2.3", "2.6", "5"] },
    { "id": 3, "tasks": ["6.1", "6.2", "6.3", "6.4", "6.5", "6.7"] },
    { "id": 4, "tasks": ["6.6", "7"] },
    { "id": 5, "tasks": ["8.1", "8.2"] },
    { "id": 6, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```

```
1 (recharts gate) ─────────────┐
                               ▼
2 (page frame extract) ──┐   6.4 (DataQuality block)
3 (pure derivations) ────┤     │
4 (pivot extract) ───────┤     │
                         ▼     ▼
                    5 (data hook) ──► 6 (blocks) ──► 7 (template) ──► 8 (wiring) ──► 9 (verify)
```

- Tasks **2, 3, 4** are mutually independent and can run in any order (or in parallel).
- Task **1** gates only **6.4** — it decides whether the chart block embeds live SVG or a PNG.
- Task **5** needs **3** (derivations) and **4** (pivot); it does not need **2**.
- Task **7** needs **2** (frame) and **6** (blocks). Task **8** needs **7**.
- Task **9.3** depends on **2** and **4**, the two behaviour-preserving extractions.

---

## Notes

- **Task 1 found a different blocker than predicted.** Recharts' raster fidelity is fine (plain `<text>`, no `foreignObject`), so no PNG pre-render was needed. The real issue is `ResponsiveContainer` computing `height="80%"` of a zero-height parent in the off-screen container → a blank chart. `RadarMetricsChart` now takes optional `width`/`height` and bypasses `ResponsiveContainer` when both are given. The live dashboard is untouched.
- **Task 2.4 — hook signature changed** to `useReportPagination(deps)`, dropping the `blocks` parameter. Blocks close over `bumpMeasure`, so `bumpMeasure` must exist *before* the blocks are built; passing blocks in would have been a temporal-dead-zone error. A companion `resolvePages(pages, blocks)` supplies the pre-measurement fallback.
- **Task 3.2 — uptime formula corrected.** The plan said `clamp(100 - Σpct)`, which sums percentages computed over two different denominators. Uptime is now derived from hours: `(windowHours - downtimeHours) / windowHours`. The two ring figures keep their own denominators, matching `gaugelive`.
- **Task 4.1 — narrowed to `pivotParameterTree`.** Only the parameter-tree construction was extracted, not the whole gallery merge (which carries gallery-only diagnostics). Lower blast radius, and it is exactly what `buildRadarData` needs. `buildRadarRecord` wraps it for report callers.
- **New: `report/severity.js`.** Requirement 2.9 specified `statusConfig.ts` colour helpers, but those return Tailwind class strings which do not survive the export path. Print-safe inline hex, mirroring the palette the Data Quality PDF already uses.
- **New: `utils/reportDqp.js`.** The non-optimal grouping had no home in the plan; it is pure, so it belongs beside the other derivations rather than inside the block.
- **New: `persistReport` in `ReportTemplateModal`.** The reports-row insert / storage upload / work-log tail was extracted so the slice-based and per-page export paths cannot drift.

### Follow-up round (post-review)

- **Header logo is the client's, not DTG's.** From `clients.logo_path` via the same `../CompanyLogo/…` → `/logo/…` rewrite the Post-Blast report uses; the modal's `clients` select gained `logo_path`. Inlined with `urlToDataUrl` before export. Falls back to the DTG mark. DTG's branding stays in the footer.
- **Upload + zone drawing ported.** Extracted the Post-Blast pit viewport into `report/useImageAnnotation.js` and `report/AnnotatedImage.jsx`; `PostBlastReportModal` now consumes them, so there is one implementation. The Deformation figure seeds from the storage heatmap (once — a refetch must not clobber an upload) and supports drag/drop, replace, and labelled polygon zones.
  - The annotation state is owned by `ReportTemplateModal`, not the template: the export mounts a second copy of the tree, and template-local state would start empty there, dropping the image from the PDF.
  - The template now builds blocks **twice** (interactive for the page, static for the measurement layer), mirroring `buildBlocks(interactive)` in the Post-Blast report. A single shared interactive set would bind `imageRef` twice and the hidden copy would win, so every click would be measured against an off-screen element.
- **Radar chart axis labels were clipped** (`Atm. Correction` → `rection`). Labels render outside the polygon, so the box must be wider than the polygon needs. `RadarMetricsChart` gained optional `outerRadius`, `margin`, `tickFontSize`, `tickColor`, all defaulting to the live values; the report passes a 54px left/right margin, `72%` radius, and an 8px tick.

---

## Follow-up tickets (out of scope)

- Fix the `RadarGallery` key-collision bug (level-0/1 `"System Health"` vs level-2 `"SystemHealth"`) and the `getIssues()` reliance on the resulting placeholder parents.
- Guard `RadarTemplate:289` (`overallStatus.toLowerCase()`) and `getStatusDefinition`'s missing `default` case (`:429`, `:445`).
- Remove the unused `html2pdf`/`html2pdf.js` dependencies; bundle html2canvas/jsPDF instead of the cdnjs runtime injection (`ReportTemplateModal.jsx:259-280`), which hard-fails offline.
- Replace the N+1 chain resolution with a recursive-CTE RPC if the report ever goes site-wide.
- Correct `.kiro/specs/sensor-detail-tabs-redesign/design.md:293` (`precursors` is `INT[]`, not `uuid`) and `:311-319` (`alarm_regions.wallfolder`, not `wallfolder_id`).