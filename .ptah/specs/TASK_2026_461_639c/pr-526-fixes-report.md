# PR #526 CodeRabbit fixes — TASK_2026_461_639c

All seven findings were verified against HEAD `d0731ee8c` and were valid. C1–C4 were fixed in production code and pinned by regression specs; C5–C7 were corrected in the task documents. No migration, dependency registration, baseline, batch breakdown, commit, stage, or push was changed.

## C1 — atomic promotion and compensating file removal

Valid. Promotion wrote the active `SKILL.md`, demoted the weakest resident, and promoted the candidate through independent writes.

- `libs/backend/skill-synthesis/src/lib/skill-candidate.store.ts:467` adds `promoteAtomically`, using explicit `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`. The optional resident demotion and guarded candidate promotion are in one transaction, and every named SQL parameter is bound.
- `libs/backend/skill-synthesis/src/lib/skill-promotion.service.ts:317` uses the atomic store method. The existing reported catch at `:322` removes the materialized file through `SkillMdGenerator.removeActive`, logs a warning, returns `write-failed`, omits `evictedSkillId`, and does not repropagate.
- `libs/backend/skill-synthesis/src/lib/skill-md-generator.ts:205` adds the smallest promotion-owned removal API.
- Specs: `skill-candidate.store.spec.ts:228` uses real SQLite plus an aborting trigger to prove a failed status update rolls the demotion back; `skill-promotion.service.spec.ts:1261` proves active-file removal, `write-failed`, no eviction id, and no repropagation. `skill-promotion.repropagation.spec.ts:85` updates the existing fixture to model the atomic store contract.
- The earlier invariant remains: when `promoteToActive` itself throws, the atomic store method is never called, so residency does not change.

## C2 — bounded backlog-cleanup retry

Valid. The previous catch counted `deferred-error` and advanced the cursor past the failed candidate.

- `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.service.ts:76` adds a singleton in-memory failure-attempt map keyed by candidate id.
- At `:220`, attempts 1 and 2 stop the tick before the failed candidate. Rejections and counters before it are committed and the cursor advances only to the preceding candidate (`:254`). The run returns `partial` / `deferred-error` (`:274`).
- Attempt 3 deletes the retry entry, counts `deferredOnError`, warns once, and advances, so the process cannot wedge forever.
- `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.types.ts:13` adds the stop-reason token. The thoth-runtime job already forwards arbitrary typed partial reasons into its summary, so no job change was needed.
- Specs: first failure/retry-success at `skill-backlog-cleanup.service.spec.ts:522`; third-failure fallback at `:574`; same-page predecessors committed at `:619`.

## C3 — positive prefilter thresholds

Valid. Both settings readers accepted zero, and the RPC schema allowed it.

- `libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:1276` replaces the non-negative helper with `getPositiveFiniteNumber`; both thresholds now require a finite number `>= 1` or use `SETTINGS_DEFAULTS` (`:1312`).
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.ts:39` makes both fields integer `min(1)`.
- Specs: service zero-fallback plus no-work rejection at `skill-synthesis.service.spec.ts:905`; schema rejects 0 and accepts 1 for each key at `skills-synthesis-rpc.schema.spec.ts:133`.
- UI check: `skill-synthesis-tab.component.ts:788` defines the form without validators for any numeric field. C3 asked for a UI validator only if numeric validators already existed, so the frontend was intentionally not changed. The HTML inputs likewise had no existing validation convention to extend.

## C4 — closed cleanup reason union

Valid. `libs/backend/skill-synthesis/src/lib/cleanup/skill-backlog-cleanup.types.ts:69` is now `BacklogCleanupStopReason | null`; all producers typecheck with the added `deferred-error` member.

## C5 — MD041 report headings

Valid. `.ptah/specs/TASK_2026_461_639c/batch-3-report.md:1` and `batch-4-report.md:1` now begin with level-1 headings.

## C6 — fenced-code spacing and languages

Valid. Every fence in `.ptah/specs/TASK_2026_461_639c/test-report.md` now has a blank line outside the fence and every opening fence is labeled `text`. Opening/closing fence lines after the fix: 41/49, 129/139, 148/152, 162/166, 189/196, 237/241, and 306/308. Code-block contents were not changed.

## C7 — non-MCP evidence documentation

Valid. `.ptah/specs/TASK_2026_461_639c/implementation-plan.md:203` now defines tool evidence with `nonMcpToolUseCount`; `:594` updates R2 to the non-MCP predicate and states that the change came from the Batch 7 measurement and user decision 1.

## Mutation evidence

### C1-mut — transaction removed

Temporary mutation: replaced the `inImmediateTransaction` wrapper with the two direct writes.

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
Test Suites: 1 failed, 1 total
Tests:       1 failed, 80 passed, 81 total
Expected: "resident"
Received: "dormant"
FAIL SkillCandidateStore › promoteAtomically › rolls back residency demotion when promotion status write fails
```

