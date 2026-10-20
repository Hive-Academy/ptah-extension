// Preserve the complete event schema through 0055 while removing the optimistic
// NOT NULL success default. The migration runner executes this static SQL and its
// version bookkeeping in one transaction. Never interpolate values into SQL.
export const sql = `
CREATE TABLE skill_invocation_events_0056 (
  id TEXT PRIMARY KEY,
  skill_slug TEXT NOT NULL,
  session_id TEXT NOT NULL,
  context_id TEXT,
  source TEXT NOT NULL,
  succeeded INTEGER NULL,
  is_error INTEGER NOT NULL DEFAULT 0,
  invoked_at INTEGER NOT NULL,
  reconciled_at INTEGER,
  verdict_source TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_read_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cost_usd REAL,
  duration_ms INTEGER,
  tool_count INTEGER,
  task_id TEXT,
  workspace_root TEXT,
  run_id TEXT
);
INSERT INTO skill_invocation_events_0056 (
  id, skill_slug, session_id, context_id, source, succeeded, is_error,
  invoked_at, reconciled_at, verdict_source, input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, tool_count,
  task_id, workspace_root, run_id
)
SELECT
  id, skill_slug, session_id, context_id, source,
  CASE WHEN reconciled_at IS NULL THEN NULL ELSE succeeded END,
  CASE WHEN reconciled_at IS NULL THEN 0 ELSE is_error END,
  invoked_at, reconciled_at, verdict_source, input_tokens, output_tokens,
  cache_read_tokens, cache_creation_tokens, cost_usd, duration_ms, tool_count,
  task_id, workspace_root, run_id
FROM skill_invocation_events;
DROP TABLE skill_invocation_events;
ALTER TABLE skill_invocation_events_0056 RENAME TO skill_invocation_events;
CREATE INDEX idx_skill_inv_events_slug ON skill_invocation_events(skill_slug);
CREATE INDEX idx_skill_inv_events_ctx ON skill_invocation_events(context_id);
CREATE INDEX idx_skill_inv_events_reconcile ON skill_invocation_events(skill_slug, source, reconciled_at);
CREATE INDEX idx_skill_inv_events_task ON skill_invocation_events(skill_slug, task_id);
CREATE INDEX idx_skill_inv_events_session ON skill_invocation_events(session_id);
CREATE INDEX idx_skill_inv_events_run ON skill_invocation_events(run_id);

CREATE TABLE skill_task_grades (
  task_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL,
  subject_slug TEXT NOT NULL,
  attribution_key TEXT NOT NULL,
  run_id TEXT,
  verdict TEXT NOT NULL,
  source_file TEXT,
  source_digest TEXT,
  evidence_source TEXT NOT NULL,
  workspace_root TEXT,
  graded_at INTEGER NOT NULL,
  findings_ref TEXT,
  PRIMARY KEY (task_id, subject_kind, subject_slug, attribution_key)
);
CREATE INDEX idx_skill_task_grades_subject
  ON skill_task_grades(subject_kind, subject_slug);
CREATE INDEX idx_skill_task_grades_run ON skill_task_grades(run_id);

-- Historical exact spec reconciliations are the only legacy evidence with a
-- known task and agent subject. Window matches and duplicate run/task matches
-- lack enough provenance to become denominator entries.
INSERT INTO skill_task_grades (
  task_id, subject_kind, subject_slug, attribution_key, run_id, verdict,
  source_file, source_digest, evidence_source, workspace_root, graded_at,
  findings_ref
)
SELECT e.task_id, 'agent', e.skill_slug,
  CASE WHEN e.run_id IS NOT NULL THEN 'run:' || e.run_id ELSE 'event:' || e.id END,
  e.run_id, CASE WHEN e.succeeded = 1 THEN 'pass' ELSE 'fail' END,
  NULL, NULL, e.verdict_source, e.workspace_root, e.reconciled_at, NULL
FROM skill_invocation_events AS e
WHERE e.source = 'subagent'
  AND e.reconciled_at IS NOT NULL
  AND e.succeeded IN (0, 1)
  AND e.task_id IS NOT NULL AND e.task_id <> ''
  AND e.skill_slug <> ''
  AND e.verdict_source = 'spec:' || e.task_id
  AND NOT EXISTS (
    SELECT 1 FROM skill_invocation_events AS other
    WHERE other.id <> e.id AND other.source = 'subagent'
      AND other.task_id = e.task_id AND other.skill_slug = e.skill_slug
      AND (e.run_id IS NULL OR other.run_id IS e.run_id OR other.run_id IS NULL)
  )
  AND (e.run_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM skill_invocation_events AS other
    WHERE other.id <> e.id AND other.run_id = e.run_id
  ));
`;
