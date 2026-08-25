-- Cohort-aware Builders live session.
--
-- Until now ONE env var (`BUILDERS_SESSION_EVENT_ID`) named the single master
-- recurring Google Calendar event that every paid Builders member was invited
-- to. That made it impossible to run two cohorts concurrently (e.g. an English
-- and an Arabic session) against two different Google Meet events.
--
-- `session_event_id` is that same kind of id, scoped to a cohort. It is
-- NULLABLE ON PURPOSE and no backfill is performed: null means "this cohort has
-- no dedicated event, use BUILDERS_SESSION_EVENT_ID". An existing single-cohort
-- deployment therefore keeps working, unchanged, with zero rows populated.
--
-- No index: the column is never a lookup predicate. Resolution walks
-- member_group_assignments by user_id (already indexed) and reads the joined
-- group's column; the "all configured cohort events" query is a full scan of a
-- table that holds a handful of rows.

-- AlterTable
ALTER TABLE "member_groups" ADD COLUMN "session_event_id" TEXT;
