# @ptah-extension/chat-routing

[Back to Main](../../../CLAUDE.md)

## Purpose

Routing layer between **stream events** (from the Claude SDK) and **consumers** (chat tabs + non-tab "surfaces" like wizard analysis phases and harness builds). Resolves `event.sessionId → ConversationId → TabId[] | SurfaceId[]` via the shared `ConversationRegistry` and `TabSessionBinding` from `chat-state`. Sits at the _top_ of the chat dependency graph — nothing in `chat-state` or `chat-streaming` imports back.

## Boundaries

**Belongs here**: `StreamRouter` (the single resolver service) and `StreamingSurfaceRegistry` (adapter registry for non-tab consumers).

**Does NOT belong**: tab state (→ `chat-state`), streaming accumulator (→ `chat-streaming`), surface state shapes (each consumer owns its own — wizard, harness, etc.), permission UI (the router only resolves _which_ tabs receive a prompt).

## Public API (from `src/index.ts`)

- `StreamRouter` — service
- `StreamingSurfaceRegistry` — service
- `SurfaceAdapter` — type

## Internal Structure

- `src/lib/stream-router.service.ts` — resolves events to consumers, owns lifecycle hooks (`onSurfaceCreated`, `onSurfaceClosed`, `routeStreamEventForSurface`, `routePermissionPrompt`)
- `src/lib/streaming-surface-registry.service.ts` — `Map<SurfaceId, SurfaceAdapter>` storage with `register` / `unregister` / `getAdapter`
- `src/lib/__tests__/` — parity tests that pin surface-path output equality with the canonical tab path

## Key Concepts

**Tab** — standard chat consumer owned by `TabManagerService`. Has chat-shaped state (`messages`, `liveModelStats`, `compactionCount`, `viewMode`, `queuedContent`), appears in `tabs()` enumeration, can receive permission prompts.

**Surface** — non-tab consumer of the canonical streaming pipeline. Owns its own state shape. Examples: setup-wizard analysis phases (`Map<phaseKey, StreamingState>`), harness-builder operations (single `StreamingState` signal). Does **not** appear in `tabs()`; is **not** a permission target (those flows run full-auto, auto-allow at the SDK layer).

## `SurfaceAdapter` Contract

```ts
interface SurfaceAdapter {
  getState(): StreamingState;
  setState(state: StreamingState): void;
}
```

The accumulator mutates state **in place** for every event except `compaction_complete` (which mints a fresh `StreamingState` via `AccumulatorResult.replacementState` and calls `setState`). Because of in-place mutation, signal-backed adapters need a **nudge counter** so Angular's equality check fires — see `WizardSurfaceFacade.nudgePhase` and harness equivalents.

## Lifecycle Invariant

Always call `streamRouter.onSurfaceClosed(surfaceId)` — **never** `surfaceRegistry.unregister(surfaceId)` directly. `onSurfaceClosed` performs the full teardown: unbind, unregister adapter, and if no tabs **and** no surfaces remain on the conversation, run per-session cleanup (`cleanupSessionDeduplication`, `clearSessionAgents`, `registry.remove(convId)`).

Calling `unregister` directly bypasses dedup cleanup and leaks the conversation.

## Permission Routing Scope

`StreamRouter.routePermissionPrompt(prompt)` returns `readonly TabId[]` — **never** `SurfaceId[]`. Surfaces run full-auto with auto-allow at the SDK layer. If a prompt arrives on a surface-only conversation (defensive case), the router logs `prompt.received.no-tab-surface-only` and auto-denies via `PermissionHandlerService`. If per-surface permission UI is ever needed, add a sibling `routePermissionPromptForSurfaces` — do not widen the existing return type.

## Single-Operation Assumption (Harness)

Harness uses a single `_streamingState` signal — no concurrent builds. If a second `harness:flat-stream` arrives for a different `operationId` mid-build, the existing surface is closed and a new one is registered (with a `harness.surface.concurrent-operation` warning). To lift this, promote to `Map<SurfaceId, StreamingState>` — additive, no router changes required.

## Dependencies

**Internal**: `@ptah-extension/chat-state` (registries, identity), `@ptah-extension/chat-streaming` (accumulator core, dedup/agent cleanup hooks), `@ptah-extension/shared`

**External**: `@angular/core`

## Angular Conventions Observed

- `@Injectable({ providedIn: 'root' })` for both services
- Signal-driven reactions (`effect()`) for the `TabManager.closedTab → router.cleanup` edge (replaces the old `STREAMING_CONTROL` DI inversion that caused NG0200)

## Guidelines

1. **Never** call `surfaceRegistry.unregister` directly — always go through `streamRouter.onSurfaceClosed`.
2. **Never** widen `routePermissionPrompt`'s return type to include `SurfaceId`. Add a new method.
3. Signal-backed adapters must implement a nudge pattern (or wrap state in a re-`set` shallow copy) — in-place mutation alone will not trigger downstream re-eval.
4. New surface consumers follow the pattern: lazy-mint a `SurfaceId`, register adapter, call `onSurfaceCreated`, route every event via `routeStreamEventForSurface`, call `onSurfaceClosed` on teardown.
5. Public API is byte-stable — defensive guards run internally without changing return shapes.
