## Backend implementation — `TASK_2026_461_639c`, batch 4

**Tasks completed**: 4.1 `SkillBacklogCleanupStore`; 4.2 `SkillBacklogCleanupService` and report/state types; 4.3 real-SQLite integration coverage through migration 0045; 4.4 rejected-candidate gate skips.

**Files**:

- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts` — cleanup state, counter, option, report, candidate, and rejection contracts.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.store.ts` — singleton state persistence, ordered candidate paging, guarded transactional rejection, and paged fake-invocation deletion.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.store.spec.ts` — real-SQLite paging, state, guard, rollback, and invocation-preservation coverage.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts` — gated, resumable, bounded cleanup with verdict/evidence preservation and fail-open reporting.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts` — all gate tokens, D4(a) branches, queue transcript fallback, time budget, and failure-report coverage.
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.integration.spec.ts` — every relational migration through 0045, real stores and extractor, exact candidate outcomes/counters, invocation cleanup, and second-run idempotence.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\queue\stage-handlers.service.ts` — maps rejected targets to `gate-candidate-rejected` before any gate dispatch; promoted candidates remain gradeable.
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.stage-handlers.spec.ts` — one rejected case per gate plus a promoted-candidate positive control.

No DI token, registration file, or public barrel was changed. The forbidden-edit check over `di/register.ts`, `di/tokens.ts`, and `src/index.ts` returned no paths.

**Stack observed**: TypeScript 5.9 / Nx 22.6 from the root manifest and `CLAUDE.md`; tsyringe decorators with product-side ports from `platform-core`; injected `SqliteConnectionService` and the repository `SqliteDatabase` abstraction from `skill-queue.store.ts`; Zod remains at external RPC boundaries and no new external boundary was added. The cleanup services are constructed by hand in specs and have no DI registration/token, per the batch constraint.

## Implementation and risk handling

