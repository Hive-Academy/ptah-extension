# Code Logic Review — `TASK_2026_437_0778` Batch 13 (C12 reusable bounded spawn workers)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 7/10                                 |
| Assessment          | APPROVE_WITH_FIXES                   |
| Blocking issues     | 0                                    |
| Serious issues      | 1                                    |
| Moderate issues     | 3                                    |
| Failure modes found | 4                                    |

Scope reviewed: `off-thread-process-spawner.ts` (full file, 1017 lines), `off-thread-process-spawner-source.ts`
(full file, 301 lines), `off-thread-process-spawner.spec.ts` (full file, 752 lines), `agent-sdk/CLAUDE.md`
(diff only). `npx nx run-many -t test -p @ptah-extension/agent-sdk` was run from `D:\projects\ptah-437`:
104/106 suites, 1847/1850 tests pass (3 skipped are the opt-in perf specs), 0 failures.
`npx nx run-many -t typecheck,lint -p @ptah-extension/agent-sdk` is clean for these three files (0 errors;
the 42 warnings reported are all pre-existing, in unrelated files).

## Five logic questions

### 1. How does this fail silently?

- **Stdin writes after the lease is gone report success.** `WorkerBackedProcess.stdin`'s `Writable.write`
  (`off-thread-process-spawner.ts:524-529`) calls `this.post(...)` then unconditionally `callback()`.
  `post()` (`:806-820`) silently no-ops when `this.lease` is `null` — which is true after `teardown()`
  runs on ANY terminal path (`finish`, `fail`, grace-timeout, `forceTerminate`). A caller that writes to
  `stdin` after the worker died mid-session (`onWorkerLost`, `:624-634`) or after `forceTerminate()`
  (`:606-617`) gets a normal `callback()` with no error — the data is silently dropped, not rejected.
- **`exitCode` never leaves `null` on the crash/abandon paths.** `code`/`exitSignal` are set only in
  `finish()` (`:686-697`, a real `exit` message). `onWorkerLost`, `forceTerminate` and the grace-timeout
  abandon path all go through `fail()` (`:699-707`) or `emitClose()` directly without ever touching
  `this.code`. The file header documents rule 2 — "`exitCode` stays `null` until the child actually
  exits… the SDK gates every stdin write on `process.exitCode !== null`" — but on these paths the
  process is definitely gone and `exitCode` still reads `null` forever. Combined with the point above, a
  consumer that follows the SDK's own documented gate can keep believing the process is writable
  indefinitely after a worker crash.
- **Over-cap spawns are undercounted for anyone reading the shared degradation ledger.**
  `SpawnWorkerPool.noteOverCap()` (`:452-470`) only calls `this.logger.warn(...)`; it never reports through
  `DegradationReporter` (`libs/backend/vscode-core/src/logging/degradation-reporter.ts`), so the per-boot
  `DegradationSnapshot` a host might inspect after a rough boot will show zero over-cap events even during
  a real spawn storm — see Serious-1 below.

### 2. What user action produces unexpected behaviour?

Running many CLI/git operations concurrently (e.g. a large multi-repo status refresh, or several
background lanes launching Claude queries at once) pushes live-worker count above `LIVE_WORKER_SOFT_CAP`
(24). This is handled — a new thread is still created and the launch is not blocked — but each such burst
creates full `Worker` V8 isolates with **no upper bound at all** (`create()`, `:413-417`, only warns, never
refuses). A user running an unusually large batch job sees no functional failure, but the host can mint an
unbounded number of isolates in a short window; the only signal is one rate-limited log line per minute.

### 3. What input data produces a wrong answer?

No input-shape bug was found in the pooling logic itself — the lease-id filtering
(`PooledSpawnWorker.attach`/`detach`/the `message.id === this.leaseId` check at `:307`, mirrored on the
worker side at `off-thread-process-spawner-source.ts:274-276`) is applied uniformly to every message type
in both directions, matches the protocol comment, and is exercised by a real-child test
("keeps two consecutive children on one worker apart", spec `:575-606`) that floods stdout/stderr on the
first child and asserts none of it reaches the second. Reused-worker teardown correctly refuses to pool a
worker unless `exitReported && !killedFlag && !abandoned` (`:786`), which covers killed, errored,
force-terminated and grace-abandoned children — all four are asserted by name in the spec file
(`:608-669`, `:671-712`).

