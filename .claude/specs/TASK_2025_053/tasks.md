# Development Tasks - TASK_2025_053

**Total Tasks**: 9 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- ✅ All services share type contracts from @ptah-extension/shared
- ✅ Signal-based state enables reactive cross-service communication
- ✅ Existing StreamingHandler and CompletionHandler provide working patterns

### Risks Identified

| Risk                                                                                     | Severity | Mitigation                                                         |
| ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| Callback pattern consistency (ConversationService needs callback like CompletionHandler) | LOW      | Add setContinueConversationCallback pattern to ConversationService |
| State access between services (Conversation reads SessionLoader state)                   | MEDIUM   | Use ChatStore facade to expose SessionLoader signals               |

### Edge Cases to Handle

- [x] Permission correlation requires TabManager access → Handled in Task 3.1 (inject TabManagerService)
- [x] Service initialization order → Handled via providedIn: 'root' + ChatStore coordination
- [x] Circular dependency prevention → Handled via callback pattern (Task 2.2)

---

## Batch 1: Session Loader Service ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None
**Commit**: 5764800

### Task 1.1: Create SessionLoaderService - Session List & Pagination ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.ts

**Spec Reference**: implementation-plan.md:11-21

**Pattern to Follow**: streaming-handler.service.ts (existing child service pattern)

**Quality Requirements**:

- Injectable with providedIn: 'root'
- Use signal-based state for reactivity (no RxJS BehaviorSubject)
- All signals exposed as readonly for public access
- Follow existing error handling patterns from chat.store.ts
- NO stubs, placeholders, or TODO comments

**Validation Notes**:

- Service owns `pendingSessionResolutions` Map (moved from ChatStore)
- Exposes readonly signals for other services to consume
- Handles null checks for VSCodeService

**Implementation Details**:

**State Signals** (private writeable, public readonly):

- `_sessions: signal<readonly ChatSessionSummary[]>([])`
- `_hasMoreSessions: signal(false)`
- `_totalSessions: signal(0)`
- `_sessionsOffset: signal(0)`
- `_isLoadingMoreSessions: signal(false)`
- `pendingSessionResolutions: Map<string, string>` (not a signal, plain Map)

**Dependencies to Inject**:

- `ClaudeRpcService` (for loadSessions RPC call)
- `VSCodeService` (for error notifications)
- `SessionReplayService` (for loading session details)
- `TabManagerService` (for tab management during session switch)
- `SessionManager` (for session state coordination)

**Methods to Extract from chat.store.ts**:

1. `async loadSessions(): Promise<void>` (lines 334-393)

   - Reset offset to 0
   - Call backend listSessions RPC
   - Update all session signals
   - Handle errors with VSCode notifications

2. `async loadMoreSessions(): Promise<void>` (lines 396-449)

   - Guard against concurrent loading
   - Fetch next page using current offset
   - Append to sessions array
   - Update pagination signals

3. `async switchSession(sessionId: string): Promise<void>` (lines 452-540)

   - Find target session
   - Load session details via SessionReplay
   - Update TabManager active tab
   - Handle errors

4. `handleSessionIdResolved(placeholderSessionId: string, actualSessionId: string): void` (lines 805-844)
   - Look up pending tab from Map
   - Update tab session ID
   - Clean up Map entry
   - Create new session entry in sessions list

**Key Imports**:

```typescript
import { Injectable, signal, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { ChatSessionSummary } from '@ptah-extension/shared';
import { SessionReplayService } from '../session-replay.service';
import { SessionManager } from '../session-manager.service';
import { TabManagerService } from '../tab-manager.service';
```

**Public API** (expose from ChatStore facade):

```typescript
readonly sessions: Signal<readonly ChatSessionSummary[]>
readonly hasMoreSessions: Signal<boolean>
readonly totalSessions: Signal<number>
readonly isLoadingMoreSessions: Signal<boolean>
```

---

### Task 1.2: Type-check SessionLoaderService ✅ COMPLETE

**File**: N/A (verification task)

**Dependencies**: Task 1.1

**Quality Requirements**:

- No TypeScript errors
- All imports resolve correctly
- Service compiles successfully

**Implementation Details**:

Run TypeScript compiler:

```bash
npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit
```

If errors found, fix before proceeding to Task 1.3.

---

**Batch 1 Verification**:

- SessionLoaderService exists at path
- TypeScript compilation passes
- All 4 methods implemented (loadSessions, loadMoreSessions, switchSession, handleSessionIdResolved)
- All 5 state signals + Map properly typed
- Ready for git commit

---

## Batch 2: Conversation Service ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 1 (needs SessionLoader signals)
**Commit**: 5256ece

### Task 2.1: Create ConversationService - New Conversation & Send Logic ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\conversation.service.ts

