-- CreateTable
CREATE TABLE "waitlist" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),
    "converted_at" TIMESTAMP(3),

    CONSTRAINT "waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "waitlist_email_key" ON "waitlist"("email");

-- CreateIndex
CREATE INDEX "waitlist_created_at_idx" ON "waitlist"("created_at");

-- CreateIndex
CREATE INDEX "waitlist_source_idx" ON "waitlist"("source");
