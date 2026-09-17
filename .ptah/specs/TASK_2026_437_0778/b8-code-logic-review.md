# Code Logic Review — `TASK_2026_437_0778` Batch 8

Scope: `WorkspaceWatchHostCore` + protocol (platform-core), `ElectronWorkspaceWatcher` +
`workspace-watch-host.entry.ts` + `in-process-workspace-watch-host.ts` +
`parcel-watcher-engine.ts` (platform-electron), `ElectronWorkspaceWatchHostFactory` + app wiring
(`phase-0-platform.ts`, `wire-runtime.ts`, `boot-coordinator.ts`, `shutdown.ts`,
`container.smoke.spec.ts`, `main.quit-path.spec.ts`), barrel/CLAUDE.md updates. Read in full,
not by diff hunk. No source edited; no tests run beyond reading existing spec files.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 2              |
| Moderate issues     | 3              |
| Failure modes found | 5              |

The host core (`WorkspaceWatchHostCore`) and its intersection/nested-repo/retry logic are careful
and well-tested against the shared contract suite. The two serious findings are a genuine
false-restart risk in the adapter's own liveness check, and a live contradiction between the C7
port doc's "overflow once" guarantee and the C8 adapter's "overflow every 60 s forever, no
recovery" behaviour — the exact question the task called out as deviation 3. Neither blocks
committing Batch 8 in isolation (nothing downstream consumes the port yet), but both must be
resolved before Batch 11 wires real consumers, because Batch 11's behaviour depends on which
contract is true.

## Five logic questions

### 1. How does this fail silently?

- `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.ts:439-473` —
  degraded mode has no exit path except `dispose()`. Any transient cause behind the six restarts
  (a Windows AV scan holding a handle, a brief resource crunch) that would have cleared in seconds
  now keeps the app on polling-only file watching for the rest of the process's life. Nothing tells
  the user or attempts a fresh host; it "succeeds" (per the port's degrade contract) while quietly
  disabling watching for good.
- `workspace-watch-host-core.ts:474-481` (`lostEvents`) sets `failureSignalled` once per failure
  streak and the coalescer's `signalOverflow` folds pending changes silently; a caller reading only
  `truncated`/`droppedCount` on the FIRST batch after an overflow could undercount, since
  `droppedCount` on the overflow batch itself only reflects `this.pending.size + extraDropped` at
  the moment of folding, not events lost between the native failure and the overflow being observed
  by the coalescer (acceptable — documented as "at least" — but worth naming since a consumer
  building an exact audit trail from `droppedCount` would be wrong).

### 2. What user action produces unexpected behaviour?

- A user who sets `PTAH_WATCH_HOST=0` (the field-recovery hatch) gets file watching that runs
  entirely on the main thread again — the exact defect this whole task exists to remove — with no
  visible signal in the UI that they are back in the old, freeze-prone mode beyond a log line
  (`electron-workspace-watch-host-factory.ts:78-86`, `logDiagnostic`). If a support engineer sets
  this flag to work around an A2 packaging fault and forgets to unset it, the user is silently back
  to pre-fix behaviour on every subsequent launch.
- A user whose watch host degrades (6 failures in 10 minutes) sees git status and the file index
  fall back to a rescan every 60 s indefinitely (once Batch 11 wires the consumers) — i.e. the
  UI stops reflecting file changes live and nobody tells them why beyond a `DegradationReporter`
  entry most users never look at.

### 3. What input data produces a wrong answer?

- `workspace-watch-host-core.ts:547-603` (`computeNativeIgnore`) takes `first` (the arbitrary first
  Map entry) as the base and intersects the rest against it. This is correct as an intersection
  regardless of which subscriber is `first`, but relies on `Map` iteration order being insertion
  order (true in V8/Node, not guaranteed by the spec) — a latent portability assumption, not a bug
  today.
- `parcel-watcher-engine.ts:36-43` trusts `typeof watcher.subscribe === 'function'` as the only load
  check. A native binding that loads but returns a `subscribe` whose Promise resolves to a
  subscription object missing `unsubscribe` (a corrupted install) would not be caught until the
  first `unsubscribeNative` call throws — reported as `native-unsubscribe-failed`, which is handled,
  so this degrades gracefully rather than producing a wrong answer. Not a defect, but worth noting
  the validation is shallow.

### 4. What happens when a dependency fails?

- `@parcel/watcher` fails to load (A2): `workspace-watch-host.entry.ts:81-91` posts `fatal`, and the
  host process stays alive doing nothing. The ADAPTER (`electron-workspace-watcher.ts:353-355`)
  treats `fatal` as `onHostFailure('fatal', ...)`, which kills the host and restarts within budget —
  correct, and it will exhaust the budget in 5 restarts × 250 ms and degrade quickly rather than
  loop forever burning restarts pointlessly. Good.
- The host process itself dies (`exit`) or the IPC channel breaks: handled symmetrically
  (`onHostFailure('exited', ...)`, `post-failed`). Verified by
  `electron-workspace-watcher.spec.ts:439-476`.
- The MAIN process itself stalls (not the host) — see Serious-1 below: the watchdog can spuriously
  treat a live, healthy host as failed.

### 5. What is missing that the requirements never mentioned?

- No back-off / cooldown-based retry out of degraded mode (see Serious-2). The plan's C8 section
  explicitly says degraded mode falls back to "polling rescans every 60 s" forever, so this may be
  the intended contract, but nothing revisits whether the host could work again.
- No metric/counter surfaced for how many times the adapter has restarted or degraded across the
  session, beyond one-shot diagnostics — a support engineer investigating "why is git status stale"
  has only log lines to go on, no persisted state to inspect.
- The in-process hatch (`PTAH_WATCH_HOST=0`) has no telemetry distinguishing "hatch active because
  operator set it" from "hatch active because it was left on from a previous incident" — see UX
  finding under Q2.

## Failure modes

### Watchdog false-restart under a main-process stall

- Trigger: the Electron MAIN process itself stalls for ≥ `heartbeatIntervalMs *
missedHeartbeatsBeforeRestart` (6 s) — the exact scenario this task's other batches (5, 12, 13, 14) exist to reduce, but cannot eliminate (e.g. a slow synchronous SQLite statement, GC pause, or
  a burst the storm breaker in another subsystem does not cover).
- Symptom: a perfectly healthy watch host is killed and restarted (and the restart budget is spent)
  even though it kept posting heartbeats on schedule; repeated stalls can burn the whole 5-restart
  budget and degrade watching for no host-side reason at all.
- Evidence: `electron-workspace-watcher.ts:359-377` (`armWatchdog`) compares
  `this.clock.now() - host.lastMessageAt` against a threshold using wall-clock time only. When
  main's event loop is blocked, Node's timer phase can fire the (also-delayed) watchdog callback
  before the poll phase delivers IPC messages that arrived on the OS pipe while main was blocked —
  so `host.lastMessageAt` has not yet been bumped by the time the watchdog checks it, even though
  the host was never silent. Nothing in this file or `armWatchdog`'s tests
  (`electron-workspace-watcher.spec.ts:478-501`) drains or peeks the pending message queue before
  concluding silence, and nothing compares the stall against the main process's own known lag (the
  main-loop watchdog built in Batch 5, `libs/backend/vscode-core/src/diagnostics/main-loop-watchdog.ts`,
  already measures main's own drift and could be consulted here).