- **V3 / guarded reject parity**: the batch update writes exactly `status='rejected'`, `rejected_at`, and `rejected_reason`, matching `SkillCandidateStore.updateStatus`. `AND status='candidate'` protects a row promoted/rejected after paging.
- **V4 / one-time durable state**: singleton `id=1`; initialization first attempts an in-place full reset and otherwise inserts every NOT NULL field. Subsequent writes are UPDATE-only. `version`, `cutoff_created_at`, and `started_at` are never omitted from a full initialization. The reason column is `last_reason`, never `last_error`.
- **A3 / writer audit**: production grep found one writer only:

  ```text
  > rg -n "INSERT INTO skill_invocations" libs/backend/skill-synthesis/src/lib -g '*.ts' -g '!*.spec.ts' -g '!*.test.ts' -g '!*.test-support.ts'
  libs/backend/skill-synthesis/src/lib\skill-candidate.store.ts:939:      `INSERT INTO skill_invocations
  ```

- **R1 / irreversible cleanup**: only rows strictly older than the first-run cutoff are examined. Any verdict protects the candidate; degraded verdicts have their own counter. Any session with edit/tool/test evidence protects the candidate. Rejection reasons distinguish readable conversation-only transcripts from unreadable/missing transcripts.
- **R-TL4 / bounded work**: 100-candidate pages, a 200-candidate tick cap, a 60-second wall budget checked between candidates, and 500-row invocation-delete pages. Cursor persistence happens after each committed candidate batch.
- **R-TL6 / races and rollback**: rejection is one explicit `BEGIN IMMEDIATE` / `COMMIT` transaction, with `ROLLBACK` on throw. The real-SQLite spec proves both rollback and the status guard.
- **XB1 / SQLite bindings**: all named SQL parameters are bound on every path. Cleanup suites pass under Node's `node:sqlite` and Electron-as-Node `better-sqlite3`, with zero skipped tests.
- **XB2 / degradation audit**: the per-candidate catch and whole-run catch carry `degradation-audit: reported` markers inside each catch's leading-comment zone. The historical JSON parse fallback carries an `optional-capability` marker. Final skill-synthesis count is 6, equal to baseline.
- **XB3 / Nx invocation correctness**: every multi-project verification used `run-many`; observed headers were 1 project (singular header), 2 projects, and 1 project (singular header).
- **XB4 / phase boundary**: no automatic promotion, invocation-event promotion, new lane, enqueue, LLM call, DI registration, or phase-5 behavior was introduced.

## Verification

Before every Jest/Nx verification, active `jest-worker`, `nx run-many`, `nx.js run-many`, and `run-executor` processes were checked. Runs were held whenever the Batch 3 lane was active. `NX_DAEMON=false` was used for Nx commands, binaries came from `D:\projects\ptah-extension\node_modules`, and `nx reset` was never run.

### Required run-many targets

1. `NX_DAEMON=false nx run-many -t test -p @ptah-extension/skill-synthesis --output-style=static`

   ```text
   NX   Running target test for project @ptah-extension/skill-synthesis:
   - @ptah-extension/skill-synthesis

   Test Suites: 6 skipped, 75 passed, 75 of 81 total
   Tests:       37 skipped, 1514 passed, 1551 total
   Snapshots:   0 total
   Time:        96.451 s

   NX   Successfully ran target test for project @ptah-extension/skill-synthesis
   ```

   Exit 0. Nx uses the singular header for a one-project run. The repository emitted its existing forced worker-exit warning after all suites completed.

2. `NX_DAEMON=false nx run-many -t typecheck -p @ptah-extension/skill-synthesis @ptah-extension/rpc-handlers --output-style=static`

   ```text
   NX   Running target typecheck for 2 projects:
   - @ptah-extension/skill-synthesis
   - @ptah-extension/rpc-handlers

   NX   Successfully ran target typecheck for 2 projects
   ```

   Exit 0; 2 passed, 0 failed.

3. `NX_DAEMON=false nx run-many -t lint -p @ptah-extension/skill-synthesis --output-style=static`

   ```text
   NX   Running target lint for project @ptah-extension/skill-synthesis:
   - @ptah-extension/skill-synthesis

   ✖ 35 problems (0 errors, 35 warnings)
   NX   Successfully ran target lint for project @ptah-extension/skill-synthesis
   ```

   Exit 0. All 35 warnings are existing max-lines / legacy-spec warnings; none points to a Batch 4 file.

### XB1 both-binding cleanup runs

Node / `node:sqlite`:

```text
> node D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup"' --runInBand --no-cache
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        24.193 s
Ran all test suites matching skill-backlog-cleanup.
```

Electron-as-Node / `better-sqlite3`:

```text
> ELECTRON_RUN_AS_NODE=1 D:\projects\ptah-extension\node_modules\.bin\electron.cmd D:\projects\ptah-extension\node_modules\jest\bin\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-backlog-cleanup"' --runInBand --no-cache
Test Suites: 3 passed, 3 total
Tests:       14 passed, 14 total
Snapshots:   0 total
Time:        18.352 s
Ran all test suites matching skill-backlog-cleanup.
```

Both runs: 0 skipped.

### Gate-stage focused run

```text
> node ...\jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns '"skill-synthesis.stage-handlers"' --runInBand --no-cache
Test Suites: 1 passed, 1 total
Tests:       44 passed, 44 total
Snapshots:   0 total
Time:        25.612 s
```

### Degradation audit

The first audit correctly caught the new unannotated historical-JSON fallback:

```text
libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.store.ts:239 [catch-return-sentinel]
libs/backend/skill-synthesis: 7 FAIL (baseline 6)
```

After adding the required in-catch marker, the restored run was:

```text
> NX_DAEMON=false nx run degradation-audit:lint --output-style=static
degradation-audit: scanned 2853 file(s)
libs/backend/skill-synthesis: 6 ok (baseline 6)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

Exit 0; no baseline update.

### Mutation evidence

**AC8-mut — removed `context_id IS NOT NULL`**

Failure:

```text
FAIL .../skill-backlog-cleanup.store.spec.ts
SkillBacklogCleanupStore › deletes only fake invocations in bounded pages
Expected: 0
Received: 1
Test Suites: 1 failed, 1 total
Tests:       1 failed, 4 passed, 5 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

**AC9-mut — removed the wall-budget check**

Failure:

```text
FAIL .../skill-backlog-cleanup.service.spec.ts
SkillBacklogCleanupService › returns partial at the wall budget and resumes from the committed cursor
Expected reason: "time-budget"
Received reason: "row-budget"
Test Suites: 1 failed, 1 total
Tests:       1 failed, 7 passed, 8 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       8 passed, 8 total
```

**AC7-mut — removed the service's batch-reject call**

Failure:

```text
FAIL .../skill-backlog-cleanup.integration.spec.ts
skill backlog cleanup integration › cleans the historical backlog once and preserves real invocation telemetry
Expected: status "rejected", rejectedReason "backlog-cleanup: no code evidence and no verdict"
Received: status "candidate", rejectedReason null
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

**AC11-mut — removed the rejected-status check from `gateTarget`**

Failure:

