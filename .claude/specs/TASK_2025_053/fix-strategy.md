# TASK_2025_053 Fix Strategy - Systematic Issue Resolution

## Executive Summary

**Status**: TASK_2025_044 (SDK Integration) is **📋 Planned** (not completed)
**Current Mode**: **CLI-only** (ClaudeProcess via RPC)
**Fix Scope**: Address CRITICAL and BLOCKING issues found by reviewers

---

## Critical Findings

### 1. SDK Integration Status ✅ CONFIRMED

- TASK_2025_044 status: **📋 Planned** (not started)
- Current implementation: **CLI-based** (ClaudeProcess + RPC)
- Queue workflow: **CLI queue is CORRECT** (keep current logic)
- Permission workflow: **CLI events are CORRECT** (keep current flow)

**Action**: NO SDK migration needed for this task. Fix current CLI-based implementation.

---

### 2. VSCodeService API Gap ⚠️ MISSING PUBLIC API

**Problem**: VSCodeService has NO public `postMessage()` method

**Current Workaround** (used by TWO services):

- ClaudeRpcService (line 136): `(this.vscode as any).vscode.postMessage()`
- PermissionHandlerService (line 178): `(this.vscodeService as any).vscode.postMessage()`

**Impact**: Type safety bypass, tight coupling to private implementation

**Fix**: Add public postMessage() to VSCodeService, update both consumers

---

## Fix Plan - 4 Phases

### Phase 1: Add Public VSCodeService API (FOUNDATION)

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

**Add after line 155** (after `getPtahIconUri()`):

```typescript
/**
 * Send message to VS Code extension host
 * Public wrapper for vscode.postMessage() to avoid type assertions
 */
public postMessage(message: unknown): void {
  if (this.vscode) {
    this.vscode.postMessage(message);
  } else {
    console.warn('[VSCodeService] postMessage called but VS Code API not available');
  }
}
```

**Benefits**:

- ✅ Removes need for `as any` type assertions
- ✅ Centralizes null checking
- ✅ Adds logging for development mode
- ✅ Encapsulates private vscode API

---

### Phase 2: Fix Missing ChatStore Facade Methods (CRITICAL)

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Problem**: Components calling `chatStore.queueOrAppendMessage()` will crash

**Fix 2a**: Add facade delegation methods (after existing methods, ~line 400)

```typescript
/**
 * Queue or append message based on streaming state
 * Facade delegation to ConversationService
 */
public queueOrAppendMessage(content: string): void {
  this.conversation.queueOrAppendMessage(content);
}

/**
 * Move queued content to input field
 * Facade delegation to ConversationService
 */
public moveQueueToInput(): void {
  const queuedContent = this.conversation.queueRestoreSignal();
  if (queuedContent) {
    // Emit restore event to input component
    this.vscodeService.postMessage({
      type: 'chat:restore-input',
      content: queuedContent
    });
    // Clear queue after restoring
    this.conversation.clearQueuedContent();
  }
}
```

**Fix 2b**: Make ConversationService methods public

**File**: `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`

**Line 128**: Change from `private` to `public`

```typescript
// Before:
private queueOrAppendMessage(content: string): void {

// After:
public queueOrAppendMessage(content: string): void {
```

**Line ~370**: Add new public method for clearing queue

```typescript
/**
 * Clear queued content
 */
public clearQueuedContent(): void {
  // Implementation here - clear the queue signal
}
```

---

### Phase 3: Remove Type Assertions (BLOCKING)

#### Fix 3a: conversation.service.ts Line 298

**Current**:

```typescript
sessionId: null as any,  // ❌ Type assertion bypassing branded type system
```

**Fix**:

```typescript
sessionId: '' as SessionId,  // ✅ Empty branded string (valid)
```

**Rationale**: SessionId is a branded type (`string & { __brand: 'SessionId' }`). Empty string `''` can be branded, `null` cannot.

#### Fix 3b: permission-handler.service.ts Line 178

**Current**:

```typescript
// HACK: Access private vscodeService.vscode (same pattern as ClaudeRpcService)
const vscodeService = this.vscodeService as any;
vscodeService.vscode.postMessage({
  type: 'chat:permission-response',
  response,
});
```

**Fix** (use new public API from Phase 1):

```typescript
// Use public VSCodeService.postMessage() API
this.vscodeService.postMessage({
  type: 'chat:permission-response',
  response,
});
```

**Delete lines 176-188**, replace with simple delegation.

---

### Phase 4: Fix Performance Issues (SERIOUS)

#### Fix 4a: permission-handler.service.ts Computed Signal Recreation

**Problem**: `permissionRequestsByToolId` creates new Map on every access

**Current** (lines 58-69):

```typescript
readonly permissionRequestsByToolId = computed(() => {
  const requests = this._permissionRequests();
  const map = new Map<string, PermissionRequest>();  // ❌ New Map every read!
  requests.forEach((req) => {
    if (req.toolUseId) {
      map.set(req.toolUseId, req);
    }
  });
  return map;  // ❌ Breaks equality checks
});
```

**Fix Option A** (Simple - convert to method):

```typescript
/**
 * Get permission by tool ID
 * Replaced computed signal with method to avoid Map recreation
 */
public getPermissionByToolId(toolId: string): PermissionRequest | undefined {
  return this._permissionRequests().find(req => req.toolUseId === toolId);
}
```

**Update consumers**: Replace `permissionRequestsByToolId().get(id)` with `getPermissionByToolId(id)`

**Fix Option B** (Advanced - cache with effect):

