# Code Logic Review — TASK_2026_563_2939, Batch 2

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Failure modes found | 0        |

Approval is limited to Batch 2's migration implementation and ratchet edits. No actionable defect was established. The score reflects exact policy fidelity, bounded mutation and meaningful regression assertions; it is above the 5–6 band because there is no demonstrated functional gap in this batch. It is below 9–10 because the executed specs bypass the production runner and do not exercise vector tables or prove both drivers ran (0049_memory_sediment_quarantine.spec.ts:374, :433; 0048_memory_quarantine.spec.ts:22). Those verification limits do not amount to a demonstrated migration defect.

All source references below are relative to `D:/projects/ptah-extension-memory-quality-source/libs/backend/persistence-sqlite/src/lib/`, unless prefixed with `task/`. `task/` means `D:/projects/ptah-extension-memory-quality-source/.ptah/specs/TASK_2026_563_2939/`.

## Scope and verification

Read the four new migration/source specs and migrations/index.ts in full, plus all 12 listed ratchet specs (0028, 0030, 0038–0047). Read the full migration-runner.ts, the connection's migration entry/failure path, and adjacent schema/data-migration precedents (0002, 0017, 0018, 0019, 0039, 0044, 0046, 0047). Reviewed task context, Batch 2, plan component 3 and quarantine-rules r2 sections 5–6 against M5 criteria 3, 4 and 7. No root or covering directory AGENTS.md/CLAUDE.md/HANDOFF.md was present at the checked worktree paths; no existing code-style review was present in this task folder when inspected. The supplied project guidance applies.

The permitted command, run once from the specified worktree:

`npx jest -c libs/backend/persistence-sqlite/jest.config.ts --testPathPatterns "0048|0049" --runInBand`

Result: **2 suites passed, 12 tests passed, no skips**, 2.094 seconds. PowerShell emitted a NativeCommandError wrapper for Node stderr, but the Jest summary reported both suites passing. No suite was rerun. Tests use only isolated `:memory:` databases (0048_memory_quarantine.spec.ts:27; 0049_memory_sediment_quarantine.spec.ts:35).

`ptah_get_diagnostics` was requested for the five principal files using absolute worktree paths. It returned **Unavailable: None of the requested files are inside the workspace root**. This is not a clean diagnostic result. No fallback workspace-wide check was run. Electron execution, full-project checks, a real DB copy, vector preservation measurements and fault injection were not performed in this review. No persistent database was opened. Concurrent memory-curator work was excluded.

## Five logic questions

### 1. How does this fail silently?

No silent-success path was found in the new migrations. Both are static statements with no catch/fallback (migrations/0048_memory_quarantine.ts:18; migrations/0049_memory_sediment_quarantine.ts:33). SQL and the version record commit together, and an error rolls back and is rethrown (migration-runner.ts:245, :251, :265). The connection closes on that error and does not notify successful-open subscribers (sqlite-connection.service.ts:239, :250, :251). Failure to create a pre-migration backup is logged but non-fatal by existing design, explicitly acknowledged in the plan; correctness does not depend on it (migration-runner.ts:88; task/implementation-plan.md:391).

### 2. What user action produces unexpected behaviour?

No newly unintended action was established. On upgrade, scope-related commitlint facts are quarantined across all workspaces, including NULL scope, while pinned/core/corpus rows are preserved (migrations/0049_memory_sediment_quarantine.ts:37). Restored matching rows remain active on subsequent ordinary boots because the runner skips recorded version 49 (migration-runner.ts:113). Manually replaying raw 0049 after clearing quarantine can quarantine them again; that is not the normal boot path. Restoring and all retrieval behavior are later batches, not certified here (task/batches.md:259; task/batches.md:491).

### 3. What input data produces a wrong answer?

