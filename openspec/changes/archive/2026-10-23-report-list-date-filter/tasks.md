## 1. Range logic (`utils/reportListRange.js`)

- [x] 1.1 Add `PRESETS` (`7d`, `30d`, `3m`, `6m`) and `resolveRange(selection, today)` returning inclusive local `YYYY-MM-DD` `{ from, to }`, with month presets clamped to month end
- [x] 1.2 Add `validateCustom(from, to, today)` returning `null` or `missing` / `order` / `tooLong` (cap: `from ≥ subMonths(to, 6)`, same clamping as the presets), capping `to` at today
- [x] 1.3 Add `toQueryBounds({ from, to })` → `{ gte: from 00:00 local ISO, lt: (to + 1 day) 00:00 local ISO }`
- [x] 1.4 Add `parseSearch(search)` / `toSearch(selection)` for `range=…&from=…&to=…`, falling back to `{ preset: '7d' }` on anything missing, unknown, malformed or invalid
- [x] 1.5 Unit tests in `__tests__/report-list-range.test.js` covering the spec scenarios: 7-day bounds, 31 Aug → 28 Feb clamp, inclusive last day / exclusive next midnight, reversed, > 6 months, exactly 6 months, the `6m` preset passing `validateCustom`, future `to` capped, URL round-trip and invalid-URL fallback

## 2. Merged list component (`components/Reusable/ReportList.jsx`)

- [x] 2.1 Create the component from the admin list, with props `page`, `refreshTrigger`, `reportData`; keep the role-derived filename-prefix scope for non-admins and the `eq('type', page)` pin; use `react-hot-toast` for all errors
- [x] 2.2 Replace the `.or(...)` window with `.gte/.lt('created_at', …)` from `toQueryBounds`; refetch on `(siteId, role, page, from, to, refreshTrigger)` and drop superseded responses via a sequence ref
- [x] 2.3 Initialise the range from `window.location.search` on mount and write it back with `history.replaceState` on each apply, preserving other params
- [x] 2.4 Add the range `Select` (presets + Custom…) to the filter bar; Custom reveals two `<input type="date" max={today}>` and an Apply button, disabled with an inline message while `validateCustom` errors
- [x] 2.5 Restructure rendering: filter bar always rendered; list body shows spinner while loading, "No reports in this range" when filtered rows are empty, else rows; keep "No client site associated with this user." as the whole-component state
- [x] 2.6 Header shows `Reports · <from> – <to> · <n> results` using the post-search/type count; hide the type dropdown when `page` is set

## 3. Wire up consumers

- [x] 3.1 Point `components/admin/Radar/Reports.tsx`, `app/tools/[client]/Reports/page.js`, `app/tools/[client]/Report_insar/page.js` and `components/client/Reports/Reports.tsx` at `@/components/Reusable/ReportList`
- [x] 3.2 Delete `components/admin/Reports/ReportList.jsx` and `components/client/Reports/ReportList.jsx`; confirm no remaining imports
- [x] 3.3 Change the Total Reports stat card subtitle in `components/admin/Radar/Reports.tsx` from "Last 90 days" to "All time"

## 4. Verify

- [x] 4.1 Render test `__tests__/report-list.render.test.jsx` (Supabase + `useUserSite` mocked): query receives the 7-day bounds by default; empty result keeps the filter bar and shows the empty message; `page="insar"` hides the type dropdown and pins `type`; invalid custom range disables Apply
- [x] 4.2 Run the full Jest suite and fix regressions
- [x] 4.3 Manual check in the running app: admin board (presets, custom old range, > 6-month block, reload keeps range) and a client Radar and InSAR tab (site-scoped, no type dropdown)