```text
FAIL .../skill-synthesis.stage-handlers.spec.ts
Expected skippedItems: 1
Received skippedItems: 0

Failures:
- skips a rejected candidate before dispatching the judge-panel gate
- skips a rejected candidate before dispatching the replay gate
- skips a rejected candidate before dispatching the trigger-eval gate

Test Suites: 1 failed, 1 total
Tests:       3 failed, 41 passed, 44 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       44 passed, 44 total
```

After every restoration, `git diff --stat` showed the shared-worktree tracked diff only and no mutation residue:

```text
.../src/specs/thoth/skills.spec.ts                 |  2 -
.../platform-core/src/file-settings-keys.ts        |  4 --
.../handlers/skills-synthesis-rpc.handlers.spec.ts |  2 -
.../handlers/skills-synthesis-rpc.schema.spec.ts   | 17 +++++-
.../lib/handlers/skills-synthesis-rpc.schema.ts    |  2 -
.../src/lib/queue/stage-handlers.service.ts        | 16 +++++-
.../src/lib/skill-synthesis.stage-handlers.spec.ts | 61 ++++++++++++++++++++++
.../skill-settings-panel.component.spec.ts         |  2 -
.../components/skill-settings-panel.component.ts   | 20 -------
.../skill-synthesis-tab.component.spec.ts          |  2 -
.../components/skill-synthesis-tab.component.ts    |  2 -
.../thoth/skills-lane-pickers.e2e.spec.ts          |  2 -
libs/shared/src/lib/types/rpc.types.ts             |  2 -
13 files changed, 90 insertions(+), 44 deletions(-)
```

The six new cleanup files are untracked and therefore do not appear in plain `git diff --stat`; `git status --short` lists `?? libs/backend/skill-synthesis/src/lib/cleanup/`.

### Final hygiene

```text
git diff --check
```

The source-only run before report creation exited 0 with no output. A final shared-worktree rerun after the concurrent Batch 3 report landed reported only `.ptah/specs/TASK_2026_461_639c/agent-output-root.md:136: new blank line at EOF`; that file is owned by Batch 3 and was not edited here. Ptah TypeScript diagnostics over the three Batch 4 production files: `Errors: 0 | Warnings: 0`.

**Plan deviations**: None. The integration harness was strengthened to apply every relational migration with a defined SQL body through version 45, not only the skill-synthesis subset.

**Out-of-scope observations**: Batch 3 concurrently owns and modified platform-core, rpc-handlers, shared, frontend UI/e2e, and Electron e2e files visible in the shared worktree. Those edits were preserved and not changed by Batch 4. Existing lint warnings and the Jest forced-worker-exit warning remain.

## Revise round 1

Independent review result addressed: `CHANGES_REQUESTED 7/10`. Finding 2 (distinguishing `EBUSY` from `ENOENT` in `TrajectoryExtractor`) remains the explicitly accepted phase risk and was not changed.

