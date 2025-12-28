# TASK_2025_094: Streaming Bug Fix - Summary & Continuation

## Task Overview

**Date**: 2025-12-28
**Branch**: `feature/sdk-only-migration`
**Status**: Fixes implemented, needs user testing

---

## Problem Statement

The frontend UI was "getting detached" from streaming when tool calls executed:

1. Tools remained stuck showing `__streaming: true`
2. `tool_result` events were lost
3. Streaming content disappeared after `chat:complete`

---

## Root Causes Identified

### 1. MessageId Mismatch (TASK_2025_093 - Previously Fixed)

- Streaming events used `message.id` (Anthropic API ID)
- Complete messages used SDK's `uuid`
- This caused correlation failures between `tool_start` and `tool_result`

**Fix**: Changed `sdk-message-transformer.ts` to use SDK's `uuid` as the canonical identifier.

### 2. Premature Finalization (Fixed in this session)

- `handleChatComplete` called `finalizeCurrentMessage()`
- This set `streamingState: null` before `tool_result` events arrived
- SDK event order: `message_complete` → `chat:complete` sent → `tool_result` arrives
- By the time `tool_result` arrived, streaming state was already cleared

### 3. UI Visibility Bug (Fixed in this session)

- Template only showed `streamingMessage` when `isStreaming()` was true
- After `chat:complete`, status became 'loaded', so `isStreaming()` returned false
- Content disappeared even though it existed in `streamingState`

---

## Fixes Applied

### File 1: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Lines 614-641**

```typescript
// BEFORE: Called finalizeCurrentMessage() which cleared streamingState
this.finalizeCurrentMessage(targetTabId);

// AFTER: Only update UI status, preserve streamingState
// TASK_2025_093 FIX: DO NOT call finalizeCurrentMessage here!
// chat:complete should ONLY update UI status, not mutate the event pipeline.
this.tabManager.updateTab(targetTabId, { status: 'loaded' });
this.sessionManager.setStatus('loaded');
```

### File 2: `libs/frontend/chat/src/lib/services/chat-store/completion-handler.service.ts`

**Lines 93-117**

Same change - removed `finalizeCurrentMessage()` call, kept only status updates.

### File 3: `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`

**Lines 12-38**

```html
<!-- BEFORE: Only showed when streaming -->
@if (chatStore.isStreaming()) { @if (streamingMessage(); as msg) {
<ptah-message-bubble [message]="msg" [isStreaming]="true" />
} }

<!-- AFTER: Show whenever content exists, isStreaming controls indicators only -->
@if (streamingMessage(); as msg) {
<ptah-message-bubble [message]="msg" [isStreaming]="chatStore.isStreaming()" />
} @else if (chatStore.isStreaming()) {
<!-- Skeleton placeholder -->
}
```

Also updated empty state condition (line 38):

```html
@if (chatStore.messages().length === 0 && !chatStore.isStreaming() && !streamingMessage()) {
```

### File 4: `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`

**Lines 424-456**

Added lazy finalization when user sends new message:

```typescript
// TASK_2025_093 FIX: Finalize any existing streaming state before starting new turn.
if (activeTab?.streamingState) {
  console.log('[ConversationService] Finalizing previous streaming state before new message');
  const { StreamingHandlerService } = await import('./streaming-handler.service');
  const streamingHandler = this.injector.get(StreamingHandlerService);
  streamingHandler.finalizeCurrentMessage(activeTabId);
}

// Re-fetch tab after finalization to get updated messages
const currentTab = this.tabManager.tabs().find((t) => t.id === activeTabId);
```

---

## New Architecture

### Event Flow (After Fixes)

```
1. SDK yields events → stored in tab.streamingState
2. message_complete arrives → backend sends chat:complete
3. chat:complete received → status: 'loaded' (UI only, NO finalization)
4. streamingState persists → streamingMessage() still has content
5. UI shows content via streamingMessage() (regardless of streaming status)
6. tool_result events arrive → stored in streamingState → UI updates
7. User sends new message → lazy finalization → previous response saved to messages
```

