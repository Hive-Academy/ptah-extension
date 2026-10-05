# Code Logic Review — `TASK_2026_614` Stage D + E, half B

Scope: `git diff origin/main...HEAD -- libs/backend/cli-agent-runtime libs/backend/vscode-lm-tools libs/backend/rpc-handlers libs/frontend apps` (46 files; I read all the production files, plus specs where I needed to check a claimed regression test). Context: `batches.md` (User Decisions, Batches 10, 11, 13, 14, D.12 table), `batch-10-report.md`, `batch-11-14-report.md`.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 5        |
| Failure modes found | 7        |

Why 7 and not 8: the cancel and dispose plumbing is correct on the paths that matter. Each run's kill is keyed to its own pid and signal, listeners and timers are removed on every exit, and the stop is idempotent. Below that, the kill-failure path still reports "killed" and drops the pid from the registry. The VS Code deactivate kill is awaited serially ahead of the agent reap. Electron's kill is fire-and-forget. And no spec pins the one line that makes stdio cancel work at all.

Why 7 and not 6: I found no data loss, no cross-run kill, no leaked listener, and no ungated live continuation. The user decisions are honoured as written.

## Five logic questions

### 1. How does this fail silently?

- **The tree kill fails, but the reply says it succeeded.** `run-check.tool.ts:489-495` chains `killTree(pid).then(stopWaiting, stopWaiting)`, and the default `killProcessTree` swallows errors (no `onError` is passed, `process-tree-reaper.ts:69-71`). The reply then reads `CANCELLED; the process tree was killed` (`:325`) or `TIMED OUT …; the process tree was killed` (`:321`) whatever happened. After `KILL_SETTLE_MS` (10 s), `settle` deletes the pid from `liveChecks` (`:468`). A tree that survived a failed `taskkill` is then invisible to `killRunningChecks` on dispose and outlives the host.
- **Electron never awaits the kill.** `shutdown.ts:194-198` calls `void killRunningChecks()`. On the synchronous quit path (`shutdown.ts:506-511`), Electron stops waiting once the listener returns. On win32, `killProcessTree` reaches `execFile('taskkill')` only after `await import('node:child_process')` (`process-tree-reaper.ts:61`), so it has no ordering guarantee before exit. On POSIX the SIGTERM is synchronous, but the SIGKILL escalation 5 s later never runs.

### 2. What user action produces unexpected behaviour?

- **The UI "Resume" on a Ptah CLI session now usually starts a fresh lane, and the user is not told.** `agent-rpc.handlers.ts:1133-1137` runs `prepareSdkHandleSpawn` on the frontend-initiated resume. A session resumed from the UI has nearly always been idle for more than 10 min, so the gate chooses `fresh`. The lane gets the handoff task with no resume id. The RPC replies `{ success: true, agentId }` (`:1074`), and the success log (`:1068`) omits `resumeDecision`. This matches the sibling CLI path, which already went through `spawn`, so the behaviour is consistent; but the decision is dropped at the RPC boundary.
- **A peer cancel on `session_submit` now aborts the chat tab.** Before this change the cancel could never match, because `mcp-serve.ts` gave every call a `randomId()`; now it matches. This is intended (`session-submit.service.ts:30`, step 7), but it is a newly live path with no end-to-end spec (see Moderate M4).

### 3. What input data produces a wrong answer?

- A peer that reuses a JSON-RPC id while an earlier call with that id is still in flight overwrites the entry in `inFlightCalls` (`stdio-mcp-server.service.ts:224`). A cancel then reaches only the newer call. The `finally` identity check (`:233`) keeps the map consistent. This breaks JSON-RPC, so it is Minor.
- A hand-edited stored steer/stop pair that is individually valid but inverted makes `laneGuardWriteOrder` (`agent-rpc.handlers.ts:222-233`) reason from an invalid baseline. Readers fall back to the defaults (`agent-spawn-environment.service.ts:219-237`), so the result is harmless.

### 4. What happens when a dependency fails?

