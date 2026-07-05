# Requirements Document

## Introduction

This feature restructures the `SensorDetail` panel into a tabbed interface with four tabs: **Deformation**, **Alarm**, **Data Quality (DQP)**, and **Downtime**. Each tab surfaces existing or new data from Supabase in a focused, actionable view. The redesign also adds edit, delete, and update (archive + precursors chain) capabilities to the Deformation tab, a recent-alarm table to the Alarm tab, a full downtime records table to the Downtime tab, and a deformation event timeline to the Deformation tab.

## Glossary

- **SensorDetail**: The main side-panel component (`SensorDetail.jsx`) that displays details for a selected radar sensor/wall-folder.
- **Tab**: A clickable navigation element that switches the visible content panel within SensorDetail.
- **ActiveTab**: The currently selected tab; one of `deformation | alarm | dqp | downtime`.
- **WallFolder**: A logical grouping of a radar sensor identified by `sensor.wallfolder_id`.
- **DeformationRecord**: A row in the `def_records` table representing an observed deformation or event.
- **AlarmRecord**: A row in the `alarm_records` table representing a triggered alarm.
- **AlarmRegion**: A row in the `alarm_regions` table; referenced by `alarm_records.alarm_region`.
- **DowntimeRecord**: A row in the `downtime_records` table representing a period of sensor downtime.
- **Precursors**: A `def_records` column (`precursors`) that stores the `id` of the archived predecessor deformation record, forming a chain.
- **Timeline**: A visual representation of the deformation/event chain from the earliest precursors to the current active record.
- **ConfirmationModal**: A pop-up dialog that asks the user to confirm a destructive or mutating action before it is applied.
- **Tab_Container**: The UI component that renders the four tab headers and the active tab's content panel.
- **Downtime_Tab**: The tab panel that displays and manages downtime records.
- **Alarm_Tab**: The tab panel that displays recently added alarm records (last 24 hours).
- **DQP_Tab**: The tab panel that renders the existing `QualityTable` component unchanged.
- **Deformation_Tab**: The tab panel that displays, edits, updates, and hard-deletes deformation records.
- **ConfirmDialog**: A reusable modal component used for delete and update confirmations.
- **EditModal**: A modal form used to edit an existing record in-place.
- **UpdateFlow**: The two-step process of archiving the current deformation record and inserting a new one with the archived record's `id` set as `precursors`.

---

## Requirements

### Requirement 1: Tabbed Navigation

**User Story:** As an admin user, I want SensorDetail to be organised into tabs so that I can quickly navigate between Deformation, Alarm, Data Quality, and Downtime information without scrolling.

#### Acceptance Criteria

1. THE Tab_Container SHALL render exactly four tab headers in the order: Deformation, Alarm, Data Quality, Downtime.
2. WHEN a tab header is clicked, THE Tab_Container SHALL display only the content panel for that tab and make the other three content panels not visible in the DOM or hidden from view.
3. WHERE the ActiveTab is a given tab, THE Tab_Container SHALL apply a visually distinct style to that tab header — specifically a bottom border or background highlight using the project's brand colour (`var(--dtg-brand-orange)`) — and SHALL NOT apply that style to inactive tab headers.
4. WHEN SensorDetail is first opened for a sensor, THE Tab_Container SHALL default to the Deformation tab as the ActiveTab.
5. WHEN the selected sensor changes (i.e. the `sensor.id` prop changes), THE Tab_Container SHALL reset the ActiveTab to Deformation.
6. WHILE a tab's content is loading data after being selected, THE Tab_Container SHALL display a loading indicator (spinner or skeleton) inside that tab's content panel until the fetch completes.

---

### Requirement 2: Downtime Tab — Records Table

**User Story:** As an admin user, I want to view all downtime records for the selected wall-folder in a table so that I can review the sensor's downtime history.

#### Acceptance Criteria

