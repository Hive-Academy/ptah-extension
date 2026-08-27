# @ptah-extension/chat-streaming

[Back to Main](../../../CLAUDE.md)

## Purpose

Streaming write-path bundle. Owns SDK-event ingestion, deduplication, batched UI updates, message finalization, permission/AskUserQuestion lifecycle, session-scoped node maps, the `ExecutionTreeBuilderService` orchestrator (with memo cache), and the `BackgroundAgentStore` / `AgentMonitorStore` signal stores. Extracted from `@ptah-extension/chat` (TASK_2026_105 Wave G2 Phase 3).

Tagged `scope:webview` + `type:feature`. The chat lib depends on this; this never imports from chat.

## Boundaries

**Belongs here**: anything that processes SDK events (`StreamingHandlerService`, `EventDeduplicationService`, `BatchedUpdateService`, `MessageFinalizationService`, `PermissionHandlerService`), session-scoped node-map tracking (`SessionManager`), execution-tree orchestration (`ExecutionTreeBuilderService` — binds the pure builders from `chat-execution-tree` and owns the memo cache), agent stores (`BackgroundAgentStore`, `AgentMonitorStore`), the extracted event-switch core (`StreamingAccumulatorCore`).

**Does NOT belong**: pure builders (→ `chat-execution-tree`), per-tab state (→ `chat-state`), routing resolution (→ `chat-routing`), UI components, chat templates.

## Public API (from `src/index.ts`)

- **Services**: `StreamingHandlerService`, `MessageFinalizationService`, `EventDeduplicationService`, `BatchedUpdateService`, `PermissionHandlerService`, `StreamingAccumulatorCore`, `SessionManager`, `ExecutionTreeBuilderService`
- **Stores**: `BackgroundAgentStore`, `AgentMonitorStore`
- **Types**: `AccumulatorContext`, `AccumulatorResult`, `SessionState`, `BackgroundAgentEntry`, `MonitoredAgent`

## Internal Structure

- `src/lib/streaming-handler.service.ts` — top-level event router for the tab path; delegates to child services
- `src/lib/accumulator-core.service.ts` — extracted event-type switch (TASK_2026_107 Phase 2). Consumed directly by `StreamRouter` for surface routing and transitively by `StreamingHandlerService` for tab routing — both paths share one accumulator
- `src/lib/event-deduplication.service.ts` — source-priority + duplicate-event detection
- `src/lib/batched-update.service.ts` — RAF-coalesced UI updates
- `src/lib/message-finalization.service.ts` — turn → `ExecutionChatMessage`
- `src/lib/permission-handler.service.ts` — permission/AskUserQuestion request queue
- `src/lib/session-manager.service.ts` — per-session node maps + lifecycle
- `src/lib/execution-tree-builder.service.ts` — orchestrator + memo cache; wires `BuilderDeps` callbacks for the pure builders in `chat-execution-tree`
- `src/lib/background-agent.store.ts` — signal store of background agents (satisfies `BackgroundAgentLookup` from chat-execution-tree)
- `src/lib/agent-monitor.store.ts` — signal store for the monitor panel

## Key Files

- `src/lib/streaming-handler.service.ts:50` — `tabManager` is now eagerly injected (Phase 3). The lazy `Injector.get` band-aid was removed because `STREAMING_CONTROL` is gone. `StreamingHandler → TabManager` is now a single-direction edge; DI bootstrap completes without NG0200.
- `src/lib/accumulator-core.service.ts` — the shared write path. Mutates `StreamingState` in place for all events except `compaction_complete` (which returns a fresh state in `AccumulatorResult.replacementState`).
- `src/lib/accumulator-core.service.ts` `indexEventByMessage` — keeps each `eventsByMessage` bucket in non-descending `timestamp` order (plain `push` on the hot path, binary insert only for a genuinely out-of-order replay). Readers must NOT sort; the message builder's old `slice().sort()` of every delta per rebuild was TASK_2026_323 R2.
- `src/lib/execution-tree-builder.service.ts` — the rebuild is INCREMENTAL, in three layers. (1) `StreamingIndexes` derived once per state version, memoized per cacheKey on `structuralRevision` — which a `text_delta` does not bump, so a burst of deltas shares one `O(events)` pass. (2) A digest per ROOT message, folding every descendant message (a subagent's events carry the subagent's own `messageId`, so `rootMessageIdByMessageId` walks `message_start.parentToolUseId → tool_start.messageId` to attribute them); only roots whose digest moved reach `buildMessageNode`, and when none moved `buildTree` returns the previous ARRAY by reference. (3) Cheap 32-bit fingerprints keep object identity stable inside a rebuilt subtree. The predecessor keyed its memo on `events.size` — which every delta changes — and then `JSON.stringify`d every tool input/output per node, making one rebuild proportional to total transcript bytes.
- `src/lib/execution-tree-builder.service.ts` `pruneNodeMaps` — the identity maps (`nodesById` / `fingerprintsById`) are long-lived on purpose, but they are BOUNDED. Nothing removed a key, while `StreamingState.events` is capped and its cascade drops evicted messages from `messageEventIds` — so the tree shrank and the maps kept every node it had ever rendered, plus the retained `ExecutionNode` with its tool payloads (TASK_2026_327). The sweep costs O(live nodes), which is the whole-tree walk the incremental rebuild exists to avoid, so it runs only once the maps have DOUBLED past the live count measured at the previous sweep (floor 512) — amortized O(1) per node added. Measured on the spec's 3×-cap stream: ~1.4× live with the prune, ~3× and climbing without it.
- `src/lib/agent-monitor.store.ts` `capStreamEventsInPlace` — the 2 000-event trim keeps landmarks plus the recent tail, but `AgentMonitorTreeBuilderService` renders ACCUMULATORS, not events. Keeping landmarks alone therefore kept every message and tool node while deleting everything that gives them content, irreversibly (the builder folds each event exactly once): a long agent's card became empty message bodies and tool calls with no input. The trim now folds what it drops back into the surviving structure — one synthetic delta per accumulator key ahead of the head, and the tool's input written onto the surviving `tool_start` unless some of that tool's deltas survive in the tail (in which case a synthetic `tool_delta` carries the prefix, so the two halves are not parsed as two truncated JSON documents).
- `src/lib/execution-tree-builder.service.ts` `mixNumber` — signed (`| 0`), not unsigned (`>>> 0`), on purpose. An unsigned fold exceeds 2^31, leaves V8's small-integer range and boxes every intermediate; that alone made the fingerprint pass cost several times more than building the nodes it exists to skip.

