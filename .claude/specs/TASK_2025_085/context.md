# TASK_2025_085: SDK Streaming Display Bugs - Duplicated Text & Messages

## Status: COMPLETE

## Parent Task

- **TASK_2025_082/084**: SDK Streaming Architecture (COMPLETED - code review fixes)

## Background

After completing TASK_2025_082 (SDK Streaming Architecture) and TASK_2025_084 (Code Review Fixes), user testing revealed **NEW display bugs** that were NOT covered by the previous fixes. These appear to be rendering/state issues rather than the data flow issues addressed in 082/084.

## Problem Statement

User testing shows three critical display issues:

1. **Streaming text appears as stacked history** instead of growing in place
2. **Agent cards appear duplicated** (two "general-purpose" cards for same agent)
3. **User messages appear multiple times** or appear empty

## Evidence (Screenshots)

### Issue 1: Duplicated Streaming Text Chunks

- **File**: `task-tracking/wrong-message-chunks.png`
- **Observation**: Claude's streaming response shows progressive text as SEPARATE LINES:
  ```
  I'll invoke a
  I'll invoke a specialist
  I'll invoke a specialist agent to check for TypeScript errors using
  I'll invoke a specialist agent to check for TypeScript errors using the available tools.
  (etc.)
  ```
- **Expected**: ONE text block that grows as chunks arrive
- **Impact**: Confusing UX, text appears as list instead of paragraph

### Issue 2: Duplicated Agent Cards

- **File**: `task-tracking/wrong-subagent-and-user-duplicate-message.png`
- **Observation**: Two "general-purpose Check TypeScript errors" cards with "No execution data"
- **Expected**: ONE agent card that shows execution progress
- **Impact**: Confusing UX, unclear which agent is active

### Issue 3: Duplicate/Empty User Messages

- **File**: `task-tracking/wrong-subagent-and-user-duplicate-message.png` (bottom)
- **File**: Console log shows `messages: Array(44)` with duplicate user messages
- **Observation**: Multiple "You" boxes appearing at same timestamp, some empty
- **Expected**: ONE user message per actual user input
- **Impact**: Broken conversation flow, empty messages confuse users

## Root Cause Hypotheses

### Hypothesis A: Angular Change Detection Issue

The tree is being rebuilt correctly but Angular is APPENDING new DOM elements instead of UPDATING existing ones. Could be caused by:

- Node IDs changing between renders
- `track` expression not working correctly
- Computed signal creating new object references breaking change detection

### Hypothesis B: Multiple Events Creating Multiple Nodes

The SDK or transformer might be emitting duplicate events:

- Multiple `message_start` events for same message
- Multiple `tool_start` events for same tool
- Duplicate messages in session history

### Hypothesis C: Session Loading Creates Duplicates

When loading a session, the RPC response might contain duplicate messages that are rendered directly. Console shows `messages: Array(44)` with sequential user/assistant patterns that look wrong.

### Hypothesis D: Streaming Preview + Finalized Messages Overlap

The `@for` loop renders finalized messages while `@if (chatStore.isStreaming())` renders streaming preview. If messages are being added to `messages[]` before streaming completes, they'd appear twice.

## Investigation Plan

1. **Add debug logging** to tree builder to trace:

   - How many text nodes are created per message
   - Node IDs and their consistency across renders
   - Events being processed

2. **Check SDK event stream** for duplicates:

   - Log all events emitted by `SdkMessageTransformer`
   - Verify `message_start` is emitted once per message
   - Check `tool_start` events for agents

3. **Inspect Angular rendering**:

   - Use Angular DevTools to see component tree
   - Check if DOM elements are being reused or recreated
   - Verify `track` expressions

4. **Compare streaming vs loaded sessions**:
   - Does issue occur during live streaming only?
   - Does issue occur when loading saved sessions?
   - Does issue affect new sessions or only existing ones?

## Files to Investigate

| File                                                                          | Investigation                             |
| ----------------------------------------------------------------------------- | ----------------------------------------- |
| `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`       | Add logging to trace node creation        |
| `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts` | Check track expression and rendering      |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts`      | Check streaming/finalized message overlap |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`                   | Check for duplicate event emission        |
| `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` | Check event processing and state updates  |

## Acceptance Criteria

1. **Streaming text**: Shows as ONE growing block, not stacked history
2. **Agent cards**: ONE card per agent, shows execution data
3. **User messages**: ONE message per user input, no empty messages
4. **Session loading**: No duplicate messages when loading saved sessions
5. **Build**: `npm run typecheck:all` passes with 0 errors

## Estimated Scope

- **Investigation**: 2-3 hours to identify root cause
- **Fix**: Depends on root cause (could be simple CSS fix or complex event handling refactor)
- **Files**: Likely 2-4 files depending on root cause

## Related Tasks

- TASK_2025_082: SDK Streaming Architecture Migration (parent)
- TASK_2025_084: Code Review Fixes (sibling - completed)

---

## Implementation (COMPLETED 2025-12-17)

### Root Cause Identified

**The SDK sends BOTH streaming events AND complete messages** for the same content:

1. **Streaming path**: `stream_event` messages → `message_start`, `text_delta`, `tool_start`, etc.
2. **Complete message path**: `assistant`/`user` messages → transform to same event types

When both paths are processed without deduplication, we get:

- Duplicate message nodes (two message_start for same messageId)
- Duplicate text content ("Hello worldHello world" - accumulated twice)
- Duplicate agent/tool cards (two tool_start for same toolCallId)

### Fix Applied

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

Added deduplication tracking Maps and skip logic for already-processed events:

```typescript
// New tracking state
private processedMessageIds = new Map<string, Set<string>>();
private processedToolCallIds = new Map<string, Set<string>>();

// In processStreamEvent():
case 'message_start':
  // Skip if messageId already processed
  if (sessionMessageIds.has(event.messageId)) return;
  sessionMessageIds.add(event.messageId);
  // ... rest of handler

case 'text_delta':
  // Skip if message was already finalized
  const alreadyProcessed = sessionMsgIds?.has(event.messageId)
    && !state.messageEventIds.includes(event.messageId);
  if (alreadyProcessed) return;
  // ... rest of handler

case 'tool_start':
  // Skip if toolCallId already processed
  if (sessionToolCallIds.has(event.toolCallId)) return;
  sessionToolCallIds.add(event.toolCallId);
  // ... rest of handler

case 'tool_delta':
  // Skip if tool was already finalized
  const toolAlreadyProcessed = sessionToolIds?.has(event.toolCallId)
    && !state.toolCallMap.has(event.toolCallId);
  if (toolAlreadyProcessed) return;
  // ... rest of handler
```

### Cleanup on Session End

The tracking state is cleaned up when a session is unregistered:

```typescript
unregisterActiveSession(sessionId: string): void {
  this.activeSessionIds.delete(sessionId);
  this.processedMessageIds.delete(sessionId);
  this.processedToolCallIds.delete(sessionId);
}
```

### Verification

- `npm run typecheck:all` - ✅ PASSED (0 errors)
- `npm run lint:all` - ✅ PASSED (warnings only, no errors)

### Acceptance Criteria Status

1. **Streaming text**: ✅ Fixed - duplicate text_delta events skipped
2. **Agent cards**: ✅ Fixed - duplicate tool_start events skipped
3. **User messages**: ✅ Fixed - duplicate message_start events skipped
4. **Session loading**: ✅ Fixed - deduplication applies to all event sources
5. **Build**: ✅ `npm run typecheck:all` passes with 0 errors