- Current handling: none. The adapter's liveness math assumes main's own clock and event loop are
  themselves live and prompt, which is precisely the assumption this task's incident falsified.
- Recommendation: either (a) widen the watchdog's tolerance using the main-loop watchdog's own
  measured lag (`silentMs - measuredMainLagMs > threshold` before declaring the host dead), or (b)
  on watchdog fire, do one more `clock.now()` check after draining the current macrotask queue
  (e.g. `setImmediate`) before declaring failure, so a message that was merely queued gets a chance
  to update `lastMessageAt` first. Either requires a regression test that advances the manual clock
  past the threshold WITHOUT delivering the queued heartbeat, then delivers it, and asserts no
  restart — the existing spec never drives that interleaving.

### Degraded mode never recovers (see Deviation verdict 3)

- Trigger: 6 host failures inside a rolling 10-minute window.
- Symptom: `ElectronWorkspaceWatcher` sends every subscriber an `overflow` every 60 s forever
  (`armDegradedRescan`, `electron-workspace-watcher.ts:464-473`), confirmed permanent by
  `electron-workspace-watcher.spec.ts:562-607` ("nothing forks" even for a brand-new subscription
  added after degrade). There is no cooldown-then-retry.
- Evidence: `electron-workspace-watcher.ts:439-462` (`enterDegraded`) sets `this.state = 'degraded'`
  with no transition back to `'idle'`/`'running'` anywhere in the class.
- Current handling: one `onDegraded` report, then indefinite 60 s rescans.
- Recommendation: this matches the plan's C8 section (which explicitly describes "an overflow +
  DegradationReporter, subscribers told to fall back to polling rescans every 60 s"), so the CODE
  is very likely right and the C7 PORT DOC is wrong (see Deviation verdict 3 for the concrete edit).
  Independently of which doc wins, add a bounded recovery attempt (e.g., after N minutes in
  degraded state, attempt one fresh fork with a reset budget) so a transient cause is not permanent
  for the rest of the process's life; log this as a follow-up if out of scope for Batch 8.

### In-process hatch leaves no visible trace once active

- Trigger: operator sets `PTAH_WATCH_HOST=0` to work around an A2 fault.
- Symptom: every subsequent launch silently runs the watch engine on the main thread — the
  regression this task exists to fix — until someone remembers to unset the env var.
- Evidence: `electron-workspace-watch-host-factory.ts:78-86` (`selectWorkspaceWatchHostForker`);
  no `DegradationReporter` or diagnostic is emitted for "the in-process hatch is active", only for
  the eventual restart/degrade cycle if the in-process host itself later fails.
- Current handling: a code comment says "delete this branch... once one release has shipped with
  no `electron.workspace-watcher.host-degraded` reports" — a manual, human process with no signal
  that the flag is even set.
- Recommendation: emit one `onDiagnostic` (info) at phase-0 registration time when the hatch is
  selected, so it appears in the startup log every session it is active, not only when something
  else fails.

### `native-unsubscribe-failed` during dispose can log after teardown started

- Trigger: `WorkspaceWatchHostCore.dispose()` clears `this.roots`/`this.subscriptions` synchronously
  then awaits `teardownRoot` for every root; `unsubscribeNative` catches and reports
  `native-unsubscribe-failed` only `if (!this.disposed)` (`workspace-watch-host-core.ts:619-629`).
- Symptom: none visible — this is actually correct (the guard suppresses the post during an
  intentional dispose), but it means a REAL unsubscribe failure during a live (non-dispose)
  re-subscribe is reported, while the same failure during shutdown is swallowed with no trace at
  all, not even a debug line. Operationally invisible if native unsubscribe is silently broken and
  the app only ever notices during shutdown.
- Evidence: `workspace-watch-host-core.ts:624-628`.
- Current handling: swallowed by design ("adapter is gone, nobody would read it").
- Recommendation: acceptable as-is; note only because a future debugging session burned time on
  "why does dispose never report native unsubscribe failures" would want this comment expanded to
  say so explicitly, which it does not currently (Minor, listed here for completeness rather than
  as an action item).

### Invalid-message flood from a compromised or buggy host is only capped on the adapter side

- Trigger: a host process posts garbage (schema-invalid) messages repeatedly.
- Symptom: `onHostMessage` caps its OWN diagnostic logging at 10 (`invalidMessagesReported < 10`,
  `electron-workspace-watcher.ts:309-322`), but the HOST side (`WorkspaceWatchHostCore.handleMessage`,
  `workspace-watch-host-core.ts:230-242`) has no equivalent cap on `postError('invalid-message', ...)`
  for bad INBOUND messages — a caller that (accidentally, via a bug) posts thousands of malformed
  `subscribe` messages per second makes the host post thousands of `error` messages back, which the
  adapter then does cap on the logging side, but each still crosses IPC and is Zod-parsed on the
  adapter. Not a crash risk (bounded work per message), but an available amplification vector if the
  main-side caller ever has a bug that free-runs a subscribe loop.
- Evidence: `workspace-watch-host-core.ts:230-242`, contrast with the capped
  `invalidMessagesReported` counter on the adapter.
- Current handling: none on the host side.
- Recommendation: Moderate — mirror the 10-message cap (or a per-second budget) on the host's
  `postError('invalid-message', ...)` path, consistent with the adapter's own guard against a "log
  storm on main."

## Blocking issues

None found in the files reviewed.

## Serious issues

### S1 — Watchdog can restart a healthy host under a main-process stall

- File: `libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.ts:359-377`
- Scenario: main process itself stalls ≥ 6 s (GC pause, slow sync I/O elsewhere) while the host kept
  heartbeating on schedule.
- Impact: false restart, wasted restart-budget slot, and — if it recurs a few times during one long
  stall episode — an unwarranted permanent degrade, directly undermining the resilience story this
  task is building.
- Fix: see "Watchdog false-restart" failure mode above — compare against the main-loop watchdog's
  measured lag, or re-check after draining the current message queue before declaring failure.

### S2 — Port contract (C7) and Electron adapter (C8) disagree on degraded-mode overflow cadence

- File: `libs/backend/platform-core/src/interfaces/workspace-watcher.interface.ts:147-149` says
  "a permanently failed adapter emits `overflow` ONCE and reports a degradation"; the implemented
  behaviour in `electron-workspace-watcher.ts:464-473` emits `overflow` every 60 s FOREVER (proven
  by the spec at `electron-workspace-watcher.spec.ts:589-594`, which advances the clock twice and
  asserts two additional overflow batches).
- Scenario: Batch 9's CLI/VS Code adapters, and Batch 11's `GitWatcherService`/file-index consumers,
  are the two audiences who will read this doc to decide what to build. If a future adapter
  (CLI/VS Code) is built to the port doc's "once" contract while Electron does "repeating,"
  consumers get materially different staleness behaviour depending on which host they run on with
  no way to tell from the port type alone.
