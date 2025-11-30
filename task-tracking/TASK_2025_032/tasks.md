# TASK_2025_032: Tasks Breakdown

## Status: DECOMPOSITION COMPLETE

**Total Tasks**: 4 | **Batches**: 1 (Sequential) | **Status**: 0/4 complete

---

## Batch 1: Session Isolation Bug Fix (Sequential Tasks) 🔄 IN PROGRESS

**Developer**: frontend-developer
**Tasks**: 4 | **Dependencies**: None (external)
**Strategy**: Sequential execution (each task depends on previous)

---

### Task 1.1: Add sessionId parameter to processJsonlChunk() in ChatStore

**Status**: 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts

**Description**: Add optional `fromSessionId` parameter to `processJsonlChunk()` method and implement session validation logic.

**Spec Reference**: context.md:71-83

**Implementation Details**:

- Add parameter: `processJsonlChunk(chunk: JSONLMessage, fromSessionId?: string): void`
- At start of method (after activeTabId check), add session validation:
  ```typescript
  // Validate chunk is for current session (prevent cross-tab contamination)
  if (fromSessionId && activeTab?.claudeSessionId !== fromSessionId) {
    console.warn('[ChatStore] Ignoring chunk from different session', {
      chunkSessionId: fromSessionId,
      activeTabSessionId: activeTab?.claudeSessionId,
    });
    return;
  }
  ```
- Current location: Line 728
- This is defensive validation - if sessionId doesn't match active tab, discard the chunk

**Acceptance Criteria**:

- [ ] `processJsonlChunk()` signature includes optional `fromSessionId?: string` parameter
- [ ] Session validation check added before processing logic
- [ ] Console warning logged with session IDs when chunks are discarded
- [ ] Method returns early when session mismatch detected
- [ ] No changes to existing chunk processing logic (only add validation guard)

---

### Task 1.2: Propagate sessionId in VSCodeService chat:chunk handler

**Status**: 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts

**Dependencies**: Task 1.1 (requires updated ChatStore signature)

**Description**: Extract `sessionId` from `chat:chunk` message payload and pass it to `ChatStore.processJsonlChunk()`.

**Spec Reference**: context.md:55-69

**Implementation Details**:

- Modify line 173-176 in `setupMessageListener()`:

  ```typescript
  // Before:
  if (message.type === 'chat:chunk') {
    if (message.payload && this.chatStore) {
      const { message: jsonlMessage } = message.payload;
      this.chatStore.processJsonlChunk(jsonlMessage);
    }
    // ... error handling
  }

  // After:
  if (message.type === 'chat:chunk') {
    if (message.payload && this.chatStore) {
      const { sessionId, message: jsonlMessage } = message.payload;
      this.chatStore.processJsonlChunk(jsonlMessage, sessionId);
    }
    // ... error handling
  }
  ```

- Extract both `sessionId` and `message` from payload
- Pass sessionId as second argument to processJsonlChunk

**Acceptance Criteria**:

- [ ] `sessionId` extracted from `message.payload` along with `jsonlMessage`
- [ ] `sessionId` passed as second argument to `ChatStore.processJsonlChunk()`
- [ ] No changes to error handling logic
- [ ] Existing console.warn messages preserved

---

### Task 1.3: Add sessionId validation to handleChatComplete() in ChatStore

**Status**: 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts

**Dependencies**: Task 1.1 (same pattern as processJsonlChunk)

**Description**: Add session validation to `handleChatComplete()` to prevent completion signals from wrong session affecting active tab.

**Spec Reference**: context.md:86-98

**Implementation Details**:

- Add validation after activeTab check (after line 895):
  ```typescript
  // Validate completion is for current session
  if (activeTab?.claudeSessionId !== data.sessionId) {
    console.warn('[ChatStore] Ignoring completion from different session', {
      completionSessionId: data.sessionId,
      activeTabSessionId: activeTab?.claudeSessionId,
    });
    return;
  }
  ```
- Current location: handleChatComplete() starts at line 886
- Add validation before status check (line 898)

**Acceptance Criteria**:

- [ ] Session validation added at start of `handleChatComplete()` (after activeTab check)
- [ ] Console warning logged with session IDs when completion signals are discarded
- [ ] Method returns early when session mismatch detected
- [ ] No changes to existing completion logic (only add validation guard)

---

### Task 1.4: Add sessionId validation to handleChatError() in ChatStore

**Status**: 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts

**Dependencies**: Task 1.1 (same pattern as processJsonlChunk)

**Description**: Add session validation to `handleChatError()` to prevent error signals from wrong session affecting active tab.

**Spec Reference**: context.md:100-102

**Implementation Details**:

- Add validation after activeTabId check (after line 929):

  ```typescript
  const activeTab = this.tabManager.activeTab();

  // Validate error is for current session
  if (activeTab?.claudeSessionId !== data.sessionId) {
    console.warn('[ChatStore] Ignoring error from different session', {
      errorSessionId: data.sessionId,
      activeTabSessionId: activeTab?.claudeSessionId,
    });
    return;
  }
  ```

- Current location: handleChatError() starts at line 923
- Add validation before status reset logic (line 933)

**Acceptance Criteria**:

- [ ] Session validation added at start of `handleChatError()` (after activeTabId check)
- [ ] `activeTab` retrieved via `this.tabManager.activeTab()` to get claudeSessionId
- [ ] Console warning logged with session IDs when error signals are discarded
- [ ] Method returns early when session mismatch detected
- [ ] No changes to existing error handling logic (only add validation guard)

---

## Batch 1 Verification Checklist

**Post-Implementation Checks**:

- [ ] All 4 tasks marked ✅ COMPLETE
- [ ] All files exist at paths
- [ ] Build passes: `npx nx build ptah-extension-webview`
- [ ] TypeScript compilation passes: `npx nx run frontend-chat:typecheck`
- [ ] No console errors on webview load
- [ ] Git commit created with all changes

**Functional Testing** (Manual - After Verification):

1. Open 2 chat tabs with different sessions
2. Send message in Tab A, immediately switch to Tab B before response completes
3. Verify Tab B does NOT show chunks from Tab A's session
4. Check console for "Ignoring chunk from different session" warnings
5. Verify Tab A shows correct response when switched back

---

## Task Dependencies Graph

```
Task 1.1: Add sessionId param to processJsonlChunk
    ↓
Task 1.2: Propagate sessionId in VSCodeService ← depends on 1.1 signature
    ↓
Task 1.3: Validate sessionId in handleChatComplete ← same pattern as 1.1
    ↓
Task 1.4: Validate sessionId in handleChatError ← same pattern as 1.1
```

---

## Success Criteria Summary

**From context.md lines 110-117**:

1. Switching tabs mid-stream does NOT cause cross-session contamination ✅
2. Each tab only receives chunks for its own session ✅
3. chat:complete/chat:error only affect correct tab ✅
4. Console warnings logged when chunks from wrong session are discarded ✅
5. All existing chat functionality preserved ✅

---

## Notes

- **Minimal Changes**: This is a BUGFIX - only add session validation guards, no refactoring
- **Defensive Validation**: All handlers check sessionId matches active tab before processing
- **Console Logging**: All discarded events logged with both session IDs for debugging
- **No Breaking Changes**: Optional parameter (fromSessionId?) maintains backward compatibility
- **Sequential Execution**: Task 1.2 MUST wait for Task 1.1 to complete (signature dependency)
