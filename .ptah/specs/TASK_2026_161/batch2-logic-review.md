# Code Logic Review - TASK_2026_161 Batch 2 (process-tree-kill fix)

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 0              |
| Serious Issues      | 2              |
| Moderate Issues     | 2              |
| Failure Modes Found | 4              |

The core mechanism this batch sets out to fix — getting a _real_ PID (not a
`cmd.exe` shim PID) and group/tree-killing it — is soundly implemented for all
four adapters (pi, copilot, antigravity, opencode). The two Serious findings
are about the _timing_ contract of the kill path: it now unconditionally
costs a multi-second wait on POSIX that the old code did not, and the
manager's "wait for the handle to actually finish" safety net is silently
dead code for every continuation turn. Neither corrupts state or crashes
anything, but both are real, concrete regressions in observed behavior.

## The 5 Paranoid Questions

### 1. How does this fail silently?

`killProcessTree`'s `onError` callback is optional and every adapter's own
`onAbort` calls it as `void killProcessTree(child.pid)` with no `onError` at
all. If `taskkill`/`process.kill` fails for a reason that ISN'T "already
exited" (e.g. permission denied, PID reused by an unrelated high-privilege
process on Windows so `taskkill` errors), the adapter-side call swallows it
completely — no log, no Sentry, nothing. The manager's own parallel call
(`captureTreeKillError`) does report failures, so in practice the failure is
usually observed once — but only because of the redundant double-kill (see
Q4/Issue "double tree-kill"), not because either call path is independently
safe.

### 2. What user action causes unexpected behavior?

Clicking "Stop" (or hitting a timeout) on a Pi, Copilot, Antigravity, or
Opencode agent on **macOS/Linux** now takes ~5 seconds (`KILL_GRACE_PERIOD`)
to resolve even when the CLI process dies within milliseconds of receiving
SIGTERM. Previously the manager raced against the child's `exit` event and
returned as soon as the process actually died. See Issue 1.

### 3. What data makes this produce wrong results?

N/A for this batch — no data transformation involved, purely process
lifecycle. The closest analogue is PID reuse (Issue 4), which is a
correctness hazard rather than a data hazard.

### 4. What happens when dependencies fail?

- If `taskkill` itself is unavailable/blocked (locked-down Windows
  environment, group policy), `execFileAsync` rejects, `onError` records it
  (manager side) or is silently dropped (adapter side), and the function
  returns — the child is left running. This is pre-existing risk carried
  over from the old code (same taskkill-based approach), not a new
  regression.
- If `process.kill(-pid, ...)` fails because the child was never actually
  made a group leader (e.g. a future caller of `spawnCli` overrides/omits
  `detached` — not possible today since `detached` is hardcoded, but worth
  noting there's no assertion tying the two together), the code falls back
  to a single-process kill silently. This fallback is correct pre-existing
  design carried into the new helper.

### 5. What's missing that the requirements didn't mention?

- No adapter passes a real `onError` to its own `onAbort`-triggered
  `killProcessTree` call, so adapter-side kill failures are invisible except
  via the manager's redundant second attempt.
- Nothing resets `copilot-sdk.adapter.ts`'s `activeChild` to `undefined`
  between turns (pi does). Currently unreachable but inconsistent with the
  sibling adapter's defensive pattern (Issue 4).

## Failure Mode Analysis

### Failure Mode 1: POSIX abort/stop always blocks the full grace period

- **Trigger**: User stops, or the manager times out, any Pi/Copilot/
  Antigravity/Opencode agent while running on macOS or Linux.
- **Symptoms**: The `stop()` RPC call (and therefore whatever UI awaits it)
  hangs for ~`KILL_GRACE_PERIOD` (5000ms) even though the underlying CLI
  process typically dies within tens of milliseconds of SIGTERM.
- **Impact**: UX regression — every "Stop Agent" click on POSIX now feels
  like it hangs for 5 seconds. Not data-lossy, but a clear behavioral
  downgrade from the previous implementation.
- **Current Handling**: None — `killProcessTree`'s POSIX branch only
  resolves inside its `setTimeout(..., KILL_GRACE_PERIOD)` callback; it has
  no way to observe the child's actual exit (it only has a bare `pid`, not
  the `ChildProcess` object), so it cannot short-circuit early. See Issue 1
  for detail.