The transaction was restored immediately.

### C2-mut — advance on first failure

Temporary mutation: changed the bounded-retry branch so the first failure fell through to the old advance-and-count behavior.

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
Test Suites: 1 failed, 1 total
Tests:       3 failed, 22 passed, 25 total
First-failure expected: partial / deferred-error / examined 0
Received: completed / reason null / examined 2
```

The retry branch was restored immediately.

### Restored green and diff

```text
NX   Running target test for project @ptah-extension/skill-synthesis:
Test Suites: 2 passed, 2 total
Tests:       106 passed, 106 total

17 files changed, 572 insertions(+), 183 deletions(-)
```

No mutation remains. `git diff --check` exits 0.

## Verification outputs

### Required run-many test

First parallel pass exposed the stale repropagation fixture and a load timeout in an unrelated RPC voice spec. The fixture was fixed; the voice spec passed 58/58 in isolation. The required command was then rerun serially:

```text
NX   Running target test for 4 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/rpc-handlers
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine

skill-synthesis: Test Suites 76 passed, 6 skipped (82 total); Tests 1544 passed, 37 skipped (1581 total)
rpc-handlers:    Test Suites 101 passed, 101 total; Tests 3018 passed, 33 skipped (3051 total)
thoth-runtime:   Test Suites 6 passed, 6 total; Tests 100 passed, 100 total
cli-engine:      Test Suites 19 passed, 19 total; Tests 190 passed, 190 total

NX   Successfully ran target test for 4 projects
```

### Required run-many lint

```text
NX   Running target lint for 4 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/rpc-handlers
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine

NX   Successfully ran target lint for 4 projects
```

Exit 0. Existing warnings remain (skill-synthesis 35, rpc-handlers 19, cli-engine 1; thoth-runtime clean); no lint errors.

### Required run-many typecheck

```text
NX   Running target typecheck for 7 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/rpc-handlers
- @ptah-extension/thoth-runtime
- @ptah-extension/cli-engine
- @ptah-extension/agent-sdk
- ptah-electron
- ptah-cli

NX   Successfully ran target typecheck for 7 projects
```

### SQLite binding matrix

Exact pattern: `"skill-candidate.store|skill-backlog-cleanup|session-transcript-locator|skill-synthesis.reachability"`.

```text
node:sqlite via run-many
NX   Running target test for project @ptah-extension/skill-synthesis:
Test Suites: 6 passed, 6 total
Tests:       130 passed, 130 total
Skipped:     0

better-sqlite3 via Electron-as-Node + jest.js
Test Suites: 6 passed, 6 total
Tests:       130 passed, 130 total
Skipped:     0

reachability-only node:sqlite confirmation
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
Skipped:     0
```

The combined better-sqlite3 run includes the same reachability suite and has 0 skipped; reachability remains 5/5.

### Degradation audit

The first audit found an orphaned C2 suppression because retry bookkeeping preceded the marker. Moving the existing reported marker back into the catch leading-comment zone restored the baseline; no baseline file was changed.

```text
NX   Running target lint for project degradation-audit
libs/backend/skill-synthesis: 6 ok (baseline 6)
libs/backend/cli-engine: 12 ok (baseline 12)
libs/backend/rpc-handlers: 1 ok (baseline 1)
libs/backend/agent-sdk: 4 ok (baseline 4)
libs/backend/thoth-runtime: absent from totals = 0
NX   Successfully ran target lint for project degradation-audit
```

## Absolute files changed

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-candidate.store.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-candidate.store.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-md-generator.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.repropagation.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\rpc-handlers\src\lib\handlers\skills-synthesis-rpc.schema.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\batch-3-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\batch-4-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\test-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\implementation-plan.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\pr-526-fixes-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\agent-output-root.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\pr-526-fixes.done`

## Plan deviations and out-of-scope observations

- No implementation-plan deviation. The settings UI was not touched because its numeric fields have no validator convention, matching C3's conditional instruction.
- The initial full RPC run had one load-sensitive `voice-rpc.handlers.spec.ts` timeout; the isolated rerun passed 58/58 and the serial full rerun passed 3018 tests.
- Existing lint warnings and Jest worker force-exit warnings remain out of scope.

## Revise round 1

### S1/F1 — rollback cleanup failure is contained

Valid. `SkillMdGenerator.removeActive` was called directly inside the persistence-failure catch, so its own exception could replace the intended `write-failed` result.