### Changed files

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts:25` — introduced the report-only `BacklogCleanupRunCounters` shape and `deferredOnError`; migration 0045 and persisted counters remain unchanged.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:58` — tracks persisted state plus the per-run deferred counter so failed reports retain committed counters.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:194` — any candidate-evaluation exception now yields `deferred-error`, advances the durable cursor without rejecting the candidate, increments `deferredOnError`, and emits the required candidate-id/error warning. The XB2 leading catch comment explicitly states the deferral and both reporting paths.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:265` — empty/degraded `sourceSessionIds` warns exactly once with only `candidateId`; its D4a unreadable outcome is unchanged.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:284` — an empty candidate workspace root now falls back to the prefilter queue row before deciding whether to skip extraction.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:308` — the fake-invocation loop checks abort and wall budget before every deletion page, persists each completed page with `finishedAt: null`, and returns resumable `partial` state on a stop.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:414` — completed, partial, and failed reports use committed counters accumulated so far plus the run-only deferral count.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:264` — added the transient verdict-read deferral regression and warning assertion.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:307` — added the candidate-id-only unusable-source warning case.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:322` — changed the queue-root fallback proof to an empty candidate root.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:358` — added abort-between-candidates, committed-rejection coverage.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:395` — added wall-budget partial plus second-run cursor-resume coverage.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:442` — added the greater-than-200 row-budget case.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:486` — added the between-delete-pages stop case proving no completed write.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts:525` — added the whole-run failure case proving previously committed counters are reported.

No DI token, registration, public barrel, migration, extractor, or file outside the cleanup directory was changed in this revision.

### Mutation evidence

**Deferral regression mutation — restored `disposition = 'reject-unreadable'` in the candidate catch**

Failure:

```text
FAIL skill-synthesis .../skill-backlog-cleanup.service.spec.ts
SkillBacklogCleanupService › defers a candidate whose verdict lookup throws and continues the page
Expected rejectedTranscriptUnreadable: 0
Received rejectedTranscriptUnreadable: 1
Test Suites: 1 failed, 1 total
Tests:       1 failed, 13 passed, 14 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
Snapshots:   0 total
```

**AC7-mut — removed `this.store.rejectBatch(rejections, now())`**

Failure:

```text
FAIL skill-synthesis .../skill-backlog-cleanup.integration.spec.ts
skill backlog cleanup integration › cleans the historical backlog once and preserves real invocation telemetry
Expected status: "rejected", rejectedReason: "backlog-cleanup: no code evidence and no verdict"
Received status: "candidate", rejectedReason: null
Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
Snapshots:   0 total
```

**AC9-mut — disabled the wall-budget branch in `stopReason`**

Failure:

```text
FAIL skill-synthesis .../skill-backlog-cleanup.service.spec.ts
SkillBacklogCleanupService › returns partial at the wall budget and the next run resumes to completion
Expected status/reason/examined: partial/time-budget/1
Received status/reason/examined: completed/null/2
Test Suites: 1 failed, 1 total
Tests:       1 failed, 13 passed, 14 total
```

Restored:

```text
Test Suites: 1 passed, 1 total
Tests:       14 passed, 14 total
Snapshots:   0 total
```

After every mutation restoration, plain `git diff --stat` showed the same shared tracked diff (14 files, 225 insertions, 46 deletions) and no mutation residue. The Batch 4 cleanup directory remains untracked as a directory, so its contents do not appear in plain `git diff --stat`.

### Verification

Every test/Nx invocation was preceded by a Jest/Nx process check. Two unrelated active lanes were observed and allowed to finish before verification resumed. Nx used `NX_DAEMON=false` and binaries from `D:\projects\ptah-extension\node_modules`; `nx reset` was not run.

**XB1 — Node `node:sqlite` binding**

```text
> node jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns 'skill-backlog-cleanup' --runInBand --no-cache
Test Suites: 3 passed, 3 total
Tests:       20 passed, 20 total
Snapshots:   0 total
```

**XB1 — Electron-as-Node `better-sqlite3` binding**

```text
> ELECTRON_RUN_AS_NODE=1 electron.cmd jest.js --config libs/backend/skill-synthesis/jest.config.ts --testPathPatterns 'skill-backlog-cleanup' --runInBand --no-cache
Test Suites: 3 passed, 3 total
Tests:       20 passed, 20 total
Snapshots:   0 total
```

Both binding runs had zero skipped tests.

**Required run-many test (1 project)**

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis
Test Suites: 6 skipped, 75 passed, 75 of 81 total
Tests:       37 skipped, 1520 passed, 1557 total
Snapshots:   0 total
NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

**Required run-many typecheck (2 projects)**

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/rpc-handlers
NX   Successfully ran target typecheck for 2 projects
```

**Required run-many lint (1 project)**

```text
NX   Running target lint for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis
✖ 35 problems (0 errors, 35 warnings)
NX   Successfully ran target lint for project @ptah-extension/skill-synthesis
```

All 35 warnings are pre-existing and outside the cleanup files.

**XB2 degradation audit**

```text
degradation-audit: scanned 2853 file(s)
libs/backend/skill-synthesis: 6 ok (baseline 6)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

The skill-synthesis total is 6, satisfying the required maximum of 6 without changing the baseline.

**A3 writer grep**

```text
> rg -n "INSERT INTO skill_invocations" libs/backend/skill-synthesis/src/lib -g '*.ts' -g '!*.spec.ts' -g '!*.test.ts' -g '!*.test-support.ts'
libs/backend/skill-synthesis/src/lib\skill-candidate.store.ts:939:      `INSERT INTO skill_invocations
```

Result: one production writer remains.

### Risk handling

- Transient shared-database read failures are fail-open at candidate granularity: the candidate stays `candidate`, the cursor advances, and the run report/warning exposes the deferral.
- Stops between candidates commit only the already evaluated batch; stops between deletion pages persist the completed deletion count with `finishedAt: null` so a later run resumes safely.
- The cutoff, singleton state, guarded rejection transaction, bounded candidate/delete page sizes, and both SQLite bindings remain covered.
- Corrupt/empty source-session data is observable without logging its contents; only the candidate id is emitted.
- A failed outer run reports the most recently committed counters, avoiding a misleading all-zero report.

**Plan deviations**: None.

**Out-of-scope observations**: The accepted `TrajectoryExtractor` `EBUSY`/`ENOENT` ambiguity remains unchanged for this phase. Shared Batch 3 tracked edits shown by `git diff --stat` were preserved.
