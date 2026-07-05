# Design Document: Sensor Detail Tabs Redesign

## Overview

This design restructures `SensorDetail.jsx` from a monolithic side-panel into a tabbed interface with four focused panels: **Deformation**, **Alarm**, **Data Quality (DQP)**, and **Downtime**. The refactor extracts each domain into its own tab component, adds edit/delete/update capabilities to the Deformation and Downtime tabs, adds a recent-alarms table to the Alarm tab, and introduces two shared utility components (`ConfirmDialog` and `EditModal`).

The existing DQP logic in `SensorDetail.jsx` is preserved unchanged — it is simply relocated into a `DQPTab` wrapper. All Supabase queries, state management, and UI patterns follow the conventions already established in the codebase (Tailwind CSS, `var(--dtg-*)` CSS variables, `react-hot-toast`, `framer-motion`, `lucide-react`).

### Goals

- Reduce cognitive load by separating concerns into focused tab panels.
- Add CRUD capabilities (edit, hard-delete, update/archive) to Deformation and Downtime records.
- Surface recent alarm activity (last 24 h) in the Alarm tab.
- Preserve all existing DQP behaviour without modification.
- Introduce reusable `ConfirmDialog` and `EditModal` components to avoid duplicating confirmation/form-modal patterns across tabs.

---

## Architecture

### High-Level Component Tree

```
SensorDetail (refactored shell)
├── Tab_Container
│   ├── Tab header: Deformation
│   ├── Tab header: Alarm
│   ├── Tab header: Data Quality
│   └── Tab header: Downtime
├── DeformationTab
│   ├── DeformationList (existing, modified)
│   │   ├── AddDeformationForm (existing, unchanged)
│   │   └── TimelineView (new)
│   ├── EditModal (shared)
│   └── ConfirmDialog (shared)
├── AlarmTab
│   ├── AlarmList (existing, unchanged)
│   ├── RecentAlarmsTable (new)
│   ├── EditModal (shared)
│   └── ConfirmDialog (shared)
├── DQPTab
│   ├── QualityTable (existing, unchanged)
│   ├── ActionRequiredModal (existing, unchanged)
│   └── FeedbackModal (existing, unchanged)
└── DowntimeTab
    ├── DowntimeTable (new)
    ├── EditModal (shared)
    └── ConfirmDialog (shared)
```

### State Ownership

`SensorDetail` retains ownership of:
- `sensor` prop (passed down to all tabs)
- `crosscheckers` list (fetched once on mount, passed to all tabs)
- `sharedRegions` (populated by `AlarmList.onRegionsLoaded`, passed to `DQPTab`)
- DQP state: `dqpList`, `parameterMap`, `isDQPModalOpen`, `pendingUpdate`, `isFeedbackModalOpen`, `feedbackModalData`, `pendingOptimalUpdate`
- `activeTab` string (`'deformation' | 'alarm' | 'dqp' | 'downtime'`)

Each tab component owns its own data-fetching state (records list, loading flag, error flag) and modal state (which record is selected for edit/delete).


---

## Components and Interfaces

### Tab_Container

A thin presentational component rendered inside `SensorDetail`. It receives `activeTab` and `onTabChange` as props and renders the four tab headers. The actual content panels are rendered by `SensorDetail` using conditional rendering (`activeTab === 'deformation' && <DeformationTab ... />`).

```jsx
// Props
{
  activeTab: 'deformation' | 'alarm' | 'dqp' | 'downtime',
  onTabChange: (tab: string) => void
}
```

Tab headers use `border-b-2 border-[var(--dtg-brand-orange)]` for the active tab and a muted style for inactive tabs. The four tab labels are: `Deformation`, `Alarm`, `Data Quality`, `Downtime`.

---

### DeformationTab

Replaces the deformation section currently embedded in `SensorDetail`. Owns all deformation-specific state.

