# TASK_2025_032: Session Isolation Bug Fix - Chat Messages Sent to All Tabs

## Task Context

**Created**: 2025-11-30
**Type**: BUGFIX
**Priority**: P0 (Critical)
**Branch**: `ak/fix-chat-streaming` (current)

## User Intent

User reported that when multiple chat sessions/tabs are open, the chat input appears to send messages to all tabs instead of being isolated to the specific session/tab. This indicates improper session isolation in the webview architecture.

## Root Cause Analysis

### The Problem Chain

```
Backend (Correct)
  └─ Wraps chunks with sessionId: { sessionId, message }
         ↓
VSCodeService (BUG)
  └─ Discards sessionId: const { message: jsonlMessage } = message.payload
         ↓
ChatStore (No Defense)
  └─ processJsonlChunk() has no sessionId parameter to validate
         ↓
Result: Chunks from Session A can update Tab B if user switches tabs mid-stream
```

### Affected Files

1. **VSCodeService** (`libs/frontend/core/src/lib/services/vscode.service.ts`)

   - Line ~180-195: `setupMessageListener()` discards sessionId from `chat:chunk` payload

2. **ChatStore** (`libs/frontend/chat/src/lib/services/chat.store.ts`)
   - `processJsonlChunk()` - No sessionId parameter
   - `handleChatComplete()` - Receives sessionId but doesn't validate
   - `handleChatError()` - Missing sessionId validation

### Vulnerable Scenario

```
t0: User has Tab A (Session A) active, sends message
t1: Session A process starts emitting chunks
t2: User clicks Tab B (Session B) before Session A finishes
t3: Session A chunk arrives
    - VSCodeService routes to ChatStore without sessionId
    - ChatStore updates active tab (B) instead of (A)
    - User sees Session A responses in Session B tab!
```

## Required Fixes

### Fix 1: VSCodeService - Propagate sessionId

```typescript
// Before:
if (message.type === 'chat:chunk') {
  const { message: jsonlMessage } = message.payload;
  this.chatStore.processJsonlChunk(jsonlMessage);
}

// After:
if (message.type === 'chat:chunk') {
  const { sessionId, message: jsonlMessage } = message.payload;
  this.chatStore.processJsonlChunk(jsonlMessage, sessionId);
}
```

### Fix 2: ChatStore - Validate sessionId in processJsonlChunk

```typescript
processJsonlChunk(chunk: JSONLMessage, fromSessionId?: string): void {
  const activeTab = this.tabManager.activeTab();

  // Validate chunk is for current session
  if (fromSessionId && activeTab?.claudeSessionId !== fromSessionId) {
    console.warn('[ChatStore] Ignoring chunk from different session');
    return;
  }
  // ... rest of processing
}
```

### Fix 3: ChatStore - Validate in handleChatComplete

```typescript
handleChatComplete(data: { sessionId: string; code: number }): void {
  const activeTab = this.tabManager.activeTab();

  if (activeTab?.claudeSessionId !== data.sessionId) {
    console.warn('[ChatStore] Ignoring completion from different session');
    return;
  }
  // ... rest of processing
}
```

### Fix 4: ChatStore - Validate in handleChatError (if exists)

Same pattern as handleChatComplete.

## Out of Scope

- Adding correlation IDs (P1 - future enhancement)
- Message sequence numbers (P2 - future enhancement)
- Tab state persistence validation (P2 - future enhancement)

## Success Criteria

1. Switching tabs mid-stream does NOT cause cross-session contamination
2. Each tab only receives chunks for its own session
3. chat:complete/chat:error only affect correct tab
4. Console warnings logged when chunks from wrong session are discarded
5. All existing chat functionality preserved

## Workflow

BUGFIX strategy: Team Leader → Frontend Developer → Senior Tester → Code Reviewers
