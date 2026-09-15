# @ptah-extension/chat

[Back to Main](../../../CLAUDE.md)

## Purpose

Chat feature library — the stateful orchestrator that composes presentational atoms from `chat-ui`, state from `chat-state`, streaming from `chat-streaming`, and routing from `chat-routing` into the full chat experience (organisms, templates, settings, the `ChatStore` facade).

## Boundaries

**Belongs here**: chat organisms (`message-bubble`, `agent-monitor-panel`, `execution/*`, `workspace-sidebar`), templates (`chat-view`, `app-shell`, `electron-shell`), the `ChatStore` facade, settings UI, chat-specific services (`MessageSenderService`, `FilePickerService`, `PanelResizeService`, `TypewriterService`, `KeyboardShortcutsService`, `WorkspaceCoordinatorService`), and the `@`/`/` trigger directives.

**Does NOT belong**: presentational atoms/molecules (→ `chat-ui`), per-tab/conversation state primitives (→ `chat-state`), SDK event ingestion or execution-tree building (→ `chat-streaming`), router resolution between events and surfaces (→ `chat-routing`), pure tree builder functions (→ `chat-execution-tree`), backend services.

## Public API (from `src/index.ts`)

Re-exports `./lib/components`, `./lib/settings`, `./lib/services`, `./lib/directives`. Containers are gone (TASK_2025_023) — consumers use `ChatViewComponent`.

## Internal Structure

- `src/lib/components/atoms/` — only `resize-handle.component.ts` (CDK-drag horizontal-axis variant; the no-CDK Electron version lives in `chat-ui`)
- `src/lib/components/molecules/` — stateful molecule groups: `agent-card/`, `chat-input/`, `compact-session/`, `notifications/`, `setup-plugins/`, `tool-execution/`, plus `confirmation-dialog.component.ts`
- `src/lib/components/organisms/` — `message-bubble`, `agent-monitor-panel`, `tab-bar`, `workspace-sidebar`, `execution/` (recursive execution-tree renderer)
- `src/lib/components/templates/` — `chat-view`, `app-shell`, `electron-shell`, `electron-welcome`
- `src/lib/components/file-suggestions/` — `@` and `/` autocomplete dropdown components
- `src/lib/services/` — `chat.store.ts` facade + `chat-store/` child services, plus standalone services
- `src/lib/services/chat-store/` — `SessionLoaderService`, `SessionHistoryReplayer`, `ConversationService`, `CompactionLifecycleService`, `MessageDispatchService`, `SessionStatsAggregatorService`, `ChatLifecycleService`
- `src/lib/settings/` — `settings.component.ts` + sub-folders `auth/`, `license/`, `pro-features/`, `ptah-ai/`, `workspace-indexing/`
- `src/lib/directives/` — `at-trigger.directive`, `slash-trigger.directive`, `auto-animate.directive`
- `src/lib/tokens/` — `session-context.token.ts`
- `src/lib/utils/` — `message-summary.utils.ts`

## Key Files

- `src/lib/services/chat.store.ts:52` — `ChatStore` facade. Aggregates `SessionManager`, `TabManagerService`, `StreamingHandlerService`, `StreamRouter`, `PermissionHandlerService`, and the six `chat-store/` child services; exposes a unified signal-based API.
- `src/lib/services/message-sender.service.ts` — centralized message-send mediator (resolves `SendMessageOptions`, applies effort overrides).
- `src/lib/services/agent-monitor-tree-builder.service.ts` — agent-monitor tree assembly (separate from the main execution tree).
- `src/lib/services/workspace-coordinator.service.ts` — implements `WORKSPACE_COORDINATOR` from `@ptah-extension/core`.
- `src/lib/components/organisms/execution/` — the recursive `ExecutionNode` renderer (organism layer of the Atomic Design hierarchy).
- `src/lib/components/templates/chat-view.component.ts` — root chat template wiring header, transcript, input.

## State Management Pattern

