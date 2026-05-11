# @ptah-extension/core

[Back to Main](../../../CLAUDE.md)

## Purpose

Foundational service layer for the webview: VS Code integration, signal-based navigation, type-safe RPC, inbound message dispatch, application state, autocomplete discovery facades, and a handful of provider-state services (model, autopilot, effort, LLM provider, theme, auth, electron layout).

## Boundaries

**Belongs here**: application-level state (view, loading, connection), VS Code API integration (`VSCodeService`, `provideVSCodeService`), inbound message dispatch (`MessageRouterService`, `MESSAGE_HANDLERS` token), signal-based navigation (no Angular Router — VS Code blocks History API), type-safe RPC (`ClaudeRpcService`, `rpc-call.util`), discovery facades, structured logging, cross-cutting DI tokens (`SESSION_DATA_PROVIDER`, `WORKSPACE_COORDINATOR`, lazy-view component tokens).

**Does NOT belong**: feature-specific state (chat, dashboard, editor — each owns its own), UI components, backend services, HTTP clients (webview uses `postMessage`, never `fetch`).

## Public API (from `src/index.ts`)

- All services from `./lib/services` (barrel)
- `LogLevel`, `LoggingConfig`
- Tokens: `SESSION_DATA_PROVIDER` + `ISessionDataProvider`, `WORKSPACE_COORDINATOR` + `IWorkspaceCoordinator` + `ConfirmDialogOptions`, `WIZARD_VIEW_COMPONENT`, `ORCHESTRA_CANVAS_COMPONENT`, `HARNESS_BUILDER_COMPONENT`, `SETUP_HUB_COMPONENT`

## Internal Structure

- `src/lib/services/` — every service is a single file at the root; specs live alongside (`*.spec.ts`)
- `src/lib/tokens/` — three token files: `session-data.token.ts`, `workspace-coordinator.token.ts`, `lazy-view-components.token.ts`
- `src/testing/` — shared test helpers

## Key Files

- `src/lib/services/app-state.service.ts` — `AppStateManager` with global view, loading, workspace, connection signals
- `src/lib/services/webview-navigation.service.ts` — pure signal-based component switching; **no Angular Router** (VS Code webviews block `history.pushState`)
- `src/lib/services/vscode.service.ts` — wraps the VS Code `postMessage` / `getState` / `setState` API; itself implements `MessageHandler` for select system messages
- `src/lib/services/message-router.service.ts` — single `window.addEventListener('message', ...)`, builds `Map<messageType, MessageHandler[]>` from all `MESSAGE_HANDLERS` multi-provider entries at construction
- `src/lib/services/message-router.types.ts` — `MessageHandler` interface, `MESSAGE_HANDLERS` `InjectionToken`, `provideMessageRouter()` helper
- `src/lib/services/claude-rpc.service.ts` + `rpc-call.util.ts` — type-safe async RPC with timeout/retry; ready-gate utility for early-call queueing
- `src/lib/services/agent-discovery.facade.ts` / `command-discovery.facade.ts` — `@agent` / `/command` autocomplete
- `src/lib/services/model-state.service.ts` / `autopilot-state.service.ts` / `effort-state.service.ts` / `llm-provider-state.service.ts` — provider/permission/effort signals
- `src/lib/services/auth-state.service.ts` — auth/license state
- `src/lib/services/theme.service.ts` / `electron-layout.service.ts` — environment-specific UI state
- `src/lib/services/ptah-cli-state.service.ts` — CLI provider state
- `src/lib/services/idempotent-setters.ts` — `setIfChanged` signal helper (TASK_2026_115)
- `src/lib/services/logging.service.ts` — structured logging with `LogLevel`

## State Management Pattern

**Signal-first.** Every service exposes private `signal<T>()` state plus readonly `.asReadonly()` views and `computed()` derivations. No `BehaviorSubject`. RxJS only appears for narrow interop (e.g. `toObservable()` bridges).

Inbound `window.message` events go through the `MessageHandler` registration pattern: services declare `handledMessageTypes` and register via the `MESSAGE_HANDLERS` multi-provider token. `MessageRouterService` dispatches O(1) by type. **No global Observable bus** — this was an intentional choice to avoid the lazy-setter circular-DI crashes (NG0200) the codebase previously hit.

## Dependencies

**Internal**: `@ptah-extension/shared` (`MESSAGE_TYPES`, `ViewType`, `WebviewMessage`, payload types)

**External**: `@angular/core`, `rxjs` (interop only)

## Angular Conventions Observed

- `@Injectable({ providedIn: 'root' })` for app-wide singletons
- `inject()` exclusively, including `inject(MESSAGE_HANDLERS, { optional: true })` for the router
- Signal/`computed()` everywhere; `.asReadonly()` on every public exposure
- `provideXxx()` factory functions (`provideVSCodeService`, `provideMessageRouter`) follow the standalone-providers pattern

## Guidelines

1. **Never use Angular Router.** Navigation goes through `WebviewNavigationService` → `AppStateManager.setCurrentView` → `@if` switching in `AppShellComponent`.
2. **Register message handlers via `MESSAGE_HANDLERS` multi-provider** — never subscribe to a `messages$` Observable (there isn't one).
3. **`MessageRouterService` must be provided once at root** via `provideMessageRouter()`. Without it, no inbound messages reach any handler.
4. **Signal-first.** New state must use signals; do not introduce `BehaviorSubject`.
5. **No HTTP.** All extension communication is `postMessage` + `MessageHandler` for inbound, `ClaudeRpcService.callExtension` for request/response.
6. **Cross-lib dependencies invert through tokens.** When a feature lib needs to provide functionality the core consumes, define an `InjectionToken` here (see `WORKSPACE_COORDINATOR`, `SESSION_DATA_PROVIDER`) and let the composition root bind it.
7. **Coverage floor** (`jest.config.ts`): statements 85%, branches 75%, functions 75%, lines 85%. These are minimums — do not lower without a follow-up task.