```typescript
// Add private cache property (after line 23)
private _permissionsByToolIdCache = new Map<string, PermissionRequest>();

// Add effect in constructor (after line 25)
constructor() {
  super();

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

// Replace computed signal (lines 58-69)
readonly permissionRequestsByToolId = computed(() => this._permissionsByToolIdCache);
```

**Recommendation**: **Option A** (simpler, fewer moving parts)

#### Fix 4b: permission-handler.service.ts Recursive Tree Traversal

**Problem**: `toolIdsInExecutionTree` walks entire tree on every read

**Current** (lines 81-114): Recursive traversal in computed signal

**Fix** (cache with effect):

```typescript
// Add private cache property (after _permissionsByToolIdCache)
private _toolIdsCache = new Set<string>();

// Add to effect in constructor (merge with 4a effect)
constructor() {
  super();

  // Combined effect for both caches
  effect(() => {
    // Update permissions Map cache
    const requests = this._permissionRequests();
    this._permissionsByToolIdCache.clear();
    requests.forEach((req) => {
      if (req.toolUseId) {
        this._permissionsByToolIdCache.set(req.toolUseId, req);
      }
    });

    // Update tool IDs Set cache
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

// Add helper method
private extractToolIds(node: ExecutionNode, set: Set<string>): void {
  if (node.toolCallId) {
    set.add(node.toolCallId);
  }
  node.children?.forEach(child => this.extractToolIds(child, set));
}

// Replace computed signal (lines 81-114)
readonly toolIdsInExecutionTree = computed(() => this._toolIdsCache);
```

---

## Implementation Order (Sequential)

1. ✅ **Phase 1**: Add VSCodeService.postMessage() (FOUNDATION - unlocks Phase 3b)
2. ✅ **Phase 2**: Add ChatStore facade methods (CRITICAL - prevents crashes)
3. ✅ **Phase 3a**: Fix conversation.service.ts type assertion
4. ✅ **Phase 3b**: Fix permission-handler.service.ts type assertion (uses Phase 1)
5. ✅ **Phase 4a**: Fix computed signal Map recreation
6. ✅ **Phase 4b**: Fix recursive tree traversal
7. ✅ **Verify**: Type-check + lint pass

---

## Testing Checklist

### Unit Tests

- [ ] VSCodeService.postMessage() sends message when connected
- [ ] VSCodeService.postMessage() logs warning when not connected
- [ ] ChatStore.queueOrAppendMessage() delegates to ConversationService
- [ ] ChatStore.moveQueueToInput() emits correct message
- [ ] PermissionHandlerService.getPermissionByToolId() returns correct permission

### Integration Tests

- [ ] Send message while streaming → verify queued
- [ ] Stop streaming → verify queue restored to input
- [ ] Permission request → click Allow → verify backend receives response
- [ ] Switch tabs rapidly → verify session IDs resolve correctly

### Performance Tests

- [ ] Add 100 permissions → measure getPermissionByToolId() speed (should be O(n) find, not O(n) map creation)
- [ ] Add 50 messages with deep trees → measure unmatchedPermissions compute time (should use cache)

---

## Files to Modify

| #   | File                                                                           | Lines       | Change                              | Priority |
| --- | ------------------------------------------------------------------------------ | ----------- | ----------------------------------- | -------- |
| 1   | `libs/frontend/core/src/lib/services/vscode.service.ts`                        | ~155        | Add public postMessage()            | CRITICAL |
| 2   | `libs/frontend/chat/src/lib/services/chat.store.ts`                            | ~400        | Add facade methods                  | CRITICAL |
| 3   | `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`       | 128, 298    | Make public, fix type assertion     | CRITICAL |
| 4   | `libs/frontend/chat/src/lib/services/chat-store/permission-handler.service.ts` | 58-114, 178 | Fix performance, fix type assertion | CRITICAL |

**Optional** (if time permits):
| # | File | Lines | Change | Priority |
|---|------|-------|--------|----------|
| 5 | `libs/frontend/core/src/lib/services/claude-rpc.service.ts` | 136 | Use VSCodeService.postMessage() | NICE-TO-HAVE |

---

## Estimated Effort

- Phase 1: 15 minutes (add method + test)
- Phase 2: 30 minutes (add facades + make methods public)
- Phase 3: 20 minutes (remove 2 type assertions)
- Phase 4: 45 minutes (performance fixes + testing)
- Verification: 30 minutes (type-check, lint, manual test)

**Total**: 2.5 hours for complete fix

---

## Success Criteria

✅ **Type-check passes** (0 errors)
✅ **Lint passes** (0 errors, pre-existing warnings acceptable)
✅ **No `as any` type assertions** in modified files
✅ **All facade methods** present in ChatStore
✅ **Performance** optimized (no Map/Set recreation in computed signals)
✅ **Manual test** confirms queue and permissions work

---

## Post-Fix Documentation

After all fixes complete, update these files:

1. **code-style-review.md**: Add "RESOLVED" notes to each issue
2. **code-logic-review.md**: Add "RESOLVED" notes to each issue
3. **tasks.md**: Mark all tasks ✅ COMPLETE
4. **registry.md**: Update TASK_2025_053 status to ✅ Complete

---

## Future Work (Not in Scope)

**Defer to TASK_2025_044 (SDK Integration):**

- Migrate queue workflow to AsyncIterable pattern
- Migrate permissions to SDK canUseTool callback
- Remove CLI-based RPC permission events

**Technical Debt**:

- Shared mutable state (ConversationService mutates SessionLoaderService Map)
- Callback pattern indirection (3-level dependency chain)
- Memory leak potential (failed sessions not cleaned from Map)

These are **SERIOUS** but not **BLOCKING** - can be addressed in follow-up tasks.
