# TASK_2025_095: SDK Streaming Architecture Fix - Final Summary

## Status: PHASE 6 IMPLEMENTED - Awaiting User Testing

## Branch: `feature/sdk-only-migration`

---

## Problem Statement

**Two issues identified and fixed:**

1. **Session History Loading**: Sub-agent executions (tools inside Task agent) were not displaying in the UI when loading session history. The agent bubble appeared empty despite events being received.

2. **Live Streaming Broken** (Phase 6): UI completely stopped updating after the first tool call during live streaming. The `agent_start` events had `parentToolUseId: undefined`, breaking tree linkage.

## Root Cause Analysis

### The Bug Location

**File:** `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

### What Was Happening

1. **Event storage happened at line 373** (before the switch statement):

   ```typescript
   state.events.set(event.id, event); // Event stored here
   ```

2. **Then in the `tool_start` case**, `replaceStreamEventIfNeeded()` was called:

   ```typescript
   case 'tool_start': {
     const existingToolStart = this.replaceStreamEventIfNeeded(
       state, event.toolCallId, 'tool_start', event.source
     );
     // ...
   }
   ```

3. **`replaceStreamEventIfNeeded()` searched `state.events.values()`** looking for events with the same `toolCallId` and `eventType`.

4. **It found the event we JUST stored** (same toolCallId, same eventType 'tool_start').

5. **For history events** (all have `source: 'history'`):
   - `shouldReplaceEvent('history', 'history')` returns `true` (priority 3 >= 3)
   - The method **deleted the event we just stored!**

### Evidence from Logs

```
Backend: eventCount: 32
Frontend: eventCount: 22, allToolStartsInState: []
```

- 32 events sent from backend
- Only 22 stored in frontend (10 missing = 7 tool_start + 3 tool_result)
- ALL tool_start and tool_result events were being deleted

---

## The Solution

### Fix Applied

Moved event storage **inside each case handler**, and for `tool_start`/`tool_result`, the duplicate check now happens **BEFORE** storing:

```typescript
case 'tool_start': {
  // TASK_2025_095 FIX: Check for duplicates BEFORE storing
  const existingToolStart = this.replaceStreamEventIfNeeded(
    state, event.toolCallId, 'tool_start', event.source
  );

  if (existingToolStart) {
    return;  // Skip if existing has higher priority
  }

  // NOW store the event (after duplicate check passed)
  state.events.set(event.id, event);
  this.indexEventByMessage(state, event);
  // ... rest of handler
}
```

### Helper Method Added

```typescript
private indexEventByMessage(state: StreamingState, event: FlatStreamEventUnion): void {
  if (event.messageId) {
    const messageEvents = state.eventsByMessage.get(event.messageId) || [];
    messageEvents.push(event);
    state.eventsByMessage.set(event.messageId, messageEvents);
  }
}
```

### All Event Handlers Updated

Each case handler now stores its event explicitly:

- `message_start` ✅
- `text_delta` ✅
- `thinking_start` ✅
- `thinking_delta` ✅
- `tool_start` ✅ (check BEFORE store)
- `tool_delta` ✅
- `tool_result` ✅ (check BEFORE store)
- `agent_start` ✅
- `message_complete` ✅
- `message_delta` ✅
- `signature_delta` ✅

---

## Why This Works for Both Use Cases

### Live Streaming

1. First `tool_start` arrives with `source: 'stream'` → no existing event → stored
2. Later, complete message with `tool_start` arrives with `source: 'complete'`
3. `replaceStreamEventIfNeeded` finds old `stream` event
4. `shouldReplaceEvent('stream', 'complete')` = true (2 >= 1)
5. Old event deleted, new event stored ✅

### Session History Loading

1. All events have `source: 'history'`
2. Each toolCallId is unique (no duplicates)
3. `replaceStreamEventIfNeeded` finds no existing event
4. Returns undefined → event is stored ✅

---

## Files Modified

### Phase 5 (Session History Fix)

1. **`libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`**
   - Removed event storage from before switch statement
   - Added `indexEventByMessage()` helper method
   - Updated all case handlers to store events explicitly
   - Fixed `tool_start` and `tool_result` to check BEFORE storing

### Phase 6 (Live Streaming Fix)

2. **`libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`**
   - Fixed `agent_start.parentToolUseId` in complete message handler (line 604): `block.id` instead of `parent_tool_use_id`
   - Added `agent_start` emission during streaming `content_block_start` for Task tools
   - Agent bubble now appears immediately during streaming (not just on complete)

---

## Verification Status

- [x] Typecheck passes (`npm run typecheck:all`)
- [x] Build passes (`npm run build:all`)
- [ ] Manual testing: Session history loads with all tools displayed
- [ ] Manual testing: Live streaming works correctly
- [ ] Manual testing: Sub-agent executions display with nested tools

---

## Next Steps

1. **User Testing Required**

   - Reload VS Code extension
   - Load a session with Task tool (sub-agent)
   - Verify nested tools (Glob, Read, Bash, etc.) display inside agent bubble

2. **After Verification**
   - Remove diagnostic logging from:
     - `streaming-handler.service.ts`
     - `execution-tree-builder.service.ts`

---

## Diagnostic Logs to Remove (After Testing)

### streaming-handler.service.ts

- `[StreamingHandlerService] MESSAGE_START received!`
- `[StreamingHandlerService] TOOL_START received!`
- `[StreamingHandlerService] TOOL_RESULT received!`
- `[StreamingHandlerService] AGENT_START received!`

### execution-tree-builder.service.ts

- `[ExecutionTreeBuilderService] buildTree called:`
- `[ExecutionTreeBuilderService] buildTree cache HIT/MISS`
- `[ExecutionTreeBuilderService] collectTools:`

---

## Related Context

### Previous Phases Completed

- Phase 1: Fixed tool_result routing (session ID consistency)
- Phase 2: Added event source tracking (`source: 'stream' | 'complete' | 'history'`)
- Phase 3: Removed messageId mismatch hack
- Phase 4: Fixed nested agent display (depth-based filtering in collectTools)
- Phase 5: Fixed self-deletion bug in event storage
- Phase 6: **THIS FIX** - Fixed live streaming `parentToolUseId` for agent_start events

### Key Insight (Phase 5)

The deduplication logic in `replaceStreamEventIfNeeded` was designed to handle the case where streaming events get replaced by complete events. But because event storage happened BEFORE the check, it would find and delete the newly stored event itself!

### Key Insight (Phase 6)

The `agent_start` events during live streaming had `parentToolUseId: undefined` because the SDK message transformer was using `parent_tool_use_id` (the parent of the Task tool) instead of `block.id` (the Task tool's own toolCallId). The tree builder needs `agent_start.parentToolUseId === toolStart.toolCallId` to link them.

---

## Phase 6: Fix Live Streaming (parentToolUseId)

### The Bug Location

**File:** `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

