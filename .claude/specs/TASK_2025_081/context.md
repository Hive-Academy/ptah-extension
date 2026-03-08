# Task Context - TASK_2025_081

## Task Title

SDK Streaming & Session Management Fixes - Continuation

## User Intent

Continue fixing and testing the SDK streaming and session management issues that were partially addressed. The fixes need verification in a real session and may require additional refinements.

## Problem Summary

Multiple issues were discovered with how SDK streaming messages and session data flow between backend and frontend:

1. **Streaming chunks showing as complete messages** - Each SDK streaming chunk appeared as a separate message bubble instead of updating a single streaming message
2. **Tools detached from sub-agents** - Tools spawned by sub-agents weren't nesting properly under their parent agent
3. **Empty user messages in loaded sessions** - User messages appeared empty when loading saved sessions
4. **Duplicate messages** - System prompts echoed back by SDK appeared as user messages
5. **Legacy session format** - Older sessions stored with chunk-per-message format needed special handling

## Fixes Applied (2025-12-16)

### Fix 1: Don't yield complete assistant messages to UI

**File**: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts` (lines 373-387)

**Problem**: Complete `assistant` message from SDK was being yielded to UI, creating hierarchical structure that conflicted with the streaming flat structure.

**Solution**: Skip yielding `assistant` messages to UI (only save them for storage). Streaming events already build UI content incrementally, and finalization completes it.

```typescript
// Skip these message types from being yielded to UI:
// - 'user': Already displayed when user sends them
// - 'assistant': Complete message conflicts with streaming structure
const skipForUI = sdkMessage.type === 'user' || sdkMessage.type === 'assistant';
if (!skipForUI) {
  for (const node of nodes) {
    yield node;
  }
}
```

### Fix 2: Create message wrapper on stream start

**File**: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` (lines 571-585)

**Problem**: Streaming didn't create a proper message wrapper, so content nodes got structured incorrectly. First text node became root, then tool nodes got appended as children of text instead of siblings.

**Solution**: Create a MESSAGE wrapper node on `message_start` event. This provides proper structure where:

- Text and tool nodes become siblings (children of message)
- Sub-agent nodes can properly nest under their parent tool via `parentToolUseId`

```typescript
case 'message_start': {
  // ... capture UUID, clear state ...

  // Create message wrapper node as root for all content
  return [
    createExecutionNode({
      id: this.currentStreamingUuid,
      type: 'message' as ExecutionNodeType,
      status: 'streaming' as ExecutionStatus,
      content: null,
      children: [],
      parentToolUseId: this.currentParentToolUseId ?? undefined,
    }),
  ];
}
```

### Fix 3: Enhanced mergeExecutionNode for proper nesting

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` (lines 139-254)

**Problem**: Content nodes weren't being properly added as children of message wrapper.

**Solution**: Enhanced logic to:

- Recognize content nodes (text, tool, agent, thinking) and add as children of message wrapper
- Handle legacy cases where root is content node instead of message wrapper
- Properly nest sub-agent messages under their parents

### Fix 4: Legacy session handling

**File**: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

**Problem**: Older sessions stored with chunk-per-message format showed fragmented messages.

**Solution**: Added:

- `aggregateConsecutiveAssistantMessages()` - Merges consecutive assistant chunks into single message
- `deduplicateMessages()` - Removes duplicate content
- `mergeAssistantMessages()` - Aggregates token usage across merged messages

### Fix 5: User message content extraction

**File**: `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

**Problem**: User messages created with `type: 'message'` but frontend filtered by `type: 'text'`.

**Solution**: Updated extraction to check `node.content` directly, not just child text nodes.

### Fix 6: Don't save/yield user messages from stream

**File**: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`

**Problem**: User messages saved twice (adapter + stream-transformer) and SDK echoes modified content.

**Solution**: Only save `assistant` messages from stream, skip user messages for UI.

## Files Modified

### Backend

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`

  - Skip yielding `user` and `assistant` messages to UI
  - Only save `assistant` messages to storage

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
  - Create message wrapper node on `message_start`
  - Properly set `parentToolUseId` for nested agent messages

### Frontend

- `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

  - Enhanced `mergeExecutionNode` for proper nesting
  - Content nodes added as children of message wrapper
  - Handle legacy/edge cases

- `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`
  - `aggregateConsecutiveAssistantMessages()` for legacy format
  - `deduplicateMessages()` for duplicate content
  - Fixed user message content extraction

## Testing Required

### Live Streaming Tests

- [ ] Send a simple message and verify single streaming bubble
- [ ] Send message that triggers tool use, verify tools nest properly
- [ ] Trigger sub-agent spawn, verify sub-agent content nests under parent
- [ ] Verify token/cost display after completion

### Session Loading Tests

- [ ] Load a newly created session and verify messages display correctly
- [ ] Load a legacy session (if any exist) and verify aggregation works
- [ ] Verify user messages display their content
- [ ] Verify no duplicate messages appear

### Edge Cases

- [ ] Abort streaming mid-response and restart
- [ ] Multiple rapid messages
- [ ] Very long responses with many tool calls
- [ ] Sub-agents spawning their own sub-agents (deep nesting)

## Known Issues / Potential Problems

1. **Message wrapper timing**: If `message_start` doesn't arrive before content, structure could be wrong
2. **parentToolUseId tracking**: `currentParentToolUseId` is cleared on `clearStreamingState()`, could cause issues with overlapping agents
3. **ID matching**: Content node IDs like `uuid-block-0` must match between streaming and final message

## Technical Context

- **Branch**: feature/sdk-only-migration (current)
- **Type**: BUGFIX / REFINEMENT
- **Complexity**: High (cross-cutting backend/frontend changes)
- **Related**: SDK integration, ExecutionNode architecture

## Dependencies

- SDK Agent Adapter (`libs/backend/agent-sdk`)
- Frontend ChatStore (`libs/frontend/chat`)
- ExecutionNode type system (`libs/shared`)

## Success Criteria

1. Single streaming message bubble during response
2. Tools properly nested under calling agent/sub-agent
3. Sub-agent content nested under parent Task tool
4. Legacy sessions display correctly
5. No duplicate messages
6. Token/cost data displays after completion
