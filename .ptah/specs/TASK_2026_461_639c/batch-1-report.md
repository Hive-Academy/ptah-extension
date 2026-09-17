# Batch 1 report — TASK_2026_461_639c

Completed 2026-09-16 by the backend-developer lane.

## Tasks completed

- Task 1.1: manual promotion path and fail-closed `write-failed` decision.
- Task 1.2: creation-time synthetic invocation removal.
- Task 1.3: evidence-only prefilter, skill-synthesis-side dead-setting removal, and corpus harness update.

## Files

Created:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\eligibility\session-work-evidence.ts` — pure edit/tool/test evidence predicate.
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\eligibility\session-work-evidence.spec.ts` — isolated signal, absent-signal, and threshold-edge coverage.

Modified:

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\prefilter-corpus-measurement.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\gates\cluster-holdout-end-to-end.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\gates\judge-panel.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-cluster-dedup.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-clustering.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-curator.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-enhancer.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-invocation-tracker.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-judge.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.repropagation.spec.ts`

No persistence-sqlite or Batch 2 file was edited by this lane.

## Stack observed

- Node 24, TypeScript 5.9, Nx 22.6.5 from `package.json`, `.nvmrc`, and `nx.json`.
- Product-side DI is tsyringe; this batch adds no injection or registration.
- `SkillSynthesisService` remains the façade. `SkillPromotionService` now has one private gate pipeline; public automatic and manual methods select only whether the recurrence threshold applies.
- The predicate accepts an already-extracted, internally trusted `ExtractedTrajectory`; no new external boundary or validation requirement was introduced.

## Implementation evidence and edge cases

- Manual promotion skips only `successesToPromote`; status, active embedding duplicate, cluster duplicate, judge, replay, residency cap, SKILL.md write, status write, and repropagation remain in the shared order.
- A writer exception returns `{ promoted: false, reason: 'write-failed' }` on automatic and manual paths, leaves the candidate row in `candidate`, and does not call repropagation. The catch carries the required reported degradation marker.
- Zero-success manual promotion passes with a sufficient judge score. Specs also pin duplicate, below-judge-score, judge-unscored, below-replay-confidence, already-rejected, and residency-cap behavior.
- `SkillSynthesisService.promote` and every `promoteBulk` element call `promoteManually`; specs assert `evaluate` is never called by either manual façade.
- New candidate registration preserves `workspaceRoot: workspaceRoot || null` and makes zero `recordInvocation` calls.
- Conversation-only input (8 turns / 900 characters) is rejected as `noWork` and increments `prefilterRejected`. Edit-only, tool-only, and test-command-only input is accepted. A work-bearing trajectory below `MIN_ROLE_TURNS_FLOOR` remains `tooThin`.
- `skill-promotion.service.ts` is 764 physical lines, up from 722 only for the two public/private method signatures, documentation, and fail-closed return. `skill-synthesis.service.ts` shrank from 1,431 to 1,366 physical lines.

## Verification

The worktree has no `node_modules`. Commands used `D:\projects\ptah-extension\node_modules\.bin\nx.cmd` (the main-checkout dependency installation) from the worktree. The first Nx test attempt timed out after 124 seconds without output; the process check immediately afterward showed no surviving Node/Electron worker. Retrying with `NX_DAEMON=false` completed normally. Before test execution:

```text
NO_STALE_JEST_OR_NX_PROCESSES
```

### Test — one project

Command equivalent to the required run-many invocation:

```powershell
$env:NX_DAEMON='false'
& 'D:\projects\ptah-extension\node_modules\.bin\nx.cmd' run-many -t test -p '@ptah-extension/skill-synthesis' --outputStyle=static
```

Nx header and result (the installed Nx renders a singular project header rather than the numeric spelling):

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis

Test Suites: 6 skipped, 72 passed, 72 of 78 total
Tests:       37 skipped, 1494 passed, 1531 total
Snapshots:   0 total
NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

The six skipped suites are existing opt-in/environment suites; the new corpus measurement remains intentionally opt-in.

### Typecheck — two projects

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/rpc-handlers

> tsc --noEmit --project libs/backend/skill-synthesis/tsconfig.lib.json
> tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.lib.json

NX   Successfully ran target typecheck for 2 projects
```

### Lint — one project

Final rerun after removing this batch's only new warning:

```text
NX   Running target lint for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis

✖ 35 problems (0 errors, 35 warnings)
NX   Successfully ran target lint for project @ptah-extension/skill-synthesis
```

All 35 warnings are pre-existing in files this batch did not change (existing max-lines and test escape-hatch warnings). The first lint run had 36 warnings; the extra unused `no-console` suppression in the modified corpus harness was removed before this final run.

### Degradation audit