No mismatch with the accepted rule was found. A workflow lesson stored as a **fact** mentioning scope can be selected, but this is an explicitly accepted policy trade-off, not an undisclosed defect (task/quarantine-rules.md:413; migrations/0049_memory_sediment_quarantine.ts:38). NULL subjects do not satisfy LIKE; NULL workspaces are not filtered. Case normalization uses LOWER with LIKE and ASCII tokens, not GLOB. The mixed-case positive fixture exercises this path (migrations/0049_memory_sediment_quarantine.spec.ts:103). `%scope%` is intentionally a substring test, as prescribed at task/quarantine-rules.md:405.

### 4. What happens when a dependency fails?

A missing table/column, SQL execution failure or commit failure propagates through the existing rollback path; it cannot record that migration as complete (migration-runner.ts:245, :265). An unavailable writer lock fails before any SQL mutation at BEGIN IMMEDIATE (migration-runner.ts:245). Version 48 may already be committed if 49 fails, but the connection closes and the next boot skips 48 and retries 49 (migration-runner.ts:113; sqlite-connection.service.ts:251). An absent sqlite-vec extension does not gate either migration because both registry entries contain only plain SQL (migrations/index.ts:358). Both new specs try better-sqlite3 then node:sqlite and fail rather than skip when neither works (migrations/0048_memory_quarantine.spec.ts:22, :59; migrations/0049_memory_sediment_quarantine.spec.ts:30, :355).

### 5. What is missing that the requirements never mentioned?

No additional Batch 2 requirement was necessary to make the implementation correct. Residual uncertainty: the runner's applied-version set is read before its awaited backup and before per-migration locks; this review does not establish simultaneous multi-process upgrade behavior (migration-runner.ts:76, :91, :245). The normal sequential exactly-once path is supported by the ledger and transaction code. The new tests do not prove crash/lock behavior through that runner (migrations/0048_memory_quarantine.spec.ts:71; migrations/0049_memory_sediment_quarantine.spec.ts:374). These are limits on the review's claims, not new Batch 2 findings.

## Failure modes

**Numbered findings: none.** No supported blocking, serious, moderate or minor issue in the batch requires a source change.

The checks covered predicate widening/narrowing, wrong time units, missing corpus correlation, accidental workspace filtering, touched-column expansion, deletes, reapplication, missing registration and changes to existing lifecycle expectations. SQL inspection plus the 12 passing tests support the clean verdict; they do not substitute for the later real-copy acceptance measurements.

## Blocking issues

None established.

## Serious issues

None established.

## Moderate and minor issues

None established. Two limitations should remain visible in downstream validation:

- The test named “every other column” explicitly selects many, but not all, pre-existing columns (migrations/0049_memory_sediment_quarantine.spec.ts:527). Its static SET-clause assertion separately rejects writes to any other column (:329), so no mutation defect is demonstrated. The exhaustive identity/content comparison required by M5 criterion 4 is still a separate real-copy gate (task/task-description.md:259).
- Driver fallback is implemented, but one ordinary Jest run selects only the first usable driver; it does not establish a dual-driver run (migrations/0049_memory_sediment_quarantine.spec.ts:30). Batch verification explicitly calls for the Electron rerun (task/batches.md:242).

## Data flow

