-- 0001_init.sql — bookkeeping
-- Tracks which migrations have been applied to this database.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
