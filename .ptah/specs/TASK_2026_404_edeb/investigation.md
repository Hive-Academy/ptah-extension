# CI affected-test cancellation investigation

## 1. Verdict

The local evidence does **not** show a leaked Jest handle holding the parent Nx process open after Nx reports success. The normal parallel runs reproduce Jest's warning, but Jest's implementation force-terminates any test worker that takes more than 500 ms to exit and waits for it; all local Nx commands then return normally. `--detectOpenHandles --runInBand` found no handle in either `@ptah-extension/cli-engine` or `@ptah-extension/agent-sdk`. It found one real, named `Timeout` in `@ptah-extension/cli-agent-runtime`: the fire-and-forget OpenRouter pricing warmup started by a DI smoke test. That timeout is inside the Jest process and is bounded to 10 seconds, so it explains a worker warning, not a parent Nx process that remains alive indefinitely. There are genuine unjoined production teardown defects in the inspected code, but none was observed as the handle behind these CI endings. The final `##[error]The operation was canceled.` is therefore more consistent with an external GitHub Actions cancellation arriving after Nx printed its verdict. The configured concurrency rule remains a live candidate: “one CI run per commit” does not rule it out, because one run for a *newer commit on the same PR* has the same concurrency group and cancels the older run. Without run overlap/cancellation metadata, the exact external actor cannot be determined.

## 2. Evidence

All commands below were run from `D:\projects\ptah-extension\.claude-worktrees\deploy-blockers`, one Nx project per command, with Nx cache bypassed where applicable. ANSI colour codes are omitted from the excerpts.

### `@ptah-extension/cli-engine`

Command:

```text
npx nx run "@ptah-extension/cli-engine:test" --detectOpenHandles --runInBand --skip-nx-cache
```

Result (wall time 63.3 s):

```text
Test Suites: 17 passed, 17 total
Tests:       169 passed, 169 total
Snapshots:   0 total
Time:        59.554 s, estimated 545 s
Ran all test suites.
NX   Successfully ran target test for project @ptah-extension/cli-engine
```

Jest printed **no open-handle section**.

The ordinary worker-mode run did reproduce the reported warning:

```text
npx nx run "@ptah-extension/cli-engine:test" --skip-nx-cache

A worker process has failed to exit gracefully and has been force exited.
This is likely caused by tests leaking due to improper teardown. Try running
with --detectOpenHandles to find leaks. Active timers can also cause this,
ensure that .unref() was called on them.
Test Suites: 17 passed, 17 total
Tests:       169 passed, 169 total
Time:        15.895 s, estimated 48 s
NX   Successfully ran target test for project @ptah-extension/cli-engine
```

This warning is not evidence that Nx remains alive. Installed Jest calls `worker.end()`, and `jest-worker` force-exits a worker after `workerGracefulExitTimeout ?? 500` ms (`node_modules/jest-runner/build/index.js:567-575`; `node_modules/jest-worker/build/index.js:551-574`).

### `@ptah-extension/agent-sdk`

Command:

```text
npx nx run "@ptah-extension/agent-sdk:test" --detectOpenHandles --runInBand --skip-nx-cache
```

Result (wall time 72.8 s):

```text
Test Suites: 1 skipped, 86 passed, 86 of 87 total
Tests:       2 skipped, 1472 passed, 1474 total
Snapshots:   0 total
Time:        67.968 s, estimated 508 s
Ran all test suites.
NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

Jest printed **no open-handle section**.

The ordinary run reproduced the same forced-worker warning and took 17.159 s. A capped run did not print the warning:

```text
npx nx run "@ptah-extension/agent-sdk:test" --maxWorkers=4 --skip-nx-cache

Test Suites: 1 skipped, 86 passed, 86 of 87 total
Tests:       2 skipped, 1472 passed, 1474 total
Time:        8.084 s, estimated 47 s
NX   Successfully ran target test for project @ptah-extension/agent-sdk
```

This supports “worker took more than Jest's 500 ms graceful-exit allowance under high fan-out,” not an indefinitely live Nx parent.

### `@ptah-extension/cli-agent-runtime`

Command:

```text
npx nx run "@ptah-extension/cli-agent-runtime:test" --detectOpenHandles --runInBand --skip-nx-cache
```

Result (wall time 51.5 s):

```text
Test Suites: 51 passed, 51 total
Tests:       1 skipped, 658 passed, 659 total
Time:        46.516 s
Ran all test suites.