```text
degradation-audit: scanned 2850 file(s)
libs/backend/persistence-sqlite: 5 ok (baseline 5)
libs/backend/skill-synthesis: 6 ok (baseline 6)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

Exit code 0. No baseline update was run.

### Static diagnostics and formatting

```text
TypeScript diagnostics: Errors: 0 | Warnings: 0 — No issues found.
git diff --check -- libs/backend/skill-synthesis: exit 0
Prettier: all 17 owned source/spec files formatted successfully.
```

### XB1 both bindings

Not applicable. Batch 1 adds no real-SQLite spec and opens no SQLite connection, as stated in the batch verification section.

### Grep validations

The dead-setting/depth grep over TypeScript production/spec files returns only the opt-in phase-2 comparison:

```text
src/lib/prefilter-corpus-measurement.spec.ts:57: eligibilityMinTurns: 5
src/lib/prefilter-corpus-measurement.spec.ts:59: prefilterMinChars: 800
src/lib/prefilter-corpus-measurement.spec.ts:76-79: depthOk (OLD phase-2 predicate only)
```

`skill-synthesis.service.ts` contains no `contextId` or `recordInvocation` occurrence. A multiline search for a `recordInvocation({... contextId ...})` production call found none; its matches were the store declaration and store specs only. Other production `contextId` symbols belong to the real invocation-event/recorder path protected by XB4 and were not changed.

The library's `CLAUDE.md` still describes the removed depth branch. Batch 5 owns that file, so this lane did not edit it.

## Mutation proofs

Every mutation was applied only long enough to run its named focused spec, then restored with `apply_patch`. No mutation remains.

### AC2-mut — force the judge score gate to pass

Mutation: append `&& false` to the below-score condition.

Fail:

```text
FAIL skill-synthesis .../skill-promotion.service.spec.ts
SkillPromotionService › manual promotion path › keeps the judge score gate
Expected: "below-judge-score"
Received: "promoted"
Test Suites: 1 failed, 1 total
Tests:       1 failed, 51 skipped, 52 total
```

Restore:

```text
PASS skill-synthesis .../skill-promotion.service.spec.ts
Test Suites: 1 passed, 1 total
Tests:       51 skipped, 1 passed, 52 total
```

### AC3-mut — remove the automatic threshold decision

Mutation: append `&& false` to the `candidate.successCount < effectiveSuccessThreshold` condition.

Fail:

```text
FAIL skill-synthesis .../skill-promotion.service.spec.ts
SkillPromotionService › rejects below threshold (successCount < 3)
Expected: false
Received: true
Test Suites: 1 failed, 1 total
Tests:       1 failed, 51 skipped, 52 total
```

Restore:

```text
PASS skill-synthesis .../skill-promotion.service.spec.ts
Test Suites: 1 passed, 1 total
Tests:       51 skipped, 1 passed, 52 total
```

### AC6-mut — invert the tool-evidence comparison

Mutation: `toolUseCount >= threshold` to `toolUseCount < threshold`.

Fail:

```text
FAIL skill-synthesis .../eligibility/session-work-evidence.spec.ts
hasSessionWorkEvidence › accepts tool evidence alone
Expected: true
Received: false
Test Suites: 1 failed, 1 total
Tests:       1 failed, 7 skipped, 8 total
```

Restore:

```text
PASS skill-synthesis .../eligibility/session-work-evidence.spec.ts
Test Suites: 1 passed, 1 total
Tests:       7 skipped, 1 passed, 8 total
```

After each restore, `git diff --stat -- libs/backend/skill-synthesis` returned only the intended Batch 1 source/spec diff (15 tracked files; the two intended new eligibility files are untracked until the orchestrator commits). Searches for `false &&`, `&& false`, the inverted comparison, and the old fail-open promotion message returned no matches.

## Risks handled

- R-TL1: all eleven additional skill-synthesis fixtures listed in Deviation 3 were updated; full suite and typecheck pass.
- R-TL7: `promote` retains the `PromotionDecision` shape; rpc-handlers typecheck passes.
- R-TL8: `write-failed` is added only to the backend union; the wire remains `reason: string`.
- Conversation-only, floor, exact-threshold, writer-failure, mixed bulk routing, duplicate, judge-unscored, replay, and already-rejected edge cases are pinned by specs.
- XB2: the new fail-closed catch has the required in-zone reported marker; audit remains at 6/6.
- XB3: every Nx multi-project command uses `run-many -t ... -p ...`; project headers are above.
- XB4: tracker promotion, invocation-event promotion, extractor field names, generalization, and cross-session clustering were not changed.

## Plan deviations

None. The source matched the approved D1a/D2a/D3a/D4a/D5a/D6a plan for Batch 1.

## Out-of-scope observations

- The separate Batch 2 lane has concurrent changes under `libs/backend/persistence-sqlite`; they were neither edited nor used by this batch.
- The separate code-logic reviewer verdict is owned by the orchestrator's reviewer lane and is not fabricated in this executor report.

## Revise round 1

Revision completed 2026-09-16 in response to `code-logic-review-batch-1.md` (CHANGES_REQUESTED, 7/10).

### Fixes

1. **Residency demotion is now atomic with successful materialization.**
   - `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:274-292` selects the weakest eligible resident and its measured win rate without changing residency.
   - The SKILL.md write and fail-closed return remain at `:302-332`.
   - `setResidency(..., 'dormant')`, `evictedSkillId`, `demotedSlug`, and the demotion log now execute together only after the write succeeds at `:334-347`.
   - Consequently, `write-failed` returns before any residency mutation; `evictedSkillId` is undefined and no repropagation runs.
   - `libs/backend/skill-synthesis/src/lib/skill-promotion.service.spec.ts:1205-1248` now drives both automatic and manual write failures while already at the residency cap and asserts: candidate remains `candidate`, no promoted status write, `evictedSkillId` is undefined, `setResidency` is not called, and repropagation is not called.

2. **Manual cluster dedup is directly pinned.**
   - `libs/backend/skill-synthesis/src/lib/skill-promotion.service.spec.ts:285` supplies an embedding and a cluster deduplicator returning true.
   - It asserts `reason: 'duplicate'` and the exact status write `updateStatus('cand_test', 'rejected', { reason: 'cluster-duplicate' })`.

3. **Invalid prefilter numeric settings fall back safely.**
   - `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1276-1284` adds a local reader restricted to finite numbers greater than or equal to zero.
   - Only `prefilterMinEdits` (`:1312`) and `prefilterMinToolUses` (`:1316`) use it; no other setting was refactored.
   - `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.spec.ts:864` injects the string `"one"`, asserts fallback to the default `1`, and proves a one-edit/no-tool/no-test trajectory still registers a candidate.

### Residency ordering mutation proof

Mutation: move `setResidency(weakestResident.id, 'dormant')` back above `mdGenerator.promoteToActive`, removing it from the post-write block.

Fail:

```text
FAIL skill-synthesis libs/backend/skill-synthesis/src/lib/skill-promotion.service.spec.ts
SkillPromotionService › returns write-failed on the automatic path when SKILL.md materialization fails
SkillPromotionService › returns write-failed on the manual path when SKILL.md materialization fails