- `taskkill` or `process.kill` fails: see question 1. The failure is silent and the pid leaves the registry.
- `taskkill` is slow, or Nx ignores SIGTERM on POSIX: VS Code `deactivate` blocks for up to `PROCESS_TREE_KILL_GRACE_MS` (5 s) per run before the agent reap and `flushSessionMetadataStores` start (`main.ts:163-170`, then `:172-200`).
- The stdio transport closes before the replies to aborted calls are written: `JsonRpcServer.send` returns when there is no writer (`server.ts:259-265`). Handled.
- The CLI drain timeout fires before `killRunningChecks` resolves: `taskkill` has already been spawned as a separate process and keeps running. Acceptable.

### 5. What is missing that the requirements never mentioned?

- No spec asserts that `tools/call` in `mcp-serve` passes the peer's id (`mcp-serve.ts:362-368`), or that the drain calls `stdioServer.dispose()` (`:461-463`). The only spec change is a `dispose` mock (`mcp-serve.spec.ts:197`). Reverting to `randomId()` would turn stdio cancel back into a no-op, for both the wrapper tools and `session_submit`, and every spec would still pass.
- After a stdio cancel, the server still sends a response for the cancelled request. MCP says a receiver SHOULD NOT; the impact is cosmetic.
- Kill failures are not observable: nothing is logged and the structured result does not change.

## Failure modes

### FM1 — The tree survives a failed kill, the reply says it was killed, and the registry forgets it

- Trigger: `taskkill /T /F` fails (access denied, or the tree root has already exited while grandchildren still hold the pipes), or EPERM on POSIX.
- Symptom: the caller reads "the process tree was killed". The Nx tree keeps running, and host dispose no longer knows its pid.
- Evidence: `run-check.tool.ts:489-495`, `:468`, `:321`, `:325`; `process-tree-reaper.ts:69-71`, `:81-85`.
- Current handling: the failure is swallowed; the run settles after 10 s and the pid is deleted.
- Recommendation: pass an `onError` to `killProcessTree` and record `killFailed`. Say "kill failed (pid N may still be running)" in the reply. Keep the pid in `liveChecks` until `close`, or put it on a "suspected alive" list that `killRunningChecks` retries.

### FM2 — VS Code deactivate spends its budget on the check kill before the agent reap

- Trigger: a `run_check` is live at deactivate, and Nx is slow on SIGTERM (POSIX) or `taskkill` on a large tree is slow (Windows).
- Symptom: `agentProcessManager.disposeAll()` and `flushSessionMetadataStores()` start up to about 5 s later. If the extension host is torn down first, CLI agents stay resident and session references are not flushed. I have not verified the size of VS Code's deactivate budget; this is a risk, not an observed failure.
- Evidence: `apps/ptah-extension-vscode/src/main.ts:160-170`, followed by `:172-200`.
- Current handling: the kill and the reap run serially.
- Recommendation: start `killRunningChecks()` without awaiting it, run the agent reap, then `await` the kill promise, or `Promise.all` the two.

### FM3 — Electron quit does not wait for the kill

- Trigger: the user quits Electron during a `run_check`, on the synchronous quit path.
- Symptom: on Windows `taskkill` may never spawn; on POSIX there is no SIGKILL escalation.
- Evidence: `apps/ptah-electron/src/activation/shutdown.ts:194-198`; `shutdown.ts:506-511`; `process-tree-reaper.ts:61`.
- Current handling: fire-and-forget. The comment says each stop "starts its tree kill at once", which is not true on win32 because of the dynamic `import`.
- Recommendation: make `requiresDeferredDisposal` return true when `runningCheckPids().length > 0`, and await `killRunningChecks()` inside the bounded deferred chain (`withBudget`).

### FM4 — The stdio cancel linkage has no test

