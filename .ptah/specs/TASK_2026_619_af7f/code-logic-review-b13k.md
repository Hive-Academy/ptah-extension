# Code logic review - TASK_2026_619 Batch 13k (ca6575123)

Verdict: REVISE. There are no critical defects. The registry logic is sound, but the claims the user cares most about are not proven at the dispatcher level, and there are a few real edge-case defects.

Read-only review. Nothing was run, per the instructions. All paths are under `libs/backend/vscode-lm-tools/src/lib/code-execution/` in the worktree `task-619-tool-benchmark`.

## Scope read
- `mcp-core/run-check-jobs.ts`: whole file.
- `run-check-wait.tool.ts`, `wait-tools-args.schema.ts`: read.
- `protocol-dispatcher.ts`: lines 1415-1520 and 3540-3600.
- `run-check.tool.ts`: the `execute` kill, settle and abort wiring, lines 437-680.
- The specs: `run-check-jobs.spec.ts`, `run-check-wait.tool.spec.ts`, and the grep results for the parity, contract and dispatcher specs.

## What holds (checked, no finding)
- **Abort listeners and timers in `waitFor`:**
  - `settle` clears the timer and removes the abort listener on every exit (jobs.ts:128-136).
  - `job.done` never rejects (jobs.ts:85-95).
  - The one cost is a leftover `.then(settle)` closure per aborted wait, until the job ends. That is bounded by the check timeout.
- **Busy slot, normal paths:**
  - The slot is released in the final `.then`, after the catch (jobs.ts:96-104).
  - That covers a thrown `run`, a sync throw, a spawn error and a throw in the summary code. All become a `not_run` outcome.
  - Cancel and dispose resolve through the runner's `settle`, which has a KILL_SETTLE_MS backstop (run-check.tool.ts:539-545, 576-582).
- **Retention:**
  - Running jobs live only in `running`, never in `finished`, so they cannot be evicted.
  - `finished` is in finish order, so FIFO eviction is correct.
  - `sweep` runs on `start`, `get` and `waitFor`.
- **Ownership:**
  - The owner key is root, session id and agent id, taken from transport identity (dispatcher.ts:3551).
  - A cross-owner `get` returns `undefined`, the same as an unknown id.
  - A root-resolution failure on `wait` also gives the unknown-id text (dispatcher.ts:1483).
  - The external busy reply leaks no id, project or path (dispatcher.ts:3562-3569).
- **Race: finish exactly during a wait, attach or cancel:**
  - These are single-threaded. `job.outcome` is checked synchronously.
  - Cancel after completion aborts a controller nobody listens to, so it is harmless.
  - Two concurrent waits each have their own timer and listener.
- **Schema:** `RunCheckWaitArgsSchema` is `.strict()`, with a uuid `jobId` and `timeoutSec` clamped to 0-960 and then to 45 in the dispatcher (schema.ts:105-116, dispatcher.ts:1496-1499).
- **Stdio:** stdio is not touched, apart from the `transport:'stdio'` builder argument. `ptah_run_check_wait` is not exposed there, and the parity spec asserts that.
- **Readers of the `'running'` verdict:** no production code switches on the run-check verdict. The type was widened and the dispatcher emits it.

## SERIOUS

### S1. The central claims have no dispatcher-level test
- **Evidence:** `protocol-dispatcher.spec.ts` in this commit gains only a tool-count bump (+3) and Prettier reflows. A grep for `run_check_wait|runCheckJobs|RUNNING|jobId` in it returns only the comment at line 7695. The plan (section "Tests to add") promised these tests:
  - the HTTP `run_check` returns a final reply when the check finishes in under 45 s;
  - it returns a running reply plus jobId when it takes longer;
  - a request abort no longer calls `killTree`.
- **Scenario:**
  - A later refactor changes the dispatcher to pass `getRequestAbortSignal()` into `runCheck` again.
  - The registry spec still passes, because it only proves that `waitFor` ignores the signal (run-check-jobs.spec.ts:~64-83).
  - The 60 s kill regression returns unnoticed.
  - Nothing exercises `cancel: true` through the tool.
  - Nothing exercises cross-caller `jobId` equivalence through the tool.
  - Nothing exercises the wait clamp text.
  - Nothing exercises running-reply structured content with `verdict: 'running'`.
- **Fix:** add the promised dispatcher specs, with `runCheck` mocked and a fake `killTree`.

### S2. "Slot released on every exit path" is argued but not tested
- **Evidence:** `run-check-jobs.spec.ts` has no case where `run` rejects or throws, none for cancel followed by a new `start`, and none where `runningCheckPids()` is non-zero. The `jest.getTimerCount() === 0` test the plan promised is absent. `grep throw|reject` finds no such case.
- **Scenario:** a future edit to the catch/then chain (jobs.ts:85-104) that moves `running = undefined` blocks all checks on the host forever. No spec fails.
- **Fix:** add specs for:
  - a rejecting run, which leaves `running` free and returns a `not_run` outcome;
  - a sync-throwing run;
  - cancel then `start` for a new check;
  - no timers left after a wait;
  - `listenerCount` on the request signal returning to 0.

