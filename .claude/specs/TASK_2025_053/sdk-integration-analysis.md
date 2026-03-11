# SDK Integration Analysis - TASK_2025_053 Fixes

## Critical Issues Summary

### 1. Missing Facade Methods (CRITICAL - Breaks Components)

**Files Affected**: `chat.store.ts`

**Issue**:

- Original ChatStore exposed `queueOrAppendMessage()` and `moveQueueToInput()` as public methods
- Refactored facade removed these methods
- Components calling these will crash with `chatStore.queueOrAppendMessage is not a function`

**Fix**:

```typescript
// In chat.store.ts - ADD these facade methods:

/**
 * Queue or append message based on streaming state
 */
public queueOrAppendMessage(content: string): void {
  this.conversation.queueOrAppendMessage(content);
}

/**
 * Move queued content to input field
 */
public moveQueueToInput(): void {
  // Delegate to conversation service
  const queuedContent = this.conversation.queueRestoreSignal();
  if (queuedContent) {
    // Emit event or call VSCodeService to update input
    this.vscodeService.postMessage({
      type: 'restoreQueuedContent',
      content: queuedContent
    });
    this.conversation.clearQueuedContent();
  }
}
```

**Also Required**: Make `ConversationService.queueOrAppendMessage()` public (currently private at line 128)

---

### 2. Type Casting Violations (BLOCKING - Type Safety)

#### Issue 2a: conversation.service.ts:298

**Current Code**:

```typescript
sessionId: null as any,  // ❌ Type assertion bypassing branded type system
```

**Problem**: `createExecutionChatMessage` expects `SessionId` (branded type), forcing `null` through breaks type safety

**Fix Options**:

**Option A: Make sessionId optional in createExecutionChatMessage**

```typescript
// In shared types:
export function createExecutionChatMessage(params: {
  content: string;
  executionTree: ExecutionNode | null;
  sessionId?: SessionId | null; // Make optional
  timestamp?: Date;
}): ChatMessage {
  return {
    id: generateMessageId(),
    sessionId: params.sessionId ?? ('' as SessionId), // Default to empty branded string
    // ...
  };
}
```

**Option B: Use empty SessionId instead of null**

```typescript
// In conversation.service.ts:
sessionId: '' as SessionId,  // Empty branded string (valid)
```

**Recommendation**: **Option B** - simpler, no shared type changes needed

#### Issue 2b: permission-handler.service.ts:178

**Current Code**:

```typescript
const vscodeService = this.vscodeService as any; // ❌ Access private API
vscodeService.vscode.postMessage({
  // Couples to internal implementation
  type: 'chat:permission-response',
  response,
});
```

**Problem**: Type assertion to access private `vscode` property. If VSCodeService refactors, breaks silently.

**Fix**: Use public VSCodeService API

```typescript
// Use public postMessage method (assuming it exists):
this.vscodeService.postMessage({
  type: 'chat:permission-response',
  response,
});
```

**Verification Required**: Check if `VSCodeService.postMessage()` is public. If not, add it.

---

### 3. SDK Queue Workflow Integration (INVESTIGATE)

#### Current Queue Logic

**ConversationService** has queue logic (lines 128-145):

- `queueOrAppendMessage(content)` - stores content if streaming
- Uses `_queuedMessages` signal

**SDK Capabilities (from claude-agent-sdk.md)**:

##### Streaming Input Mode (AsyncIterable Pattern)

```typescript
// SDK supports: prompt: string | AsyncIterable<SDKUserMessage>
async function* generateMessages() {
  yield { type: 'user', message: { role: 'user', content: 'First message' } };
  // User sends another message while streaming
  yield { type: 'user', message: { role: 'user', content: 'Second message' } };
}

const result = query({
  prompt: generateMessages(),
  options: {
    /* ... */
  },
});
```

**Key SDK Features**:

- `interrupt()` - stops current query (line 133) - **only in streaming input mode**
- `setPermissionMode()`, `setModel()` - runtime config changes
- AsyncIterable allows sending messages **during** agent execution

#### Integration Strategy

**Question**: Are we using SDK or CLI?

**Case 1: Using SDK (SdkAgentAdapter)**

- **Queue is OBSOLETE**: Use AsyncIterable pattern
- Instead of queueing, yield new messages to the async generator
- Use `query.interrupt()` to stop
- NO need for local queue state

**Case 2: Using CLI (ClaudeProcess)**

- **Keep current queue logic**: CLI uses stdin/stdout, can't send mid-execution
- Messages must be queued until current response completes
- Current implementation is correct for CLI

