# @ptah-extension/chat-execution-tree

[Back to Main](../../../CLAUDE.md)

## Purpose

Pure builder functions that assemble `ExecutionNode` trees from flat `StreamingState` event maps. Extracted from `@ptah-extension/chat` (TASK_2026_105 Wave G1) so downstream consumers (canvas, agent-monitor, future analytics surfaces) can construct trees without pulling the full chat feature library.

## Boundaries

**Belongs here**: stateless functions that map flat events → `ExecutionNode[]`; the `AgentStatsService` that derives per-agent stats; the `MAX_DEPTH` recursion guard constant; structural port types (`BuilderDeps`, `BackgroundAgentLookup`).

**Does NOT belong**: the orchestrating `ExecutionTreeBuilderService` (lives in `chat-streaming`), the `BackgroundAgentStore` concrete (also `chat-streaming`), any signal stores, any RxJS, any DI tree wiring beyond a single `@Injectable` service.

## Public API (from `src/index.ts`)

- **Service**: `AgentStatsService`
- **Constant**: `MAX_DEPTH`
- **Pure functions**: `buildAgentNode`, `buildInterleavedChildren`, `buildMessageNode`, `findMessageStartEvent`, `buildToolNode`, `buildToolChildren`, `collectTools`, `buildStreamingIndexes`
- **Types**: `BuilderDeps`, `BackgroundAgentLookup`, `StreamingIndexes`, `AccumulatedBlock`

## Internal Structure

- `src/lib/builders/` — three leaf `.fn.ts` files (`agent-node.fn.ts`, `message-node.fn.ts`, `tool-node.fn.ts`) plus `builder-deps.ts` (structural port)
- `src/lib/indexes/streaming-indexes.ts` — ★ the derived lookup tables every builder reads instead of scanning `state.events`
- `src/lib/agent-stats.service.ts` — per-agent stat aggregation
- `src/lib/execution-tree.constants.ts` — `MAX_DEPTH` constant

## Key Files

- `src/lib/builders/builder-deps.ts:39` — `BuilderDeps` interface. Builders receive this bag as their first arg; mutual recursion between builders goes through `deps.buildMessageNode` / `deps.buildToolNode` / `deps.buildAgentNode` callbacks. **Direct file imports between `.fn` files are forbidden** — they would re-introduce the module cycles Wave C7f eliminated.
- `src/lib/indexes/streaming-indexes.ts` — `buildStreamingIndexes(state)` derives every relational answer the builders need in ONE pass over `events` (plus one over `textAccumulators` keys). Before TASK_2026_323 each builder answered its own question with `[...state.events.values()].filter/find(…)` — a full Map spread PER NODE, so a rebuild was `O(nodes × events)` and a rebuild happened on every streamed chunk. **Bucket order is `events` insertion order and every single-value map keeps the FIRST match**, which is what the `.filter`/`.find` scans produced; break that and node ids, child order or statuses shift. `AccumulatedBlock` carries the accumulator KEY, never its content — an index that mirrored streamed content could never be reused across a chunk.
- `src/lib/builders/builder-deps.ts` — `getIndexes(state)`. A callback, not a field, because indexes are per state VERSION rather than per deps bag: `ExecutionTreeBuilderService` passes a memoizing implementation, specs pass `buildStreamingIndexes` directly and stay correct across mid-test mutation.
- `src/lib/builders/builder-deps.ts:35` — `BackgroundAgentLookup` structural port. The concrete `BackgroundAgentStore` in `chat-streaming` satisfies this shape; specs supply lightweight stubs.

## State Management Pattern

Stateless. All state flows in via the `StreamingState` map (`@ptah-extension/chat-types`) and `BuilderDeps` dependency bag. Builders return new `ExecutionNode` objects — they do not mutate the state map.

## Dependencies

**Internal**: `@ptah-extension/shared` (types only), `@ptah-extension/chat-types` (`StreamingState`)

**External**: `@angular/core` (single `@Injectable` for `AgentStatsService`)

## Angular Conventions Observed

- `AgentStatsService` is `@Injectable({ providedIn: 'root' })`
- Everything else is plain TypeScript functions — no decorators, no Angular runtime touching the builders

## Guidelines

1. **Acyclic invariant**: this lib must never import from `@ptah-extension/chat`, `@ptah-extension/chat-streaming`, or any feature lib. Anything that needs a concrete service comes in through `BuilderDeps` callbacks.
2. **Pure functions**: builders must be referentially transparent given the same `(state, deps, depth)`. Caching/memoization belongs in `ExecutionTreeBuilderService` (chat-streaming), not here.
3. **Mutual recursion via deps**: when one builder needs another, call `deps.buildX(...)` — never a direct import from a sibling `.fn` file.
4. **Never scan `state.events` from a builder.** Add a field to `StreamingIndexes` instead, and derive it in the existing single pass. A builder that spreads or filters the events Map is `O(events)` per node by construction.
5. **Never sort `state.eventsByMessage` at read time.** The accumulator keeps buckets in non-descending `timestamp` order on append.
6. **Tag**: `scope:webview` + `type:feature` per Nx module-boundary enforcement.
