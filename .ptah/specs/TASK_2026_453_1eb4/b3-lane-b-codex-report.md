# Batch 3 Lane B Codex Report

## Frontend implementation — `TASK_2026_453_1eb4`, batch 3 / Task 3.2

**Task completed**: One replay-and-finalize at a time across tabs (C2 replay admission).

## What changed

- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:16` documents the admission contract. Lines 181-208 acquire the global slot without awaiting the uncontended fast path, preserve the existing replay/finalize/fence order, and release in `finally`. Lines 216-292 implement FIFO waiting, the 10-second warning, macrotask-plus-paint handoff, hidden-window timer fallback, and the unchanged post-yield claim/tab/binding checks.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.admission.spec.ts:24` adds the C2 admission suite. The cases at lines 190, 251, 276, 324, 360, 390, and 421 pin FIFO/fence order, synchronous uncontended replay, superseded and closed waiters, active failure, rejected handoff, the wait warning, and the hidden-window fallback.
- `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts:456` updates the pre-C2 multi-replay fence harness to advance serially while retaining its existing exact-once and ordering assertions. The affected failure case starts at line 498; the superseding-replay case starts at line 695.
- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts:2288` starts the newer targeted load before releasing the held stale replay, then awaits both, preserving the stale-claim integration assertion under serialized replay admission.
- `libs/frontend/chat/CLAUDE.md:75` adds the Rule 7 admission bullet, including global FIFO scope, `finally` release, macrotask plus rAF/50 ms paint yield, concurrent RPC round trips, and FU-20a.

## Task 3.2 acceptance criteria

1. **“Scope is `replay()` only (chunks + `finalizeSessionHistory` + `closeFence`); `claim`, `release`, fence and `session-loader.service.ts` are NOT modified.”** Met in production code: admission is entered at `replay()` line 181, held through finalization and fence close at lines 204-205, and released at line 208. `claim`, `release`, all fence methods, and `session-loader.service.ts` are unchanged.
2. **“FIFO by `replay()` entry. Uncontended … admitted synchronously with no added `await`/microtask.”** Met by the queue at lines 216-230 and the conditional await at line 182. The uncontended ≤250-event spec at admission spec line 251 observes all 250 writes and finalization before the returned promise settles.
3. **“Contended → waits; on admission re-runs the checks … and returns `'superseded'` identically.”** Met by lines 185-187 and `canContinueReplay` at lines 285-300. The parameterized superseded/closed waiter spec starts at line 276 and proves the following waiter proceeds.
4. **“Release in `finally` on every exit … Before the next waiter starts: `await yieldToMacrotask()` then a private paint yield … rAF or a 50 ms `setTimeout`.”** Met by replay `finally` at lines 207-209, handoff `try/finally` at lines 249-262, and private paint helper at lines 265-281. The FIFO, failure, rejected-handoff, no-pending-timer, and hidden-window cases pin all paths.
5. **“A throw inside `replay()` still propagates with the fence open.”** Met without changing fence close placement. The active-throw spec at line 324 asserts rejection, confirms the live event remains fenced, and proves the waiter is admitted.
6. **“A waiter waiting > 10 s emits one `console.warn` with tab id and queue length.”** Met at service lines 223-228; the timer is cleared on admission at line 259. The spec at line 390 advances beyond 10 seconds, checks one structured warning, completes admission, advances again, and checks no second warning.
7. **“File stays under 700 lines; class doc gains an Admission paragraph.”** Met: the service is 437 lines after formatting, and the paragraph begins at line 16.
8. **“Spec … three chunked replays … FIFO … every release path … synchronous … fence … no timers … hidden-window.”** Met by the new admission suite. The three 251-event replays at line 190 assert no B event precedes A finalization, finalization order A/B/C, live B delivery after B finalization, and zero timers. Lines 276-359 cover supersession, close, and throw; line 360 covers rejected handoff; line 251 covers synchronous replay; line 421 covers the 50 ms path.
9. **“Existing `session-history-replayer.service.spec.ts`, `session-loader.service.spec.ts`, `session-loader.cli-restore.spec.ts` green.”** Met by the full `@ptah-extension/chat` run: 76 suites passed, 1,243 tests passed, 2 skipped. The two legacy specs whose scheduling assumptions changed were adjusted as described under deviations; CLI restore remained unchanged and green.
10. **“CLAUDE.md bullet: admission is global FIFO over the replay phase only …”** Met at `libs/frontend/chat/CLAUDE.md:75`, including every requested point.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.admission.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\libs\frontend\chat\CLAUDE.md`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks\.ptah\specs\TASK_2026_453_1eb4\b3-lane-b-codex-report.md`

## Stack observed

Angular 21.2.6 with `inject()` services, TypeScript 5.9.3 strict compilation, Jest 30, and Nx 22.6.5 (`package.json:91,210-218,257,267,277`). This change is service scheduling only; no template, component state, styling, or rendering API was added.

## Verification

Final required sequence:

1. `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2` — exit 0. Header: `NX Running target test for project @ptah-extension/chat: - @ptah-extension/chat` (one requested project). `Test Suites: 76 passed, 76 total`; `Tests: 2 skipped, 1243 passed, 1245 total`; `NX Successfully ran target test for project @ptah-extension/chat`.
2. `npx nx run-many -t typecheck -p @ptah-extension/chat` — exit 0. Ran `npx ngc --noEmit --project libs/frontend/chat/tsconfig.lib.json`; `NX Successfully ran target typecheck for project @ptah-extension/chat`.
3. `npx nx run-many -t lint -p @ptah-extension/chat` — exit 0. `✖ 18 problems (0 errors, 18 warnings)` and `NX Successfully ran target lint`. All 18 are existing warnings outside the changed files.
4. `npx eslint <five changed chat files>` — exit 0. TypeScript files reported no findings; `CLAUDE.md` produced one expected “File ignored because no matching configuration was supplied” warning. `npx prettier --check <five changed chat files>` — exit 0, `All matched files use Prettier code style!`.
5. `npx nx run degradation-audit:lint --skip-nx-cache` — exit 0. `libs/frontend/chat: 11 ok (baseline 11)` and `degradation-audit: TOTAL 303 unsuppressed site(s)`.

Earlier corrective runs, retained for traceability:

- The first test invocation was terminated by the command wrapper after 1.1 seconds (exit 124) before Nx emitted results; it was immediately rerun in the foreground with the full timeout.
- First complete test run: exit 1, 2 suites/5 tests failed because legacy tests assumed concurrent replay progress and held the new handoff yield. The admission suite passed. The directly affected legacy harnesses were updated.
- Second complete test run: exit 1, one stale-loader assertion expected two yields but its newer replay had not entered `replay()` before the stale replay released, so the valid uncontended path used one yield. The assertion was restored to one.
- First lint run: exit 1 with two local errors (`no-unsafe-finally`, `prefer-const`) plus 18 baseline warnings. The local errors were fixed, then the full test → typecheck → lint sequence was rerun successfully.

## Plan deviations

Task 3.2’s named file list creates a new admission spec and says the existing replayer and loader specs must remain green. Four existing tests explicitly required two replays to progress concurrently or awaited the newer replay before releasing the active one, which contradicts C2 serialization and caused deterministic hangs. I therefore made minimal scheduling-only changes in `session-history-replayer.service.spec.ts` and `session-loader.service.spec.ts`; their fence, stale-claim, exact-once, and failure assertions remain. No production file outside the named replayer service was changed.

## Out-of-scope observations

The shared worktree also contains Lane A edits in `libs/frontend/core/**`, `libs/frontend/canvas/**`, `.ptah/specs/TASK_2026_453_1eb4/implementation-plan.md`, and `b3-lane-a-codex-report.md`. They were not created, edited, reformatted, or reverted by Lane B.
