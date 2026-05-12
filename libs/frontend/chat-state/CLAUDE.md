# @ptah-extension/chat-state

[Back to Main](../../../CLAUDE.md)

## Purpose

Per-tab chat state model and `TabManagerService`. Extracted from `@ptah-extension/chat` (TASK_2026_105 Wave G2 Phase 2) so apps (electron, dashboard, canvas) can consume tab state without pulling the full chat feature library.

Tagged `scope:webview` + `type:data-access`. Per Nx module-boundary enforcement, only depends on `type:data-access` and `type:util` libs (currently `chat-types`, `shared`). Cross-cutting needs (e.g. model refresh) are inverted via DI tokens.

## Boundaries

**Belongs here**: per-tab state (`TabManagerService`), workspace partitioning of tabs (`TabWorkspacePartitionService`), routing registries (`ConversationRegistry`, `TabSessionBinding`), branded identity types, confirmation dialog service, inverted-dependency tokens.

**Does NOT belong**: streaming write path (→ `chat-streaming`), routing resolution (→ `chat-routing`), UI components, backend services, pure builder functions (→ `chat-execution-tree`).

## Public API (from `src/index.ts`)

- **Services**: `TabManagerService`, `TabWorkspacePartitionService`, `ConfirmationDialogService`, `ConversationRegistry`, `TabSessionBinding`
- **Tokens**: `MODEL_REFRESH_CONTROL` (with `ModelRefreshControl` interface)
- **Identity types**: `TabId`, `ConversationId`, `BackgroundAgentId`, `SurfaceId`, `ClaudeSessionId`
- **Event/record types**: `ClosedTabEvent`, `ConversationRecord`, `CompactionStatePatch`, `CompactionStateView`, `WorkspaceTabSet`, `TabLookupResult`, `LiveModelStatsPayload`, `PreloadedStatsPayload`, `ConfirmationDialogOptions`

## Internal Structure

- `src/lib/tab-manager.service.ts` — core per-tab signal state + lifecycle (create, close, switch, force-close for pop-out)
- `src/lib/tab-workspace-partition.service.ts` — partitions tabs across workspaces (multi-root workspace support)
- `src/lib/tab-session-binding.service.ts` — bidirectional map between `TabId|SurfaceId ↔ ConversationId`
- `src/lib/conversation-registry.service.ts` — `Map<ConversationId, ConversationRecord>`; tracks sessions per conversation + compaction state
- `src/lib/identity/ids.ts` — branded `TabId`/`ConversationId`/`BackgroundAgentId`/`SurfaceId` with `.create()` factories
- `src/lib/confirmation-dialog.service.ts` — signal-based modal dialog
- `src/lib/model-refresh-control.ts` — `MODEL_REFRESH_CONTROL` `InjectionToken` (inverted dependency on core)
- `src/lib/tab-state.types.ts` — payload types

## Key Files

- `src/lib/tab-manager.service.ts:40` — `ClosedTabEvent`. Replaces the legacy `STREAMING_CONTROL` push API (Phase 3): `TabManager` emits structured close events on a `closedTab` signal; `StreamRouter` reacts via `effect()`. This deletes the NG0200 DI cycle that motivated the original inversion.
- `src/lib/conversation-registry.service.ts` — central record of `ConversationId → { sessions, compaction state }`.
- `src/lib/tab-session-binding.service.ts` — two separate maps (`_byTab`, `_bySurface`) so UI tab enumeration never accidentally surfaces wizard/harness state.

## State Management Pattern

Pure signals + `computed()`. No RxJS. No zone.js dependency. State updates are immutable (new arrays/objects via `update()`). Cross-cutting effects are inverted via tokens (`MODEL_REFRESH_CONTROL`) so this lib never imports from `core` or `chat-streaming`.

## Dependencies

**Internal**: `@ptah-extension/chat-types` (`TabState`, `StreamingState`, etc.), `@ptah-extension/shared` (`ExecutionChatMessage`, `EffortLevel`, `getModelContextWindow`)

**External**: `@angular/core` only

## Angular Conventions Observed

- `@Injectable({ providedIn: 'root' })` for all services
- `inject()` for DI, including token injection (`inject(MODEL_REFRESH_CONTROL, { optional: true })`)
- `signal()` + `computed()` exclusively
- Branded ID types via `.create()` factories to prevent string mix-ups

## Guidelines

1. **No outbound imports** to `chat`, `chat-streaming`, `chat-routing`, or `core`. If you need a cross-cutting service, define an `InjectionToken` in this lib and let the composition root bind it.
2. **Branded IDs**: never accept raw `string` for tab/conversation/surface identities — use the branded types so the compiler catches mix-ups.
3. **Closed-tab signal, not callback**: when adding tab-lifecycle hooks, emit on the `closedTab` signal — do not re-introduce a `STREAMING_CONTROL`-style push API.
4. **Immutable updates**: never mutate signal values in place; use `update(state => ({ ...state, ... }))`.
5. **Tab vs Surface**: this lib intentionally separates `_byTab` and `_bySurface` maps in `TabSessionBinding`. Do not collapse them.
