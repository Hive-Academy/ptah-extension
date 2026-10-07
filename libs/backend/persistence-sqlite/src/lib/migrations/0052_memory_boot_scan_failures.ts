// Migration 0052 — memory boot-scan failure ledger (TASK_2026_621).
//
// One row per session whose boot-scan curation pass FAILED (a dispatched
// extract/resolve call that curated nothing). The boot scan records the
// failure here and advances its watermark normally, so a failing session never
// blocks the healthy sessions after it; the next boots retry `pending` rows a
// bounded number of times, deleting a row on success and marking it
// `given_up` (with a reason) when the attempts run out or the session file is
// gone. Diagnostics count both statuses.
//
// Keyed like `boot_scan_state` (0014): by workspace FINGERPRINT, so a renamed
// or moved workspace keeps its ledger, plus the session id. `workspace_root`
// and `session_path` are what a retry needs to run and to check the file still
// exists. All timestamps are epoch ms.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS memory_boot_scan_failures (
  workspace_fingerprint TEXT NOT NULL,
  session_id TEXT NOT NULL,
  workspace_root TEXT NOT NULL,
  session_path TEXT NOT NULL,
  first_failed_at INTEGER NOT NULL,
  last_failed_at INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'given_up')),
  give_up_reason TEXT,
  PRIMARY KEY (workspace_fingerprint, session_id)
);
CREATE INDEX IF NOT EXISTS idx_memory_boot_scan_failures_status
  ON memory_boot_scan_failures (status);
`;