- Fix: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.ts:324` now wraps rollback cleanup in `try/catch (error: unknown)`. The inner catch logs candidate id, materialized slug and narrowed error text at lines 327-337, carries a reported degradation-audit marker in the catch's leading-comment zone, and allows the outer path to return `write-failed` without an `evictedSkillId` or repropagation.
- Spec: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.spec.ts:1301` forces both `promoteAtomically` and `removeActive` to throw; it proves the promise resolves to `write-failed`, two warnings are emitted, cleanup context is reported, and repropagation is not called.

### F3 — settings form enforces the RPC minimum

Valid. The RPC schema rejected zero, while both Angular controls remained valid and allowed the save request to reach the generic error path.

- Fix: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts:798` and `:799` add `Validators.min(1)` to `prefilterMinEdits` and `prefilterMinToolUses`. This form did not use `Validators.required` for its numeric settings and the settings panel had no field-error rendering convention, so neither was introduced. OnPush, signals and the existing `settingsForm.valid` save gate are unchanged.
- Specs: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts:803` proves zero makes each control path invalid and prevents `updateSettings`; `:837` proves one is valid for both controls.

### F2 — retry lifetime is explicit

Valid as a documentation gap; runtime behavior was already the requested bounded, process-local retry policy.

- Fix: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts:76` documents that the singleton attempt map resets on process restart and a permanently failing candidate can stop two additional ticks.
- Fix: `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts:11` documents the same process-local semantics on the `deferred-error` stop reason.
- Specs: none added because this finding requested documentation only and no behavior changed; the full skill-synthesis suite covers the existing retry behavior.

### S1-mut evidence

Mutation applied: replaced the inner cleanup `try/catch` with a direct `removeActive(materialized)` call.

```text
NX   Running target test for project @ptah-extension/skill-synthesis failed
SkillPromotionService › returns write-failed when both atomic promotion and rollback cleanup fail
Received promise rejected instead of resolved
Rejected to value: [Error: forced cleanup failure]
Test Suites: 1 failed, 1 total
Tests:       1 failed, 54 passed, 55 total
S1_MUT_EXIT=1
```

The inner guard was restored immediately. The subsequent required two-project test run was green, including the restored promotion suite. No mutation remains; `git diff --check` exits 0.

### Verification

Focused checks before mutation:

```text
NX   Successfully ran target test for project @ptah-extension/skill-synthesis
Test Suites: 1 passed, 1 total
Tests:       55 passed, 55 total

NX   Successfully ran target test for project @ptah-extension/skill-synthesis-ui
Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
```

Required test run after mutation restore:

```text
NX   Running target test for 2 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/skill-synthesis-ui

@ptah-extension/skill-synthesis-ui
Test Suites: 27 passed, 27 total
Tests:       433 passed, 433 total

@ptah-extension/skill-synthesis
Test Suites: 6 skipped, 76 passed, 76 of 82 total
Tests:       37 skipped, 1545 passed, 1582 total

NX   Successfully ran target test for 2 projects
```

The backend suite emitted its existing worker force-exit warning after all tests passed.

Required lint run:

```text
NX   Running target lint for 2 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/skill-synthesis-ui

@ptah-extension/skill-synthesis-ui: 1 problem (0 errors, 1 warning)
@ptah-extension/skill-synthesis: 35 problems (0 errors, 35 warnings)

NX   Successfully ran target lint for 2 projects
```

All lint findings are pre-existing warnings: max-lines and existing test-file explicit-any/unused-disable warnings. No lint error was reported.

Required typecheck run:

```text
NX   Running target typecheck for 3 projects:
- @ptah-extension/skill-synthesis
- @ptah-extension/skill-synthesis-ui
- @ptah-extension/rpc-handlers

NX   Successfully ran target typecheck for 3 projects
```

Degradation audit:

```text
degradation-audit: scanned 2855 file(s)
libs/backend/skill-synthesis: 6 ok (baseline 6)
libs/frontend/skill-synthesis-ui: 5 ok (baseline 5)
degradation-audit: TOTAL 303 unsuppressed site(s)
NX   Successfully ran target lint for project degradation-audit
```

No degradation baseline was changed.

Restored working-tree summary:

```text
19 files changed, 698 insertions(+), 185 deletions(-)
git diff --check: exit 0
```

### Absolute files changed in revise round 1

- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\skill-promotion.service.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.service.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\backend\skill-synthesis\src\lib\cleanup\skill-backlog-cleanup.types.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\libs\frontend\skill-synthesis-ui\src\lib\components\skill-synthesis-tab.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\pr-526-fixes-report.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\agent-output-root.md`
- `D:\projects\ptah-extension\.claude-worktrees\task-439-phase3-skills-unblock\.ptah\specs\TASK_2026_461_639c\pr-526-fixes-r1.done`