**Spec Reference**: implementation-plan.md:23-29

**Pattern to Follow**: streaming-handler.service.ts, completion-handler.service.ts

**Quality Requirements**:

- Injectable with providedIn: 'root'
- Stateless service (delegates to TabManager/SessionManager for state)
- Follow callback pattern for coordination with ChatStore
- NO stubs, placeholders, or TODO comments

**Validation Notes**:

- **RISK MITIGATION**: Apply callback pattern like CompletionHandlerService
- Service needs access to SessionLoader state via ChatStore facade
- Handles session queue logic for unsaved sessions

**Implementation Details**:

**Dependencies to Inject**:

- `ClaudeRpcService` (for startConversation/continueConversation RPC)
- `VSCodeService` (for notifications)
- `TabManagerService` (for tab state management)
- `SessionManager` (for session coordination)
- `SessionLoaderService` (for session state access)

**Methods to Extract from chat.store.ts**:

1. `async sendMessage(content: string, files?: string[]): Promise<void>` (lines 543-555)

   - Delegate to sendOrQueueMessage with active tab logic

2. `async sendOrQueueMessage(sessionId: string | null, content: string, files?: string[]): Promise<void>` (lines 557-574)

   - If sessionId exists → continueConversation
   - If no sessionId → startNewConversation

3. `async startNewConversation(content: string, files?: string[]): Promise<void>` (lines 576-702)

   - Create new tab
   - Call backend startConversation RPC
   - Set up pending session resolution
   - Handle placeholder session ID

4. `async continueConversation(content: string, files?: string[]): Promise<void>` (lines 704-803)

   - Guard against missing session ID
   - Add user message to tab
   - Call backend continueConversation RPC
   - Handle errors

5. `async abortCurrentMessage(): Promise<void>` (lines 1380-1408)
   - Get active session ID
   - Call backend abortRequest RPC
   - Update UI state

**Callback Pattern** (same as CompletionHandler):

```typescript
private _sendMessageCallback: ((content: string, files?: string[]) => Promise<void>) | null = null;

setSendMessageCallback(callback: (content: string, files?: string[]) => Promise<void>): void {
  this._sendMessageCallback = callback;
}
```

**Key Imports**:

```typescript
import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '../tab-manager.service';
import { SessionManager } from '../session-manager.service';
import { SessionLoaderService } from './session-loader.service';
```

---

### Task 2.2: Type-check ConversationService ✅ COMPLETE

**File**: N/A (verification task)

**Dependencies**: Task 2.1

**Quality Requirements**:

- No TypeScript errors
- All imports resolve correctly
- Service compiles successfully

**Implementation Details**:

Run TypeScript compiler:

```bash
npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit
```

If errors found, fix before proceeding to Batch 3.

---

**Batch 2 Verification**:

- ConversationService exists at path
- TypeScript compilation passes
- All 5 methods implemented (sendMessage, sendOrQueueMessage, startNewConversation, continueConversation, abortCurrentMessage)
- Callback pattern implemented
- Ready for git commit

---

## Batch 3: Permission Handler Service ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: None (independent service)
**Commit**: 23432de

### Task 3.1: Create PermissionHandlerService - Permission Management ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\permission-handler.service.ts

**Spec Reference**: implementation-plan.md:31-39

**Pattern to Follow**: streaming-handler.service.ts (signal-based state)

**Quality Requirements**:

- Injectable with providedIn: 'root'
- Use signal-based state + computed signals
- Expose readonly signals for public access
- NO stubs, placeholders, or TODO comments

**Validation Notes**:

- **EDGE CASE HANDLED**: Service needs TabManager access for permission correlation
- Computed signals for permission-tool correlation
- Handles unmatched permissions gracefully

**Implementation Details**:

**State Signals**:

- `_permissionRequests: signal<PermissionRequest[]>([])`

**Computed Signals**:

```typescript
readonly permissionRequestsByToolId = computed(() => {
  const requests = this._permissionRequests();
  const byToolId = new Map<string, PermissionRequest>();
  // Implementation from chat.store.ts lines 178-191
  return byToolId;
});

readonly unmatchedPermissions = computed(() => {
  const allPermissions = this._permissionRequests();
  const matchedIds = new Set(this.permissionRequestsByToolId().keys());
  // Implementation from chat.store.ts lines 265-281
  return unmatched;
});
```

**Dependencies to Inject**:

- `TabManagerService` (for accessing executionTree to correlate permissions with tools)

**Methods to Extract from chat.store.ts**:

1. `handlePermissionRequest(request: PermissionRequest): void` (lines 1335-1342)

   - Add permission to signal array
   - Immutable update pattern

