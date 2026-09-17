// Migration 0045 — durable state for the one-time skill backlog cleanup
// (TASK_2026_461).
//
// The cleanup is resumable, so its cutoff, cursor, outcome and counters live in
// the database they describe. This is one record for the whole database:
// `id INTEGER PRIMARY KEY CHECK (id = 1)` rejects a writer using any other key.
// Absence of the row means the cleanup has never started.
//
// `version`, `cutoff_created_at` and `started_at` are NOT NULL because the
// first run writes all three together. A state store must UPDATE that row in
// place or rebind all three fields on every full-row write.
//
// `last_outcome` deliberately has no CHECK. A later cleanup implementation can
// add an outcome without rebuilding this table, and rebuild migrations are not
// re-runnable. Counters default to zero so the first state write can omit them.
//
// IDEMPOTENT: this is DDL for one empty table only. There is no INSERT,
// backfill, index or access to an existing table.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS skill_backlog_cleanup_state (
  id                             INTEGER PRIMARY KEY CHECK (id = 1),
  version                        INTEGER NOT NULL,
  cutoff_created_at              INTEGER NOT NULL,
  cursor_created_at              INTEGER,
  cursor_id                      TEXT,
  started_at                     INTEGER NOT NULL,
  finished_at                    INTEGER,
  last_run_at                    INTEGER,
  last_outcome                   TEXT,
  last_reason                    TEXT,
  examined                       INTEGER NOT NULL DEFAULT 0,
  kept_evidence                  INTEGER NOT NULL DEFAULT 0,
  kept_verdict                   INTEGER NOT NULL DEFAULT 0,
  kept_degraded_verdict          INTEGER NOT NULL DEFAULT 0,
  rejected_no_evidence           INTEGER NOT NULL DEFAULT 0,
  rejected_transcript_unreadable INTEGER NOT NULL DEFAULT 0,
  invocations_deleted            INTEGER NOT NULL DEFAULT 0
);
`;
