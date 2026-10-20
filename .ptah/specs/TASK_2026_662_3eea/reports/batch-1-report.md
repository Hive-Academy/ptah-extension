# Batch 1 report — TASK_2026_662_3eea

## Task 1.1: Migration 0056 and bundled ratchet

Implemented migration 0056 and registered it after 0055. The migration rebuilds `skill_invocation_events` with the same explicit 20 columns and nullable `succeeded`, copies all IDs and metric/attribution fields, and recreates the six named event indexes. Only rows with `reconciled_at IS NULL` have `succeeded` reset to NULL and `is_error` reset to 0. Reconciled true and false values remain as historical provenance. The existing migration runner wraps SQL and version bookkeeping in one transaction.

Added `skill_task_grades` with a composite key for task, subject and attribution, plus verdict, source, workspace and findings fields. Its backfill accepts only reconciled `subagent` rows with exact `spec:<task_id>` provenance and a nonambiguous run or task/subject association. Window matched, unlinked, duplicated and unreconciled rows remain ungraded. Legacy rows without a run ID use their unique event ID as the attribution key. The historical source string is retained; source file and digest remain NULL until review harvesting supplies them.

Added a regression spec that seeds an optimistic row, a reconciled pass and a reconciled failure at version 55; compares `PRAGMA table_info`, named entries from `PRAGMA index_list`, row IDs and count; checks metrics, nullable workspace, the run lookup and grade backfill; and checks new ungraded agent, skill and command source rows. Another case verifies ambiguous and window matched rows stay ungraded. Updated all 15 ratchet assertions from 55 to 56 and made the 0055 adjacency assertion independent of the latest migration.

## Files created or modified

- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0056_skill_nullable_grades.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0056_skill_nullable_grades.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\index.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0028_gateway_conversation_workspace_root.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0030_skill_event_metrics.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0038_gateway_message_turn_state.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0039_reap_orphaned_queue_rows.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0040_skill_candidate_workspace_root.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0041_skill_md_migration_state.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0042_db_integrity_check_state.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0043_memory_retention.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0045_skill_backlog_cleanup.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0047_memory_retention_health.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0051_skill_lifecycle.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0052_memory_boot_scan_failures.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0053_memory_boot_scan_failure_generation.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0054_lane_outcome_records.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\skill-synthesis-purge\libs\backend\persistence-sqlite\src\lib\migrations\0055_skill_invocation_run_id.spec.ts

## Edge cases and risks

- Data preservation: explicit INSERT/SELECT carries all 20 preexisting columns, including nullable `workspace_root` and `run_id`; the spec compares schema, IDs, count and representative metric values.
- Index preservation: all six named indexes are recreated with their original columns. The spec compares named `PRAGMA index_list` entries before and after, excluding SQLite's implementation named primary key autoindex.
- Grade provenance: exact `spec:<task_id>` reconciliations qualify; window fallback, missing task IDs, duplicate task/subject events and duplicate run IDs do not. Reconciled pass/fail values remain in the event table regardless of grade eligibility.
- Null semantics: unreconciled optimistic values become NULL/0; a new insert can omit `succeeded` and receive NULL. `workspace_root=NULL` is copied without coercion; empty string stays distinct.
- Ratchet: a scoped search for `toBe(55)` in migrations returned zero hits; all 18 owned files use LF line endings.
- Verification: scoped `ptah_get_diagnostics` reported 0 errors and 0 warnings. Tests, Nx, Jest, build and standalone typecheck were not run, per the batch instruction. The orchestrator owns the batch gate.

## Decisions

| Decision | Options | Evidence | Reversible? |
| --- | --- | --- | --- |
| Backfill only exact spec reconciliations with unique attribution. | Include window matched rows; exact only. | The old store writes exact provenance as `spec:<task_id>` and window fallback as `spec-window:<task_id>`; the plan forbids ambiguous positive grades. | Yes, with a later evidence based backfill. |
| Store historical grades as `pass`/`fail`, with nullable source file/digest and raw evidence source. | Invent a review path/digest; preserve known provenance and leave absent fields NULL. | Existing event rows record a verdict source but no artifact digest or path. | Yes, via review reharvest/UPSERT. |
| Compare named event indexes rather than SQLite generated primary key index names. | Compare all raw names; compare the six contract indexes. | Rebuilding via a temporary table can rename SQLite's internal autoindex without changing the primary key. | Yes. |