- Impact: silent behavioural drift across adapters; Batch 11 wiring `overflow` → `refreshGitInfo` +
  truncated push, and the file index → path-only rebuild, will do a full rescan every 60 s forever
  under Electron once degraded, but (if built literally to the C7 doc) only once under a
  hypothetical CLI/VS Code adapter — an inconsistency nobody would catch by type-checking.
- Fix: pick one and align all three surfaces before Batch 9/11 land. Recommendation: keep the
  CODE's repeating behaviour (verified against the plan's own C8 section, which explicitly
  describes "polling rescans every 60 s"; "once" would mean a stale tree forever after one rescan,
  which is worse than periodic polling and contradicts "the consumer's existing rescan" pattern used
  elsewhere in this codebase, e.g. the Batch 4 follow-up 30 s safety refresh). Update
  `workspace-watcher.interface.ts:147-149` to say degraded mode repeats at
  `WorkspaceWatchSupervision.degradedRescanIntervalMs` until the process restarts, with no automatic
  recovery, and require Batch 9's CLI/VS Code adapters to match it.

## Moderate and minor issues

- Moderate: host-side `invalid-message` error posting has no rate cap (`workspace-watch-host-core.ts:230-242`) — see failure mode above.
- Moderate: no bounded recovery attempt out of `degraded` state (`electron-workspace-watcher.ts:439-462`) — see failure mode above; likely acceptable per plan, but worth a follow-up ticket either way.
- Moderate: in-process hatch selection is not logged proactively (`electron-workspace-watch-host-factory.ts:78-86`) — see failure mode above.
- Minor: `wire-runtime.ts:558-560`'s comment ("Its consumer (the git watcher) stopped in `disposeBeforePersistence`") describes Batch 11's future wiring as though it already exists; today `workspaceWatcher` has zero consumers, so the comment is forward-referencing and could confuse whoever reads it before Batch 11 lands (`apps/ptah-electron/src/activation/shutdown.ts:241-243` has the identical premature claim). Not incorrect once Batch 11 lands, but misleading now.
- Minor: `computeNativeIgnore`'s reliance on `Map` insertion-order iteration to pick a stable "first" subscriber (`workspace-watch-host-core.ts:550`) is safe in V8 today but undocumented as an assumption; a one-line comment would save a future reader from wondering if subscriber order matters.
- Minor: `platform-core/CLAUDE.md` genuinely omits the new `src/workspace-watch/` folder — see Deviation verdict 4.

## Data flow

1. Consumer calls `IWorkspaceWatcher.watch(root, options, listener)` on `ElectronWorkspaceWatcher` —
   OK: validated synchronously via `validateSubscription` (`electron-workspace-watcher.ts:521-538`),
   throws before any IPC if the coalescer would reject the options.
2. Adapter forks (lazily, first `watch`) or reuses the running host, buffers the subscribe message
   if restarting — OK, covered by `electron-workspace-watcher.spec.ts:502-545`.
3. Host entry auto-detects transport, loads `@parcel/watcher`, hands both to
   `WorkspaceWatchHostCore` — OK for the two production transports (utilityProcess, worker_threads);
   the transport guard runs before the engine load so a bad bundle target fails fast
   (`workspace-watch-host.entry.ts:44-79`).
4. `WorkspaceWatchHostCore.subscribe` creates or reuses a `RootWatch`, computes the intersection
   ignore set, subscribes-before-unsubscribing on ignore-set change — OK, no event gap on
   re-subscribe (`workspace-watch-host-core.ts:361-403`).
5. Native events fan out per-subscriber into each `WorkspaceChangeCoalescer`, which applies full
   exclusion + storm breaking + pacing — OK (Batch 7 territory, re-verified here at the integration
   seam only).
6. Host posts a `batch`/`heartbeat`/`error`/`notice`/`fatal` message — OK, Zod-validated on both ends
   (`workspace-watch-protocol.ts`).
7. Adapter's `BatchRelay` re-validates path containment against the root (`isPathWithinRoots`),
   re-paces per `minBatchIntervalMs`, and folds an owed overflow — OK
   (`electron-workspace-watcher.ts:552-678`).
8. Liveness: watchdog compares elapsed wall-clock time since last message — GAP, see S1.
9. Failure → kill, overflow to all subscribers, restart within budget, or degrade permanently — OK
   mechanically, but the permanent-degrade contract disagrees with the port doc — see S2.
10. `dispose()` — kills host, disposes every subscription's relay, clears every timer — OK, verified
    by `electron-workspace-watcher.spec.ts:214-235` and the quit-path/DI specs for the app wiring.

## Requirements fulfilment

| Requirement                                                                                | Status   | Gap                                                                                                         |
| ------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------- |
| Split core (platform-core, no Electron/Node-IPC imports) vs thin entry (platform-electron) | COMPLETE | none found; `workspace-watch-host-core.ts` imports only `picomatch` and sibling utils                       |
| One native subscription per root, intersection of subscriber excludes                      | COMPLETE | verified by reading `computeNativeIgnore` and its call sites                                                |
| Nested `.git` detection, debounced 1 s, ≤1 per 10 s per root                               | COMPLETE | `scheduleNestedResubscribe` (`workspace-watch-host-core.ts:510-523`) implements both bounds correctly       |
| Native error (A1) → overflow + resubscribe                                                 | COMPLETE | `onEngineEvents` error branch (`workspace-watch-host-core.ts:457-463`)                                      |
| Heartbeat every 2 s                                                                        | COMPLETE | `beat()` (`workspace-watch-host-core.ts:631-647`)                                                           |
| Adapter: fork lazily, stop 30 s after last unsubscribe                                     | COMPLETE | `scheduleIdleShutdown`/`cancelIdleShutdown`                                                                 |
| Restart budget 5/10min, then degrade + `DegradationReporter`                               | PARTIAL  | degrade is permanent with no recovery attempt; matches plan's C8 wording but contradicts port's C7 doc (S2) |
| Heartbeat-missed → kill + restart                                                          | PARTIAL  | correct in isolation; false-positive under a main-process stall (S1)                                        |
| `PTAH_WATCH_HOST=0` hatch runs the same core in-process                                    | COMPLETE | `in-process-workspace-watch-host.ts`, correctly async via `setImmediate` both ways                          |
| `@parcel/watcher` one-thread-per-process constraint honoured via child_process fallback    | COMPLETE | see Deviation verdict 1                                                                                     |
| `wire-runtime.ts` sets `refs.workspaceWatcher`                                             | COMPLETE | see Deviation verdict 2                                                                                     |
| `platform-core/CLAUDE.md` documents the new folder                                         | MISSING  | see Deviation verdict 4                                                                                     |

Implicit requirements not addressed: a diagnostic signal when the in-process hatch is active
(rather than only when it later fails); a bounded recovery attempt out of degraded mode.

## Edge cases

