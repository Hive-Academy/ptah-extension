# TASK_2025_094: Session History Sub-Agent Rendering Fix

## Problem Statement

When loading historical sessions containing Task tool invocations, the nested agent execution was not displaying properly. Task tools appeared as collapsed normal tools instead of showing the agent bubble with nested execution content.

**User Quote:**

> "i do believe its much bigger than what you are trying to fix and is complex and extended from backend to frontend and how we build the executionTree"

---

## Investigation Timeline

### Phase 1: Initial Context (from TASK_2025_093)

Previous session had made fixes for:

1. Timestamp extraction bug (using `null` flag instead of `Date.now()`)
2. Warmup agent filtering (checking first message content instead of message count)
3. Created `SessionHistoryMessage` type extending `JSONLMessage`

Backend was generating 134 events with correlation working, but UI showed:

- Empty message bubbles
- Task tools appearing as normal tools (not agent nodes)

### Phase 2: Empty Message Bubble Fix

**Finding:** `finalizeSessionHistory` in `streaming-handler.service.ts` iterated over ALL messageIds including nested agent messages, but `buildTree` only returns root nodes.

**Fix Applied (lines 686-699):**

```typescript
// TASK_2025_093 FIX: Skip nested agent messages
if (messageStartEvent.parentToolUseId) {
  console.debug('[StreamingHandlerService] Skipping nested agent message', {
    messageId,
    parentToolUseId: messageStartEvent.parentToolUseId,
  });
  continue;
}
```

**Result:** Empty message bubbles resolved, but Task tools still not showing as agents.

### Phase 3: Deep Pipeline Investigation

Traced the complete event flow:

```
Backend (session-history-reader.service.ts)
    ↓ Creates: tool_start, agent_start, message_start (with parentToolUseId)
    ↓
RPC Handler (chat-rpc.handlers.ts)
    ↓ Returns events to frontend
    ↓
StreamingHandler (streaming-handler.service.ts)
    ↓ Stores events in state.events Map
    ↓
ExecutionTreeBuilder (execution-tree-builder.service.ts)
    ↓ buildTree() → buildMessageNode() → buildToolNode() → buildToolChildren()
    ↓
ExecutionNodeComponent
    ↓ Renders based on node.type ('tool', 'agent', 'message', etc.)
    ↓
InlineAgentBubbleComponent (expects type: 'agent')
```

### Phase 4: Root Cause Identification

**Location:** `execution-tree-builder.service.ts:buildToolChildren()`

**The Bug:**

```typescript
// OLD CODE - WRONG!
for (const agentStart of agentStarts) {
  const agentMessageIds = [...state.events.values()].filter((e) => e.eventType === 'message_start' && e.parentToolUseId === toolCallId).map((e) => e.messageId);

  for (const msgId of agentMessageIds) {
    const messageNode = this.buildMessageNode(msgId, state, depth + 1);
    if (messageNode) {
      children.push(messageNode); // <-- WRONG: Pushing MESSAGE nodes!
    }
  }
}
```

**The Problem:**

- Code found `agent_start` events correctly
- Code found nested `message_start` events correctly
- But it built MESSAGE nodes and added them directly as children
- The `agent_start` event was never used to create an AGENT type node!

**Expected Structure:**

```
Task Tool (type: 'tool')
└── Agent Node (type: 'agent')  <-- Missing!
    ├── Text Node
    ├── Tool Node
    └── etc.
```

**Actual Structure:**

```
Task Tool (type: 'tool')
└── Message Node (type: 'message')  <-- Wrong type!
    ├── Text Node
    ├── Tool Node
    └── etc.
```

Since `ExecutionNodeComponent` renders `type: 'agent'` with `InlineAgentBubbleComponent` and `type: 'message'` just unwraps to children, the agent bubble never appeared.

---

## The Fix

**File:** `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`

**Method:** `buildToolChildren()`

**Changes:**

```typescript
// NEW CODE - CORRECT!
for (const agentStart of agentStarts) {
  const agentMessageStarts = [...state.events.values()]
    .filter((e) => e.eventType === 'message_start' && e.parentToolUseId === toolCallId)
    as MessageStartEvent[];

  // Build children for the agent node (the nested message content)
  const agentChildren: ExecutionNode[] = [];

  for (const msgStart of agentMessageStarts) {
    const messageNode = this.buildMessageNode(msgStart.messageId, state, depth + 1);
    if (messageNode) {
      // Unwrap message node - agent shows its content directly
      agentChildren.push(...messageNode.children);
    }
  }

  // Create the AGENT node from agent_start event
  const agentNode = createExecutionNode({
    id: agentStart.id,
    type: 'agent',  // <-- Correct type!
    status: agentChildren.length > 0 ? 'complete' : 'streaming',
    content: agentStart.agentDescription || '',
    children: agentChildren,
    startTime: agentStart.timestamp,
    agentType: agentStart.agentType,
    agentDescription: agentStart.agentDescription,
  });

  children.push(agentNode);
}
```

