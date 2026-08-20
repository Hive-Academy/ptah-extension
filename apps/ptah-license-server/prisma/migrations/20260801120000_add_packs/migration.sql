-- TASK_2026_169: Builders "packs" — an ADMIN-ONLY REGISTRY of the GitHub repos
-- shared with each cohort. One pack = one dedicated repo.
--
-- THIS TABLE GATES NOTHING. No member-facing endpoint reads it. Access to a pack
-- is administered entirely on GitHub (collaborator invites, or the repo link posted
-- inside that cohort's Discourse group). `cohort_key` is a bookkeeping label, not an
-- access control; it FKs to member_groups(key) — a stable, immutable natural key —
-- purely so the label cannot name a cohort that does not exist. ON DELETE SET NULL
-- so deleting a cohort unlabels its packs rather than erasing the registry row.

-- CreateTable
CREATE TABLE "packs" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "repo_url" TEXT NOT NULL,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cohort_key" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "packs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "packs_slug_key" ON "packs"("slug");

-- CreateIndex
CREATE INDEX "packs_cohort_key_idx" ON "packs"("cohort_key");

-- AddForeignKey
ALTER TABLE "packs" ADD CONSTRAINT "packs_cohort_key_fkey"
    FOREIGN KEY ("cohort_key") REFERENCES "member_groups"("key")
    ON DELETE SET NULL ON UPDATE CASCADE;
