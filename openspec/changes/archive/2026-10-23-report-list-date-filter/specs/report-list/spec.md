## ADDED Requirements

### Requirement: Report list is filtered by a creation-date range
The report list SHALL fetch only reports whose `created_at` falls within the selected range, where the range is a pair of local calendar days `from` and `to`, both inclusive. The bounds SHALL be applied in the database query, not to rows already loaded. The same range SHALL apply to every report type.

#### Scenario: Reports inside the range are shown
- **WHEN** the selected range is 1 Mar 2026 – 31 Mar 2026
- **THEN** a report created at 31 Mar 2026 22:00 local is listed
- **AND** a report created at 1 Apr 2026 00:00 local is not listed
- **AND** a report created at 28 Feb 2026 23:59 local is not listed

#### Scenario: One range for all types
- **WHEN** the selected range is Last 30 days and the type dropdown is set to Radar, then to InSAR
- **THEN** both selections show only reports created in the last 30 days

### Requirement: Range presets
The range selector SHALL offer the presets Last 7 days, Last 30 days, Last 3 months, Last 6 months, and a Custom option. Each preset SHALL end today. Last 7 days and Last 30 days SHALL start 6 and 29 days before today respectively; Last 3 months and Last 6 months SHALL start on the same calendar day 3 or 6 months before today, clamped to the end of that month.

#### Scenario: Last 7 days
- **WHEN** today is 23 Oct 2026 and the user selects Last 7 days
- **THEN** the range is 17 Oct 2026 – 23 Oct 2026

#### Scenario: Month preset clamps to month end
- **WHEN** today is 31 Aug 2026 and the user selects Last 6 months
- **THEN** the range is 28 Feb 2026 – 31 Aug 2026

### Requirement: Default range
The report list SHALL use Last 7 days when no valid range is supplied by the URL.

#### Scenario: First visit
- **WHEN** a user opens the admin Report Management board or a client Reports tab with no range in the URL
- **THEN** the list shows reports from the last 7 days for every type

### Requirement: Custom range with a 6-month cap
Selecting Custom SHALL let the user pick a `from` and `to` day and apply them. A custom range SHALL be accepted only if both days are set, `from` is not after `to`, and `from` is not earlier than `to` minus 6 calendar months (clamped to the end of that month, as for the presets). A `to` day after today SHALL be treated as today. An unacceptable range SHALL NOT be queried; the user SHALL see an inline message stating why, and the previously applied range SHALL stay in effect. A custom range MAY lie anywhere in the past.

#### Scenario: Old range within the cap
- **WHEN** the user applies a custom range of 1 Jan 2025 – 30 Jun 2025
- **THEN** the list shows reports created in that range

#### Scenario: Range longer than 6 months
- **WHEN** the user enters a custom range of 1 Jan 2025 – 15 Jul 2025
- **THEN** the range cannot be applied, a message says the range may be at most 6 months
- **AND** the list keeps showing the previously applied range

#### Scenario: Reversed range
- **WHEN** the user enters `from` 10 Mar 2026 and `to` 1 Mar 2026
- **THEN** the range cannot be applied and a message says the start must not be after the end

#### Scenario: Future end day
- **WHEN** today is 23 Oct 2026 and the user applies 1 Oct 2026 – 30 Oct 2026
- **THEN** the applied range is 1 Oct 2026 – 23 Oct 2026

### Requirement: Range is kept in the URL
The applied range SHALL be written to the page URL query string as `range=7d|30d|3m|6m`, or `range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD`, without adding browser history entries and without removing other query parameters. On load, a valid range in the URL SHALL be applied; a missing, unknown, malformed, or invalid one (including a custom range longer than 6 months) SHALL fall back to Last 7 days.

#### Scenario: Reload keeps the range
- **WHEN** the user applies Last 3 months and reloads the page
- **THEN** the list loads with Last 3 months applied

#### Scenario: Invalid URL range
- **WHEN** the page is opened with `?range=custom&from=2025-01-01&to=2025-12-31`
- **THEN** the list loads with Last 7 days applied

### Requirement: Header shows the active range and count
The list header SHALL show the applied range as dates and the number of reports currently displayed after search and type filtering.

#### Scenario: Header summary
- **WHEN** the applied range is 17 Oct 2026 – 23 Oct 2026 and 43 reports match the search and type filters
- **THEN** the header reads with that date range and "43 results"

### Requirement: Filter controls remain available
The search box, type dropdown (where shown), and range selector SHALL remain visible and usable while reports are loading and when the applied range and filters match no reports. When nothing matches, the list body SHALL show a message that no reports were found in this range.

#### Scenario: Empty range
- **WHEN** the user applies a range with no reports
- **THEN** a "no reports in this range" message is shown below the filter bar
- **AND** the user can select another range without reloading the page

#### Scenario: Loading
- **WHEN** a new range is being fetched
- **THEN** a loading indicator is shown in the list body and the filter bar stays visible

#### Scenario: Stale responses are ignored
- **WHEN** the user applies range A and then range B before A's results arrive
- **THEN** only range B's results are shown

### Requirement: Site and type scoping
Users who are not admins SHALL see only reports stored under their own site (`filename` starting with `{siteId}/`). When the list is pinned to a report type (client Radar and InSAR tabs), it SHALL show only that type and SHALL NOT show the type dropdown. When not pinned (admin board), the type dropdown SHALL offer All Types, Radar, InSAR, Prism and VWP.

#### Scenario: Client InSAR tab
- **WHEN** a client user opens the InSAR Reports tab
- **THEN** only InSAR reports of that user's site within the applied range are listed and no type dropdown is shown

#### Scenario: Admin board
- **WHEN** an admin opens the Report Management board
- **THEN** reports of every site within the applied range are listed and the type dropdown is shown

### Requirement: Total Reports stat is labelled correctly
The "Total Reports" stat card on the admin Report Management board SHALL be labelled "All time", matching its unbounded count.

#### Scenario: Stat card label
- **WHEN** an admin opens the Report Management board
- **THEN** the Total Reports card subtitle reads "All time"
