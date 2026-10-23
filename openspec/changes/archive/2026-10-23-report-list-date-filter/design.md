## Context

Reports are rows in the Supabase `reports` table (PDF in the `Reports` storage bucket, path `{siteId}/…`). Two near-identical list components render them:

- `components/admin/Reports/ReportList.jsx`: admin Report Management board (`components/admin/Radar/Reports.tsx`, a tab switched in component state by `Radar.jsx`, not by URL). Fetches `type = radar AND created_at ≥ now−7d` OR `type ≠ radar AND created_at ≥ now−6mo`; search and type dropdown filter in memory; errors via `react-hot-toast`; optional `reportData` callback.
- `components/client/Reports/ReportList.jsx`: client Radar / InSAR tabs (`app/tools/[client]/Reports`, `…/Report_insar`) with `page="radar"|"insar"` pinning `type`. No time window, no row limit; scoped to `filename ILIKE '{siteId}/%'` for non-admins; errors via `alert()`.

The 7-day radar limit was added with the report scheduler (`c089959`), when daily scheduled reports per site made the list heavy. Every writer sets `created_at` at insert time, and reports are generated for their own period, so `created_at` and `date` fall on the same day in practice. Both components return the "No reports" empty state *before* rendering the filter bar, and render a full-panel spinner in place of everything while loading.

## Goals / Non-Goals

**Goals:**
- One list component for admin and client, with a server-side `created_at` range that is never longer than 6 months.
- Presets plus a custom range; Last 7 days by default; the range survives reload via the URL.
- The filter bar is always reachable (empty results, loading).

**Non-Goals:**
- Paging / "load more": the 6-month cap bounds the result set.
- Moving the type dropdown or search server-side: they stay in-memory over the ≤ 6-month result.
- Filtering on `reports.date`, or any schema change / backfill.
- Changing who may delete reports (see Open Questions).
- Changing the stat cards' counts (only the mislabelled subtitle).

## Decisions

### 1. Merge into `components/Reusable/ReportList.jsx`
One component with props: `page` (type pin, hides the type dropdown), `refreshTrigger`, `reportData` (callback, kept for the admin contract). Site scoping stays derived from `useUserSite()` (non-admins see only `{siteId}/%`), exactly as both lists do today, so it is not a prop. Errors use `react-hot-toast` in both contexts, replacing the client's `alert()`. The old two files are deleted and the four consumers import the new path.
- *Why `Reusable`*: it already holds cross-area pieces (`useUserSite`). A new `components/Reports/` folder would collide on Windows' case-insensitive filesystem with the existing `components/reports/`.
- *Alternative*: keep both files and share a hook. Rejected: the files are ~90 % identical and the empty-state / loading fix would still be written twice.

### 2. Range logic as a pure module: `utils/reportListRange.js`
Exports, with no React or Supabase:
- `PRESETS`: `7d`, `30d`, `3m`, `6m` (days → `today − (N−1)` days; months → same day N months back, clamped to month end).
- `resolveRange(selection, today)` → `{ from, to }` as `YYYY-MM-DD` local calendar days, both inclusive.
- `validateCustom(from, to, today)` → `null` or an error key (`missing`, `order`, `tooLong`); `to > today` is capped to today, not an error.
- `toQueryBounds({from, to})` → `{ gte: <from 00:00 local, ISO>, lt: <(to + 1 day) 00:00 local, ISO> }`. Using `< next midnight` counts the whole last day without `23:59:59.999` arithmetic.
- `parseSearch(search)` / `toSearch(selection)`: URL round-trip; anything unparseable or failing validation → `{ preset: '7d' }`.
- *Why*: these are the edge cases (month ends, inclusive bounds, the cap) and they are cheap to unit-test as pure functions, like `utils/reportAvailability.js` already is.
- **6-month cap** definition: valid iff `from ≥ subMonths(to, 6)` (calendar months, clamped to month end). Measuring back from `to` uses the same arithmetic as the `6m` preset, so the preset satisfies the cap by construction; measuring forward from `from` would not (28 Feb + 6 months = 28 Aug, short of the preset's 31 Aug end).

### 3. Query
`supabase.from('reports').select('*').gte('created_at', gte).lt('created_at', lt)`, plus `eq('type', page)` when pinned and the existing filename-prefix scope for non-admins, ordered `created_at desc`. Replaces the `.or(...)` split entirely.

A fetch is keyed by `(siteId, role, page, from, to, refreshTrigger)`. A sequence counter in a ref discards responses from superseded fetches, so a slow earlier range cannot overwrite a newer one.

### 4. URL sync via `window.location` / `history.replaceState`
Read `window.location.search` once on mount; on every range change write the params with `history.replaceState`, preserving any other params. Format: `?range=7d|30d|3m|6m` or `?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`.
- *Why not `useSearchParams` + `router.replace`*: nothing in the app uses them yet; `useSearchParams` forces a Suspense boundary in each consuming page, and `router.replace` triggers an App Router navigation for what is purely local UI state. `replaceState` adds no history entries, so Back still leaves the page.
- Admin board tabs aren't URL-driven, so the param simply rides along on the admin route; harmless.

### 5. UI
Filter bar: search · type dropdown (only when `page` is unset) · range `Select` (presets + "Custom…"). Choosing Custom reveals two native `<input type="date">` (`max = today`) and an **Apply** button; the fetch runs on Apply, not on each change, and Apply is disabled with an inline message while `validateCustom` returns an error. Native date inputs match the ~dozen existing uses; `react-datepicker` is not needed.

Header: `Reports · 16 Oct – 22 Oct 2026 · 43 results`, where the count is of rows after search/type filtering.

Render order: filter bar always; below it, the list body shows a spinner while loading, the empty message when the filtered result is empty ("No reports in this range"), or the rows. The "No client site associated with this user." message stays a whole-component state (no site → nothing to filter).

### 6. Stat card
`components/admin/Radar/Reports.tsx` "Total Reports" subtitle → "All time" (its query has no date bound). Its "data independent of the date-limited list" comment remains true.

## Risks / Trade-offs

- [Non-radar admin default shrinks from 6 months to 7 days] → The visible range label in the header and a one-click "Last 6 months" preset make it obvious and quick to widen.
- [`created_at` vs the displayed `date` could differ for a manually uploaded back-dated report] → Accepted: reports are created for their own period. Rows keep showing `date`.
- [Local-midnight bounds use the viewer's timezone, not the site's] → Off by at most a few hours at range edges; acceptable for a browsing filter (unlike the report window itself, which is site-calendar based).
- [Merging changes the client error UX from `alert()` to toasts] → Strictly an improvement; covered by the Toaster mounted in the component.
- [A shared URL `?range=custom` with a range > 6 months] → Falls back to 7 days rather than querying it.

## Migration Plan

Front-end only; ship in one deploy. Rollback = revert the commit. No data migration.

## Open Questions

- Both current lists show the Delete button to anyone who sees a completed report, including client users. The merge keeps that behaviour unchanged; whether clients should be able to delete is a separate decision.