```jsx
// Props
{
  sensor: object,
  timezone: string,
  crosscheckers: UserProfile[],
  userSite: object,
  alarmRegions: AlarmRegion[]   // from sharedRegions in SensorDetail
}

// Internal state
deformationList: DefRecord[]
isLoading: boolean
error: string | null
editTarget: DefRecord | null       // record open in EditModal
deleteTarget: DefRecord | null     // record open in ConfirmDialog (hard delete)
updateTarget: DefRecord | null     // record open in ConfirmDialog (archive+precursors)
pendingPrecursors: number | null    // id of record being archived during Update flow
showAddForm: boolean               // whether AddDeformationForm is open
timelineRecord: DefRecord | null   // the expanded record whose chain is being shown
timelineChain: DefRecord[]         // resolved precursors chain
timelineLoading: boolean
timelineError: string | null
```

**Key methods:**
- `fetchDeformationRecords()` — queries `def_records` where `wallfolder_id = sensor.wallfolder_id` and `isactive = 'Yes'`, ordered by `created_at` descending.
- `handleEdit(record)` — sets `editTarget`, opens `EditModal`.
- `handleEditSave(formValues)` — issues Supabase `update` on `def_records`, re-fetches on success.
- `handleHardDelete(record)` — sets `deleteTarget`, opens `ConfirmDialog`.
- `handleHardDeleteConfirm()` — issues Supabase `delete` on `def_records`, re-fetches on success.
- `handleUpdate(record)` — sets `updateTarget`, opens `ConfirmDialog`.
- `handleUpdateConfirm()` — stores `pendingPrecursors = updateTarget.id`, opens `AddDeformationForm`.
- `handleAddFormSubmit(formValues)` — archives original record (`isactive = 'No'`), inserts new record with `precursors = pendingPrecursors`; compensates on partial failure.
- `handleTimelineExpand(record)` — sets `timelineRecord`, triggers chain resolution.
- `handleTimelineCollapse()` — clears `timelineRecord` and `timelineChain`.

---

### AlarmTab

Owns the recent-alarms table state. The existing `AlarmList` component is rendered above the new table.

```jsx
// Props
{
  sensor: object,
  shift: string,
  timezone: string,
  crosscheckers: UserProfile[],
  userSite: object,
  onRegionsLoaded: (regions) => void   // passed through to AlarmList
}

// Internal state
recentAlarms: AlarmRecord[]
isLoading: boolean
error: string | null
editTarget: AlarmRecord | null
deleteTarget: AlarmRecord | null
isDeletePending: boolean   // disables Confirm button during in-flight delete
```

**Key methods:**
- `fetchRecentAlarms()` — fetches `alarm_records` where `alarm_region IN (region ids for wallfolder)` and `created_at >= now() - 24h`.
- `handleEdit(record)` — opens `EditModal` pre-populated with record values.
- `handleEditSave(formValues)` — issues Supabase `update` on `alarm_records`, re-fetches on success.
- `handleDelete(record)` — opens `ConfirmDialog`.
- `handleDeleteConfirm()` — sets `isDeletePending = true`, issues Supabase `delete`, re-fetches on success.


---

### DQPTab

A thin wrapper that renders the existing `QualityTable`, `ActionRequiredModal`, and `FeedbackModal` with the same props they receive today. No logic changes.

```jsx
// Props
{
  dqpList: DqpItem[],
  onUpdate: (item, field, value) => void,   // handleStatusRequest from SensorDetail
  isDQPModalOpen: boolean,
  pendingUpdate: object | null,
  onDQPModalClose: () => void,
  onDQPModalSubmit: (formData, item, targetStatus) => void,
  sharedRegions: AlarmRegion[],
  isFeedbackModalOpen: boolean,
  feedbackModalData: object[],
  onFeedbackSubmit: (itemData) => void,
  onFeedbackCancel: () => void,
  sensor: object   // for dqp_record_id null-check
}
```

When `activeTab` changes to `'dqp'`, `SensorDetail` calls `fetchDataQuality()` only if `sensor.dqp_record_id` is non-null.

---

### DowntimeTab

New component. Owns all downtime-specific state.

