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

| Aspect   | Events/Stats       | Permissions          |
| -------- | ------------------ | -------------------- |
| Routing  | By tabId/sessionId | By unique request id |
| Storage  | Per-tab state      | Global list          |
| Display  | Tab-specific       | UI-level cards       |
| Response | N/A                | Matched by id        |

Permissions are matched by `toolUseId` to corresponding tool execution nodes, not by session.

---

---

## Session 3 Fixes: Tool Calls Not Showing in Session History

### Problem Discovered

When loading a previous session from sidebar, tool calls (Read, Edit, etc.) were not displayed. Only plain text messages showed.

**Symptoms**:

- User clicked on session in sidebar
- Messages loaded but showed only text content
- Tool calls, thinking blocks, and agent spawns were missing
- Screenshot showed empty execution tree

**Root Cause Analysis**:

1. **Backend `chat:resume`** was using `readHistoryAsMessages()` which only extracted text content:

   ```typescript
   // BEFORE: Only extracted text, skipped tool_use blocks
   const messages = await this.historyReader.readHistoryAsMessages(sessionId, workspacePath);
   // Returns: [{ id, role, content: "text only", timestamp }]
   ```

2. **SessionHistoryReaderService** had TWO methods:

   - `readHistoryAsMessages()` - Simple text extraction (USED)
   - `readSessionHistory()` - Full `FlatStreamEventUnion[]` with tools (NOT USED)

3. **Frontend** received simple messages and set `streamingState: null`:
   ```typescript
   // No execution tree built for history!
   streamingState: null;
   ```

### Solution: Return Events for Execution Tree

#### 1. Updated `ChatResumeResult` Type (`libs/shared/src/lib/types/rpc.types.ts`)

Added `events` field to return full streaming events:

```typescript
export interface ChatResumeResult {
  success: boolean;
  messages?: { ... }[];  // Deprecated - text only
  events?: FlatStreamEventUnion[];  // NEW: Full events with tools
  error?: string;
}
```

#### 2. Updated `chat:resume` Handler (`apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`)

Now returns both messages (deprecated) and events:

```typescript
// NEW: Use readSessionHistory() for full events
const events = await this.historyReader.readSessionHistory(sessionId, workspacePath);
const messages = await this.historyReader.readHistoryAsMessages(sessionId, workspacePath);

return { success: true, messages, events }; // Events have tool calls!
```

#### 3. Added `finalizeSessionHistory()` Method (`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`)

New method to finalize ALL messages in history (not just current streaming message):

```typescript
finalizeSessionHistory(tabId: string): ExecutionChatMessage[] {
  // 1. Build tree for ALL messages
  const allTrees = this.treeBuilder.buildTree(stateCopy);

  // 2. Create messages for each messageId
  for (const messageId of stateCopy.messageEventIds) {
    const role = findMessageStartEvent(messageId).role;

    if (role === 'user') {
      messages.push(createUserMessage(messageId));
    } else {
      // Assistant messages get execution tree with tool calls!
      messages.push(createAssistantMessage(messageId, treeNode));
    }
  }

  return messages;
}
```

#### 4. Updated `switchSession()` (`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`)

Now processes events through streaming pipeline:

```typescript
// Process all history events (includes tool_start, tool_result, etc.)
for (const event of events) {
  this.streamingHandler.processStreamEvent(event, activeTabId, sessionId);
}

// Finalize ALL messages (not just current)
const historyMessages = this.streamingHandler.finalizeSessionHistory(activeTabId);
```

### Flow After Fix

```
User clicks session in sidebar
    ↓
Frontend: chat:resume({ sessionId, tabId })
    ↓
Backend: readSessionHistory() returns FlatStreamEventUnion[]
    - message_start (user)
    - text_delta
    - message_complete
    - message_start (assistant)
    - text_delta
    - tool_start (Read tool)     ← NOW INCLUDED!
    - tool_result (file content) ← NOW INCLUDED!
    - message_complete
    ↓
Frontend: Process all events through StreamingHandler
    ↓
Frontend: finalizeSessionHistory() builds ExecutionNode tree
    ↓
UI: Shows messages WITH tool calls and execution tree!
```

---

## Testing Checklist

1. [ ] Start new conversation → verify tab gets real UUID (not `msg_xxx` or `temp_xxx`)
2. [ ] Send another message → verify resume works with real UUID
3. [ ] Check UI transitions from "streaming" to "loaded" on turn complete
4. [ ] Multiple tabs → verify events route to correct tabs
5. [ ] Resume session from sidebar → verify events route to correct tab
6. [ ] Verify session stats appear on messages (cost, tokens, duration)
7. [ ] Verify permission prompts work (dangerous tool approval)
8. [ ] **NEW**: Load previous session → verify tool calls are displayed
9. [ ] **NEW**: Load previous session → verify thinking blocks are displayed
10. [ ] **NEW**: Load previous session → verify agent spawns are displayed
11. [ ] **NEW (Session 4)**: Tool calls complete → verify tools transition from streaming to complete state
12. [ ] **NEW (Session 4)**: Tool results display correctly after tool execution