| Case                                                                                  | Handled         | How                                                                                                            | Concern                                  |
| ------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Two subscribers, same root, different excludes                                        | YES             | intersection computed per-subscriber, coalescer still filters fully                                            | none                                     |
| Subscriber added mid-restart                                                          | YES             | added to `subscriptions` map before the state switch; resent on `startHost`                                    | none                                     |
| Subscriber removed mid-restart                                                        | YES             | `unwatch` deletes from map regardless of state; not resent                                                     | none                                     |
| Host posts an invalid/garbage message                                                 | YES             | dropped, capped diagnostic (adapter side)                                                                      | host side uncapped (Moderate)            |
| Fork itself throws synchronously                                                      | YES             | caught in `startHost`, treated as a failure                                                                    | none                                     |
| `kill()` called twice                                                                 | YES             | `killed` flag in `InProcessWorkspaceWatchHostProcess`; adapter's `killHost` sets `this.host = undefined` first | none                                     |
| Watch host degrades, then a brand-new subscription arrives                            | YES             | immediately told to rescan, nothing forks                                                                      | matches C8 plan, contradicts C7 doc (S2) |
| Main process itself stalls ≥6s while host is healthy                                  | NO              | watchdog has no compensation                                                                                   | S1                                       |
| Operator leaves `PTAH_WATCH_HOST=0` set after the A2 fault is fixed                   | PARTIAL         | works, but silent                                                                                              | see failure modes                        |
| Native ignore set becomes stale after a partial unsubscribe (some subscribers remain) | YES (by design) | kept narrower-than-optimal deliberately; coalescer still enforces full exclusion downstream                    | pure efficiency trade-off, documented    |

## Deviation verdicts

### 1. `@parcel/watcher` single-thread-per-process constraint → `child_process` fallback transport

**Verdict: ACCEPT.**

- Transport auto-detect is unambiguous and correctly ordered: Electron `parentPort`
  (`process.parentPort`) → `worker_threads.parentPort` → `process.send` (child_process IPC) → throw
  (`workspace-watch-host.entry.ts:48-79`). These three are mutually exclusive execution contexts in
  practice (a process is either an Electron utilityProcess, a worker_threads Worker, or a
  child_process.fork'd Node process, never two at once), so there is no realistic case where the
  guard picks the wrong branch.
- Production Electron still uses `utilityProcess`: confirmed —
  `ElectronWorkspaceWatchHostFactory.fork()` (`electron-workspace-watch-host-factory.ts:59-64`) calls
  `ElectronUtilityWorkerProcess.fork(...)`, the same wrapper the integrity/embedder/voice workers
  use; the `child_process` branch in the entry exists only for the Jest contract-suite spec
  (`workspace-watch-host.entry.spec.ts:74-107`, `ChildHostProcess`) which needs a REAL restart
  (fresh binding load) that a long-lived worker_threads Worker cannot give it, and for CLI's future
  in-process fallback if it ever needs one. This split — long-lived Worker for the batch/exclusion/
  heartbeat tests, forked child process for the restart/resubscribe/overflow contract tests — is
  documented in the spec file's own header and is consistent with the platform-electron CLAUDE.md
  addition.
- `PTAH_WATCH_HOST=0` does not break under a conflicting load: the hatch runs
  `loadParcelWatcherEngine()` directly in the CALLING process (no `entry.ts`, no Worker) — see
  `in-process-workspace-watch-host.ts:42-57`. Since the forker choice (`selectWorkspaceWatchHostForker`,
  `electron-workspace-watch-host-factory.ts:78-86`) is made once at phase-0 registration from
  `process.env`, and Electron's forked-host path and the in-process path are mutually exclusive for
  the lifetime of one process, there is no code path where both are active in the same process at
  once, and thus no "Module did not self-register" collision reachable in this wiring. Verified: no
  test in `electron-workspace-watch-host-factory.spec.ts` or
  `in-process-workspace-watch-host.spec.ts` loads the real `@parcel/watcher` module (both inject a
  fake `loadEngine`), so tests cannot trigger the conflict either.
- IPC disconnect / orphan host: the child_process branch installs `process.on('disconnect', () =>
process.exit(0))` (`workspace-watch-host.entry.ts:76`), so a host whose parent dies (channel
  closes) exits itself rather than becoming an orphan. The utilityProcess and worker_threads
  branches rely on Electron/Node's own lifecycle (a utilityProcess is torn down with its owner by
  the OS process tree; a Worker is terminated by its owner). Serialization limits and backpressure
  are bounded by the protocol's own size caps (`WORKSPACE_WATCH_PROTOCOL_LIMITS`, ≤500 changes/batch,
  ≤2048-char messages) rather than by transport-level flow control, which is adequate given the
  message rate (≤1 batch per 250 ms per subscription).
- Minor gap: the entry's own exit-on-disconnect line is exercised only implicitly (no spec asserts
  `process.exit` is called on `disconnect`); acceptable given `process.exit` is hard to unit-test,
  but worth a note for whoever eventually adds an integration test for orphan cleanup.

### 2. `wire-runtime.ts` edited to set `refs.workspaceWatcher`

**Verdict: ACCEPT, correct.**

- `captureShutdownHandles` (`wire-runtime.ts:552-575`) resolves `PLATFORM_TOKENS.WORKSPACE_WATCHER`
  behind an `isRegistered` guard, matching the pattern used for `agentProcessManager` two lines
  above it, and is captured pre-window alongside the other disposables, consistent with the "capture
  early, dispose late" convention this file already follows.
- Resolving is confirmed not to fork anything (`container.smoke.spec.ts:322-338`'s "resolves
  WORKSPACE_WATCHER... as an unforked singleton" test asserts `fork` is never called merely by
  resolving), matching the comment's claim.
- Shutdown ordering: `boot-coordinator.ts` places `workspaceWatcher` in `BootRefs` beside
  `cliRegistry`; `shutdown.ts:240-244` disposes it in `disposeAfterPersistence`, immediately after
  `cliRegistry.disposeAll()` — both in the LIFO tail confirmed by
  `main.quit-path.spec.ts:218-223`'s `EXPECTED_LIFO_ORDER` array (`'cliRegistry'` then
  `'workspaceWatcher'` then `'diagnostics'`), and the ordering test at that file's assertion passes
  by construction (order-of-push equals order-of-expectation).
- One inaccuracy, not a functional defect: the comment at `shutdown.ts:241-243` ("Its consumer (the
  git watcher) stopped in `disposeBeforePersistence`") describes Batch 11's future wiring as though
  it exists today. As of Batch 8, `workspaceWatcher` has zero consumers — nothing calls `.watch()`
  on it anywhere in the app yet, so this line is a forward reference, not a currently-true claim.
  Harmless (the ordering is correct regardless of whether a consumer exists yet), but flagged as a
  Minor doc issue above so it doesn't get read as "already wired" by the next session.

### 3. Degraded mode sends `overflow` every 60 s vs the port doc's "overflow once"

**Verdict: the CODE is right, the C7 PORT DOC is wrong; fix the doc, not the adapter, and add the
missing recovery attempt as a follow-up.**

- Reasoning: the implementation-plan's own C8 section (`implementation-plan.md`, item 8, "Failure
  behaviour") says the adapter, once degraded, tells subscribers "to fall back to polling rescans
  every 60 s — the consumer's existing rescan." That is exactly what `armDegradedRescan`
  (`electron-workspace-watcher.ts:464-473`) does, and it is pinned by a passing spec
  (`electron-workspace-watcher.spec.ts:589-594`). The C7 port interface's docstring
  (`workspace-watcher.interface.ts:147-149`), written a batch earlier, says "once" — that line
  predates the C8 design decision and was never updated to match it.
