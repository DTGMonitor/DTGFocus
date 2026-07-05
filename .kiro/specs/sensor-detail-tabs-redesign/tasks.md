# Implementation Plan: Sensor Detail Tabs Redesign

## Overview

Refactor `SensorDetail.jsx` from a monolithic side-panel into a tabbed interface with four focused panels (Deformation, Alarm, Data Quality, Downtime). The implementation proceeds in dependency order: shared utilities first, then tab components, then the DeformationList modification and SensorDetail refactor, and finally tests.

## Tasks

- [x] 1. Create shared utility components
  - [x] 1.1 Create `components/admin/Radar/shared/ConfirmDialog.jsx`
    - Implement fixed overlay with semi-transparent backdrop (`z-50`)
    - Accept props: `isOpen`, `title`, `message`, `onConfirm`, `onCancel`, `isDestructive` (default `false`), `confirmLabel` (default `"Confirm"`), `cancelLabel` (default `"Cancel"`), `isConfirmDisabled`
    - Backdrop click and Escape key both call `onCancel`; component does NOT manage its own open/close state
    - Confirm button: `bg-red-600 hover:bg-red-700 text-white` when `isDestructive=true`; `bg-[var(--dtg-brand-orange)] text-white` when `isDestructive=false`
    - `isConfirmDisabled=true` disables the Confirm button to prevent duplicate submissions during in-flight operations
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 1.2 Create `components/admin/Radar/shared/EditModal.jsx`
    - Accept props: `isOpen`, `title`, `fields` (array of `FieldConfig`), `initialValues`, `onSave`, `onCancel`, `isSaving`
    - `FieldConfig` shape: `{ key, label, type: 'text'|'textarea'|'datetime-local'|'number'|'select'|'readonly', options?, computeOptions?, clearWhen?, required? }`
    - Render each field with the appropriate input element; `select` type renders a `<select>` with `options` array; `computeOptions(values)` dynamically derives options from current form state (used for Cause field in AlarmTab)
    - On Save: validate required fields — empty required fields get red border + inline error message; do NOT call `onSave` if validation fails
    - Call `onSave(mergedValues)` only when all required fields pass; modal does NOT close itself
    - _Requirements: 3.2, 3.6, 6.2, 6.7, 9.2, 9.6_


- [x] 2. Create `components/admin/Radar/Tabs/Tab_Container.jsx`
  - Render exactly four tab headers in order: Deformation, Alarm, Data Quality, Downtime
  - Accept props: `activeTab` (`'deformation'|'alarm'|'dqp'|'downtime'`), `onTabChange`
  - Active tab header: `border-b-2 border-[var(--dtg-brand-orange)]`; inactive tabs: muted style without that class
  - Clicking a tab header calls `onTabChange(tabKey)` — no internal state
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. Create `components/admin/Radar/Tabs/DowntimeTab.jsx`
  - [x] 3.1 Implement data fetching and table rendering
    - On mount and on `activeTab` change to `'downtime'`, query `downtime_records` where `wallfolder = sensor.wallfolder_id`, ordered by `from` descending (nulls last)
    - Display loading spinner while fetching (Requirement 1.6); display `"Failed to load downtime records."` on error; display `"No downtime records found."` on empty result
    - Render table with columns: Type, Reason, From, To, Detected By, Action, Notes, Notification Time, Site Engineer
    - Format `from`, `to`, `notification_time` using `fromUTC(value, timezone)`; resolve `detected_by` UUID to `full_name` from crosscheckers (fallback to raw UUID)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.2 Implement Edit flow for downtime records
    - Render Edit button per row; clicking opens `EditModal` pre-populated with record values (timestamps via `fromUTC`)
    - On Save: issue Supabase `update` on `downtime_records` (convert datetime inputs via `toUTC`); on success close modal and re-fetch; on failure show `toast.error` and keep modal open
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 3.3 Implement Delete flow for downtime records
    - Render Delete button per row; clicking opens `ConfirmDialog` with `isDestructive={true}`, `title="Delete Downtime Record"`, `message="Are you sure you want to delete this downtime record? This action cannot be undone."`
    - On Confirm: issue Supabase `delete` on `downtime_records` by `id`; on success close dialog and re-fetch; on failure show `toast.error` and keep dialog open
    - On Cancel: close dialog, no action
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_


