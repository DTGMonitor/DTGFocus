# Implementation Plan: Scalable Report Reminder Scheduler

## Overview

Migrate the existing single-site, localStorage-based report reminder system to a multi-site, Supabase-backed architecture. The work touches four existing files and adds five test files. Changes are incremental: first strip the storage CRUD from `scheduleUtils.ts`, then rewrite `useReportSchedules.ts` to talk to Supabase, then wire up the per-row save/error state in `ScheduledReports.tsx`, and finally add property-based and unit tests for every layer.

---

## Tasks

- [x] 1. Run the SQL migration in Supabase (manual step — not a code task)
  - Open the Supabase dashboard → SQL Editor.
  - Paste and execute the `CREATE TABLE IF NOT EXISTS site_report_schedules` DDL from Requirements §7.1 (columns: `site_id`, `deadline`, `reminder`, `enabled`, `updated_at`; RLS policy for authenticated users).
  - Confirm the table and policy appear in the Table Editor before proceeding.
  - _Requirements: 7.1_

- [x] 2. Refactor `scheduleUtils.ts` — remove localStorage schedule CRUD, keep pure helpers
  - [x] 2.1 Delete the schedule-storage functions from `scheduleUtils.ts`
    - Remove: `loadSchedules()`, `saveSchedule()`, `getSchedule()`, the `SCHEDULES_KEY` constant, and the `SCHEDULES_UPDATED_EVENT` constant.
    - Keep everything else unchanged: `SiteSchedule` interface, `DEFAULT_DEADLINE`, `DEFAULT_REMINDER_OFFSET_MIN`, `timeToMinutes()`, `minutesToTime()`, `defaultReminderFor()`, `defaultSchedule()`, `localDateKey()`, `loadAcks()`, `isAckedToday()`, `acknowledge()`, `shouldRemind()`.
    - Update the file-level comment to describe the file as "Pure time helpers and acknowledgement helpers for the report reminder system."
    - _Requirements: 1.1, 6.1_

  - [x] 2.2 Write property tests for `scheduleUtils.ts` pure functions (P9, P10, P11, P12, P14)
    - Create `components/admin/Radar/ReportReminder/__tests__/scheduleUtils.property.test.ts`.
    - Install `fast-check` if not already present (`npm install --save-dev fast-check`).
    - Each test must run ≥ 100 iterations and carry a tag comment: `// Feature: scalable-report-scheduler, Property N: <text>`.
    - **Property 9: shouldRemind is true exactly when all conditions are met**
      - Arbitraries: `fc.record({ enabled: fc.boolean(), deadline: fc.string(), reminder: fc.string() })`, `fc.boolean()` (generatedToday), `fc.boolean()` (acked), `fc.date()` (now).
      - Assert: result equals `enabled && !generatedToday && !acked && timeToMinutes(reminder) !== null && (now.getHours()*60+now.getMinutes()) >= timeToMinutes(reminder)!`.
      - **Validates: Requirements 5.1**
    - **Property 10: Acknowledge–then–check round trip**
      - Arbitrary: `fc.string({ minLength: 1 })` for siteId.
      - Call `acknowledge(siteId)`, then assert `isAckedToday(siteId) === true`.
      - **Validates: Requirements 5.4, 6.1**
    - **Property 11: Ack expiry — previous-day acknowledgements do not suppress today's reminder**
      - Arbitrary: `fc.string({ minLength: 1 })` for siteId, past date strings (`YYYY-MM-DD` before today).
      - Write a past date directly into localStorage for the siteId, then assert `isAckedToday(siteId) === false`.
      - **Validates: Requirements 5.6, 6.3**
    - **Property 12: defaultReminderFor is always 30 minutes before the deadline**
      - Arbitrary: `fc.tuple(fc.integer(0,23), fc.integer(0,59))` → format as `"HH:MM"`.
      - Assert: `timeToMinutes(defaultReminderFor(deadline))` equals `(timeToMinutes(deadline)! - 30 + 1440) % 1440`.
      - **Validates: Requirements 4.3**
    - **Property 14: timeToMinutes / minutesToTime round trip**
      - Arbitrary: `fc.tuple(fc.integer(0,23), fc.integer(0,59))` → `"HH:MM"` string.
      - Assert: `minutesToTime(timeToMinutes(t)!) === t`.
      - **Validates: Requirements 1.2**

