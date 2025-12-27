# TASK_2025_092: Session ID Resolution Fix

## Problem Summary

When resuming a Claude session, the SDK rejected the session ID with error:

```
Session IDs must be in UUID format...Provided value 'msg_1766852854855_77a495y' is not a valid UUID
```

### Root Cause Analysis

1. **Frontend generated placeholder IDs**: `ConversationService.generateId()` created `msg_${timestamp}_${random}` format
2. **Placeholder sent to backend**: `chat:start` RPC included this placeholder as `sessionId`
3. **Backend tagged events with placeholder**: All streaming events got tagged with `msg_XXX` instead of real SDK UUID
4. **Tab stored placeholder**: `claudeSessionId` on tab was set to placeholder instead of real UUID
5. **Resume failed**: When resuming, SDK rejected `msg_XXX` format as invalid UUID

### The Flow Before Fix

```
Frontend: generateId() → "msg_123_abc"
    ↓
Frontend: chat:start({ sessionId: "msg_123_abc" })
    ↓
Backend: Uses "msg_123_abc" to tag all events
    ↓
Frontend: Tab.claudeSessionId = "msg_123_abc" (WRONG!)
    ↓
Later: chat:continue({ sessionId: "msg_123_abc" })
    ↓
SDK: REJECTS - not valid UUID format!
```

---

## Solution: Use `tabId` for Frontend Correlation

Instead of frontend generating placeholder session IDs, we now use `tabId` for event routing and let the SDK provide the real session UUID.

### The Flow After Fix

```
Frontend: chat:start({ tabId: "tab_abc" })  // No placeholder sessionId
    ↓
Backend: SDK generates real UUID internally
    ↓
Backend: Events tagged with { tabId: "tab_abc", sessionId: "real-uuid-from-sdk" }
    ↓
Frontend: Find tab by tabId, store real sessionId
    ↓
Tab.claudeSessionId = "real-uuid-from-sdk" (CORRECT!)
    ↓
Later: chat:continue({ sessionId: "real-uuid", tabId: "tab_abc" })
    ↓
SDK: Accepts valid UUID ✓
```

---

## Files Changed (COMPLETED)

### 1. Shared Types (`libs/shared/src/lib/types/rpc.types.ts`)

- **ChatStartParams**: Replaced `sessionId: SessionId` with `tabId: string`
- **ChatContinueParams**: Added `tabId: string` (keeps `sessionId` for SDK resume)
- **ChatResumeParams**: Added `tabId: string` for event routing

### 2. Frontend - ConversationService (`libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`)

- Renamed `generateId()` → `generateMessageId()` (only for message IDs now)
- `startNewConversation()`: Removed placeholder sessionId generation, sends `tabId` instead
- `continueConversation()`: Added `tabId` to RPC call

### 3. Frontend - VSCodeService (`libs/frontend/core/src/lib/services/vscode.service.ts`)

- `CHAT_CHUNK` handler: Now extracts `tabId` and `sessionId`, passes both to ChatStore
- `CHAT_COMPLETE` handler: Now uses `tabId` for routing
- `CHAT_ERROR` handler: Now uses `tabId` for routing

### 4. Frontend - ChatStore (`libs/frontend/chat/src/lib/services/chat.store.ts`)

- `processStreamEvent()`: Now accepts `tabId` and `sessionId` parameters
- `handleChatComplete()`: Routes by `tabId` (primary) instead of `sessionId` lookup
- `handleChatError()`: ✅ FIXED - Now routes by `tabId` (primary) with `sessionId` fallback

### 5. Frontend - StreamingHandlerService (`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`)

- `processStreamEvent()`: ✅ FIXED - Now accepts `tabId` and `sessionId` parameters
- Routes by `tabId` first, then falls back to `sessionId` lookup
- Sets `claudeSessionId` on tab when real SDK UUID arrives

### 6. Frontend - SessionLoaderService (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`)

- `switchSession()`: ✅ FIXED - Now includes `tabId` in `chat:resume` RPC call

### 7. Frontend - MessageSenderService (`libs/frontend/chat/src/lib/services/message-sender.service.ts`)

- `startNewConversation()`: ✅ FIXED - Uses `tabId` instead of placeholder `sessionId`
- `continueConversation()`: ✅ FIXED - Includes `tabId` for event routing