### 4. What happens when a dependency fails?

- **Worker thread crashes under a live child** (`onWorkerLost`, `:624-634`): the child is SIGTERM'd
  directly by pid (bypassing the dead worker), the handle fails with `EWORKER`, and `close` fires — but
  no `exit` is ever emitted for this path (only `finish()` emits `exit`). The file header states "The SDK
  reads only `exit`" for its own seam; if that is accurate, a worker crash mid-query means the SDK never
  sees a terminal `exit` for the transport, only `error`. The spec that covers this
  (`:632-669`) only asserts `error` + `close`, not `exit`, so this is exercised but not proven safe against
  the SDK's actual completion logic — see Failure modes below.
- **Worker terminates cleanly while idle** (`PooledSpawnWorker.lose()` on a parked worker, sink is
  `null`): correctly removed from `idle` and terminated via `SpawnWorkerPool.onLost` (`:438-443`); no
  crash, no leak. Verified by inspection, not directly spec-covered (no test crashes an idle/parked
  worker), which is a coverage gap rather than a logic defect.
- **`dispose()` mid-spawn-storm**: `forceTerminate()` is called synchronously on every live handle before
  `this.live.clear()`, and each `forceTerminate()` routes through `teardown()` → `lease.release(false)` →
  `pool.track(worker.terminate())`, so every busy worker's termination is already tracked before
  `pool.dispose()` awaits `[...this.terminations]`. Traced by hand across `:408-471` and `:978-982`; no
  interleaving is possible because the whole sequence from snapshot to `live.clear()` is synchronous
  JavaScript. No defect found here.

### 5. What is missing that the requirements never mentioned?

- No hard ceiling on live worker threads under sustained storm (only a soft, warn-only cap) — explicitly
  a deliberate tradeoff per the file's own docstring (`:100-107`), but the plan text ("Reusable, bounded
  spawn workers") and the file's own name imply a bound the busy path does not actually have.
- No test exercises a stdin write, or a second `kill()`, after a worker crash/force-terminate to confirm
  the silent-drop behaviour in question 1 is acceptable versus a defect.
- No test kills an *idle* (parked) worker to confirm the pool's `onLost` path for that state actually
  fires in practice (traced by inspection only).

## Failure modes

### Silent stdin drop after worker loss

- Trigger: worker thread crashes mid-session (`onWorkerLost`) or host calls `forceTerminate()`, then the
  caller (the SDK or a rival-CLI adapter) writes to `child.stdin` afterward.
- Symptom: `stdin.write()` returns/callbacks as if it succeeded; the bytes never reach anything and no
  error surfaces.
- Evidence: `off-thread-process-spawner.ts:524-529` (unconditional `callback()`), `:806-820` (`post()`
  silently no-ops on `lease === null`).
- Current handling: none — this is the existing (pre-batch-13) contract, unchanged by this diff, but the
  pooling batch makes a mid-session worker loss during a longer-lived worker a materially more common
  runtime event than it was when every worker was single-use.
- Recommendation: destroy/error `this.stdin` when `fail()`/`forceTerminate()`/grace-abandon runs, so a
  post-mortem write surfaces as a stream error instead of a fabricated success.

### `exitCode` never settles on the crash/abandon paths