## State Management Pattern

- **Signals** for the two stores (`BackgroundAgentStore`, `AgentMonitorStore`).
- **Direct mutation** of `StreamingState` maps inside the accumulator (deliberate — see chat-routing nudge pattern for the signal-equality consequence).
- **RAF batching** in `BatchedUpdateService` — coalesces many event mutations into one signal flush per frame.
- **Incremental tree build** on `ExecutionTreeBuilderService` — three layers, see its Key Files entry below.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/chat-types`, `@ptah-extension/chat-state` (`TabManagerService`), `@ptah-extension/core` (`VSCodeService`), `@ptah-extension/chat-execution-tree` (pure builders)

**External**: `@angular/core`

## Angular Conventions Observed

- `@Injectable({ providedIn: 'root' })` everywhere
- `inject()` exclusively
- Signal stores expose readonly `signal`s; mutation goes through service methods
- No RxJS in the write path — RAF + signals handle scheduling

## Guidelines

1. **Never import from `@ptah-extension/chat`** — the dependency edge is one-way (chat → chat-streaming).
2. **In-place mutation of `StreamingState`** is the contract — see `accumulator-core.service.ts`. If you need a fresh state, do it explicitly via `AccumulatorResult.replacementState` (only `compaction_complete` does this today).
3. **Builders stay pure** in `chat-execution-tree`. Any caching, memoization, or DI-bound logic belongs here in `ExecutionTreeBuilderService` — including the `BuilderDeps.getIndexes` memo the builders call through.
4. **A sync flush must name its tab.** `BatchedUpdateService.flushSync(originTabId)` gates every other tab behind the visibility check; `flushSync()` with no argument is the FULL drain and is correct only at turn-end finalization, where `MessageFinalizationService` calls it directly. `StreamingHandlerService.flushUpdatesSync()` re-exposed the unscoped form on the per-event handler, had no callers, and was deleted (TASK_2026_327). Do not add it back without an `originTabId`.
5. **`StreamingAccumulatorCore` is the single source of truth** for event handling — both the tab path (`StreamingHandlerService`) and the surface path (`StreamRouter`) go through it. Bug fixes here propagate to all consumers automatically.
6. **Dedup cleanup must be paired with conversation teardown** — see the `StreamRouter.onSurfaceClosed` invariant in chat-routing.
7. **Permissions and questions have SEPARATE target maps** in `PermissionHandlerService` (`_promptTargetTabs` vs `_questionTargetTabs`). A surface host filtering question cards must use `hasSurfaceQuestionTargets(q.id)` — `hasSurfaceTargets(id)` reads the permission map and silently returns false for every question, which hides the card while the agent blocks on `awaitQuestionResponse` (`timeoutAt: 0`) until the backend's 5-minute auto-pick. This was mis-wired three times (harness, tribunal, chat) before the predicate was lifted here.
8. **`''` is never a session id** (`session-scope.ts`, TASK_2026_295). The backend could put an empty string on `FlatStreamEvent.sessionId` / `SubagentRecord.parentSessionId` before the SDK session resolved; `''` is neither nullish (so `??` skips it) nor truthy (so `!x` rejects it), which is how one agent ended up shown in every tab by one view and no tab by another. Wave 2 made both fields optional, so "not known" now travels as `undefined` and no producer has to invent a value. Every writer still normalizes through `knownSessionId` — a stored owner is a real id or `undefined`, never `''` — because `?: string` widens the type without forbidding `''`.

   **`agentVisibleInSession` models two independent axes; conflating them is what made three sibling views disagree.** (a) _The agent's owner_: a known owner must match, an unknown owner is visible everywhere so an agent can never become unreachable. (b) _The viewer's own session_: a view scoped to a session that has not resolved shows NOTHING — it cannot claim a specific session's agents, and it need not catch the unattributed ones because every resolved view already shows those. Callers must NOT hand-roll a pre-check for (b); three of them did, with three different answers. A view that is not scoped at all (the global panel) does not call the helper — "unscoped" and "scoped but unresolved" are different states only the caller can tell apart.

   Destructive per-session operations (`clearSessionAgents`, `clearCompletedInSession`, `BackgroundAgentStore.clearSession`) deliberately stay on strict owner equality — "visible here" must not mean "deletable from here". Session ids off the wire go through `SessionId.safeParse`, never `SessionId.from`, which throws.
