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

## State Management Pattern

- **Signals** for the two stores (`BackgroundAgentStore`, `AgentMonitorStore`).
- **Direct mutation** of `StreamingState` maps inside the accumulator (deliberate — see chat-routing nudge pattern for the signal-equality consequence).
- **RAF batching** in `BatchedUpdateService` — coalesces many event mutations into one signal flush per frame.
- **Memo cache** on `ExecutionTreeBuilderService` keyed on streaming-state revision.

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
3. **Builders stay pure** in `chat-execution-tree`. Any caching, memoization, or DI-bound logic belongs here in `ExecutionTreeBuilderService`.
4. **`StreamingAccumulatorCore` is the single source of truth** for event handling — both the tab path (`StreamingHandlerService`) and the surface path (`StreamRouter`) go through it. Bug fixes here propagate to all consumers automatically.
5. **Dedup cleanup must be paired with conversation teardown** — see the `StreamRouter.onSurfaceClosed` invariant in chat-routing.
