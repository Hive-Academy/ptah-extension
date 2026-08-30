# TASK_2026_323 — App hangs with 3 sessions + CLI agents

## User report (2026-08-26)

Ptah hangs with 3 sessions open. One of the sessions has several CLI agents
running. Opening a new workspace does not help. The whole application becomes
hard to use. No profiling exists, and there is no known reproduction trigger.

## Prior context (memory)

The Tribunal council freeze (multiple earlier sessions) was diagnosed as
backend event-loop starvation that back-pressures the `claude.exe` stdout
pipe. It was mitigated by a UI redesign. The backend cause was never fixed.
This report is the same failure shape without the Tribunal.

## Runtime facts

- Electron: the backend runs in the MAIN process, on the same event loop as
  `BrowserWindow` management. A blocked backend loop freezes the whole app.
- Embeddings already run out of process (`utilityProcess` / worker thread).
  They are NOT a blocker.
- better-sqlite3 runs 100% on the main thread. One connection,
  `busy_timeout = 5000`.
- No event-loop lag monitor, no CPU profile trigger, no server-side RPC
  timing, no server-side RPC timeout exist in any runtime. The only stall
  signal is the client-side 30 s timeout
  (`libs/frontend/core/src/lib/services/rpc-call.util.ts:207`).
- Existing hooks to build on: `PLATFORM_TOKENS.TRACER` (`ITracer`, Sentry or
  noop), CLI `debug.di.phase` verbose channel
  (`libs/backend/cli-engine/src/lib/container.ts:271-285`), Electron
  heap-delta probe (`apps/ptah-electron/src/activation/wire-runtime.ts:562`).

## Backend main-thread blockers (ranked)

| #   | Location                                                                                                                          | Mechanism                                                                                                                                                                                                                                                                                                     | Scales with                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| B1  | `libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts:956-966`                                      | Once an agent's stdout buffer passes 1 MB, every chunk (one token on the ptah-cli path) copies the whole 1 MB string. Buffer stays saturated.                                                                                                                                                                 | agents × tokens/s × 1 MB             |
| B2  | `libs/backend/memory-curator/src/lib/observation-queue.store.ts:146-173` via `memory-trigger.service.ts:362,389,441,504,542,560`  | Synchronous SQLite INSERT (fresh `prepare` each time, up to 16 KB row) on EVERY tool call, Stop, prompt submit. Not gated by any flag.                                                                                                                                                                        | sessions × tool calls                |
| B3  | `libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:175-181`                                 | `ptah_get_diagnostics` (Electron/CLI hosts) runs `ts.createProgram` + `getPreEmitDiagnostics` for up to 2000 tsconfigs, fully synchronous, no cache. The core prompt tells every agent to call it. Codex/Copilot agents call it through the HTTP MCP server, so the ELECTRON main thread does the type-check. | per agent call, tens of seconds each |
| B4  | `libs/backend/agent-sdk/src/lib/helpers/history/jsonl-reader.service.ts:137-153`                                                  | Full transcript `split` + `JSON.parse` per line (up to 50 MB) in one tick. Called per turn-complete by memory curator (then keeps only the last 32 KB), 90 s after each Stop by skill synthesis, and on every SubagentStop.                                                                                   | sessions × transcript size per turn  |
| B5  | `libs/backend/agent-sdk/src/lib/session-metadata-store.ts:175-194` via `cli-agent-runtime/src/lib/wiring/agent-events.ts:319-364` | Every agent spawn/exit rewrites ALL session metadata, with up to 50 000 stream events per agent embedded. Re-persisted for every exited agent on session-id resolve.                                                                                                                                          | agents² × events                     |
| B6  | `libs/backend/memory-curator/src/lib/memory-curator.service.ts:351` → `sdk-query-runner.service.ts:224`                           | Curator spawns an extra `query()` subprocess per session per turn threshold. Rate-limited (20/h) but NO concurrency limit across sessions.                                                                                                                                                                    | sessions                             |
| B7  | `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts:107-152`                                     | One awaited `broadcastMessage` + one `logger.debug` with `JSON.stringify` per stream event, fanned to every webview. No batching.                                                                                                                                                                             | sessions × events/s × webviews       |
| B8  | `libs/backend/harness-sync/src/lib/hash/content-hash.ts:76-113`                                                                   | Harness preflight: recursive sync dir walk + sha256 of every file, per session start and per agent spawn. Loser of the 1500 ms race is NOT cancelled.                                                                                                                                                         | per session/agent start              |
| B9  | `agent-process-manager.service.ts:543,1152,1179`                                                                                  | Four ref'd timers per agent (one is 1 hour), zero `unref` calls. Same defect class as commit 5dc525f02.                                                                                                                                                                                                       | agents                               |
| B10 | `agent-process-manager.service.ts:929-942`                                                                                        | Global spawn mutex serializes spawns across ALL sessions, including harness preflight and SDK launch. Cap is 5 global (docs say 3).                                                                                                                                                                           | sessions                             |