- A literal "once" contract would mean: after the sixth failure, the consumer rescans one time and
  then the file tree view is frozen at that snapshot for the rest of the process's life, with zero
  further updates even if the user keeps editing — objectively worse than a bounded 60 s poll, and
  inconsistent with this codebase's own precedent (the Batch 4 follow-up's 30 s safety refresh is
  the same "periodic poll as a safety net" pattern already accepted elsewhere in this task).
- Consumer impact for Batch 11 (as flagged in the task prompt): `GitWatcherService` doing a full
  `git status` + truncated push every 60 s forever, and the file index doing a path-only rebuild
  every 60 s forever, is a bounded, low-frequency cost (not a load regression comparable to the
  original incident, which was per-EVENT work on the main loop during a storm of thousands of
  events/second) — this is a fixed floor of one refresh per minute, which is the acceptable trade a
  degraded watcher should make. It is a regression from "live updates" to "periodic poll," which
  users should be told about (see the missing-diagnostic finding above), but it is not a freeze
  risk.
- Concrete recommendation:
  1. Rewrite `workspace-watcher.interface.ts:147-149` to say: "a permanently failed adapter reports
     one degradation event, then repeats an `overflow` batch every
     `WorkspaceWatchSupervision.degradedRescanIntervalMs` (60 s by default) until the process
     restarts; there is no automatic recovery out of degraded mode."
  2. Require Batch 9's CLI and VS Code adapters to implement the SAME repeating cadence, not the
     "once" reading, so all three adapters behave identically to Batch 11's consumers regardless of
     platform.
  3. File a follow-up (does not need to block Batch 8's commit) for a bounded recovery attempt out
     of degraded mode — e.g., attempt one fresh fork with a reset failure count after N minutes in
     `degraded`, so a transient root cause is not permanent for the rest of the session.

### 4. `platform-core/CLAUDE.md` does not list the new `workspace-watch/` folder

**Verdict: CONFIRMED, doc gap, must be fixed before commit.**

- `libs/backend/platform-core/CLAUDE.md`'s "Internal Structure" / "Key Files" sections
  (lines ~55-70) list `src/interfaces/workspace-watcher.interface.ts` and the Batch 7
  `workspace-change-coalescer.ts` cost-filter note, but never mention the new `src/workspace-watch/`
  folder (`workspace-watch-host-core.ts`, `workspace-watch-protocol.ts`) added in this batch — the
  token table's `WORKSPACE_WATCHER` row still only forward-references "adapters land in Batches
  8-9" without pointing at the new core file that now exists. This is exactly the gap the task
  description said to confirm; confirmed. Low-cost, low-risk fix (documentation only), but the
  repository's own convention (every batch updates the owning lib's CLAUDE.md, as
  `platform-electron/CLAUDE.md` correctly did in this same batch) makes this a real, fixable defect
  in Batch 8 as submitted, not a future task.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Top risk: the watchdog's plain wall-clock liveness check (S1) can misfire during exactly the kind
  of main-process stall this whole task exists to reduce, spending restart budget or triggering a
  permanent degrade for a host that was never actually unhealthy.
- What a robust implementation would add:
  1. Watchdog tolerance that accounts for main's own measured event-loop lag (reuse the Batch 5
     main-loop watchdog's signal) before declaring a host failure.
  2. Aligned degraded-mode contract across the C7 port doc and the C8 (and forthcoming C9) adapters,
     plus a bounded recovery attempt out of permanent degradation.
  3. A proactive diagnostic when the `PTAH_WATCH_HOST=0` hatch is selected, not only when it later
     fails.
  4. `platform-core/CLAUDE.md` updated to list `src/workspace-watch/` and its two files.
  5. A rate cap on the host's own `invalid-message` error posting, mirroring the adapter's existing
     cap.

None of these require re-architecting the batch; all five are additive fixes to code that is
otherwise carefully built and thoroughly tested against its own contract suite.

## Delta review (review fixes)

Re-read in full, on disk in the worktree at `D:\projects\ptah-437` (branch
`fix/task-437-main-loop-isolation`): `electron-workspace-watcher.ts` (780 lines),
`workspace-watcher.interface.ts:100-165`, `workspace-watch-host-core.ts:200-260`,
`electron-workspace-watch-host-factory.ts`, `shutdown.ts:225-247`, `wire-runtime.ts:545-575`,
`git-watcher.stress.harness.ts:1-90`, `platform-core/CLAUDE.md`, `platform-electron/CLAUDE.md`,
and the three new/expanded spec files. No source edited; no full suite run.

### Item-by-item

1. **S1 stall-aware watchdog — CONFIRMED FIXED.**
   `armWatchdog` (`electron-workspace-watcher.ts:374-414`) now distinguishes an
   on-schedule tick from one that ran a full extra interval late
   (`now - armedAt - heartbeatIntervalMs <= heartbeatIntervalMs`, line 389) and only
   probes with a 0 ms re-check (line 401) in the late case, comparing `host.lastMessageAt`
   before and after. This is the right Node semantics: `armWatchdog`'s callback runs in
   the timers phase; scheduling a fresh `setTimeout(fn, 0)` from inside it cannot fire
   again until the NEXT timers phase, and the poll phase (where child_process/utilityProcess
   `message` events are delivered) runs in between within the same loop iteration — so a
   heartbeat that was merely queued behind the stall gets one full poll-phase pass to land
   before the probe judges. `electron-workspace-watcher.spec.ts:522-555` and `:557-582`
   are not tautological: the fake clock's `runDueTimers()` deliberately does NOT fire the
   timer the callback itself just scheduled (docstring at spec.ts:52-56), so the test at
   line 522 calls `hosts[0].heartbeat()` in the gap between `runDueTimers()` and
   `clock.advance(0)` to simulate exactly the queued-message interleaving, and asserts no
   kill/no restart/no budget spend; the sibling test at line 557 omits that heartbeat and
   asserts the opposite (kill, restart, `heartbeat-missed` reason). That is a genuine proof
   of the interleaving claim, not a restated assertion.
   Residual, correctly scoped as residual by the task brief and not a defect: if MANY
   heartbeats/batches are queued, Node's poll phase drains all currently-ready I/O
   callbacks in one pass (not one-at-a-time with re-yields), so one turn is enough in
   practice; and if main is _still_ blocked when the 0 ms timer's own turn arrives, the
   host is correctly declared dead — the fix narrows the false-positive window to
   "main is blocked for less than roughly one probe-turn longer than the stall itself,"
   it does not eliminate false restarts under a main stall that never lets the loop turn
   at all (unrecoverable in any timer-based design; would need the Batch 5 main-loop
   watchdog's own signal to close entirely, which the recommendation in the base review
   still stands as a further hardening, not a defect in what shipped).

2. **Port doc rewrite — CONFIRMED, consistent.** `workspace-watcher.interface.ts:149-154`
   now states the repeating cadence and "recovers or is disposed," matching the new
   recovery behaviour below. Resolves S2 as written.

