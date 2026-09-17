# Batch 3 revision report — round 1 of 2

Task: `TASK_2026_453_1eb4`  
Batch: 3 (Task 3.1 / C3 and Task 3.2 / C2)

## Review findings

### Logic — Serious / Failure mode 1: orphan timeout settled an in-flight canvas request

Fixed. `libs/frontend/core/src/lib/services/app-state.service.ts:717-726` now records whether the timeout actually removed the exact request from `_canvasSessionRequests`; it calls `settle(false)` only when that removal succeeded. A request already drained by the canvas is therefore no longer timeout-eligible and settles only through its real `switchSession`/tile-cap outcome. The existing guarded resolver still gives exactly-once settlement and clears a live timer.

New coverage at `libs/frontend/core/src/lib/services/app-state.service.spec.ts:681` drains three FIFO requests, advances fake time to 15 seconds (past every 5-second orphan timer), proves none settled, then resolves the simulated serialized downstream work in order and asserts `[true, true, true]` plus FIFO settlement order. The pre-consumption timeout path remains pinned at `:656`, and ordinary accepted-request timer cleanup at `:668`.

### Logic — handoff failure was detached and only logged

Fixed. `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:211-212,238-246` makes `releaseReplayAdmission()` return the handoff promise and awaits it only when a waiter exists. The uncontended path still returns `null`, so the <=250-event synchronous fast path is unchanged. `handoffReplayAdmission()` still admits the next waiter in `finally`; if its macrotask yield rejects, that failure now rejects the releasing replay instead of being detached and reduced to a console line.

`libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.admission.spec.ts:357-380` proves both sides: the releasing replay rejects with `handoff post failed`, while the next waiter is admitted and replays successfully. Legacy fence schedules were adjusted at `session-history-replayer.service.spec.ts:536-544` so their deliberately held test handoff is released before awaiting the now-observable releasing replay.

### Logic — `canContinueReplay` re-read `claim.tabId`

Fixed. `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:184-204,283-301` now passes the replay caller's destructured `tabId` separately and uses it for tab lookup and pending-update cleanup, while `isCurrent(claim)` independently checks claim currency. The helper comment now says caller-tab explicitly.

### Logic — Moderate / Failure mode 2: Task 3.2 AC 9 said legacy specs stay unchanged

Finding is correct as a planning contradiction; no production correction is appropriate. Global admission necessarily invalidates tests that require same-session replays to advance concurrently. The existing scheduling-only changes in `session-history-replayer.service.spec.ts:456-595` and `session-loader.service.spec.ts:2296-2308` retain the fence, exact-once, stale-claim, and outcome assertions and are proven by the full green chat run (76/76 suites, 1,243 passed, 2 skipped). This report explicitly records the deviation. The user prohibited edits to `batches.md` and `implementation-plan.md`, so the contradictory AC text was not rewritten.

### Logic — Moderate / Failure mode 3 and Style — Serious: stale perf-harness comment

Fixed for the explicitly scoped perf spec. `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:153-160` now states that TASK_2026_453 C3 replaced the former overwrite-prone bridge with the FIFO `canvasSessionRequests` queue. It preserves the historical no-yield measurement context and explains that the one-rAF gap remains the disclosed M0 comparison cadence, not a workaround. The Batch 3 grep for `canvasSessionRequest\b|clearCanvasSessionRequest` now has no matches in the scoped frontend/product and perf-spec files.

The review also mentions `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:176`; that support file was not changed because this revision's explicit file scope authorizes only the perf spec comment.

### Logic — Minor: canvas switch rejection discarded its reason

Fixed cheaply. `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:332-341` now reports the unknown rejection object before resolving the request `false`. `orchestra-canvas.component.spec.ts:423-444` pins both the diagnostic and the false outcome.

### Style — Minor: unusual non-Promise admission fast path was documented only locally

Fixed. The class Admission paragraph at `session-history-replayer.service.ts:16-21` now states that the fast path intentionally returns no Promise to preserve synchronous uncontended replay. `libs/frontend/chat/CLAUDE.md:75` records the same contract and the observable contended-handoff failure behavior.

### Style — Minor: macrotask scheduler's rAF warning lacked a forward pointer

Fixed. `libs/frontend/core/src/lib/services/macrotask-scheduler.ts:9-12` now points to the history replayer's deliberate rAF-versus-50-ms race for the narrower paint-yield requirement.

