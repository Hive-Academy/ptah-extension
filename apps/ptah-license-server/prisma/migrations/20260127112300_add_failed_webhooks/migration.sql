-- CreateTable
CREATE TABLE "failed_webhooks" (
    "id" UUID NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "error_message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "failed_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "failed_webhooks_event_id_idx" ON "failed_webhooks"("event_id");

-- CreateIndex
CREATE INDEX "failed_webhooks_event_type_idx" ON "failed_webhooks"("event_type");

-- CreateIndex
CREATE INDEX "failed_webhooks_resolved_idx" ON "failed_webhooks"("resolved");
