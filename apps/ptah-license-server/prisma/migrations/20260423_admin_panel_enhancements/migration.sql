-- TASK_2025_292: Admin Panel Enhancements
-- Additive, zero-downtime migration (PG 16 treats ADD COLUMN ... DEFAULT ... NOT NULL as metadata-only).
-- All new columns have DEFAULT values; no existing code references them until the new backend code ships.

-- 1. Marketing opt-in state on users (CAN-SPAM)
ALTER TABLE "users" ADD COLUMN "marketing_opt_in" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "unsubscribed_at" TIMESTAMP(3);

-- 2. License source column — 'paddle' | 'complimentary' | 'manual'
ALTER TABLE "licenses" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'paddle';

-- 3. Index for source filtering (MRR dashboards, comp-license counts)
CREATE INDEX "licenses_source_idx" ON "licenses"("source");

-- 4. Admin audit log — append-only record of admin actions
CREATE TABLE "admin_audit_log" (
    "id" UUID NOT NULL,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "target_snapshot" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "admin_audit_log_actor_email_idx" ON "admin_audit_log"("actor_email");
CREATE INDEX "admin_audit_log_action_idx" ON "admin_audit_log"("action");
CREATE INDEX "admin_audit_log_target_type_target_id_idx" ON "admin_audit_log"("target_type", "target_id");
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at");

-- 5. Marketing campaign templates — reusable, unique by name
CREATE TABLE "marketing_campaign_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html_body" TEXT NOT NULL,
    "variables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_campaign_templates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "marketing_campaign_templates_name_key" ON "marketing_campaign_templates"("name");
CREATE INDEX "marketing_campaign_templates_name_idx" ON "marketing_campaign_templates"("name");
CREATE INDEX "marketing_campaign_templates_created_at_idx" ON "marketing_campaign_templates"("created_at");

-- 6. Marketing campaigns — one row per send. template FK is SET NULL so campaign history survives template deletion.
CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "template_id" UUID,
    "segment" TEXT NOT NULL,
    "recipient_count" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "bounced_count" INTEGER NOT NULL DEFAULT 0,
    "complained_count" INTEGER NOT NULL DEFAULT 0,
    "unsubscribed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "marketing_campaigns_subject_created_at_idx" ON "marketing_campaigns"("subject", "created_at");
CREATE INDEX "marketing_campaigns_created_by_idx" ON "marketing_campaigns"("created_by");
CREATE INDEX "marketing_campaigns_created_at_idx" ON "marketing_campaigns"("created_at");

-- 7. FK campaign → template (SET NULL on template delete preserves campaign history)
ALTER TABLE "marketing_campaigns"
    ADD CONSTRAINT "marketing_campaigns_template_id_fkey"
    FOREIGN KEY ("template_id") REFERENCES "marketing_campaign_templates"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
