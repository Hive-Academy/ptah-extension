# Code logic review — TASK_2026_878_5513, Phases B and C

## Verdict

**REVISE — 5/10.** Census join orders, migration, and task reconciliation are implemented, but persistence failures can appear successful and overlapping censuses can leave stale last-run state. These real gaps put the code below the sound 7–8 band; the main design works, placing it above the foundational 3–4 band.

## Findings

1. **Serious — `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:1195`.** `upsertRow` catches and only debug-logs SQLite failures. `settleCensus` then emits `INDEXING_COMPLETE` at line 813 even if its `last_run_json` write at line 803 failed. A refresh shows no last run after apparent success. Make the required write report success or throw; emit a success push only after persistence succeeds.
2. **Serious — `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:803`.** A manual census closes to joiners after symbols finish but remains live during `runMemory` (lines 548–556). A newer watcher census can settle first, then the older manual census overwrites `last_run_json`. The test at `indexing-control.service.spec.ts:1298` exercises this order but checks only that two writes occurred. Preserve one write per census while guarding the displayed last-run summary by census start order; assert final status in the test.
3. **Moderate — `libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts:212`.** `writeGrades` still uses `/plan|architecture/i` instead of `isDocumentReview` at `spec-extractor.ts:160`. A `task-description-review.md` or `design-spec-review.md` can become a work grade, although `taskVerdict` excludes those files at `spec-extractor.ts:178`. Use the shared helper for all grade review matches and test document reviews.
4. **Moderate — `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:704`.** The progress callback has no released-record guard. A delayed indexer callback after final release can broadcast progress after a terminal push and make the UI appear active again. Ignore progress after settlement and test a late callback.
5. **Moderate — `libs/backend/memory-curator/src/lib/control/indexing-control.service.ts:617`.** `trackBackgroundRun` derives fingerprint and SHA before joining. A filesystem failure there rejects without a census, so no failed `lastRun` or `INDEXING_FAILED` exists; the boot lifecycle only logs at `boot-thoth-runtime.ts:523`. Record a failed background attempt or expose a fixed failure status.

## Acceptance criteria check

- **Batch 9:** Migration **0070**, superseding the plan's 0066/0067, adds nullable TEXT at `migrations/0070_indexing_last_run.ts:3`; `migrations/index.ts:477` registers it after 0069; `0070_indexing_last_run.spec.ts:16` checks preservation of existing rows. Max-version assertions were not exhaustively counted.
- **Batch 10:** Running/last-run wire fields at `rpc-indexing.types.ts:45`; `INDEXING_FAILED` at `message-constants.ts:292`; fixed-text activity at `back-office-activity.service.ts:502`. Every `IndexingStatus` field at `indexing-control.service.ts:48` is mapped by `toStatusWire` at `indexing-rpc.handlers.ts:47`, including optional `fileCount`.
- **Batch 11:** Normalized-root join at `indexing-control.service.ts:655`; identity-checked final removal at `:744`; one terminal write/push at `:762`; background wrapper at `:613`. Findings 1, 2, 4, and 5 limit failure and race honesty.
- **A-F6:** Final release removes the record for every outcome at `indexing-control.service.ts:744`; pause returns without a write at `:779`. Tests at `indexing-control.service.spec.ts:1397` and `:1443` cover cancel, fresh manual census, and pause.
- **A-F7:** `indexing-control.service.spec.ts:1275` asserts background-first/manual-second failure yields one failed write, one failed push, and background origin.
- **Batch 12:** `boot-thoth-runtime.ts:99` wraps lifecycle indexing; `:488` returns user-run stats. `indexing-rpc.handlers.ts:47` maps status and `:163` refuses duplicate manual starts while allowing background joins.
- **Batch 15:** `spec-extractor.ts:78` accepts suffixed reviews, `:139` bold verdicts, `:327` review mtime, `:303` task status. `skill-task-grade.store.ts:118` guards workspace ownership and `:198` scopes lookup. Finding 3 affects grade classification.
- **Batch 16:** `skill-invocation-event.store.ts:196` reconciles by task and normalized workspace, excludes NULL roots, and uses a guarded transactional update at `:230`. `spec-harvester.service.ts:104` uses marker v3; `:148` reconciles finished tasks even with current markers; `:184` logs counts. Latest review mtime is used at `:215`, subject to finding 3.
- **Batch 17:** `skill-trigger.service.ts:158` passes auto origin and `:161` warns on failure; `skills-synthesis-rpc.handlers.ts:1121` passes manual origin.

## Five logic questions

1. **Silent failure:** Failed SQLite write is swallowed before a completion push (finding 1).
2. **Unexpected action:** Re-index during an older run's memory phase can leave an older last run visible (finding 2).
3. **Wrong answer from input:** A task-description or design-spec review can become a work grade (finding 3).
4. **Dependency failure:** Fingerprint derivation failure has no background census or failed push (finding 5).
5. **Unspecified case:** Requirements do not define which overlapping census owns persisted `lastRun`; use the newest-started census for the displayed summary (finding 2).

## Style notes

No `any` was found in the inspected service paths. Public package imports and typed wire boundaries are followed. Duplicate review classification at `spec-harvester.service.ts:212` is the material style issue.

## Decisions

- Accept 0070 as the canonical migration after the merge. The additive column is nullable; existing rows retain their values. Reversible before deployment.
- Prefer newest-started census for the single persisted last-run summary; record closure deliberately permits overlap. Reversible.
- Read-only scope: no Nx, npm, build, or tests were run. Scoped `ptah_get_diagnostics` was unavailable after a 45-second TypeScript check timeout, so no compiler pass is claimed.