```jsx
// Props
{
  sensor: object,
  timezone: string,
  crosscheckers: UserProfile[]
}

// Internal state
downtimeList: DowntimeRecord[]
isLoading: boolean
error: string | null
editTarget: DowntimeRecord | null
deleteTarget: DowntimeRecord | null
```

**Key methods:**
- `fetchDowntimeRecords()` — queries `downtime_records` where `wallfolder = sensor.wallfolder_id`, ordered by `from` descending (nulls last).
- `handleEdit(record)` — opens `EditModal` pre-populated with record values (timestamps formatted via `fromUTC`).
- `handleEditSave(formValues)` — issues Supabase `update` on `downtime_records` (timestamps converted via `toUTC`), re-fetches on success.
- `handleDelete(record)` — opens `ConfirmDialog`.
- `handleDeleteConfirm()` — issues Supabase `delete` on `downtime_records`, re-fetches on success.

---

### ConfirmDialog (shared)

New reusable component at `components/admin/Radar/shared/ConfirmDialog.jsx`.

```jsx
// Props
{
  isOpen: boolean,
  title: string,
  message: string,
  onConfirm: () => void,
  onCancel: () => void,
  isDestructive?: boolean,       // default false
  confirmLabel?: string,         // default "Confirm"
  cancelLabel?: string,          // default "Cancel"
  isConfirmDisabled?: boolean    // for in-flight operations
}
```

Renders as a fixed overlay with `z-50`. Backdrop click and Escape key both call `onCancel`. The component does **not** manage its own open/close state — the parent controls `isOpen`.

Confirm button styling:
- `isDestructive = true` → `bg-red-600 hover:bg-red-700 text-white`
- `isDestructive = false` → `bg-[var(--dtg-brand-orange)] text-white`

---

### EditModal (shared)

New reusable component at `components/admin/Radar/shared/EditModal.jsx`. Renders a modal with a dynamic form driven by a `fields` prop array.

```jsx
// Props
{
  isOpen: boolean,
  title: string,
  fields: FieldConfig[],   // see below
  initialValues: object,
  onSave: (values: object) => void,
  onCancel: () => void,
  isSaving?: boolean
}

// FieldConfig shape
{
  key: string,
  label: string,
  type: 'text' | 'textarea' | 'datetime-local' | 'number' | 'select' | 'readonly',
  options?: { value: string, label: string }[],   // for type='select'
  required?: boolean
}
```

The modal renders each field using the appropriate input element. Validation runs on Save: required fields that are empty get a red border and inline error message. The modal does not close itself — the parent controls `isOpen`.


---

## Data Models

### DefRecord (def_records table)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| created_at | timestamptz | |
| wallfolder_id | int | FK → radar_wall_folders.id |
| def_type | text | e.g. "Linear", "Progressive" |
| tarp_level | text | e.g. "TARP 3" — derived from TYPE_MATRIX |
| isactive | text | "Yes" / "No" |
| location | text | |
| start | timestamptz | time of event/trend start |
| notes | text | |
| detected_by | uuid | FK → auth.users |
| crosschecked_by | uuid | FK → auth.users |
| notification_time | timestamptz | |
| site_engineer | text | |
| properties | jsonb | dynamic fields per TYPE_MATRIX |
| precursors | uuid | FK → def_records.id (nullable) |
| alarm | uuid[] | linked alarm region IDs |

### AlarmRecord (alarm_records table)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| created_at | timestamptz | |
| alarm_region | int | FK → alarm_regions.id |
| location | text | |
| reason | text | "Valid" / "False" |
| cause | text | from CAUSE_OPTIONS |
| detected_by | uuid | FK → auth.users |
| crosschecked_by | uuid | |
| triggered_at | timestamptz | |
| deformation | uuid | FK → def_records.id (nullable) |

### AlarmRegion (alarm_regions table)

| Column | Type | Notes |
|---|---|---|
| id | int | PK |
| wallfolder_id | int | FK → radar_wall_folders.id |
| name | text | |
| type | text | priority label (Red/Orange/Yellow/Purple/Blue) |
| isactive | text | "Active" / "Inactive" |

