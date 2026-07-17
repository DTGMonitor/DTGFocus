# Requirements Document

## Introduction

The radar report generator currently produces exactly one usable layout — the 24h Data Quality Assessment. This feature adds a second, richer **Comprehensive** radar report that combines executive KPIs, the deformation event timeline, data-quality assessment, system availability, and alarm-cause analysis into a single A4 PDF, reusing the Glossary and Appendix from the Data Quality report and the page frame from the Pattern Recognition (Post-Blast) report.

The report is generated per sensor, from the existing report-generator modal, and is archived to Supabase alongside the existing report types.

---

## Glossary

- **Comprehensive Report**: The new radar report layout defined by this document.
- **Data Quality Report**: The existing 24h Data Quality Assessment layout rendered by `RadarTemplate`.
- **PR Report**: The existing Post-Blast Analysis report rendered by `PostBlastReportModal`, whose page frame this feature reuses.
- **Page Frame**: The shared header, footer, A4 page sheet, and measured-block pagination engine extracted from the PR Report.
- **Block**: One indivisible unit of report content placed onto a page by the pagination engine.
- **Chain**: An ordered `root → current` sequence of `def_records` linked by `precursors[0]`.
- **Current Node**: The tail of a Chain — the active (`isactive='Yes'`) record.
- **Recent Node**: A Chain node whose `created_at` falls within the latest 24 hours.
- **Granularity**: The report's aggregation window, derived from the existing frequency selector (`daily` / `weekly` / `monthly`).
- **Window**: The concrete `[start, end)` interval implied by Granularity and the report's end date.
- **Non-Optimal Parameter**: A `dqp_values` row whose `value` is not `Optimal`, not `N/A`, and not null, at parameter level 2.
- **Operator**: A logged-in user generating a report.

---

## Requirements

### Requirement 1: Page Frame Reuse (Header, Footer, Image Sections)

**User Story:** As an Operator, I want the Comprehensive Report to use the same page frame as the PR Report, so that DTG's reports share one visual identity.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render its Header, Footer, and image sections using the Page Frame extracted from the PR Report, not the Data Quality Report's fixed-page layout.
2. THE Page Frame SHALL be extracted into a shared module consumed by both the PR Report and the Comprehensive Report, with no duplicated implementation.
3. WHEN the Page Frame is extracted, THE PR Report SHALL render identically to its pre-extraction output.
4. THE Header SHALL display the report title, a `company – siteName` subtitle, and a pipe-separated metadata row containing at minimum `Edition` and `Author`.
5. THE Header SHALL appear on the first page only.
6. THE Footer SHALL appear on every page and SHALL display the DTG Focus mark, the text `Advanced Geotechnical Data Analytics. Powered by DTG Focus`, and `Page N of M`.
7. THE Comprehensive Report SHALL accept and use `reportInfo` for `Author`, `company`, and `siteName`. *(The existing `RadarTemplate` drops this prop.)*
8. THE pages SHALL be A4 at 96dpi (794×1123px).
9. WHERE an image is rendered, THE Comprehensive Report SHALL embed it as a data URL before export and SHALL cap its height so the containing Block fits on one page.

---

### Requirement 2: Executive Summary KPIs

**User Story:** As an Operator, I want an executive summary of the sensor's risk, quality, uptime, and alarm load, so that a reader can assess the monitoring period at a glance.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render an Executive Summary containing exactly four KPI tiles: Risk Level, Data Quality, System Uptime, and Alarm Events.
2. THE Risk Level tile SHALL display the highest TARP level among active `def_records`, with its severity label.
3. IF no active `def_records` exist, THEN THE Risk Level tile SHALL display `TARP 1`.
4. THE Data Quality tile SHALL display the `quality` label and `normalised_score` formatted as a percentage to two decimal places.
5. THE System Uptime tile SHALL display uptime as a percentage computed over the Window.
6. THE Alarm Events tile SHALL display valid and total alarm counts as `valid/total`.
7. THE Window SHALL be derived from the existing frequency selector: `daily` → 24h, `weekly` → 7d, `monthly` → 30d, each ending at the report's end date.
8. THE uptime computation SHALL NOT hardcode a 24-hour window or a 24-hour denominator.
9. THE KPI tiles SHALL derive their colours from the existing `config/statusConfig.ts` helpers.
10. IF the assessment data contains no overall (level-0) status, THEN THE Data Quality tile SHALL render a placeholder and SHALL NOT throw.