### Style — Minor: canvas effect now drains and executes requests in one block

No extraction made. The review labels this a preference rather than a fix, and the current block at `orchestra-canvas.component.ts:319-345` is one cohesive signal-bridge effect matching the pre-existing local shape. Extracting a one-use helper would add indirection without changing ownership, state, or testability.

## New and revised specs

- `app-state.service.spec.ts:681`: three consumed requests remain unsettled beyond 5 seconds and resolve with their true outcomes in FIFO order, pinning the C2-latency × C3-timeout interaction.
- `session-history-replayer.admission.spec.ts:357`: a rejected handoff remains non-wedging and is observable by the releasing caller.
- `session-history-replayer.service.spec.ts:536`: legacy held-yield harness now releases the awaited handoff while preserving the mid-replay fence assertion.
- `orchestra-canvas.component.spec.ts:423`: rejected session switching logs the cause and settles only that request `false`.

## Changed files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.admission.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\app-state.service.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\core\src\lib\services\macrotask-scheduler.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b3-revise-codex-report.md`

Pre-existing worktree changes in `implementation-plan.md` and the two lane/review reports were inspected but not modified by this revision.

## Verification

1. `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat --parallel=1 --maxWorkers=2`
   - First revision run: exit 1. Header correctly said `Running target test for 3 projects`. Core passed 719/719 and canvas passed 121/121; two legacy chat fence tests timed out because their held handoff was awaited after the production fix. Their test scheduling was corrected without weakening assertions.
   - Final run: exit 0. Header: `Running target test for 3 projects`. Core: 30/30 suites, 719/719 tests. Chat: 76/76 suites, 1,243 passed and 2 skipped. Canvas: 9/9 suites, 121/121 tests. `Successfully ran target test for 3 projects`.
2. `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat`
   - Exit 0. Header: `Running target typecheck for 3 projects`; `Successfully ran target typecheck for 3 projects`.
3. `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat ptah-electron-e2e`
   - Exit 0. Header: `Running target lint for 4 projects`. Zero errors. Existing unrelated warnings: core 11, chat 18, e2e 9; canvas clean.
4. Changed-file ESLint:
   - `npx eslint --config libs/frontend/core/eslint.config.mjs <3 changed core files>` — exit 0, no findings.
   - `npx eslint --config libs/frontend/canvas/eslint.config.mjs <2 changed canvas files>` — exit 0, no findings.
   - `npx eslint --config libs/frontend/chat/eslint.config.mjs <4 changed chat TypeScript files> libs/frontend/chat/CLAUDE.md` — exit 0; TypeScript clean, Markdown emitted only the expected ignored-file warning.
   - `npx eslint --config apps/ptah-electron-e2e/eslint.config.mjs apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts` — exit 0, no findings.
5. `npx prettier --check <all 11 changed source/documentation files>`
   - Exit 0: `All matched files use Prettier code style!`.
6. `npx nx run degradation-audit:lint --skip-nx-cache`
   - Exit 0. `libs/frontend/chat: 11 ok (baseline 11)`. Core and canvas remain absent from the nonzero directory table. `degradation-audit: TOTAL 303 unsuppressed site(s)`.
7. `git diff --check`
   - Exit 0, no whitespace errors.
8. Deliverable checks:
   - `npx prettier --check .ptah/specs/TASK_2026_453_1eb4/b3-revise-codex-report.md` — exit 0, formatted.
   - `npx eslint .ptah/specs/TASK_2026_453_1eb4/b3-revise-codex-report.md` — exit 0 with only the expected Markdown ignored-file warning.

## Stack and scope

Angular 21.2.6 signals/OnPush, TypeScript 5.9.3 strict, Nx 22.6.5, and the existing Jest test layouts were followed. No rendered markup, styling, focus behavior, routes, external boundaries, transcript components, execution node, task carrier, batches, context, implementation plan, or test report were changed by this revision. The replayer remains 440 lines, below the 700-line ceiling.

## Revise round 2

### 1. Logic delta Serious: a failed hand-off rejected the completed replay