### DowntimeRecord (downtime_records table)

| Column | Type | Notes |
|---|---|---|
| id | uuid | PK |
| wallfolder | int | FK → radar_wall_folders.id |
| type | text | e.g. "Link Down", "Lost Connection" |
| reason | text | |
| from | timestamptz | nullable |
| to | timestamptz | nullable |
| detected_by | uuid | FK → auth.users |
| crosschecked_by | uuid | |
| action | text | |
| notes | text | |
| notification_time | timestamptz | |
| site_engineer | text | |
| snapshot | jsonb | DQP snapshot for restore |

---

## Data Flow Diagrams

### Update Flow (Archive + Precursors Chain)

```
User clicks "Update" on DeformationCard
        │
        ▼
ConfirmDialog opens
"This will archive the current record and create a new one..."
        │
  User clicks Confirm
        │
        ▼
pendingPrecursors = record.id
AddDeformationForm opens (pre-filled: wallfolder_id, location, alarm regions)
        │
  User fills form and submits
        │
        ▼
Step 1: supabase.update(def_records)
        .set({ isactive: 'No' })
        .eq('id', pendingPrecursors)
        │
  ┌─────┴──────┐
  │ Error      │ Success
  │            │
  ▼            ▼
toast.error  Step 2: supabase.insert(def_records)
abort          { ...formValues, precursors: pendingPrecursors }
               │
         ┌─────┴──────┐
         │ Error      │ Success
         │            │
         ▼            ▼
  Compensate:      toast.success
  supabase.update  re-fetch records
  .set({ isactive: 'Yes' })
  .eq('id', pendingPrecursors)
  toast.error("Partial failure...")
```

### Timeline Chain Resolution

```
User expands latest DeformationCard (highest created_at)
        │
        ▼
timelineRecord = latestRecord
IF latestRecord.precursors === null
  → render single-node timeline, no fetch
ELSE
  → start chain resolution loop:

  chain = []
  currentId = latestRecord.precursors
  depth = 0

  WHILE currentId !== null AND depth < 50:
    fetch def_records WHERE id = currentId
    IF error → stop, show "Timeline may be incomplete."
    ELSE
      chain.unshift(fetchedRecord)   // prepend (oldest first)
      currentId = fetchedRecord.precursors
      depth++

  render timeline: [...chain, latestRecord]
  (root at top, current at bottom)
```


---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Tab reset on sensor change

*For any* two distinct sensor objects (differing `id`), when `SensorDetail` transitions from displaying the first sensor to the second, the `activeTab` value SHALL be `'deformation'` regardless of which tab was active before the transition.

**Validates: Requirements 1.5**

---

### Property 2: UUID-to-name resolution is consistent across tabs

*For any* record (downtime, alarm, or deformation) whose `detected_by` field is a UUID, the displayed value SHALL be the `full_name` from the crosscheckers list if a matching entry exists, and the raw UUID string otherwise. This property holds for all records across all tabs that display a `detected_by` field.

**Validates: Requirements 2.3, 5.4**

---

### Property 3: Timestamp display uses fromUTC

*For any* non-null ISO timestamp stored in a downtime record's `from`, `to`, or `notification_time` column, the value rendered in the Downtime table SHALL equal `fromUTC(value, timezone)` — never the raw UTC string.

**Validates: Requirements 2.4**

---

### Property 4: Downtime records are ordered by from descending

*For any* non-empty array of downtime records returned by Supabase, the rows rendered in the Downtime table SHALL appear in descending order of `from` (most recent first), with null-`from` records appearing after all non-null records.

**Validates: Requirements 2.6**

---

### Property 5: Alarm records are ordered by created_at descending

*For any* non-empty array of recent alarm records, the rows rendered in the recent alarms table SHALL appear in descending order of `created_at`.

**Validates: Requirements 5.6**

---

### Property 6: Cause options match CAUSE_OPTIONS for the selected reason

*For any* reason value that is a key in `CAUSE_OPTIONS`, when the Reason field in the Alarm EditModal is set to that value, the available options in the Cause dropdown SHALL be exactly `CAUSE_OPTIONS[reason]` — no more, no fewer.

