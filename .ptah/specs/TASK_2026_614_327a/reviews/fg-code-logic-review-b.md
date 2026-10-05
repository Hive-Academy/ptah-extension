# Code Logic Review B — `TASK_2026_614_327a`, Stage F + G (backend part 2)

Scope: `git diff 55f245619..08e51a353` limited to `libs/backend/vscode-lm-tools`, `libs/backend/tool-output-reducers`,
`libs/backend/rpc-handlers`, `libs/backend/cli-agent-runtime/src/lib/cli-agents`, `apps/ptah-cli`,
`apps/ptah-extension-vscode`, `apps/ptah-electron` (29 files, +1733/−297). Batches 21, 23, 24, 24A, 25, 26, 29.
Decisions applied: G-A (await `killRunningChecks` with a 5 s budget on both hosts), G-D (resume decision in the RPC
result and the log only).

## Summary

| Metric              | Value                |
| ------------------- | -------------------- |
| Overall score       | 7/10                 |
| Assessment          | APPROVED WITH FIXES  |
| Blocking issues     | 0                    |
| Serious issues      | 0                    |
| Moderate issues     | 4 (2 to fix this round: M1 data loss, M2 data loss) |
| Minor issues        | 5                    |
| Failure modes found | 7                    |

Why 7 and not 8: no defect breaks a stated acceptance criterion, but the VS Code shutdown ordering can spend the
whole deactivate window on the kill before the metadata flush (M1), and the Windows pid retention after a failed kill
can direct a later `taskkill /T /F` at a reused pid (M2). Why not 6: every flow the batches promised is wired
end to end, and each bounded wait is actually bounded.

## Five logic questions

### 1. How does this fail silently?

- VS Code `deactivate` awaits the 5 s check kill before `flushSessionMetadataStores()`
  (`apps/ptah-extension-vscode/src/main.ts:165-181`, flush at `:199`). If the extension host cuts deactivate short,
  the flush and Sentry flush never run, and nothing reports it (M1).
- After `execute_code` is cancelled or times out, the sandbox's remaining `ptah.*` calls still execute: the bridge
  never checks `signal.aborted` (`code-execution.engine.ts:248-267`). The caller has been told "cancelled"; a later
  `ptah.agent.spawn` in the same script still starts a lane (M3).
- A `.gitignore` failure on a spool dir is reported once; if the directory is later recreated and fails again, the
  second failure is not reported (`spool.ts:208-218`), because a success never removes the dir from the set (Minor).

### 2. What user action produces unexpected behaviour?

- Cancel an `execute_code` whose script catches the `waitFor` error or continues with non-abort-aware calls: work
  continues after the cancel (M3).
- Quit or reload the window while a `ptah_run_check` is running whose Nx group ignores SIGTERM: quit takes up to
  5 s longer (Electron, by design under G-A), and on VS Code the flush comes after that (M1).
- Start a `ptah_run_check` during the shutdown window (after the kill snapshot): it is not killed (M4).

### 3. What input data produces a wrong answer?

- Windows: `taskkill` exits non-zero when the root pid has already exited. A run whose process exits at the moment
  the timeout fires gets `killFailed`, and when `close` arrives inside `KILL_SETTLE_MS` the reply still says
  "kill failed (pid N may still be running)" although the process closed (`run-check.tool.ts:545-551`, `:576-582`,
  `ended()` at `:479-492`). False alarm (Minor).
- A peer that reuses a JSON-RPC id while the first call is still in flight gets a `-32600` reply carrying that same id
  (`stdio-mcp-server.service.ts:247-260`), which the peer will match to the *first* call. The peer broke the protocol
  first; impact is confined to that peer (Minor).

### 4. What happens when a dependency fails?

- Tree kill fails (G.3): recorded, reported in the verdict, pid kept in `liveChecks` with a retry closure, dropped on
  `close` or a successful retry (`run-check.tool.ts:493-523`). Correct, with the Windows pid-reuse hazard in M2.
- `killRunningChecks` never resolves (hung `taskkill`): Electron bounds it with `withBudget`
  (`shutdown.ts:430-435`, `:446`); VS Code with `killRunningChecksWithin` (`main.ts:236-257`). Neither can hang the quit.
  Electron worst case: boot drain + gateway budget + agent reap budget + remaining kill budget + 2 s flush — all bounded.
- `agent:setConfig` write rejects: caught inside `applySetConfig`, the queue tail swallows both outcomes
  (`agent-rpc.handlers.ts`, `setConfigQueue = run.then(() => undefined, () => undefined)`), so a later write is not
  blocked. A write that *never settles* would block every later `agent:setConfig` (Minor; no evidence any write can hang).
- `resolveModel` reads configuration synchronously; a missing key yields `''` → `cli-default` (`agent-spawn-environment.service.ts:152-166`,
  `lane-spawn-policy.ts:50-61`). No failure path added.

### 5. What is missing that the requirements never mentioned?

- The `execute_code` timeout does not abort `ptah.agent.waitFor`: only the caller's request signal is bound
  (`code-execution.engine.ts:414-430`). After a timeout the wait keeps its `agent:exited` listener for up to 15 minutes
  (M3).