**Key Changes:**

1. Create an AGENT type node from `agent_start` event
2. Set `agentType` and `agentDescription` from the event
3. Unwrap message children and add them to the agent node
4. Push the AGENT node (not MESSAGE node) as the tool's child

---

## Diagnostic Logging Added

To trace the issue and verify the fix, comprehensive logging was added:

### Backend (`session-history-reader.service.ts`)

```typescript
this.logger.info('[SessionHistoryReader] Creating TASK TOOL events:', {
  toolCallId,
  blockId,
  messageId,
  input,
});

this.logger.info('[SessionHistoryReader] Creating AGENT_START:', {
  toolCallId,
  parentToolUseId,
  agentId,
  hasCorrelation,
});

this.logger.info('[SessionHistoryReader] Created NESTED EVENTS:', {
  toolCallId,
  nestedEventCount,
  nestedEventTypes,
  nestedParentToolUseIds,
});
```

### Frontend (`streaming-handler.service.ts`)

```typescript
console.log('[StreamingHandlerService] MESSAGE_START received!', {
  id,
  messageId,
  parentToolUseId,
  isNestedAgentMessage,
  role,
  sessionId,
});

console.log('[StreamingHandlerService] AGENT_START received!', {
  id,
  toolCallId,
  parentToolUseId,
  agentType,
  sessionId,
});

console.log('[StreamingHandlerService] TOOL_START received!', {
  id,
  toolName,
  toolCallId,
  messageId,
  parentToolUseId,
  isTaskTool,
  sessionId,
});
```

### Frontend (`execution-tree-builder.service.ts`)

```typescript
console.log('[ExecutionTreeBuilder] buildToolChildren - SEARCHING:', {
  searchingForToolCallId,
  depth,
  totalEventsInState,
  eventsWithThisParentToolUseId,
  allAgentStartsCount,
  allNestedMessageStartsCount,
});

console.log('[ExecutionTreeBuilder] buildToolChildren - CREATED agent node:', {
  toolCallId,
  agentNodeId,
  agentType,
  childrenCount,
});
```

---

## Files Modified

| File                                                                          | Change Type | Description                                  |
| ----------------------------------------------------------------------------- | ----------- | -------------------------------------------- |
| `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`       | **FIX**     | Create AGENT nodes from `agent_start` events |
| `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts` | Diagnostic  | Added logging for event processing           |
| `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`            | Diagnostic  | Added logging for event creation             |

---

## Architecture Insight

### Event Flow for Task Tools

```
1. Backend: JSONL Processing
   └── Task tool_use block detected
       ├── Create tool_start (toolName: 'Task', toolCallId: X)
       ├── Create agent_start (parentToolUseId: X, agentType: 'Explore')
       ├── Create nested message_start (parentToolUseId: X)
       ├── Create nested text_delta (parentToolUseId: X)
       ├── Create nested tool_start (parentToolUseId: X)
       └── Create tool_result

2. Frontend: Event Storage
   └── All events stored in state.events Map
       └── Events indexed by messageId in eventsByMessage

3. Frontend: Tree Building
   └── buildTree() iterates messageEventIds (root messages only)
       └── buildMessageNode() creates message with children
           └── buildToolNode() for each tool_start
               └── buildToolChildren() for Task tools
                   └── Creates AGENT node with nested content

4. Frontend: Rendering
   └── ExecutionNodeComponent
       └── @case ('tool') → ToolCallItemComponent
           └── Renders children inside tool card
               └── @case ('agent') → InlineAgentBubbleComponent
                   └── Shows agent type, description, nested execution
```

### Key Type Relationships

```typescript
// ExecutionNode.type determines rendering:
type: 'message' → Unwraps to children
type: 'tool'    → ToolCallItemComponent (with nested children)
type: 'agent'   → InlineAgentBubbleComponent (agent bubble)
type: 'text'    → Markdown or AgentSummary
type: 'thinking' → ThinkingBlockComponent
```

---

## Testing Checklist