3. **Degraded recovery — MECHANICALLY SOUND, one real gap.**
   - Races checked and correct: `attemptRecovery` re-checks `subscriptions.size === 0`
     before forking (`electron-workspace-watcher.ts:546-550`) so a subscriber that
     unwatched during the 10-minute wait does not fork a host for nobody;
     `armDegradedRescan`'s own re-check (`this.state !== 'degraded' && !this.recovering`,
     line 534) keeps rescanning through the unconfirmed recovery window and stops the
     instant `confirmRecovery`/idle transition changes both flags; `dispose()` clears
     `recoveryTimer` and `degradedTimer` unconditionally (lines 250-255) and
     `recovering = false`, and `electron-workspace-watcher.spec.ts:808-822` ("dispose
     during a recovery attempt leaves no timer and no host") pins zero pending timers
     afterward — genuine, not tautological (it asserts `clock.pendingTimers === 0` after
     disposing mid-flight, then advances 3x the recovery delay and shows nothing forks).
   - Flapping host: `attemptRecovery` resets `failureTimes = []` (line 545) before
     forking, so a recovered-then-immediately-failing host is charged against a FRESH
     5/10-min budget rather than re-degrading instantly; `electron-workspace-watcher.spec.ts:707-760`
     proves this end to end (recovery confirms, budget spends five more times, still not
     degraded). No report-spam path found: `onDegraded` fires only from `enterDegraded`,
     never from the "recovery failed" branch (`electron-workspace-watcher.ts:443-458`,
     no `onDegraded?.()` call there), and `:762-806` pins exactly one `degradations` entry
     across two failed-recovery cycles. Rescan/recovery-overflow "double overflow at the
     same moment" is not reachable as a bug: the two are driven by different event
     sources (a timer callback vs. a message-triggered call), never invoked from the same
     stack, and `confirmRecovery` explicitly clears `degradedTimer` before the next tick
     could fire — `spec.ts:721-724`'s comment ("paced behind the 60 s rescan that fired at
     the same instant") shows the coincidence was deliberately tested and resolves to one
     coalesced delivery via `BatchRelay`'s own pacing, not a double emission to the
     listener.
   - **Real gap: "first message = success" does not verify the native subscription
     actually succeeded.** `confirmRecovery` fires on ANY non-`fatal` message
     (`electron-workspace-watcher.ts:337`: `if (this.recovering && message.type !== 'fatal') this.confirmRecovery()`).
     The host's `core.start()` posts its first heartbeat immediately on process boot
     (`workspace-watch-host.entry.ts:100`, unconditional), independent of and typically
     well before any `subscribe` message it receives is even parsed, let alone before
     `engine.subscribe(...)`'s promise resolves (`workspace-watch-host-core.ts:396-407`,
     async). Worse, if the native subscribe fails, the host posts `type: 'error'`,
     `code: 'native-subscribe-failed'` (`workspace-watch-host-core.ts:439-446`) and
     retries with backoff internally — but `'error'` is not `'fatal'`, so that message ALSO
     satisfies `message.type !== 'fatal'` and confirms recovery. The recovery host can
     therefore be declared recovered, and every subscriber told "the prior overflow is
     resolved, resume trusting live events," while the actual watch subscription is
     still failing and retrying in the background. File changes during that window are
     lost silently and reported nowhere (the `error` is only logged as a diagnostic
     line). `electron-workspace-watcher.spec.ts:707-760`'s own test title — "its first
     message ends the episode" — confirms this is the intended design, not an oversight
     the tests caught; no spec exercises "recovery host heartbeats, then its subscribe
     errors" to show the false-positive. This is the delta's one new Serious finding.
   - `armDegradedTimers`/`armDegradedRescan` do not clear `degradedTimer` on entering a
     recovery attempt (`attemptRecovery`, `electron-workspace-watcher.ts:543-553`), which
     is intentional per the code comment ("Rescans continue until a recovery host has
     proven itself") and matches Failure mode "Degraded mode never recovers" being closed
     out correctly — not a new issue.

4. **Host `invalid-message` cap — CONFIRMED, consistent, lifetime-per-instance is the
   right unit here.** `workspace-watch-host-core.ts:237` mirrors the adapter's own
   uncapped-but-per-instance counter (`electron-workspace-watcher.ts:175`, never reset
   either). Since a fresh `WorkspaceWatchHostCore` instance is created per host process
   (a new one on every restart, per `workspace-watch-host.entry.ts:93-101`), "lifetime"
   here really means "per host process," which resets naturally on the restart path this
   same batch already exercises — this is consistent with the adapter side, not a
   mismatch worth flagging further.

5. **`PTAH_WATCH_HOST=0` log — CONFIRMED.** `selectWorkspaceWatchHostForker`
   (`electron-workspace-watch-host-factory.ts:82-96`) posts one `info` diagnostic through
   `onDiagnostic` before returning the in-process forker, and `logDiagnostic`
   (`:121-140`) falls back to `console.log` when `TOKENS.LOGGER` is not yet registered —
   correct for phase-0 timing. `electron-workspace-watch-host-factory.spec.ts:97-130`
   pins both the message content and that it survives before the logger exists.

6-7. **Comments — CONFIRMED FIXED.** `shutdown.ts:241-244` and `wire-runtime.ts:556-560`
now read as forward references ("Batch 11 moves the git watcher onto it, and that
consumer will stop in `disposeBeforePersistence`" / no claim that a consumer exists
today) rather than present-tense claims; `wire-runtime.ts:559-560` additionally now
explains why this capture alone needs the `isRegistered` guard, closing the style
review's Minor-2 in the same edit.

8. **CLAUDE.md updates — CONFIRMED.** Both `platform-core/CLAUDE.md:59-66` and the
   existing `platform-electron/CLAUDE.md` `src/workspace-watch/` section now list the new
   files; `platform-core/CLAUDE.md:79-80` also documents the degraded-mode contract
   inline. Closes the base review's Deviation-4 / style review's Serious-1.

9. **Git-watcher stress harness S4036 fix — CONFIRMED for the rule, one real Windows
   gap.** `resolveGitExecutable` (`git-watcher.stress.harness.ts:47-61`) walks only
   absolute `PATH` entries and resolves an absolute executable path before
   `execFileSync` runs it — this is exactly what S4036 asks for (no bare-name spawn that
   lets the OS implicitly search relative/ambient directories) and would satisfy the
   rule. Linux CI: correct, `git` at `/usr/bin/git` (or a symlink to it, since
   `statSync` follows symlinks) resolves as expected. **Windows gap**: the code hardcodes
   `git.exe` and never consults `PATHEXT`, so an environment where `git` on PATH is a
   `.cmd`/`.bat` shim (some corporate wrapper installs, some non-standard Git-for-Windows
   packagings) resolves nothing and throws `no git.exe on an absolute PATH entry`, even
   though a real shell invocation of bare `git` would succeed via the OS's own PATHEXT
   search. This only breaks the opt-in stress harness (test infra, not shipped code), so
   it is Moderate, not Serious — flagged so a Windows CI image using a `.cmd` git shim
   does not get a confusing "git not found" failure from a harness that used to just call
   `spawn('git', ...)` and work.

### New findings this delta

**Serious — Degraded-mode recovery confirms on any non-fatal message, including a
native-subscribe failure notice**

- Trigger: the one fresh recovery host (`attemptRecovery`, every 10 minutes while
  degraded) sends its unconditional first heartbeat, or posts a `native-subscribe-failed`
  error, before its actual `@parcel/watcher` subscribe promise has resolved or ever
  succeeds.
- Symptom: `confirmRecovery()` fires early (`electron-workspace-watcher.ts:337`), tells
  every subscriber "recovered, one rescan, resume trusting live events" (`:555-567`), and
  stops the 60 s degraded rescan — while the underlying native watch is still retrying
  with backoff or has failed outright. Changes made during that window are never
  reported and nothing re-degrades until the NEXT independent host failure.
- Evidence: `electron-workspace-watcher.ts:337`, `:555-567`;
  `workspace-watch-host-core.ts:439-446` (posts `error`, not `fatal`, on subscribe
  failure); `workspace-watch-host.entry.ts:93-101` (heartbeat starts before any
  subscribe is processed).
- Current handling: none — any message type except `fatal` counts as proof of recovery.
- Recommendation: require a stronger recovery signal than "any message" — e.g., wait for
  either a `batch`/`notice` tied to the subscription actually re-establishing, or at
  minimum exclude `error` from the confirming set so a `native-subscribe-failed` cannot
  end the episode; add a spec that sends a heartbeat then a `native-subscribe-failed`
  error and asserts the episode does NOT end.

**Moderate — Windows git-shim gap in the stress harness's PATH walk**

- Trigger: a Windows CI image whose `git` on PATH is a `.cmd`/`.bat` shim rather than
  `git.exe`.
- Symptom: `resolveGitExecutable` throws `no git.exe on an absolute PATH entry` even
  though `git` runs fine from a real shell.
- Evidence: `git-watcher.stress.harness.ts:49` (hardcoded `.exe`, no `PATHEXT` walk).
- Current handling: none.
- Recommendation: fall back through `PATHEXT` (or at least try `.cmd`/`.bat` after
  `.exe`) before throwing, matching what `CreateProcess`'s own extension search would do.

### Verdict (delta)

- Recommendation: **APPROVE_WITH_FIXES**
- Confidence: HIGH
- Remaining fixes, neither blocking Batch 8's commit in isolation (still nothing
  downstream consumes the port until Batch 11):
  1. Serious — tighten degraded-recovery confirmation so an `error` message (in
     particular `native-subscribe-failed`) cannot end a degraded episode
     (`electron-workspace-watcher.ts:337`).
  2. Moderate — Windows `PATHEXT` fallback in the stress harness's git resolution
     (`git-watcher.stress.harness.ts:49`).