1. WHEN the Downtime tab becomes the ActiveTab, THE Downtime_Tab SHALL issue a Supabase query to `downtime_records` filtered by `wallfolder = sensor.wallfolder_id` and SHALL display a loading indicator until the query resolves.
2. THE Downtime_Tab SHALL display the fetched records in a table with exactly these columns in order: Type, Reason, From, To, Detected By, Action, Notes, Notification Time, Site Engineer.
3. WHERE a `detected_by` value is a UUID matching a user in the crosscheckers list, THE Downtime_Tab SHALL display that user's `full_name`; WHERE no match is found, THE Downtime_Tab SHALL display the raw UUID value.
4. WHERE `from`, `to`, or `notification_time` is a non-null ISO timestamp, THE Downtime_Tab SHALL format and display it using the project's `fromUTC(value, timezone)` utility so the displayed time reflects the sensor's local timezone.
5. WHEN the query returns zero rows, THE Downtime_Tab SHALL display the message "No downtime records found." in place of the table.
6. THE Downtime_Tab SHALL display records ordered by `from` descending; WHERE a record's `from` is null, THE Downtime_Tab SHALL sort that record after all records with a non-null `from`.
7. IF the Supabase query returns an error, THEN THE Downtime_Tab SHALL display an error message "Failed to load downtime records." and SHALL NOT render the table.

---

### Requirement 3: Downtime Tab — Edit Record

**User Story:** As an admin user, I want to edit an existing downtime record so that I can correct or update its details.

#### Acceptance Criteria

1. THE Downtime_Tab SHALL render an Edit button for each row in the downtime table.
2. WHEN the Edit button for a row is clicked, THE Downtime_Tab SHALL open an EditModal pre-populated with that row's current values for: Type, Reason, From (formatted via `fromUTC`), To (formatted via `fromUTC`), Detected By, Action, Notes, Notification Time (formatted via `fromUTC`), Site Engineer.
3. WHILE the EditModal is open and the user has not yet clicked Save, THE Downtime_Tab SHALL keep the downtime table visible and interactive behind the modal.
4. WHEN the user clicks Save in the EditModal, THE Downtime_Tab SHALL issue a Supabase `update` on `downtime_records` for the record's `id` with the new field values (converting datetime inputs back to UTC via `toUTC`).
5. WHEN the update succeeds, THE Downtime_Tab SHALL close the EditModal and re-fetch all downtime records for the wall-folder to refresh the table.
6. IF the update fails, THEN THE Downtime_Tab SHALL display an error toast notification and keep the EditModal open with the user's unsaved changes intact.

---

### Requirement 4: Downtime Tab — Delete Record

**User Story:** As an admin user, I want to delete a downtime record with a confirmation prompt so that I can remove incorrect entries without accidental deletion.

#### Acceptance Criteria

1. THE Downtime_Tab SHALL render a Delete button for each row in the downtime table.
2. WHEN the Delete button for a row is clicked, THE Downtime_Tab SHALL open a ConfirmDialog with `isDestructive={true}`, `title="Delete Downtime Record"`, and `message="Are you sure you want to delete this downtime record? This action cannot be undone."`.
3. WHEN the user clicks Confirm in the ConfirmDialog, THE Downtime_Tab SHALL issue a Supabase `delete` on `downtime_records` filtered by the `id` of the record associated with the clicked Delete button.
4. WHEN the deletion succeeds, THE Downtime_Tab SHALL close the ConfirmDialog and re-fetch all downtime records for the wall-folder from `downtime_records` to refresh the table.
5. IF the deletion fails, THEN THE Downtime_Tab SHALL display an error toast notification indicating the deletion failed and SHALL keep the ConfirmDialog open.
6. WHEN the user clicks Cancel in the ConfirmDialog, THE Downtime_Tab SHALL close the dialog and take no further action.

---

### Requirement 5: Alarm Tab — Recent Alarms Table

**User Story:** As an admin user, I want to see alarms added in the last 24 hours for the selected wall-folder so that I can quickly review recent alarm activity.

