# Cross-vendor review — TASK_2026_323

Date: 2026-08-28
Orchestrated from the Ptah session as Round 2, three independent lanes.

| Lane | Reviewer                       | Scope                                              |
| ---- | ------------------------------ | -------------------------------------------------- |
| A    | `claude cli` (opus tier)       | Phase 1 instrumentation, Phase 2 backend blockers  |
| B    | `ollama cloud` (opus tier)     | Phase 3 renderer, broad                            |
| C    | internal `code-logic-reviewer` | Phase 3, deep dive on four high-risk questions     |
| D    | `ollama cloud`                 | test and typecheck run — see `verification-run.md` |

Lanes B and C covered the same phase deliberately. They disagreed on the most
serious claim, which is why that claim was verified by hand. See "Disagreement"
below.

Codex was the intended reviewer for lanes A and B. It exhausted its ChatGPT
quota mid-run and was replaced. Its two saved sessions
(`01a045ac-0a28-7621-aa85-ef62875ffee9`, `01a045ac-6771-7062-a1a4-06021cc513e3`)
are intact if a fourth opinion is ever wanted.

Prior partial review: `code-logic-review.md` covers AREA 3 and AREA 4 only. Its
own scope note says AREA 1 and AREA 2 were never reviewed. This file closes that
gap. Nothing here re-reviews AREA 3 or AREA 4.

## Verdict

| Phase                       | Verdict                                       |
| --------------------------- | --------------------------------------------- |
| Phase 1 — instrumentation   | **PASS**                                      |
| Phase 2 — backend blockers  | **PARTIAL**                                   |
| Phase 3 — renderer hot path | **PARTIAL**, one confirmed SERIOUS regression |

The task achieved its goal. The blockers named in `context.md` are removed or
amortized, and the instrumentation exists in all three hosts. The task also
introduced one serious correctness regression and left several defects that the
phases did not set out to fix. All residuals move to TASK_2026_333,
TASK_2026_334 and TASK_2026_335.

---

## Disagreement, and how it was settled

Lane C reported `DIVERGENCE FOUND` on incremental-versus-full tree equivalence.
Lane B reported `UNPROVEN` and said no divergence was found in production paths.

Verified by hand against the source. **Lane C is correct.**

1. `libs/frontend/chat-streaming/src/lib/execution-tree-builder.service.ts:518-521`
   — `computeGlobalEpoch` folds `this.backgroundAgentStore.backgroundToolCallIds().size`.
   The **size**, never the membership.
2. `libs/frontend/chat-streaming/src/lib/accumulator-core.service.ts:568-576`
   — `background_agent_started`, `background_agent_completed` and
   `background_agent_stopped` call the store and return `mutated()`. They call
   neither `setStreamingEventCapped` nor `indexEventByMessage`, so they bump no
   `messageRevisions` entry and change no `eventsByMessage` bucket length. Those
   two values are the only inputs to `computeRootDigests` (`:535-551`).
3. `libs/frontend/chat-execution-tree/src/lib/builders/agent-node.fn.ts:114` and
   `libs/frontend/chat-execution-tree/src/lib/builders/tool-node.fn.ts:397`
   — `isBackground` is read **live** at build time through
   `deps.backgroundAgentStore.isBackgroundAgent(toolCallId)`. Membership, again,
   not size.

The three facts compose into a real defect. `BatchedUpdateService` coalesces
event mutations into one flush per frame, so two background events in one frame
are one build cycle. If agent A enters the set while agent B leaves it, the size
is unchanged, the epoch is unchanged, no root digest moves, `reusableRootNode`
(`:459-469`) returns both cached nodes verbatim, and both cards render the
opposite of their real background state until an unrelated delta happens to
touch that specific root.

The library's own `CLAUDE.md` states the intent: "Accumulator map sizes are
folded in too so this subsumes every field the pre-TASK_2026_323 memo
fingerprint checked." Folding a size is sufficient for a map that only grows. It
is not sufficient for a set whose membership can change while its size does not.

Moved to **TASK_2026_333**.

### Both lanes agreed on the underlying gap

No test builds a tree incrementally and asserts equality against a full rebuild
of the same event sequence. `execution-tree-builder.service.spec.ts` compares
before and after snapshots from the **same** cache key, so it has no independent
oracle. The old full-rebuild path was deleted, so no oracle remains in the
codebase. That absence is why the defect above shipped.