`ChatStore` is a **facade**, not a reducer. Each child service in `chat-store/` owns a slice (session loading, conversation lifecycle, compaction state machine, message dispatch, stats aggregation, bootstrap/license). The facade re-exposes their signals so consumers see one unified API surface (28 readonly signals + 36 methods per the file header).

State primitives live in `chat-state` (per-tab `TabState`, `TabManagerService`). Streaming writes live in `chat-streaming`. This lib stitches them together.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/core`, `@ptah-extension/chat-types`, `@ptah-extension/chat-state`, `@ptah-extension/chat-streaming`, `@ptah-extension/chat-routing`, `@ptah-extension/chat-ui`, `@ptah-extension/markdown`, `@ptah-extension/ui`

**External**: `@angular/core`, `@angular/common`, `@angular/forms`, `@angular/cdk` (drag for resize), `lucide-angular`

## Angular Conventions Observed

- Standalone components, `ChangeDetectionStrategy.OnPush`
- `inject()` everywhere (no constructor DI) — see `chat.store.ts:53-60`
- Signals + `computed()` for state; no `BehaviorSubject`
- `input.required<T>()` / `output<T>()` for component IO
- Templates use new control flow (`@if`, `@for`, `@switch`)

## Guidelines

1. Never bind AI-generated markdown via `[innerHTML]` — route through `MarkdownBlockComponent` from `@ptah-extension/markdown`.
2. Presentational pieces belong in `chat-ui`. If a new component injects `ChatStore`, `VSCodeService`, or any service, it stays here.
3. Add new chat-store slices as child services in `services/chat-store/` and expose them through the facade — keep `chat.store.ts` thin.
4. Per-tab state goes through `TabManagerService` (chat-state). Do not duplicate tab fields in `ChatStore`.
5. Streaming write-path edits belong in `chat-streaming`. The chat lib only **reads** streaming state via signals.
6. Routing (event → conversation → tabs/surfaces) is `StreamRouter`'s job. Do not re-resolve session IDs in chat-layer code.
7. **Resume history replays through `SessionHistoryReplayer` (`services/chat-store/session-history-replayer.service.ts`, TASK_2026_437 C15).** `chat:resume` returns `events` as its only transcript. `SessionLoaderService.switchSession` decides what a resume writes; the replayer decides how events reach the tab. Its class doc and `deferLiveEvent` doc hold the full contract; the rules to keep:
   - **Claims**: `claim(tabId, sessionId)` runs before `chat:resume` is sent and MUST be paired with `release` in a `finally`. A newer claim supersedes the older one, which then writes nothing.
   - **Chunks**: up to 250 events replay in one pass; longer histories yield one macrotask per chunk. The tab stays `resuming` until finalization, and a throwing chunk runs the failure branch — never a half-replayed tab.
   - **Live-event fence**: opens at claim time, because an `activate: true` resume starts the live query before its reply arrives. It is keyed by session (tab-path fan-out reaches every tile of the session). Held `chat:chunk` events are delivered once, in order: after finalization, or on release for every other exit. Only `chat:chunk` goes through it.
   - **Yield semantics**: use `yieldToMacrotask` from `@ptah-extension/core`, never a second `MessageChannel` helper. A failed post rejects like a throwing chunk. jsdom has no `MessageChannel` and resolves on a microtask, so a spec that needs real chunk boundaries installs one.
8. **`McpStatusChipComponent` (`components/molecules/mcp-status-chip.component.ts`) is a smart molecule, not a `chat-ui` atom (TASK_2026_375).** It reads `SessionMcpStatusRegistry` (`chat-state`), calls RPC for Authorize and the recovery read, and navigates — reasons enough on their own, and `session-stats-summary.component.ts`, the file its sibling chips live in, was already 861 lines. Its Authorize routing keys off the server name the session reports: a `smithery` key opens the Marketplace Smithery surface and fires no RPC (one namespace endpoint can hold several connections, so there is no single thing to authorize from the chip); an `oauth-`-prefixed key with a matching `mcpDirectory:listOAuthConnected` record calls `mcpDirectory:connectOAuth` directly; anything else — including an `oauth-` key with no record — opens the Marketplace Connectors surface.
