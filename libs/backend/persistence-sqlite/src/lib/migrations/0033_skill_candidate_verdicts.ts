// 0033_skill_candidate_verdicts — per-criterion judge scores, the `unscored`
// verdict, and a human display name for skill candidates (TASK_2026_180,
// phase 1).
//
// EVERY COLUMN IS NULLABLE WITH NO DEFAULT, AND THAT IS THE POINT.
// `registerCandidate` writes a fixed fourteen-column INSERT
// (`skill-candidate.store.ts:130-137`) that names its columns explicitly and is
// NOT touched by this migration. A `NOT NULL` column without a default would
// break that INSERT on every existing install; a `NOT NULL … DEFAULT` would
// fabricate a verdict for candidates nobody has judged. `pinned`
// (`0011_skills_v2.ts:2`) and `residency` (`0026_skill_residency.ts:11`) already
// rely on the same guarantee from the other direction.
//
// `judge_score` IS NULLABLE ON PURPOSE — NULL IS THE `unscored` VERDICT.
// Phase 1 stops the judge fabricating `score: 10` when a call fails, so "we have
// no trustworthy score" must be representable and must NOT collapse into a real
// low score. Any consumer that coalesces this to 0 has reintroduced the bug.
// Note the asymmetry: `skill_suggestions.judge_score` stays `REAL NOT NULL`
// (`0025_skill_suggestions.ts:16`). Only the CANDIDATE score is nullable.
//
// `judge_status` carries NO `CHECK` constraint, deliberately. SQLite cannot
// widen a CHECK with `ALTER TABLE` (see the header of 0032), and unlike the
// queue's stage/status enums this vocabulary is not knowable up front — phases 3
// and 4 add scoring paths. `'scored' | 'unscored' | 'disabled'` is enforced in
// the TypeScript union on the store, where widening costs nothing. A CHECK here
// would buy one class of typo at the price of a table rebuild on live databases.
//
// `judge_panel_rationales` lands here rather than with phase 3's `0035` because
// it is a judge column and belongs beside its siblings. Nothing writes it until
// phase 3; an unwritten nullable column costs one byte of row header.
//
// `display_name` exists so the UI never renders the slug as a title. The slug in
// `name` is derived from the first 140 characters of the first user message and
// is an INTERNAL ID (it is also the SKILL.md folder name and carries a UNIQUE
// index); `display_name` is what a naming pass writes and what a human reads.
// They must not be conflated, which is why this is a new column and not a
// rewrite of `name`.
//
// `idx_skill_candidates_judge` serves the one new access path: "candidates in
// status X whose judge verdict is Y" — the promotion sweep and the UI's
// unscored badge. `(status, judge_status)` in that order because `status` is the
// selective leading term and already has its own index from 0003.
//
// `ADD COLUMN IF NOT EXISTS` does not exist in SQLite and is not needed: the
// runner's `schema_migrations` bookkeeping applies each version exactly once,
// the same guarantee 0026, 0028 and 0031 rely on for their bare ADD COLUMNs.
//
// SECURITY: SQL MUST stay static. No `${...}` interpolation
// (ESLint no-template-curly-in-migration / Semgrep sql-injection-in-migration).
export const sql = `
ALTER TABLE skill_candidates ADD COLUMN judge_score            REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_status           TEXT;
ALTER TABLE skill_candidates ADD COLUMN judge_reason           TEXT;
ALTER TABLE skill_candidates ADD COLUMN judge_novelty          REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_actionability    REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_scope            REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_generalization   REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_trigger_clarity  REAL;
ALTER TABLE skill_candidates ADD COLUMN judge_panel_rationales TEXT;
ALTER TABLE skill_candidates ADD COLUMN judged_at              INTEGER;
ALTER TABLE skill_candidates ADD COLUMN display_name           TEXT;

CREATE INDEX IF NOT EXISTS idx_skill_candidates_judge
  ON skill_candidates(status, judge_status);
`;