**Case 3: Hybrid (Both CLI and SDK)**

- **Conditional logic**: Check if using SDK adapter
- If SDK: use AsyncIterable
- If CLI: use queue

**Recommendation**: **Investigate current integration state** (check if TASK_2025_044 completed SDK integration)

#### Code Location to Check

```typescript
// Check: Do we have SdkAgentAdapter?
// File: libs/backend/ai-providers-core/src/lib/sdk-agent-adapter.ts

// Check: Is ChatStore using SDK or CLI?
// File: libs/frontend/chat/src/lib/services/chat.store.ts
// Look for: ClaudeRpcService calls - which backend are they hitting?
```

---

### 4. SDK Permission Integration (CRITICAL)

#### Current Permission Flow

1. Backend sends `chat:permission-request` event
2. `PermissionHandlerService.handlePermissionRequest()` adds to pending list
3. User clicks Allow/Deny in UI
4. `PermissionHandlerService.handlePermissionResponse()` sends response to backend via VSCodeService

**SDK Permission API (from claude-agent-sdk.md)**:

##### canUseTool Callback (Lines 81, 276-307)

```typescript
type CanUseTool = (toolName: string, input: ToolInput, options: { signal: AbortSignal; suggestions?: PermissionUpdate[] }) => Promise<PermissionResult>;

type PermissionResult = { behavior: 'allow'; updatedInput: ToolInput; updatedPermissions?: PermissionUpdate[] } | { behavior: 'deny'; message: string; interrupt?: boolean };
```

**SDK Integration Pattern**:

```typescript
// In SDK options:
const result = query({
  prompt: 'Do something',
  options: {
    permissionMode: 'default',
    canUseTool: async (toolName, input, { signal, suggestions }) => {
      // OPTION A: Auto-approve based on rules
      if (toolName === 'Read') {
        return { behavior: 'allow', updatedInput: input };
      }

      // OPTION B: Show UI and wait for user response
      const userDecision = await showPermissionDialog(toolName, input);
      if (userDecision.approved) {
        return { behavior: 'allow', updatedInput: input };
      } else {
        return { behavior: 'deny', message: 'User denied permission' };
      }
    },
  },
});
```

**PermissionRequest Hook (Lines 714-720)**:

```typescript
// Alternative: Use hook instead of canUseTool
hooks: {
  PermissionRequest: [
    {
      hooks: [
        async (input, toolUseID, { signal }) => {
          return {
            decision: {
              behavior: 'allow',
              updatedInput: input.tool_input,
            },
          };
        },
      ],
    },
  ];
}
```

#### Integration Decision

**Question**: Should we use SDK permissions or keep CLI-based permission flow?

**Option A: Use SDK canUseTool (Recommended if using SDK)**

- Remove PermissionHandlerService VSCodeService type assertion
- Implement canUseTool callback in backend
- UI shows permission requests via callback return

**Option B: Keep CLI-based permissions (If using CLI)**

- Fix VSCodeService type assertion by adding public API
- Keep current flow

**Option C: Hybrid**

- If SDK: use canUseTool
- If CLI: use current flow

**Action Required**: Check TASK_2025_044 status to determine if SDK is active

---

### 5. Performance Issues (SERIOUS)

#### Issue 5a: Computed Signal Recreates Map Every Access

**File**: `permission-handler.service.ts:58-69`

**Current Code**:

```typescript
readonly permissionRequestsByToolId = computed(() => {
  const requests = this._permissionRequests();
  const map = new Map<string, PermissionRequest>();  // ❌ New Map every read!
  requests.forEach((req) => {
    if (req.toolUseId) {
      map.set(req.toolUseId, req);
    }
  });
  return map;  // ❌ New reference breaks equality
});
```

**Problem**:

- Computed creates new Map on **every access**, not just when dependencies change
- O(n) cost per access instead of O(1) lookup
- Breaks OnPush change detection (always new reference)

**Fix**: Use memoization or convert to method

```typescript
// Option A: Memoize with effect
private _permissionsByToolIdCache = new Map<string, PermissionRequest>();

constructor() {
  // Update cache when permissions change
  effect(() => {
    const requests = this._permissionRequests();
    this._permissionsByToolIdCache.clear();
    requests.forEach((req) => {
      if (req.toolUseId) {
        this._permissionsByToolIdCache.set(req.toolUseId, req);
      }
    });
  });
}

readonly permissionRequestsByToolId = computed(() => this._permissionsByToolIdCache);

// Option B: Convert to method (simpler)
public getPermissionByToolId(toolId: string): PermissionRequest | undefined {
  return this._permissionRequests().find(req => req.toolUseId === toolId);
}
```

