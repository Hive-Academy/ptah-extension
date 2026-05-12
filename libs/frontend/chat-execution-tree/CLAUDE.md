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
- **Pure functions**: `buildAgentNode`, `buildInterleavedChildren`, `buildMessageNode`, `findMessageStartEvent`, `buildToolNode`, `buildToolChildren`, `collectTools`
- **Types**: `BuilderDeps`, `BackgroundAgentLookup`

## Internal Structure

- `src/lib/builders/` — three leaf `.fn.ts` files (`agent-node.fn.ts`, `message-node.fn.ts`, `tool-node.fn.ts`) plus `builder-deps.ts` (structural port)
- `src/lib/agent-stats.service.ts` — per-agent stat aggregation
- `src/lib/execution-tree.constants.ts` — `MAX_DEPTH` constant

## Key Files

- `src/lib/builders/builder-deps.ts:39` — `BuilderDeps` interface. Builders receive this bag as their first arg; mutual recursion between builders goes through `deps.buildMessageNode` / `deps.buildToolNode` / `deps.buildAgentNode` callbacks. **Direct file imports between `.fn` files are forbidden** — they would re-introduce the module cycles Wave C7f eliminated.
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
4. **Tag**: `scope:webview` + `type:feature` per Nx module-boundary enforcement.
