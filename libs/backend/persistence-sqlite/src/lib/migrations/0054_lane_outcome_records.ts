// Migration 0054 — lane outcome storage: records, report receipts, held
// reports (TASK_2026_646, SC-1 row / SC-10 keys / SC-7 report hold).
//
// `lane_outcome_records` is one row per finished lane or subagent run: the
// routing decision that produced it, the run's verdict and token/cost facts,
// and the review trail. Later facts arrive as UPDATE patches on the `run_id`
// key, never as new rows, so the primary key is also the SC-10 replay key the
// write pipeline dedups against. `deliverables_declared_at` keeps the FIRST
// declaration time across replays (finding 4, SC-1 `deliverablesDeclaredAt`).
//
// `lane_outcome_report_receipts` is the SC-10 report idempotency table: one
// row per applied `reportId`, so a replayed deliverables or review report is
// a no-op and `revise_rounds + 1` lands exactly once per report. Receipts are
// evicted with their row — the `run_id` index serves that delete.
//
// `lane_outcome_held_reports` is the SC-7 report hold: a `deliverables` (or
// held `review`) report that reached a `subagent:` run before its stop row is
// stored until the stop op joins it, and expires 24 h after `held_at`. The
// `expires_at` index serves both the capacity count (decision #52 / R6-1:
// only rows with `expires_at > now` count) and the expiry sweep's delete; the
// `run_id` index serves the per-run join.
//
// The three key columns (`run_id`, both `report_id`) are NOT NULL: in a
// rowid table SQLite otherwise accepts a NULL TEXT PRIMARY KEY, and a NULL
// key would silently defeat the SC-10 dedup (decision TL-B4-1).
//
// NO CHECK CONSTRAINTS ON THE TEXT ENUMS (`executor_kind`, `verdict`,
// `failure_class`, `routing_source`, `kind`): SQLite cannot widen a CHECK
// without a table rebuild (`0034_skill_session_verdicts.ts`), and the enums
// are validated by Zod at the write edge (Component 3). The schema only
// stores what the pipeline already accepted.
//
// IDEMPOTENT: every statement is guarded by IF NOT EXISTS, so a re-run on an
// already-migrated database is a no-op. New tables only; no data transforms.
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS lane_outcome_records (
  run_id TEXT NOT NULL PRIMARY KEY,
  executor_kind TEXT NOT NULL,
  lane_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  family TEXT,
  provider TEXT,
  model TEXT NOT NULL,
  role TEXT,
  task_kind TEXT,
  task_id TEXT,
  verdict TEXT NOT NULL,
  failure_class TEXT,
  budget_stopped INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  ended_at INTEGER NOT NULL,
  duration_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  routing_source TEXT NOT NULL DEFAULT 'not-routed',
  revise_rounds INTEGER NOT NULL DEFAULT 0,
  final_review TEXT,
  deliverables_declared_at INTEGER,
  subagent_session_id TEXT,
  parent_session_id TEXT,
  workspace_root TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lane_outcome_records_lane_ended
  ON lane_outcome_records (lane_id, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_lane_outcome_records_role_ended
  ON lane_outcome_records (role, ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_lane_outcome_records_agent_ended
  ON lane_outcome_records (agent_id, ended_at DESC);
CREATE TABLE IF NOT EXISTS lane_outcome_report_receipts (
  report_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lane_outcome_report_receipts_run_id
  ON lane_outcome_report_receipts (run_id);
CREATE TABLE IF NOT EXISTS lane_outcome_held_reports (
  report_id TEXT NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  held_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lane_outcome_held_reports_run_id
  ON lane_outcome_held_reports (run_id);
CREATE INDEX IF NOT EXISTS idx_lane_outcome_held_reports_expires_at
  ON lane_outcome_held_reports (expires_at);
`;