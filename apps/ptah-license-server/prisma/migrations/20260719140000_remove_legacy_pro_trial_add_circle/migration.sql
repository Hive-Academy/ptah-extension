-- Remove legacy Pro/trial support and add Circle member linkage.
--
-- Business context: zero real paying subscribers exist. Legacy 'pro' / 'trial_pro'
-- plans are removed entirely (not drained). This migration:
--   1. Drops the trial_reminders table (feature removed).
--   2. Adds users.circle_member_id for the Circle community integration.
--   3. Cleans up auto-generated legacy plan/subscription rows.

-- 1. Drop trial_reminders table (and its FK to users).
DROP TABLE IF EXISTS "trial_reminders";

-- 2. Add Circle member linkage column.
ALTER TABLE "users" ADD COLUMN "circle_member_id" TEXT;

-- 3a. Collapse any legacy 'pro' / 'trial_pro' licenses onto the free Community plan.
UPDATE "licenses" SET "plan" = 'community' WHERE "plan" IN ('pro', 'trial_pro');

-- 3b. Delete auto-generated internal trial subscriptions (no real Paddle records).
DELETE FROM "subscriptions"
WHERE "price_id" = 'auto_trial_pro'
   OR "paddle_subscription_id" LIKE 'trial_%';