Correctness bug found on the way (not the hang): `ptah-cli-registry.ts:349-359`
keys the translation proxy by agent id. A third session on the same ptah-cli
agent stops the proxy of sessions 1 and 2.

## Renderer hot path (ranked)

| #   | Location                                                                                                                                         | Mechanism                                                                                                                                 | Growth per turn            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| R1  | `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:170-206` + `chat-execution-tree/src/lib/builders/tool-node.fn.ts:41,166` | Tree rebuilt from scratch on every chunk (memo keyed on `events.size`, always misses). Each tool node spreads the whole events Map.       | O(chunks × events²)        |
| R2  | `chat-execution-tree/src/lib/builders/message-node.fn.ts:24-32`                                                                                  | `slice().sort()` of every delta of every message per rebuild.                                                                             | O(chunks × msgs × E log E) |
| R3  | `execution-tree-builder.service.ts:342-375`                                                                                                      | Reuse fingerprint `JSON.stringify`s every tool input/output and concatenates child fingerprints per node per rebuild.                     | O(chunks × bytes × depth)  |
| R4  | `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:314-330`                                                  | marked + DOMPurify over the full assistant message on every delta. Cache key includes length so it never hits. No debounce.               | O(L²)                      |
| R5  | `libs/frontend/chat-state/src/lib/tab-manager.service.ts:1852-1875`                                                                              | `JSON.stringify` of ALL tabs' transcripts + trees into `localStorage` in every ≥500 ms gap. The one place where 3 tabs is multiplicative. | O(tabs × bytes)            |
| R6  | `libs/frontend/chat/src/lib/stores/agent-monitor.store.ts:751-762`                                                                               | `streamEvents` / `segments` uncapped, full array copy per delta.                                                                          | unbounded                  |
| R7  | `execution-node.component.ts:153,201`                                                                                                            | `[auto-animate]` MutationObserver + forced reflow per DOM change, never disabled during streaming.                                        | O(chunks × tool nodes)     |

Hidden-tab gating exists and works (`batched-update.service.ts:97-117`),
except `flushSync()` on every `agent_start` bypasses it, and canvas grid mode
marks all tiles visible.

## Implementation status (2026-08-26)

All three phases implemented in the working tree, uncommitted. Per-lib suites
green at hand-off; workspace gate recorded below.

| Item    | Where                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Result |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Phase 1 | `vscode-core/src/diagnostics/` (`EventLoopMonitor`, `CpuProfileCapture`, `armDiagnostics`), `rpc-handler.ts` slow-RPC warn (2 s), `protocol-dispatcher.ts` slow-tool warn, Electron `diag:cpu-profile` IPC + `window.ptahDiag`, VS Code `ptah.captureCpuProfile`, CLI `debug.perf.lag` under `--verbose`                                                                                                                                                                    | done   |
| B1      | `appendBuffer` hysteresis trim to 75 %, regex-free newline count, 5 agent timers `unref`'d, `capStreamEvents` slack; `codex-cli.adapter.ts` watchdog cleared                                                                                                                                                                                                                                                                                                                | done   |
| B2      | `ObservationQueueStore` batched (250 ms / 64 rows, one transaction), statement cache, byte-bounded drain, `memory.enabled` switch, cue cache by content                                                                                                                                                                                                                                                                                                                     | done   |
| B3      | `ptah_get_diagnostics` on a `worker_threads` Worker (inline source), single-flight per root, 30 s LRU cache                                                                                                                                                                                                                                                                                                                                                                 | done   |
| B4      | streaming JSONL reader with yields + `readJsonlTail`; memory curator reads a 512 KB tail; trajectory extractor single pass                                                                                                                                                                                                                                                                                                                                                  | done   |
| B5      | `streamEvents` out of the session blob → per-agent key written once on exit; `getCliSessionsForRestore`; write coalescing; both restore paths switched                                                                                                                                                                                                                                                                                                                      | done   |
| B6      | `InternalQueryConcurrencyGate`, default 1 (`ptah.internalQuery.maxConcurrent`)                                                                                                                                                                                                                                                                                                                                                                                              | done   |
| B7      | `StreamBatchBuffer` (16 ms / 64), no await in the drain loop, CLI transport unwraps `BATCH`, shared `BatchedMessage` type                                                                                                                                                                                                                                                                                                                                                   | done   |
| B8      | async cancellable hash walk, per-target abort signal with commit point before the first manifest write                                                                                                                                                                                                                                                                                                                                                                      | done   |
| B9      | all agent timers `unref`'d                                                                                                                                                                                                                                                                                                                                                                                                                                                  | done   |
| B10     | spawn lock covers check-and-reserve only; proxy is a ref-counted lease per session (`getProfile(id, leaseKey)` / `releaseProfile`)                                                                                                                                                                                                                                                                                                                                          | done   |
| R1-R3   | `buildStreamingIndexes`, per-root digests, incremental rebuild, fingerprint pass deleted, `messageEventIds` cascade-cleaned                                                                                                                                                                                                                                                                                                                                                 | done   |
| R4/R7   | one markdown render per animation frame while streaming, FLIP disabled while streaming                                                                                                                                                                                                                                                                                                                                                                                      | done   |
| R5/R6   | per-field change check + 5 s max wait on tab persistence, `streamEvents` cap 2 000 / `segments` 500, no re-sort per delta, `flushSync(originTabId)`                                                                                                                                                                                                                                                                                                                         | done   |
| Prompt  | core prompt no longer tells agents to call `ptah_get_diagnostics` first; system namespace names the real cap setting                                                                                                                                                                                                                                                                                                                                                        | done   |
| B11     | Idle subprocess release: `SDK_IDLE_RELEASE_MS` (5 min, `ptah.agentOrchestration.sdkIdleReleaseMs`), `releaseSubprocess` armed in `handleExit` for continuation-capable handles, `agent:released` → `AGENT_MONITOR_EXPIRED`, `continueConversation` code `released` (frontend falls back to session resume), TTL cleanup releases before delete, `stop()` reclaims a completed agent without relabelling status, `shutdownAll()` → `disposeAll()` wired into all three hosts | done   |

