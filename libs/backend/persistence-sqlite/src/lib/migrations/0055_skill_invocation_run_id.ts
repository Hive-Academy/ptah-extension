// Migration 0055 — per-run key on skill invocation events (TASK_2026_646,
// part B Component 6).
//
// `skill_invocation_events` has session, context, skill and task keys since
// 0021/0027/0030/0037, but no per-RUN key: the subagent telemetry seam joins a
// subagent run to its tool events by `run_id = SubagentStopPayload.agentId`.
// `run_id` is added in place; the non-unique index serves that lookup, and the
// seam still reports `ambiguous` when two rows ever share a `run_id`.
//
// NO `NOT NULL`, NO `DEFAULT`, NO `CHECK` — the same rule `0037` set: rows
// written before this migration (and the Task PostToolUse branch, which never
// has a run id) stay NULL, and a `NOT NULL` column without a default would
// break the fixed-column-list INSERT on every existing install. The write edge
// is where the value is enforced, not the schema.
//
// `IF NOT EXISTS` ON THE INDEX, BARE ON THE `ALTER`: SQLite has no
// `ADD COLUMN IF NOT EXISTS`, and it does not need one — the runner's
// `schema_migrations` bookkeeping applies each version exactly once
// (`0037_skill_invocation_session_join.ts:39-44`).
//
// SECURITY: SQL MUST stay static. No template interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_invocation_events ADD COLUMN run_id TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_run ON skill_invocation_events(run_id);
`;