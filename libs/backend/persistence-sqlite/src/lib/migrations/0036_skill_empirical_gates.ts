// 0036_skill_empirical_gates — the replay-validation and trigger-eval
// measurements that phase 3 gates promotion on (TASK_2026_180, phase 3,
// batch B3.1).
//
// SEVEN NULLABLE COLUMNS, AND THE NULLABILITY IS THE WHOLE POINT.
// Every gate here produces a number in a bounded range that INCLUDES ZERO. A
// replay that aligned with nothing scores `0`; a replay that was never run,
// was skipped by the `replay.enabled` gate, or whose lane failed has NO score.
// Those two facts must not collapse into the same value, because the promotion
// rule reads them differently: a measured `0` is evidence against promotion,
// while an absent measurement means "this gate has not spoken" and must leave
// the candidate retry-eligible rather than silently rejected. This is exactly
// the asymmetry `0033` established for `judge_score`, applied to the measured
// gates — see that migration's header. Any consumer that coalesces one of these
// to `0` has reintroduced the defect the whole phase exists to remove.
//
// SO: NO `NOT NULL`, NO `DEFAULT`, NO `CHECK` — on all seven.
// A `NOT NULL` column without a default would also break `registerCandidate`'s
// fixed fourteen-column INSERT (`skill-candidate.store.ts:130-137`) on every
// existing install, and a `NOT NULL … DEFAULT 0` would fabricate a measurement
// nobody took. `pinned` (`0011_skills_v2.ts:2`), `residency`
// (`0026_skill_residency.ts:11`) and the eleven `0033` columns all rely on the
// same guarantee.
//
// The absent `CHECK` is a separate decision from the absent `NOT NULL`.
// `replay_confidence`, `trigger_precision` and `trigger_recall` are all
// definitionally 0–1 and a `CHECK (x IS NULL OR x BETWEEN 0 AND 1)` would be
// expressible — but SQLite cannot widen or drop a CHECK with `ALTER TABLE`
// (see the header of `0032`), and `trigger_score`'s scale is still B3.3's to
// decide. Rather than constrain three columns in the schema and the fourth in
// TypeScript, all four ranges are enforced at the ONE write edge that exists:
// `SkillCandidateStore.recordReplay` / `recordTriggerEval`, which throw on an
// out-of-range or non-finite value. That is the same place `judge_status`'s
// union is enforced, for the same reason.
//
// `judge_panel_rationales` IS NOT HERE. It shipped in `0033` beside its judge
// siblings; phase 3 only starts WRITING it. Adding it again would fail with
// "duplicate column name" the first time this migration ran.
//
// NO NEW INDEX. Nothing queries on these columns — the weekly drain reaches a
// candidate by id from its queue row, and the promotion sweep already narrows
// through `idx_skill_candidates_judge (status, judge_status)` before it reads a
// replay or trigger number. An index on a column that is NULL for most rows and
// never appears in a WHERE clause is write cost for no read.
//
// `ADD COLUMN IF NOT EXISTS` does not exist in SQLite and is not needed: the
// runner's `schema_migrations` bookkeeping applies each version exactly once,
// the same guarantee 0026, 0028, 0031 and 0033 rely on for their bare
// ADD COLUMNs.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_candidates ADD COLUMN replay_confidence         REAL;
ALTER TABLE skill_candidates ADD COLUMN replay_holdout_session_id TEXT;
ALTER TABLE skill_candidates ADD COLUMN replay_at                 INTEGER;
ALTER TABLE skill_candidates ADD COLUMN trigger_score             REAL;
ALTER TABLE skill_candidates ADD COLUMN trigger_precision         REAL;
ALTER TABLE skill_candidates ADD COLUMN trigger_recall            REAL;
ALTER TABLE skill_candidates ADD COLUMN trigger_eval_at           INTEGER;
`;