#### Acceptance Criteria

1. WHEN the Alarm tab becomes the ActiveTab, THE Alarm_Tab SHALL fetch rows from `alarm_records` where `alarm_region` is in the set of `alarm_regions.id` values whose `wallfolder_id` equals `sensor.wallfolder_id`, AND where `created_at` is greater than or equal to `(now() - interval '24 hours')` in UTC.
2. THE Alarm_Tab SHALL resolve each `alarm_region` foreign key to `alarm_regions.id` and display the region's `name` and `type` (priority level) in a combined "Alarm Region" cell.
3. THE Alarm_Tab SHALL display the fetched records in a table with exactly these columns: Alarm Region (name + type badge), Location, Reason, Detected By, Cause.
4. WHERE a `detected_by` value is a UUID matching a user in the crosscheckers list, THE Alarm_Tab SHALL display that user's `full_name`; WHERE no match is found, THE Alarm_Tab SHALL display the raw UUID value.
5. WHEN the query returns zero rows for the last 24 hours, THE Alarm_Tab SHALL display the message "No alarms in the last 24 hours." in place of the recent alarms table.
6. THE Alarm_Tab SHALL display records ordered by `created_at` descending.
7. THE Alarm_Tab SHALL render the existing `AlarmList` component (region summary with progress bars) above the recent alarms table, preserving all its existing props and behaviour.
8. IF the Supabase query returns an error, THEN THE Alarm_Tab SHALL display an error message "Failed to load recent alarms." and SHALL NOT render the recent alarms table (the existing AlarmList above SHALL remain visible).

---

### Requirement 6: Alarm Tab — Edit Alarm Record

**User Story:** As an admin user, I want to edit a recent alarm record so that I can correct its details.

#### Acceptance Criteria

1. THE Alarm_Tab SHALL render an Edit button for each row in the recent alarms table.
2. WHEN the Edit button for a row is clicked, THE Alarm_Tab SHALL open an EditModal pre-populated with that row's current values for: Alarm Region (dropdown of available regions), Location, Reason, Cause; the Detected By field SHALL be pre-populated but read-only, reflecting the original submitter.
3. WHERE the Reason field value changes in the EditModal, THE Alarm_Tab SHALL reset the Cause field options to match the `CAUSE_OPTIONS[newReason]` mapping, clearing any previously selected Cause value.
4. WHEN the user clicks Save in the EditModal with Location, Reason, and Cause all non-empty, THE Alarm_Tab SHALL issue a Supabase `update` on `alarm_records` for the record's `id` with the new values for `alarm_region`, `location`, `reason`, and `cause`.
5. WHEN the update succeeds, THE Alarm_Tab SHALL close the EditModal and re-fetch recent alarm records from `alarm_records` to refresh the table.
6. IF the update fails, THEN THE Alarm_Tab SHALL display an error toast notification and keep the EditModal open with the user's unsaved changes intact.
7. IF the user clicks Save with Location, Reason, or Cause empty, THEN THE Alarm_Tab SHALL display a field-level validation error for each empty required field and SHALL NOT submit the update.

---

### Requirement 7: Alarm Tab — Delete Alarm Record

**User Story:** As an admin user, I want to delete a recent alarm record with a confirmation prompt so that I can remove incorrect entries.

#### Acceptance Criteria