- **Recommendation**: For call sites that still hold the `ChildProcess`
  handle (all four adapters do, and the manager's legacy branch does too),
  race the grace-period timer against the child's own `'exit'` event instead
  of always sleeping the full period, exactly as the pre-change code did.

### Failure Mode 2: Manager's continuation-turn "wait for handle to finish" is dead code

- **Trigger**: `stop()`/`handleTimeout()` fires while a Pi or Copilot agent
  is on its _second or later_ turn (`continueConversation()` already ran at
  least once).
- **Symptoms**: None currently visible — masked by Failure Mode 1's blocking
  wait — but the intended safety net (`Promise.race([tracked.sdkHandle.done,
timeout])`) never actually waits for the _current_ turn's child; it races
  against `sdkHandle.done`, which is permanently bound to the _first_ turn's
  `runTurn()` promise and is already settled by the time any continuation
  can be aborted.
- **Impact**: If `killProcessTree(sdkPid, ...)` is ever skipped (e.g.
  `getPid()` returns `undefined` for some future adapter/turn state), the
  manager would fall straight through this race with effectively zero wait,
  returning "stopped" before the process has actually been asked to die.
- **Current Handling**: None — see Issue 2 for the code path.
- **Recommendation**: Either have `continue()`/`continueConversation()`
  update a live reference the manager re-reads (not a frozen `done` field),
  or drop the `Promise.race` entirely and rely solely on the (fixed)
  `killProcessTree` wait, since duplicating the same wait twice adds nothing
  once Failure Mode 1 is fixed.

### Failure Mode 3: Detached probe/listModels children escape the host's process group

- **Trigger**: A `probeCliVersion`/`probeModels`/`listModels` call is
  in-flight (up to 5-8s window) on macOS/Linux when the extension host
  process itself receives a process-group-targeted signal (terminal Ctrl+C
  during `npm run dev`, a supervisor sending `kill -TERM -$hostpid`, etc.).
- **Symptoms**: The probe child, now a session/group leader of its own
  (`detached: true` from the shared `spawnCli`), does not receive that
  signal and can outlive the host process until it exits on its own or
  hangs indefinitely (no one is left to service the in-process `setTimeout`
  that was supposed to kill it).
- **Impact**: Low-severity, narrow window, but a genuine new class of
  orphan that did not exist before `detached` was made unconditional. stdio
  capture itself is unaffected — pipes function identically whether or not
  the child is detached. See Issue 3.
- **Current Handling**: None — these call sites still use bare `child.kill()`
  on timeout (not `killProcessTree`), so they gain none of the group-kill
  benefit `detached` exists to enable, only the downside of leaving the
  host's process group.
- **Recommendation**: Either scope `detached` to only the long-running
  main-run spawns (which actually need group-kill via `killProcessTree`), or
  accept this as a deliberate, documented trade-off (it currently is not
  documented as such).

### Failure Mode 4: `copilot-sdk.adapter.ts` never nulls `activeChild` between turns

- **Trigger**: Hypothetical future code path that calls
  `tracked.sdkHandle.getPid()`/kills the agent without first checking
  `tracked.info.status === 'running'` (today, both `stop()` and
  `handleTimeout()` correctly gate on this, and the status flip to
  `'running'` happens synchronously with `runTurn()` re-assigning
  `activeChild`, so there's no reachable window today).
- **Symptoms** (if the guard were ever bypassed): `getPid()` returns the
  _previous_ turn's already-exited PID; `killProcessTree` would then target
  a PID that could, in the worst case, have been reused by an unrelated OS
  process during a long idle-between-turns period (user takes minutes to
  send the next message).
- **Impact**: Currently zero (unreachable). Latent risk only.
- **Current Handling**: `pi-cli.adapter.ts` defends against exactly this by
  setting `activeChild = undefined` in `finish()`; `copilot-sdk.adapter.ts`
  has no equivalent reset. See Issue 4.
- **Recommendation**: Mirror pi's pattern — null `activeChild` when a turn's
  `child.on('close'/'error', ...)` fires, purely as defense-in-depth so this
  can't become live if the status guard is ever relaxed.

## Critical Issues

None.

## Serious Issues

### Issue 1: `killProcessTree` on POSIX can never resolve before `KILL_GRACE_PERIOD` elapses, even if the child exits instantly

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:58-81`
- **Scenario**: Any abort/stop/timeout of a Pi/Copilot/Antigravity/Opencode
  agent on macOS or Linux.
- **Impact**: `AgentProcessManager.killProcess()` (both the SDK-handle branch
  via `await killProcessTree(sdkPid, 'SIGTERM', ...)` at line ~1163, and the
  legacy `tracked.process` branch at line ~1180) now unconditionally blocks
  for `KILL_GRACE_PERIOD` (5000ms) on every kill on POSIX. The old
  implementation (removed by this diff) raced the grace-period timer against
  `child.on('exit', ...)` and resolved as soon as the process actually died
  — typically near-instantly for any CLI that handles SIGTERM. This is a
  measurable UX regression: `stop()` is awaited synchronously by callers
  (RPC handlers), so every "Stop Agent" action on POSIX now takes ~5s to
  report success regardless of how fast the underlying process actually
  died.
- **Evidence**:
  ```ts
  // cli-adapter.utils.ts — POSIX branch
  killGroup(signal);
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      // only checked at the 5s mark, never earlier
      try {
        process.kill(pid, 0);
      } catch {
        resolve();
        return;
      }
      try {
        killGroup('SIGKILL');
      } catch (err) {
        onError?.(err);
      }
      resolve();
    }, KILL_GRACE_PERIOD);
    timer.unref?.();
  });
  ```
  The helper only has a bare `pid` (by design, so it can be shared across
  both the `ChildProcess`-holding legacy path and the SDK-handle path), so it
  has no way to listen for the specific child's `'exit'` event and can only
  poll liveness at the grace-period boundary — the comment in the source
  even acknowledges this ("it always waits the grace period then
  escalates"). But every current caller (all four adapters, plus the
  manager) _does_ still hold the `ChildProcess`/PID at the call site and
  previously exploited that to resolve early.
- **Fix**: Not prescribed (review only) — but the natural fix is to let
  callers that still hold the `ChildProcess` handle pass an exit-await
  (e.g. an optional `waitForExit: () => Promise<void>` or the handle itself)
  so the helper can race the grace-period timer against actual exit, restoring
  the old early-resolve behavior, while still falling back to pure
  PID-polling for callers that only have a bare number.

### Issue 2: Manager's SDK-handle grace-period wait races against a permanently-stale promise for continuation turns

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:1152-1172`
- **Scenario**: Any `stop()`/timeout on a Pi or Copilot agent while on its
  second or later turn (i.e. after at least one successful
  `continueConversation()`).
