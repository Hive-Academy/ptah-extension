# Batches 68 and 69

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0057_drop_skill_pipeline.ts` — deletes the approved job rows and six relational tables; defers optional vec cleanup.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0057_drop_skill_pipeline.spec.ts` — required 0057 regression cases.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\index.ts` — registers 0057 last.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migration-runner.spec.ts` — older vec catch-up, archive, drop order spec.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\embedder\embedder.interface.ts` — memory curator consumer comment.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\skill-pipeline-archive.ts` — exports the existing four-ID constant so 0057 reuses the archive's exact list. This one-line change is outside the requested scope but required by the explicit no-duplicate-ID requirement.
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0028_gateway_conversation_workspace_root.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0030_skill_event_metrics.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0038_gateway_message_turn_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0040_skill_candidate_workspace_root.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0041_skill_md_migration_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0042_db_integrity_check_state.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0045_skill_backlog_cleanup.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0047_memory_retention_health.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0051_skill_lifecycle.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0052_memory_boot_scan_failures.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0053_memory_boot_scan_failure_generation.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0054_lane_outcome_records.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0055_skill_invocation_run_id.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0056_skill_nullable_grades.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\.ptah\specs\TASK_2026_662_3eea\reports\batch-68-69-report.md` — this report.

## Specs

- `leaves version 56 and every table intact when archive verification fails` — case 1; archive failure stops before 0057 and preserves version and tables.
- `does not begin when vec exists but sqlite-vec cannot load` — case 2; preflight rejects and does not invoke archive or drop.
- `defers empty vec cleanup when the vec table is absent` — case 3; relational drop records 57 and queues its `vecSql`.
- `preserves unrelated job and cron history` — case 4; real SQLite keeps an unrelated row in both history tables.
- `catches up older vec work, archives, then applies the 0057 drop` — batch 69 order.
- `registers last with relational and optional vec cleanup` — registry and migration shape.

## Ratchet pins

Latest-version `toBe(56)` changed to `toBe(57)` in these 16 specs: 0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043, 0045, 0047, 0051, 0052, 0053, 0054, 0055, 0056. The 0056 spec's adjacent-version assertion now selects versions 55 and 56 explicitly.

## Remaining reader scan

The required `rg -n` scan produced 143 matches in 26 non-spec files. Each file and every matched line follows (paths relative to workspace root):

- `tools/mcp-bench/src/memory-skills/suites/audits/snapshot-audits.suite.ts:448,449` — reads archived tables.
- `libs/backend/skill-synthesis/src/lib/types.ts:11,13,134,166,350,367,520,527` — historical row type comments, no SQL.
- `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:74` — historical column comment, no SQL.
- `tools/mcp-bench/src/memory-skills/labelling/select-rubric-sample.ts:129,705,706,707` — archive reader and copy description.
- `libs/backend/skill-synthesis/src/lib/queue/queue-db.test-support.ts:50` — test helper comment, no live reader.
- `libs/backend/skill-synthesis/src/lib/lanes/lane.types.ts:179` — historical row comment, no SQL.
- `tools/mcp-bench/src/memory-skills/data/candidate-row-diff.ts:113,150,151,152,189,245` — archive comparison and copy descriptions.
- `libs/backend/memory-curator/src/lib/observation-queue.store.ts:599` — comparison comment, no SQL.
- `tools/mcp-bench/questions/7910f34cf/relevance.json:3599` — frozen benchmark fixture path.
- `tools/mcp-bench/questions/7910f34cf/file-tools.json:7646,7647,7659,7660,7665,7666,12721,12727,12730` — frozen benchmark fixture paths.
- `libs/backend/persistence-sqlite/src/lib/skill-pipeline-archive.ts:12,13,14,15,16,17,18,82,83` — fatal pre-drop archive table list and vec reader.
- `libs/backend/persistence-sqlite/src/lib/migrations/index.ts:53,60,63,253,288,303` — historical migration names and registration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0057_drop_skill_pipeline.ts:10,11,12,13,14,15,21` — new table drops.
- `libs/backend/persistence-sqlite/src/lib/migrations/0051_skill_lifecycle.ts:4,10,34,35,36` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0040_skill_candidate_workspace_root.ts:4,5,9,26,40,66,74,76,79,80,87,88` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0039_reap_orphaned_queue_rows.ts:33,42,62,90,95,102,103` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0036_skill_empirical_gates.ts:42,54,55,56,57,58,59,60` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0035_skill_synthesis_budget_stage.ts:1,55,57,67,70,72,74` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0033_skill_candidate_verdicts.ts:18,19,39,51,52,53,54,55,56,57,58,59,60,61,63,64` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0032_skill_synthesis_queue.ts:1,23,33,35,42,52,72,74,76,78,83` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0026_skill_residency.ts:11` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0025_skill_suggestions.ts:2,7,21,22` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0011_skills_v2.ts:2,3,4` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0007_fix_vec0_rowid.ts:12,13` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migrations/0003_skills.ts:11,18,27,28,29,33,35,41,45` — historical migration.
- `libs/backend/persistence-sqlite/src/lib/migration-runner.ts:352,353` — fatal vec availability preflight, no dropped-table SQL reader.

No live post-drop SQL reader of the six relational tables appeared in that scan.

## Decisions

- **Job IDs:** Export the archive's existing `PIPELINE_JOB_IDS` versus duplicate four string literals. The task requires reuse; exporting the constant requires one line in `skill-pipeline-archive.ts` beyond the listed edit scope.
- **Vec cleanup:** Use optional `vecSql` versus a relational SQL drop. Runner `applyOne` executes both in one transaction with vec loaded and defers `vecSql` when absent; the archive preflight rejects an existing vec table if vec is unavailable.
- **Drop order:** Drop `skill_invocations` before `skill_candidates` versus the reverse. Migration 0003 defines the invocation foreign key to candidates; queue has only a self-reference.
- **Runner behavior:** Keep the existing runner versus edit it. `FIRST_DESTRUCTIVE_SKILL_PIPELINE_VERSION` already equals 57 and `ensureArchive` first performs fatal older vec catch-up, then archive verification, before `applyOne(57)`.
- **Job history:** Delete rows from both tables using the archive ID constant versus relying only on cron cascade. This preserves unrelated history even where `job_runs` has no cron foreign key.

## Not done

- No nx, Jest, TypeScript, lint, build, serve, dev, e2e, or package checks were run, per instruction.
- Existing unrelated modifications in `.ptah/specs/TASK_2026_662_3eea/decisions.md` and `visual/` were left untouched.