2. `handlePermissionResponse(response: PermissionResponse): void` (lines 1344-1351)

   - Remove permission from signal array
   - Filter by request ID

3. `getPermissionForTool(toolCallId: string): PermissionRequest | null` (lines 195-232)
   - Look up permission by tool ID
   - Check computed signal
   - Return unmatched if no correlation found

**Key Imports**:

```typescript
import { Injectable, signal, computed, inject } from '@angular/core';
import { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';
import { TabManagerService } from '../tab-manager.service';
```

**Public API** (expose from ChatStore facade):

```typescript
readonly permissionRequests: Signal<PermissionRequest[]>
readonly permissionRequestsByToolId: Signal<Map<string, PermissionRequest>>
readonly unmatchedPermissions: Signal<PermissionRequest[]>
```

---

### Task 3.2: Type-check PermissionHandlerService ✅ COMPLETE

**File**: N/A (verification task)

**Dependencies**: Task 3.1

**Quality Requirements**:

- No TypeScript errors
- All imports resolve correctly
- Service compiles successfully

**Implementation Details**:

Run TypeScript compiler:

```bash
npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit
```

If errors found, fix before proceeding to Batch 4.

---

**Batch 3 Verification**:

- PermissionHandlerService exists at path
- TypeScript compilation passes
- All 3 methods implemented (handlePermissionRequest, handlePermissionResponse, getPermissionForTool)
- 2 computed signals implemented (permissionRequestsByToolId, unmatchedPermissions)
- Ready for git commit

---

## Batch 4: ChatStore Facade + Barrel Export ✅ COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batches 1, 2, 3 (all child services complete)
**Commit**: c65e54c

### Task 4.1: Refactor ChatStore to Facade Pattern ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts

**Spec Reference**: implementation-plan.md:45-51

**Pattern to Follow**: Keep existing public API, delegate to child services

**Quality Requirements**:

- **CRITICAL**: Maintain 100% backward compatibility (same public signals/methods)
- Reduce file from ~1537 lines to ~400 lines
- All inline implementations replaced with delegation
- NO stubs, placeholders, or TODO comments

**Validation Notes**:

- **RISK MITIGATION**: Use callback pattern for service coordination
- ChatStore remains single source of truth for public API
- All signals exposed through facade pattern

**Implementation Details**:

**New Service Injections** (add to existing):

```typescript
private readonly sessionLoader = inject(SessionLoaderService);
private readonly conversation = inject(ConversationService);
private readonly permissionHandler = inject(PermissionHandlerService);
```

**Remove State Signals** (move to child services):

- REMOVE: `_sessions`, `_hasMoreSessions`, `_totalSessions`, `_sessionsOffset`, `_isLoadingMoreSessions`
- REMOVE: `pendingSessionResolutions` Map
- REMOVE: `_permissionRequests`

**Expose Child Service Signals** (facade pattern):

```typescript
// Session signals (from SessionLoaderService)
readonly sessions = this.sessionLoader.sessions;
readonly hasMoreSessions = this.sessionLoader.hasMoreSessions;
readonly totalSessions = this.sessionLoader.totalSessions;
readonly isLoadingMoreSessions = this.sessionLoader.isLoadingMoreSessions;

// Permission signals (from PermissionHandlerService)
readonly permissionRequests = this.permissionHandler.permissionRequests;
readonly permissionRequestsByToolId = this.permissionHandler.permissionRequestsByToolId;
readonly unmatchedPermissions = this.permissionHandler.unmatchedPermissions;
```

**Update Computed Signals** (use child service signals):

```typescript
// Update getSessionById to use sessionLoader.sessions
readonly getSessionById = computed(() => {
  return (sessionId: string) => {
    return this.sessionLoader.sessions().find((s) => s.id === sessionId) ?? null;
  };
});

// Update hasExistingSession to use sessionLoader.sessions
readonly hasExistingSession = computed(() => {
  return this.sessionLoader.sessions().length > 0;
});

// Update permissionCheckResults to use permissionHandler
readonly permissionCheckResults = computed(() => {
  const messages = this.tabManager.activeMessages();
  const requests = this.permissionHandler.permissionRequests();
  // ... rest of logic
});
```

**Delegate Methods to Child Services**:

**Session Loader delegation**:

```typescript
async loadSessions(): Promise<void> {
  return this.sessionLoader.loadSessions();
}

async loadMoreSessions(): Promise<void> {
  return this.sessionLoader.loadMoreSessions();
}

async switchSession(sessionId: string): Promise<void> {
  return this.sessionLoader.switchSession(sessionId);
}

handleSessionIdResolved(placeholderSessionId: string, actualSessionId: string): void {
  return this.sessionLoader.handleSessionIdResolved(placeholderSessionId, actualSessionId);
}
```