- Trigger: same as above — `onWorkerLost`, `forceTerminate`, or grace-timeout abandon.
- Symptom: `process.exitCode` (per the port's contract, `getter :589-591`) stays `null` forever, even
  though the process is unambiguously gone; any consumer that follows the SDK's own documented rule 2
  ("gates every stdin write on `exitCode !== null`") can be misled indefinitely.
- Evidence: `off-thread-process-spawner.ts:589-591` (`get exitCode`), `:699-707` (`fail()` never touches
  `this.code`), `:607-617` (`forceTerminate()` never touches `this.code`).
- Current handling: none on these paths (`finish()` is the only writer of `this.code`).
- Recommendation: set a sentinel non-null exit code (e.g. `1` or a documented negative value) on `fail()`
  and `forceTerminate()` so the documented "`exitCode !== null` means dead" contract holds under every
  terminal path, not only the happy one.

### Worker crash mid-query never emits `exit`

- Trigger: `PooledSpawnWorker`'s underlying `Worker` emits its own `'error'`/`'exit'` while a child is
  live and busy.
- Symptom: the handle emits `error` (code `EWORKER`) and `close`, but never `exit`. Per the file's own
  documented claim that "the SDK reads only `exit`", this could leave the SDK's completion/cleanup logic
  waiting on an event that will never arrive for this specific failure path.
- Evidence: `off-thread-process-spawner.ts:624-634` (`onWorkerLost` calls `fail()`, never `finish()`);
  header comment `:44-45` ("`spawn()` is the SDK's seam… `exit` only").
- Current handling: `error` + `close` only; spec `:632-669` proves this shape but does not assert against
  actual SDK consumption of it.
- Recommendation: confirm with the SDK's `ProcessTransport` (or a targeted integration test against the
  real `@anthropic-ai/claude-agent-sdk`) whether `error` alone is sufficient to unblock a `query()` in
  flight; if not, this is a real regression risk introduced by extending worker lifetime past a single
  child (a crash used to simply end that one child's one-shot worker with the same `error`-only shape, so
  behaviourally this is unchanged from before C12 — but worth a documented, verified answer rather than an
  assumption, since C12 is the reason worker crashes with a live child are no longer a corner case tied to
  process teardown).

### Over-cap spawn storms are invisible to the shared degradation ledger