- Trigger: a future refactor of `mcp-serve.ts` `tools/call` back to `randomId()`, or removal of the `dispose()` call from the drain.
- Symptom: `notifications/cancelled` silently matches nothing again, for both the wrapper tools and `session_submit`, and `ptah mcp-serve` leaves Nx trees running at stdin EOF.
- Evidence: `mcp-serve.ts:362-368`, `:461-463`; `mcp-serve.spec.ts:197` (mock only). The unit tests in `stdio-mcp-server.service.spec.ts` (lines 1191, 1217, 1231) drive the service directly, below this seam.
- Recommendation: add an `mcp-serve` spec that sends `tools/call` with id 42 and asserts `handleToolsCall` receives `id: 42`; add a second that ends stdin and asserts `dispose` was called before `transport.stop`.

### FM5 — The resume decision is dropped at the RPC boundary

- Trigger: a frontend `agent:resumeCliSession` for `ptah-cli` (or any CLI) where the gate returns `fresh`.
- Symptom: the user asked for a resume and got a fresh lane with a handoff brief. Nothing in the RPC reply or the log says so.
- Evidence: `agent-rpc.handlers.ts:1133-1137`, `:1068-1074`.
- Recommendation: include `resumeDecision` in the RPC result (the UI can show "started fresh: <reason>") and in the success log.

### FM6 — A cancelled stdio request still gets a response

- Evidence: `stdio-mcp-server.service.ts:296-301` aborts the call, the call completes, and `server.ts:205-206` encodes a response.
- Impact: well-behaved clients ignore it. Minor.

### FM7 — Kept rotation keys for closed sessions linger

- Evidence: `session-rotation-keep.service.ts:33-38`. `forgetSession` runs only from a mounted banner's effect for the displayed session (`session-budget-banner.component.ts:203-207`).
- Impact: the set grows by about one short string per kept session for the life of the webview. Minor.

## Blocking issues

None.

## Serious issues

None. FM1 and FM2 were considered for Serious. I held them at Moderate because each needs an uncommon dependency failure (a kill failure, or slow SIGTERM handling), and because FM1's timeout branch existed before this change; the change extends it to cancel and dispose.

## Moderate and minor issues

- **M1 (FM1)**: a failed kill is reported as killed and the pid leaves `liveChecks`. `run-check.tool.ts:468, 489-495, 321, 325`.
- **M2 (FM2)**: VS Code deactivate awaits the check kill serially ahead of the agent reap. `main.ts:160-170`.
- **M3 (FM3)**: the Electron kill is fire-and-forget and not ordered before exit. `shutdown.ts:194-198`.
- **M4 (FM4)**: no spec pins the peer-id pass-through or the drain-time `dispose()`. `mcp-serve.ts:362-368, 461-463`.
- **M5 (FM5)**: `resumeDecision` is not surfaced by `agent:resumeCliSession`. `agent-rpc.handlers.ts:1068-1074`.
- **Minor**: a response is sent to a cancelled stdio request (`stdio-mcp-server.service.ts:296-301`).
- **Minor**: a duplicate in-flight JSON-RPC id overwrites the controller (`stdio-mcp-server.service.ts:224`).
- **Minor**: `agent:setConfig` validation (`agent-rpc.handlers.ts:192-212`) and the ordered writes (`:541-549`) read stored values and then await between writes, so two concurrent setConfig calls could interleave into a stop ≤ steer pair. Readers fall back to the defaults, so this is low impact.
- **Minor**: kept-session keys are never pruned for closed sessions (`session-rotation-keep.service.ts:33-38`).

## Focus items checked with no defect found