---

## Phase 1 — instrumentation. PASS

The measurement lives at `libs/backend/vscode-core/src/diagnostics/event-loop-monitor.ts:144-155`
— `monitorEventLoopDelay({ resolution: 20 })` with a 2 s `setInterval` sampler.
One sample reads `histogram.max`, `percentile(99)` and `mean`, then resets
(`:193-198`). The sampler is `unref()`d at `:154` and a spec pins that at
`event-loop-monitor.spec.ts:83`, so the monitor cannot hold the process alive.

Wired in all three hosts:

| Host     | Arm                                                                          | Dispose                            |
| -------- | ---------------------------------------------------------------------------- | ---------------------------------- |
| Electron | `apps/ptah-electron/src/activation/wire-runtime.ts:157`                      | `activation/shutdown.ts:143`       |
| VS Code  | `apps/ptah-extension-vscode/src/activation/bootstrap.ts:143-146`             | `src/main.ts:180`                  |
| CLI      | `libs/backend/cli-engine/src/lib/container.ts:392-403`, **`--verbose` only** | `apps/ptah-cli/src/main.ts:95,108` |

RPC timing is separate from lag measurement, as the task required:
`libs/backend/vscode-core/src/messaging/rpc-handler.ts:213-252` brackets every
handler with `performance.now()` in a `finally` and warns at
`DEFAULT_RPC_SLOW_WARN_MS = 2000`. MCP tool timing has the same shape at
`protocol-dispatcher.ts:399-461`.

Thresholds are environment variables only — `PTAH_LOOP_LAG_WARN_MS` (default
250 ms), `PTAH_RPC_SLOW_WARN_MS`, `PTAH_MCP_SLOW_WARN_MS`,
`PTAH_PROFILE_ON_LAG_MS`. No settings key exists for any of them.

### Findings

- **MODERATE** `cpu-profile-capture.ts:166` — the capture serializes the whole
  profile with a synchronous `JSON.stringify` on the main thread. With
  `PTAH_PROFILE_ON_LAG_MS` armed, a 10 s auto-capture produces tens of MB and
  blocks the main loop during the stall it exists to observe. The next lag sample
  then records the diagnostic's own block.
- **LOW** `rpc-handler.ts:213-251` — the bracket measures wall-clock time of an
  awaited handler, not event-loop occupancy. A handler that awaits a subprocess
  for 3 s and blocks nothing warns. A handler with a 400 ms synchronous block
  returns in 500 ms and does not. The log cannot attribute a lag sample to a
  method, which limits its diagnostic value.
- **LOW** `cli-engine/src/lib/container.ts:392` — the CLI arms the monitor only
  under `--verbose`. A long-lived Thoth or gateway process started without it
  produces no lag line, which is the exact condition this task was opened to
  remove.

---

## Phase 2 — backend blockers. PARTIAL

What the six commits achieved, verified against current source:

| Commit      | Effect                                                                                          | Removed or amortized                                                                                                                |
| ----------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `65a734193` | Session blob no longer carries stream events; bulk output moves to `ptah.agentOutput:<agentId>` | Removed the blob growth. One `storage.update` of up to 2000 events per agent exit remains.                                          |
| `b401e65eb` | Batch buffer coalesces at 16 ms / 64 events                                                     | Divides IPC sends by up to 64. Order is preserved — `chat:complete` and `chat:error` both follow an awaited `flush()`.              |
| `55b419f13` | Hash walk yields per directory, aborts between whole files                                      | The losing pass is cancelled. No partial manifest is possible: the commit point detaches the signal before the first write.         |
| `e049d59f8` | Trim to 75 % at a line boundary, regex-free newline count                                       | The copy still happens, four times less often. `setEncoding('utf8')` means a multi-byte character cannot split at a chunk boundary. |
| `b32551e9a` | Proxy lease ref-counted per `leaseKey`                                                          | Released on failed start, abort, stream exit and `disposeAll()` on all three hosts.                                                 |
| `d263ec9ae` | Observation writes batched at 250 ms / 64 rows into one transaction                             | Amortized. The insert is still synchronous `better-sqlite3` on the main thread. Every read path flushes first.                      |

Targeted specs run by the reviewer: `vscode-core` diagnostics and rpc-handler
33 passed, rpc-handlers streaming 30 passed, proxy-lease 6 passed, harness
cancellation and content-hash 17 passed.

