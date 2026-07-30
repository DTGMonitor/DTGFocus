-- 001_alarm_improvement_site_action_backfill.sql
--
-- Data repair, not schema.
--
-- `alarm_improvement` records two instants: `recommendation_submission` (when
-- DTG raised the recommendation) and `site_action` (when the site resolved it).
-- The in-app path — FeedbackModal → SensorDetail.handleFeedbackSubmit — stamps
-- `site_action` for BOTH resolutions ('Modified' and 'Not Implemented'), so a
-- row resolved through the UI always carries one.
--
-- Twelve rows predate that path (set directly in the database during the early
-- Jan/Jun 2026 backlog clean-ups) and were left with `site_action IS NULL`
-- despite carrying a terminal status. They are invisible to any date filter
-- that asks "was this resolved inside the reporting window?", which is exactly
-- what the Comprehensive report's Alarm Improvement section asks — so a
-- 'Not Implemented' item would silently never appear as resolved in any report.
--
-- The submission instant is the only date of record for those rows, so it is
-- what they are stamped with. This is an ACKNOWLEDGED approximation: the true
-- resolution date was never captured. It cannot back-date a row into a window
-- it does not already belong to, since `recommendation_submission` is the
-- other half of the same window test — the row's report placement is
-- unchanged; only its "resolved" attribution is repaired.
--
-- 'Awaiting Feedback' rows are deliberately untouched: a null `site_action`
-- there is correct — the site genuinely has not acted.
--
-- Rows affected (captured before the run, for the revert below):
--   Not Implemented: 525, 527, 531, 551, 552, 553, 729, 730, 731
--   Modified:        558, 559, 560

begin;

update alarm_improvement
   set site_action = recommendation_submission
 where site_action is null
   and improvement_status is distinct from 'Awaiting Feedback'
   and recommendation_submission is not null;

commit;

-- Revert:
--
--   update alarm_improvement
--      set site_action = null
--    where id in (525, 527, 531, 551, 552, 553, 558, 559, 560, 729, 730, 731);
