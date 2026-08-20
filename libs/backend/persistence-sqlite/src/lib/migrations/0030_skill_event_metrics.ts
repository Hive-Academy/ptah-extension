// Widens skill_invocation_events with per-invocation runtime metrics captured at
// SubagentStop (token classes, cost, duration, tool count) plus an exact task_id
// attribution column so the spec harvester can reconcile a graded verdict to the
// precise concurrent run instead of a slug+time-window heuristic. All columns are
// nullable with no default: pre-existing rows stay valid with NULL metrics (no
// backfill), and providers that report no usage (Copilot/Codex/ollama) leave the
// token/cost columns NULL — SQL AVG()/SUM() exclude NULLs rather than counting
// them as zero. The composite index backs the harvester's exact (slug, task_id)
// reconcile pass so it never full-table-scans.
//
// SQL MUST stay static — no `${...}` interpolation (enforced by ESLint
// no-template-curly-in-migration + Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_invocation_events ADD COLUMN input_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN output_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN cache_creation_tokens INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN cost_usd REAL;
ALTER TABLE skill_invocation_events ADD COLUMN duration_ms INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN tool_count INTEGER;
ALTER TABLE skill_invocation_events ADD COLUMN task_id TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_task
  ON skill_invocation_events(skill_slug, task_id);
`;