**Conversation delegation**:

```typescript
async sendMessage(content: string, files?: string[]): Promise<void> {
  return this.conversation.sendMessage(content, files);
}

async startNewConversation(content: string, files?: string[]): Promise<void> {
  return this.conversation.startNewConversation(content, files);
}

async continueConversation(content: string, files?: string[]): Promise<void> {
  return this.conversation.continueConversation(content, files);
}

async abortCurrentMessage(): Promise<void> {
  return this.conversation.abortCurrentMessage();
}
```

**Permission Handler delegation**:

```typescript
handlePermissionRequest(request: PermissionRequest): void {
  return this.permissionHandler.handlePermissionRequest(request);
}

handlePermissionResponse(response: PermissionResponse): void {
  return this.permissionHandler.handlePermissionResponse(response);
}

getPermissionForTool(toolCallId: string): PermissionRequest | null {
  return this.permissionHandler.getPermissionForTool(toolCallId);
}
```

**Update initializeServices()** (add callback registrations):

```typescript
private async initializeServices(): Promise<void> {
  try {
    // Existing callback
    this.completionHandler.setContinueConversationCallback(
      this.continueConversation.bind(this)
    );

    // NEW: Register callback for ConversationService
    this.conversation.setSendMessageCallback(
      this.sendMessage.bind(this)
    );

    // ... rest of initialization
  }
}
```

**Expected Line Count**: ~400 lines (from current 1537)

**What Remains in ChatStore**:

- Service injections and initialization
- Facade methods (delegation only, no implementation)
- Signal exposure (readonly wrappers)
- Constructor and lifecycle hooks
- VSCodeService registration
- Comments and documentation

---

### Task 4.2: Create Barrel Export index.ts ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\index.ts

**Spec Reference**: implementation-plan.md:41-43

**Pattern to Follow**: Standard barrel export pattern

**Quality Requirements**:

- Export all child services for external use if needed
- Clean, simple re-exports
- NO stubs, placeholders, or TODO comments

**Implementation Details**:

```typescript
/**
 * ChatStore Child Services
 *
 * Extracted services following Facade pattern.
 * ChatStore delegates to these services for specialized responsibilities.
 */

export { StreamingHandlerService } from './streaming-handler.service';
export { CompletionHandlerService } from './completion-handler.service';
export { SessionLoaderService } from './session-loader.service';
export { ConversationService } from './conversation.service';
export { PermissionHandlerService } from './permission-handler.service';
```

---

### Task 4.3: Full Type-check and Lint ✅ COMPLETE

**File**: N/A (verification task)

**Dependencies**: Task 4.1, Task 4.2

**Quality Requirements**:

- No TypeScript errors across entire chat library
- No linting errors
- All imports resolve correctly
- Public API unchanged (backward compatible)

**Implementation Details**:

Run full verification:

```bash
# Type-check
npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit

# Lint
npx nx lint chat
```

If errors found, fix before marking batch complete.

**Verification Checklist**:

- [ ] ChatStore reduced from ~1537 to ~400 lines
- [ ] All public signals still exposed (backward compatible)
- [ ] All public methods still exist (delegation only)
- [ ] No direct state manipulation in ChatStore (all delegated)
- [ ] All child services properly imported
- [ ] index.ts barrel export exists
- [ ] TypeScript compilation passes
- [ ] Linting passes

---

**Batch 4 Verification**:

- ChatStore refactored to facade pattern (~400 lines)
- index.ts barrel export created
- TypeScript compilation passes
- Linting passes
- All 5 child services integrated (streaming, completion, session-loader, conversation, permission-handler)
- Backward compatibility maintained
- Ready for final git commit

---

## Summary

**Refactoring Strategy**: Layer-based extraction with incremental verification

**Batch Breakdown**:

1. **Batch 1** (2 tasks): SessionLoaderService - Session list, pagination, switching
2. **Batch 2** (2 tasks): ConversationService - New conversation, send logic, abort
3. **Batch 3** (2 tasks): PermissionHandlerService - Permission requests, correlation
4. **Batch 4** (3 tasks): ChatStore facade refactor + barrel export + full verification

**Why This Batching**:

- Each service can be independently developed and verified
- No cross-service dependencies until final integration (Batch 4)
- SessionLoader first (foundation for Conversation)
- Conversation second (uses SessionLoader state)
- PermissionHandler independent (parallel-safe)
- Final batch integrates all services into facade

**Expected Outcome**:

- ChatStore: 1537 lines → ~400 lines (74% reduction)
- 5 specialized child services (streaming, completion, session-loader, conversation, permission-handler)
- Maintained backward compatibility (same public API)
- Improved testability (each service independently testable)
- Clean separation of concerns following Facade pattern
