# @ptah-extension/chat-routing

Routing layer between **stream events** (from the Claude SDK) and **consumers** (chat tabs, wizard analysis phases, harness builds). Owns:

- `StreamRouter` — the single service that knows both `ConversationRegistry` (conversation ↔ session) and `TabSessionBinding` (tab/surface ↔ conversation). Resolves event → conversation → consumer(s).
- `StreamingSurfaceRegistry` — non-tab consumer adapter registry. Wizard/harness register `SurfaceAdapter`s here so the canonical `StreamingAccumulatorCore` can write into their state slots without knowing anything about wizard/harness storage layouts.

Tagged `scope:webview` + `type:feature`. Outbound deps: `chat-state`, `chat-streaming`, `shared`. Nothing imports back into chat-routing from chat-streaming or chat-state.

---

## What is a "surface"?

A **tab** is the standard chat consumer — owned by `TabManagerService`, has chat-shaped state (`messages`, `liveModelStats`, `compactionCount`, `viewMode`, `queuedContent`), participates in tab UI enumeration, can receive permission prompts.

A **surface** is a non-tab consumer of the canonical streaming pipeline. Today: setup-wizard analysis phases and harness-builder operations. Surfaces:

- **Have their own state shape** (wizard: `Map<phaseKey, StreamingState>`; harness: single `StreamingState` signal). No chat-shaped fields imposed.
- **Do not appear in `tabs()` enumeration**. The two binding maps (`_byTab` and `_bySurface` inside `TabSessionBinding`) are intentionally separate so consumers that care about UI tabs only do not accidentally enumerate wizard/harness surfaces.
- **Are not permission targets**. Wizard/harness run in full-auto background mode; auto-allow is enforced at the SDK layer. `routePermissionPrompt` returns tabs only — see "Permission routing scope" below.
- **Inherit dedup, batching, agent stores, session manager** transitively through the canonical accumulator. This is the entire point — every fix that lands in `StreamingAccumulatorCore` propagates to wizard + harness automatically.

When to add a new surface vs a new tab: if the consumer renders a transcript-style view backed by an execution tree and runs in unattended/full-auto mode, it is a surface. If the consumer has a user-driven chat conversation with permission prompts, queued content, and per-conversation message history, it is a tab.

---

## `SurfaceAdapter` contract

```ts
interface SurfaceAdapter {
  getState(): StreamingState;
  setState(state: StreamingState): void;
}
```

Registered with `StreamingSurfaceRegistry.register(surfaceId, getState, setState)`. The accumulator core reads via `getState()` and writes the swapped state via `setState(newState)` — currently used **only on `compaction_complete`**, which mints a fresh `StreamingState` object (see `AccumulatorResult.replacementState`).

For every other event type, the accumulator mutates the state object **in place**. This means:

- The adapter's `getState()` should return the same object reference that the consumer's signal/store points at. Wrapping in a new object on every call would break in-place mutations.
- For Angular signal-backed adapters, register with: `() => _state(), (next) => _state.set(next)`. The signal's identity check fires on `setState` but in-place mutations require a manual nudge from the consumer (see `WizardSurfaceFacade.nudgePhase` / `HarnessSurfaceFacade.nudgeOperation`).

The "nudge" pattern is the documented escape hatch for Angular's signal equality semantics — when the accumulator mutates `state.events` in place, signal observers will not re-evaluate unless the consumer explicitly bumps a counter signal or re-`set`s the parent signal with a shallow copy.

---

## Lifecycle ordering invariant

**Always** `streamRouter.onSurfaceClosed(surfaceId)` — **never** `surfaceRegistry.unregister(surfaceId)` directly.

`onSurfaceClosed` does the full teardown:

1. Snapshot the conversation's sessions.
2. `binding.unbindSurface(surfaceId)` — drop the surface ↔ conversation edge.
3. `surfaceRegistry.unregister(surfaceId)` — drop the adapter.
4. If no tabs AND no surfaces remain bound to the conversation, run per-session cleanup:
   - `streamingHandler.cleanupSessionDeduplication(sid)` for every session in the conversation
   - `agentMonitorStore.clearSessionAgents(sid)` for every session
   - `registry.remove(convId)` to drop the conversation

