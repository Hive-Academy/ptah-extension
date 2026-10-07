// Migration 0053 — boot-scan failure ledger: session generation + retry index
// (TASK_2026_621).
//
// `session_mtime_ms` is the session file's mtime when its pass last failed. A
// `given_up` row whose file has since changed is a new generation of the
// session and reopens as `pending` on its next failure, instead of staying
// terminal forever. NULL on rows written before this migration, which counts
// as "changed" for the first failure after it.
//
// The composite index serves the retry query exactly (`workspace_fingerprint
// = ? AND status = 'pending' ORDER BY last_failed_at, session_id`), and makes
// 0052's status-only index redundant: the diagnostics count reads every row
// of a small table and gains nothing from it.
//
// NOT IDEMPOTENT: bare ADD COLUMN relies on the migration runner's exactly-once
// schema_migrations bookkeeping, as do the other additive column migrations.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE memory_boot_scan_failures ADD COLUMN session_mtime_ms INTEGER;
CREATE INDEX IF NOT EXISTS idx_memory_boot_scan_failures_retry
  ON memory_boot_scan_failures (workspace_fingerprint, status, last_failed_at, session_id);
DROP INDEX IF EXISTS idx_memory_boot_scan_failures_status;
`;