- **Impact**: `tracked.sdkHandle` is the same object for the lifetime of the
  tracked agent (`trackSdkHandle()` stores it once); its `.done` field is set
  once, at handle-construction time, to the _first_ `runTurn()`'s promise
  (`const done = runTurn(...); return { ..., done, ... }`). `continue()`
  returns a _new_, separate `{ done }` that the manager awaits independently
  in `continueConversation()` (line 779) — it never replaces
  `tracked.sdkHandle.done`. Because `continueConversation()` requires
  `tracked.info.status !== 'running'` to even start (i.e. turn 1's `done` has
  already resolved), `tracked.sdkHandle.done` is _already settled_ the
  moment any continuation turn becomes killable. `Promise.race([alreadyResolvedPromise, timeout])`
  therefore resolves on the next microtask, not when the _current_ turn's
  child actually exits.
- **Evidence**:
  ```ts
  // agent-process-manager.service.ts
  await Promise.race([
    tracked.sdkHandle?.done ?? Promise.resolve(), // frozen to turn 1, already resolved
    new Promise<void>((resolve) => setTimeout(resolve, KILL_GRACE_PERIOD)),
  ]);
  ```
  Currently masked in practice because the `await killProcessTree(sdkPid, ...)`
  immediately above it already consumes the full grace period on POSIX
  (Issue 1), so by the time this race is reached the process is very likely
  already dead. But the race itself provides zero actual protection for
  continuation turns — it is dead logic that will silently do nothing the
  moment Issue 1 is fixed or `getPid()` returns `undefined` for some future
  adapter.
- **Fix**: Not prescribed — but this needs either a live reference (e.g. the
  manager re-reading a `getDone()` accessor instead of a frozen `done`
  field) or removal, since it currently provides no functional benefit and
  gives false confidence that "wait for the run to actually settle" is
  happening for continuations.