Calling `surfaceRegistry.unregister(surfaceId)` directly bypasses dedup cleanup and conversation removal — the conversation will leak in the registry and the next event for the session will route into nowhere.

Idempotent: closing an already-closed (or never-registered) surface is a graceful no-op.

---

## Permission routing scope (tab-only by design)

`StreamRouter.routePermissionPrompt(prompt)` returns `readonly TabId[]` — **never** `SurfaceId[]`. This is intentional and load-bearing:

- Wizard and harness sessions are spawned with **auto-allow** policy at the SDK layer (`apps/ptah-extension-vscode/...sdk-permission-handler.ts`). No prompt should ever reach those sessions.
- `routePermissionPrompt` resolves the session → conversation, then returns tabs only. If only surfaces are bound to the conversation, the **defensive guard** kicks in (TASK_2026_107 Phase 5):
  - Logs `console.warn('prompt.received.no-tab-surface-only', { promptId, sessionId, conversationId, surfaceCount })`
  - Auto-denies via `permissionHandler.handlePermissionResponse({ id, decision: 'deny', reason: 'auto-deny: prompt arrived for surface-only conversation' })` — the SDK is unblocked immediately and the prompt is removed from the queue.
- Public signature is **byte-unchanged** — the guard runs internally, the return type stays `readonly TabId[]`, and `cancelPendingPromptOnOtherTabs` is similarly tab-only.

If the spec ever needs per-surface permission UI in the future (e.g. "approve this wizard step"), the right move is a sibling `routePermissionPromptForSurfaces(prompt): readonly SurfaceId[]` — do **not** widen `routePermissionPrompt`'s return type.

---

## Single-operation assumption (harness)

`HarnessBuilderStateService._streamingState` is a single signal — there is no concurrent-build flow today. Spec assumes one operation in flight at a time. If a second `harness:flat-stream` arrives for a different `operationId` mid-build, the existing surface is closed via `onSurfaceClosed` and a fresh one is registered (with a `harness.surface.concurrent-operation` structured warning).

To lift this assumption (e.g. side-by-side harness builds):

1. Promote `_streamingState` to `Map<SurfaceId, StreamingState>` keyed by surface id.
2. `getState`/`setState` in the surface adapter look up by surface id.
3. The view component renders a per-operation tab (or grid tile) from each map entry.

This is additive — no changes to `StreamRouter` or `StreamingAccumulatorCore` required, because the routing graph and accumulator are already per-surface.

---

## Concrete consumer examples

- **Wizard**: `libs/frontend/setup-wizard/src/lib/services/setup-wizard/wizard-surface-facade.ts` — lazy-mints a surface per phase, holds the `phaseKey → SurfaceId` map, exposes `routeEvent(phaseKey, event)` for the wizard's analysis-stream handler.
- **Harness**: `libs/frontend/harness-builder/src/lib/services/harness-surface-facade.ts` (or equivalent — the harness's surface adapter wires `getState` / `setState` to `_streamingState`). Lazy-mints on first `harness:flat-stream` for an `operationId`; tears down on `harness:flat-stream-complete` AND on builder reset.

Both follow the same skeleton:

1. Inject `StreamRouter`, `StreamingSurfaceRegistry`.
2. Maintain a `Map<consumerKey, SurfaceId>` (e.g. `phaseKey → SurfaceId`, `operationId → SurfaceId`).
3. On first event for a key: `SurfaceId.create()`, `surfaceRegistry.register(...)`, `streamRouter.onSurfaceCreated(surfaceId, sessionId?)`.
4. On every event: `streamRouter.routeStreamEventForSurface(event, surfaceId)`.
5. On end-of-flow / panel close / reset: `streamRouter.onSurfaceClosed(surfaceId)` + drop from local map.

Use these as the reference when wiring a new surface consumer.

---

## Testing

Keep tests against the public router API — `onSurfaceCreated`, `onSurfaceClosed`, `routeStreamEventForSurface`, `surfacesForSession`, `routePermissionPrompt`. The `__tests__/surface-vs-tab-parity.spec.ts` integration test pins the contract that the surface path produces the same `StreamingState` shape as the canonical tab path. If that test fails after a Phase 2+ change to the accumulator core, the extraction has regressed — fix the underlying issue, do not weaken the assertions.