- [x] 4. Create `components/admin/Radar/Tabs/AlarmTab.jsx`
  - [x] 4.1 Implement recent alarms fetch and table rendering
    - On mount and on `activeTab` change to `'alarm'`, fetch `alarm_records` where `alarm_region IN (alarm_regions.id for wallfolder)` AND `created_at >= now() - 24h`
    - Display loading spinner while fetching (Requirement 1.6); display `"Failed to load recent alarms."` on error (AlarmList above remains visible); display `"No alarms in the last 24 hours."` on empty result
    - Render table with columns: Alarm Region (name + type badge), Location, Reason, Detected By, Cause; ordered by `created_at` descending
    - Resolve `alarm_region` FK to `name` and `type` from alarm_regions list; resolve `detected_by` UUID to `full_name` from crosscheckers (fallback to raw UUID)
    - Render existing `AlarmList` component above the recent alarms table, passing through all existing props and `onRegionsLoaded` callback
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 4.2 Implement Edit flow for alarm records
    - Render Edit button per row; clicking opens `EditModal` pre-populated with: Alarm Region (dropdown of available regions), Location, Reason, Cause; Detected By as read-only
    - When Reason field changes in EditModal, reset Cause options to `CAUSE_OPTIONS[newReason]` and clear previously selected Cause (via `computeOptions` and `clearWhen` on the Cause field config)
    - On Save (Location, Reason, Cause all non-empty): issue Supabase `update` on `alarm_records` for `alarm_region`, `location`, `reason`, `cause`; on success close modal and re-fetch; on failure show `toast.error` and keep modal open
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

  - [x] 4.3 Implement Delete flow for alarm records
    - Render Delete button per row; clicking opens `ConfirmDialog` with `isDestructive={true}`, `title="Delete Alarm Record"`, `message="Are you sure you want to delete this alarm record? This action cannot be undone."`
    - Set `isDeletePending=true` on Confirm to disable the Confirm button during in-flight delete; on success close dialog and re-fetch; on failure show `toast.error`
    - On Cancel: close dialog, no action
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_


- [x] 5. Create `components/admin/Radar/Tabs/DQPTab.jsx`
  - Thin wrapper that renders `QualityTable`, `ActionRequiredModal`, and `FeedbackModal` with the same props they receive today in `SensorDetail`
  - Accept props: `dqpList`, `onUpdate`, `isDQPModalOpen`, `pendingUpdate`, `onDQPModalClose`, `onDQPModalSubmit`, `sharedRegions`, `isFeedbackModalOpen`, `feedbackModalData`, `onFeedbackSubmit`, `onFeedbackCancel`, `sensor`
  - No logic changes — all DQP state and handlers remain in `SensorDetail`; this component is purely a prop-forwarding shell
  - _Requirements: 8.1, 8.2, 8.3_

- [x] 6. Create `components/admin/Radar/Deformation/TimelineView.jsx`
  - Accept props: `chain` (array of `DefRecord` ordered root→current), `isLoading`, `error`, `timezone`, `crosscheckers`
  - Render a vertical timeline with a connecting line between nodes; root node at top, current (latest) node at bottom
  - Each node displays: `def_type`, `tarp_level` as coloured badge using `getStatusDotColors`, `location`, `created_at` formatted via `fromUTC(value, timezone)`, `detected_by` resolved to `full_name` (fallback to raw UUID)
  - Current (last) node: brand-orange border + "Current" badge; root node in multi-node chain: "Root" badge; archived precursors nodes: muted style (opacity-70)
  - Show inline warning `"Timeline may be incomplete."` when `error` is non-null
  - Show loading spinner when `isLoading=true`
  - _Requirements: 12.3, 12.4, 12.5, 12.8_

