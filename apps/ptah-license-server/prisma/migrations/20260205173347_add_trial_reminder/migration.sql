-- CreateTable
CREATE TABLE "trial_reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reminder_type" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_sent_to" TEXT NOT NULL,

    CONSTRAINT "trial_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "trial_reminders_user_id_idx" ON "trial_reminders"("user_id");

-- CreateIndex
CREATE INDEX "trial_reminders_reminder_type_idx" ON "trial_reminders"("reminder_type");

-- CreateIndex
CREATE UNIQUE INDEX "trial_reminders_user_id_reminder_type_key" ON "trial_reminders"("user_id", "reminder_type");

-- AddForeignKey
ALTER TABLE "trial_reminders" ADD CONSTRAINT "trial_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
