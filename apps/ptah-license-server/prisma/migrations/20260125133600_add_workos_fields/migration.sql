/*
  Warnings:

  - A unique constraint covering the columns `[workos_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updated_at` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "email_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "first_name" TEXT,
ADD COLUMN     "last_name" TEXT,
ADD COLUMN     "updated_at" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "workos_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_workos_id_key" ON "users"("workos_id");

-- CreateIndex
CREATE INDEX "users_workos_id_idx" ON "users"("workos_id");
