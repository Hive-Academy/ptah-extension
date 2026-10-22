# Batch 47 report

## Files changed

- `tools/mcp-bench/src/memory-skills/data/candidate-row-diff.ts` and `.spec.ts`: candidate rows now come from a receipt checked `skill_candidates.jsonl` fixture; the diff records the archive digest. Specs create synthetic archive fixtures and cover digest failure.
- `tools/mcp-bench/src/memory-skills/suites/audits/snapshot-audits.suite.ts` and `.spec.ts`: backlog queue and candidate figures now come from receipt checked JSONL fixtures, including the previous release comparison. The liveness audit still reads its retained SQLite tables. Specs create synthetic archive fixtures.

## Funnel-kind decision

Kept `skill.backlog.audit` and the `funnel` kind in `memory-skills-suite-kinds.ts`. The audit still measures historical queue age, net growth, and cleanup outcomes independently of the deleted funnel suites. Its archived metrics and baselines remain useful.

## 0057 table set and source

Batch 68.1 in `.ptah/specs/TASK_2026_662_3eea/batches.md` (near line 2073) says 0057 drops six relational tables plus the vec table. The fixed preflight archive list in `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts` (lines 10–18) names them: `skill_candidates`, `skill_suggestions`, `skill_synthesis_queue`, `skill_synthesis_budget`, `skill_invocations`, `skill_synthesis_workspace_cursor`, and `skill_candidates_vec`. The same archive includes selected `job_runs` rows; 0057 deletes only four pipeline job IDs' rows, preserving that table.

## Acceptance rg result

`rg -n "skill_candidates|skill_suggestions|FROM skill_" tools/mcp-bench/src/memory-skills/suites/audits tools/mcp-bench/src/memory-skills/data` found only archive table names, fixture filenames, and comments. It found no live SQL against the 0057 drop set. A targeted `FROM skill_|INSERT INTO skill_|UPDATE skill_|DELETE FROM skill_|CREATE TABLE skill_` search in those directories returned no hits.

## Decisions

- Preserve the liveness audit's snapshot read because its `observation_queue` and `memories` tables are retained.
- Keep the backlog result schema and baselines while replacing its pipeline table reads with the batch 15 receipt and JSONL format.
- Do not run tests, typecheck, lint, build, serve, or e2e, as requested.

## Clarifications Needed

none
