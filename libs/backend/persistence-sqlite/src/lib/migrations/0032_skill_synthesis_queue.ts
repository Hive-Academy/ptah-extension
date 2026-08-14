// 0032_skill_synthesis_queue — the durable work queue that replaces
// skill-synthesis's inline, in-process pipeline (TASK_2026_180, phase 0).
//
// THE TWO `CHECK` LISTS ARE DELIBERATELY AHEAD OF THE CODE THAT USES THEM.
// SQLite cannot extend a CHECK constraint with `ALTER TABLE`; widening one
// means rebuilding the whole table (new table, copy, drop, rename, re-index)
// on every user's live `ptah.db`. So `stage` enumerates all ELEVEN stages and
// `status` all SEVEN statuses up front, even though phase 0 only ever writes
// `prefilter`/`synthesis`/`embedding`/`clustering` and
// `queued`/`claimed`/`running`/`done`. Phases 2-4 then add code, never DDL.
// The co-located spec pins both sets member-for-member; changing either list
// is a schema break, not an edit.
//
// `UNIQUE(session_id, stage)` is load-bearing, not hygiene: enqueue is a plain
// INSERT whose UNIQUE violation is caught and turned into a guarded re-open
// UPDATE gated on `turn_count`. That pair is what makes enqueue idempotent AND
// preserves "re-analyze a session only once it has grown" durably across
// process restarts — the in-memory Map it replaces could not.
//
// `status` carries `unscored` as a first-class member: a stage that ran and
// produced no usable verdict leaves the row re-eligible under `not_before`,
// which is the rate-limit backoff mechanism with no extra machinery. It means
// something different from `skill_candidates.judge_status = 'unscored'`; the
// two must not be conflated.
//
// `depends_on` is a self-reference (the stage DAG) with ON DELETE SET NULL, so
// pruning a finished ancestor row can never cascade away pending work.
//
// Three indexes, one per access path the drain actually has: `idx_ssq_drain`
// for the eligibility scan, `idx_ssq_stale` for stale-claim reaping,
// `idx_ssq_session` for per-session lookup.
//
// `skill_synthesis_workspace_cursor` is the round-robin fairness key — the
// drain orders workspaces by `last_drained_at ASC` (a missing row sorts first)
// so one busy project cannot starve the others. `skill_synthesis_budget` is
// keyed by a UTC `YYYY-MM-DD` day so the daily token cap rolls over at UTC
// midnight regardless of the host's timezone.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
CREATE TABLE IF NOT EXISTS skill_synthesis_queue (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  workspace_root   TEXT NOT NULL DEFAULT '',
  transcript_path  TEXT,
  source           TEXT NOT NULL,
  stage            TEXT NOT NULL CHECK (stage IN (
                     'prefilter','archaeology','synthesis','embedding',
                     'clustering','cluster-synthesis','judge','judge-panel',
                     'replay','trigger-eval','digest')),
  depends_on       TEXT REFERENCES skill_synthesis_queue(id) ON DELETE SET NULL,
  status           TEXT NOT NULL CHECK (status IN (
                     'queued','claimed','running','done','failed',
                     'unscored','skipped')),
  turn_count       INTEGER NOT NULL DEFAULT 0,
  attempt_count    INTEGER NOT NULL DEFAULT 0,
  enqueued_at      INTEGER NOT NULL,
  not_before       INTEGER NOT NULL DEFAULT 0,
  claimed_by       TEXT,
  claimed_at       INTEGER,
  finished_at      INTEGER,
  lane             TEXT,
  reason           TEXT,
  last_error       TEXT,
  candidate_id     TEXT,
  payload          TEXT NOT NULL DEFAULT '{}',
  UNIQUE(session_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_ssq_drain
  ON skill_synthesis_queue(status, not_before, workspace_root);
CREATE INDEX IF NOT EXISTS idx_ssq_stale
  ON skill_synthesis_queue(status, claimed_at);
CREATE INDEX IF NOT EXISTS idx_ssq_session
  ON skill_synthesis_queue(session_id);

CREATE TABLE IF NOT EXISTS skill_synthesis_workspace_cursor (
  workspace_root  TEXT PRIMARY KEY,
  last_drained_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_synthesis_budget (
  day_key       TEXT PRIMARY KEY,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      REAL    NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);
`;