---

## Session 4 Fixes: Tool Results Not Emitted During Live Streaming

### Problem Discovered

Tools remained in streaming state (`__streaming: true`) and subsequent messages were not rendered after tool calls. The UI would stop displaying content after a tool was invoked.

**Log Analysis Evidence (vscode-app-1766866783819.log)**:

```
Line 2773: [StreamTransformer] SDK message #305 received: type=user
Line 2774: [StreamTransformer] SDK message #306 received: type=stream_event → message_start (next turn)
```

The `type=user` message contains the `tool_result` content block, but it was being **filtered out** by StreamTransformer.

### Root Cause Analysis

1. **StreamTransformer filtered user messages** (`stream-transformer.ts` lines 275-278):

   ```typescript
   // BEFORE: Only processed stream_event and assistant
   if (
     sdkMessage.type === 'stream_event' ||
     sdkMessage.type === 'assistant'
   ) {
   ```

   User messages (`type === 'user'`) were skipped entirely!

2. **SDK sends tool_result in user messages**:

   - After tool execution, SDK sends a `user` message containing `tool_result` content blocks
   - These were never yielded to the frontend
   - Without `tool_result` events, `ExecutionTreeBuilder` couldn't complete tool nodes

3. **SdkMessageTransformer skipped empty user messages** (`sdk-message-transformer.ts` lines 672-679):
   - User messages with tool_result blocks have no text content
   - The existing check `if (!textContent || !textContent.trim())` returned early
   - Tool result blocks were never extracted

### Flow Before Fix

```
SDK: tool_use (Read file) → tool_delta events
SDK: user message with tool_result block ← FILTERED OUT!
SDK: message_start (next turn)
UI: Tool stuck at __streaming: true, no result shown
```

### Solution Applied

#### 1. Updated StreamTransformer (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`)

Added `'user'` to the message type filter:

```typescript
// AFTER: Now processes user messages for tool_result extraction
if (
  sdkMessage.type === 'stream_event' ||
  sdkMessage.type === 'assistant' ||
  sdkMessage.type === 'user'  // ADDED: Extract tool_result from user messages
) {
```

#### 2. Updated SdkMessageTransformer (`libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`)

Added tool_result extraction BEFORE the empty message check:

```typescript
private transformUserToFlatEvents(sdkMessage: SDKUserMessage, sessionId?: SessionId): FlatStreamEventUnion[] {
  const { uuid, message, parent_tool_use_id } = sdkMessage;
  const events: FlatStreamEventUnion[] = [];
  const messageId = uuid || `user-${Date.now()}`;

  // TASK_2025_092: First, check for tool_result blocks in user messages
  // SDK sends tool execution results as user messages with tool_result content blocks
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      // Inline type check for tool_result (UserMessageContent != ContentBlock)
      if (
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        block.type === 'tool_result' &&
        'tool_use_id' in block
      ) {
        const toolResultBlock = block as ToolResultBlock;
        const toolResultEvent: ToolResultEvent = {
          id: generateEventId(),
          eventType: 'tool_result',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId,
          toolCallId: toolResultBlock.tool_use_id,
          output: toolResultBlock.content,
          isError: toolResultBlock.is_error ?? false,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(toolResultEvent);
      }
    }

    // If we found tool_result blocks, return them (no empty user bubble)
    if (events.length > 0) {
      return events;
    }
  }

  // ... existing text content extraction ...
}
```

### Flow After Fix

```
SDK: tool_use (Read file) → tool_delta events
SDK: user message with tool_result block
    ↓
StreamTransformer: Allows 'user' type through ✓
    ↓
SdkMessageTransformer: Extracts tool_result from content blocks ✓
    ↓
Frontend: Receives tool_result event
    ↓
ExecutionTreeBuilder: Completes tool node ✓
    ↓
UI: Tool shows "Read" with result, streaming transitions to complete ✓
```

### Key Insight: SDK Message Flow

The SDK message flow for tool execution is:

1. `stream_event` → `content_block_start` (tool_use)
2. `stream_event` → `content_block_delta` (tool input JSON)
3. `stream_event` → `content_block_stop`
4. **`user`** → contains `tool_result` block (THIS WAS MISSED!)
5. `stream_event` → `message_start` (next assistant turn)

Without step 4 being processed, tools never complete and the UI breaks.

### Verification

```bash
npm run typecheck:all  # ✅ Passes
npm run lint:all       # ✅ Passes (only pre-existing warnings)
```