- [ ] Load session with single Task tool invocation
- [ ] Load session with multiple Task tool invocations
- [ ] Load session with nested Task tools (agent spawning agents)
- [ ] Verify agent bubble displays with correct agentType
- [ ] Verify nested tools/text display inside agent bubble
- [ ] Verify live streaming still works correctly
- [ ] Verify no duplicate messages appear

---

## Related Tasks

- **TASK_2025_093**: Temp_id removal and session handling refactoring
- **TASK_2025_092**: Session ID resolution and tab routing
- **TASK_2025_091**: Message deduplication during streaming
- **TASK_2025_090**: Session cleanup and deduplication state management

---

## Phase 5: Message Stacking and Streaming Disconnection Fix

### Problem

After the initial fixes, a new issue emerged: messages were "stacking incorrectly" and the streaming tree building was broken. Investigation of `vscode-app-1766939225426.log` revealed:

1. **Multiple `chat:complete` events** - Sent after each `message_complete`, not just at turn end
2. **6-7 messageEventIds for 2 user messages** - Extra message IDs being created
3. **`tabId: undefined` during session resume** - Tab routing potentially broken

### Root Cause

**File:** `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

**The Bug:** The transformer prioritized `uuid` over `message.id`:

```typescript
// WRONG (TASK_2025_093 approach):
const messageId = sdkMessage.uuid || message?.id;
```

**Why This Breaks:**

- SDK sends **BOTH** `stream_event` AND `assistant` messages for the same response
- Each SDK message has a **DIFFERENT** `uuid`
- The Anthropic API's `message.id` (like `gen-1766961093-H9nAcWY4jRlYPHnMLdIi`) is **CONSISTENT** across both

**Evidence from Log:**

```
Line 789:  stream_event → messageId:"gen-1766961093-H9nAcWY4jRlYPHnMLdIi"
Line 1035: assistant    → messageId:"gen-1766961093-H9nAcWY4jRlYPHnMLdIi" (SAME!)
Line 1082: assistant    → messageId:"gen-1766961093-H9nAcWY4jRlYPHnMLdIi" (SAME!)
```

**Impact:**

1. **Tool linking broken:** `tool_start` and `tool_result` events had different messageIds
2. **Deduplication failed:** Same content added twice with different messageIds
3. **Tree building scattered:** Events for same message split across multiple messageIds

### The Fix

**File:** `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

Changed priority order in two places:

1. **`transformStreamEventToFlatEvents`** (lines 182-196):

```typescript
// TASK_2025_094 FIX: Use Anthropic API's message.id for stable correlation
const messageId = message?.id || sdkMessage.uuid || `stream-msg-${Date.now()}`;
```

2. **`transformAssistantToFlatEvents`** (lines 527-534):

```typescript
// TASK_2025_094 FIX: Use Anthropic API's message.id for stable correlation
const messageId = message?.id || uuid;
```

**Why This Works:**

- `message.id` is the Anthropic API's stable identifier
- Consistent across `stream_event` and `assistant` messages for the same response
- Frontend deduplication now works (same messageId = duplicate detection triggers)
- Tool linking works (tool_start and tool_result share same messageId context)

### Architecture Understanding

**SDK Message Flow:**

```
User sends message
    ↓
SDK starts streaming (stream_event messages)
    ├── message_start (uuid=A, message.id="gen-123")
    ├── text_delta (uuid=B, references message.id="gen-123")
    ├── tool_use (uuid=C, message.id="gen-123")
    └── message_stop (uuid=D, message.id="gen-123")
    ↓
SDK sends complete assistant message
    └── assistant (uuid=E, message.id="gen-123")  ← SAME message.id!
    ↓
Tool executes, SDK sends user message with tool_result
    └── user (uuid=F, tool_result block)
    ↓
SDK sends follow-up assistant response
    └── stream_event messages (new message.id="gen-456")
    └── assistant (uuid=G, message.id="gen-456")
```

**Key Insight:** `message.id` stays constant for the same logical response, while `uuid` is unique per SDK message envelope.

---

## Lessons Learned

1. **End-to-End Tracing is Essential**: The issue spanned 4+ files across backend and frontend. Only by tracing the complete flow was the root cause found.

2. **Type System Matters**: The `ExecutionNode.type` field directly controls rendering. Building the wrong type caused the visual issue.

3. **Event Architecture**: The flat event → tree transformation is powerful but complex. The `parentToolUseId` linkage is critical for nesting.

4. **Diagnostic Logging**: Adding comprehensive logging at each stage made it possible to verify the fix works correctly.

5. **User Intuition**: The user correctly identified this as a complex end-to-end issue, not a simple fix.
