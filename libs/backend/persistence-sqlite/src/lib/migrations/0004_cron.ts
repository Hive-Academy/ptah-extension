// SQL migration — STATIC TEXT ONLY. Never add ${...} interpolation here.
// Enforced by ESLint (no-template-curly-in-migration) + Semgrep
// (sql-injection-in-migration). Adding interpolation = SQL injection by design.
export const sql = `
-- 0004_cron.sql — Scheduler
CREATE TABLE scheduled_jobs (
  id           TEXT PRIMARY KEY,                  -- ULID
  name         TEXT NOT NULL,
  cron_expr    TEXT NOT NULL,                     -- croner-compatible
  timezone     TEXT NOT NULL DEFAULT 'UTC',
  prompt       TEXT NOT NULL,
  workspace_root TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_run_at  INTEGER,
  next_run_at  INTEGER                            -- precomputed by scheduler on save
);
CREATE INDEX idx_scheduled_jobs_enabled ON scheduled_jobs(enabled, next_run_at);

CREATE TABLE job_runs (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  scheduled_for   INTEGER NOT NULL,               -- the slot this run claims
  started_at      INTEGER,
  ended_at        INTEGER,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed','skipped')),
  result_summary  TEXT,
  error_message   TEXT,
  -- Critical: at-most-once per scheduled slot
  UNIQUE(job_id, scheduled_for)
);
CREATE INDEX idx_job_runs_job ON job_runs(job_id, scheduled_for DESC);
CREATE INDEX idx_job_runs_status ON job_runs(status);
`;