Fixed by attributing a failed admission hand-off to the waiter it was trying to admit. `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:83-87` gives each queued waiter its own reject function; `:185-212` awaits admission inside the replay's `try` but never awaits release in `finally`; and `:238-265` removes the waiter from the FIFO before starting a detached hand-off, then either resolves that waiter or rejects it with `Replay admission handoff failed for tab <waiter tab id>`. The hand-off promise cannot become an unhandled rejection because `handoffReplayAdmission` consumes the scheduling failure itself, and no catch-return sentinel was added. A rejected waiter still enters the replay `finally` and releases the active slot onward, so the queue cannot wedge.

Two regression specs pin both service and caller behavior:

- `session-history-replayer.admission.spec.ts:411-450` completes tab A, forces the hand-off to tab B to fail, proves A still resolves `replayed` and is finalized, proves B rejects with B's tab id and is not finalized or otherwise mutated, then proves tab C is admitted and resolves `replayed`.
- `session-loader.service.spec.ts:2288-2323` exercises the real `SessionLoaderService` caller. A resolves `{ staleSnapshot: false }` and is finalized; A never enters `applyResumeFailure`; B receives the contextual rejection and B alone enters loader failure recovery. This directly guards against the delta review's state-clearing/subagent-restoration regression.

The admission contract text now matches the implementation at `libs/frontend/chat/CLAUDE.md:75`.

### 2. Logic delta Moderate: C2 x C3 needed one real combined spec

Fixed at `session-history-replayer.admission.spec.ts:250-300`. The test creates three requests through the real `AppStateManager.requestCanvasSession`, drains the real FIFO with `takeCanvasSessionRequests`, and feeds every drained request into the real `SessionHistoryReplayer` global admission queue. Each replay has 251 events, so it performs real chunk scheduling and real admission hand-offs. After advancing 5,000 ms, none of the three canvas promises has settled; the test then drives each real replay/handoff in FIFO order and asserts the callers resolve `[true, true, true]`, settlement order is A/B/C, and no timer remains.

This fails against the pre-fix C3 code: its unconditional five-second callback settles every already-drained request `false` while C2 still owns the first replay/admission slot. It also ceases to test the intended interaction if real admission is removed, because the controlled hand-off sequence and ordered replay completions no longer match.

### 3. Logic delta Moderate: stale support-helper prose

Fixed at `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:175-179`. The comment now says the one-rAF gap preserves the disclosed stress cadence and is not a workaround for the single-slot bug fixed by TASK_2026_453 C3. The historical measurement context remains in the perf spec's canonical incident write-up at `tile-open-longtask-budget.perf.spec.ts:153-160`.

### 4. Style delta Minors

Both cheap findings are closed:

- The unreachable `if (!next)` branch is gone. `session-history-replayer.service.ts:238-246` checks queue length, takes index zero, removes that exact entry, and hands it off. There is no await or competing queue-removal path between the invariant check and dequeue.
- The stale `perf-page-capture.ts` comment is corrected as described in item 3.

### 5. Task 3.2 AC 9: exact legacy-spec changes

The AC text saying legacy specs remain unchanged is incompatible with the production serialization change. Per instruction, `batches.md` was not edited; the team-leader must correct that text. Exactly these two existing spec files were restructured, and no assertion was weakened:

- `session-history-replayer.service.spec.ts`: the tests at `:456-495`, `:541-569`, `:571-595`, and `:699-728` no longer wait for two same-time replays to reach held yields, because the real global admission slot intentionally prevents that schedule. They now release A before driving B. Fence ownership, finalization order, exact-once delivery, event order, supersession, and post-release rejection remain explicitly asserted. The parameterized A-failure case at `:571-595` keeps the precise distinction between a chunk failure (B is still waiting, so no live entry yet) and a pre-replay resume failure (the live entry is released), then asserts the final live event exactly once and rejects any later event. Round 1's temporary staging that awaited the releasing replay's hand-off was removed because release is correctly detached again; outcome assertions are unchanged.
- `session-loader.service.spec.ts:2326-2356`: the newer `switchSession` is started before the older replay is released, then awaited after the older outcome. This scheduling change is forced because global admission prevents the newer replay from completing while the older owns the slot. The test still asserts exactly 250 old events, 10 new events, one finalization, no resume failure, and exactly one yield.

The new round-two loader test at `session-loader.service.spec.ts:2288-2323` is additive rather than a legacy-spec rewrite.

### New round-two specs and what they pin

