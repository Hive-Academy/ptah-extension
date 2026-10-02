VERDICT: APPROVED

Score: 10/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

### Scope & Review Context

Batch C2.1 implements the cross-library open-session signal bridge between `@ptah-extension/core` and `@ptah-extension/chat` (TASK_2026_580, plan component 12, lines 1067–1085):

1. **`AppStateManager` (`libs/frontend/core/src/lib/services/app-state.service.ts` + `.spec.ts`)**:
   - `SessionOpenRequest` interface (`readonly sessionId: SessionId; readonly name?: string;`).
   - Signal bridge `_sessionOpenRequest` (`signal<SessionOpenRequest | null>(null)`) and readonly public accessor `sessionOpenRequest`.
   - `requestOpenSession(request: { sessionId: string; name?: string })`: parses `sessionId` through `SessionId.safeParse`, silently dropping invalid session IDs; constructs a new `SessionOpenRequest` instance each call.
   - `clearSessionOpenRequest(request: SessionOpenRequest)`: identity-guarded (`=== request`), ensuring a newer in-flight request is never dropped by a lagging clear.
2. **`SessionOpenBridgeService` (`libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts` + `.spec.ts`)**:
   - Angular root-provided service (`providedIn: 'root'`).
   - Signal effect watching `appState.sessionOpenRequest()`.
   - Exactly-once consumption via `clearSessionOpenRequest` prior to routing, executed inside `untracked()`.
   - Surface switching: invokes `appState.setCurrentView('chat')`.
   - Layout-aware routing parity:
     - `grid` mode: delegates to `appState.requestCanvasSession(request.sessionId, request.name)`.
     - `single` mode: delegates to `SessionLoaderService.switchSession(request.sessionId)`.
   - Safe promise rejection containment: catches and logs rejections to prevent unhandled promise rejections on deleted or unloadable sessions.
3. **`ChatStore` (`libs/frontend/chat/src/lib/services/chat.store.ts`)**:
   - Eagerly injects `SessionOpenBridgeService` beside `TaskPromptBridgeService` to keep the signal effect active for the full application lifecycle without requiring callers to import `@ptah-extension/chat`.
4. **`libs/frontend/chat/src/lib/services/chat-store/index.ts`**:
   - Secondary entry-point export of `SessionOpenBridgeService`.

---

### Verification Summary

1. **Nx Target Verification**:
   - `npx nx run-many -t typecheck,test,lint -p @ptah-extension/core @ptah-extension/chat`: **PASSED** (6/6 tasks succeeded).
   - Zero lint errors, zero type errors, all unit test suites passed clean.
2. **Architecture & Standards Compliance**:
   - Standalone Angular 22 architecture; signal-bridge pattern adhering to NFR-11 / D7 (cross-library decoupling: `tasks-ui` does not import `chat`).
   - Strict typing with `SessionId` branded type validation; no `@ts-ignore` or `as any`.
   - Clean DI graph avoiding circular dependencies.

---

### Detailed Code-Logic Analysis

#### 1. Architectural Deviation: `SessionLoaderService.switchSession` vs `ChatStore.switchSession`

- **Background**: The implementation plan originally noted `single → chatStore.switchSession`. In C2.1, `SessionOpenBridgeService` directly invokes `this.sessionLoader.switchSession(request.sessionId)`.
- **Cycle Prevention (NG0200)**: `ChatStore` eagerly injects `SessionOpenBridgeService` (`chat.store.ts:94`) to bind its effect at application startup. If `SessionOpenBridgeService` were to inject `ChatStore`, a hard dependency cycle (`ChatStore` <-> `SessionOpenBridgeService`) would occur, failing at runtime with Angular error `NG0200`.
- **Pass-through Equivalence**: In `chat.store.ts:218-223`:
  ```typescript
  async switchSession(
    sessionId: SessionId,
    opts?: { reason?: 'compaction'; activate?: boolean },
  ): Promise<void> {
    await this.sessionLoader.switchSession(sessionId, opts);
  }
  ```
  `ChatStore.switchSession` is a pure pass-through delegate to `SessionLoaderService.switchSession`. No store-level state, cache, signal, or side effect exists in `ChatStore.switchSession`.
- **Conclusion**: The deviation is functionally identical, architecturally necessary, well-documented in the service docstring (`session-open-bridge.service.ts:21-23`), and fully approved.

#### 2. Exactly-Once Request Handling & Signal Semantics