1. THE Alarm_Tab SHALL render a Delete button for each row in the recent alarms table.
2. WHEN the Delete button for a row is clicked, THE Alarm_Tab SHALL open a ConfirmDialog with `isDestructive={true}`, `title="Delete Alarm Record"`, and `message="Are you sure you want to delete this alarm record? This action cannot be undone."`.
3. WHEN the user clicks Confirm in the ConfirmDialog, THE Alarm_Tab SHALL issue a Supabase `delete` on `alarm_records` filtered by the `id` of the record associated with the clicked Delete button.
4. WHEN the deletion succeeds, THE Alarm_Tab SHALL close the ConfirmDialog and re-fetch recent alarm records from `alarm_records` to refresh the table.
5. IF the deletion fails, THEN THE Alarm_Tab SHALL display an error toast notification indicating the deletion failed.
6. WHEN the user clicks Cancel in the ConfirmDialog, THE Alarm_Tab SHALL close the dialog and take no further action.
7. WHILE a deletion is in progress (after Confirm is clicked and before the Supabase response is received), THE Alarm_Tab SHALL disable the Confirm button in the ConfirmDialog to prevent duplicate submissions.

---

### Requirement 8: Data Quality Tab — Preserve Existing Behaviour

**User Story:** As an admin user, I want the Data Quality tab to work exactly as it does today so that no existing DQP functionality is broken by the redesign.

#### Acceptance Criteria

1. WHEN the Data Quality tab is the ActiveTab, THE `SensorDetail` component SHALL render the `QualityTable` component with `data` set to the `dqpList` state array and `onUpdate` set to the `handleStatusRequest` callback, producing the same grouped parameter rows, status checkboxes, notes column, and image-preview behaviour as before the redesign.
2. WHEN a user selects a status of `'Sub-Optimal'` or `'Critical'` on any `QualityTable` row, THE `SensorDetail` component SHALL open the `ActionRequiredModal` with `item` set to the affected parameter object, `targetStatus` set to the selected status value, and `alarmRegions` set to the `sharedRegions` array; AND WHEN a user selects `'Optimal'` on a row whose `parameter.id` is `20` or `21` and `improvement_status` records with `'Awaiting Feedback'` exist for the associated alarm regions, THE `SensorDetail` component SHALL open the `FeedbackModal` with `data` set to those pending records and `regions` set to the `sharedRegions` array.
3. WHEN `SensorDetail` mounts, THE `SensorDetail` component SHALL call `fetchParameters` to completion before invoking `fetchDataQuality`, so that `parameterMap` is populated prior to merging parameter definitions into `dqpList`; IF `sensor.dqp_record_id` is null or undefined, THEN THE `SensorDetail` component SHALL skip the `fetchDataQuality` call and render `QualityTable` with an empty array, displaying no rows.

---

### Requirement 9: Deformation Tab — Edit Record

**User Story:** As an admin user, I want to edit the details of an existing deformation record so that I can correct errors or update information.

#### Acceptance Criteria

1. THE Deformation_Tab SHALL render an Edit button for each deformation card in the list.
2. WHEN the Edit button for a card is clicked, THE Deformation_Tab SHALL open an EditModal pre-populated with that record's current values for: `def_type`, `location`, `start`, `notes`, `detected_by`, `crosschecked_by`, `notification_time`, `site_engineer`, and the type-dependent dynamic fields from `properties` as defined by the `TYPE_MATRIX` config for the record's `def_type`; the `tarp_level` field SHALL be displayed as read-only and derived from `def_type`.
3. WHEN the user clicks Save in the EditModal with all required fields non-empty, THE Deformation_Tab SHALL issue a Supabase `update` on `def_records` for the record's `id` with the new field values.
4. WHEN the update succeeds, THE Deformation_Tab SHALL close the EditModal and re-fetch deformation records from `def_records` for the wall-folder to refresh the list.
5. IF the update fails, THEN THE Deformation_Tab SHALL display an error toast notification indicating the failure reason and keep the EditModal open with the user's unsaved changes intact.
6. IF the user clicks Save with any required field empty, THEN THE Deformation_Tab SHALL display a field-level validation error for each empty required field and SHALL NOT submit the update.

---

### Requirement 10: Deformation Tab — Hard Delete Record

**User Story:** As an admin user, I want to permanently delete a deformation record with a confirmation prompt so that I can remove records that were entered in error.

#### Acceptance Criteria

