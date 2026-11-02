# Batch 3 report

## Tasks and evidence

- **3.1 Store column, conditional classification, join enrichment:** SQLite `columns` now includes `taskKindSource`/`task_kind_source`, so insert, update and decode round-trip the migrated column. SQLite and in-memory stores classify only a null kind with null/`unclassified` source; they return false for a missing or already classified/mapped/explicit row. Join enrichment uses SQL `COALESCE` or in-memory null coalescing, preserves existing identifiers, and returns true only when a value is filled. The key-value store wraps both mutations in its atomic snapshot write, so reloads retain them. The pipeline SQLite test fixture includes the new column. Existing SQLite row decoding maps old null values to `taskKindSource: null` through `LaneOutcomeRowSchema`.
- **3.2 Report effect and ID:** A deliverables report with a task kind replaces mapped/classified/unclassified provenance with `explicit`; an already explicit kind wins. A report without a kind preserves the row's kind and source. `deterministicReviewReportId(reviewedRunId, reviewerRunId)` returns the agreed `review:<reviewed>|<reviewer>` receipt key. The review effect remains verdict-only.

## Files touched

- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\sqlite-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\in-memory-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\store\key-value-lane-outcome.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\write\pipeline.test-support.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\libs\backend\lane-outcomes\src\lib\write\report-effect.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing\.ptah\specs\TASK_2026_857_f660\batch-03-report.md`

## Risks handled

- **R1:** The scoped verify failure is in the Batch 4 owned `sqlite-lane-outcome.store.spec.ts` fixture, not another lane's edits. It creates `lane_outcome_records` without the new column. I did not edit outside Batch 3 ownership.
- **R7:** B2's row schema and migration were already present. This batch changed only the store/effect files assigned to B3; no shared B7 files were changed.
- No request, prompt, brief, scope, assistant, deliverable or CLI output text was added to stored rows, receipts or logs. All new SQL binds values as parameters. No new lib-to-lib import was added.

## Verification tails

- `ptah_get_diagnostics` on all six changed source files: **0 errors, 0 warnings**, clean coverage.
- Required command: `npm run verify -- -p @ptah-extension/lane-outcomes 2>&1 | Select-Object -Last 40`; exit code **1**. Nx reported **2 tasks succeeded, 1 failed** (`lane-outcomes:test`). Jest reported **13 suites passed, 1 failed; 116 tests passed, 9 failed**. Every failed test was in `sqlite-lane-outcome.store.spec.ts`; its independent `fixture()` table lacks `task_kind_source`. No Batch 3 host typecheck was listed.

```text
> @ptah-extension/source@0.0.0 verify
> node scripts/verify.mjs -p @ptah-extension/lane-outcomes

[verify 2026-10-30T18:33:00.186Z] waiting for a slot: 2/2 held by pid 5032 [verify lint,test,typecheck (@ptah-extension/agent-sdk)] in D:\projects\ptah-extension\.claude-worktrees\lane-learning-routing since 2026-10-30T18:31:02.398Z; pid 42388 [verify lint,test,typecheck (@ptah-extension/chat-state)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T18:32:47.303Z (queue position 2)
[verify 2026-10-30T18:33:23.430Z] waiting on queued pid 33348 [verify test (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T18:32:28.941Z
[verify 2026-10-30T18:33:24.442Z] waiting for the newest run to settle before memory is measured (held by pid 33348 [verify test (@ptah-extension/chat)] in D:\projects\ptah-extension\.claude-worktrees\persistent-session-metrics since 2026-10-30T18:33:23.528Z)
[verify 2026-10-30T18:33:40.650Z] lock slot 0 acquired after 40s: verify lint,test,typecheck (@ptah-extension/lane-outcomes)
node.exe :
At line:1 char:1
+ & "C:\Program Files\nodejs/node.exe" "C:\Program Files\nodejs/node_mo ...
+ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
    + CategoryInfo          : NotSpecified: (:String) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError

NX   3 tasks: 2 succeeded, 1 failed
✖ nx run @ptah-extension/lane-outcomes:test
  full log: C:\Users\abdal\.nx\8b7110c7390b9603\cache\terminalOutputs\7918118687407845233
Re-run with --output-style=static to inline logs.
  Run duration:      1m 2s
  Cache:             0/2 hit (0%)
  Critical path:     46.2s (1 task)
  Recoverable time:  16.2s (26% of the run)

  Recommendations:
    - Increase parallelism to recover up to 16.2s → https://nx.dev/docs/concepts/ci-concepts/parallelization-distribution?utm_source=nx-cli&utm_medium=cli&utm_campaign=performance-report&utm_content=parallelization.
    - Drastically reduce your run duration by sharing a cache across your team and CI → https://cloud.nx.app/connect/RrnVXQtlOB.
[verify 2026-10-30T18:34:50.350Z] lock released after 69.7s, exit code 1
```

```text
FAIL lane-outcomes src/lib/store/sqlite-lane-outcome.store.spec.ts
SqliteError: table lane_outcome_records has no column named task_kind_source
Test Suites: 1 failed, 13 passed, 14 total
Tests:       9 failed, 116 passed, 125 total
```

## Decisions

- **Classification guard:** Chose `task_kind IS NULL` plus source null/`unclassified` over a kind-only guard. The Batch 3 quality requirement says classification must not overwrite explicit or mapped provenance; the added predicate enforces that even for inconsistent legacy rows. Reversible: yes.
- **Join update result:** Chose true only when a null field gets a non-null value, rather than true whenever a row matches. The interface promises whether enrichment occurred and the in-memory/SQLite implementations should agree. Reversible: yes.
- **Review ID:** Used the plan's deterministic `review:<reviewed>|<reviewer>` string on the existing receipt mechanism, rather than a new table or UUID. D-5 fixes this choice. Reversible: yes.

## Issues outside scope

- Batch 4 must add `task_kind_source TEXT` to the separate `libs/backend/lane-outcomes/src/lib/store/sqlite-lane-outcome.store.spec.ts` fixture before the full lane-outcomes test target can pass. That file is not in Batch 3's ownership.
- No host typecheck command was listed for Batch 3.
- No skill discovery mechanism was exposed in this lane; no skill was loaded.