**Validates: Requirements 6.3**

---

### Property 7: Update flow preserves precursors linkage

*For any* deformation record R that undergoes a successful Update flow, after both operations complete: (a) R's `isactive` SHALL be `'No'`, and (b) the newly inserted record's `precursors` SHALL equal R's `id`.

**Validates: Requirements 11.5, 11.6**

---

### Property 8: Compensating transaction restores isactive on insert failure

*For any* deformation record R where the archive step succeeds (sets `isactive = 'No'`) but the subsequent insert step fails, R's `isactive` SHALL be restored to `'Yes'` by the compensating update, leaving the database in its pre-update state.

**Validates: Requirements 11.8**

---

### Property 9: Timeline chain is ordered from root to current

*For any* deformation record R with a non-null precursors chain of depth N (where N ≤ 50), the resolved timeline SHALL contain N+1 nodes ordered from the root record (the one with `precursors = null`) at index 0 to R at index N, with no gaps or reversals.

**Validates: Requirements 12.2, 12.3**

---

## Error Handling

### Per-Tab Error States

Each tab component maintains an `error` string in local state. When a Supabase query fails:

- **DowntimeTab**: Renders `"Failed to load downtime records."` in place of the table. Edit/delete operations show `toast.error(...)` and keep the modal open.
- **AlarmTab**: Renders `"Failed to load recent alarms."` in place of the recent alarms table. The `AlarmList` above remains visible. Edit/delete operations show `toast.error(...)`.
- **DeformationTab**: Renders an inline error message. Edit/delete/update operations show `toast.error(...)`. The Update flow's partial-failure case shows a specific message: `"Archive succeeded but new record could not be created. The original record has been restored."`.
- **DQPTab**: Logs errors to the console (existing behaviour). Does not disrupt the UI.

### Modal Error Handling

- `EditModal`: On save failure, keeps the modal open with the user's unsaved values intact and shows `toast.error(...)`.
- `ConfirmDialog`: On delete failure, keeps the dialog open and shows `toast.error(...)`. The `isConfirmDisabled` prop prevents duplicate submissions during in-flight operations.

### Timeline Error Handling

If any fetch in the precursors chain resolution fails, the timeline renders the nodes fetched so far and shows an inline warning badge: `"Timeline may be incomplete."` The chain resolution stops at the failed node.


---

## Testing Strategy

### Unit Tests (Example-Based)

Unit tests cover specific interactions, edge cases, and error conditions. They use a mock Supabase client (e.g. `jest.mock('@/lib/supabaseClient')`).

**Tab_Container:**
- Renders exactly four tab headers in the correct order.
- Clicking a tab header calls `onTabChange` with the correct tab key.
- Active tab header has the brand-orange border class; inactive tabs do not.
- Defaults to `'deformation'` on first render.

**ConfirmDialog:**
- Renders with correct title, message, and button labels.
- Backdrop click calls `onCancel`.
- Escape key calls `onCancel`.
- `isDestructive=true` renders Confirm button with red background.
- `isDestructive=false` renders Confirm button with brand-orange background.
- `isConfirmDisabled=true` disables the Confirm button.

**EditModal:**
- Required-field validation shows inline errors and does not call `onSave`.
- `onSave` is called with the correct merged values when all required fields are filled.
- `datetime-local` fields are pre-populated with `fromUTC`-formatted values.

**DowntimeTab:**
- Displays `"No downtime records found."` when query returns empty array.
- Displays `"Failed to load downtime records."` when query returns an error.
- Edit button opens EditModal pre-populated with the correct record values.
- Delete button opens ConfirmDialog with the correct title and message.

**AlarmTab:**
- Displays `"No alarms in the last 24 hours."` when query returns empty array.
- Displays `"Failed to load recent alarms."` when query returns an error.
- Alarm region name and type badge are resolved from the alarm_regions list.
- Confirm button is disabled while a delete is in progress.

