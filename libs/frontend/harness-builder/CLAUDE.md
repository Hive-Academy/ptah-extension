# Harness Builder

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Interactive UI for building a Ptah "harness" (a packaged agent configuration: persona, agents, MCP servers, skills, CLAUDE.md, prompts). Streams analyze/build operations from the backend through the canonical chat streaming pipeline and previews the generated config.

## Boundaries

**Belongs here**: harness builder view, setup hub, config preview, streaming state for builder operations.
**Does NOT belong**: harness execution / generation (backend), generic chat streaming primitives (live in `@ptah-extension/chat-streaming` / `chat-routing`), agent registry (shared types).

## Public API

From `src/index.ts`:

- Services: `HarnessBuilderStateService`, `HarnessRpcService`, `HarnessStreamingService`.
- Components: `HarnessBuilderViewComponent`, `SetupHubComponent`, `HarnessConfigPreviewComponent`.

## Internal Structure

- `src/lib/components/` — three composite components (view, setup hub, preview)
- `src/lib/services/` — state service, RPC client, streaming service

## Key Files

- `src/lib/components/harness-builder-view.component.ts:32` — main view; OnPush; composes `ExecutionNodeComponent` and `MarkdownModule` for streaming output; uses `WebviewNavigationService` for nav.
- `src/lib/services/harness-builder-state.service.ts:1` — signal store; integrates with `StreamRouter` + `StreamingSurfaceRegistry` from `@ptah-extension/chat-routing` to route flat events through the canonical pipeline (TASK_2026_107 Phase 4). Exposes a `registerOperationSurface` / `routeOperationEvent` façade to the streaming service so concurrent operations emit a `harness.surface.concurrent-operation` warning (single-operation assumption per spec).
- `src/lib/services/harness-streaming.service.ts` — bridges backend `harness:flat-stream-*` events to the state façade.
- `src/lib/services/harness-rpc.service.ts` — typed RPC wrappers for harness backend methods.

## State Management / Architecture

- `StreamingState` accumulator per operation surface (SurfaceId), built on top of `@ptah-extension/chat-types`, `@ptah-extension/chat-state` (`SurfaceId`), and `@ptah-extension/chat-routing` (`StreamRouter`, `StreamingSurfaceRegistry`).
- Single-operation-at-a-time assumption; second concurrent operationId overwrites and logs a structured warning.
- On `harness:flat-stream-complete`, the surface routing binding closes but the accumulated `_streamingState` remains visible (post-completion replay).

## Dependencies

**Internal**: `@ptah-extension/core` (`WebviewNavigationService`), `@ptah-extension/chat` (`ExecutionNodeComponent`), `@ptah-extension/chat-streaming` (`ExecutionTreeBuilderService`), `@ptah-extension/chat-types`, `@ptah-extension/chat-state`, `@ptah-extension/chat-routing`, `@ptah-extension/shared` (harness DTOs).
**External**: `lucide-angular`, `ngx-markdown`, `@angular/forms`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, control-flow `@if/@else`, inline templates with styles.

## Guidelines

- Never reintroduce a hand-rolled flat-event accumulator — route through `StreamRouter` (this was deleted in TASK_2026_107 Phase 4).
- Treat concurrent build operations as out-of-scope; warn and overwrite, don't multiplex.
- All harness types must originate from `@ptah-extension/shared` (`HarnessConfig`, `HarnessInitializeResponse`, etc.).