### 8. Backend - ChatRpcHandlers (`apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`)

- `chat:start`: Uses `tabId` from params
- `chat:continue`: Passes `tabId` for event routing
- `chat:resume`: ✅ FIXED - Now extracts and passes `tabId`
- `streamExecutionNodesToWebview()`: ✅ CRITICAL FIX - Added `message_complete` handling

---

## 🚨 CRITICAL DISCOVERY: Dead Code in SdkRpcHandlers

### Problem Found

During this task, we discovered that **TASK_2025_086 and TASK_2025_091 fixes were applied to the wrong file!**

| Component                                         | Location                                                                    | Status                             |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `SdkRpcHandlers.streamEventsToWebview()`          | `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts`                | ❌ **DEAD CODE** - Never called    |
| `ChatRpcHandlers.streamExecutionNodesToWebview()` | `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` | ✅ **ACTIVE CODE** - Actually used |

### What Was Wrong

1. TASK_2025_086 and TASK_2025_091 added fixes to `SdkRpcHandlers.streamEventsToWebview()`:

   - `turnCompleteSent` flag to track turn completion
   - Send `chat:complete` on `message_complete` event
   - Reset flag on `message_start` for multi-turn

2. But `SdkRpcHandlers` RPC methods are **never registered**! The `sdk:*` methods exist but are not wired to the RPC handler.

3. The actual code path uses `ChatRpcHandlers` with `chat:*` methods.

4. Result: Fixes were never active! The UI never received `chat:complete` on turn completion.

### Fix Applied

We copied the TASK_2025_091 fixes from dead `SdkRpcHandlers` to active `ChatRpcHandlers.streamExecutionNodesToWebview()`:

```typescript
// Now in ChatRpcHandlers (the ACTIVE code):
let turnCompleteSent = false;

for await (const event of stream) {
  // ... send chunk ...

  // Reset on new turn
  if (event.eventType === 'message_start') {
    turnCompleteSent = false;
  }

  // Send completion on message_complete (turn-level)
  if (event.eventType === 'message_complete' && !turnCompleteSent) {
    turnCompleteSent = true;
    await this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_COMPLETE, {
      tabId,
      sessionId,
      code: 0,
    });
  }
}
```

### SdkRpcHandlers Analysis

The `SdkRpcHandlers` class has TWO responsibilities but only ONE is active:

| Component                                         | Status  | Description                                |
| ------------------------------------------------- | ------- | ------------------------------------------ |
| `constructor()` → `initializePermissionEmitter()` | ✅ USED | Wires up permission requests to webview    |
| `handleStartSession()`                            | ❌ Dead | Never registered as RPC handler            |
| `handleSendMessage()`                             | ❌ Dead | Never registered as RPC handler            |
| `handleResumeSession()`                           | ❌ Dead | Never registered as RPC handler            |
| `handleGetSession()`                              | ❌ Dead | Never registered as RPC handler            |
| `handleDeleteSession()`                           | ❌ Dead | Never registered as RPC handler            |
| `handlePermissionResponse()`                      | ❌ Dead | Handled by `WebviewMessageHandler` instead |
| `streamEventsToWebview()`                         | ❌ Dead | `ChatRpcHandlers` version is used          |

### Dead Code Cleanup: ✅ COMPLETED

**Chose Option 2**: Moved permission emitter to `SdkPermissionHandler` and deleted `SdkRpcHandlers` entirely.

**Changes Made**:

1. **Updated `SdkPermissionHandler`** (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`):
   - Added `@inject(TOKENS.WEBVIEW_MANAGER)` injection
   - Moved `initializePermissionEmitter()` from `SdkRpcHandlers`
   - Added `sendPermissionRequest()` method for direct webview messaging
   - Removed `setEventEmitter()` method (no longer needed)

2. **Deleted `SdkRpcHandlers`** (`libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts`):
   - Removed 531 lines of dead code
   - All RPC methods were never registered
   - Only `initializePermissionEmitter()` was active (via constructor side-effect)

3. **Removed `SDK_RPC_HANDLERS` token** (`libs/backend/vscode-core/src/di/tokens.ts`)

4. **Updated DI Container** (`apps/ptah-extension-vscode/src/di/container.ts`):
   - Removed `SdkRpcHandlers` import and registration

5. **Updated `main.ts`** (`apps/ptah-extension-vscode/src/main.ts`):
   - Removed Step 3.9 that resolved `SDK_RPC_HANDLERS` for side-effect initialization

6. **Updated exports** (`libs/backend/vscode-core/src/index.ts`, `libs/backend/vscode-core/src/messaging/index.ts`):
   - Removed `SdkRpcHandlers` export

---

## Status: ✅ COMPLETE

All fixes have been applied to the **correct, active code paths**:

1. ✅ `tabId` routing for all event types (CHAT_CHUNK, CHAT_COMPLETE, CHAT_ERROR)
2. ✅ `sessionId` (real SDK UUID) stored on tabs for resume
3. ✅ `message_complete` handling for proper turn completion
4. ✅ `SdkRpcHandlers` dead code deleted (531 lines removed)
5. ✅ Permission emitter moved to `SdkPermissionHandler`
6. ✅ Build passes: `npm run typecheck:all`

---

## Session 2 Fixes: Temp SessionId Issues

### Problem Discovered

After initial fixes, runtime errors showed:
- `TypeError: Cannot read properties of null (reading 'streamingState')`
- Stats arriving with `temp_xxx` ID while tab had real UUID

### Root Cause

1. **Backend generates temp sessionId**: `chat-rpc.handlers.ts` line 92 creates `temp_${Date.now()}_xxx`
2. **Stream transformer captured temp ID**: Stats and events used the original temp ID, not the resolved real UUID
3. **Frontend lookup failed**: `findTabBySessionId(tempId)` returned null because tab had real UUID

### Fixes Applied

#### 1. Stream Transformer (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`)

**Problem**: Stats and events used captured temp `sessionId` even after real UUID was resolved.

**Fix**: Added `effectiveSessionId` variable that tracks the real UUID:

```typescript
let effectiveSessionId = sessionId;  // Start with temp ID

// When SDK resolves real UUID:
if (isSystemInit(sdkMessage)) {
  effectiveSessionId = realSessionId as SessionId;  // Update to real UUID
}

// Stats now use real UUID:
const rawStats = { sessionId: effectiveSessionId, ... };

// Events now use real UUID:
const flatEvents = messageTransformer.transform(sdkMessage, effectiveSessionId);
```

#### 2. Streaming Handler Re-read (`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`)

**Problem**: Line 208 re-read tab using `event.sessionId` (temp ID) after updating `claudeSessionId` to real UUID.

**Fix**: Use tab's own ID for re-read:

```typescript
// Before (BUG):
targetTab = this.tabManager.findTabBySessionId(event.sessionId)!;

// After (FIXED):
targetTab = this.tabManager.tabs().find((t) => t.id === targetTab!.id)!;
```

#### 3. Stats Fallback (`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`)

**Problem**: Stats lookup failed because tab has real UUID but stats might have temp ID (legacy edge case).

**Fix**: Added active tab fallback for single-conversation flow:

```typescript
if (!targetTab) {
  // ...existing initialization logic...

  // NEW: Use active tab as fallback if it's in streaming/loaded state
  } else if (activeTab && (activeTab.status === 'streaming' || activeTab.status === 'loaded')) {
    targetTab = activeTab;  // Single-conversation flow fallback
  }
}
```

### Permissions Don't Need Routing

Permissions work differently from events/stats:

| Aspect | Events/Stats | Permissions |
|--------|-------------|-------------|
| Routing | By tabId/sessionId | By unique request id |
| Storage | Per-tab state | Global list |
| Display | Tab-specific | UI-level cards |
| Response | N/A | Matched by id |

Permissions are matched by `toolUseId` to corresponding tool execution nodes, not by session.

---

## Testing Checklist

1. [ ] Start new conversation → verify tab gets real UUID (not `msg_xxx` or `temp_xxx`)
2. [ ] Send another message → verify resume works with real UUID
3. [ ] Check UI transitions from "streaming" to "loaded" on turn complete
4. [ ] Multiple tabs → verify events route to correct tabs
5. [ ] Resume session from sidebar → verify events route to correct tab
6. [ ] Verify session stats appear on messages (cost, tokens, duration)
7. [ ] Verify permission prompts work (dangerous tool approval)