expect(jest.fn()).not.toHaveBeenCalled()
Expected number of calls: 0
Received number of calls: 1
1: "resident-0", "dormant"

Test Suites: 1 failed, 1 total
Tests:       2 failed, 51 skipped, 53 total
```

Restore:

```text
PASS skill-synthesis libs/backend/skill-synthesis/src/lib/skill-promotion.service.spec.ts
Test Suites: 1 passed, 1 total
Tests:       51 skipped, 2 passed, 53 total
Time:        9.849 s
```

After restore, `git diff --stat -- libs/backend/skill-synthesis` contained only the intended Batch 1 implementation/spec changes. `git diff --check -- libs/backend/skill-synthesis` exited 0. The only `setResidency(weakestResident.id, 'dormant')` occurrence is the restored post-write call at `skill-promotion.service.ts:335`.

### Verification after revision

Before both the focused test run and the full test run:

```text
NO_STALE_JEST_OR_NX_PROCESSES
```

The worktree still has no `node_modules`; commands used the main checkout's Nx/Jest binaries from the worktree, with `NX_DAEMON=false` for Nx.

#### Test — one project

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis

Test Suites: 6 skipped, 72 passed, 72 of 78 total
Tests:       37 skipped, 1496 passed, 1533 total
Snapshots:   0 total
Time:        62.851 s

NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

The installed Nx renders the one-project header in singular form rather than as `for 1 project`.

#### Typecheck — two projects

```text
NX   Running target typecheck for 2 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/rpc-handlers

> tsc --noEmit --project libs/backend/skill-synthesis/tsconfig.lib.json
> tsc --noEmit --project libs/backend/rpc-handlers/tsconfig.lib.json

NX   Successfully ran target typecheck for 2 projects
```

#### Lint — one project

```text
NX   Running target lint for project @ptah-extension/skill-synthesis:
- @ptah-extension/skill-synthesis

✖ 35 problems (0 errors, 35 warnings)
NX   Successfully ran target lint for project @ptah-extension/skill-synthesis
```

The 35 warnings are the same pre-existing max-lines and test escape-hatch warnings documented in the initial report; none points to revision code except the pre-existing soft max-lines warning on the already oversized facade.

#### Degradation audit

```text
degradation-audit: scanned 2850 file(s)
libs/backend/persistence-sqlite: 5 ok (baseline 5)
libs/backend/skill-synthesis: 6 ok (baseline 6)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

Exit code 0. No baseline update was run. XB1 remains not applicable because Batch 1 adds no real-SQLite spec.

#### Additional checks

```text
Focused promotion/synthesis suites: 3 passed, 125 tests passed
TypeScript diagnostics: Errors: 0 | Warnings: 0
Prettier: 4 revised files formatted successfully
git diff --check -- libs/backend/skill-synthesis: exit 0
```