- [x] 7. Create `components/admin/Radar/Tabs/DeformationTab.jsx`
  - [x] 7.1 Implement data fetching and list rendering
    - On mount and on `activeTab` change to `'deformation'`, query `def_records` where `wallfolder_id = sensor.wallfolder_id` AND `isactive = 'Yes'`, ordered by `created_at` descending
    - Display loading spinner while fetching (Requirement 1.6); display inline error message on failure
    - Render `DeformationList` (modified in task 8) passing `rawList`, `filtered`, `search`, `onSearchChange`, `sensor`, `alarmRegion`, `crosscheckers`, `userSite`, and the new callback props: `onEdit`, `onHardDelete`, `onUpdate`, `onTimelineExpand`, `onTimelineCollapse`, `timelineRecord`, `timelineChain`, `timelineLoading`, `timelineError`
    - _Requirements: 9.1, 10.1, 11.1, 12.1, 14.3_

  - [x] 7.2 Implement Edit flow for deformation records
    - `handleEdit(record)` sets `editTarget` and opens `EditModal` pre-populated with: `def_type`, `location`, `start`, `notes`, `detected_by` (read-only), `crosschecked_by`, `notification_time`, `site_engineer`, and type-dependent dynamic fields from `properties` per `TYPE_MATRIX`; `tarp_level` as read-only
    - On Save: issue Supabase `update` on `def_records` for `id`; on success close modal and re-fetch; on failure show `toast.error` and keep modal open
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 7.3 Implement Hard Delete flow for deformation records
    - `handleHardDelete(record)` sets `deleteTarget` and opens `ConfirmDialog` with `isDestructive={true}`, `title="Permanently Delete Record"`, `message="Are you sure you want to permanently delete this deformation record? This action cannot be undone."`
    - On Confirm: issue Supabase `delete` on `def_records` by `id` (hard delete — no `isactive` update); on success close dialog and re-fetch; on failure show `toast.error` and keep dialog open
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 7.4 Implement Update (archive + precursors) flow for deformation records
    - `handleUpdate(record)` opens `ConfirmDialog` with `title="Update Deformation Record"` and `message="This will archive the current record and create a new deformation record with this record set as its precursors. Do you want to continue?"`
    - On Confirm: store `pendingPrecursors = record.id`, close dialog, open `AddDeformationForm` pre-filled with `wallfolder_id`, `location`, alarm region IDs from the current record
    - On AddDeformationForm cancel: discard `pendingPrecursors`, return to list without modifying any records
    - On AddDeformationForm submit: (1) Supabase `update` `def_records` set `isactive='No'` for `pendingPrecursors` — if fails, show `toast.error` and abort; (2) Supabase `insert` into `def_records` with `precursors=pendingPrecursors` — if fails, compensate by restoring `isactive='Yes'` on original record and show `toast.error("Archive succeeded but new record could not be created. The original record has been restored.")`; on full success re-fetch and show `toast.success`
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [x] 7.5 Implement timeline chain resolution
    - `handleTimelineExpand(record)` sets `timelineRecord`; if `record.precursors === null`, set `timelineChain = [record]` with no additional fetches
    - Otherwise, iteratively fetch `def_records` by `id` starting from `record.precursors`, prepending each to `chain`, until `precursors === null` or depth reaches 50; on any fetch error stop resolution, keep nodes fetched so far, set `timelineError`
    - Final `timelineChain` = `[...resolvedAncestors, record]` (root at index 0, current at last index)
    - `handleTimelineCollapse()` clears `timelineRecord`, `timelineChain`, `timelineError`
    - _Requirements: 12.1, 12.2, 12.6, 12.7, 12.8_


