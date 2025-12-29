# Task Context - TASK_2025_096

## User Intent

Fix critical streaming bug where UI stops and ignores subsequent stream chunks after tool calls.

## Problem Description

When Claude uses tools (like Glob, Read, Write), the UI would:

1. **Bug 1**: Only show the FIRST message bubble, losing subsequent messages
2. **Bug 2**: Show tool calls but text content would disappear from earlier bubbles

### Root Causes Identified

**Bug 1 - Multi-message loss:**

- `currentExecutionTree` in `chat.store.ts` returned only `rootNodes[0]`
- When SDK sends multiple assistant messages in one turn (after tool results), only the first was rendered
- Example: Message 1 has tool calls → Message 2 has follow-up text → Message 2 was LOST

**Bug 2 - Text clearing:**

- Duplicate `message_start` events cleared all `textAccumulators` for that messageId
- When SDK sends multiple "complete" messages with same messageId:
  - Text-containing message would add text
  - Tool-only message (arriving after) would clear the text
- Only the last message bubble showed text

## Technical Context

- Branch: `feature/sdk-only-migration`
- Created: 2025-12-29
- Type: BUGFIX
- Complexity: Medium
- Related: TASK_2025_095 (type migration was in progress)

## Fixes Implemented

### Fix 1: Multi-Message Rendering

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

```typescript
// ADDED: Return ALL root nodes, not just first
readonly currentExecutionTrees = computed((): ExecutionNode[] => {
  const tab = this.tabManager.activeTab();
  if (!tab?.streamingState) return [];
  return this.treeBuilder.buildRootNodes(tab.streamingState);
});

// DEPRECATED: Keep for backwards compat
readonly currentExecutionTree = computed((): ExecutionNode | null => {
  const trees = this.currentExecutionTrees();
  return trees.length > 0 ? trees[0] : null;
});
```

