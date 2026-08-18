// 0037_skill_invocation_session_join — the two schema facts phase 4's
// invocation → session-outcome join needs (TASK_2026_180, phase 4, batch B4.1).
//
// THE INDEX IS THE POINT, NOT THE COLUMN.
// `skill_invocation_events.session_id` has existed since `0021:5` as
// `TEXT NOT NULL` and has never carried an index — the four that exist are on
// `skill_slug` (`0021`), `context_id` (`0021`),
// `(skill_slug, source, reconciled_at)` (`0027`) and `(skill_slug, task_id)`
// (`0030`). Every one of them narrows by SKILL. Phase 4 is the first consumer
// that starts from a SESSION — "which skills ran in this session", the
// per-session evidence the gap curator's sweeps collect, and the same
// LEFT JOIN whenever the planner drives it from the verdicts side. MEASURED,
// not assumed: at version 36 `WHERE session_id = ?` is a FULL SCAN of the one
// table that grows with every tool use, while plan 2.5's aggregate AS WRITTEN
// is served by the verdicts table's PRIMARY KEY and never touches this index.
// The session-keyed direction is what had nothing, and it is what this buys;
// the spec pins the before/after query plan.
//
// `workspace_root` IS NULLABLE, AND THE NULL IS A REAL VALUE HERE.
// SQLite cannot add a `NOT NULL` column without a default, and a
// `NOT NULL DEFAULT ''` would backfill every pre-0037 row with the empty
// string — which `0034` already spent as a MEANINGFUL value on
// `skill_session_verdicts.workspace_root`: `''` is "deliberately cross-project"
// (clustering, the embedding backfill), not "unknown". Collapsing the two would
// make every historical event look like intentional cross-project work and
// silently widen any workspace-scoped digest to the whole install. So: NULL
// means "recorded before phase 4 threaded the value through, provenance
// unknown", `''` stays reserved for genuine cross-project rows, and a real path
// means what it says. Consumers must branch on all three; none of them may
// coalesce NULL to `''`.
//
// NO `NOT NULL`, NO `DEFAULT`, NO `CHECK` — for the same reason `0036` refuses
// them: `SkillCandidateStore.recordSkillEvent` writes a FIXED column list, and
// a `NOT NULL` column with no default breaks that INSERT on every existing
// install the moment this migration lands. The write edge is where the value is
// enforced (`SkillInvocationRecorder` requires `workspaceRoot` in
// `RecordSkillEventInput`), not the schema.
//
// `IF NOT EXISTS` ON THE INDEX, BARE ON THE `ALTER`. That asymmetry is
// deliberate and matches `0021`/`0027`/`0030`: SQLite has no
// `ADD COLUMN IF NOT EXISTS`, and it does not need one — the runner's
// `schema_migrations` bookkeeping applies each version exactly once. The index
// guard is what `CREATE INDEX` has always carried in this directory and costs
// nothing.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_invocation_events ADD COLUMN workspace_root TEXT;
CREATE INDEX IF NOT EXISTS idx_skill_inv_events_session ON skill_invocation_events(session_id);
`;