- [x] 8. Modify `components/admin/Radar/Deformation/DeformationList.jsx`
  - Add new callback props: `onEdit`, `onHardDelete`, `onUpdate`, `onTimelineExpand`, `onTimelineCollapse`
  - Add new display props: `timelineRecord`, `timelineChain`, `timelineLoading`, `timelineError`
  - Render Edit button, Hard Delete button (red icon, visually distinct from existing Trash2 archive button), and Update button per deformation card; each calls the corresponding callback prop
  - Remove `window.confirm` from any delete handler — replace with the `onHardDelete` callback prop (ConfirmDialog is now managed by `DeformationTab`)
  - Render `TimelineView` inside the latest card (highest `created_at`) when that card is expanded, passing `timelineChain`, `timelineLoading`, `timelineError`, `timezone`, `crosscheckers`; hide `TimelineView` when card is collapsed
  - _Requirements: 10.1, 11.1, 12.1, 12.3, 12.4, 12.5, 12.6_

- [x] 9. Checkpoint — Verify shared components and tab components compile
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Refactor `components/admin/Radar/SensorDetail.jsx`
  - [x] 10.1 Add `activeTab` state and Tab_Container
    - Add `const [activeTab, setActiveTab] = useState('deformation')` to `SensorDetail`
    - Reset `activeTab` to `'deformation'` in the `useEffect` that watches `sensor.id` (Property 1)
    - Render `<Tab_Container activeTab={activeTab} onTabChange={setActiveTab} />` inside the panel, replacing the current inline section headers
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 10.2 Wire tab-switch re-fetch effects
    - Add a `useEffect` that watches `activeTab`: when it changes to `'deformation'` call `fetchDeformationRecords`; when it changes to `'alarm'` the `AlarmTab` handles its own fetch via its `activeTab` prop; when it changes to `'downtime'` the `DowntimeTab` handles its own fetch via its `activeTab` prop; when it changes to `'dqp'` call `fetchDataQuality` only if `sensor.dqp_record_id` is non-null
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [x] 10.3 Replace inline content blocks with tab components
    - Remove the inline deformation list render block; replace with `{activeTab === 'deformation' && <DeformationTab sensor={sensor} timezone={timezone} crosscheckers={crosscheckers} userSite={userSite} alarmRegions={sharedRegions} activeTab={activeTab} />}`
    - Remove the inline alarm section; replace with `{activeTab === 'alarm' && <AlarmTab sensor={sensor} shift={shift} timezone={timezone} crosscheckers={crosscheckers} userSite={userSite} onRegionsLoaded={setSharedRegions} activeTab={activeTab} />}`
    - Replace DQP section with `{activeTab === 'dqp' && <DQPTab dqpList={dqpList} onUpdate={handleStatusRequest} isDQPModalOpen={isDQPModalOpen} pendingUpdate={pendingUpdate} onDQPModalClose={...} onDQPModalSubmit={...} sharedRegions={sharedRegions} isFeedbackModalOpen={isFeedbackModalOpen} feedbackModalData={feedbackModalData} onFeedbackSubmit={...} onFeedbackCancel={...} sensor={sensor} />}`
    - Add `{activeTab === 'downtime' && <DowntimeTab sensor={sensor} timezone={timezone} crosscheckers={crosscheckers} activeTab={activeTab} />}`
    - Keep all DQP state (`dqpList`, `parameterMap`, `isDQPModalOpen`, `pendingUpdate`, `isFeedbackModalOpen`, `feedbackModalData`, `pendingOptimalUpdate`) and their handlers in `SensorDetail`
    - _Requirements: 1.2, 8.1, 8.2, 8.3_

- [x] 11. Checkpoint — Verify full tabbed SensorDetail renders and all tabs are navigable
  - Ensure all tests pass, ask the user if questions arise.