- `session-history-replayer.admission.spec.ts:250-300`: real C3 canvas FIFO drain feeding real C2 replay admission, three requests, greater-than-timeout work, true outcomes, FIFO settlement, and timer cleanup.
- `session-history-replayer.admission.spec.ts:411-450`: completed A is insulated from B's failed hand-off, B owns its contextual failure, and C proves onward admission/no wedge.
- `session-loader.service.spec.ts:2288-2323`: the production caller preserves A's completed state and applies recovery only to B.

### Changed files through revise round 2

- MODIFIED `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts`
- MODIFIED `apps/ptah-electron-e2e/src/support/perf-page-capture.ts`
- MODIFIED `libs/frontend/canvas/src/lib/orchestra-canvas.component.spec.ts`
- MODIFIED `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`
- MODIFIED `libs/frontend/chat/CLAUDE.md`
- CREATED `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.admission.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`
- MODIFIED `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`
- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.spec.ts`
- MODIFIED `libs/frontend/core/src/lib/services/app-state.service.ts`
- MODIFIED `libs/frontend/core/src/lib/services/macrotask-scheduler.ts`
- MODIFIED `.ptah/specs/TASK_2026_453_1eb4/b3-revise-codex-report.md`

The worktree's existing `implementation-plan.md` modification and the lane/review artifacts were read but not edited. No prohibited carrier or test-report file was changed.

### Round-two verification

1. `npx nx run-many -t test -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat --parallel=1 --maxWorkers=2`
   - Corrective run 1: exit 1. Only the new loader regression expected `finalizeSessionHistory(TAB, [])`; the real caller correctly supplies `undefined`. The assertion was corrected to the production contract.
   - Corrective run 2: exit 1. Only the new loader regression incorrectly expected no `clearPendingUpdates(TAB)` call, but loader setup normally clears A before replay. That unrelated assertion was removed; the required `applyResumeFailure` isolation remains explicit.
   - Final run: exit 0. Header listed exactly 3 projects. Core: 30/30 suites and 719/719 tests. Chat: 76/76 suites, 1,245 passed and 2 skipped (1,247 total). Canvas: 9/9 suites and 121/121 tests. Nx: `Successfully ran target test for 3 projects`.
2. `npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat`
   - Exit 0. Header listed 3 projects; Nx reported successful typecheck for all 3. No `--maxWorkers` was passed.
3. `npx nx run-many -t lint -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat ptah-electron-e2e`
   - The first tool launch expired at its one-second wrapper limit before Nx completed (launcher exit 124); the same command was rerun in the foreground with a sufficient execution window.
   - Final run: exit 0. Header listed 4 projects. Zero errors; existing unrelated warnings were core 11, chat 18, e2e 9, while canvas was clean.
4. Changed-file ESLint:
   - A root-config attempt across every TypeScript file exited 1 because flat-config resolution did not load the canvas project's Angular plugin while reading existing selector-rule suppressions. This was a command-configuration failure, not a source finding.
   - `npx eslint --config apps/ptah-electron-e2e/eslint.config.mjs <2 changed e2e files>` - exit 0, no findings.
   - `npx eslint --config libs/frontend/canvas/eslint.config.mjs <2 changed canvas files>` - exit 0, no findings.
   - `npx eslint --config libs/frontend/chat/eslint.config.mjs <4 changed chat TypeScript files>` - exit 0, no findings; the same command on `libs/frontend/chat/CLAUDE.md` exited 0 with only the expected ignored-Markdown warning.
   - `npx eslint --config libs/frontend/core/eslint.config.mjs <3 changed core files>` - exit 0, no findings.
5. `npx prettier --check <all 12 changed source/documentation files>`
   - Exit 0: `All matched files use Prettier code style!`.
6. `npx nx run degradation-audit:lint --skip-nx-cache`
   - The first tool launch expired at its one-second wrapper limit before Nx completed (launcher exit 124); the same command was rerun in the foreground with a sufficient execution window.
   - Final run: exit 0. `libs/frontend/chat: 11 ok (baseline 11)` and `degradation-audit: TOTAL 303 unsuppressed site(s)`.
7. `git diff --check`
   - Exit 0, no whitespace errors.
8. Deliverable checks:
   - `npx prettier --check .ptah/specs/TASK_2026_453_1eb4/b3-revise-codex-report.md` - exit 0: `All matched files use Prettier code style!`.
   - `npx eslint .ptah/specs/TASK_2026_453_1eb4/b3-revise-codex-report.md` - exit 0 with only the expected ignored-Markdown warning and zero errors.