- [x] 3. Rewrite `useReportSchedules.ts` — Supabase-backed data fetching and persistence
  - [x] 3.1 Add `saving` and `saveError` fields to `SiteReportStatus`
    - Extend the `SiteReportStatus` interface: add `saving: boolean` and `saveError: string | null`.
    - Keep all existing fields unchanged; this is a purely additive change.
    - _Requirements: 4.5, 4.6_

  - [x] 3.2 Rewrite `fetchData` to fetch schedules from Supabase in parallel
    - Remove the import of `loadSchedules`, `getSchedule`, `SCHEDULES_UPDATED_EVENT`, and `saveSchedule as persistSchedule` from `scheduleUtils`.
    - Import `defaultSchedule` and `defaultReminderFor` from `scheduleUtils` (these remain).
    - Add a third parallel fetch: `supabase.from('site_report_schedules').select('site_id, deadline, reminder, enabled')`.
    - Build a `Map<string, SiteSchedule>` from the result rows; apply `defaultSchedule()` for any site not found in the map.
    - Wire the schedule map into the existing merge logic replacing the `getSchedule(stored, id)` call.
    - Set `saving: false, saveError: null` on each newly constructed `SiteReportStatus`.
    - If the schedule fetch fails, log the error and fall back to default schedules for all sites (do not throw).
    - _Requirements: 1.1, 1.4, 1.5, 2.4, 8.1, 8.2, 8.3, 8.4_

  - [x] 3.3 Remove `SCHEDULES_UPDATED_EVENT` / `storage` event listeners
    - Delete the `useEffect` block that listens for `SCHEDULES_UPDATED_EVENT` and `storage` events — schedule changes are now reflected through optimistic state updates directly.
    - _Requirements: 1.1_

  - [x] 3.4 Rewrite `saveSchedule` with optimistic update and Supabase upsert
    - Capture the current schedule as a rollback snapshot before applying the optimistic update.
    - Apply optimistic update: set `saving: true, saveError: null` on the target site.
    - Call `supabase.from('site_report_schedules').upsert({ site_id, deadline, reminder, enabled, updated_at: new Date().toISOString() })`.
    - On success: set `saving: false, saveError: null`.
    - On failure: restore the rollback snapshot, set `saving: false, saveError: error.message`.
    - _Requirements: 1.3, 4.5, 4.6, 7.2_

  - [x] 3.5 Implement one-time localStorage migration
    - Add a `migrateFromLocalStorage(existingSiteIds: Set<string>)` callback inside the hook.
    - On first load (inside `fetchData`, after the schedule rows have been fetched), detect `window.localStorage.getItem('reportSchedules')`.
    - Parse the value; filter to entries whose `site_id` is not already in Supabase; upsert the remainder.
    - On upsert success: call `window.localStorage.removeItem('reportSchedules')`.
    - On upsert failure: log `'[ReportScheduler] Migration failed — localStorage data preserved:'` + error; do **not** delete the key.
    - _Requirements: 9.1, 9.2, 9.3_

  - [x] 3.6 Write unit tests for `useReportSchedules.ts`
    - Create `components/admin/Radar/ReportReminder/__tests__/useReportSchedules.unit.test.ts`.
    - Mock `@/lib/supabaseClient` (vitest `vi.mock` or jest `jest.mock`).
    - **Migration — success path**: mock localStorage with `reportSchedules`, mock upsert to resolve with `{ error: null }` → assert `localStorage.removeItem` called.
    - **Migration — failure path**: mock upsert to resolve with `{ error: { message: 'network error' } }` → assert key retained and `console.error` called with the descriptive prefix.
    - **Save loading state**: mock a pending upsert (never resolves during test), call `saveSchedule` → assert `sites[targetIndex].saving === true`.
    - **Save error state**: mock upsert to fail → assert `sites[targetIndex].saveError` is non-null and schedule is rolled back to original value.
    - **Fetch error — sensor registry fails**: mock `latest_radar_wall_folders` to return `{ error: { message: '...' } }` → assert `sites` is empty array, `loading` is false.
    - **Schedule fetch failure fallback**: mock `site_report_schedules` to return error → assert each site gets `defaultSchedule()` applied.
    - _Requirements: 1.3, 1.4, 4.5, 4.6, 9.1, 9.2, 9.3_

- [x] 4. Write property tests for merge / sensor-discovery logic (P1–P8, P13)
  - [x] 4.1 Extract merge logic into a testable pure function
    - Create an internal (non-exported) or separately exported helper function `mergeSites(registryRows, scheduleMap, todayReports)` that encapsulates the grouping, deduplication, `isGenerated` check, sort, and default-schedule application.
    - The function must be importable from a test file (export it or co-locate tests with the hook).
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 4.2 Write property tests for merge logic (P1–P8, P13)
    - Create `components/admin/Radar/ReportReminder/__tests__/mergeLogic.property.test.ts`.
    - Each test must run ≥ 100 iterations and carry a tag comment.
    - **Property 1: Default schedule for unknown sites** — `fc.string()` for unknown site IDs; assert returned schedule deep-equals `defaultSchedule()`. **Validates: Requirements 1.5, 2.4, 8.3**
    - **Property 2: Merge completeness** — `fc.array(registryRowArb)` (no Archive); assert `mergeSites` output site IDs equal the distinct non-null `site_id` values in input. **Validates: Requirements 2.1, 2.3, 8.3**
    - **Property 3: Site isolation** — array of sites + target siteId + patch; assert applying the patch changes only the target. **Validates: Requirements 2.2**
    - **Property 4: Archive rows excluded** — `fc.array(registryRowArb)` including Archive rows; assert no output sensor comes from an Archive row. **Validates: Requirements 8.1**
    - **Property 5: Sensor deduplication** — registry rows with repeated `radar_number` for the same `site_id`; assert each sensor appears once. **Validates: Requirements 8.2**
    - **Property 6: Alphabetical sort** — random site names; assert output is sorted by `localeCompare`. **Validates: Requirements 8.4**
    - **Property 7: Case-insensitive sensor-to-report matching** — `fc.string()` sensor ID + `fc.string()` filename; assert `isGenerated` result matches `filename.toLowerCase().includes(sensorId.toLowerCase())`. **Validates: Requirements 3.2**
    - **Property 8: generatedToday and pendingSensors consistency** — full `mergeSites` output; for every site assert `generatedToday === (pendingSensors.length === 0)` and sensor `generatedToday` flag consistency. **Validates: Requirements 3.3, 3.4**
    - **Property 13: Custom reminder preserved when deadline changes** — site with `reminder !== defaultReminderFor(deadline)`; call optimistic-update logic with `{ deadline: newDeadline }`; assert `reminder` field unchanged. **Validates: Requirements 4.4**