1. THE Deformation_Tab SHALL render a Hard Delete button (visually distinct from the existing archive/Trash2 button, e.g. labelled "Delete" with a red icon) for each deformation card in the list.
2. WHEN the Hard Delete button for a card is clicked, THE Deformation_Tab SHALL open a ConfirmDialog with `isDestructive={true}`, `title="Permanently Delete Record"`, and `message="Are you sure you want to permanently delete this deformation record? This action cannot be undone."`.
3. WHEN the user clicks Confirm in the ConfirmDialog, THE Deformation_Tab SHALL issue a Supabase `delete` on `def_records` filtered by the `id` of the record associated with the clicked Hard Delete button (hard delete — no `isactive` update).
4. WHEN the deletion succeeds, THE Deformation_Tab SHALL close the ConfirmDialog and re-fetch deformation records from `def_records` for the wall-folder to refresh the list.
5. IF the deletion fails, THEN THE Deformation_Tab SHALL display an error toast notification and keep the ConfirmDialog open.
6. WHEN the user clicks Cancel in the ConfirmDialog, THE Deformation_Tab SHALL close the dialog and take no further action.

---

### Requirement 11: Deformation Tab — Update (Archive + Precursors Chain)

**User Story:** As an admin user, I want to "update" a deformation record by archiving the current one and creating a new one that references it as a precursors, so that the full deformation progression history is preserved.

#### Acceptance Criteria

1. THE Deformation_Tab SHALL render an Update button for each deformation card in the list.
2. WHEN the Update button for a card is clicked, THE Deformation_Tab SHALL open a ConfirmDialog with `title="Update Deformation Record"` and `message="This will archive the current record and create a new deformation record with this record set as its precursors. Do you want to continue?"`.
3. WHEN the user clicks Confirm in the ConfirmDialog, THE Deformation_Tab SHALL close the ConfirmDialog and open the existing `AddDeformationForm` pre-filled with the current record's `wallfolder_id`, `location`, and the alarm region IDs linked to the current record; the current record's `id` SHALL be stored as the pending `precursors` value and SHALL NOT be visible or editable in the form.
4. WHEN the user cancels out of the `AddDeformationForm` (clicks Back or Close) before submitting, THE Deformation_Tab SHALL discard the pending `precursors` value and return to the deformation list without modifying any records.
5. WHEN the user submits the `AddDeformationForm`, THE Deformation_Tab SHALL first issue a Supabase `update` on `def_records` setting `isactive = 'No'` for the original record's `id` (archive step); IF this archive step fails, THEN THE Deformation_Tab SHALL display an error toast and abort without inserting the new record.
6. WHEN the archive step succeeds, THE Deformation_Tab SHALL issue a Supabase `insert` into `def_records` with the new form values and `precursors` set to the archived record's `id`.
7. WHEN both operations succeed, THE Deformation_Tab SHALL re-fetch deformation records from `def_records` for the wall-folder and display a success toast.
8. IF the insert step fails after the archive step has already succeeded, THEN THE Deformation_Tab SHALL display an error toast indicating a partial failure and SHALL issue a compensating Supabase `update` to restore `isactive = 'Yes'` on the original record.

---

### Requirement 12: Deformation Tab — Event Timeline

**User Story:** As an admin user, I want to see the full deformation/event progression timeline when I expand the latest deformation card, so that I can understand how the situation evolved over time.

#### Acceptance Criteria

