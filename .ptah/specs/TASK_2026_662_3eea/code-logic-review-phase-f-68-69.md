# Code Logic Review: Phase F batches 68 and 69 (migration 0057)

Score: 8/10
Verdict: APPROVED WITH FOLLOW-UPS
Review family: reviewer: Claude, implementer: codex

Scope read: 0057 migration and spec, `migrations/index.ts` diff, `skill-pipeline-archive.ts` diff, `migration-runner.ts` in full (`applyAll`, `ensureArchive`, `runVecCatchUp`), the new `migration-runner.spec.ts` case, and earlier migrations 0003, 0011, 0025, 0026, 0032, 0035, 0036, 0056. No tests were run, per the rules.

## Checks

1. Archive before 57: PASS.
   - `migration-runner.ts` `applyAll` calls `ensureArchiveOnce()` before `applyOne` for any version >= `FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION`.
   - `ensureArchive` runs older vec catch-up with `fatal: true` first, then `archiveSkillPipeline`.
   - An archive throw propagates before any `BEGIN`, so the database stays at 56 with all tables intact. The spec "leaves version 56 ... intact" asserts this.
2. Job-row scope and FK order: PASS.
   - `0057_drop_skill_pipeline.ts:7-8` filters on `PIPELINE_JOB_IDS`, the same constant the archive uses (`skill-pipeline-archive.ts:23`). The IDs are bundled constants and are escaped.
   - `skill_invocations` (the only FK child, `0003_skills.ts:35`) is dropped before `skill_candidates`.
   - `skill_synthesis_queue` has only a self-reference, so its drop is safe.
   - No other migration declares a `REFERENCES` to a dropped table.
   - The triggers and views found in migrations 0002, 0013, 0017 and 0019 target memory and code tables only.
   - `skill_invocation_events` (rebuilt in 0056) has no FK to the dropped tables.
3. vecSql: PASS.
   - It uses `IF EXISTS`.
   - When sqlite-vec is loaded it is applied in the same transaction. When not loaded it is deferred and caught up later.
   - `ensureArchive` rejects before any change if the vec table exists but the extension is unavailable.
4. `DROP TABLE` without `IF EXISTS`: PASS, no boot-breaking path found.
   - All six tables are created unconditionally by migrations 0003, 0025 and 0032.
   - `skill_synthesis_budget` is rebuilt in 0035 via `DROP` plus `RENAME`, so it still exists at 56.
   - No migration drops any of the six tables. A fresh install runs all of them.
   - Only a hand-edited database could lack a table.
5. Live code touching the dropped tables: PASS.
   - Non-spec, non-migration hits in `libs` and `apps` are comments or types only: `memory-curator observation-queue.store.ts:599`, and `skill-synthesis` `types.ts`, `skill-judge.service.ts` and `lane.types.ts`. None runs SQL.
   - Scheduler job IDs only appear in `thoth-runtime/retired-skill-jobs.ts`, a retirement list, so nothing re-seeds them.
   - `tools/mcp-bench` and `scripts` reference the tables for archive and snapshot tooling, not for runtime paths.
6. Spec quality: adequate, with two weaknesses (findings 1 and 2).

## Findings

### Moderate

1. The "preserves unrelated job and cron history" test cannot catch an FK-order regression.
   - Evidence: `0057_drop_skill_pipeline.spec.ts:87-90` creates every table as `(id TEXT)` with no FK, even though it enables `PRAGMA foreign_keys`.
   - Scenario: someone reorders the drops so `skill_candidates` goes before `skill_invocations`. The test still passes, but a real database with `skill_invocations` rows would hit implicit-delete behavior or a constraint failure.
   - Fix: build the fixture from the real DDL, or at least declare `skill_invocations(skill_id REFERENCES skill_candidates(id) ON DELETE CASCADE)`.
   - Fix: also model `job_runs.job_id REFERENCES scheduled_jobs(id) ON DELETE CASCADE` (`0004_cron.ts:20`).

2. The runner and archive-failure cases use `FakeSqliteDatabase` and mock `archiveSkillPipeline`.
   - Evidence: `migration-runner.spec.ts` order case, and the failure case at `0057_drop_skill_pipeline.spec.ts:35-50`.
   - They prove ordering and the "no `BEGIN`" behavior, which is the intended contract. They do not prove that the real 0057 SQL applies on real SQLite through the runner.
   - The only real-SQLite execution is the manual `DatabaseSync` test, which bypasses the runner and its transaction wrapping.
   - Follow-up: one integration test that runs the runner against `node:sqlite`, or against the real schema produced by migrations 0001-0056 followed by 0057.
   - This would also settle the `sqlite_schema` probe stub at spec line 60, which currently fakes `get`.

### Minor

3. `0057_drop_skill_pipeline.ts:3-4`: the quoting helper is fine. Parameter binding is not possible in multi-statement `exec`, and the comment explains why. No action is needed.

4. Fresh installs now run the archive step too.
   - Evidence: `applyAll` triggers `ensureArchiveOnce` when 57 is pending, including when the version-56 tables are empty.
   - The spec does not cover whether the archive handles empty tables or an empty database. `skill-pipeline-archive.spec.ts` likely does; confirm. If it throws on empty tables, first boot breaks.
   - Fix: add an explicit fresh-database case to the runner spec.

No Blocking or Serious issues were found.
