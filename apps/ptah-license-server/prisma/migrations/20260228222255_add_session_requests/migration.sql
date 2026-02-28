-- CreateTable
CREATE TABLE "session_requests" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "session_topic_id" TEXT NOT NULL,
    "additional_notes" TEXT,
    "is_free_session" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_status" TEXT NOT NULL DEFAULT 'none',
    "paddle_transaction_id" TEXT,
    "scheduled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_requests_user_id_idx" ON "session_requests"("user_id");

-- CreateIndex
CREATE INDEX "session_requests_status_idx" ON "session_requests"("status");

-- AddForeignKey
ALTER TABLE "session_requests" ADD CONSTRAINT "session_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
