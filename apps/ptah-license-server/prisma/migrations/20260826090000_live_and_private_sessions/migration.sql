-- TASK_2026_177 — migration 4 of 5, Phase 4: live sessions and private sessions.
-- Plan §1.8 row 4. Forward-only and sequential: this follows
-- `20260819090000_courses` (migration 3) and nothing sorts between them.
--
-- Hand-authored. `prisma migrate dev` was NOT run in this workspace (V-MIG is
-- SUPERSEDED for this task). The DDL below was generated with
--
--     npx prisma migrate diff --from-config-datasource \
--       --to-schema prisma/schema.prisma --script
--
-- and then REVIEWED, which is not a formality — see the banner immediately
-- below. Applied with `npx prisma migrate deploy`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 🔴 THREE `DROP INDEX` STATEMENTS WERE REMOVED FROM THE GENERATED OUTPUT.
--
-- `prisma migrate diff` emitted, unprompted:
--
--     DROP INDEX "community_posts_body_trgm";
--     DROP INDEX "community_topics_title_trgm";
--     DROP INDEX "course_lessons_title_trgm";
--
-- Those are the three hand-written `USING gin (… gin_trgm_ops)` indexes that
-- migrations 2 and 3 created and that A-7 / plan §1.8 exist to protect. Prisma
-- CANNOT EXPRESS `gin_trgm_ops` in a model, so it does not see them in
-- `schema.prisma`, concludes they are drift, and proposes deleting them — on
-- EVERY subsequent `migrate diff`, for ever. Saving the generated script
-- verbatim would have silently removed member search from the forum and the
-- curriculum in a migration whose subject is live sessions.
--
-- This is exactly the review plan §1.8 mandates: *"`prisma migrate diff` output
-- is reviewed before every subsequent migration lands."* MIGRATION 5 (Batch 14)
-- MUST DO THE SAME CHECK. The tell is a `DROP INDEX` on a name ending `_trgm`
-- that no task asked for.
--
-- The FOURTH generated drop — `session_requests_status_idx` — IS intentional
-- and is kept: it is replaced two statements later by the composite the R4.4
-- queue needs.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SAFETY / NFR-M3. Every column added here is NULLABLE or carries a DEFAULT, so
-- this migration applies to a populated `session_requests` without a backfill
-- and without a table rewrite, and is independently deployable. Production runs
-- `npx prisma migrate deploy && node main.cjs`, so schema and code land
-- together or the deploy fails.

-- DropIndex
-- Replaced by `session_requests_status_created_at_idx` below. R4.4's admin
-- queue is `where status = 'pending' order by created_at asc`; the
-- single-column index served the filter and left the sort to a heap sort over
-- every pending row.
DROP INDEX "session_requests_status_idx";

-- AlterTable
-- Batch 9B's F-1, closed. `Course`, `CourseModule` and `Lesson` carried
-- `deleted_at` and no `deleted_by`, so `CoursesService`'s three soft deletes
-- DEMANDED a real actor id and had nowhere to write it — "who deleted this" was
-- answerable only from the audit row. `Topic`, `Post` and `LessonComment`
-- already had the column; these three now match.
ALTER TABLE "courses" ADD COLUMN     "deleted_by" TEXT;

-- AlterTable
ALTER TABLE "course_modules" ADD COLUMN     "deleted_by" TEXT;

-- AlterTable
ALTER TABLE "course_lessons" ADD COLUMN     "deleted_by" TEXT;

-- AlterTable
-- OQ-1 / AD-2, option (a): four nullable columns on the existing row rather
-- than a `ScheduledSession` child table. R4.10 is preserved by construction —
-- `is_free_session`, `payment_status` and `paddle_transaction_id` are untouched
-- and nothing in the Phase-4 scheduling path writes them.
ALTER TABLE "session_requests" ADD COLUMN     "calendar_event_id" TEXT,
ADD COLUMN     "decline_reason" TEXT,
ADD COLUMN     "duration_minutes" INTEGER,
ADD COLUMN     "meet_link" TEXT;

-- CreateTable
-- R3 + OQ-3/AD-3. Both linkages (`youtube_video_id`, `calendar_event_id`) are
-- optional: a Ptah-scheduled stream has the first and not the second; a Google
-- Calendar cohort session that later gains a replay has the second and a
-- `replay_youtube_video_id`.
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "visibility" TEXT NOT NULL DEFAULT 'member',
    "cohort_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "youtube_video_id" TEXT,
    "replay_youtube_video_id" TEXT,
    "video_title" TEXT,
    "video_duration_seconds" INTEGER,
    "video_thumbnail_url" TEXT,
    "video_metadata_fetched_at" TIMESTAMP(3),
    "video_metadata_source" TEXT,
    "calendar_event_id" TEXT,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- AD-3. Makes "two live sessions claiming one Calendar event" unrepresentable.
-- Postgres treats multiple NULLs as distinct, so unclaimed sessions are
-- unconstrained.
CREATE UNIQUE INDEX "live_sessions_calendar_event_id_key" ON "live_sessions"("calendar_event_id");

-- CreateIndex
-- Serves the upcoming / live / replay split AND the hub's "next session".
CREATE INDEX "live_sessions_starts_at_idx" ON "live_sessions"("starts_at");

-- CreateIndex
-- 🔴 THE LOAD-BEARING CONSTRAINT OF AD-2. It makes "two requests reconciled to
-- one Calendar event" — the state R4.6 calls a defect — unrepresentable rather
-- than merely unlikely. Pending requests hold NULL and are unconstrained.
CREATE UNIQUE INDEX "session_requests_calendar_event_id_key" ON "session_requests"("calendar_event_id");

-- CreateIndex
-- Replaces the dropped single-column index: serves R4.4's filter AND its
-- oldest-first ordering in one seek.
CREATE INDEX "session_requests_status_created_at_idx" ON "session_requests"("status", "created_at");