### What Was Happening

1. During live streaming, `content_block_start` emitted `tool_start` for Task tools
2. Complete messages emitted both `tool_start` and `agent_start`
3. **BUT** `agent_start.parentToolUseId` was set to `parent_tool_use_id ?? undefined`
4. For top-level messages, `parent_tool_use_id` is undefined → `agent_start.parentToolUseId = undefined`
5. Tree builder couldn't link agent to Task tool: `agent_start.parentToolUseId === toolStart.toolCallId` → false!

### Evidence from Logs

```
AGENT_START received! {... parentToolUseId: undefined, toolCallId: 'toolu_bdrk_xxx' ...}
```

### The Fix Applied

**In `sdk-message-transformer.ts`:**

1. **For complete messages (line 604)**: Changed from `parent_tool_use_id ?? undefined` to `block.id`

```typescript
// BEFORE (broken):
parentToolUseId: parent_tool_use_id ?? undefined,

// AFTER (fixed):
parentToolUseId: block.id, // Link to parent Task tool
```

2. **For streaming (content_block_start)**: Added `agent_start` emission during streaming for Task tools

```typescript
if (isTaskTool) {
  const agentStartEvent: AgentStartEvent = {
    id: generateEventId(),
    eventType: 'agent_start',
    timestamp: Date.now(),
    sessionId: sessionId || '',
    source: 'stream' as EventSource,
    messageId: this.currentMessageId,
    toolCallId: contentBlock.id,
    agentType: 'unknown', // Will be updated when input_json_delta arrives
    parentToolUseId: contentBlock.id, // Link to parent Task tool
  };
  events.push(agentStartEvent);
}
```

### Why This Works

**Session History** (via `session-history-reader.service.ts`):

- Already sets `parentToolUseId = toolCallId` correctly
- Tree builder finds agent via `agent_start.parentToolUseId === toolStart.toolCallId` ✓

**Live Streaming** (via `sdk-message-transformer.ts`):

- Now ALSO sets `parentToolUseId = block.id` (same as `toolCallId`)
- Tree builder finds agent via `agent_start.parentToolUseId === toolStart.toolCallId` ✓

**Regular Tools** (Bash, Read, Glob, etc.):

- Only emit `tool_start` (no `agent_start`)
- Tree builder handles them via normal `buildToolNode` path ✓

---

## Test Session for Verification

Use session: `a4298fde-556e-4717-a54c-d7ac70e5ac15`

- Contains 1 Task tool with sub-agent
- Sub-agent has 7 nested tools: Glob, Read (3x), Bash, Grep

Expected display:

```
User message: [question]
Assistant message:
  └─ Task tool (agent-a8aed93)
       ├─ Glob tool
       │    └─ [file list result]
       ├─ Read tool
       │    └─ [file content]
       ├─ Bash tool
       │    └─ [command output]
       ├─ Read tool (x2 more)
       └─ Grep tool
            └─ [search results]
```