- **Clear-Before-Route**: In `SessionOpenBridgeService.consume` ([`session-open-bridge.service.ts:39`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts#L39)), `this.appState.clearSessionOpenRequest(request)` executes before any async operation or navigation.
- **Effect Re-run Immunity**: When `clearSessionOpenRequest` sets `_sessionOpenRequest` to `null`, the effect is notified of the update; on the subsequent run, `if (!request) return;` immediately exits.
- **Untracked Execution**: The entire call to `consume(request)` is wrapped in `untracked(() => this.consume(request))` ([`session-open-bridge.service.ts:34`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts#L34)). Consequently, reading `this.appState.layoutMode()` does not register as a tracked dependency in the effect. Subsequent layout mode switches will never re-trigger or replay a consumed request.
- **Identical Subsequent Requests**: `requestOpenSession` allocates a new object literal `{ sessionId, ...(request.name ? { name: request.name } : {}) }` on every call. Because signal equality defaults to referential comparison (`===`), successive calls for the same `sessionId` publish distinct object references, ensuring that reopening the same session twice reliably triggers the effect each time.
- **Race Condition Immunity**: `clearSessionOpenRequest` is identity-guarded (`if (this._sessionOpenRequest() === request)`). If a second request arrives while the first is being processed, the signal holds the newer instance, so clearing the older request will not discard the newer one. If multiple requests arrive synchronously before the microtask effect tick, the latest value naturally prevails.
- **Invalid ID Guarding**: `requestOpenSession` invokes `SessionId.safeParse(request.sessionId)` ([`app-state.service.ts:1331`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/core/src/lib/services/app-state.service.ts#L1331)). Malformed strings are safely dropped, preventing corrupt state from ever entering the bridge.

#### 3. Routing Parity with `AppShellComponent.onSessionClick`

- `AppShellComponent.onSessionClick` ([`app-shell.component.ts:621-627`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/components/templates/app-shell.component.ts#L621-L627)):
  ```typescript
  if (this.layoutMode() === 'grid') {
    this.appState.requestCanvasSession(session.id, session.name);
  } else {
    this.chatStore.switchSession(session.id);
  }
  ```
- `SessionOpenBridgeService.consume` ([`session-open-bridge.service.ts:40-46`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/session-open-bridge.service.ts#L40-L46)):
  - First navigates to the chat view (`this.appState.setCurrentView('chat')`).
  - In `grid` mode: delegates to `this.appState.requestCanvasSession(request.sessionId, request.name)`.
  - In `single` mode: delegates to `this.sessionLoader.switchSession(request.sessionId)`.
- Parity is exact in both layout branches, including preserving the optional session display name for canvas tile naming.

#### 4. Rejection Handling and Logging Conventions

- In `single` layout mode, `sessionLoader.switchSession(request.sessionId)` returns a Promise. If the session was deleted or cannot be loaded from the backend, `session:load` rejects.
- Because `consume()` is called from a synchronous signal effect, an uncaught promise rejection would result in an unhandled rejection in the browser runtime.
- The attached `.catch((error) => console.error(...))` safely catches this boundary and logs diagnostics without introducing any artificial retry or recovery state, fulfilling the plan requirement ("opening a deleted session → the existing `switchSession` error path", lines 1075–1077).
- In frontend webview services (`libs/frontend/chat`), `console.error` and `console.warn` are standard conventions (e.g. `BoardTaskLinkCaptureService`, `SessionLoaderService`, `ChatLifecycleService`). Frontend services do not use the backend's `IOutputChannel` platform port.

#### 5. Caller Verification & Completeness

- There are no callers of `requestOpenSession` in the current codebase.
- Batch C2.1 deliberately implements the core signal contract and chat bridge service.
- The designated caller is Batch C2.3 ("task detail sessions list (visual)"), which will wire the "Open session" action on `TaskDetailComponent` in `@ptah-extension/tasks-ui`.
- All newly added members are necessary prerequisites; no dead code exists beyond the pending wiring in C2.3.

#### 6. Specification Quality & Behavioral Assertions

- **`app-state.service.spec.ts`**:
  - Verifies publishing and identity-guarded clearing of `SessionOpenRequest`.
  - Verifies omission of optional `name`.
  - Verifies rejection and dropping of invalid IDs via `SessionId.safeParse`.
  - Verifies that clearing an older request preserves a newer pending request for the same session ID.
- **`session-open-bridge.service.spec.ts`**:
  - Tests single layout switching and grid layout canvas routing.
  - Tests exactly-once execution: verifies effect re-runs and post-consumption layout toggles do not reopen sessions.
  - Tests repeated requests for the same session ID to verify both trigger correctly.
  - Tests rejection handling when `switchSession` fails, verifying `console.error` capture and signal cleanup.

---

### Finding Log

- **Blocking**: 0
- **Serious**: 0
- **Moderate**: 0
- **Minor**: 0

Batch C2.1 is behaviourally correct, robustly guarded against reactive re-triggering and DI cycles, fully tested, and ready for commit.