---

### Requirement 3: Deformation Event Timeline

**User Story:** As an Operator, I want the deformation timeline trimmed to recent activity plus its immediate context, so that the report shows what changed without reprinting the entire history.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render a Deformation section containing the deformation image and the trimmed event timeline.
2. THE timeline SHALL resolve the full Chain using the existing chain-resolution helper.
3. THE trimmed timeline SHALL contain the Current Node, every Recent Node, and exactly one node of context immediately preceding the earliest Recent Node.
4. WHERE a Chain is `A→B→C→D` and `C` and `D` are Recent Nodes, THE trimmed timeline SHALL be `B→C→D`.
5. WHERE a Chain is `A→B→C→D` and only `D` is a Recent Node, THE trimmed timeline SHALL be `C→D`.
6. IF the Chain contains exactly one node, THEN THE trimmed timeline SHALL contain that node alone.
7. IF no node is a Recent Node, THEN THE trimmed timeline SHALL contain the last two nodes.
8. THE trimmed timeline SHALL render a `Current` badge on its tail node.
9. THE trimmed timeline SHALL render a `Root` badge on its head node IF AND ONLY IF that node is the true head of the full Chain.
10. Each node SHALL display `def_type`, `tarp_level`, `location`, detection timestamp, and the resolved name of the detecting user.
11. IF chain resolution fails partway, THEN THE Comprehensive Report SHALL render the partial Chain and surface an incomplete-timeline notice.
12. IF no deformation records exist, THEN THE section SHALL render an empty state and SHALL NOT throw.

---

### Requirement 4: Data Quality Radar Chart

**User Story:** As an Operator, I want the data-quality radar chart in the report, so that parameter health is visible in the same form as the live dashboard.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render the data-quality radar chart using the existing radar-chart component and its existing data builder.
2. THE chart SHALL support a variable axis count between 5 and 7 and SHALL NOT assume a fixed polygon.
3. THE chart SHALL omit the `Visual Data` axis for `XT` radars.
4. THE chart SHALL omit the `Photograph` axis for non-`GroundProbe` brands.
5. THE parameter-tree construction SHALL be extracted into a reusable function consumed by both the live gallery and the Comprehensive Report.
6. WHEN the parameter-tree construction is extracted, THE live gallery SHALL render identically to its pre-extraction output.
7. THE chart SHALL rasterize faithfully in the exported PDF.

---

### Requirement 5: Data Quality Table

**User Story:** As an Operator, I want every assessed parameter accounted for in the report and the non-optimal ones detailed, so that the reader's attention goes to what needs action without having to wonder what happened to the rest.

> **Revised.** This requirement previously read "only non-optimal parameters" and the table listed nothing else. In practice the radar chart plots one axis per group, so a failures-only table left the reader to reconstruct the passing axes from a 220px chart — and the dead space it left beside the chart was the section's most visible flaw. Passing groups now print as a single collapsed line, which fills that space with the information the reader was missing rather than with padding. Attention still goes to the failures: they sort first and keep their notes and chips.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render a Data Quality detail table using the Data Quality Report's existing presentation.
2. THE table SHALL include every assessed parameter group, and SHALL order groups containing a Non-Optimal Parameter before groups that are entirely `Optimal`.
3. WHERE a group contains a Non-Optimal Parameter, THE table SHALL display a status colour bar, the group name, note bullets, and every sub-parameter's status.
4. WHERE a group is entirely `Optimal`, THE table SHALL collapse it to a single line stating that its sub-parameters are optimal, and SHALL NOT enumerate them.
5. WHERE a listed parameter has an appendix entry, THE table SHALL cross-reference it as `(Appendix X)`.
6. IF a Non-Optimal Parameter carries no analyst note, THEN THE table SHALL state that no note was recorded rather than rendering an empty note area.
7. IF no parameters were assessed at all, THEN THE table SHALL render an empty state and SHALL NOT throw.
8. THE severity colours used by the table SHALL be accompanied by a printed key naming each tier.

---

### Requirement 6: Data Availability

