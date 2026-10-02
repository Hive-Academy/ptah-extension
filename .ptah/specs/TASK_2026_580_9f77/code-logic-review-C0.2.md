VERDICT: APPROVED

Score: 10/10

Counts:

- Blocking: 0
- Serious: 0
- Moderate: 0
- Minor: 0

---

### Scope & Review Context

Batch C0.2 implements the frontend capture and bridge wiring for sessions started from the Tasks board, as well as handling organization change push notifications (TASK_2026_580, AC2/AC8):

Reviewed files:

1. `libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts` (NEW)
2. `libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.spec.ts` (NEW)
3. `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts` (MODIFIED)
4. `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts` (MODIFIED)
5. `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts` (MODIFIED)
6. `libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts` (MODIFIED)

---

### Verification Summary

1. **Test Suites**:
   - `npx nx test chat`:
     - 110 passed suites out of 110 (1682 passed tests, 2 skipped).
     - `board-task-link-capture.service.spec.ts`: PASSED (5 tests).
     - `task-prompt-bridge.service.spec.ts`: PASSED (9 tests).
     - `chat-message-handler.service.spec.ts`: PASSED (all tests, including all 4 new organization specs).
2. **Typecheck & Lint**:
   - `npx nx run-many -t typecheck,lint -p @ptah-extension/chat`: PASSED (2/2 tasks succeeded).
3. **Prettier Formatting**:
   - `npx prettier --check` on all 6 batch files: PASSED clean.

---

### Detailed Code-Logic Analysis

#### 1. Tab-to-Task Map Lifecycle & Bounded Eviction