- No guard against new checks started after the kill snapshot during shutdown (M4).

## Failure modes

### FM1 — VS Code flush starved by the check kill (M1)

- Trigger: deactivate with a running check whose tree kill takes close to the 5 s budget (POSIX group ignoring SIGTERM
  → SIGKILL at `PROCESS_TREE_KILL_GRACE_MS`, or a slow `taskkill`), and few or no agents to reap.
- Symptom: session references staged by earlier agent exits are not flushed if the host ends deactivate early.
- Evidence: `main.ts:181` `await Promise.all([checksKilled, agentsReaped])` precedes `main.ts:199`. The comment at
  `main.ts:160-164` states the opposite intent ("must not spend the deactivate budget ... the metadata flush below need").
- Current handling: the flush waits for max(kill, reap).
- Recommendation: `await agentsReaped; await flushSessionMetadataStores(); await checksKilled;` (or start the flush
  after the reap and race the kill alongside it). The flush depends on the reap only.

### FM2 — Retained Windows pid can be reused (M2)

- Trigger: win32; tree kill fails (typically "process not found" because the root exited), the stdio pipes stay open
  (no `close`), the settle backstop fires → `register(retryKill)` (`run-check.tool.ts:521`). Later dispose runs
  `taskkill /pid N /T /F` (`process-tree-reaper.ts:63-66`).
- Symptom: if Windows reused pid N, an unrelated process tree is force-killed (possible data loss in that process).
  If not reused, the retry fails forever, so every Electron quit is deferred and pays a futile `taskkill`.
- Evidence: `closed` tracks only `close` (`run-check.tool.ts:576-582`); the root's `exit` is not tracked.
- Recommendation: listen to `exit` as well and never register `retryKill` once the root has exited on win32 (a tree
  kill by pid cannot reach orphans there anyway); keep the retry only while the root is known alive.

### FM3 — Work continues after `execute_code` cancel or timeout (M3)

- Trigger: cancel (or timeout) while the script is between `ptah.*` calls or awaiting a non-abort-aware one.
- Symptom: subsequent bridge calls run, e.g. a lane spawned after the user cancelled; after a timeout `waitFor` keeps
  waiting up to 15 min with a listener on `agent:exited`.
- Evidence: `code-execution.engine.ts:248-267` (no `signal.aborted` check), `:414-430` (timeout does not abort any
  controller); `agent-namespace.builder.ts:540`.
- Recommendation: create an internal `AbortController` per run, abort it on caller abort *and* on timeout, bind that
  signal in `executionSignal.run`, and have the bridge reject immediately when it is aborted.

### FM4 — Check started after the kill snapshot survives shutdown (M4)

- Trigger: an MCP `ptah_run_check` arrives between `killRunningChecks()` and process exit. Electron never stops the
  MCP server in the chain (`shutdown.ts` has no MCP stop); VS Code disposes it at `main.ts:201`, after the kill.
- Symptom: an orphaned Nx tree after quit.
- Recommendation: refuse new checks once a shutdown flag is set (e.g. a module-level `stopAcceptingChecks()` called
  just before `killRunningChecks`). Narrow window; not a regression.

### FM5 — False "kill failed" verdict (Minor)

See question 3. Recommendation: clear `killFailure` (or omit `killFailed` from the verdict) when `close` arrives.

### FM6 — Duplicate id reply ambiguity (Minor)

See question 3. Acceptable given the peer violated JSON-RPC; document it.

### FM7 — `setConfig` queue blocked by a hung write (Minor)

A write that never settles blocks every later `agent:setConfig`. No evidence of a hanging writer; note only.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- M1 (fix this round — can lose data: session metadata flush): `apps/ptah-extension-vscode/src/main.ts:181,199`. FM1.
- M2 (fix this round — can lose data: force-kill of an unrelated reused-pid tree on Windows):
  `run-check.tool.ts:509-523,576-582`. FM2.
- M3 (not required this round — no config or data loss; a stray lane is visible and stoppable):
  `code-execution.engine.ts:248-267,414-430`. FM3.
- M4 (not required this round): shutdown window, `shutdown.ts:426-446`, `main.ts:165-201`. FM4.
- Minor: false kill-failed text after a late `close` (`run-check.tool.ts:489-491`).
- Minor: duplicate-id `-32600` reply reuses the in-flight id (`stdio-mcp-server.service.ts:247-260`); the same check is
  absent for `session_submit` (`:224-233`), where a duplicate id overwrites the `inFlightSubmits` entry and loses the
  first call's cancel flag.
- Minor: `.gitignore` failure suppression never resets after a success (`spool.ts:208-218`); log only, the
  set is bounded at 64 (`MAX_PRUNE_ENTRIES`, `spool.ts:44`).
- Minor: `setConfigQueue` has no bound on a hung write (`agent-rpc.handlers.ts`, `agent:setConfig` registration).
- Minor: Electron awaits the check kill before the final metadata flush (`shutdown.ts:445-463`). The deferred quit is
  self-controlled so nothing is lost on a normal quit; under an OS shutdown with a short grace it delays the flush up
  to 5 s. Same reordering as M1 would remove it.