**Recommendation**: **Option B** - simpler, no effect needed

#### Issue 5b: Recursive Tree Traversal Every Read

**File**: `permission-handler.service.ts:81-114`

**Current Code**: Recursively walks entire execution tree on every computed read

**Fix**: Cache the Set

```typescript
// Similar to 5a - use effect to update cache
private _toolIdsCache = new Set<string>();

constructor() {
  effect(() => {
    const activeTab = this.tabManager.activeTab();
    const messages = activeTab?.messages ?? [];

    this._toolIdsCache.clear();
    messages.forEach(msg => {
      if (msg.executionTree) {
        this.extractToolIds(msg.executionTree, this._toolIdsCache);
      }
    });
  });
}

private extractToolIds(node: ExecutionNode, set: Set<string>): void {
  if (node.toolCallId) set.add(node.toolCallId);
  node.children?.forEach(child => this.extractToolIds(child, set));
}

readonly toolIdsInExecutionTree = computed(() => this._toolIdsCache);
```

---

## Fix Implementation Plan

### Phase 1: Critical Backward Compatibility (Must Fix)

1. ✅ Add `queueOrAppendMessage()` facade method to ChatStore
2. ✅ Add `moveQueueToInput()` facade method to ChatStore
3. ✅ Make `ConversationService.queueOrAppendMessage()` public
4. ✅ Test that components no longer crash

### Phase 2: Type Safety (Blocking)

1. ✅ Remove `as any` from conversation.service.ts:298 (use `'' as SessionId`)
2. ✅ Remove `as any` from permission-handler.service.ts:178 (use public API)
3. ✅ Verify VSCodeService has public `postMessage()` method
4. ✅ Type-check passes

### Phase 3: SDK Integration Investigation (Required for long-term)

1. 🔍 Check if TASK_2025_044 completed (SDK integration status)
2. 🔍 Determine if using SDK, CLI, or hybrid
3. 🔍 Document findings in integration-decision.md
4. 📋 Create follow-up task if SDK queue/permission migration needed

### Phase 4: Performance Optimization (Serious but not blocking)

1. ✅ Fix computed signal Map recreation (use method or effect cache)
2. ✅ Fix recursive tree traversal (cache Set)
3. ✅ Test performance with large permission/message sets

---

## Testing Strategy

### Unit Tests

- Test `queueOrAppendMessage()` facade delegates correctly
- Test `moveQueueToInput()` emits correct event
- Test permission methods without type assertions

### Integration Tests

- Load chat UI, send message while streaming → verify queue works
- Trigger permission request → verify UI shows → click Allow → verify response sent
- Switch tabs rapidly → verify session IDs resolve correctly

### Performance Tests

- Add 100 permissions → measure `permissionRequestsByToolId` access time
- Add 50 messages with deep trees → measure `unmatchedPermissions` compute time

---

## Open Questions

1. **SDK Integration Status**: Is TASK_2025_044 complete? Are we using SDK or CLI?
2. **VSCodeService API**: Does `postMessage()` exist as public method?
3. **Queue Workflow**: Should we migrate to AsyncIterable pattern for SDK, or keep CLI queue?
4. **Permission Workflow**: Should we use SDK `canUseTool` callback, or keep CLI event-based flow?

---

## Files to Modify

| File                                                                           | Changes                              | Priority |
| ------------------------------------------------------------------------------ | ------------------------------------ | -------- |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                            | Add facade methods                   | CRITICAL |
| `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`       | Remove `as any`, make methods public | CRITICAL |
| `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` | Remove `as any`, fix performance     | CRITICAL |
| `libs/frontend/core/src/lib/services/vscode.service.ts`                        | Verify/add public postMessage        | CRITICAL |

---

## Estimated Fix Effort

- **Phase 1 (Backward Compatibility)**: 1 hour
- **Phase 2 (Type Safety)**: 2 hours
- **Phase 3 (SDK Investigation)**: 3 hours (research + documentation)
- **Phase 4 (Performance)**: 2 hours
- **Testing**: 2 hours

**Total**: 10 hours (2 hours for immediate fixes, 8 hours for complete resolution)

**Recommendation**: Fix Phases 1-2 immediately (CRITICAL), defer Phases 3-4 to follow-up task if needed.