### Findings

- **MODERATE** `apps/ptah-electron/src/activation/shutdown.ts:162` — the Electron
  quit starts the session-metadata flush **before** `disposeBootRefs` reaps the
  agents at `:134`, so references produced by those exits are never flushed. Quit
  Electron with a ptah-cli agent running: `disposeAll()` ends it,
  `agent-events.ts:438` stages the reference through `retryWithBackoff` with a
  1000 ms first delay, and the process exits first. On relaunch the session shows
  no CLI agent and continuation is impossible. The VS Code path does the opposite
  order (`main.ts:150-167`), and commit `14f89ce99` says "reap the agents first",
  but the Electron spec `main.metadata-flush.spec.ts:91` pins the losing order.
- **MODERATE** `stream-batch-buffer.ts:75,134-151` — the drain has no
  back-pressure. `inFlight` grows by one promise per 16 ms while the sink is slow
  and nothing caps it. Before this change the producer awaited each send, so the
  SDK stream was throttled by the transport. A chatty agent now runs ahead of the
  transport without a bound. This is a behaviour change in a task about
  unbounded work.
- **LOW** `shutdown.ts:134-142` — `agentProcessManager.disposeAll()` is started
  with `void` and `cliRegistry.disposeAll()` runs on the next line, so proxies
  stop before agents exit. "Agents before proxies" holds only on the CLI host.
- **LOW** `agent-process-manager.service.ts:1650-1657` — `getMaxConcurrentAgents`
  reads the setting with no clamp. The maximum of 20 exists only in the VS Code
  schema and in `agent:setConfig`. `maxConcurrentAgents: 200` written into
  `~/.ptah/settings.json` on Electron is accepted.
- **LOW** `agent-process-manager-helpers.ts:216-218` — when the last 256 KB holds
  no newline, the cut lands at an arbitrary UTF-16 index and can split a
  surrogate pair.
- **LOW** `session-metadata-store.ts:799-806` — `_deleteInternal` deletes the
  per-agent output keys before the staged session list is flushed. A failed flush
  leaves a session record whose references point at nothing.
- **LOW** `ptah-cli-registry.ts:944-945` — a keyless `getProfile(id)` increments
  `refCount` with no release path except `disposeAll()`. No caller is keyless
  today, so this is latent.
- **LOW** `harness-preflight.service.ts:33-36` — an aborted preflight records no
  health but keeps the throttle stamp. A workspace whose walk always exceeds
  1500 ms never gets a health report. Documented decision, but a behaviour change.

### Concurrency cap raised 10 → 20 (`be87679cc`). UNPROVEN

The cap counts **processes only** (`agent-process-manager.service.ts:1040-1052`).
At 20 the binding resource is main-process heap. Each agent holds up to 1 MB of
stdout, up to 55,000 stream events capped by **count and not by bytes**
(`:1226-1245` — a `tool_result` event can carry a large payload), and 500
segments. Every completed agent keeps all of it for 30 minutes. Each ptah-cli
agent is also a separate `claude.exe`; commit `8f64cf668` records 16 idle ones at
99 % of machine memory before the idle release existed.

Nothing enforces a byte budget across agents, and no spec starts more than a
handful. 20 is **unmeasured**, not proven unsafe.

---

## Phase 3 — renderer hot path. PARTIAL

### Confirmed correct

- **XSS chokepoint INTACT.** `rg "innerHTML"` over `chat`, `chat-streaming`,
  `chat-state`, `chat-execution-tree` and `chat-ui` returns only guidelines,
  comments and specs asserting it is not used. `execution-node.component.ts:135`
  binds `<markdown [data]="renderedContent()" />`, so AI text still routes
  through `libs/frontend/markdown`. The follow-up `c3e17d9f5` adds its
  `commandError` line by `{{ }}` interpolation.
- **`OnPush` intact** on every component touched, including
  `inline-agent-bubble.component.ts:628`.
- **`KEY_SEP` is safe.** It is `U+0000` (`streaming-indexes.ts:33`), used only in
  `blockDeltaKey(messageId, kind, blockIndex)`. `kind` is a two-value enum and
  `blockIndex` is numeric, so only `messageId` could collide, and no adapter
  synthesizes an id containing a NUL byte.