## Data flow

1. `execute_code` HTTP request → `abortOnEarlyClose(res)` (`http-server.handler.ts:327-333`, aborts only if the
   response did not finish) — OK; a cancel after completion is a no-op.
2. `handleExecuteCodeCall` → `executeCode(..., signal: getRequestAbortSignal())` (`protocol-dispatcher.ts:3703-3709`) — OK.
3. Engine: pre-aborted → throws; listener registered before the code runs; finally clears timer and listener
   (`code-execution.engine.ts:414-470`) — OK, no leak.
4. Bridge binds the signal per call (`:267`) → `waitFor` reads it (`agent-namespace.builder.ts:540`) →
   `waitForAgents` removes its listener on every finish path (`agent-process-manager.service.ts:1386-1413`) — OK.
   Gap: calls after cancel still run (FM3).
5. stdio `tools/call` → controller per id → peer cancel marks `peerCancelledCalls` and aborts
   (`stdio-mcp-server.service.ts:369-374`) → `settle` tags the response object → `mcp-serve.ts:376` returns
   `NO_RESPONSE` → `server.ts:215` sends nothing — OK. Non-cancelled requests: the WeakSet only contains objects
   produced by `settle(..., true)`; every response path constructs a fresh object, so a non-cancelled request always
   gets a reply. A cancel that arrives after the call settled finds nothing in flight and the reply is sent — correct.
   Notifications never reach `dispatchRequest` (`server.ts:185-197`), so the sentinel cannot affect them.
6. Shutdown (Electron): `requiresDeferredDisposal` includes retained pids (`shutdown.ts:408-414`) → kill started at
   LIFO position, budgeted, awaited after teardown (`:426-446`) → bounded flush → `quit()` in `finally` — OK, bounded.
7. Shutdown (VS Code): kill ‖ reap → flush (FM1 gap).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| G.3 / 21.1 failed kill reported, pid kept until `close`, retried by dispose | COMPLETE | FM2 (win32 reuse), FM5 |
| 21.3 / 24A stdio: duplicate id refused, cancelled request unanswered | COMPLETE | submit path lacks the duplicate check (Minor) |
| 23 `execute_code` cancel reaches `ptah.agent.waitFor` | COMPLETE | timeout not propagated; bridge not gated (FM3) |
| 24 mcp-serve id pass-through, dispose before stop pinned | COMPLETE (spec-only batch) | — |
| 25.1 / G-D `resumeDecision` in RPC result and log | COMPLETE | — |
| 25.2 serialised `agent:setConfig`; rejection does not block | COMPLETE | hung write unbounded (Minor) |
| 25.3 default model checked before SDK-handle spawn | COMPLETE | matches `doSpawnSdk` resolution; Ptah CLI provider/tier models stay unchecked as documented |
| 26 spool `.gitignore` failure reported once per dir, bounded set | COMPLETE | no reset on success (Minor) |
| 29 / G-A kill awaited ≤5 s on both hosts | COMPLETE | VS Code ordering vs flush (FM1) |

Implicit requirements not addressed: no new checks accepted during shutdown (FM4); timeout-driven abort of `waitFor` (FM3).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Cancel after `execute_code` completed | YES | `writableFinished` guard; listener removed in `finally` | — |
| Signal already aborted before run | YES | early throw (engine), early `cancelled` (`waitForAgents:1381`) | — |
| Kill fails, then `close` arrives | YES | `close` unregisters | reply still says kill failed (FM5) |
| Kill fails, no `close` | PARTIAL | retained retry | win32 pid reuse (FM2) |
| Kill hangs at quit | YES | 5 s budgets both hosts | — |
| Two overlapping `agent:setConfig` | YES | promise chain | hung write blocks queue |
| Rejected `agent:setConfig` write | YES | caught, chain tail swallows | — |
| Duplicate in-flight tools/call id | YES | `-32600` | reply id ambiguity; submit path unguarded |
| Cancel for a finished call | YES | not in flight → reply sent | — |
| Spool dirs > 64 failing | YES | set cleared | one repeat log |

## Verdict

- Recommendation: APPROVED WITH FIXES (fix M1 and M2 this round; M3/M4 and Minors may be deferred as named follow-ups).
- Confidence: MEDIUM-HIGH. All in-scope production hunks were read; specs were not executed by this reviewer.
  The VS Code deactivate time limit is the host's, not verified in this repository; M1 relies on the repository's own
  comment at `main.ts:160-164` that such a budget exists.
- Top risk: on VS Code, a slow check kill delays the session metadata flush past the host's deactivate window.
- What a robust implementation would add: flush ordered after the reap only; `exit` tracking for retained win32 pids;
  a per-run abort controller covering cancel and timeout with a gated bridge; a shutdown flag refusing new checks.

Unreviewed: spec files were read only via the diff stat, not line by line (`*.spec.ts` in scope). No production file in
scope was left unread.
