# DQP alarm recommendations are raised against a region, not against an alarm

## The problem

Moving a DQP alarm row (parameter 20 "Alarm Configuration", 21 "Alarm Mask") to
a non-optimal status raises a recommendation in `alarm_improvement`.

Until now the modal would only let that happen if an alarm had already fired:
it queried `alarm_records` for the last 12 hours, offered the region+cause pairs
it found, and wrote each improvement row pinned to one `alarm_records.id`. With
nothing in the window, the form blocked submission and told the analyst to log
the alarm in the Alarm tab first.

That is the wrong order of work. An alarm configuration problem is usually
noticed *before* it produces an alarm — a region whose mask is wrong is a region
that has not alarmed and should have. So the gate either stopped the
recommendation being filed at all, or pushed the analyst into logging a
fictitious alarm to get past the form.

## The change

The recommendation is raised against the **region**, which is what it was always
really about.

- The modal offers every alarm region on the wall folder (`sharedRegions`,
  already loaded by SensorDetail on sensor change). No fetch, no time window, no
  dependency on whether an alarm happened to have fired.
- One improvement row per ticked region. Parameter 21 still takes one alarm mask
  per region, since two regions produce two rows and a shared mask would be
  wrong for at least one of them.
- The row is written with `alarm_region` and **no** `alarm_record`.
- The only remaining block is a wall folder with no alarm regions configured at
  all, which is an onboarding gap rather than an analyst mistake.

## Why the schema had to change

`alarm_improvement` has no wall-folder column. Every reader reached one by
joining `alarm_records!inner → alarm_regions`:

| Reader | What it drives |
| --- | --- |
| `SensorDetail.checkAndFetchFeedbackItems` | the "→ Optimal" gate |
| `useOpenImprovements` | the partial-resolution list in two DQP modals |
| `useComprehensiveReportData` | the report's Alarm Improvement section |
| `RadarDetail` | the client-facing outstanding-recommendation banner |

A row written with a null `alarm_record` and nothing else would be invisible to
all four — raised, saved, and never shown to anyone again. So
`migrations/001_alarm_improvement_region.sql` adds
`alarm_improvement.alarm_region` (FK to `alarm_regions.id`), backfills it from
each row's existing alarm record, and indexes it. All four readers now scope on
that column.

`alarm_record` is kept, not dropped: it is the historical record of which alarm
a recommendation answered, the Comprehensive report still prints
`alarm_records.cause` from it where it is present, and the join is simply left
instead of inner so the rows that have one still carry it.

## Deployment order

**The migration must be applied before this code ships.** Until the column
exists, every scoped read returns a PostgREST error and the insert is rejected.
There is no fallback path — a column-not-found is not something the client can
work around, and a silent dual-read would have hidden exactly the kind of
mis-scoping this change is meant to remove.
