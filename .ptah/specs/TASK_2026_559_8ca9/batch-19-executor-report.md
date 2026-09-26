# Batch 19 executor report: get_diagnostics lanes and the second-checkout guard

Lane C, worktree `task-559-lane-c`, branch `fix/task-559-lane-c`. Nothing was staged or committed.

## Task 19.1: separate worker lane for scoped runs

### Changes

- `libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts`
  - :25-33 The class doc now describes two lanes per compiler, the reason for them and the memory cost.
  - :98-103 `TsDiagnosticsRunRequest.lane` is a new required field.
  - :106-116 New exported type `TsDiagnosticsLane = 'scoped' | 'unscoped'`.
  - :150 `WorkerEntry.key` replaces `tsModulePath`. Every lookup in `forget` (:330-331) and `settleIdle` (:365, :372-373) uses the key.
  - :177-184 The constructor takes `workerSource`, default `TS_DIAGNOSTICS_WORKER_SOURCE`. This is the injected slow worker the batch asks for; hosts never pass it. The shared `tsDiagnosticsWorker` singleton is unchanged.
  - :197 and :254-263 `run` calls `ensureWorker(tsModulePath, lane)`. The map key is `` `${tsModulePath}\u0000${lane}` ``. NUL follows the provider's `KEY_SEP` precedent.
  - :319 The `failWorker` doc now says that the other lane of the same compiler is left untouched.
  - The rest of the lifecycle is unchanged: timeout, awaited `terminate()`, `dispose()` joining `terminations`, and ref/unref.
- `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts`
  - :395-398 `compute` passes `lane: scoped ? 'scoped' : 'unscoped'`.
  - :250-252 The `withBudget` doc notes that a kept run only occupies its own lane.
  - `withBudget`, `inFlight` and the cache logic are unchanged.

### Specs and fails-before

Fails-before method: the specs were written first. They were run after only the type seam existed (the `lane` field plus the `workerSource` parameter, with the worker still keyed by `tsModulePath`).

