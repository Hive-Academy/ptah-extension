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
- **Helpers**: `createEmptyStreamingState()`, `setStreamingEventCapped(state, event)`, `markStructuralChange(state)`
- **Constants**: `STREAMING_EVENT_CAP` (5000)

## Internal Structure

- `src/lib/chat-types.ts` — single file containing every export

## Key Files

- `src/lib/chat-types.ts:55` — `StreamingState` interface. The flat event-based model that replaced the old `ExecutionNode` tree representation: events indexed by id (`Map<string, FlatStreamEventUnion>`), `messageEventIds[]` ordered list, `toolCallMap`, `textAccumulators`, `toolInputAccumulators`, `agentContentBlocksMap` (TASK_2025_102 — interleaved text/tool blocks from the agent file watcher), `eventsByMessage` (O(1) lookup), `pendingStats`.
- `src/lib/chat-types.ts:111` — `createEmptyStreamingState()` — used by tab init and reset.
- `src/lib/chat-types.ts:135` — `STREAMING_EVENT_CAP = 5000`. Long sessions can accumulate thousands of events; without a cap, signal-driven re-renders explode in cost.
- `src/lib/chat-types.ts:157` — `setStreamingEventCapped`. FIFO-bounded write into `events`: updates existing ids in place; for new ids at the cap, evicts the oldest (Map insertion order). First eviction emits one `console.warn`; subsequent evictions are silent. Cascade-cleans the evicted eventId from every dependent collection (`eventsByMessage`, `toolCallMap`, `textAccumulators`, `toolInputAccumulators`, `agentContentBlocksMap`, `agentSummaryAccumulators`, `messageEventIds`, `messageRevisions`); empty parent buckets are deleted. O(1) amortized.

### The three revision counters (TASK_2026_323)

`StreamingState` carries three OPTIONAL counters that exist so downstream
derived caches can invalidate without diffing content. All three are written by
`setStreamingEventCapped`; all three read as "untracked" when absent, which
consumers MUST interpret as "always dirty", never as "unchanged".

| Field                         | Bumped on                                                                                                                                                                                                                          | Read by                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `revision`                    | every write into `events`                                                                                                                                                                                                          | fallback index key                                                                                         |
| `messageRevisions[messageId]` | every write carrying that `messageId`                                                                                                                                                                                              | the tree builder's per-root-message dirty check — it rebuilds only the message subtrees whose events moved |
| `structuralRevision`          | structural events (`message_start`, `message_complete`, `tool_start`, `tool_result`, `agent_start`), any cap eviction, and — via `markStructuralChange` from the accumulator — creating or clearing a `textAccumulators` block key | the tree builder's derived-index memo                                                                      |

`structuralRevision` deliberately does NOT move for a plain `text_delta`. That
is the whole point: a burst of deltas shares one `O(events)` index pass instead
of paying for a fresh one per streamed chunk. It is also deliberately NOT
initialised by `createEmptyStreamingState`, so a state that only ever received
raw `events.set(...)` writes reads as untracked rather than as a counter that
those writes silently bypassed.

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
4. **Cascade-clean is handled by `setStreamingEventCapped`**. When extending `StreamingState` with a new collection keyed by `eventId`, update the cascade-clean block in `setStreamingEventCapped` to remove the evicted id from the new collection (and drop the parent key when the bucket empties).
5. **`eventsByMessage` buckets are in non-descending `timestamp` order.** The accumulator inserts in order (`StreamingAccumulatorCore.indexEventByMessage`); readers rely on it and must not sort. A `slice().sort()` at read time is exactly the R2 defect this replaced.

   **A same-id write is a REPLACEMENT and must land in both maps.** `setStreamingEventCapped` repoints the matching `eventsByMessage` entry at the new object (`replaceInMessageBucket`). It used to update `events` only, so after `StreamingAccumulatorCore.backfillAgentStartToolId` swapped a hook `agent_start`'s UUID for the real `toolu_*` id, the bucket still held the pre-backfill object — and every builder reads the bucket, so the tool→agent match the backfill exists to repair never happened (TASK_2026_327). Any new collection that also indexes an event BY ID must be repointed there too, next to the cap's cascade-clean.

6. **A writer that adds or removes a `textAccumulators` block key must call `markStructuralChange(state)`.** The KEY SET is indexed by the tree builder; the content is not. Miss the call and a brand-new text block never appears.
7. Keep the file flat. Adding sub-folders is allowed only when the file grows past ~500 lines.