- Everything else in the original review's five action items (S1, S2, CLAUDE.md gap,
  invalid-message cap, hatch diagnostic) is confirmed fixed and each is independently
  pinned by a genuine (non-tautological) regression test, not merely asserted in a
  comment.

## Delta review 2 (recovery ack)

Re-read on disk in the worktree: `workspace-watch-protocol.ts:169-217`,
`workspace-watch-host-core.ts:1-460` (full `subscribe`/`ackSubscribers`/`ensureNative`/
`onNativeSubscribed` chain), `electron-workspace-watcher.ts` (full, 823 lines),
`libs/backend/platform-core/src/index.ts`, and
`electron-workspace-watcher.spec.ts:691-930` (the whole "degraded-mode recovery"
`describe` block). Ran `npx jest -c libs/backend/platform-electron/jest.config.ts
libs/backend/platform-electron/src/workspace-watch/electron-workspace-watcher.spec.ts
--maxWorkers=2`: 30/30 pass. No source edited.

This closes the delta-1 Serious finding ("first message = success"). The fix replaces
"any non-fatal message" with an explicit `subscribed` ack per subscription id, gated
behind a 6 s deadline (`heartbeatIntervalMs * missedHeartbeatsBeforeRestart`, the same
constant the normal-path watchdog uses) and an explicit failure on any
`native-subscribe-failed` / `subscribe-rejected` error seen while recovering. Checked
against the six specific risks:

**(a) Double/stray acks, ack for an unknown id.** `HostSubscription.acked`
(`workspace-watch-host-core.ts:122`) is a per-subscription-id flag set exactly once
(`ackSubscribers`, `:332-340`, `if (subscriber.acked) continue`) and never reset —
subscription ids are never reused (`ElectronWorkspaceWatcher.nextSubscriptionId` only
increments, `electron-workspace-watcher.ts:169`), so a nested-`.git` resubscribe, a
native-error retry, or any later `ensureNative` re-subscribe of the SAME root re-enters
`ackSubscribers` (called again from `onNativeSubscribed`, host-core.ts:452) but every
existing subscriber is already `acked: true` and is skipped — the host never sends a
second `subscribed` for a live id. On the adapter, `case 'subscribed':
if (this.awaitingAck.delete(message.id)) this.confirmRecoveryIfAcked();`
(`electron-workspace-watcher.ts:376`) — `Set.delete` on an id not present (unknown, or
already consumed) returns `false` and is silently a no-op. No crash, no double-confirm,
no re-ack risk. Confirmed by inspection; not separately spec'd, but the behaviour follows
directly from `acked` never being cleared, which is itself exercised implicitly by every
resubscribe-heavy spec that doesn't regress.