1. THE Deformation_Tab SHALL identify the "latest" deformation card as the record with the highest (most recent) `created_at` value among all active records in the current `deformationList`.
2. WHEN the latest deformation card is expanded (clicked or toggled open), THE Deformation_Tab SHALL fetch the full precursors chain by iteratively querying `def_records` by `id` starting from the latest record's `precursors` value, continuing until a fetched record has `precursors = null`; the maximum chain depth SHALL be capped at 50 nodes to prevent infinite loops.
3. THE Deformation_Tab SHALL render the precursors chain as a vertical timeline inside the expanded card, ordered from the earliest record (root, `precursors = null`) at the top to the latest (current) record at the bottom, with a connecting line between nodes.
4. EACH timeline node SHALL display: `def_type`, `tarp_level` (as a coloured badge using `getStatusDotColors`), `location`, `created_at` formatted via `fromUTC(value, timezone)`, and `detected_by` resolved to `full_name` from the crosscheckers list (falling back to the raw UUID if not found).
5. THE timeline SHALL visually distinguish the current (latest) record node from archived precursors nodes using a filled/highlighted style (e.g. brand-orange border or "Current" badge) versus a muted style for archived nodes.
6. WHEN the latest card is collapsed, THE Deformation_Tab SHALL hide the timeline and release the fetched chain data from local state.
7. IF the latest record has `precursors = null`, THE Deformation_Tab SHALL render the timeline with only the single current record node and SHALL NOT issue any additional fetch requests.
8. IF any fetch in the precursors chain resolution fails, THE Deformation_Tab SHALL stop chain resolution at that point, display the nodes fetched so far, and show an inline warning "Timeline may be incomplete."

---

### Requirement 13: Shared ConfirmDialog Component

**User Story:** As a developer, I want a reusable ConfirmDialog component so that all confirmation prompts across tabs are consistent and maintainable.

#### Acceptance Criteria

1. THE ConfirmDialog SHALL accept props: `isOpen` (boolean), `title` (string), `message` (string), `onConfirm` (function), `onCancel` (function), `isDestructive` (boolean, default `false`), and optionally `confirmLabel` (string, default `"Confirm"`) and `cancelLabel` (string, default `"Cancel"`).
2. WHEN `isOpen` is `true`, THE ConfirmDialog SHALL render as a modal overlay with a semi-transparent backdrop that blocks pointer interaction with all content behind it.
3. WHEN the Confirm button is clicked, THE ConfirmDialog SHALL call `onConfirm` and SHALL NOT close itself — closing is the responsibility of the parent via the `isOpen` prop.
4. WHEN the Cancel button is clicked, the Escape key is pressed, or the backdrop overlay is clicked, THE ConfirmDialog SHALL call `onCancel` and SHALL NOT close itself.
5. IF `isDestructive` is `true`, THEN THE ConfirmDialog SHALL render the Confirm button with a red background (`bg-red-600` or equivalent) and white text; IF `isDestructive` is `false`, THEN THE ConfirmDialog SHALL render the Confirm button with the project's brand colour (`var(--dtg-brand-orange)` or `variant="brand"`).

---

### Requirement 14: Data Refresh on Tab Switch

**User Story:** As an admin user, I want each tab to show up-to-date data when I switch to it so that I am not looking at stale information.

#### Acceptance Criteria

1. WHEN the ActiveTab changes to `downtime`, THE Downtime_Tab SHALL issue a new Supabase query to `downtime_records` filtered by `wallfolder = sensor.wallfolder_id`, replacing any previously cached result.
2. WHEN the ActiveTab changes to `alarm`, THE Alarm_Tab SHALL issue a new Supabase query to `alarm_records` for the last 24 hours filtered by the wall-folder's alarm regions, replacing any previously cached result.
3. WHEN the ActiveTab changes to `deformation`, THE Deformation_Tab SHALL issue a new Supabase query to `def_records` filtered by `wallfolder_id = sensor.wallfolder_id` and `isactive = 'Yes'`, replacing any previously cached result.
4. WHEN the ActiveTab changes to `dqp`, THE DQP_Tab SHALL call `fetchDataQuality` only if `sensor.dqp_record_id` is non-null; IF `sensor.dqp_record_id` is null, THEN THE DQP_Tab SHALL skip the fetch and render `QualityTable` with an empty array.
5. IF any tab's re-fetch on switch returns an error, THEN that tab SHALL display its respective error message as defined in Requirements 2, 5, and the DQP tab SHALL log the error to the console without disrupting the UI.
