# @ptah-extension/chat-types

[Back to Main](../../../CLAUDE.md)

## Purpose

Shared chat-domain TypeScript types and the `StreamingState` data model used by every layer of the chat stack (chat-state, chat-streaming, chat-routing, chat, chat-execution-tree). Sits at the bottom of the chat dependency graph — pure types + a couple of small helper functions, no Angular runtime.

## Boundaries

**Belongs here**: type definitions for chat state (`TabState`, `SessionStatus`, `TabViewMode`), the canonical `StreamingState` shape, supporting types (`NodeMaps`, `AgentContentBlock`, `SendMessageOptions`), and a small set of helpers/constants that operate on those shapes (`createEmptyStreamingState`, `setStreamingEventCapped`, `STREAMING_EVENT_CAP`).

**Does NOT belong**: services, components, signals, anything that imports `@angular/core` for runtime behavior, anything that calls into `core`, `chat-state`, or other libs.

## Public API (from `src/index.ts`)

Re-exports everything from `./lib/chat-types`. Notable exports:

- **Types**: `TabState`, `SessionStatus`, `TabViewMode`, `StreamingState`, `NodeMaps`, `AgentContentBlock`, `SendMessageOptions`
- **Helpers**: `createEmptyStreamingState()`, `setStreamingEventCapped(state, event)`
- **Constants**: `STREAMING_EVENT_CAP` (5000)

## Internal Structure

- `src/lib/chat-types.ts` — single file containing every export

## Key Files

- `src/lib/chat-types.ts:55` — `StreamingState` interface. The flat event-based model that replaced the old `ExecutionNode` tree representation: events indexed by id (`Map<string, FlatStreamEventUnion>`), `messageEventIds[]` ordered list, `toolCallMap`, `textAccumulators`, `toolInputAccumulators`, `agentContentBlocksMap` (TASK_2025_102 — interleaved text/tool blocks from the agent file watcher), `eventsByMessage` (O(1) lookup), `pendingStats`.
- `src/lib/chat-types.ts:111` — `createEmptyStreamingState()` — used by tab init and reset.
- `src/lib/chat-types.ts:135` — `STREAMING_EVENT_CAP = 5000`. Long sessions can accumulate thousands of events; without a cap, signal-driven re-renders explode in cost.
- `src/lib/chat-types.ts:157` — `setStreamingEventCapped`. FIFO-bounded write into `events`: updates existing ids in place; for new ids at the cap, evicts the oldest (Map insertion order). First eviction emits one `console.warn`; subsequent evictions are silent. **Does not cascade-clean dependent collections** (`eventsByMessage`, `toolCallMap`, `textAccumulators`) — they are bounded transitively and reset by finalize/compaction flows.

## State Management Pattern

None. This is a pure types lib. Helpers are referentially transparent given their inputs (`setStreamingEventCapped` mutates the passed-in `state.events` Map but does not touch global state).

## Dependencies

**Internal**: `@ptah-extension/shared` (for `FlatStreamEventUnion`, `ExecutionChatMessage`, `EffortLevel`, `InlineImageAttachment`, `ExecutionNode`)

**External**: none

## Angular Conventions Observed

None — this lib is framework-agnostic TypeScript. No `@Injectable`, no signals, no decorators.

## Guidelines

1. **No Angular imports**. If you find yourself needing `@angular/core`, the symbol belongs in `chat-state` or higher.
2. **No services or classes with behavior** beyond pure helpers.
3. **All writes into `StreamingState.events` go through `setStreamingEventCapped`** — never call `state.events.set(...)` directly from consumer code. The cap exists for performance reasons.
4. **Cascade-clean is not this lib's job**. `setStreamingEventCapped` only evicts from `events`; downstream maps reset during finalize/compaction.
5. Keep the file flat. Adding sub-folders is allowed only when the file grows past ~500 lines.