- Trigger: more than 24 concurrent busy workers.
- Symptom: the plan (`implementation-plan.md` component 12: "Live workers above 24 still spawn… but emit
  one `warn` per minute **and a degradation count**") calls for a degradation count; the implementation
  only logs `overCapSpawns` inside the rate-limited warn payload, never through
  `DegradationReporter.report()`.
- Evidence: `off-thread-process-spawner.ts:452-470` (`noteOverCap`, `logger.warn` only); no import of
  `TOKENS.DEGRADATION_REPORTER` or `DegradationReporter` anywhere in `agent-sdk/src` (confirmed by grep).
  Compare `libs/backend/vscode-core/src/logging/degradation-reporter.ts:1-35`, which documents itself as
  "the one place the per-boot counts live" and is already registered platform-agnostically
  (`register-platform-agnostic.ts:115-141`), so wiring it here adds no new dependency edge.
- Current handling: a private, unreported counter (`overCapSpawns`) that only ever reaches a log line, not
  the boot-summary/renderer-facing degradation feed the rest of the repo uses for this exact signal class.
- Recommendation: inject `TOKENS.DEGRADATION_REPORTER` into `OffThreadProcessSpawner`/`SpawnWorkerPool` and
  call `.report({ source, code: 'spawn-worker-soft-cap', severity, summary })` alongside the existing warn,
  or explicitly amend the plan/CLAUDE.md if the warn-only approach is the accepted resolution — as written,
  the code does not match the plan's own stated acceptance bar.

## Blocking issues

None found.

## Serious issues

### Plan-mandated degradation count not wired to the shared reporter

- File: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.ts:452-470`
- Scenario: a spawn storm pushes live workers above 24 repeatedly across a session.
- Impact: anyone relying on `DegradationReporter.snapshot()` (boot summary, `tools/degradation-audit`
  inventory, the renderer's degradation feed) to know the host degraded never learns about a spawn-storm
  event; the signal exists only in the log file, which is not what the repo's own degradation-reporting
  convention promises for a "degradation count".
- Fix: report through `DegradationReporter` as described above, or update `implementation-plan.md`
  component 12 / this review's expectation if the team decides the warn-only approach is sufficient.

## Moderate and minor issues

- **No hard cap on live worker threads** — `SpawnWorkerPool.create()` never refuses to create a new
  worker (`off-thread-process-spawner.ts:413-417`); explicitly a documented tradeoff, but worth a second
  look given Electron's shared-process memory budget under a genuine runaway spawn loop (bug, not just
  legitimate load).
- **Windows `SIGTERM` by pid does not kill the process tree** — `signalDirectly()`
  (`:795-804`) calls `process.kill(pid, signal)`, which on Windows terminates only the named process, not
  its descendants (e.g. helper processes `claude.exe`/git might spawn). Pre-existing, not introduced by
  this batch, but no spec proves grandchildren are reaped after a kill or an `EWORKER` failure.
- **No spec kills an idle/parked worker** to exercise `PooledSpawnWorker.lose()` while `sink === null`
  (`:360-368`) and confirm `SpawnWorkerPool.onLost` correctly drops it from `idle` (`:438-443`); verified
  by inspection only.
- **Minor**: `noteOverCap()`'s logged `busyWorkers: this.busy.size + 1` (`:465`) is correct but relies on
  the reader knowing `create()` runs before `this.busy.add()` in `acquire()`; a short inline comment at the
  call site would save the next reader the same trace this review did.

## Data flow

1. `spawn()`/`spawnProcess()` build a `SpawnPlan` and call `launch()` — OK, unchanged surface.
2. `launch()` constructs `WorkerBackedProcess`, which calls `pool.acquire(sink)` — OK, acquires an idle
   worker or creates one; soft-cap warning fires only on true creation, not reuse.
3. `pool.acquire` calls `worker.attach(sink)` — stamps a new lease id, `ref()`s the worker, clears any idle
   timer — OK, synchronous, no gap for a stray message to land under the wrong lease.
4. `WorkerBackedProcess` posts `{ type: 'spawn', ... }` — worker replaces `current` wholesale
   (`off-thread-process-spawner-source.ts:269-272`) — OK, no state from a previous child survives.
5. Worker posts `spawned`/`stdout`/`stderr(-chunk)`/`exit`/`error`, every message stamped with `state.id`
   — host's `PooledSpawnWorker` filters on `message.id === this.leaseId` before forwarding to the sink —
   OK, matches spec `:575-606`.
6. Child settles (`finish`/`fail`) → `armGrace()` bounds the drain wait → `maybeTeardown()`/grace timeout →
   `emitClose()` → `teardown()` → `lease.release(reusable)` — OK for the reuse decision itself; GAP for
   `exitCode`/`stdin` on the non-`finish` branches (see failure modes).
7. `pool.release(worker, reusable)` either parks the worker (`unref`, idle TTL armed) or terminates it,
   tracked in `terminations` for `dispose()` to join — OK, verified against the full test run and by hand
   for the `dispose()`-mid-storm race.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| One child per worker at a time, workers reused across sequential children | COMPLETE | — |
| ≤ `POOL_MAX_IDLE` (4) idle workers kept for `POOL_IDLE_TTL_MS` (30 s), unref'd | COMPLETE | — |
| Errored/exited/killed/force-terminated/grace-abandoned workers never pooled | COMPLETE | — |
| Above `LIVE_WORKER_SOFT_CAP` (24) busy, still spawn, warn ≤ once/min | COMPLETE | — |
| "...and a degradation count" (implementation-plan.md component 12) | PARTIAL | Count is a private field surfaced only in the log payload, not through `DegradationReporter` |
| `PTAH_SDK_INLINE_SPAWN=1` unchanged | COMPLETE | — |
| AC-8: 50 sequential git-like spawns create ≤ 4 workers | COMPLETE | Pinned by spec, passes |
| Lease id keeps two consecutive children apart | COMPLETE | Pinned by spec, passes |
| `dispose()` is a real join point for busy + idle workers | COMPLETE | Traced by hand, no test forces the interleaving directly |

Implicit requirements not addressed: worker crash under a live child never emits `exit`, only `error` +
`close` — whether that is sufficient for the real SDK's completion logic is asserted by this batch's
comments but not independently verified against the SDK itself.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Two sequential children share one worker | YES | Lease id filtering, fresh per-child state on `spawn` | None — spec-covered |
| Killed child's worker reused | NO (by design) | `killedFlag` forces `reusable = false` | None — spec-covered |
| Worker crashes with a live child | YES | `onWorkerLost` → `EWORKER`, direct SIGTERM, `error` + `close` | No `exit` emitted; SDK contract unverified |
| Worker crashes while idle/parked | YES (by inspection) | `lose()` → `onLost` removes from `idle`, terminates | Not spec-covered |
| Stdin write after worker/lease gone | NO | `post()` no-ops, `callback()` still fires | Silent data loss, no error surfaced |
| `exitCode` after crash/force-terminate | NO | Stays `null` forever | Violates the file's own documented rule 2 |
| Spawn storm > soft cap | Partially | New thread spawns, rate-limited warn | No hard ceiling; no shared degradation report |
| `dispose()` while spawns are in flight | YES | Traced synchronous termination + tracked promises | No spec exercises the exact interleaving |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH for the pooling/lease-id mechanics (real-child tests + full trace agree); MEDIUM for the
  worker-crash-mid-query `exit` question, which depends on SDK internals not present in this repo to
  verify directly.
- Top risk: a spawn-storm degradation event is invisible outside the log file, and a worker crash mid-query
  never emits the one event (`exit`) the file's own comments say the SDK reads — if that comment is
  accurate, a crashed worker could leave a query hung rather than failed.
- What a robust implementation would add: destroy/error `stdin` and settle a sentinel `exitCode` on every
  terminal path (not only `finish()`); report the soft-cap breach through `DegradationReporter` per the
  plan's own "and a degradation count" line; add a spec that kills an idle/parked worker and one that
  writes to `stdin` after a crash to pin the currently-silent behaviour either as accepted or as fixed.

## Delta review (review fixes)

Scope: only the fixes to the six items listed in this batch's follow-up request, read against current
code in `D:\projects\ptah-437` — `off-thread-process-spawner.ts` (792 lines),
`spawn-worker-pool.ts` (401 lines, new), `off-thread-process-spawner-source.ts`,
`off-thread-process-spawner.spec.ts`, `agent-sdk/CLAUDE.md`. Cross-checked against
`libs/backend/cli-agent-runtime/src` (adapters + DI smoke specs) and
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (`ProcessTransport.write`/`waitForExit`, read
directly since the package is minified — no source map in this tree). `npx nx run-many -t test -p
@ptah-extension/agent-sdk @ptah-extension/cli-agent-runtime` run from `D:\projects\ptah-437`:
agent-sdk 1857/1860 passing (3 opt-in perf specs skipped), cli-agent-runtime 907/908 passing (1
skipped), 0 failures in either.

### 1. Extraction to `spawn-worker-pool.ts`

Done and matches the facade rule. `OffThreadProcessSpawner` (`off-thread-process-spawner.ts:636`) keeps
its name, DI token and both public methods (`spawn`, `spawnProcess`); `SpawnWorkerPool` is injected as a
plain collaborator built in the constructor (`:651`), not registered separately in `register.ts`. Pool
constants (`POOL_MAX_IDLE`, `POOL_IDLE_TTL_MS`, `LIVE_WORKER_SOFT_CAP`, `LIVE_WORKER_HARD_CAP`) are
exported from `spawn-worker-pool.ts:39-60` and not re-exported through the spawner file or a lib barrel —
confirmed by grep, nothing re-exports them. Both style and logic concerns from the base review are
addressed by the split; no new finding here.

### 2. `DegradationReporter` via optional DI injection

Wired correctly. `OffThreadProcessSpawner`'s constructor
(`off-thread-process-spawner.ts:641-652`) uses `@inject(TOKENS.DEGRADATION_REPORTER, { isOptional:
true })`, same shape as `backup.service.ts:180`. `register.ts:334` still registers
`OffThreadProcessSpawner` with `{ useClass: OffThreadProcessSpawner }` — an `@injectable()` class with an
optional token resolves to `null` when nothing bound it, so this does not require every host to register
the reporter. Both direct `new OffThreadProcessSpawner(...)` call sites left in the tree —
`off-thread-process-spawner.spec.ts:157-160` (passes a fake reporter) and
`off-thread-process-spawner.perf.spec.ts:85` (passes only the logger, relying on the `= null` default) —
are test files, not host bootstrap code; both compile and run, confirming the constructor signature
change is source-compatible for a positional second argument. `register.compaction-boundary-registry.smoke.spec.ts`
still resolves `OffThreadProcessSpawner` end to end through `registerSdkServices` without registering
`DEGRADATION_REPORTER`, and the suite passes, so the optional-token path is exercised, not just claimed.
Codes (`agent.spawn-worker.soft-cap`, `agent.spawn-worker.hard-cap-inline`,
`spawn-worker-pool.ts:66-67`) are stable string literals, never interpolated, matching the file's own
comment. Rate limiting is shared between the log line and the report (`noteBreach`,
`spawn-worker-pool.ts:389-400`, one `CapBreach` per cap, `CAP_REPORT_INTERVAL_MS = 60_000`) — both fire
together or not at all, so "≤1/min" holds for the report as well as the warn. No finding.

### 3. `LIVE_WORKER_HARD_CAP = 64` inline fallback

`admit()` (`spawn-worker-pool.ts:272-296`) returns `false` only when `idle.length === 0 &&
busy.size >= 64`; `OffThreadProcessSpawner.launch()` (`off-thread-process-spawner.ts:727`) routes a
refusal straight to `spawnInline()`, which calls `childProcess.spawn` synchronously on the calling
thread — yes, this blocks the main thread, and the file's own comment (`spawn-worker-pool.ts:17-20`,
`off-thread-process-spawner.ts:1-20`) says so explicitly: "Blocking one launch beats an out-of-memory
host." That is a deliberate, documented degraded mode, not an oversight, and it is bounded in the sense
that matters: it only engages when 64 threads are already busy, which the file's own comment ties to "far
above any legitimate load (the git gate allows 4 concurrent children)" — so reaching it is itself a signal
something is already wrong, and the fallback is the same code path (`spawnInline`) already proven for
`PTAH_SDK_INLINE_SPAWN=1` and worker-creation failure. One caveat the review flags: the hard-cap report is
`severity: 'critical'` and rate-limited to once a minute (`noteBreach`), so if the busy count stays at or
above 64 for an extended storm, every launch after the first reported one blocks the main thread with no
further degradation signal until the next window — the *first* blocking launch is reported, not every one
that follows. That matches the "≤1/min" requirement for the report itself, but is worth naming as a gap
between "reported once" and "happening repeatedly and silently in between." Moderate, not blocking — the
log line still exists per event via `noteBreach`'s `warn`, also rate-limited the same way, so the operator
signal is throttled but not literally silent forever.

### 4. Tree-kill helper claim

Confirmed accurate. `killProcessTree` (`cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:44-70`)
is the one process-tree-kill implementation in `cli-agent-runtime`, and it is not exported from
`agent-sdk` or any lib `agent-sdk` can depend on under the hexagonal layering (`cli-agent-runtime` sits
above `agent-sdk`, not below it, so the dependency would be backwards). `exec-git.ts:398` is not a
tree-kill implementation — it is a `GitChildHandle` interface comment; the actual tree-kill in that file
is a separate, private `taskkill` spawn at `exec-git.ts:482` (`spawn('taskkill', ['/F', '/T', '/PID', ...])`),
duplicating the same idea `killProcessTree` implements, with no shared helper between the two. The claim
in `off-thread-process-spawner.ts:354-357` ("every tree-kill helper in the repo is private to another lib
… that gap is recorded, not papered over here") is accurate as written.

### 5. Dead idle worker spec

Present and correctly targeted. `off-thread-process-spawner.spec.ts:816-830` ("drops a parked worker that
dies and lends a healthy one next") parks a worker, calls `.terminate()` on it while idle (simulating the
thread dying with nothing leased), and asserts the next `acquire()` does not hand back the dead worker —
exercising exactly the `PooledSpawnWorker.lose()` / `SpawnWorkerPool.onLost` path the base review flagged
as untested. Closes that gap.

### 6. Failure-mode fixes

**(a) Stdin after loss.** `endAbnormally()` (`off-thread-process-spawner.ts:377-393`) now calls
`this.stdin.destroy()` before settling, so a write after crash/force-terminate/grace-abandon returns
`false` and calls back with `ERR_STREAM_DESTROYED` (`spec.ts:132-147`, `:699`) instead of a fabricated
success. On the "unhandled `'error'` on a destroyed stream crashes the process" concern specifically: a
bare `Writable.destroy()` with no error argument does not itself emit `'error'` (only `'close'`), and no
`'error'` listener is attached to `this.stdin` anywhere in `WorkerBackedProcess` — so the risk is confined
to whether anything calls `.write()` on the now-destroyed stream afterward. Traced every writer: the SDK's
own `ProcessTransport.write()` (`sdk.mjs:308857`, read directly) gates with
`if(this.process?.killed||this.process?.exitCode!==null)throw Error(...)` and throws *before* touching
`stdin.write` at all, so the SDK path never reaches the destroyed stream. The one non-SDK direct writer
found, `pi-cli.adapter.ts:319-330` (`writeRequest`), guards with `if (child.stdin?.writable)` inside a
`try/catch` — `Writable.writable` becomes `false` once `destroyed` is `true`, so this guard also skips the
write. No live code path was found that calls `.stdin.write()` without first checking `killed`/`exitCode`/
`writable`, so the unhandled-`'error'`-crashes-the-process scenario is not currently reachable. This is a
property of every caller being careful, not of the stream itself being safe — a future caller that skips
the check would still hit an unhandled `'error'` throw, since `this.stdin` still has no `'error'` listener
of its own. Moderate, not blocking: recommend adding one no-op `this.stdin.on('error', () => undefined)`
in the `WorkerBackedProcess` constructor as defense-in-depth, matching the pattern already used for `this`
itself (`:254`).

**(b) `exitCode` sentinel.** Every non-`finish()` terminal path (`fail()`, `:458-468`; `endAbnormally()`,
`:377-393`, covering `onWorkerLost`, `forceTerminate`, and grace-timeout abandon) now sets
`this.code = UNOBSERVED_EXIT_CODE` (`-1`, `:108`) instead of leaving it `null` forever. The new
`signalCode` getter (`:326-328`) mirrors `ChildProcess.signalCode` and is set alongside (`exitSignal`).
This closes the base review's Serious/Failure-mode findings on this point functionally — see the CRITICAL
finding below for whether `-1` is the right sentinel value, which the base review did not evaluate because
the fix did not exist yet.

**(c) `error` → `exit` → `close` ordering.** `endAbnormally()` now emits in that order
(`:386-388` then `:389-391` via `emitClose()`), matching `ChildProcess` semantics and the SDK's own
consumption (`ProcessTransport`'s `error` listener records `exitError`; `waitForExit`/`onExit` read only
`exit` — both are now satisfied on the worker-crash path). Pinned by
`spec.ts:663-717` (`'fails the in-flight child cleanly when its worker dies, then replaces the worker'`),
which asserts `events).toEqual(['error', 'exit', 'close'])` and drives a real crashed worker thread. This
resolves the base review's "Worker crash mid-query never emits `exit`" failure mode with a real
integration-style test, not just a unit assertion on the emit call order.

### CRITICAL — `UNOBSERVED_EXIT_CODE = -1` vs Node's `null` + `signalCode` contract

**Node's own contract**, which this file otherwise deliberately mirrors (the `signalCode` getter comment
says exactly this): a `ChildProcess` killed by a signal, or one whose exit status was never observed, sets
`exitCode = null` and `signalCode = 'SIGTERM'`/`'SIGKILL'`/etc — `null` is the documented "no numeric exit
status" value, and a real, intentional process exit code is a separate, always-non-null integer that can
legitimately be `-1` on Windows (`ExitProcess` takes a full 32-bit value; unlike POSIX, which clamps
`exit(-1)` to `255`, a Windows binary that calls `ExitProcess((DWORD)-1)` reports `-1` verbatim, and this
is a real pattern some CLI tools use for "unspecified failure"). `UNOBSERVED_EXIT_CODE = -1`
(`off-thread-process-spawner.ts:104-108`) collides with that legitimate value: a caller cannot tell "the
child's own binary really exited with `-1`" from "we lost the worker and never saw a real exit," where
Node's `null` sentinel makes that distinction unambiguous by construction.

**Where this actually bites**, found by tracing every consumer of this spawner's process handle:

- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/pi-cli.adapter.ts:479-486`,
  `antigravity-cli.adapter.ts:587-593`, and `opencode-cli.adapter.ts:541` (confirmed by grep; not read in
  full) all use the identical idiom `const exitCode = code ?? (signal ? 1 : 0)`, written against Node's
  real contract where `code` is `null` exactly when a `signal` fired. With this fix, a worker-crash,
  force-terminate, or grace-abandon now delivers `code = -1` (non-null) alongside `signal = 'SIGTERM'`, so
  `code ?? ...` short-circuits to `-1` instead of normalizing through the `signal ? 1 : 0` branch these
  adapters were written to rely on. The user-visible result: `segment.emit({ type: 'error', content:
  'Pi CLI exited with code -1' })` (`pi-cli.adapter.ts:483`) and the equivalent "Antigravity CLI exited
  with code -1" — a fabricated, misleading exit code surfaced to the end user for an event that was never
  a real process exit. This is precisely the "user-facing '-1' message" scenario the review brief warned
  about, and it is a genuinely new surface: before Batch 13's own fix to point 6(c), `onWorkerLost` never
  reached `close` with a settled `code` at all (see base review, "Worker crash mid-query never emits
  `exit`"), so these three `child.on('close', ...)` handlers never ran for this failure class before now.
  Fixing 6(c) is what makes this reachable.
- The SDK's own `ProcessTransport` (`sdk.mjs:308857`, `:309882`, `:311381`) never reads the numeric value
  of `exitCode`, only `exitCode !== null`, and never reads `signalCode` at all (confirmed: zero matches for
  `signalCode` in `sdk.mjs`). So the SDK seam itself is indifferent to `-1` vs `null` — the write gate and
  `waitForExit` behave identically either way. The risk is entirely in the `IProcessSpawner` port's other
  consumers (the rival-CLI adapters above), not in the SDK integration this file's header is primarily
  about.
- `agent-process-manager.service.ts:1542,1570` (`cli-agent-runtime`) passes through `code ?? undefined` /
  `code` directly into a result object; not read further in this pass, but the same `code ?? undefined`
  pattern loses the null/negative-sentinel distinction the same way and is worth the same check before this
  is called closed.

**Recommendation: switch to `exitCode = null` + `signalCode` + `killed = true`, not `-1`.** Concretely:
on every abnormal-termination path (`fail()`, `endAbnormally()`), leave `this.code` at `null`, set
`this.exitSignal` to the terminating signal (already done), and additionally set `this.killedFlag = true`
(currently only `kill()` sets it) so the SDK's `killed || exitCode !== null` gate is satisfied through
`killed` instead of a fabricated numeric code — this is exactly the mechanism the review brief proposed
and the SDK already supports (`sdk.mjs:308857` ORs the two conditions). This keeps the `IProcessSpawner`
port's other consumers on Node's real, well-known contract (`code ?? (signal ? 1 : 0)` keeps working
exactly as written, with no adapter changes needed) while still closing the original "exitCode never
settles" defect. If `-1` is kept instead for reasons not visible in this diff (e.g. some other consumer
positively requires a non-null numeric code and cannot be changed), that should be a one-line comment at
`UNOBSERVED_EXIT_CODE`'s definition explaining the tradeoff and naming the three adapter call sites above
as accepted, known-misleading output — as written today, nothing documents that tradeoff or that those
three user-facing messages are an accepted consequence.

