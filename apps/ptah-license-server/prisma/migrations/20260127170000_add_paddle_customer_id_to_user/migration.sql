-- Add paddleCustomerId to User table
-- This ensures each user has only one Paddle customer account

-- Add column
ALTER TABLE "users" ADD COLUMN "paddle_customer_id" TEXT;

-- Add unique constraint
ALTER TABLE "users" ADD CONSTRAINT "users_paddle_customer_id_key" UNIQUE ("paddle_customer_id");

-- Add index for faster lookups
CREATE INDEX "users_paddle_customer_id_idx" ON "users"("paddle_customer_id");