**File**: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`

```typescript
// Changed from singular to plural
readonly streamingMessages = computed((): ExecutionChatMessage[] => {
  const trees = this.chatStore.currentExecutionTrees();
  if (trees.length === 0) return [];
  return trees.map((tree) =>
    createExecutionChatMessage({...})
  );
});
```

**File**: `chat-view.component.html`

```html
<!-- Changed from @if to @for -->
@for (msg of streamingMessages(); track msg.id) {
<ptah-message-bubble [message]="msg" [isStreaming]="chatStore.isStreaming()" />
}
```

### Fix 2: Text Preservation

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

**message_start handler** - Removed accumulator clearing:

```typescript
if (sessionMessageIds.has(event.messageId)) {
  // Duplicate message_start - just log and continue
  // Text replacement is handled in text_delta based on event.source
  console.debug('[StreamingHandlerService] Duplicate message_start...');
  // Don't return - continue processing
} else {
  sessionMessageIds.add(event.messageId);
  state.messageEventIds.push(event.messageId);
}
```

**text_delta handler** - Smart replace vs append:

```typescript
// For 'complete' or 'history' sources: REPLACE text
// For 'stream' sources: APPEND delta
if (event.source === 'complete' || event.source === 'history') {
  state.textAccumulators.set(blockKey, event.delta);
} else {
  this.accumulateDelta(state.textAccumulators, blockKey, event.delta);
}
```

Same fix applied to `thinking_delta` handler.

## Key Insight

Different messages have different accumulator keys: `${messageId}-block-${blockIndex}`

So replacement only affects the exact same message+block combination - no data loss between different messages.

## Commits Created

1. `4ce6782` - refactor(webview): complete type migration to tool type guards (TASK_2025_095)
2. `25eece7` - fix(webview): fix streaming multi-message rendering and text preservation (TASK_2025_096)
3. `b82c1c6` - docs(docs): update task tracking for TASK_2025_094 and TASK_2025_095

## Files Modified

**TASK_2025_096 Streaming Fixes:**

- `libs/frontend/chat/src/lib/services/chat.store.ts` - Added `currentExecutionTrees`
- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` - Text preservation fix
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` - Diagnostic logging
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` - `streamingMessages` array
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` - `@for` loop

**TASK_2025_095 Type Migration (also committed):**

- `libs/shared/src/lib/type-guards/tool-input-guards.ts` - Comprehensive tool types
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- `libs/frontend/chat/src/lib/components/molecules/code-output.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/todo-list-display.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-input-display.component.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-output-display.component.ts`
- `libs/frontend/chat/src/lib/settings/auth-config.component.html`
- `libs/frontend/chat/src/lib/settings/auth-config.component.ts`

## Session 2 - Critical Streaming Regression Fixes (2025-12-29)

### New Issues Reported

The user reported severe streaming regressions:

1. **Duplicate agents** - One showing as "unknown", one with proper name
2. **Broken hierarchy** - Second message showing directly under first message
3. **Agent init prompt visible** - Internal Claude prompts being displayed
4. **Empty messages** - Multiple empty message bubbles at the end
5. **Stop streaming broken** - Can't stop the stream

### Root Causes Found (Session 2)

**Issue 1 & 2 - Duplicate agents ("unknown" + proper name):**

- `sdk-message-transformer.ts` was emitting TWO `agent_start` events:
  - During streaming: emitted `agent_start` with `agentType: 'unknown'` (lines 347-362)
  - During complete message: emitted ANOTHER `agent_start` with correct `agentType`
- Both had different event IDs, so both were stored → duplicate agents

**Issue 3 & 4 - Empty messages & broken hierarchy:**

- `message_start` events with DIFFERENT IDs but SAME `messageId` were all being stored
- Result: multiple message_start events for the same message
- More critically: Nested messages (with `parentToolUseId`) were being rendered as ROOT nodes
- They should only appear INSIDE their parent agent bubble, not as separate top-level messages

### Fixes Implemented (Session 2)

**Fix 1: Remove early agent_start emission**

File: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

```typescript
// REMOVED: Early agent_start emission during streaming
// Was causing duplicate agents with agentType: 'unknown'
// Now only emit tool_start during streaming
// agent_start emitted when complete message arrives with correct agentType
return [toolStartEvent];
```

**Fix 2: Add agent_start deduplication**

File: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

```typescript
case 'agent_start': {
  // Check for duplicates BEFORE storing
  const existingAgentStart = this.replaceStreamEventIfNeeded(
    state,
    event.toolCallId,
    'agent_start',
    event.source
  );

  if (existingAgentStart) {
    return; // Skip duplicate
  }
  // Store event...
}
```

**Fix 3: Add message_start deduplication**

File: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

```typescript
case 'message_start': {
  // Check if we already have a message_start for this messageId
  const existingMsgStart = this.findMessageStartEvent(state, event.messageId);

  if (existingMsgStart) {
    // Check source priority and replace if needed
    if (this.shouldReplaceEvent(existingSource, event.source)) {
      // Remove old, store new
    } else {
      return; // Skip lower priority event
    }
  } else {
    // First message_start - store it
  }
}
```

**Fix 4: Filter nested messages from root nodes**

File: `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`

```typescript
for (const messageId of streamingState.messageEventIds) {
  // Check if this message is nested (has parentToolUseId)
  const msgStartEvent = this.findMessageStartEvent(streamingState, messageId);
  if (msgStartEvent?.parentToolUseId) {
    // Skip nested messages - they'll be rendered inside agent bubbles
    continue;
  }

  const messageNode = this.buildMessageNode(messageId, streamingState);
  if (messageNode) {
    rootNodes.push(messageNode);
  }
}
```

### Files Modified (Session 2)

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` - Removed early agent_start
- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` - Deduplication fixes
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` - Filter nested messages

### Stop Streaming Issue

Investigation showed the abort mechanism is in place:

- `chat-input.component.ts` has `handleStop()` method
- It calls `chatStore.abortCurrentMessage()`
- Which calls `claudeRpcService.call('chat:abort', { sessionId })`
- Which calls `sdkAdapter.interruptSession(sessionId)`
- Which calls `session.query.interrupt()`

Possible causes to investigate:

1. `sessionId` mismatch between frontend and backend
2. SDK `interrupt()` not working correctly
3. `isStreaming()` returning false (stop button hidden)