- [x] 5. Update `ScheduledReports.tsx` — add per-row save/error UI
  - [x] 5.1 Render saving indicator and error message per row
    - In the editing controls section of each site row, add:
      - A `<Loader className="w-4 h-4 animate-spin text-[var(--dtg-gray-400)]" />` rendered when `site.saving === true`.
      - A `<span className="text-red-400 text-xs max-w-[160px] truncate" title={site.saveError}>Save failed</span>` rendered when `site.saveError` is non-null.
    - No logic changes — `saveSchedule` call signatures remain identical.
    - Ensure `Loader` is already imported from `lucide-react` (it is).
    - _Requirements: 4.5, 4.6_

  - [x] 5.2 Write unit tests for `ScheduledReports.tsx`
    - Create `components/admin/Radar/ReportReminder/__tests__/ScheduledReports.unit.test.tsx`.
    - Use React Testing Library.
    - **Loading state**: mock hook returning `{ loading: true, sites: [] }` → assert spinner is in the DOM.
    - **Empty sites**: mock hook returning `{ loading: false, sites: [] }` → assert "No sites available." text is in the DOM.
    - **Manage Schedule toggle**: render with valid sites → click the "Manage Schedule" button → assert time inputs become visible.
    - **Saving indicator**: enter manage mode with a site where `saving: true` → assert a `Loader` (animate-spin element) is visible for that row.
    - **Save error display**: enter manage mode with a site where `saveError: "DB error"` → assert "Save failed" text is in the DOM.
    - _Requirements: 4.1, 4.2, 4.5, 4.6_

- [x] 6. Verify `ReportReminderManager.tsx` imports are still valid after hook changes
  - [x] 6.1 Confirm no import cleanup needed in `ReportReminderManager.tsx`
    - The component imports `useReportSchedules` (hook) and `shouldRemind`, `isAckedToday`, `acknowledge` from `scheduleUtils`.
    - Verify all three `scheduleUtils` exports still exist after task 2.1; confirm `useReportSchedules` public API (`sites`, `refresh`) is unchanged after tasks 3.1–3.5.
    - If any import is broken, fix it.
    - _Requirements: 5.1, 5.4, 6.1_

  - [x] 6.2 Write unit tests for `ReportReminderManager.tsx`
    - Create `components/admin/Radar/ReportReminder/__tests__/ReportReminderManager.unit.test.tsx`.
    - Use React Testing Library.
    - **Popup renders null**: mock hook returning all sites with `generatedToday: true` → assert component returns nothing (container is empty).
    - **Popup blocks UI**: mock hook with one site where `shouldRemind` would be true → assert the backdrop overlay (`fixed inset-0`) is in the DOM.
    - **Acknowledge removes site from list**: render with one overdue site → click "Acknowledge" → assert the site row is removed from the popup.
    - **All acknowledged closes popup**: render with one site → acknowledge it → assert overlay is no longer in the DOM.
    - **Interval setup**: mock `setInterval`, render the component → confirm intervals at 30,000 ms and 300,000 ms are registered.
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.7, 5.8_

- [x] 7. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.
  - Run `npx vitest --run` (or the project's test command) and confirm zero failures.
  - _Done: `npx jest` → 63 passed, 3 skipped (pre-existing, unrelated), 0 failures. Full `tsc --noEmit` clean. Test runner is Jest (not Vitest); `fast-check` already installed._

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP.
- Task 1 is a manual Supabase dashboard step — it has no corresponding code change.
- Tasks 2–4 are the pure-logic layer; they are safe to work on in parallel with task 5 since they touch different files.
- The `saving` / `saveError` fields (task 3.1) must land before tasks 3.4 and 5.1.
- Each task references specific requirements for traceability.
- Property tests validate universal correctness properties; unit tests validate specific examples and edge cases.
- The `fast-check` library should be installed as a dev dependency if not already present.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1", "3.1"] },
    { "id": 1, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 2, "tasks": ["3.4", "3.5", "2.2"] },
    { "id": 3, "tasks": ["5.1", "6.1", "4.2"] },
    { "id": 4, "tasks": ["3.6", "5.2", "6.2"] }
  ]
}
```
