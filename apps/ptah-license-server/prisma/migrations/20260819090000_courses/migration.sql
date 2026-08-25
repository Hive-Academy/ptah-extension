-- TASK_2026_177 Phase 3 — migration 3 of 5 (plan §1.8).
--
-- Creates the five course models: courses, course_modules, course_lessons,
-- lesson_progress, lesson_comments. Forward-only and independently deployable
-- (NFR-M3).
--
-- The generated half below was produced with:
--   prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- (Prisma 7.7.0. `--from-url` and `--to-schema-datamodel` were REMOVED in
-- Prisma 7 and do not exist; `--from-config-datasource` reads the live
-- database via prisma.config.ts, so no shadow database is created and nothing
-- is reset.)
--
-- ===========================================================================
-- 🔴 TWO `DROP INDEX` STATEMENTS WERE REMOVED FROM THE GENERATED OUTPUT.
--
-- `prisma migrate diff` emitted these two lines at the top of its script:
--
--     DROP INDEX "community_posts_body_trgm";
--     DROP INDEX "community_topics_title_trgm";
--
-- They are the two GIN trigram indexes created by hand in migration 2
-- (20260812090000_community_forum). They are NOT drift and NOT dead: they are
-- live, correct indexes that `schema.prisma` cannot express, because Prisma
-- has no syntax for `gin_trgm_ops`. `migrate diff` compares the live database
-- against the schema, sees two indexes the schema does not declare, and
-- proposes to delete them. It will propose this again on EVERY subsequent
-- migration in this app.
--
-- Applying them would have silently destroyed community search performance
-- (A-7): search still returns CORRECT results by sequential scan, so nothing
-- would have failed, errored or alerted — it would just have got slower and
-- slower as the forum grew.
--
-- ⚠️ THE SAME TRAP NOW APPLIES TO THIS MIGRATION'S OWN
-- `course_lessons_title_trgm`, added below. Migrations 4 and 5 will each see
-- THREE proposed `DROP INDEX` lines instead of two. READ THE GENERATED SQL OF
-- EVERY SUBSEQUENT MIGRATION IN THIS APP AND STRIP THEM.
-- ===========================================================================

-- CreateTable
CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "cover_image_url" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'member',
    "cohort_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT false,
    "sequential" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_modules" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL,
    "release_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_lessons" (
    "id" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "youtube_video_id" TEXT,
    "video_title" TEXT,
    "video_duration_seconds" INTEGER,
    "video_thumbnail_url" TEXT,
    "video_metadata_fetched_at" TIMESTAMP(3),
    "video_metadata_source" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lesson_progress" (
    "user_id" UUID NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "furthest_position_seconds" INTEGER NOT NULL DEFAULT 0,
    "completed_at" TIMESTAMP(3),
    "completion_source" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_progress_pkey" PRIMARY KEY ("user_id","lesson_id")
);

-- CreateTable
CREATE TABLE "lesson_comments" (
    "id" TEXT NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "body_markdown" TEXT NOT NULL,
    "author_id" UUID,
    "answered_at" TIMESTAMP(3),
    "answered_by" TEXT,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lesson_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courses_slug_key" ON "courses"("slug");

-- CreateIndex
CREATE INDEX "courses_published_sort_order_idx" ON "courses"("published", "sort_order");

-- CreateIndex
CREATE INDEX "course_modules_course_id_sort_order_idx" ON "course_modules"("course_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "course_modules_course_id_slug_key" ON "course_modules"("course_id", "slug");

-- CreateIndex
CREATE INDEX "course_lessons_module_id_sort_order_idx" ON "course_lessons"("module_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "course_lessons_module_id_slug_key" ON "course_lessons"("module_id", "slug");

-- CreateIndex
CREATE INDEX "lesson_comments_lesson_id_created_at_idx" ON "lesson_comments"("lesson_id", "created_at");

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_lessons" ADD CONSTRAINT "course_lessons_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_comments" ADD CONSTRAINT "lesson_comments_lesson_id_fkey" FOREIGN KEY ("lesson_id") REFERENCES "course_lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_comments" ADD CONSTRAINT "lesson_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "lesson_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_comments" ADD CONSTRAINT "lesson_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---
-- HAND-WRITTEN BELOW THIS LINE. Everything above was generated by
-- `prisma migrate diff` (minus the two removed DROP INDEX lines documented in
-- the header). Everything below is authored by hand and Prisma does not know
-- it exists.
--
-- A-7: lesson-title search is `ILIKE`, accelerated by a GIN trigram index.
-- Prisma cannot express `gin_trgm_ops` in a model, so this index is created
-- here and NOWHERE ELSE. The consequences, spelled out because they are not
-- obvious from either file:
--
--   1. This index is INVISIBLE to `schema.prisma`. A reader of the model will
--      not know it exists. The Phase-3 banner above the course models records
--      it for exactly that reason.
--   2. `prisma migrate diff` will NEVER MENTION IT as something to create —
--      and WILL propose to DROP IT, every time, from the next migration
--      onward. See this file's header for the two indexes that already
--      happened to.
--   3. Losing it is a SILENT PERFORMANCE failure, not an error. Lesson search
--      keeps returning correct results by sequential scan. No test fails, no
--      alert fires, and nobody notices until the corpus is large enough for it
--      to matter — at which point the cause is several migrations in the past.
--
-- `pg_trgm` is NOT re-created here. Migration 2 already ran
-- `CREATE EXTENSION IF NOT EXISTS pg_trgm;` and the extension is present
-- (verified against the live database before this migration was written:
-- `select extname from pg_extension where extname='pg_trgm'` -> `pg_trgm`).
-- An `IF NOT EXISTS` line here would be harmless but would be a no-op that
-- claims to do something, which is worse than its absence.
--
-- ⚠️ NOT WRAPPED IN A `DO $$ ... EXCEPTION` BLOCK, DELIBERATELY (RISK-H). A
-- swallow-all block would turn "this index could not be created" into silence,
-- and an index silently missing is worse than a loud failure precisely because
-- of point 3 above. If this statement cannot run, the deploy SHOULD stop.
--
-- Privilege note: this was authored against a database where the migrating
-- role is a superuser (`select current_user, rolsuper` -> `ptah | t`,
-- PostgreSQL 16.13). On a managed provider where the role is not a superuser,
-- re-run that check before the deploy that carries this migration — the
-- container CMD is `prisma migrate deploy && node main.cjs`, so a migration
-- that cannot apply is a process that never starts, not a degraded feature.

CREATE INDEX "course_lessons_title_trgm" ON "course_lessons" USING gin (title gin_trgm_ops);
