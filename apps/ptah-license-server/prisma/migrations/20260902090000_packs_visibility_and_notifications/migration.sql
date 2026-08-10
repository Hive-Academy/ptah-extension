-- TASK_2026_177 — migration 5 of 5, Phase 5: pack member-visibility and
-- notifications. Plan §1.8 row 5. Forward-only and sequential: this follows
-- `20260826090000_live_and_private_sessions` (migration 4) and nothing sorts
-- between them (checked in Batch 14 Task 14.1 against `_prisma_migrations`
-- before this file was written — ASSUMPTION-24).
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
-- `prisma migrate diff` emitted, unprompted and as the FIRST three statements
-- of its script:
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
-- curriculum in a migration whose subject is packs and notifications.
--
-- ⚠️ THIS WAS PREDICTED, NOT DISCOVERED. Migration 3's header says in terms:
-- *"Migrations 4 and 5 will each see"* this. Migration 4 stripped the same
-- three and left the instruction *"MIGRATION 5 (Batch 14) MUST DO THE SAME
-- CHECK. The tell is a `DROP INDEX` on a name ending `_trgm` that no task asked
-- for."* Migration 5 did the check, found all three, and stripped all three.
-- The warning chain worked; the next migration in this app must run it again.
--
-- ⚠️ UNLIKE MIGRATION 4, THERE IS NO FOURTH, INTENTIONAL DROP. Migration 4 kept
-- a generated `DROP INDEX "session_requests_status_idx"` because it replaced
-- that index two statements later. This migration drops NOTHING: every
-- statement below is an ADD, a CREATE, or an ALTER … ADD COLUMN.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- SAFETY / NFR-M3. Both columns added to `packs` are NULLABLE or carry a
-- DEFAULT, so this migration applies to a populated `packs` without a backfill
-- and is independently deployable. `member_notifications` is a new empty table.
-- Production runs `npx prisma migrate deploy && node main.cjs`, so schema and
-- code land together or the deploy fails.
--
-- 🔴 `member_visible` DEFAULTS TO `false`, AND THAT DEFAULT IS THE FEATURE
-- (A-1, plan §1.2, Batch 14 exit-gate clause 5). Every pack that exists when
-- this migration runs stays invisible to members until an admin flips the
-- column deliberately through `PATCH /api/v1/admin/packs/:id`. A migration that
-- defaulted to `true` — or that backfilled from `cohort_key IS NOT NULL` —
-- would publish the entire back catalogue in one deploy, which is precisely
-- what A-1's "cohortKey is NOT it and never becomes it" forbids. Proven by
-- counting `packs where member_visible = true` before and after.
--
-- ⚠️ NO `pg_trgm` INDEX IS CREATED HERE. Migrations 2 and 3 own the only three
-- in this database (A-7). A notification has no searchable long text — `title`
-- is server-composed and `body_preview` is a short excerpt — and RK-1 licenses
-- no fourth.

-- AlterTable
-- A-1 / R5.5. Two columns, both admin-controlled, added to the existing
-- registry table. `member_visible` is the SINGLE control over member
-- visibility; `cohort_key` remains the bookkeeping label it always was and
-- gates nothing. `access_note` is member-facing prose about HOW repo access is
-- granted, and is deliberately DISTINCT from `notes`, which stays
-- admin-internal (R5.2) and is never mapped onto a member response.
ALTER TABLE "packs" ADD COLUMN     "access_note" TEXT,
ADD COLUMN     "member_visible" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
-- R10, plan §1.6. In-app only: no email, no push, no websocket, no SSE (§5,
-- AD-14). One row is owned by exactly one user and read by exactly that user —
-- there is no visibility rule, no soft delete and no admin mutation on this
-- table, which is why it carries no `deleted_at` / `deleted_by` pair that every
-- other content table in this schema has.
CREATE TABLE "member_notifications" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "actor_id" UUID,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body_preview" TEXT,
    "route" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- ONE INDEX SERVING TWO READS. The unread badge count (R10.4) is
-- `where user_id = $1 and read_at is null` — the most-called query in the
-- product, issued by every open member tab every 60 s (AD-14) — and the inbox
-- list (R10.3) is `where user_id = $1 order by created_at desc`. Leading with
-- `user_id` serves both; the trailing `created_at` keeps the list's ordering in
-- the index rather than in a sort.
CREATE INDEX "member_notifications_user_id_read_at_created_at_idx" ON "member_notifications"("user_id", "read_at", "created_at");

-- CreateIndex
-- R10.6's retention prune is a GLOBAL sweep — "read rows older than 90 days,
-- across every user" — with no `user_id` predicate at all, so the composite
-- above cannot serve it: its leading column is exactly the one the sweep does
-- not filter on. This second index is the reason the prune is a range scan
-- rather than a full-table scan on a table that only grows.
CREATE INDEX "member_notifications_created_at_idx" ON "member_notifications"("created_at");

-- AddForeignKey
-- `ON DELETE CASCADE`. A notification is personal state with no meaning once
-- the recipient is gone.
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- `ON DELETE SET NULL`, the OPPOSITE rule to the recipient FK above and for the
-- same reason A-4 gives for `topics` / `posts`: deleting the actor must not
-- delete the recipient's record of what happened. The row survives and then
-- reads as system-generated, which is the same shape a genuinely
-- system-authored notification has.
ALTER TABLE "member_notifications" ADD CONSTRAINT "member_notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
