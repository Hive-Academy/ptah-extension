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
- `src/lib/tab-persistence.ts` — the persistence projection AND `sanitizeRestoredTab` (what is written, and what comes back)

## Key Files

- `src/lib/tab-manager.service.ts:40` — `ClosedTabEvent`. Replaces the legacy `STREAMING_CONTROL` push API (Phase 3): `TabManager` emits structured close events on a `closedTab` signal; `StreamRouter` reacts via `effect()`. This deletes the NG0200 DI cycle that motivated the original inversion.
- `src/lib/conversation-registry.service.ts` — central record of `ConversationId → { sessions, compaction state }`.
- `src/lib/tab-session-binding.service.ts` — two separate maps (`_byTab`, `_bySurface`) so UI tab enumeration never accidentally surfaces wizard/harness state.
- `src/lib/tab-manager.service.ts` `flushPendingSave` — **the debounced `localStorage` write has to survive teardown, and `setTimeout` does not.** `saveTabState()` is a 500 ms trailing debounce with a 5 s ceiling, called from `updateTabInternal` — so finishing a turn and closing the panel inside that window silently dropped the just-finalized assistant message, its `ExecutionNode` trees and the tab metadata, and they did not come back on restore either because `SessionLoaderService.refreshResumableSubagentsForSession` discards what `chat:resume` returns as already cached (TASK_2026_335). Three signals feed one idempotent flush, because no single one covers every host: `pagehide` (the webview document unloading — by the time the extension host's `onDidDispose` runs the webview is gone, so the host cannot ask us to flush), `beforeunload` (Electron unloads the renderer when a `BrowserWindow` closes, including from `app.quit()`), and `visibilitychange` to `hidden` (a webview without `retainContextWhenHidden` can be discarded without announcing it). `DestroyRef.onDestroy` flushes BEFORE removing the listeners. Any new teardown path belongs on `flushPendingSave()`, not on a second timer.
- `src/lib/tab-persistence.ts` — `sanitizeRestoredTab` is the ONE definition of "restored tab", used by both readers: `TabManagerService.loadTabState` (legacy/active key) and `TabWorkspacePartitionService._loadWorkspaceTabsFromStorage` (per-workspace keys). It nulls `streamingState` and `attachedBinding` (the exact fields `projectTabForPersist` drops on the way out), clears `queuedContent`/`queuedOptions`, and coerces every in-flight status (`streaming | resuming | switching | awaiting-background`) to `loaded`. As two hand-written spreads they had drifted: the workspace reader coerced only two of the four statuses and never cleared the queue, so a reloaded background-workspace tab kept a spinner for a dead SDK query and auto-sent a days-old queued message at the next turn end (TASK_2026_327).
- `src/lib/tab-manager.service.ts` `_doSaveTabState` + `src/lib/tab-persistence.ts` `persistBackedOff` — **a failed tab-state write backs off; it does not retry on every save (INV-10, TASK_2026_437 C17).** A `localStorage` quota failure repeats on every later save, and each attempt first `JSON.stringify`s every tab's finalized transcript on the renderer main thread. After a failure (`{ key, failedAt, attempt, tabCount }`), serialization is skipped until `failedAt + min(5 s × 2^attempt, 5 min)` for that storage key, unless the tab set shrank or the teardown flush runs (`flushPendingSave` passes `ignoreBackoff`, and a save the back-off skipped counts as pending so teardown still writes it — once per unload). A successful write clears the record; each failure logs one `console.warn` naming the next window, and nothing is attempted (so nothing is logged) inside a window. No timer is added: a skipped save is retried by the next ordinary save trigger. Known limits: the back-off is per storage key and restarts at attempt 0 when the failing key changes (two workspaces alternately failing do not escalate), and "shrank" is tab COUNT only — a smaller payload with the same tab count still waits out the window. The background-workspace writer in `TabWorkspacePartitionService` has no back-off. Pinned by `tab-persistence.backoff.spec.ts` and the `quota back-off` block of `tab-manager.persistence.spec.ts`.

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
6. **A debounced write needs a teardown flush, not a shorter debounce.** See `flushPendingSave` above. If you add another deferred write to this lib, it flushes on the same three signals or it loses data on close.
7. **Restore rules live in `sanitizeRestoredTab`, never in a loader.** There are two readers and there will be more; a field that must not survive a reload is added in one place or it is added in one place and forgotten in the other. Same for the write side: `projectTabForPersist` decides what is dropped, and the two functions are mirrors — a field nulled on restore should not be paying serialization cost on save.
8. **`applyTurnState` is the only writer of a live session's `status` and of the `_streamingTabIds` spinner set (TASK_2026_360).** It applies one backend `turn_state` per call in ONE `updateTabInternal` write (so partition routing is decided once), guarded by `lastTurnStateRevision` so a replayed or duplicated batch cannot regress the tab. The revision is reset to `undefined` wherever a fresh SDK query starts (`resetTabToFresh`, `applyNewConversationDraft`, `applyNewConversationStreaming`, `applyResumingSession`) because the tab is about to face a counter it has never seen — NOT because the backend restarts one. The backend counter is monotonic per SESSION ID and survives the record teardown on every clean broadcast-loop exit (`SessionTurnStateRegistry`'s revision floors, TASK_2026_371); the reset stays correct in both directions, since a tab with no recorded revision accepts anything, so a session whose backend floor survived can never lock out a genuinely new conversation. It is never persisted. The only sibling writer is the optimistic `markStreaming` + `markTabStreaming` on send, which the next `generating` event confirms. `applyFinalizedTurn`'s `loaded` microtask yields to a backend-owned `awaiting-background` / `sleeping` and to a `generating` that re-lit the tab in the same batch. `sleeping` is a `SessionStatus`; like every in-flight status it is coerced to `loaded` on restore and re-learned from `session:status`.

   **The acceptance rule is `canApplyTurnState(tabId, sessionId, revision)` (review F1)** and `applyTurnState(tabId, state, sessionId)` applies it again: a bound tab accepts only its own session (a placeholder tab accepts any), and revisions are compared only against `lastTurnStateRevision` recorded under the same `lastTurnStateSessionId` — a different session on a tab bound to it means a restarted counter (accept), on a tab NOT bound to it a stale broadcaster (reject). Both fields are dropped by `projectTabForPersist` and `sanitizeRestoredTab` and reset wherever the revision is. `ChatLifecycleService.handleChatError` no longer calls `applyErrorReset` / `markTabIdle` and the abort path no longer calls `markTabIdle` (review F3); the remaining `markTabIdle` / `markLoaded` / `status: 'loaded'` writers are setup, history, compaction, duplication, RPC-failure and explicit local resets — none is turn-derived.