- [x] 12. Extract pure helpers and write property-based tests using fast-check
  - [x] 12.0 Create `utils/tabHelpers.js` with pure helper functions
    - Extract `resolveDetectedBy(uuid, crosscheckers)`, `formatTimestamp(isoString, timezone)`, `isoToDatetimeLocal(isoString, timezone)`, `sortDowntimeRecords(records)`, `sortAlarmRecords(records)`, `getCauseOptions(reason)`, `resolveTimelineChain(latestRecord, fetchFn, maxDepth)`, `performDeformationUpdateFlow(client, originalId, insertPayload)` into this file
    - These functions must be framework-free so they can be tested in isolation
    - _Requirements: 2.3, 2.4, 2.6, 5.4, 5.6, 6.3, 11.5, 11.6, 11.8, 12.2_

  - [x] 12.1 Install `fast-check` and create test file
    - Install `fast-check` as a dev dependency if not already present: `npm install --save-dev fast-check`
    - Create test file `__tests__/sensor-detail-tabs-redesign.pbt.test.js`
    - Each test runs a minimum of 100 iterations; tag format: `// Feature: sensor-detail-tabs-redesign, Property N: <property text>`

  - [x] 12.2 Write property test for tab reset on sensor change (Property 1)
    - **Property 1: Tab reset on sensor change**
    - Generator: two arbitrary sensor objects with distinct `id` values and an arbitrary `activeTab` value
    - Assertion: after updating the sensor prop (simulated via the `sensor.id` change effect), `activeTab` resets to `'deformation'`
    - **Validates: Requirements 1.5**

  - [x] 12.3 Write property test for UUID-to-name resolution (Property 2)
    - **Property 2: UUID-to-name resolution is consistent across tabs**
    - Extract pure helper `resolveDetectedBy(uuid, crosscheckers)` from `utils/tabHelpers.js`
    - Generator: arbitrary crosscheckers list and arbitrary UUID string
    - Assertion: returns `full_name` if UUID is in the list, raw UUID string otherwise
    - **Validates: Requirements 2.3, 5.4**

  - [x] 12.4 Write property test for timestamp display using fromUTC (Property 3)
    - **Property 3: Timestamp display uses fromUTC**
    - Extract pure helper `formatTimestamp(isoString, timezone)` from `utils/tabHelpers.js`
    - Generator: arbitrary valid ISO timestamp string and arbitrary timezone string
    - Assertion: `formatTimestamp(isoString, timezone)` equals `fromUTC(isoString, timezone)` formatted via `toLocaleString('en-AU', ...)`
    - **Validates: Requirements 2.4**

  - [x] 12.5 Write property test for downtime records ordering (Property 4)
    - **Property 4: Downtime records are ordered by from descending**
    - Extract pure helper `sortDowntimeRecords(records)` from `utils/tabHelpers.js`
    - Generator: arbitrary array of downtime records with varying `from` values (including nulls)
    - Assertion: each non-null `from` is ≥ the next non-null `from`; all null-`from` records appear after all non-null ones; no records lost
    - **Validates: Requirements 2.6**

  - [x] 12.6 Write property test for alarm records ordering (Property 5)
    - **Property 5: Alarm records are ordered by created_at descending**
    - Extract pure helper `sortAlarmRecords(records)` from `utils/tabHelpers.js`
    - Generator: arbitrary array of alarm records with varying `created_at` values
    - Assertion: each `created_at` is ≥ the next; no records lost
    - **Validates: Requirements 5.6**

  - [x] 12.7 Write property test for cause options matching CAUSE_OPTIONS (Property 6)
    - **Property 6: Cause options match CAUSE_OPTIONS for the selected reason**
    - Extract pure helper `getCauseOptions(reason)` from `utils/tabHelpers.js`
    - Generator: arbitrary key from `Object.keys(CAUSE_OPTIONS)`
    - Assertion: `getCauseOptions(reason)` returns exactly `CAUSE_OPTIONS[reason]`
    - **Validates: Requirements 6.3**

  - [x] 12.8 Write property test for update flow precursors linkage (Property 7)
    - **Property 7: Update flow preserves precursors linkage**
    - Extract pure helper `performDeformationUpdateFlow(client, originalId, insertPayload)` from `utils/tabHelpers.js`
    - Generator: arbitrary deformation record with a valid `id`
    - Assertion: after a mocked successful update flow, the archive call sets `isactive='No'` for the original `id`, and the insert call includes `precursors = originalId`
    - **Validates: Requirements 11.5, 11.6**

  - [x] 12.9 Write property test for compensating transaction on insert failure (Property 8)
    - **Property 8: Compensating transaction restores isactive on insert failure**
    - Generator: arbitrary deformation record
    - Assertion: when the insert mock throws after the archive mock succeeds, a compensating update call restores `isactive='Yes'` for the original `id`
    - **Validates: Requirements 11.8**

  - [x] 12.10 Write property test for timeline chain ordering (Property 9)
    - **Property 9: Timeline chain is ordered from root to current**
    - Extract pure helper `resolveTimelineChain(latestRecord, fetchFn)` from `utils/tabHelpers.js`
    - Generator: arbitrary chain of deformation records linked by `precursors` (depth 1–10)
    - Assertion: `chain[0].precursors === null` and `chain[i+1].precursors === chain[i].id` for all i
    - **Validates: Requirements 12.2, 12.3**


