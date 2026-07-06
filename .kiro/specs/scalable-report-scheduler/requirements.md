# Requirements Document

## Introduction

The Scalable Report Reminder Scheduler redesigns the existing single-site, localStorage-based report reminder system into a multi-site, multi-sensor-type scheduler that persists its configuration in Supabase. Admins can define independent deadline and reminder windows for each site. Sensors of any type (radar, VWP, PRISM, InSAR, etc.) are all eligible for report-status tracking. The blocking popup reminder behaviour is preserved; acknowledgements continue to be stored client-side (per-day) to avoid unnecessary DB writes.

---

## Glossary

- **Scheduler**: The feature described in this document that manages report-deadline schedules and fires reminders.
- **Site**: A named monitoring location that owns one or more Sensors and has exactly one Schedule.
- **Sensor**: An individual monitoring instrument (of any type: radar, VWP, PRISM, InSAR, Rainfall, etc.) that belongs to a Site and is expected to produce a daily Report.
- **Schedule**: A record in Supabase that stores the deadline time, reminder time, and enabled flag for a single Site.
- **Report**: A row in the existing `reports` table (`filename`, `client_id`, `created_at`) that constitutes evidence a Sensor's daily output has been uploaded.
- **Reminder**: A blocking popup shown to the admin when a Site's reminder time has passed and at least one Sensor belonging to that Site has not yet had a Report uploaded today.
- **Acknowledgement**: A client-side, per-day record that suppresses the Reminder popup for a given Site for the remainder of the current local day.
- **Admin**: A logged-in user with access to the admin dashboard.
- **SiteSchedule_Table**: The new Supabase table `site_report_schedules` that persists schedule configuration.
- **Sensor_Registry**: The existing Supabase view/table `latest_radar_wall_folders` used to discover live Sensors.

---

## Requirements

### Requirement 1: Supabase-Backed Schedule Persistence

**User Story:** As an Admin, I want schedule configuration to be stored in Supabase, so that my settings persist across devices and browser sessions.

#### Acceptance Criteria

1. THE Scheduler SHALL store all Site schedule configurations in the `site_report_schedules` Supabase table (SiteSchedule_Table) instead of localStorage.
2. THE SiteSchedule_Table SHALL contain at minimum the columns: `site_id` (text, primary key), `site_name` (text), `deadline` (text, "HH:MM" 24-hour), `reminder` (text, "HH:MM" 24-hour), `enabled` (boolean), `updated_at` (timestamptz).
3. WHEN an Admin saves a Schedule change, THE Scheduler SHALL upsert the corresponding row in SiteSchedule_Table within 2 seconds.
4. WHEN an Admin loads the admin dashboard on any device, THE Scheduler SHALL display schedule values read from SiteSchedule_Table.
5. IF a Site has no row in SiteSchedule_Table, THEN THE Scheduler SHALL apply a default Schedule of deadline `06:00`, reminder `05:30`, and `enabled = true` for that Site.

---

### Requirement 2: Multi-Site Schedule Support

**User Story:** As an Admin, I want each Site to have its own independent deadline and reminder time, so that sites with different operational hours are handled correctly.

#### Acceptance Criteria

1. THE Scheduler SHALL maintain a separate Schedule for each Site discovered in the Sensor_Registry.
2. WHEN an Admin edits the deadline for Site A, THE Scheduler SHALL leave the Schedules of all other Sites unchanged.
3. THE Scheduler SHALL display all Sites with live Sensors in the Scheduled Reports list, regardless of how many Sites exist.
4. WHEN a new Site appears in the Sensor_Registry and has no row in SiteSchedule_Table, THE Scheduler SHALL apply the default Schedule (deadline `06:00`, reminder `05:30`, enabled `true`) for that Site on first display.

---

### Requirement 3: Multi-Sensor-Type Support

**User Story:** As an Admin, I want sensors of all types (not just radars) to be tracked for report status, so that the reminder system is accurate for mixed-instrument sites.

#### Acceptance Criteria

1. THE Scheduler SHALL treat every row in the Sensor_Registry as a Sensor regardless of its instrument type (e.g., radar, VWP, PRISM, InSAR, Rainfall).
2. THE Scheduler SHALL determine a Sensor's report status by searching today's Reports for a filename that contains the Sensor's identifier (case-insensitive).
3. WHEN all Sensors at a Site have a matching Report uploaded today, THE Scheduler SHALL mark that Site's `generatedToday` flag as `true`.
4. WHEN one or more Sensors at a Site are missing a Report today, THE Scheduler SHALL list those Sensors as `pendingSensors` for that Site.

---

### Requirement 4: Schedule Editing UI

**User Story:** As an Admin, I want an in-dashboard UI to view and edit each Site's deadline, reminder time, and enabled flag, so that I can adjust schedules without touching the database directly.

#### Acceptance Criteria