Known follow-ups (not blockers): `peekForSession` still `SELECT *`;
`event-deduplication.service.ts` linear scans + `eventsByMessage` tombstone;
`ipc-bridge.ts` / `message-router.service.ts` can import `BatchedMessage`;
`agent-customization.service.ts` chunks now serialize under the gate; CLI
lag monitor only under `--verbose`; `ObservationQueueStore.dispose()` is not
wired into host shutdown (`stop()` flushes).

## Plan

### Phase 1 — instrumentation (prove it, then keep it)

1. New `EventLoopMonitor` in `libs/backend/vscode-core/src/diagnostics/`
   using `perf_hooks.monitorEventLoopDelay`. Registered in
   `register-platform-agnostic.ts` next to `TRACER`. Logs `warn` with
   `{ lagMs, p99Ms }` when lag passes a threshold (start at 250 ms). Armed
   before heavy boot in Electron `wire-runtime.ts`, VS Code `bootstrap.ts`,
   CLI `container.ts`. Disposed on quit.
2. Slow-RPC timing in `rpc-handler.ts:183-188`: bracket the handler, `warn`
   above 2 s with method + duration. Below the 30 s client budget.
3. MCP tool timing in `protocol-dispatcher.ts:156` (same shape) so
   `ptah_get_diagnostics` and friends show their real cost.
4. On-demand CPU profile: `inspector.Session` `Profiler.start/stop`, written
   to the logs dir. Trigger: env `PTAH_PROFILE_ON_LAG_MS` (auto-capture when
   lag passes N) plus a direct Electron IPC channel (not RPC, because RPC is
   what is wedged). VS Code: a `ptah.captureProfile` command.
5. Reproduction script under `apps/ptah-electron-e2e` or a doc recipe: 3
   sessions, one spawns 3 ptah-cli agents on a chatty task, one agent calls
   `ptah_get_diagnostics`. Watch the lag log.

### Phase 2 — backend fixes (in order of expected payoff)

1. B1: ring/chunk-array buffer, or trim by a large slice (e.g. drop to 75%)
   so the copy is amortized.
2. B3: run the type-check off the main thread (worker_threads / utilityProcess)
   or scope it to the tsconfigs that own recently-changed files; add a
   short-lived cache. Remove it from the "call this first" prompt text until
   it is cheap.
3. B2: cache the prepared statement, batch observation inserts on a timer
   (one transaction per N ms), and skip the queue while `memory.enabled` is
   false.
4. B4: stream-parse the JSONL (readline) with periodic yields, and read only
   the tail when the caller only needs the tail.
5. B5: stop embedding stream events in session metadata, or persist per
   agent under its own key.
6. B6: one global semaphore for internal `query()` calls.
7. B7: coalesce chat chunks per 16 ms (the Electron IPC bridge already does
   this at `ipc-bridge.ts:220`; do it once, backend side) and drop the
   per-event debug log unless debug level is on.
8. B9: `unref()` all agent timers.
9. B8: cancel the losing preflight pass or move the hash walk to async fs.

### Phase 3 — renderer fixes

1. R1/R2: incremental tree updates — index events by tool call id once, do
   not spread the Map per node, keep the sort stable by append order.
2. R4: throttle markdown re-render to one per animation frame, and cache by
   content hash instead of length.
3. R5: persist tab state without `streamingState` trees, and debounce with a
   max-wait.
4. R6: cap `streamEvents` / `segments` like the backend does.
5. R7: bind `[autoAnimateDisabled]` while a node is streaming.