- [x] 13. Write unit tests for shared components and tab components
  - Create test files alongside each component (e.g. `ConfirmDialog.test.jsx`, `EditModal.test.jsx`, `Tab_Container.test.jsx`, `DowntimeTab.test.jsx`, `AlarmTab.test.jsx`, `DeformationTab.test.jsx`)
  - Mock Supabase client via `jest.mock('@/lib/supabaseClient')`

  - [x] 13.1 Write unit tests for ConfirmDialog
    - Renders with correct title, message, and button labels
    - Backdrop click calls `onCancel`
    - Escape key calls `onCancel`
    - `isDestructive=true` renders Confirm button with red background class
    - `isDestructive=false` renders Confirm button with brand-orange background
    - `isConfirmDisabled=true` disables the Confirm button
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 13.2 Write unit tests for EditModal
    - Required-field validation shows inline errors and does NOT call `onSave`
    - `onSave` is called with correct merged values when all required fields are filled
    - `datetime-local` fields are pre-populated with `fromUTC`-formatted values
    - _Requirements: 3.2, 3.6, 6.2, 6.7, 9.2, 9.6_

  - [x] 13.3 Write unit tests for Tab_Container
    - Renders exactly four tab headers in the correct order
    - Clicking a tab header calls `onTabChange` with the correct tab key
    - Active tab header has the brand-orange border class; inactive tabs do not
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 13.4 Write unit tests for DowntimeTab
    - Displays `"No downtime records found."` when query returns empty array
    - Displays `"Failed to load downtime records."` when query returns an error
    - Edit button opens EditModal pre-populated with the correct record values
    - Delete button opens ConfirmDialog with the correct title and message
    - _Requirements: 2.5, 2.7, 3.1, 3.2, 4.1, 4.2_

  - [x] 13.5 Write unit tests for AlarmTab
    - Displays `"No alarms in the last 24 hours."` when query returns empty array
    - Displays `"Failed to load recent alarms."` when query returns an error
    - Alarm region name and type badge are resolved from the alarm_regions list
    - Confirm button is disabled while a delete is in progress (`isDeletePending=true`)
    - _Requirements: 5.5, 5.8, 5.2, 7.7_

  - [x] 13.6 Write unit tests for DeformationTab
    - Update flow: ConfirmDialog opens, then AddDeformationForm opens after Confirm
    - Cancelling AddDeformationForm discards `pendingPrecursors` without modifying any records
    - Hard Delete ConfirmDialog has `isDestructive=true`
    - Timeline is hidden when the latest card is collapsed
    - Single-node timeline renders when `precursors = null` with no additional fetches
    - _Requirements: 11.2, 11.3, 11.4, 10.2, 12.6, 12.7_

- [x] 14. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