**User Story:** As an Operator, I want the availability donut in the report, so that downtime attribution is visible alongside uptime.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render the availability donut using the existing gauge component.
2. THE donut SHALL display Mechanical Availability and Use of Availability rings with their per-reason breakdowns.
3. THE breakdown SHALL use the canonical downtime reasons: `Radar System Issue`, `Maintenance`, `Relocation`, `Connection`, `PMP Issue`.
4. THE donut and the System Uptime tile SHALL derive from a single availability computation.
5. Mechanical percentages SHALL use the full Window as denominator; Use of Availability percentages SHALL use the mechanically-available hours as denominator.
6. IF mechanically-available hours are zero or negative, THEN THE computation SHALL fall back to the full Window denominator and SHALL NOT divide by zero.
7. Downtime records SHALL be clipped to the Window; an open-ended record SHALL clip to the Window end.

---

### Requirement 7: Alarm Cause Distribution

**User Story:** As an Operator, I want a 24-hour alarm-cause breakdown, so that nuisance-alarm drivers are visible.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render an alarm-cause pie chart covering the latest 24 hours.
2. THE alarm query SHALL resolve regions by wall folder, then records by region.
3. THE 24-hour filter SHALL apply to the alarm trigger timestamp, not the row insert timestamp.
4. THE pie SHALL label each slice with its cause and either a count or a percentage, and SHALL NOT label a count with a percent sign.
5. THE slice percentages SHALL sum to 100 and SHALL be consistent with the displayed counts.
6. THE causes SHALL use the canonical cause vocabulary defined in `config/formConfig.ts`.
7. THE pie SHALL reserve sufficient label width that cause names are not clipped.
8. IF no alarm regions exist for the sensor, THEN THE section SHALL render an empty state.
9. IF no alarms occurred in the window, THEN THE section SHALL render an empty state and SHALL NOT divide by zero.

---

### Requirement 8: Availability and Alarm Section Title

**User Story:** As an Operator, I want the availability and alarm section to have an accurate title, so that the report reads clearly.

#### Acceptance Criteria

1. THE section containing the availability donut and the alarm pie SHALL be titled `System Performance`.
2. THE title SHALL NOT be `Performance Matrix`.
3. THE title SHALL be defined as a single constant so it can be changed without touching layout code.

---

### Requirement 9: Glossary and Appendix

**User Story:** As an Operator, I want the same Glossary and Appendix as the Data Quality Report, so that terminology and evidence are presented consistently.

#### Acceptance Criteria

1. THE Comprehensive Report SHALL render a Glossary using the existing radar-model-aware glossary helper.
2. THE Glossary SHALL adjust its term list to the sensor's radar model.
3. THE Comprehensive Report SHALL render an Appendix containing items that have notes and either an image or appendix text, sorted by parameter id.
4. THE Appendix items SHALL be lettered `A`, `B`, `C`… and SHALL be referenced by the Requirement 5 table.
5. THE Appendix figures SHALL be captioned `Figure {n}. {caption}`.
6. THE Comprehensive Report SHALL render the existing Disclaimer on the final page only.
7. THE Appendix SHALL rely on the pagination engine for placement and SHALL NOT use a fixed items-per-page constant.

---

### Requirement 10: Category-Driven Template Selection

**User Story:** As an Operator, I want selecting "Comprehensive" to actually produce a Comprehensive report, so that the category dropdown is truthful.

#### Acceptance Criteria

1. WHEN an Operator selects report type `Radar` and category `Comprehensive`, THE report generator SHALL render the Comprehensive Report.
2. WHEN an Operator selects report type `Radar` and category `Data Quality`, THE report generator SHALL render the Data Quality Report unchanged.
3. THE template selection SHALL depend on the selected category. *(It currently does not, which is why every radar category produces a Data Quality PDF.)*
4. THE generated filename and the persisted `reports` row SHALL reflect the selected category.

---

### Requirement 11: Preview, Export, and Persistence

**User Story:** As an Operator, I want the preview to match the exported PDF and the report to be archived, so that what I review is what is delivered and retained.

#### Acceptance Criteria

1. THE on-screen preview and the exported PDF SHALL have identical page counts and identical block-to-page assignments.
2. THE Comprehensive Report SHALL derive its page count from measurement, not from a precomputed constant.
3. THE export SHALL capture each page element individually and SHALL NOT slice a single tall container at fixed offsets.
4. THE exported PDF SHALL be A4 portrait.
5. THE Comprehensive Report SHALL be archived to the `Reports` storage bucket and recorded in the `reports` table, consistent with existing report types.
6. THE Data Quality and InSAR export paths SHALL be unaffected.
7. IF PDF generation fails, THEN THE report generator SHALL surface the failure to the Operator and SHALL NOT fail silently.