### Delta verdict

- Recommendation: **APPROVE_WITH_FIXES**
- Confidence: HIGH on items 1, 2, 4, 5 and on the `error`→`exit`→`close` ordering fix (6c) — all directly
  read and, where testable, pinned by a real-worker-crash spec. HIGH on the `-1` vs `null` finding's
  mechanics (the adapter code and the SDK gate were both read directly); MEDIUM on its practical blast
  radius, since it requires the worker-crash/force-terminate/grace-abandon path to fire specifically while
  a rival-CLI adapter (not the SDK) is the consumer — a real but narrower condition than "every crash."
- Outstanding: (1) CRITICAL — `-1` vs `null`+`signalCode`+`killed` for `UNOBSERVED_EXIT_CODE`, with the
  three adapter call sites above as concrete evidence of user-facing fallout; recommend `null` +
  `killed = true` per above. (2) Moderate — no `'error'` listener on `WorkerBackedProcess.stdin` itself;
  currently safe because every known writer checks `killed`/`exitCode`/`writable` first, but that is a
  property of the callers, not the stream. (3) Moderate — hard-cap inline fallback reports only the first
  blocking launch per 60s window; every subsequent blocking launch in a sustained storm is unreported
  until the next window, though still logged.
- Everything else requested (extraction/facade, DI wiring, hard-cap behavior being the intended bounded
  degraded mode, tree-kill claim, idle-worker spec) is confirmed correct as implemented.
