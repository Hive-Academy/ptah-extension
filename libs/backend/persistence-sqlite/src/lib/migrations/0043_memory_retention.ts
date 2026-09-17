// Migration 0043 — memory retention ledger and run record (TASK_2026_440).
//
// Two NEW tables, both empty at creation, both `IF NOT EXISTS`. Nothing here
// reads, scans, indexes or rewrites `observation_queue`: applying this
// migration on a 1 GB database is DDL on two empty tables and nothing else, so
// the only boot-path cost is the runner's existing out-of-process
// pre-migration backup.
//
// `observation_quarantine` is the stuck-row ledger. When retention removes
// unprocessed queue rows that sat past the grace window, it keeps ONE row per
// `(session_id, kind, reason)` summarising what it removed — count, bytes, and
// the captured-at range — instead of keeping the rows. The UNIQUE constraint is
// what lets the store upsert into an existing summary rather than accumulating
// one ledger row per batch. `reason` is a literal token (`'stuck-unprocessed'`):
// the queue has no error column (`0016`), so there is no error text to copy.
// `idx_obs_quarantine_last` serves the ledger prune, which deletes by
// `last_quarantined_at`.
//
// `memory_retention_state` is the single retention run record. ONE ROW FOR THE
// WHOLE TABLE — `id INTEGER PRIMARY KEY CHECK (id = 1)`, the `0042` shape — for
// the same reason: the record describes the retention job of the database it
// lives in, so a second row could only be a duplicate, and the CHECK makes a
// writer with the wrong key fail loudly. ABSENCE OF THE ROW MEANS "NEVER RAN",
// which the service treats as due.
//
// `last_outcome` holds `'completed' | 'partial' | 'failed'`, written by the
// service. There is deliberately NO CHECK on it: a later phase can add an
// outcome value without a table rebuild, and a rebuild is not re-runnable
// (`persistence-sqlite/CLAUDE.md`). The counters are `NOT NULL DEFAULT 0` so a
// skip-only upsert that names none of them still leaves readable zeros.
//
// Every timestamp is epoch ms.
//
// IDEMPOTENT: `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` only,
// no rebuild, no backfill, no INSERT — applying it twice is a no-op. The
// runner's `schema_migrations` ledger still guarantees exactly-once regardless.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS observation_quarantine (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id           TEXT    NOT NULL,
  kind                 TEXT    NOT NULL,
  reason               TEXT    NOT NULL,
  row_count            INTEGER NOT NULL,
  payload_bytes        INTEGER NOT NULL,
  oldest_captured_at   INTEGER NOT NULL,
  newest_captured_at   INTEGER NOT NULL,
  first_quarantined_at INTEGER NOT NULL,
  last_quarantined_at  INTEGER NOT NULL,
  UNIQUE (session_id, kind, reason)
);
CREATE INDEX IF NOT EXISTS idx_obs_quarantine_last
  ON observation_quarantine(last_quarantined_at);

CREATE TABLE IF NOT EXISTS memory_retention_state (
  id                       INTEGER PRIMARY KEY CHECK (id = 1),
  last_started_at          INTEGER,
  last_finished_at         INTEGER,
  last_outcome             TEXT,
  last_reason              TEXT,
  last_error               TEXT,
  last_duration_ms         INTEGER,
  processed_purged         INTEGER NOT NULL DEFAULT 0,
  stuck_quarantined        INTEGER NOT NULL DEFAULT 0,
  ledger_pruned            INTEGER NOT NULL DEFAULT 0,
  freed_bytes              INTEGER NOT NULL DEFAULT 0,
  pages_reclaimed          INTEGER NOT NULL DEFAULT 0,
  backlog_remaining        INTEGER NOT NULL DEFAULT 0,
  last_completed_at        INTEGER,
  processed_rows_after     INTEGER,
  avg_processed_row_bytes  INTEGER,
  last_skipped_at          INTEGER,
  last_skip_reason         TEXT
);
`;