- **Service Registration & Structure** ([`board-task-link-capture.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts#L20-L28)):
  - `@Injectable({ providedIn: 'root' })` adheres to Angular 22 standalone standards.
  - `pending = new Map<string, string>()` leverages JavaScript `Map`'s standard FIFO insertion order.
  - `static readonly MAX_PENDING = 20`.
- **Eviction Invariant** ([`board-task-link-capture.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts#L30-L39)):
  - In `expect(tabId, taskId)`: re-registering an existing `tabId` deletes before setting, updating its position to newest.
  - While `this.pending.size > MAX_PENDING`, the oldest entry is popped via `this.pending.keys().next().value` and deleted.
  - Proven in unit test `evicts the oldest pending entry beyond the cap of 20` ([`board-task-link-capture.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.spec.ts#L60-L74)).

#### 2. Exactly-Once Consumption & RPC Call Guarantees

- **Consumption Sequence** ([`board-task-link-capture.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts#L49-L59)):
  - In `onSessionIdResolved(tabId, realSessionId)`:
    - Entry lookup: `const taskId = this.pending.get(tabId)`. If `undefined`, returns immediately.
    - Synchronous deletion: `this.pending.delete(tabId)` occurs **before** `await this.rpc.call(...)`.
    - This eliminates any double-spend window.
  - RPC payload strictly conforms to the shared contract:
    - Method: `'session:linkTask'`
    - Payload: `{ sessionId: realSessionId, taskId, role: 'primary', source: 'board-start' }`
- **Error Handling, Refusal & Swallowing** ([`board-task-link-capture.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.ts#L60-L81)):
  - No retries and no timers exist anywhere in the service (adheres to plan lane L10).
  - Handles transport error (`!result.success`), RPC refusal (`result.data && !result.data.ok`, e.g., `organization-unavailable` in VS Code), and synchronous/asynchronous throws (`catch (error: unknown)`).
  - All errors log via `console.warn('[BoardTaskLinkCapture] ...')` and are cleanly swallowed without rethrowing.
  - Verified in `logs a refused link (ok:false) and does not retry` and `logs an RPC error result and a thrown call without rethrowing` ([`board-task-link-capture.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.spec.ts#L76-L121)).

#### 3. Task Prompt Bridge Integration

- **Invocation & ID Consistency** ([`task-prompt-bridge.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts#L56-L61)):
  - Calls `const tabId = this.tabManager.createTab(name)`.
  - Condition: `if (request.taskId)` ensures `expect()` is called **only** when `taskId` is populated on the request.
  - Passes the identical `tabId` returned by `createTab` alongside `request.taskId`.
  - Registration happens synchronously prior to `appState.setCurrentView('chat')` and `appState.requestComposerPrefill(...)`.
  - Verified by `registers the created tab with the board-task link capture when the request carries a taskId` and `does not register a link capture when the request has no taskId` ([`task-prompt-bridge.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts#L155-L177)).

#### 4. Chat Message Handler Ordering & Workflow Surface Claims

- **Claimed Workflow Surface Exclusion** ([`chat-message-handler.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts#L595-L610)):
  - `const claimedSurface = this.renderedSurfaceFor(tabId)`. If present, router updates surface conversation and returns early.
  - Board task link capture is skipped for claimed surfaces. This is correct: claimed surfaces represent subagents or inline workflow surfaces claimed via correlation ID, not user tabs created from the Tasks board.
  - Unit tested in `does not hand a claimed-surface resolve to the link capture` ([`chat-message-handler.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts#L744-L756)).
- **Execution Ordering** ([`chat-message-handler.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts#L611-L620)):
  - `this.chatStore.handleSessionIdResolved(...)` is invoked FIRST.
  - `void this.boardTaskLinkCapture.onSessionIdResolved(tabId, realSessionId)` is invoked SECOND (guarded with `if (tabId)`).
  - Explicitly verified in test via `invocationCallOrder`: `chatStore.handleSessionIdResolved` call order is strictly less than `linkCapture.onSessionIdResolved` call order ([`chat-message-handler.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts#L737-L741)).

#### 5. Race Condition Handling

- **ID resolves before `expect()`**:
  - `expect()` is executed synchronously in `TaskPromptBridgeService.consume()` immediately after `tabManager.createTab()`, before composer prefill or user send. An SDK session resolution can only happen after the first prompt dispatch reaches backend. Thus `expect()` is always registered before resolution.
- **Tab closed before resolve**:
  - If a user closes the tab or never sends a message, no `session:id-resolved` is emitted. The pending entry safely remains in memory until evicted when more than 20 new entries arrive. Memory consumption is strictly bounded (`MAX_PENDING = 20`, ~1 KB max).
- **Two resolves for one tab**:
  - Deleting `tabId` from `pending` before `await this.rpc.call` guarantees that a duplicate `session:id-resolved` event immediately encounters `taskId === undefined` and exits without executing a second RPC call. Verified in `links the resolved session to the expected task once...` ([`board-task-link-capture.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-store/board-task-link-capture.service.spec.ts#L39-L52)).

#### 6. Organization Change Push Routing & Debounce

- **Message Dispatch** ([`chat-message-handler.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts#L119,L166-L168)):
  - `MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED` is registered in `handledMessageTypes`.
  - Routed directly to `handleSessionMetadataChanged()` via switch fall-through:
    ```ts
    case MESSAGE_TYPES.SESSION_METADATA_CHANGED:
    case MESSAGE_TYPES.SESSION_ORGANIZATION_CHANGED:
      this.handleSessionMetadataChanged();
      break;
    ```
- **Debounce Invariant** ([`chat-message-handler.service.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.ts#L415-L428)):
  - Reuses the existing `_metadataChangedTimeout` and `METADATA_DEBOUNCE_MS = 250`.
  - Rapid succession of metadata and organization push events collapses into exactly one `chatStore.loadSessions()` execution 250 ms after the latest event.
- **Fake Timer Teardown Integrity** ([`chat-message-handler.service.spec.ts`](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/frontend/chat/src/lib/services/chat-message-handler.service.spec.ts#L764-L786)):
  - The spec testing this debounce cleanly wraps fake timers in `try { ... } finally { jest.useRealTimers(); }`, guaranteeing restoration of real timers.

---

### Finding Log

- **Blocking**: 0
- **Serious**: 0
- **Moderate**: 0
- **Minor**: 0

All requirements and quality constraints from TASK_2026_580 implementation plan sections 10, D11, and L10 are fully satisfied with clean test coverage and zero regressions.
