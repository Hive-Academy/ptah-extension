-- Member groups (cohorts) + user assignments.
--
-- Business context: paid Builders members belong to durable cohorts (e.g.
-- "Founding Members"). New members are auto-assigned to the current default
-- group on provisioning; assignments survive churn (deprovisioning never
-- removes them). A group may map to a Discourse group name that the
-- provisioning fan-out keeps in sync.

-- CreateTable
CREATE TABLE "member_groups" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discourse_group" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_group_assignments" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "group_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,

    CONSTRAINT "member_group_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_groups_key_key" ON "member_groups"("key");

-- CreateIndex
CREATE INDEX "member_groups_is_default_idx" ON "member_groups"("is_default");

-- CreateIndex
CREATE UNIQUE INDEX "member_group_assignments_user_id_group_id_key" ON "member_group_assignments"("user_id", "group_id");

-- CreateIndex
CREATE INDEX "member_group_assignments_group_id_idx" ON "member_group_assignments"("group_id");

-- AddForeignKey
ALTER TABLE "member_group_assignments" ADD CONSTRAINT "member_group_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_group_assignments" ADD CONSTRAINT "member_group_assignments_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "member_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the founding default cohort. Idempotent via ON CONFLICT so
-- `prisma migrate deploy` is safe to re-run against any environment.
INSERT INTO "member_groups" ("id", "key", "name", "description", "discourse_group", "is_default", "created_at")
VALUES (
  'mgrp_founding_seed_0000000000',
  'founding',
  'Founding Members',
  'The earliest paid Builders members.',
  'builders-founding',
  true,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;