### Key Design Principles

| Principle                           | Implementation                            |
| ----------------------------------- | ----------------------------------------- |
| `chat:complete` = UI status only    | No data mutations on completion           |
| `streamingState` persists           | Events accumulate until next user message |
| UI visibility based on content      | Not streaming status                      |
| Lazy finalization                   | Happens when user sends next message      |
| Users can interact during streaming | Messages queue and auto-send              |

---

## Files Modified (Full List)

1. `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` - Use SDK uuid
2. `libs/frontend/chat/src/lib/services/chat.store.ts` - Remove premature finalization
3. `libs/frontend/chat/src/lib/services/chat-store/completion-handler.service.ts` - Same
4. `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` - UI visibility fix
5. `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` - Lazy finalization
6. `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` - MessageId mismatch fallback (earlier fix)

---

## Testing Required

### Test Case 1: Basic Tool Calls

1. Send a message that triggers tool use (e.g., "read file X")
2. Verify tool shows streaming → complete (not stuck)
3. Verify tool result is displayed

### Test Case 2: Multiple Tool Calls

1. Send a message that triggers multiple tools
2. Verify all tools complete properly
3. Verify all results display

### Test Case 3: Content Persistence

1. Send a message and wait for response
2. Verify content remains visible after `chat:complete`
3. Check console for "Chat status reset to loaded (streaming state preserved)"

### Test Case 4: Multi-turn Conversation

1. Send first message, wait for response
2. Send second message
3. Verify: Previous response is finalized (saved to messages)
4. Verify: New response streams correctly
5. Check console for "Finalizing previous streaming state before new message"

### Test Case 5: Message Queuing

1. Start a message that takes time
2. While streaming, type and press Enter
3. Verify: "Message queued" indicator appears
4. Verify: Queued message auto-sends after completion

---

## Known Issues / Remaining Work

### 1. Log File Analysis Incomplete

The log file (`vscode-app-1766939225426.log`) was too large to fully analyze. Key patterns were extracted via grep, but full sequential analysis was not completed.

### 2. Diagnostic Logging Still Present

The following diagnostic logs should be removed after verification:

- `[ExecutionTreeBuilder] buildToolNode - looking for tool_result`
- `[ExecutionTreeBuilder] MESSAGEID MISMATCH FIX`
- Various `[StreamingHandlerService]` diagnostic logs

### 3. Stats Update Warning

The log shows: `[StreamingHandlerService] No assistant message found for stats update`
This is because stats arrive after `chat:complete` but before the message is finalized. May need to handle stats differently or defer stats application.

### 4. Edge Cases to Test

- Tab switching during streaming
- Session switching during streaming
- Abort during tool execution
- Network interruption recovery

### 5. Potential UI Improvements (from frontend agent review)

Currently during streaming:

- STOP button visible (for abort)
- Enter key queues messages

Could consider showing BOTH Send and Stop buttons during streaming for clearer UX.

---

## How to Continue

1. **User Testing**: Test the 5 test cases above
2. **If Issues Found**: Check console logs for diagnostic output
3. **After Verification**: Remove diagnostic logging
4. **Stats Warning**: Investigate if stats update warning causes issues
5. **Edge Cases**: Test tab/session switching scenarios

---

## Build Status

- Build: PASSED
- Lint: PASSED (0 errors, 7 pre-existing warnings)
- All changes are in working tree (not committed)

---

## Git Status

```
Modified files (not committed):
- libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts
- libs/frontend/chat/src/lib/services/chat.store.ts
- libs/frontend/chat/src/lib/services/chat-store/completion-handler.service.ts
- libs/frontend/chat/src/lib/components/templates/chat-view.component.html
- libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts
- libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts
```

After testing, commit with:

```bash
git add .
git commit -m "fix(webview): resolve streaming disconnection and tool_result loss

- Remove premature finalization from chat:complete handlers
- Show streaming content when exists, not just when streaming status
- Add lazy finalization when user sends new message
- Use SDK uuid as canonical message identifier

TASK_2025_093, TASK_2025_094"
```
