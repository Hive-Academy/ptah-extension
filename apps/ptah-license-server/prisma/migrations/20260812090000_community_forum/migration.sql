-- CreateTable
CREATE TABLE "community_categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "visibility" TEXT NOT NULL DEFAULT 'member',
    "cohort_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_topics" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "author_id" UUID,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "accepted_post_id" TEXT,
    "post_count" INTEGER NOT NULL DEFAULT 0,
    "last_posted_at" TIMESTAMP(3) NOT NULL,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_topics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_posts" (
    "id" TEXT NOT NULL,
    "topic_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "post_number" INTEGER NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "author_id" UUID,
    "edited_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "deleted_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_post_reactions" (
    "id" TEXT NOT NULL,
    "post_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_post_reactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "community_topic_read_state" (
    "user_id" UUID NOT NULL,
    "topic_id" TEXT NOT NULL,
    "last_read_post_number" INTEGER NOT NULL DEFAULT 0,
    "last_read_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "community_topic_read_state_pkey" PRIMARY KEY ("user_id","topic_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "community_categories_slug_key" ON "community_categories"("slug");

-- CreateIndex
CREATE INDEX "community_categories_sort_order_idx" ON "community_categories"("sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "community_topics_slug_key" ON "community_topics"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "community_topics_accepted_post_id_key" ON "community_topics"("accepted_post_id");

-- CreateIndex
CREATE INDEX "community_topics_category_id_pinned_last_posted_at_idx" ON "community_topics"("category_id", "pinned", "last_posted_at");

-- CreateIndex
CREATE INDEX "community_topics_pinned_last_posted_at_idx" ON "community_topics"("pinned", "last_posted_at");

-- CreateIndex
CREATE INDEX "community_topics_author_id_idx" ON "community_topics"("author_id");

-- CreateIndex
CREATE INDEX "community_posts_topic_id_created_at_idx" ON "community_posts"("topic_id", "created_at");

-- CreateIndex
CREATE INDEX "community_posts_author_id_idx" ON "community_posts"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_posts_topic_id_post_number_key" ON "community_posts"("topic_id", "post_number");

-- CreateIndex
CREATE INDEX "community_post_reactions_user_id_idx" ON "community_post_reactions"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "community_post_reactions_post_id_user_id_type_key" ON "community_post_reactions"("post_id", "user_id", "type");

-- AddForeignKey
ALTER TABLE "community_topics" ADD CONSTRAINT "community_topics_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "community_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_topics" ADD CONSTRAINT "community_topics_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_topics" ADD CONSTRAINT "community_topics_accepted_post_id_fkey" FOREIGN KEY ("accepted_post_id") REFERENCES "community_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "community_posts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_reactions" ADD CONSTRAINT "community_post_reactions_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_post_reactions" ADD CONSTRAINT "community_post_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_topic_read_state" ADD CONSTRAINT "community_topic_read_state_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_topic_read_state" ADD CONSTRAINT "community_topic_read_state_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "community_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- HAND-WRITTEN BLOCK - everything above this line was generated by
-- `prisma migrate diff`; everything below it CANNOT be.
--
-- Prisma's schema language has no way to express a GIN index with the
-- `gin_trgm_ops` operator class (A-7, plan section 1.8), so these three
-- statements exist ONLY here, in SQL, and are invisible to `schema.prisma`.
--
-- THREE CONSEQUENCES, ALL OF THEM TRAPS:
--
--   1. `prisma migrate diff` WILL NEVER MENTION THESE INDEXES. Prisma compares
--      the live database against the MODEL, and the model does not contain
--      them. They are not "missing from the diff" by accident - they are
--      outside the thing being diffed.
--
--   2. A LATER MIGRATION CAN THEREFORE DROP THEM SILENTLY. Any workflow that
--      rebuilds these tables (a `migrate reset`, a table rewrite, a
--      shadow-database round trip) drops the indexes with the tables, and the
--      regenerated DDL will not put them back. READ THE GENERATED SQL OF
--      EVERY SUBSEQUENT MIGRATION IN THIS APP before applying it, and re-add
--      this block if it touches `community_topics` or `community_posts`.
--
--   3. LOSING THEM IS A SILENT PERFORMANCE FAILURE, NOT AN ERROR. Search
--      (`GET /v1/members/search`, R1.7) is `ILIKE` accelerated by exactly
--      these two indexes. Without them the queries still return CORRECT
--      results, by sequential scan, and nothing fails until the tables are
--      large enough to time out.
--
-- `CREATE EXTENSION` IS DELIBERATELY NOT WRAPPED IN AN EXCEPTION HANDLER.
-- The license-server Dockerfile CMD is `npx prisma migrate deploy && node
-- main.cjs`, so a migration that cannot apply means the process never starts
-- (RISK-H). That is loud, and loud is correct: a `DO $$ ... EXCEPTION WHEN
-- OTHERS THEN NULL` block would turn a missing extension into a forum whose
-- search silently degrades to sequential scans in production, which is worse
-- than a failed deploy. `IF NOT EXISTS` makes it idempotent; it does not make
-- it optional.
--
-- Verified before authoring (2026-08-04): local PostgreSQL 16.13, `pg_trgm`
-- 1.6 available and not installed, role `ptah` is superuser. Production is a
-- `postgres:16-alpine` container on the droplet where `ptah` is also
-- superuser, so `CREATE EXTENSION` applies there too. Re-check this if the
-- database ever moves to a managed provider (Neon, RDS), where an application
-- role usually cannot create extensions.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "community_topics_title_trgm" ON "community_topics" USING gin (title gin_trgm_ops);
CREATE INDEX "community_posts_body_trgm"   ON "community_posts"  USING gin (body_markdown gin_trgm_ops);