- **A kill does not hit an unrelated run.** The HTTP signal is per response (`http-server.handler.ts:327-333, 411`). The stdio controller is per JSON-RPC id (`stdio-mcp-server.service.ts:221-236`). `liveChecks` is keyed by the run's own pid and the entry is deleted on settle (`run-check.tool.ts:468, 529`). The spec "kills only the tree of the cancelled run" exists. `killRunningChecks` is host-wide by design and is called only on host dispose.
- **The body cannot forge `_abortSignal`.** It is destructured out of the parsed body (`http-server.handler.ts:403`), set only from `res` (`:411`), and pinned by the spec "never takes the signal from the request body".
- **The HTTP early-close test is correct.** `writableFinished` makes the normal post-reply `close` a no-op. `res.destroyed` skips the write (`:414`).
- **The abort race in run_check is handled.** An already-aborted signal is checked before spawn (`run-check.tool.ts:415`) and again after the listener is attached (`:532`). The stop is idempotent and a timeout reason is never overwritten by a later cancel (`:478-497`).
- **`waitForAgents` cleans up.** Exit listener, abort listener and timer are all removed in `finish` (`agent-process-manager.service.ts:1299-1304`). An already-aborted signal returns without a listener (`:1291-1292`).
- **Stdio message dispatch is concurrent** (`server.ts:115`, `void this.dispatch`), so a `notifications/cancelled` can reach a long-running call.
- **The lane guard counts each call once.** Codex emits `tool-call` (`Bash`, id) on `item.started` (`codex-cli.adapter.ts:894-905`) and `command` with the same id on completion (`:1026-1032`). Copilot pairs the same way by `toolCallId` (`copilot-sdk.adapter.ts:629-635`). OpenCode `bash` is `command`-only (`opencode-cli.adapter.ts:842-848`) and now counts once. The id set is FIFO-bounded at 512 (`lane-budget-guard.ts:136-142`) and cleared on `reset`. A start→completion gap of more than 512 calls is not a realistic case.
- **Codex resumes without a rollout file** now report `tokens: null` on both the missing and the unreadable branch (`lane-resume-gate.ts:120-136`); the `turn.completed` sum is never used.
- **`prepareSdkHandleSpawn` runs on both paths before the handle exists.** In the namespace builder it runs before `registry.spawnAgent` and passes `model` (`agent-namespace.builder.ts:268-273`). In the RPC path (`agent-rpc.handlers.ts:1133-1137`) no model parameter exists, so the default-model case stays unchecked; that is the known, recorded item. `continueConversation` is ungated and documented (`agent-process-manager.service.ts:1662-1674`), per Decision 4.
- **The steer/stop write order is correct.** The proof holds for both orderings when the stored and requested pairs are valid (`agent-rpc.handlers.ts:213-233`).
- **"advice: fresh" appears only when advised.** `hasFreshAdvice` checks `advice?.advice === 'fresh'` (`chat-subagent-context-injector.service.ts:191, 219`).
- **The root "Keep this session" store** keys entries by `sessionId:threshold` and forgets them by the `sessionId:` prefix. Session ids contain no `:`, so one session cannot leak into another (`session-rotation-keep.service.ts:17-38`).
- **The `wait-tools-args.schema.ts` import of `MAX_AGENT_WAIT_MS` is fine.** Every importer of the schema (`agent-wait.tool.ts:23`, `protocol-dispatcher.ts:41`, `agent-tool.dispatcher.ts:77`, `run-check.tool.ts`) already imports `@ptah-extension/cli-agent-runtime` at runtime. The sibling `session-tool-args.schema.ts:15` set the same precedent (`SESSION_READ_MAX_TAIL_KIB`). No new module is loaded in production. The only extra cost is for a consumer that loads the schema alone, such as its spec, which now needs the barrel (and `reflect-metadata` if a decorated class is evaluated); the updated spec passes per the batch report. Not a real risk.

## Data flow