**(b) Stray ack from a killed previous host.** Every `process.on('message', ...)`
handler is registered per-generation inside `startHost()`
(`electron-workspace-watcher.ts:308-311`) and gates on `this.generation !== generation`
(the closure-captured value at registration time) before calling `onHostMessage` —
`awaitingAck`/`dispatch` are only ever reached for messages from the CURRENT host object;
a message emitted by an old, killed process invokes the OLD closure, whose generation
check now fails (both `killHost()` and `startHost()` bump `this.generation`), so it is
discarded before `case 'subscribed'` is reached. This is not just reasoned from the code —
`electron-workspace-watcher.spec.ts:813-847` ("a %s error from the recovery host is a
recovery failure, even after a heartbeat and other acks") sends `hosts[6].send({ type:
'subscribed', id: 2 })` (line 840) AFTER `hosts[6].kill` has already been called by the
`native-subscribe-failed` branch, then asserts `isDegraded` stays `true` and
`degradations` stays length 1 — a genuine, non-tautological proof that a stray post-kill
ack changes nothing, not merely an assumption.

**(c) `watch` during recovery: existing root vs. new/failing root.** `watch()`'s
`'running'` case now does `if (this.recovering) this.awaitingAck.add(id);` before
sending (`electron-workspace-watcher.ts:235`) unconditionally — it does not
distinguish "root already settled" from "new root," which is correct because the host
side does: if the root's native subscription is already `active` with no
`pendingToken`/`retryTimer`, `subscribe()`'s `ensureNative(root)` is a no-op and the
immediately-following `this.ackSubscribers(root)` (host-core.ts:328) acks the new
subscriber in the same synchronous handling of that one inbound message — effectively
immediate, matching the coordinator's expectation. `electron-workspace-watcher.spec.ts:715-771`
exercises the two-root case end to end (ids 1 and 2 both resent, acked independently,
`isDegraded` stays true until BOTH ack — line 731-743) — a genuine partial-ack proof, not
just a single-subscription happy path. A brand-new root that fails to subscribe surfaces
as a root-scoped `error` (no `id`, `workspace-watch-host-core.ts` `onNativeSubscribeFailed`
→ `postError('native-subscribe-failed', ...)` with no subscriber id), which the adapter
treats as a whole-recovery failure regardless of which/how-many subscriptions already
acked (`error` branch, `electron-workspace-watcher.ts:367-373`, unconditional on
`this.recovering`) — pinned by the `it.each` at line 813, which sends a prior heartbeat
and an ack for id 1 before the error and still asserts the whole episode fails. Correct
per this design's own stated "recovery is all-or-nothing" rule (header comment, lines
34-43); worth naming as a residual, not a defect: **a workspace with N roots where exactly
one root can never be subscribed (e.g., a permission-denied directory) means recovery
can never succeed for any of the N roots, forever, once every 10 minutes** — the design
intentionally trades this off against per-root retry noise, and it is the adapter's own
documented choice, not an oversight, but it is worth flagging to the team-leader as a
known limitation before Batch 11 wires a workspace whose git worktrees/nested roots are
likely to include an occasionally-unreadable directory.

**(d) Dispose of the last awaited subscription during recovery (zero subscriptions
left).** Traced by hand (no existing spec drives exactly this: `spec.ts:849-874`'s
"partial acks... a subscription disposed while awaited no longer blocks" leaves ONE
subscription remaining, not zero). `unwatch(id)` deletes from `this.subscriptions` BEFORE
calling `confirmRecoveryIfAcked()` (`electron-workspace-watcher.ts:276,281`), so when the
last awaited id is also the last subscription, `confirmRecoveryIfAcked` sees
`this.subscriptions.size === 0` and bails via its own guard (`:591`, comment "Idle
shutdown decides") WITHOUT clearing `recovering`/`recoveryTimer` — `unwatch` then falls
through to `scheduleIdleShutdown()` (30 s). The still-armed 6 s recovery-ack-deadline
timer (set by `attemptRecovery`, `:578-585`) fires first (6 s < 30 s) and, since
`this.recovering` is still true, calls `onHostFailure('recovery-unconfirmed', '0
subscription(s) never acked')`; that hits the `subscriptions.size === 0` branch
(`:449-461`) and correctly kills the host, clears every timer including the just-scheduled
`idleTimer`, calls `stopRecovering()`, and sets `state = 'idle'`. **End state is correct
(idle, host killed, no leaked timer, `isDegraded` eventually false)**, reached about 24 s
sooner than the ordinary idle path would have — which is arguably better (no wasted
process) — but via a diagnostic that reads as a genuine recovery failure
(`'recovery-unconfirmed'`; re-checking the actual emitted message: the `subscriptions.size
=== 0` branch is checked BEFORE the `recovering` branch inside `onHostFailure`, so what is
actually logged is `'[WorkspaceWatcher] idle host stopped'` with `detail: { reason:
'recovery-unconfirmed', detail: '0 subscription(s) never acked' }`, not a "degraded host
recovery failed" line) — a mildly confusing but not misleading detail payload for a
support engineer, and `isDegraded` (`state === 'degraded' || recovering`) reads `true` for
up to 6 s after the last subscriber left with nobody around to observe it. Moderate, not
Serious: no leak, no wrong end state, no production-visible symptom (nothing is
subscribed to read `isDegraded` in that window). Recommend, non-blocking: have
`unwatch`/`confirmRecoveryIfAcked` also clear `recovering`/`recoveryTimer` on the
`subscriptions.size === 0` path so the idle transition is the ordinary one and the 6 s
window disappears; add a regression test for this exact case (last awaited subscription
disposed with zero remaining) since none currently exists.

**(e) Normal-path decision.** Accept. The header's stated reasoning
(`electron-workspace-watcher.ts:40-43`) — a per-root native subscribe failure is already
handled inside the host via that root's own overflow + backoff retry
(`workspace-watch-host-core.ts` `onNativeSubscribeFailed`/retry timer, unchanged from
Batch 8), so charging it to the adapter's process-level restart budget would let one
permanently-unwatchable root (e.g., a permission-denied nested path) exhaust the budget
and degrade every OTHER root's live watching too. Recovery is the one place strictness is
justified because it is what ends the polling fallback for everyone, and the cost (a
recovery that can never confirm — see (c)'s residual) is bounded to "stay
degraded/polling forever," not "watching breaks for roots that already worked."

**(f) No timer leaks.** All five named timers (`watchdogTimer`, `restartTimer`,
`idleTimer`, `degradedTimer`, `recoveryTimer`) are cleared in `dispose()`
(`:260-265`), and `recoveryTimer` is correctly reused sequentially for its two distinct
purposes (10-minute next-attempt while degraded, 6 s ack-deadline while recovering) with
no overlap — each assignment happens only after the previous handle already fired and
was nulled, or after an explicit `clearTimer('recoveryTimer')` (`armDegradedTimers`,
`:544`). The fork/post-failure-during-recovery race is handled without a double-arm:
`attemptRecovery` checks `if (!this.recovering) return;` (`:575`) after calling
`startHost()`, so if `onHostFailure`'s synchronous `recovering` branch already fired (a
fork or post throw) and cleared `recovering`, the 6 s ack-deadline timer is never armed —
consistent with the in-line comment at that spot and with the pre-existing fork/post-
failure tests (`:595-627`) still exercising the same `startHost` failure path. Every spec
in the "degraded-mode recovery" block that calls `watcher.dispose()` also asserts
`clock.pendingTimers === 0` immediately after (`:770`, `:810`, `:845`, `:919`, and the
pre-existing block further down), which is a real, repeated proof point, not a single
spot-check.

### Verdict (delta 2)

- Recommendation: **APPROVE_WITH_FIXES**
- Confidence: HIGH
- The Serious finding from delta review 1 (recovery confirmed by any non-fatal message,
  including a `native-subscribe-failed` error) is closed correctly and is now the
  strictest, best-tested part of the adapter — five dedicated specs cover partial acks,
  heartbeat-only non-recovery, both subscribe-failure codes with a late stray ack, and
  cross-attempt budget/report accounting, all non-tautological.
- Two items remain, neither blocking Batch 8's commit (still nothing downstream consumes
  the port until Batch 11):
  1. Moderate — disposing the last awaited subscription during an in-flight recovery
     attempt (zero subscriptions remaining) reaches the correct idle end state, but via
     the 6 s ack-deadline timer racing ahead of the 30 s idle timer and logging a
     `'recovery-unconfirmed'` reason for what is really just nobody left to watch for;
     clear `recovering`/`recoveryTimer` on the `subscriptions.size === 0` path in
     `unwatch`/`confirmRecoveryIfAcked` and add a regression test for it
     (`electron-workspace-watcher.ts:591`, `:281-284`).
  2. Moderate (named, not new) — a workspace with one permanently-unwatchable root
     among several never lets recovery succeed for any of them; acceptable per the
     adapter's own documented all-or-nothing recovery design, but worth flagging to the
     team-leader as a known limitation before Batch 11 wires real multi-root consumers.