1. **OK — registration/reachability.** The connection passes MIGRATIONS into applyAll (sqlite-connection.service.ts:239). Index imports both new modules and registers 48 then 49 once as plain SQL (migrations/index.ts:76, :358).
2. **OK — order and sequential replay.** The runner sorts versions, reads the ledger, skips already recorded versions, then applies pending migrations (migration-runner.ts:74, :76, :113, :131). Existing schema prerequisites precede both new entries.
3. **OK — additive schema.** Version 48 adds only nullable INTEGER and TEXT columns, without defaults or indexes (migrations/0048_memory_quarantine.ts:19). Existing rows remain active; schema and default behavior are asserted (migrations/0048_memory_quarantine.spec.ts:95).
4. **OK — R4 selection.** The common guard equals task/quarantine-rules.md:390, and the predicate equals :405 verbatim (migrations/0049_memory_sediment_quarantine.ts:37). `memories.id` correctly correlates the subquery to the unaliased update target. Both a linked excluded row and unlinked included rows are present, so a globally uncorrelated NOT EXISTS would fail the fixture test (migrations/0049_memory_sediment_quarantine.spec.ts:268, :474).
5. **OK — mutation and timestamp.** Exactly one UPDATE assigns only quarantined_at and quarantine_reason (migrations/0049_memory_sediment_quarantine.ts:34). CAST of strftime seconds to INTEGER followed by multiplication by 1000 yields epoch milliseconds at whole-second precision; assertions bound the timestamp and enforce divisibility by 1000 (migrations/0049_memory_sediment_quarantine.spec.ts:468).
6. **OK — no cascade or index deletion.** No memory id/content/chunk is changed or deleted. Existing FTS triggers act on chunk writes, the concepts trigger on memory deletion and the vector cleanup trigger on chunk deletion; none is invoked by changing only the quarantine columns (migrations/0002_memory.ts:53; migrations/0017_memory_schema_v2.ts:42; migrations/0019_memory_chunks_vec_cleanup.ts:16). Counts of memories, chunks, FTS docsize, concepts and corpus links are checked (migrations/0049_memory_sediment_quarantine.spec.ts:433, :514).
7. **OK — idempotent update.** quarantined_at IS NULL excludes already quarantined rows. The spec sets a distinguishable timestamp and checks both row equality and total_changes, so a same-value or timestamp-reset update cannot silently pass (migrations/0049_memory_sediment_quarantine.spec.ts:542).
8. **OK — commit/failure boundary.** SQL, schema_migrations and user_version share one transaction per migration, with rollback/rethrow on failure (migration-runner.ts:245). There is no promise that versions 48 and 49 are a single transaction, nor does the plan require one.

## Requirements fulfilment

| Requirement                                                                                    | Status               | Evidence / gap                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5 criterion 3: additive columns, static SQL, registration, own spec, old migrations unchanged | COMPLETE             | migrations/0048_memory_quarantine.ts:18; migrations/index.ts:358; migrations/0048_memory_quarantine.spec.ts:43; scoped diff contains no modification to previously released migration SQL                             |
| Plan component 3 / R4 exact common guard and predicate                                         | COMPLETE             | migrations/0049_memory_sediment_quarantine.ts:37 matches task/quarantine-rules.md:390 and :405; exact predicate assertion at migrations/0049_memory_sediment_quarantine.spec.ts:340                                   |
| M5 criterion 4: real-copy counts, integrity, ordered content comparison, duration              | PARTIAL              | Synthetic preservation assertions pass at migrations/0049_memory_sediment_quarantine.spec.ts:514 and :536; real-copy measurement belongs to task/batches.md:517 and was not run here                                  |
| M5 criterion 7: quarantine non-destructive and idempotent                                      | COMPLETE for Batch 2 | Only the two assignments at migrations/0049_memory_sediment_quarantine.ts:35; change-count assertion at migrations/0049_memory_sediment_quarantine.spec.ts:557. Restore and vector-copy validation remain later gates |
| All 18 specified fixtures                                                                      | COMPLETE             | Fixture objects at migrations/0049_memory_sediment_quarantine.spec.ts:82; counts at :359; exact selected ids at :474 and protected rows at :485                                                                       |
| NULL workspace support and pinned/core/corpus guard                                            | COMPLETE             | migrations/0049_memory_sediment_quarantine.spec.ts:95, :268, :280, :292; NULL assertion at :504                                                                                                                       |
| Merge lookup retains existing index                                                            | COMPLETE             | EQP assertion includes quarantine predicate, migrations/0048_memory_quarantine.spec.ts:130; passed in permitted run                                                                                                   |
| Dual-driver fallback                                                                           | COMPLETE             | migrations/0048_memory_quarantine.spec.ts:22; migrations/0049_memory_sediment_quarantine.spec.ts:30. Both-driver execution not certified                                                                              |
| Ratchets only; 0044 lifecycle expectations preserved                                           | COMPLETE             | Scoped diff versus ebfc73321 shows only 47 -> 49 ceilings plus comments in all 12 specs; migrations/0044_memory_lifecycle.spec.ts:68, :151, :263, :292                                                                |