User should check console logs for:

- `[ConversationService] No active session to abort`
- `[SdkAgentAdapter] Cannot interrupt - session not found`

## Testing Needed

1. **No duplicate agents** - Only one agent bubble per Task tool call
2. **Correct hierarchy** - Nested messages appear INSIDE agent bubbles, not as root
3. **No empty messages** - All message bubbles should have content
4. **Stop button works** - Should be able to stop streaming

## Session 3 - Multi-Agent MessageId Collision Fix (2025-12-29)

### Issue Reported

When loading session history with multiple sub-agents (Task tool invocations), only the **last agent's execution** is displayed. The first agent shows "Starting agent execution" but no nested content.

**Example from screenshot:**

- `workflow-orchestrator` - Shows "Starting agent execution" with NO nested tools
- `project-manager` - Shows full execution with 18 tools

### Investigation Findings

**Log Analysis:**

1. Backend creates Task-Agent correlations correctly:

   - `toolu_01Xw9LxE26499cYYiuGTYRbG` → `agent-aac9b40` (workflow-orchestrator)
   - `toolu_01Eu3YYL3LwmTbXHWBEk3gEx` → `agent-a9c4d45` (project-manager)

2. Frontend receives all events correctly:

   - Line 407: `MESSAGE_START` with `parentToolUseId: toolu_01Xw9...` (workflow-orchestrator)
   - Line 537: `MESSAGE_START` with `parentToolUseId: toolu_01Eu3...` (project-manager)

3. **BUT** at tree building time:
   - `workflow-orchestrator` agent node: **childrenCount: 0** (EMPTY!)
   - `project-manager` agent node: **childrenCount: 26** (has content)

### Root Cause

**File:** `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
**Function:** `processAgentMessages()`

The messageId generation creates **DUPLICATE IDs across different agents**:

```typescript
// BROKEN: Same messageId for both agents!
const agentMessageId = `agent_msg_${eventIndex}_${Math.floor(parentTimestamp)}`;
```

Since `eventIndex` resets to 0 for EACH agent call and `parentTimestamp` is the same (from the parent message), both agents generate identical messageIds:

- workflow-orchestrator: `agent_msg_0_1766972003899`
- project-manager: `agent_msg_0_1766972003899` (SAME!)

**Evidence from log:**

- Line 407: `messageId: agent_msg_0_1766972003899`, `parentToolUseId: toolu_01Xw9...` (workflow-orchestrator)
- Line 537: `messageId: agent_msg_0_1766972003899`, `parentToolUseId: toolu_01Eu3...` (project-manager)

**Impact:**

1. First agent (workflow-orchestrator) events arrive
2. Second agent (project-manager) events arrive with SAME messageIds
3. Frontend deduplication REPLACES first agent's events
4. First agent's nested content is LOST

### Fix Implemented

**File:** `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`

Include `parentToolUseId` in both messageId and event ID generation:

```typescript
// FIXED: Include parentToolUseId to prevent collision
const agentMessageId = `agent_msg_${parentToolUseId}_${eventIndex}_${Math.floor(parentTimestamp)}`;

// Event IDs also fixed
id: `evt_agent_${parentToolUseId}_${eventIndex++}_${Math.floor(messageTimestamp)}`,
```

**Why This Works:**

- Each Task tool call has a unique `toolCallId` (e.g., `toolu_01Xw9LxE26499cYYiuGTYRbG`)
- This `toolCallId` becomes the `parentToolUseId` for that agent's nested events
- By including `parentToolUseId`, each agent's messages are guaranteed unique

**Multiple Agents in One Message Block:**

- Even when multiple Task tools are called in one assistant message
- Each Task tool has a unique `toolCallId`
- Each agent's nested events will have unique messageIds
- No collision regardless of how many agents are spawned

### Files Modified (Session 3)

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` - Earlier fixes
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` - **messageId collision fix**

## Remaining Unstaged Files

- `vscode-app-1766939225426.log` - Debug log file (don't commit)
- `claude-agentsdk-types.md` - Research notes (optional to commit)