## MODERATE

### M1. Dispose no longer covers a job in its launch window
- **Evidence:**
  - Before, closing the host closed the HTTP request and aborted the signal, so the run was killed even if it had not registered yet.
  - Now the job controller is aborted only by `cancel` (jobs.ts:139-141).
  - `killRunningChecks` reaches only runs already in `liveChecks`. A pid is registered only after `await launch(...)` (run-check.tool.ts:480-491, 584).
  - A job in the window between `start` and `register` survives dispose and runs to its timeout, up to 960 s, as an orphan.
- **Failure scenario:** the user quits just after a check started (spawn on Windows can take 100s of ms) and Nx outlives the app.
- **Fix:** export a registry `abortAll()` and call it from `killRunningChecks` or the dispose path. It aborts the controller of `running` before the pid kill. The runner already handles `before_start`.

### M2. Attach to a job that is already being cancelled
- **Evidence:** `start` attaches whenever `running` has the same owner and the same check (jobs.ts:67-69). A job stays `running` for up to KILL_SETTLE_MS after cancel or timeout.
- **Scenario:** the agent cancels, then immediately re-calls `ptah_run_check`. It attaches to the dying job and gets a `cancelled` verdict for the new request. It must call again.
- **Fix:** in `start`, treat a job with `controller.signal.aborted` as busy, not attachable. The reply could say it is stopping.

### M3. `readOnlyHint: true` on a tool that can kill a process
- **Evidence:** `run-check-wait.tool.ts` annotations (about lines 34-38) set `readOnlyHint: true` when `cancel` can kill the check. The plan only asked for `destructiveHint: false` and `idempotentHint: true`. The spec asserts only the latter two.
- **Impact:** clients that auto-approve read-only tools will allow cancels without a prompt.
- **Fix:** drop `readOnlyHint`, or document the decision.

### M4. A client that disappears holds the host-wide slot, with no recourse for others
- **Evidence:** the slot is held for up to the check timeout, 960 s (jobs.ts:66-76). Another caller gets only "busy ... started Ns ago" and cannot cancel (the busy reply carries no id, by design).
- **Impact:** this follows from the accepted design (decisions 2 and 3), but the busy message does not say that the owner's wait/cancel is the only way out. It does not mention the timeout either.
- **Fix:** add the check's own deadline to the busy text without leaking identity, for example "at most N s more".

### M5. Retry after a failed kill is reported as "busy: another check is running"
- **Evidence:** `start` returns `{ busy: undefined, external: true }` while `runningCheckPids().length > 0` (jobs.ts:75-76). This includes the retry entry for a cancelled job whose kill failed (run-check.tool.ts:517-520, `register(retryKill)`). Even the owner then sees the external, identity-free message.
- **Fix:** none required. It is acceptable and safe. Optionally log it.

## MINOR
- **Attach ignores `timeoutSec` and target order** (jobs.ts:145-151). A second call with a different timeout attaches silently to the first job's timeout. A different target order is "busy".
- **Description wording drift, stdio included:** `buildRunCheckTool` rewrote the description for both transports and dropped "block until done" (run-check.tool.ts:~160-170 in the diff). The plan said stdio's description stays the same as today. The parity spec only checks the HTTP sentence, so it cannot catch this. Stdio behaviour is unchanged.
- **Appended suffix:** `runCheckRunningResponse` appends the cap suffix after `formatRunCheckRunning` has clamped to 4000 (dispatcher.ts about 3590-3600). The reply can exceed WAIT_SUMMARY_MAX_CHARS only if the log path is pathologically long. Realistic replies are about 600 chars.
- **Request context retained:** the job's `run` starts inside the request's AsyncLocalStorage context (jobs.ts:79-84). The detached promise keeps the request context alive for the check's duration. `runCheck` does not read it, so it is harmless today.
- **Advertised schema:** the JSON schema for `ptah_run_check_wait` omits the default 45 for `timeoutSec` (the zod schema has it).
- **Owner-key delimiter:** `|` is a legal character in POSIX paths. A collision is essentially impossible.

## Five logic questions (short)
1. **Silent failure:** a job thrown error becomes a `not_run` error outcome, not a success (jobs.ts:85-95). No silent failure found. The abort-regression test gap (S1) is the silent-failure risk for future edits.
2. **Unexpected user action:** cancel, then re-run, attaches to the dying job (M2). A quit during launch leaves an orphan (M1).
3. **Wrong answer from input:** none found.
4. **Dependency failure:**
   - Spawn error and kill failure are handled by the runner.
   - The kill-failure retry blocks new checks as "external busy" (M5).
5. **Missing:**
   - The dispatcher specs.
   - A dispose hook for the launch window.

## Result
APPROVE only after S1 and S2 (tests) are added, and M1 is fixed or consciously accepted. M2 and M3 are quick fixes.