- **The final frame is NOT dropped.** `execution-node.component.ts:391-394`
  guards with `if (!this.isNodeStreaming()) { this.publishNow(content); return; }`.
  `publishNow` (`:414-419`) cancels the pending `requestAnimationFrame` and
  writes synchronously through a signal, which Angular's own scheduler drives and
  document visibility does not affect. Pinned by
  `execution-node.render-throttle.spec.ts:191-205`, which mocks `rAF` to a
  manual queue, moves a node to `'complete'` without flushing, asserts the final
  content rendered anyway, then flushes the stale frame and asserts it does not
  republish a stale prefix.

### Findings

- **SERIOUS** `execution-tree-builder.service.ts:502-523,535-551` — stale
  `isBackground` survives cache reuse. Confirmed by hand; see "Disagreement"
  above. → **TASK_2026_333**
- **SERIOUS** `agent-monitor.store.ts:821-823` — `MAX_AGENT_SEGMENTS = 500`
  drops the oldest segments with `slice(-500)`, no fold and no marker, sitting
  directly beside a `streamEvents` cap that folds what it drops. A long Codex or
  Copilot subagent loses its earliest reasoning permanently and silently.
  Lane B rated this LOW on the grounds that the persisted record survives; lane C
  rated it SERIOUS. Lane C is the better reading — the neighbouring cap proves
  the codebase already knows folding is required here. → **TASK_2026_335**
- **MODERATE** `tab-manager.service.ts:1862-1890` — debounced `localStorage`
  persistence, 500 ms trailing and 5 s max wait, with **no flush on teardown**.
  Both lanes found this independently. There is no `ngOnDestroy`, no
  `beforeunload` listener anywhere in app or lib source, and
  `apps/ptah-electron/src/main.ts:84` `before-quit` flushes only `fileSettings`
  and Sentry. `setTimeout` timers do not survive teardown. Finish a turn, close
  the panel within 500 ms, and the last finalized assistant message never
  reaches storage. On restore `SessionLoaderService` discards the resumed
  messages as already cached, so the reply is simply gone. → **TASK_2026_335**
- **MODERATE** `agent-monitor.store.ts:2007-2012` — `capBuffer` front-truncates
  stdout and stderr past 50 KB with no truncation marker. Pre-existing, not part
  of this diff, but it is silent scrollback loss on the same surface.
  → **TASK_2026_335**

---

## Test evidence

See `verification-run.md`. Eleven projects, 11 of 11 run, no failures, typecheck
clean. Two notes that bear on this task specifically: a worker process in
`@ptah-extension/markdown` and `@ptah-extension/rpc-handlers` failed to exit
gracefully, and `@ptah-extension/chat-execution-tree` carries only 2 suites and
22 tests for the library Phase 3 rewrote.

A green suite proves no existing assertion broke. Every finding above passed the
suite.

## Test gaps carried into the follow-ups

- `execution-tree-builder.service.spec.ts` — an incremental-versus-full
  equivalence test, including a child `message_start` arriving before its owning
  `tool_start`. This is the gap that let TASK_2026_333 ship.
- `tab-manager.persistence.spec.ts` — dispose the service with a save pending and
  assert the last mutator is flushed, or that it is deliberately not.
- `main.metadata-flush.spec.ts` — assert a reference staged by an agent exit
  during `disposeBootRefs` reaches storage. The spec at `:91` currently pins the
  losing order.
- `stream-batch-buffer.spec.ts` — assert a bound on `inFlight` with a sink that
  never resolves. The spec at `:74` uses a synchronous sink only.
- `agent-process-manager.service.spec.ts` — assert `getMaxConcurrentAgents`
  clamps to 20, and spawn 20 agents with large payloads against a heap bound.
- `agent-process-manager-helpers.spec.ts` — `trimBufferToLowWater` on a buffer
  whose tail 256 KB has no newline, asserting no split surrogate pair.
- `session-metadata-store.spec.ts` — `delete()` with a failing flush, asserting
  the output keys survive when the session record does.
- `agent-monitor.store` — assert the user-visible effect of the caps on the
  rendered card, so the truncation is a decision rather than an accident.

## Outcome

Status moved `in_review` → `done`. All three phases shipped and are verified.
Residuals: TASK_2026_333 (serious, do first), TASK_2026_334, TASK_2026_335.
