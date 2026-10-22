# Batch 5 report

## Files changed

- `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.ts:1-116` — typed grade projection, prepared UPSERT, indexed subject aggregates and recent grades.
- `libs/backend/skill-synthesis/src/lib/skill-task-grade.store.spec.ts:1-50` — subject isolation, null ungraded rate, and corrected-review replacement.
- `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.ts:1-240` — task grades are the sole source for scorecard and win rates, recent verdicts, and detail verdicts; invocation telemetry still supplies usage and metrics.
- `libs/backend/skill-synthesis/src/lib/skill-scorecard.service.spec.ts:1-71` — grade-only rate and verdict coverage.
- `libs/backend/skill-synthesis/src/lib/di/register.ts:38,168-170` — store registration.
- `libs/backend/skill-synthesis/src/lib/di/tokens.ts:102` — store token.

## Write path and readers

`SkillTaskGradeStore.upsert` is the prepared write API for `skill_task_grades`. No runtime caller writes new rows yet; batch 6 will connect the review harvester. Migration 0056 already creates the table and backfills qualifying historical agent grades. `SkillScorecardService` reads task grades through `getAggregates` and `listRecent`; each read restricts by `(subject_kind, subject_slug)` using `idx_skill_task_grades_subject`. No new migration was needed.

## Decisions

- **Use migration 0056's four-part primary key** `(task_id, subject_kind, subject_slug, attribution_key)`. Options were a new table or the existing projection. Migration 0056 already provides the required columns and index. Reversible by changing store access without a schema change.
- **Keep agent scorecard usage and metric aggregates in `SkillCandidateStore`, while deriving every success rate and verdict from `SkillTaskGradeStore`.** Options were to remove the old aggregate entirely or retain its non-grade data. The existing scorecard DTO needs usage and token metrics, and the batch is additive. Reversible when later batches replace old telemetry paths.
- **Use indexed per-subject prepared aggregate reads.** Options were a dynamic `IN` query or one reusable prepared statement per requested subject. The migration's `(subject_kind, subject_slug)` index supports the latter without building SQL from caller input. Reversible if a later profile calls for batched placeholders.

## Verification

Scoped `ptah_get_diagnostics` reported zero errors. Tests, typecheck, lint, Nx, build, and e2e were not run, per the batch instruction. All changed source files have LF line endings.