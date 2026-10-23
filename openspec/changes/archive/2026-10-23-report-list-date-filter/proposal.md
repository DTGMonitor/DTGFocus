## Why

The admin report list hard-codes its time window (radar reports: last 7 days, every other type: last 6 months), so older radar reports cannot be reached from the UI at all, and the window changes silently with the type dropdown. The client Reports tabs have the opposite problem: no window at all, so every report a site has ever had is fetched on each visit, which is the volume problem the 7-day limit was added to avoid.

## What Changes

- Replace the hard-coded window with a user-selectable date range applied server-side on `reports.created_at`: presets Last 7 days, Last 30 days, Last 3 months, Last 6 months, plus a Custom range (from → to, inclusive).
- Cap any range at 6 months in length; a custom range may sit anywhere in history. Invalid ranges (to before from, longer than 6 months) are blocked with an inline error, not silently trimmed. A `to` date in the future is capped at today.
- Default to Last 7 days for every report type. **BREAKING** (behaviour): non-radar reports on the admin board no longer show 6 months by default.
- Keep the selected range in the URL query string (`?range=30d`, `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`); an unknown or invalid value falls back to Last 7 days.
- Show the active range and the result count in the list header.
- Keep the search / filter bar visible when the selected range returns no reports, so the user can change the range again.
- Apply the same filter to the client Radar and InSAR Reports tabs, which currently have no window.
- Merge `components/admin/Reports/ReportList.jsx` and `components/client/Reports/ReportList.jsx` into one component; the type pin (`page`) and `reportData` callback stay props, site scoping stays role-derived, and errors use toasts in both contexts (replacing the client's `alert()`).
- Fix the "Total Reports" stat card subtitle on the admin board, which says "Last 90 days" but counts all reports.

## Capabilities

### New Capabilities
- `report-list`: Listing reports in the admin Report Management board and the client Reports tabs: date-range filtering (presets, custom range, 6-month cap, default, URL persistence), type and search filtering, site scoping, empty state, and the header summary.

### Modified Capabilities
<!-- None: openspec/specs/ has no existing capabilities. -->

## Impact

- `components/admin/Reports/ReportList.jsx`, `components/client/Reports/ReportList.jsx`: merged into one shared component.
- Consumers: `components/admin/Radar/Reports.tsx` (also the stat card label), `app/tools/[client]/Reports/page.js`, `app/tools/[client]/Report_insar/page.js`, `components/client/Reports/Reports.tsx`.
- Supabase: `reports` queries gain `created_at` range bounds; no schema change or migration.
- No new dependencies.