## Moderate Issues

### Issue 3: `detached: true` on short-lived probes trades an orphan risk for a benefit they never use

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:117-134` (via `spawnCli`), consumed by `probeCliVersion` (utils.ts:165), `probeModels` (antigravity-cli.adapter.ts:147), `listModels`'s child spawns (opencode-cli.adapter.ts:260, pi-cli.adapter.ts:210)
- **Scenario**: Extension host process receives a process-group signal
  (terminal Ctrl+C, supervisor `kill -TERM -$pid`) on macOS/Linux while a
  version/models probe is in flight.
- **Impact**: Probes are now session/group leaders of their own
  (`detached: true`, unconditional), so they no longer receive signals sent
  to the host's process group the way they did before this change. They
  never call `killProcessTree` (they still use bare `child.kill()` on
  timeout), so they get none of the group-kill upside `detached` exists to
  provide — only the downside of surviving a host-level group signal until
  their own in-process timeout fires (which won't fire either, if the host
  process itself is gone). Stdio capture is confirmed unaffected —
  `detached` does not change pipe behavior.
- **Fix**: Not prescribed — scope `detached: true` to spawns that are
  actually reachable via `killProcessTree`, or accept/document the trade-off
  explicitly.

### Issue 4: `copilot-sdk.adapter.ts`'s `activeChild` is never reset between turns (asymmetric with `pi-cli.adapter.ts`)

- **File**: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/copilot-sdk.adapter.ts:286,358,464` vs. `pi-cli.adapter.ts:396,424` (pi's `finish()` sets `activeChild = undefined`)
- **Scenario**: Latent only today — see Failure Mode 4. Not currently
  reachable because `killProcess()` is only invoked while
  `tracked.info.status === 'running'`, and the status flip in
  `continueConversation()` happens synchronously (no `await`) alongside
  `runTurn()` re-assigning `activeChild`.
- **Impact**: A future refactor that removes/weakens the status guard (e.g.
  an "always force-kill on dispose regardless of state" path) would silently
  reintroduce the classic PID-reuse hazard specifically for Copilot, not Pi,
  because Pi already defends against it and Copilot does not.
- **Fix**: Not prescribed — mirror pi's `activeChild = undefined` reset in
  copilot's turn-completion path for consistency and defense-in-depth.

## Data Flow Analysis

```
adapter.runSdk()
  └─ spawnCli(command, args, {..., detached: !win32})   [confirmed: detached wired correctly]
       └─ child (real PID, group leader on POSIX)
            ├─ getPid() closure over mutable activeChild  [confirmed correct for pi/copilot: always current]
            ├─ onAbort → killChild()/killProcessTree(child.pid)  [fire-and-forget, no onError]
            └─ AgentProcessManager.killProcess()
                 ├─ sdkAbortController.abort()  → fires onAbort above (synchronous, same tick)
                 ├─ killProcessTree(getPid(), 'SIGTERM', captureTreeKillError)  [awaited — ALWAYS 5s on POSIX, Issue 1]
                 └─ Promise.race([sdkHandle.done (STALE for turn 2+, Issue 2), timeout])  [effectively no-op]
```

### Gap Points Identified:

1. `killProcessTree`'s POSIX timer resolves only at the grace-period
   boundary — no early-exit fast path (Issue 1).
2. `sdkHandle.done` frozen to turn 1 makes the manager's fallback wait dead
   code for continuations (Issue 2).
3. Adapter-side `onAbort` kill failures have no observer (`onError`
   omitted) — silent unless the manager's redundant call happens to also
   fail and gets reported.

## Requirements Fulfillment

| Requirement                                                                     | Status                                        | Concern                                                                                                                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared `killProcessTree(pid, signal, onError)` helper                           | COMPLETE                                      | Correctly cross-platform (taskkill/T/F vs. group-kill+escalate); best-effort/never-throws contract honored                                        |
| `detached: process.platform !== 'win32'` on all `spawnCli` calls                | COMPLETE                                      | Applied unconditionally, including short-lived probes that don't need it (Issue 3)                                                                |
| pi/antigravity/opencode routed through `resolveDirectSpawn` for main-run spawns | COMPLETE                                      | Correctly resolves `.cmd` shims to real node entrypoints; verified env (`OPENCODE_CONFIG_CONTENT`) and other spawn options pass through unchanged |
| `getPid` exposed on each spawn adapter's `SdkHandle`                            | COMPLETE (pi, copilot, antigravity, opencode) | Correctly closure-captured (reflects current turn), not a stale snapshot, for all four                                                            |
| Manager's `killProcess` routed through shared helper                            | PARTIAL                                       | Timing contract regressed vs. the pre-change implementation (Issues 1-2)                                                                          |

### Implicit Requirements NOT Addressed:

1. Preserving the "resolve as soon as the process actually exits" behavior
   of the old implementation was not explicitly stated but is a reasonable
   expectation carried over silently by the refactor — and it regressed.
2. Observability for adapter-side (`onAbort`) tree-kill failures — the
   manager gets Sentry reporting via `captureTreeKillError`, adapters get
   nothing.

## Edge Case Analysis

| Edge Case                                                   | Handled                          | How                                                                                                          | Concern                                                                                                |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Process already exited before kill                          | YES                              | `taskkill`/`process.kill(pid,0)` ESRCH treated as success                                                    | None                                                                                                   |
| Multi-turn adapter mid-continuation abort                   | PARTIAL                          | `getPid()` correctly targets current turn's child                                                            | Manager's grace-period wait doesn't actually apply to this turn (Issue 2)                              |
| Windows `.cmd` shim as main binary                          | YES                              | `resolveDirectSpawn` walks to real node entrypoint                                                           | None found                                                                                             |
| Opencode native `.exe` binary                               | YES                              | `resolveDirectSpawn` returns `.exe` unchanged, env preserved                                                 | None found                                                                                             |
| Double-fire kill (manager + adapter onAbort)                | YES (harmless)                   | Both target same PID near-simultaneously; ESRCH/"not found" on the loser is caught                           | Wasteful (duplicate OS calls, duplicate 5s timers) but not incorrect — see Issue 1/3 for the real cost |
| Import cycle (utils ↔ manager-helpers)                      | YES (no cycle)                   | `agent-process-manager-helpers.ts` only imports from `@ptah-extension/shared`; the dependency graph is a DAG | None found                                                                                             |
| Probe (`--version`/`models`) killed via bare `child.kill()` | YES (unchanged) but now detached | No change in grandchild-reaping (still broken pre-existing); new: escapes host process group                 | Issue 3                                                                                                |

## Integration Risk Assessment

| Integration                                 | Failure Probability           | Impact                                                                              | Mitigation                                  |
| ------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `stop()` RPC → `killProcess()` (POSIX)      | HIGH (always happens)         | 5s perceived hang per stop                                                          | Needed: exit-event race, see Issue 1        |
| Continuation-turn abort → grace-period wait | MED (only on 2nd+ turn abort) | Currently masked by Issue 1; would silently break if Issue 1 is fixed independently | Needed: live `done` reference, see Issue 2  |
| Host process group signal during probe      | LOW                           | Orphaned probe process, self-resolving in most cases                                | Scope `detached` more narrowly, see Issue 3 |

## Verdict

**Recommendation**: REVISE
**Confidence**: HIGH
**Top Risk**: Every "Stop Agent" action on macOS/Linux now takes ~5 seconds
regardless of how fast the CLI actually exits (Issue 1), and the manager's
intended safety net for continuation-turn kills is dead code that currently
only "works" by accident because of Issue 1's blocking wait (Issue 2). Fixing
one without the other leaves a real gap.

## What Robust Implementation Would Include

- `killProcessTree` accepting an optional exit-await (or the `ChildProcess`
  itself) from callers that have it, so it can race the grace period against
  real exit instead of always sleeping the full duration.
- The SDK handle exposing a way for the manager to always await the
  _current_ turn's completion (not a frozen first-turn promise) — e.g. a
  `getDone(): Promise<number>` accessor instead of a static `done` field, or
  updating `tracked.sdkHandle` itself on each `continueConversation()` call.
- `onError` wired through on the adapter-side `onAbort` calls too, so a
  failed tree-kill is observable from wherever it happens, not just when the
  manager's redundant second attempt happens to also fail.
- `detached: true` scoped to spawns that actually get tree-killed via PID
  (the long-running main-run children), leaving short probes in the host's
  process group so they die naturally with it.