1. THE Scheduler SHALL display a "Manage Schedule" toggle on the Scheduled Reports panel.
2. WHEN the "Manage Schedule" toggle is active, THE Scheduler SHALL render editable `deadline`, `reminder`, and `enabled` fields for each Site row.
3. WHEN an Admin changes the `deadline` field and the existing `reminder` was the default offset (30 minutes before the previous deadline), THE Scheduler SHALL automatically update the `reminder` to 30 minutes before the new deadline.
4. WHEN an Admin explicitly sets a custom `reminder` time, THE Scheduler SHALL preserve that custom value when the `deadline` is subsequently changed.
5. WHILE a schedule save is in progress, THE Scheduler SHALL show a loading indicator on the affected Site row.
6. IF a schedule save to Supabase fails, THEN THE Scheduler SHALL display an error message on the affected Site row and revert the optimistic local change.

---

### Requirement 5: Reminder Popup Behaviour

**User Story:** As an Admin, I want a blocking popup to appear when a Site's reminder time has passed and its report is still missing, so that I am prompted to generate the overdue report.

#### Acceptance Criteria

1. WHEN the current local time is at or past a Site's `reminder` time AND that Site has one or more `pendingSensors` AND the Site's Schedule is `enabled`, THE Scheduler SHALL display the Reminder popup for that Site.
2. THE Reminder popup SHALL list every pending Sensor identifier for each overdue Site.
3. WHEN the Reminder popup is displayed, THE Scheduler SHALL block interaction with the rest of the admin dashboard until the Admin acknowledges at least one Site.
4. WHEN an Admin clicks "Acknowledge" for a Site in the Reminder popup, THE Scheduler SHALL record an Acknowledgement for that Site for the current local day and remove that Site from the popup.
5. WHEN all overdue Sites have been acknowledged, THE Scheduler SHALL close the Reminder popup.
6. WHEN the current local day changes (midnight rollover), THE Scheduler SHALL clear all Acknowledgements so each Site can trigger a new Reminder the following day.
7. THE Scheduler SHALL re-evaluate reminder conditions every 30 seconds.
8. THE Scheduler SHALL re-fetch live report status from Supabase every 5 minutes.

---

### Requirement 6: Acknowledgement Storage

**User Story:** As an Admin, I want acknowledgements to persist only for the current day and only on my device, so that the reminder resets automatically each day without requiring a database write.

#### Acceptance Criteria

1. THE Scheduler SHALL store Acknowledgements in localStorage keyed by Site ID and local date string (`YYYY-MM-DD`).
2. WHEN the Scheduler evaluates whether to show a Reminder, THE Scheduler SHALL suppress the Reminder for any Site whose Acknowledgement matches today's local date.
3. WHEN the local date advances past an Acknowledgement's date, THE Scheduler SHALL treat that Acknowledgement as expired and allow a new Reminder for that Site.

---

### Requirement 7: SQL Schema for New Supabase Table

**User Story:** As an Admin, I want the exact SQL to create the required Supabase table, so that I can run it once and have the feature work immediately.

#### Acceptance Criteria

1. THE Scheduler SHALL require a single new table (`site_report_schedules`) with the following SQL:

```sql
CREATE TABLE IF NOT EXISTS site_report_schedules (
  site_id     text        PRIMARY KEY,
  deadline    text        NOT NULL DEFAULT '06:00',
  reminder    text        NOT NULL DEFAULT '05:30',
  enabled     boolean     NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE site_report_schedules ENABLE ROW LEVEL SECURITY;

-- Allow authenticated admins to read and write schedules
CREATE POLICY "Admins can manage schedules"
  ON site_report_schedules
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
```

2. WHEN the Scheduler upserts a Schedule, THE Scheduler SHALL set `updated_at` to the current UTC timestamp.

---

### Requirement 8: Sensor Discovery

**User Story:** As an Admin, I want the Scheduler to automatically discover all Sites and Sensors from Supabase, so that new sensors added to the registry appear in the schedule list without manual configuration.

#### Acceptance Criteria

1. THE Scheduler SHALL query the Sensor_Registry (`latest_radar_wall_folders`) excluding rows where `type = 'Archive'` to build the list of active Sites and their Sensors.
2. THE Scheduler SHALL deduplicate Sensor identifiers within a Site so each Sensor appears only once per Site.
3. WHEN the Scheduler loads, THE Scheduler SHALL merge the discovered Sites with their corresponding Schedules from SiteSchedule_Table (applying the default Schedule for Sites with no stored row).
4. THE Scheduler SHALL sort Sites alphabetically by `site_name` in all UI representations.

---

### Requirement 9: Backward Compatibility Migration

**User Story:** As an Admin, I want any previously configured schedules stored in localStorage to be migrated to Supabase on first load, so that I do not lose my existing settings when upgrading.

#### Acceptance Criteria

1. WHEN the Scheduler initialises and detects a `reportSchedules` key in localStorage, THE Scheduler SHALL read those entries and upsert them into SiteSchedule_Table for any Site that does not yet have a Supabase row.
2. WHEN the migration is complete, THE Scheduler SHALL remove the `reportSchedules` key from localStorage.
3. IF the migration upsert to Supabase fails, THEN THE Scheduler SHALL retain the localStorage data and log the error to the browser console without blocking the UI.