Ratchet locations: migrations/0028_gateway_conversation_workspace_root.spec.ts:83; migrations/0030_skill_event_metrics.spec.ts:38; migrations/0038_gateway_message_turn_state.spec.ts:91; migrations/0039_reap_orphaned_queue_rows.spec.ts:65; migrations/0040_skill_candidate_workspace_root.spec.ts:78; migrations/0041_skill_md_migration_state.spec.ts:62; migrations/0042_db_integrity_check_state.spec.ts:70; migrations/0043_memory_retention.spec.ts:54; migrations/0044_memory_lifecycle.spec.ts:68; migrations/0045_skill_backlog_cleanup.spec.ts:33; migrations/0046_memory_merge_subject_index.spec.ts:33; migrations/0047_memory_retention_health.spec.ts:34. The version-47 registry assertion and pre-47 setup remain intact at the latter file's :30 and :46. No toBe(47) ceiling remains.

Implicit requirements not addressed: none specific to Batch 2. Full feature exclusion, restore and lifecycle protection are not inferred from this migration review.

## Edge cases

| Case                                | Handled                    | How                                                                                                   | Concern                                                                 |
| ----------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Empty table / no matching facts     | YES                        | UPDATE has no qualifying rows, migrations/0049_memory_sediment_quarantine.ts:34                       | No standalone empty-table assertion                                     |
| NULL workspace                      | YES                        | No workspace predicate; explicit positive at migrations/0049_memory_sediment_quarantine.spec.ts:97    | Restore scope is later work                                             |
| NULL subject                        | YES                        | NULL LIKE does not qualify, migrations/0049_memory_sediment_quarantine.ts:38                          | Not separately seeded                                                   |
| Mixed ASCII case and padding        | YES                        | LOWER/TRIM + LIKE; fixture at migrations/0049_memory_sediment_quarantine.spec.ts:103                  | No GLOB semantics involved                                              |
| Pinned, core or corpus-linked       | YES                        | Guard and three independent matching fixtures, migrations/0049_memory_sediment_quarantine.spec.ts:268 | Protected rows would be selected if their individual guard were dropped |
| Event / preference / non-scope fact | YES                        | Durable fixtures at migrations/0049_memory_sediment_quarantine.spec.ts:107, :232, :256                | Accepted policy still permits scope-related facts with lessons          |
| Already quarantined                 | YES                        | Guard; zero additional total_changes at migrations/0049_memory_sediment_quarantine.spec.ts:557        | Raw replay after restore is a fresh quarantine                          |
| Normal repeated boot                | YES                        | Ledger skip at migration-runner.ts:113                                                                | New specs exercise raw SQL, not runner replay                           |
| Large table                         | YES, bounded one-time work | One UPDATE, indexed corpus lookup from migrations/0044_memory_lifecycle.ts:17                         | Actual copy timing not reproduced                                       |
| SQL failure / process interruption  | YES by transaction design  | migration-runner.ts:245                                                                               | Crash behavior not fault-injected                                       |
| Concurrent independent upgraders    | NOT VERIFIED               | Ledger read before awaited backup, migration-runner.ts:76, :91                                        | No multi-process exactly-once claim                                     |

## Verdict

- Recommendation: **APPROVE** Batch 2.
- Confidence: **HIGH** for the inspected migration logic and ratchet scope; limited to the executed checks above.
- Top risk: treating passing synthetic migration tests as completion of M5's real-copy, vector-preservation and retrieval/restore acceptance gates (task/task-description.md:249; task/batches.md:491).
- What a robust completion would add: the already planned Electron driver run, scoped project validation/diagnostics in the correct worktree, and Batch 7's real-copy integrity/content/vector checks and quarantine/restore round trip. No Batch 2 source correction is requested.