| Spec | Before | After |
| --- | --- | --- |
| worker :346 scoped gets its own thread and resolves while unscoped is in flight (unscoped kept: not terminated, still ref'd) | FAIL (1 instance) | pass |
| worker :378 two scoped runs share one lane | pass (invariant pin) | pass |
| worker :399 two unscoped runs share one lane | pass (invariant pin) | pass |
| worker :~418 a failure on one lane leaves the other lane running | FAIL | pass |
| worker :431 each lane self-terminates after its own idle window, then respawns | FAIL | pass |
| worker :458 `dispose()` resolves only once every lane is gone | FAIL | pass |
| provider :1225 real threads, holding source (blocker 6 s, scoped 200 ms): scoped resolves first and in under 3 s; unscoped still lands | FAIL: `Received: 6247` (expected < 3000) | pass |
| provider :1277 the worker is asked for the lane that matches the scope | Against HEAD: the field did not exist. Mutation check (constant `'unscoped'`): FAIL, as did :1225 at 6230 ms | pass |
| provider :1310 at 45 s the caller gets "still running"; the retry shares the kept run (1 `run` call); the result is served from the 5 s cache; the next call after the TTL recompiles | pass (pins that behaviour is unchanged) | pass |

- The in-flight de-duplication and cache specs that already existed still pass.
- `ts-diagnostics-worker-containment.spec.ts` is unchanged (not in `git status`) and passes.

### Memory bound

At most 2 threads per distinct compiler: one for scoped runs and one for unscoped runs. Each thread holds one `typescript` module load plus the programs of its current run. The worker source keeps no program cache between runs. Each lane terminates after `IDLE_TERMINATE_MS` (60 s) of idleness.

- The map size is at most 2 × the number of compilers used within one idle window.
- In practice that means 2 threads, because every checkout symlinks to the same `typescript`.
- The worst case is two monorepo programs resident at once: an abandoned unscoped compile plus a scoped one.

### Case e: before and after

Measured with a temp script at `%TEMP%/b19-case-e.ts`, which drives the real `TsDiagnosticsWorker` class. The script was not added to `<WT>`. The machine was heavily loaded by the other lanes during both runs.

| | blocker: 10 configs from `apps/ptah-electron` | worktree scoped: 3 configs |
| --- | --- | --- |
| before | 91,794 ms | **178,904 ms** from post (queued behind the blocker) |
| after | 66,313 ms | **29,077 ms** from post |
| after, isolated scoped | n/a | 24,794 ms |

After the fix, the scoped run costs roughly its isolated time. The cold cost of compiling one lib (about 25 s) is out of scope, as the batch states.

## Task 19.2: second-checkout case in the provider contract

### Changes

- `libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts`
  - :26 New optional setup hook `createSecondCheckout(primaryRoot)`: the factory for the second root.
  - :36 `SECOND_CHECKOUT_BUDGET_MS = 10_000`.
  - :47-81 A hermetic temp fixture with its own chain: `tsconfig.base.json`, then `libs/pkg/tsconfig.json` (solution-style), then `tsconfig.lib.json`. `broken.ts` contains one TS2322 error.
  - :95-112 `relativeView`: files outside the root are tagged `OUTSIDE:`.
  - :213 The new case runs only when the hook is supplied. It asserts:
    - both checkouts return `available`;
    - the primary result includes `broken.ts`;
    - the second checkout's root-relative diagnostics equal the primary's;
    - the second call finishes in under 10 s.
  - Both roots are removed afterwards.
  - Prettier also re-wrapped the existing `createSetup` union type at :116-117.
- `run-diagnostics-provider-contract.self.spec.ts` adds a root-aware fake provider with a copy factory.
- `type-script-diagnostics-provider.spec.ts` (:144-160) wires `createSecondCheckout` as `fs.cpSync` to `<root>-worktree`. It uses `realDirFsProvider()` because the scoped walk needs `readDirectory`.

### Evidence

- As Task 1.2 predicted, this case passes at HEAD. It is a regression guard, not the proof of the 19.1 fix.
- Mutation check: I changed the fake to answer the second root with the primary's paths. The case failed (`"file": "OUTSIDE:C:/…/ptah-diag-checkout-aLaZEQ/libs/pkg/src/broken.ts"`), then I reverted the change.

## Verification (tails)

- `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache`, 2 projects:
  - Run 1 failed `workspace-intelligence:test` with 2 failures, both in `project-analysis/project-detector.service.spec.ts`, which this batch does not touch. It also failed `platform-core:test`; the detail was cut from the tail.
  - Re-run of each on its own: platform-core `43 passed / 821 passed, 4 todo`; project-detector `57 passed`.
  - Run 2 of the full command: `Successfully ran targets test, lint, typecheck for 2 projects`, with `Nx detected 2 flaky tasks`.
  - Conclusion: load flakes caused by the parallel lanes.
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`: 2 successful tasks.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: `Successfully ran target validate-deps`.
- `nx run degradation-audit:lint --skip-nx-cache`: `degradation-audit: TOTAL 300 unsuppressed site(s)`. No new catch blocks were added.
- `prettier --check` on the 6 changed files: all pass.
- `git status --short`: the 6 source and spec files under `libs/backend/{workspace-intelligence,platform-core}`, plus this report.

## Deviations

- The batch cites `compute → withBudget` at :236-284. The lane is passed in `compute` (:395-398), because that is where `run` is called. `withBudget` only received a doc note.
- The 19.2 wiring edits `type-script-diagnostics-provider.spec.ts`, which Task 19.1 lists and 19.2 does not. Without that edit the contract case would run only against the fake.
- The `workerSource` constructor parameter is a test seam, as the batch's "injected slow worker" requires.

## Revision round 1 (r1 REVISE 6/10)

### S1: two ways a worker could survive `dispose()`

1. A run posted while `dispose()` was in progress created a thread outside the snapshot that `dispose()` waits on.
2. A provider call whose config discovery finished after `dispose()` still started a thread.

### Fix

- `ts-diagnostics-worker.ts`
  - :176-179 Two new counters: `disposals` (the generation) and `disposing` (disposals still in progress).
  - :198 A `generation` getter. Its doc states that disposal ends a generation but the pool stays usable.
  - :212-217 `run` refuses admission while `disposing > 0`. It rejects with `TypeScript diagnostics worker was disposed.` before `ensureWorker` runs, so no thread is created. Because nothing can be admitted during disposal, the set of lanes `dispose()` waits on is complete.
  - :269-282 `dispose()` increments the generation first and holds admission closed until every termination has completed, with a `try/finally`.
  - :418 The `disposedError()` helper.
- `type-script-diagnostics-provider.ts`
  - :358 `compute` reads the generation before its first `await`.
  - :394 After discovery it re-checks the generation. If it changed, `compute` returns `unavailable` ("did not start … disposed while its configs were being discovered") without calling the worker, and that result is not cached.
  - Discovery is the only `await` before `run`, and `run` follows it synchronously.
- No catch blocks were added.
- All other Batch 19 behaviour is unchanged, and the containment spec was not modified.

### Regression specs (run before the fix; fails-before recorded)

| Spec | Before | After |
| --- | --- | --- |
| worker spec :492: a run posted while `dispose()` is in progress is refused and creates no thread. Both lanes hold termination. After disposal a new run is admitted again. | FAIL: `Expected length: 2, Received length: 3` | pass |
| provider spec :1312 (real worker thread, deferred `findFiles`): discovery resolving after `dispose()` returns `unavailable`/`disposed` and never reaches the worker. A later call compiles. | FAIL: `run` expected 0 calls, received 1 | pass |

`jest` over `src/diagnostics` (3 suites): 90/90 pass.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache`: `Successfully ran targets test, lint, typecheck for 2 projects`, with `Nx detected a flaky task`. The `file-settings-manager.bench.spec.ts` timeout did not recur.
- `ptah-cli` and `ptah-electron` typecheck: `Successfully ran target typecheck for 2 projects`.
- `ptah-electron:validate-deps`: passed.
- `degradation-audit:lint`: `TOTAL 300 unsuppressed site(s)`.
- `prettier --check` on the changed `.ts` files: all pass.
- `git status --short`:
  - the same 6 modified source and spec files;
  - this report;
  - `code-logic-review.md` and `reviews/batch-19-code-logic-review-r1.md`, both untracked and written by the reviewer.

## Revision round 2 (r2 REVISE 6/10)

### R2-S1: a call started during disposal was admitted afterwards

A provider call that started while `dispose()` was running read the generation after disposal had already incremented it. Once disposal finished and discovery resolved, the check matched and the run was admitted. The result was a live thread and a real result after `dispose()` had returned.

### Fix

- `ts-diagnostics-worker.ts:190-204`: the `generation` getter is replaced by `admissionToken(): number | null`. It returns `null` while a disposal is in progress; otherwise it returns the disposal count.
- `type-script-diagnostics-provider.ts:357-367`:
  - `compute` takes the token when the request starts, before its first `await`.
  - If the token is `null`, the call returns `unavailable` ("did not start: the diagnostics worker is being disposed") and is never admitted later.
- `type-script-diagnostics-provider.ts:398-407`:
  - Right before `run`, `compute` compares a fresh token with the one taken at the start.
  - Any disposal that began in between, finished or not, changes the token. The call then returns `unavailable` without calling the worker.
- Discovery is the only `await` between those two checks, and `run` follows the second check synchronously.
- The worker's own refusal of runs posted during disposal (r1) is kept.
- A request that starts after disposal has completed is still admitted.
- No catch blocks were added. The containment spec is unchanged.

### Regression spec (run before the fix)

`type-script-diagnostics-provider.spec.ts:1358` uses a real worker thread and deferred discovery:

1. Warm a lane.
2. Call `dispose()`, then call `getDiagnostics` while disposal is in progress.
3. Await disposal, then resolve discovery.
4. Assert that `run` is never called and the result is `unavailable` with a reason containing "disposed".
5. Start a request after disposal has completed and assert it returns `available`.

- Before the fix: FAIL, `run` expected 0 calls, received 1.
- After the fix: pass.
- `jest` over `src/diagnostics`: 3 suites, 91/91 pass. Both r1 regressions still pass.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core --skip-nx-cache`: `Successfully ran targets test, lint, typecheck for 2 projects`, with `Nx detected a flaky task`.
- `ptah-cli` and `ptah-electron` typecheck: passed.
- `ptah-electron:validate-deps`: passed.
- `degradation-audit:lint`: `TOTAL 300 unsuppressed site(s)`.
- `prettier --check` on the changed `.ts` files: all pass.
- `git status --short`:
  - the same 6 modified files;
  - this report;
  - the reviewer's untracked review files (`code-logic-review.md` and `reviews/batch-19-code-logic-review-r1.md`, `-r2.md`).