Jest has detected the following 1 open handle potentially keeping Jest from exiting:

  ●  Timeout

      201 |   private async httpJson<T>(url: string): Promise<T> {
      202 |     const controller = new AbortController();
    > 203 |     const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
          |                   ^
      204 |     try {
      205 |       const res = await fetch(url, {
      206 |         method: 'GET',

      at OpenRouterPricingService.httpJson
        (../auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:203:19)
      at OpenRouterPricingService.fetchCatalog
        (../auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:154:31)
      at OpenRouterPricingService.ensureCatalog
        (../auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:136:25)
      at OpenRouterPricingService.fetchAndRegister
        (../auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:94:32)
      at OpenRouterPricingService.warmup
        (../auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:67:31)
      at warmupPricing (../auth-providers/src/lib/di/register.ts:166:13)
      at registerAuthProvidersServices (../auth-providers/src/lib/di/register.ts:117:3)
      at buildSmokeContainer
        (src/lib/di/register.ptah-cli-registry.smoke.spec.ts:133:32)
      at Object.<anonymous>
        (src/lib/di/register.ptah-cli-registry.smoke.spec.ts:147:17)
```

The focused reproduction gave the same single handle:

```text
npx jest --config libs/backend/cli-agent-runtime/jest.config.ts \
  --runTestsByPath libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts \
  --detectOpenHandles --runInBand

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Time:        2.571 s, estimated 20 s
Jest has detected the following 1 open handle potentially keeping Jest from exiting:
  ●  Timeout
```

The ordinary `cli-agent-runtime` run also printed the forced-worker warning. It took 47.03 s, versus 46.516 s serial: default worker fan-out produced no speedup for this project on this host.

### Coverage and process exit

`cli-engine` coverage completed and returned to the shell locally in both default and capped worker modes:

```text
npx nx run "@ptah-extension/cli-engine:test" --coverage --skip-nx-cache
Test Suites: 17 passed, 17 total
Tests:       169 passed, 169 total
Time:        67.016 s
NX   Successfully ran target test for project @ptah-extension/cli-engine
```

A warm-cache repeat took 16.871 s and printed the forced-worker warning. With two Jest workers it took 9.236 s and printed no warning:

```text
npx nx run "@ptah-extension/cli-engine:test" --coverage --maxWorkers=2 --skip-nx-cache
Test Suites: 17 passed, 17 total
Tests:       169 passed, 169 total
Time:        9.236 s, estimated 344 s
NX   Successfully ran target test for project @ptah-extension/cli-engine
```

The 67.016-to-9.236 comparison is confounded by Jest transform/coverage cache warmup, so it is not a valid isolated speedup claim. The warm 16.871-to-9.236 comparison is the useful directional result, but is still only one sample. The local host reported:

```json
{"availableParallelism":16,"cpus":16,"totalmemGiB":"27.86","freememGiB":"14.02"}
```

No tested coverage command hung after Nx's verdict. This rules against a deterministic V8/Babel coverage-writer hang in these projects.

## 3. Creation sites

### Handle actually reported by Jest: OpenRouter request timeout

- Creation: `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:201-212`; the reported handle is the ref'd `setTimeout` at line 203. `REQUEST_TIMEOUT_MS` is 10,000 ms at line 13.
- Normal close: `httpJson` clears the timeout in `finally` at `openrouter-pricing.service.ts:231-233`, but only after `fetch` settles or aborts.
- Why the test leaks it: `registerAuthProvidersServices` unconditionally starts a void-returning pricing warmup at `libs/backend/auth-providers/src/lib/di/register.ts:117` and `:161-166`. `buildSmokeContainer` calls that registration in each `beforeEach` at `libs/backend/cli-agent-runtime/src/lib/di/register.ptah-cli-registry.smoke.spec.ts:133,146-148`, without mocking `fetch`, awaiting warmup, aborting it, or disposing the container afterward. The test ends while the real network fetch and its abort timeout are still live.
- Exact missing test control: this DI smoke test should stub `global.fetch` to a settled response before `buildSmokeContainer` and restore it in `afterEach`. Clearing container instances is useful isolation hygiene, but tsyringe cannot abort or join the already-started warmup, so it does not close this handle. A stronger production contract is for `OpenRouterPricingService` to own the active `AbortController` and expose `dispose()` that aborts and joins any warmup; merely calling the existing `clearCache()` does not abort an in-flight request. Calling `timer.unref()` prevents the timeout itself from keeping a process alive, but does not close an in-flight socket and is therefore incomplete on its own.

### Lifecycle defects found by trace but **not** reported by these Jest diagnostics

These are real teardown risks and should be fixed, but they must not be relabelled as the proven cause of the CI cancellation:

- `SdkAgentAdapter.dispose()` is fire-and-forget: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:526-540` returns `void` while starting `disposeAllSessions().catch(...).finally(...)`. `withEngine` awaits that void at `libs/backend/cli-engine/src/lib/bootstrap/with-engine.ts:432-445`, then clears DI instances at `:547-550`. Missing join: make `SdkAgentAdapter.dispose(): Promise<void>` await `disposeAllSessions()` and run `sessionLifecycle.dispose()` in `finally`; `disposeSdkAdapter` at `with-engine.ts:432-445` is already the correct caller on both normal (`:416-421`) and SDK-init-failure (`:344-346`) paths.
- Losing `Promise.race` timers are never cleared: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:80-88` (3 s), `:218-226` (5 s), and `:306-320` (5 s per live query). If `interrupt()` wins, the ref'd timeout remains until expiry. Missing teardown: retain each timer, clear it in `finally`, and `unref()` it defensively.
- `OffThreadProcessSpawner` creates a `Worker` at `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:294`, tracks workers at `:593-595,671-678`, and provides the required async join at `:687-698`. It is a singleton registered at `libs/backend/agent-sdk/src/lib/di/register.ts:315-319`, but no production host calls `dispose()`. Missing teardown: after awaited SDK/session and CLI-agent shutdown, resolve `SDK_TOKENS.SDK_PROCESS_SPAWNER` in the `withEngine` finally path and await `dispose()` before `runDispose` clears instances.
- `PtahCliRegistry.disposeAll()` clears ownership and calls `void lease.stop()` at `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:879-888`. The lease stop awaits a real proxy/server stop at `:1176-1192`. `shutdownHostRuntime` awaits `disposeAll`, but currently receives `undefined` (`libs/backend/cli-engine/src/lib/bootstrap/shutdown-host-runtime.ts:62-78,113-132`). Missing teardown: make `disposeAll(): Promise<void>` await all unique `lease.stop()` calls; retain the existing exact teardown site in `shutdownHostRuntime`.
- `CronScheduler.start()` arms each Cron timer at `libs/backend/cron-scheduler/src/lib/cron-scheduler.ts:119-125,247-266` before setting `started = true`. If a later timer creation throws, prior timers remain, but `stop()` returns early because `started` is false (`:133-141`). `activateThoth` then catches and discards the scheduler reference at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:345-358`. Missing teardown: make `start()` exception-safe by stopping/clearing already-created timers in `catch` before rethrowing; `stop()` should also clean `timers` even when `started` is false.
- `SqliteConnectionService.openAndMigrate()` creates the database at `libs/backend/persistence-sqlite/src/lib/sqlite-connection.service.ts:197-204`, but does not assign `this.database` until line 210. This is a theoretical unexpected-exception gap, not a demonstrated operational leak: `applyPragmas`, vector loading, and health probes catch their expected failures internally (`sqlite-connection.service.ts:555-565,573-592,653-688`). If an unexpected throw nevertheless escapes between factory creation and ownership assignment, `close()` at `:505-531` cannot reach the local handle and `activateThoth` discards the failed reference at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:93-107`. Defensive hardening would wrap all post-factory initialization in `try/catch` and close the local `db` before rethrowing, or assign ownership immediately and call the idempotent service `close()` on failure.

The normal CLI Thoth shutdown order itself is sound and explicit: push bridges, chat bridge, gateway, cron, skill trigger/service, memory trigger/service, embedder, SQLite at `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:147-184`; `withEngine` invokes it in `finally` at `with-engine.ts:393-421`.

## 4. Does this explain the CI cancel

### Argument that a leak is plausible

The code has resources capable of keeping Node alive: ref'd timers, listening translation-proxy sockets, worker threads, subprocesses, Cron timers, and SQLite handles. Several teardown contracts are unjoined or exception-unsafe. The supplied cleanup line `Terminate orphan process: pid (5311) (MainThread)` proves that at least one descendant survived far enough for the Actions runner's post-job sweep in run 102148697007. A descendant that inherits an Actions-captured stdout/stderr pipe can also delay pipe EOF after its parent exits.

### Argument against the observed Jest leak being the cancellation cause

The actual diagnostics are decisive for the three required projects:

1. `cli-engine` and `agent-sdk` expose no live handle in serial Jest diagnostics.
2. The one reported `cli-agent-runtime` timeout is bounded to 10 seconds and runs inside Jest.
3. In normal mode, Jest does not leave that worker around indefinitely: installed `jest-worker` sends the end message, waits 500 ms, force-exits the worker, and awaits its exit (`node_modules/jest-worker/build/index.js:551-574`). The warning is printed only after that cleanup returns (`node_modules/jest-runner/build/index.js:567-575`).
4. Every local Nx command, including coverage, returned normally after printing the Nx success verdict.
5. The Nx daemon is disabled automatically in CI unless `NX_DAEMON=true` (`node_modules/nx/src/daemon/client/client.js:82-109`). The workflow does not set it; it sets only `NX_TUI=false` at `.github/workflows/ci.yml:24-32`. `nx.json:82-89` registers only the ESLint plugin, not a test inference plugin. The Nx daemon/plugin theory therefore has little support.
6. Nx prints `Successfully ran ...` in the lifecycle's `endCommand()` only after its Jest-backed tasks have returned (`node_modules/nx/src/tasks-runner/life-cycles/static-run-many-terminal-output-life-cycle.js:52-68`; `node_modules/nx/src/tasks-runner/default-tasks-runner.js:56-64`). A surviving arbitrary descendant is possible, but the tested parent command did not wait on one locally.

### Committed answer

The leaked-Jest-worker hypothesis is **not supported as the cause of these CI cancellations**. It explains the warning, not `##[error]The operation was canceled.` The Actions runner message requires a cancellation token from outside the completed Nx task graph: concurrency, a user/API cancellation, runner/service interruption, or an unshown higher-level policy.

The concurrency reasoning in the prompt is incomplete. `.github/workflows/ci.yml:15-18` groups every run for one PR as `ci-<PR number>` with `cancel-in-progress: true`. Exactly one run per commit rules out duplicate runs for the same SHA; it does **not** rule out the one run for commit B canceling the still-running one run for earlier commit A on the same PR. To rule concurrency out, compare each canceled run's end timestamp with the creation/queue timestamp of every later run on that PR, including manual reruns; cancellation can occur while the replacement is queued, before its `run_started_at`. That run inventory was not supplied and cannot be fetched under this task's constraints.

The pass/fail pattern is consistent with an external race. A failed test usually ends the job promptly, reducing the interval in which a later same-PR run can cancel it. A successful test proceeds toward later CI steps and leaves a longer interval. Run 102148697007 is not a contradiction: an external cancellation can arrive after Nx has already produced a failed target result but before the Actions shell/job wrapper has finalized it. Run 102173721253 exited cleanly because its failure reached `exit 1` before such a cancellation arrived.

Resource exhaustion is a credible cause of slowness but a weak cause of the cancellation annotation. The supplied logs contain no OOM, exit 137, ENOSPC, disk annotation, signal, or runner-lost message. Coverage-specific flushing is also weak: local coverage completed, and the warning appeared inconsistently across warm/cold coverage runs rather than at a unique coverage-writer stack.

## 5. The `cli-engine` slowness

The evidence supports a separate resource-contention problem, not a leaked-handle delay:

- `.github/workflows/ci.yml:131-132` permits up to three Nx test tasks concurrently.
- Nx `--parallel=3` limits Nx tasks, not Jest workers. Each test task launches its own Jest coordinator. No repository Jest config sets `maxWorkers`.
- Installed Jest defaults each pool to `availableParallelism() - 1` workers (`node_modules/jest-worker/build/index.js:1842-1848`). The actual CI worker count is not in the supplied logs. On the measured local host, one default pool can use 15 workers; three concurrent Nx projects can therefore request up to 45 Jest workers plus coordinators and any application subprocesses.
- Coverage instruments code and aggregates/writes reports in every project, increasing CPU, memory, and I/O demand.
- `libs/backend/cli-engine/src/lib/platform/cli-platform-commands.spec.ts:50-76` documents that six specs deliberately spawn real cold Node children. The repository's recorded CI observation is 140.33 s for that file under `--parallel=3 --coverage`, with every `cli-engine` suite at 114-250 s. The creation site is `libs/backend/cli-engine/src/lib/platform/cli-platform-commands.ts:119-180` (`cross-spawn` at line 132). This is real-process startup competing with the nested Jest/coverage workload, not a wait for a leaked handle after the tests finish.
- Locally, warm `cli-engine --coverage` was 16.871 s with default workers and 9.236 s with `--maxWorkers=2`. `agent-sdk` fell from 17.159 s with the warning to 8.084 s with `--maxWorkers=4` and no warning. Those are single-host samples, but they demonstrate oversubscription sensitivity. The cold 67.016 s coverage run must not be used as an isolated worker-cap comparison because Jest cache warmup differs.

Conclusion: `cli-engine` CI slowness is most plausibly nested parallelism plus coverage and real child-process startup under a constrained/contended runner. It may increase the probability of overlapping a later PR push and triggering the concurrency rule, but it is not evidence that the test process remains alive after completion.

## 6. Recommendations

1. **First diagnose the actual cancellation source (highest priority, no code workaround).** For each affected run, compare its cancellation time with the creation/queue time of every later run on the same PR/concurrency key; inspect the Actions UI/API/audit metadata for the cancellation actor and runner-loss/service messages. Add timestamps around the CI test command and a guaranteed shell `trap`/post-step diagnostic if another reproduction is needed. This is the only action that can confirm concurrency versus manual/platform cancellation.

2. **Performance/robustness fix: bound the two levels of parallelism.** Keep Nx at three projects only if each Jest invocation is capped; add `--maxWorkers=2` to the CI command as the first trial, or set an explicit CI-only Jest worker limit through the Nx Jest target configuration. Cost: possibly slower small projects on large runners, but substantially lower peak RAM/process count and more predictable execution. Measure the full affected set before choosing 1, 2, or a percentage. This is a real fix for the measured slowness/resource amplification and can reduce concurrency overlap; it is not a direct fix for external cancellation.

3. **Real leak fix: remove the network warmup from the DI smoke test.** In `register.ptah-cli-registry.smoke.spec.ts`, install a settled `global.fetch` stub before `buildSmokeContainer`, restore it and clear the child container after every test. Separately give `OpenRouterPricingService` abortable/awaitable disposal and unref its request timeout. Cost: small API/test change; benefit: removes the only handle Jest actually named and prevents unit tests from performing live network I/O.

4. **Real lifecycle fix: make teardown awaitable end to end.** Make `SdkAgentAdapter.dispose()` async; await `disposeAllSessions`; clear losing race timers; make `PtahCliRegistry.disposeAll()` await proxy stops; and await `OffThreadProcessSpawner.dispose()` in both `withEngine` teardown paths before clearing DI. Exact sites are listed in section 3. Cost: public lifecycle signatures and tests must be updated, and shutdown can now wait up to the intentional interrupt bounds instead of returning early. Benefit: closes worker, process, socket, and timer ownership deterministically.

5. **Real exception-safety fix:** clean partially armed Cron timers when `start()` throws and close locally created SQLite databases when initialization throws before ownership assignment. Cost: focused service/spec changes. These are correctness fixes, but no observed diagnostic connects them to these CI runs.

6. **`--forceExit` workaround: do not ship it for this incident.** Jest already force-exits non-graceful test workers. Adding `--forceExit` forces the Jest coordinator to terminate after results, can cut off pending async cleanup/coverage writes, hides regressions, and still cannot prevent GitHub from externally canceling the Actions step. It would be defensible only as a short-lived emergency workaround if a reproduction proved the *Jest coordinator* was the process stuck after results. The present reproduction proves the opposite, so its cost is not justified.

7. **Optional CI clarity:** set `NX_DAEMON=false` explicitly. Nx already disables it under CI, so this changes no expected behavior; it only makes the invariant visible in logs/config. Do not expect it to fix the incident.

## 7. What I could not determine

- The exact cancellation actor/source. This needs GitHub run timing, concurrency, audit, and runner metadata that the task explicitly made unavailable.
- Whether a later commit or manual rerun started on the same PR at each canceled run's end. “One run per commit” is insufficient to answer that question.
- The identity of orphan PID 5311 named `MainThread`. A cleanup line alone cannot distinguish a Jest worker, Node worker thread host, child CLI, proxy helper, or unrelated descendant; the needed evidence is a `ps`/`pstree` snapshot with command line and parent PID before runner cleanup.
- Live Linux handle inventory for the exact 24-project `nx affected --coverage --parallel=3` process tree. The three required local Windows diagnostics do not reproduce the Actions runner environment or the full affected graph.
- Actual CPU, RAM, disk, and process-count telemetry from the canceled jobs. Without it, resource contention is supported by timing and architecture but resource exhaustion cannot be proven.
- Which individual suite caused the generic forced-worker warning in `cli-engine` or `agent-sdk`. Serial `--detectOpenHandles` found none, and reducing worker count removed the warning in the measured `agent-sdk` run. Jest's warning means a worker missed a 500 ms exit deadline; it does not include the worker PID or suite name. Identifying it would require per-suite worker lifecycle instrumentation or repeated bisection under the exact CI host load.
- Whether the supplied CI per-suite durations are repeatable. I report them as repository/run evidence, not as measurements I took. My measured numbers are the whole-project local times quoted above.

---

## 8. Outcome (appended 2026-09-08, after the fix shipped)

**The cause was oversubscription. `--maxWorkers=2` fixed it.**

Sections 1-7 above were written before the fix ran, and they name the wrong
front-runner. Section 4 committed to "an external cancellation" and kept the
concurrency rule as the live candidate; section 6 ranked bounding parallelism
as recommendation 2, a fix for the measured slowness rather than for the
cancellation, and called resource exhaustion "a credible cause of slowness but
a weak cause of the cancellation annotation." That ranking was inverted. The
recommendation filed as the secondary one is what closed the incident. The
analysis behind it was correct; only its position in the list was wrong.

### The concurrency candidate is refuted, not merely unproven

Section 4 was right that "one run per commit" is insufficient, and right that
it needed the run inventory to decide. That inventory was fetched afterwards:

```
3019af337   created 18:27:02   killed 18:43:48
ec2a30d7c   created 17:51:03   killed 18:05:35
```

No cancelled run has ANY later run on its pull request — the group `ci-<PR>`
was empty for the whole window in every case. And the run conclusion is
`failure`, not `cancelled`; a concurrency cancellation sets the latter.
Concurrency is out.

### The measurement that settles it

One line changed in the CI test step:

```
npx nx affected -t test --coverage --parallel=3
node node_modules/nx/bin/nx.js affected -t test --coverage --parallel=3 --maxWorkers=2
```

(The binary swap is unrelated — it answers `githubactions:S6505`, which fired
because editing the line made it new code to the scanner.)

| | Before | After |
|---|---|---|
| Runs where Nx SUCCEEDED | 4 of 4 ended `The operation was canceled.` | 0 |
| PR #467 CI | cancelled | **pass** |
| PR #468 CI | cancelled | **pass, 10m17s** |

Both pull requests merged on the first run carrying the cap.

### Why the 140 ms timing misled

The gap between Nx's success line and the kill was 141-224 ms across six runs,
which correctly ruled out a hang and therefore a leaked handle — section 1 and
section 4 are sound on that, and the `--detectOpenHandles` evidence stands. But
a short gap does not imply an EXTERNAL actor. It is equally consistent with the
runner terminating a process tree that had, moments earlier, been holding three
Jest coordinators and up to ~45 workers plus coverage writers. The peak is at
the end of the run, not spread through it, which is why the kill always landed
at the finish line and only on the successful path — a failing run tears down
before reaching that peak.

Resource telemetry, still unavailable, would name the exact mechanism. It is no
longer needed to act.

### What stays open

Nothing blocking. The teardown defects catalogued in section 3 are real and
unrelated to this incident: `SdkAgentAdapter.dispose()` is not awaitable,
`PtahCliRegistry.disposeAll()` does not await proxy stops, and Cron timers are
left armed when `start()` throws. They deserve their own task and did not cause
these cancellations.
