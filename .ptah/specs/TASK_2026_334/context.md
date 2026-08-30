# Context — TASK_2026_334

## Where this came from

The cross-vendor review of TASK_2026_323 on 2026-08-28, lane A (`claude cli`,
opus tier), covering Phase 1 and Phase 2. Full review:
`.ptah/specs/TASK_2026_323/cross-vendor-review.md`.

Phase 2 succeeded at its stated goal. These are the residuals.

## Defect 1 — MODERATE. The Electron quit loses the last CLI-agent references

`apps/ptah-electron/src/activation/shutdown.ts:162` starts the session-metadata
flush. `disposeBootRefs` reaps the agents at `:134`. The flush runs first.

Sequence:

1. User quits Electron with a ptah-cli agent running.
2. `disposeAll()` ends the agent.
3. `agent-events.ts:424-445` stages the agent's reference — bulk output first,
   then the reference — inside a `retryWithBackoff` whose **first delay is
   1000 ms**.
4. The process exits before that delay elapses.
5. On relaunch the session shows no CLI agent, and continuation of that agent is
   impossible.

The VS Code host does this correctly at `apps/ptah-extension-vscode/src/main.ts:150-167`,
and commit `14f89ce99` explicitly says "reap the agents first". Electron was not
brought along.

**The spec protects the bug.** `apps/ptah-electron/src/main.metadata-flush.spec.ts:91`
asserts the flush happens BEFORE the disposals. Fixing the order will fail that
assertion, which is correct — the assertion is wrong and must be inverted, not
worked around.

## Defect 2 — MODERATE. The stream batch drain has no bound

`libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.ts:75,134-151`.

Commit `b401e65eb` coalesces stream events at 16 ms or 64 events and stopped
awaiting each send in the drain loop (`chat-stream-broadcaster.service.ts:200-208`).
Coalescing was the right fix and divides IPC sends by up to 64. Dropping the
await removed the only thing that throttled the producer.

`inFlight` now grows by one promise per 16 ms while the sink is slow, and nothing
caps it. The VS Code `broadcastMessage` (`webview-manager.ts:294-312`) awaits
`postMessage` on every registered view, so a view that does not acknowledge holds
each batch payload in `inFlight` for the length of the stream.

Ordering is NOT at risk and does not need fixing — `chat:complete` and
`chat:error` both follow an awaited `batch.flush()` (`:229-230`, `:259`), the
Electron bridge flushes its queue before a non-batchable message
(`ipc-bridge.ts:158-173`), and the CLI transport unwraps `BATCH`
(`cli-webview-manager-adapter.ts:58-69`). The problem is memory, not order.

Fix direction: cap `inFlight` and apply back-pressure to the producer when the
cap is reached, rather than reinstating a per-send await, which would undo the
coalescing win.

## Four LOW findings in the same area

Fix these alongside the two above only where they are cheap. Each is real but
none is currently reachable in normal operation.

1. `shutdown.ts:134-142` — `agentProcessManager.disposeAll()` is started with
   `void` and `cliRegistry.disposeAll()` runs on the next line, so the
   translation proxies stop before the agents exit. "Agents before proxies" holds
   only on the CLI host (`shutdown-host-runtime.ts:131-132` awaits both). An
   agent mid-request at quit hits a closed socket and logs a transport error
   before the SIGTERM lands. Same file as defect 1, so fix together.
2. `agent-process-manager.service.ts:1650-1657` — `getMaxConcurrentAgents` reads
   the setting with no clamp. The maximum of 20 exists only in the VS Code schema
   (`package.json:261`) and in `agent:setConfig` (`agent-rpc.handlers.ts:248`).
   `maxConcurrentAgents: 200` written directly into `~/.ptah/settings.json` on
   Electron is accepted by the reserve check at `:1044`.
3. `agent-process-manager-helpers.ts:216-218` — when the last 256 KB of the
   buffer holds no newline, the cut lands at `cutFrom`, an arbitrary UTF-16
   index, and can split a surrogate pair. The JSON frame parser is unaffected
   because it runs in the adapter, not on this buffer.
4. `session-metadata-store.ts:799-806` — `_deleteInternal` deletes the per-agent
   output keys before the staged session list is flushed. If the flush fails the
   session record survives while its references point at nothing.

## Not in scope

The concurrency cap of 20 (`be87679cc`) was rated UNPROVEN rather than unsafe.
It counts processes only, with no byte budget behind it: each agent holds up to
1 MB of stdout, up to 55,000 stream events capped by count and not by bytes, and
500 segments, all retained for 30 minutes after completion. Measuring it is real
work and belongs in its own task if it is worth doing. Item 2 above only adds the
missing clamp so the documented maximum is actually enforced.

## Verification

Existing specs that must be updated rather than merely passed:

- `apps/ptah-electron/src/main.metadata-flush.spec.ts:91` — invert the ordering
  assertion, then add one that a reference staged by an agent exit during
  `disposeBootRefs` actually reaches storage.

New assertions needed:

- `apps/ptah-electron/src/activation/*.spec.ts` — `cliRegistry.disposeAll()`
  runs after `agentProcessManager.disposeAll()` settles, or a documented
  statement that Electron does not guarantee it.
- `stream-batch-buffer.spec.ts` — a bound on `inFlight` with a sink that never
  resolves. The spec at `:74` uses a synchronous sink only, so it cannot observe
  this.
- `chat-stream-broadcaster.service.spec.ts` — an ordering assertion with a sink
  whose first promise resolves after the second, showing that order depends on
  the transport rather than on the buffer.
- `agent-process-manager.service.spec.ts` — `getMaxConcurrentAgents` clamps
  to 20.
- `agent-process-manager-helpers.spec.ts` — `trimBufferToLowWater` on a buffer
  whose tail 256 KB has no newline, asserting no split surrogate pair.
- `session-metadata-store.spec.ts` — `delete()` with a failing flush, asserting
  the output keys survive when the session record does.