1. HTTP `POST` reaches `handleHttpRequest`. `_abortSignal` is stripped from the body and set from `abortOnEarlyClose(res)` (`http-server.handler.ts:403-411`). OK.
2. `handleMCPRequest` puts `signal` into AsyncLocalStorage (`protocol-dispatcher.ts:309`). `handleIndividualTool` reads `getRequestAbortSignal()` for `agent_wait` and `run_check` (`:1348, :1376`). OK.
3. `runCheck` → `execute`: pre-spawn abort check, spawn, register the pid, attach the listener, re-check (`run-check.tool.ts:415-532`). OK.
4. Abort, timeout or dispose → `stop` → `killTree` → settle-backstop timer. **Gap**: kill failure (FM1).
5. Settle: listener removed, pid deleted, verdict computed. OK.
6. HTTP reply is skipped when `res.destroyed` (`http-server.handler.ts:414`). OK.
7. Stdio: the peer id flows through `server.ts:205` → `mcp-serve.ts:362-368` → `handleToolsCall` keyed controller (`stdio-mcp-server.service.ts:221-236`). **Gap**: the link is untested (FM4).
8. Stdio `notifications/cancelled` aborts the wrapper call first, else falls through to the session-submit cancel (`:296-313`). OK.
9. Host dispose: VS Code awaits serially (FM2). Electron is fire-and-forget (FM3). The CLI drain awaits `dispose()` within its drain timeout. The HTTP server's `disposeAsync` awaits. OK apart from FM2 and FM3.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| 10.1 abort on HTTP close, stdio cancel, stdio end | COMPLETE | Peer-id link untested (M4) |
| 10.2 `killRunningChecks` on dispose (VS Code, Electron, HTTP, stdio) | PARTIAL | Electron not awaited (M3); VS Code serial (M2) |
| Tree kill on cancel (Windows `/T`, POSIX group) | PARTIAL | Kill failure reported as success (M1) |
| E.3 `waitForAgents` abort with listener and timer cleanup | COMPLETE | — |
| Lane guard `command` counted once, bounded ids | COMPLETE | — |
| E.1 Codex rollout-less resume → tokens unknown | COMPLETE | — |
| E.4 / B-m2 gate and blocked-model check before the handle, both paths; continuation ungated | COMPLETE | RPC default model unchecked (known); decision not surfaced (M5) |
| 6.3 steer/stop write order | COMPLETE | Concurrent-call interleave (Minor) |
| 6.2 "advice: fresh" only when advised | COMPLETE | — |
| D.5 root-scoped Keep store, per session | COMPLETE | Closed-session keys linger (Minor) |

Implicit requirements not addressed: the outcome of a kill is never reported; there is no `mcp-serve`-level regression test for cancel.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Abort before spawn | YES | `before_start` verdict, nothing spawned | — |
| Abort during the async spawn | YES | Re-check after the listener is attached | Pid registered a microtask late; a dispose in that window misses it (negligible) |
| Cancel after the timeout fired | YES | Joins the in-flight `stopping`; reason stays `timeout` | — |
| Kill fails | NO | Swallowed | FM1 |
| HTTP normal reply then `close` | YES | `writableFinished` guard | — |
| Body-supplied `_abortSignal` | YES | Destructured away | — |
| Duplicate JSON-RPC id in flight | PARTIAL | Last writer wins; identity check in `finally` | Minor |
| Stdin EOF with a live check | YES | `dispose()` in the drain | Untested at `mcp-serve` level |
| Wait signal aborted on entry | YES | Returns `cancelled` without listening | — |
| Codex rollout unreadable | YES | `tokens: null` and a note | — |
| More than 512 call ids | YES | FIFO eviction | — |
| Stored lane-guard pair inverted by hand | YES | Readers use the defaults | — |

## Verdict

- Recommendation: APPROVE. Follow-ups M1-M5 are not merge-blocking.
- Confidence: MEDIUM-HIGH. I read all production files in scope. I did not verify VS Code's deactivate time budget (FM2), and the Electron timing (FM3) depends on how the bundler lowers the dynamic `import`.
- Top risk: a failed tree kill is reported as "the process tree was killed" and the pid is forgotten, so an Nx tree can outlive the host with no signal anywhere.
- What a robust implementation would add:
  - `onError` on `killProcessTree`, with a "kill failed" verdict and the pid kept in `liveChecks` until `close`.
  - In VS Code `deactivate`, the check kill run in parallel with the agent reap.
  - In Electron, the deferred-disposal path taken when checks are live, and the kill awaited within budget.
  - `mcp-serve` specs for the peer-id pass-through and the drain-time `dispose()`.
  - `resumeDecision` surfaced on `agent:resumeCliSession`.