**DeformationTab:**
- Update flow: ConfirmDialog opens, then AddDeformationForm opens after Confirm.
- Cancelling AddDeformationForm discards `pendingPrecursors` without modifying any records.
- Hard Delete ConfirmDialog has `isDestructive=true`.
- Timeline is hidden when the latest card is collapsed.
- Single-node timeline renders when `precursors = null` with no additional fetches.

### Property-Based Tests

Property-based tests use a PBT library appropriate for the project's JavaScript/TypeScript stack. The recommended library is **fast-check** (`npm install --save-dev fast-check`), which integrates well with Jest and supports TypeScript.

Each property test runs a minimum of **100 iterations**.

Tag format for each test: `// Feature: sensor-detail-tabs-redesign, Property N: <property text>`

**Property 1 — Tab reset on sensor change** (`fast-check`)
- Generator: two arbitrary sensor objects with distinct `id` values and an arbitrary `activeTab` value.
- Assertion: after updating the sensor prop, `activeTab` resets to `'deformation'`.

**Property 2 — UUID-to-name resolution** (`fast-check`)
- Generator: arbitrary crosscheckers list and arbitrary UUID string.
- Assertion: `resolveDetectedBy(uuid, crosscheckers)` returns `full_name` if UUID is in the list, raw UUID otherwise.
- This tests the pure helper function extracted from the tab components.

**Property 3 — Timestamp display uses fromUTC** (`fast-check`)
- Generator: arbitrary valid ISO timestamp string and arbitrary timezone string.
- Assertion: `formatTimestamp(isoString, timezone)` equals `fromUTC(isoString, timezone)`.

**Property 4 — Downtime records ordered by from descending** (`fast-check`)
- Generator: arbitrary array of downtime records with varying `from` values (including nulls).
- Assertion: `sortDowntimeRecords(records)` produces an array where each non-null `from` is ≥ the next non-null `from`, and all null-`from` records appear after all non-null ones.

**Property 5 — Alarm records ordered by created_at descending** (`fast-check`)
- Generator: arbitrary array of alarm records with varying `created_at` values.
- Assertion: `sortAlarmRecords(records)` produces an array where each `created_at` is ≥ the next.

**Property 6 — Cause options match CAUSE_OPTIONS** (`fast-check`)
- Generator: arbitrary key from `Object.keys(CAUSE_OPTIONS)`.
- Assertion: `getCauseOptions(reason)` returns exactly `CAUSE_OPTIONS[reason]`.

**Property 7 — Update flow preserves precursors linkage** (`fast-check`)
- Generator: arbitrary deformation record with a valid `id`.
- Assertion: after a mocked successful update flow, the archive call sets `isactive = 'No'` for the original `id`, and the insert call includes `precursors = originalId`.

**Property 8 — Compensating transaction on insert failure** (`fast-check`)
- Generator: arbitrary deformation record.
- Assertion: when the insert mock throws an error after the archive mock succeeds, a compensating update call is made to restore `isactive = 'Yes'` for the original `id`.

**Property 9 — Timeline chain ordered from root to current** (`fast-check`)
- Generator: arbitrary chain of deformation records linked by `precursors` (depth 1–10).
- Assertion: `resolveTimelineChain(latestRecord, fetchFn)` returns an array where `chain[0].precursors === null` and `chain[i+1].precursors === chain[i].id` for all i.

### Integration Tests

- DQP tab renders `QualityTable` with the same data and callbacks as before the redesign (snapshot test).
- Switching to each tab triggers the correct Supabase query (mock Supabase, assert call arguments).
- Full Update flow end-to-end: archive + insert + re-fetch (mock Supabase, assert all three calls in order).


---

## File Structure

### New Files to Create

```
components/admin/Radar/
├── shared/
│   ├── ConfirmDialog.jsx          # Reusable confirmation modal (Req 13)
│   └── EditModal.jsx              # Reusable generic form modal (Req 3, 6, 9)
├── Tabs/
│   ├── Tab_Container.jsx          # Tab header bar (Req 1)
│   ├── DeformationTab.jsx         # Deformation tab panel (Req 9–12)
│   ├── AlarmTab.jsx               # Alarm tab panel (Req 5–7)
│   ├── DQPTab.jsx                 # DQP tab panel wrapper (Req 8)
│   └── DowntimeTab.jsx            # Downtime tab panel (Req 2–4)
└── Deformation/
    └── TimelineView.jsx           # Precursors chain timeline (Req 12)
```

### Existing Files to Modify

```
components/admin/Radar/
└── SensorDetail.jsx               # Refactored shell:
                                   # - Remove inline deformation/alarm/downtime render blocks
                                   # - Add activeTab state + Tab_Container
                                   # - Add tab-switch useEffect for data re-fetch (Req 14)
                                   # - Keep all DQP state and handlers (Req 8)
                                   # - Pass crosscheckers, sharedRegions, timezone down to tabs

components/admin/Radar/Deformation/
└── DeformationList.jsx            # Minor modifications:
                                   # - Replace window.confirm with ConfirmDialog prop callbacks
                                   # - Add Edit button per card
                                   # - Add Hard Delete button per card (distinct from archive Trash2)
                                   # - Add Update button per card
                                   # - Accept onEdit, onHardDelete, onUpdate callback props
                                   # - Accept timelineChain, timelineLoading, timelineError props
                                   # - Render TimelineView when a card is expanded
```

### Files Left Unchanged

```
components/admin/Radar/Alarm/AlarmList.jsx          # No changes
components/admin/Radar/Alarm/AddAlarmForm.tsx        # No changes
components/admin/Radar/Alarm/BatchAlarmImport.tsx    # No changes
components/admin/Radar/Deformation/AddDeformationForm.tsx  # No changes
components/admin/Radar/Dqp/DqpTable.jsx             # No changes
components/admin/Radar/Dqp/ActionRequiredModal.jsx  # No changes
components/admin/Radar/Dqp/FeedbackModal.jsx        # No changes
config/formConfig.ts                                 # No changes
config/statusConfig.ts                               # No changes
utils/timezoneUtils                                  # No changes
```

---

## Design Decisions and Rationale

**Why keep DQP state in SensorDetail rather than DQPTab?**
The DQP handlers (`handleStatusRequest`, `executeDirectUpdate`, `handleModalSubmit`, `handleFeedbackSubmit`) are tightly coupled to `SensorDetail`'s `dqpList` state and the `fetchDataQuality` callback. Moving them into `DQPTab` would require either prop-drilling the entire DQP state tree or introducing a context. Since the requirement is to preserve existing DQP behaviour unchanged, the safest approach is to keep the state in `SensorDetail` and pass it down to `DQPTab` as props.

**Why use a `fields` array prop for EditModal rather than per-tab custom modals?**
The three tabs that need edit modals (Downtime, Alarm, Deformation) have different field sets but the same modal chrome (title, save/cancel buttons, validation). A generic `fields`-driven `EditModal` avoids duplicating the modal shell three times while remaining flexible enough to handle all field types present in the codebase (`text`, `textarea`, `datetime-local`, `number`, `select`, `readonly`).

**Why cap the timeline chain at 50 nodes?**
The precursors chain is a linked list stored in the database. Without a cap, a corrupted chain (circular reference or very long history) could trigger an unbounded number of sequential Supabase queries, degrading performance and potentially hanging the UI. 50 nodes is well beyond any realistic deformation history depth while providing a hard safety limit.

**Why use fast-check for property-based testing?**
The project uses Next.js with TypeScript/JavaScript. `fast-check` is the most widely adopted PBT library in the JS/TS ecosystem, has first-class TypeScript support, integrates directly with Jest (the standard test runner for Next.js projects), and does not require any additional test runner setup.

**Why does DeformationTab own the timeline state rather than DeformationList?**
`DeformationList` is a presentational component that receives its data as props. Keeping the async chain-resolution logic in `DeformationTab` (the container) maintains the existing pattern where `DeformationList` is a pure renderer and all data fetching lives in the parent.
