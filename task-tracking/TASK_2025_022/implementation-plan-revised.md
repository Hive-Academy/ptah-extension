# Implementation Plan (REVISED) - TASK_2025_022

**Last Updated**: 2025-11-24
**Status**: Architecture Pivot - Single Unified Message Type
**Complexity**: MEDIUM (3-4 hours implementation)

---

## Architecture Change Rationale

### Why We Pivoted

**Previous Approach (REJECTED)**: Create 8 separate postMessage types (`streaming:content`, `streaming:thinking`, `streaming:tool`, etc.) that split JSONL messages by event type.

**Problem Identified**: This approach recreated the exact EventBus anti-pattern we deleted in TASK_2025_021 Phase 0:

- Splitting unified messages into separate event types
- Duplicating discrimination logic between backend and frontend
- Creating 8 separate message handlers instead of 1
- Losing the "message-centric" philosophy documented in streaming-architecture-philosophy.md

**New Approach (APPROVED)**: Single unified `jsonl-message` postMessage type that forwards the parsed JSONL object directly.

**Key Insight**: The backend should parse JSONL ONCE and forward the typed object. The frontend discriminates based on the JSONL structure's `type` field. This preserves the message-centric architecture and keeps discrimination logic in one place (frontend).

---

## Core Principle

### Message Flow Philosophy

```
Backend Responsibility: Parse JSONL once, forward typed object AS-IS
Frontend Responsibility: Discriminate based on JSONL message.type field
Contract: Single postMessage type with complete JSONL structure
```

**Evidence Source**: `task-tracking/TASK_2025_022/streaming-architecture-philosophy.md` lines 8-34

> "The whole purpose of this extension is to make a beautiful GUI for Claude's message stream."

**Architectural Alignment**:

- ✅ Message-centric (not event-centric)
- ✅ 3-hop architecture: CLI → Parser → Webview → Frontend
- ✅ Zero transformation layers
- ✅ Single discrimination point (frontend)
- ✅ Real-time streaming preserved

---

## Backend Architecture

### 1. Parser Simplification (jsonl-stream-parser.ts)

**Current State** (lines 153-165):

```typescript
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void;
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onMessageStop?: () => void;
  onResult?: (result: JSONLResultMessage) => void;
  onError?: (error: Error, rawLine?: string) => void;
}
```

**New Simplified Interface**:

```typescript
export interface JSONLParserCallbacks {
  /** Single callback for all parsed JSONL messages (forwarded to webview) */
  onMessage: (message: JSONLMessage, sessionId?: string) => void;

  /** Permission requests require special handling (user input) */
  onPermission?: (request: ClaudePermissionRequest) => void;

  /** Errors handled separately for logging/debugging */
  onError?: (error: Error, rawLine?: string) => void;
}
```

**Why Simpler**:

1. **No Backend Interpretation**: Parser doesn't construct ClaudeContentChunk, ClaudeThinkingEvent, etc.
2. **Direct Forwarding**: Parser validates JSON, calls onMessage with typed object
3. **Frontend Has Full Context**: Frontend receives complete JSONL structure
4. **Single Callback**: Eliminates callback routing complexity

**Changes Required**:

- **REMOVE**: All callback constructors (onContent, onThinking, onTool, onAgentStart, onAgentActivity, onAgentComplete, onMessageStop, onResult)
- **REMOVE**: ClaudeContentChunk, ClaudeThinkingEvent, ClaudeToolEvent construction logic
- **KEEP**: JSON parsing, validation, error handling
- **KEEP**: Agent correlation logic (activeAgents Map) - needed for parent_tool_use_id tracking
- **ADD**: Single onMessage callback that receives parsed JSONLMessage

**Implementation Pattern**:

```typescript
// In handleMessage() method (line 261)
private handleMessage(json: JSONLMessage): void {
  // Validate JSON structure
  if (!this.isValidMessage(json)) {
    this.callbacks.onError?.(new Error('Invalid JSONL structure'), JSON.stringify(json));
    return;
  }

  // Special case: Permission requests need user interaction
  if (json.type === 'permission') {
    const request: ClaudePermissionRequest = {
      toolCallId: json.tool_call_id,
      tool: json.tool,
      args: json.args,
      description: json.description,
      timestamp: Date.now(),
    };
    this.callbacks.onPermission?.(request);
    return;
  }

  // Forward all other message types directly
  this.callbacks.onMessage(json);
}
```

**Evidence for Agent Correlation**:

- Parser maintains `activeAgents` Map for tracking Task tool parent_tool_use_id
- Frontend needs this correlation to display agent activity correctly
- Keep this logic in parser, expose via message metadata

---

### 2. Launcher Integration (claude-cli-launcher.ts)

**Current State** (lines 322-416):

```typescript
const callbacks: JSONLParserCallbacks = {
  onSessionInit: (claudeSessionId, model) => {
    // TODO comments with sessionManager/eventPublisher calls
  },
  onContent: (chunk) => {
    // TODO comments with sessionManager/eventPublisher calls
    pushWithBackpressure({ type: 'content', data: chunk });
  },
  // ... 8 more callbacks
};
```

**New Simplified Callbacks**:

```typescript
const callbacks: JSONLParserCallbacks = {
  onMessage: (message: JSONLMessage) => {
    // Single postMessage call - forward parsed JSONL directly
    this.deps.webview.postMessage({
      type: 'jsonl-message',
      data: {
        sessionId,
        message, // Complete JSONL object with type field
      },
    });
  },

  onPermission: async (request) => {
    // Keep existing permission handling (user interaction required)
    await this.handlePermissionRequest(sessionId, request, childProcess);
  },

  onError: (error, rawLine) => {
    // Keep existing error handling (debugging/logging)
    console.error('[ClaudeCliLauncher] Parser error:', error.message);
  },
};
```

**Changes Required**:

- **REMOVE**: All 10 separate callbacks (onSessionInit, onContent, onThinking, onTool, onAgentStart, onAgentActivity, onAgentComplete, onMessageStop, onResult, onError)
- **REMOVE**: All TODO comments (Phase 2 RPC restoration)
- **REMOVE**: pushWithBackpressure calls for individual event types
- **ADD**: Single onMessage callback that calls webview.postMessage
- **KEEP**: onPermission handler (permissions require user interaction)
- **KEEP**: onError handler (error logging)
- **UPDATE**: LauncherDependencies to include webview (already exists - line 27)

**Message Flow Simplification**:

```
BEFORE (8 separate postMessage calls):
Claude CLI stdout → Parser → 8 callbacks → 8 postMessage calls → Frontend router

AFTER (1 unified postMessage call):
Claude CLI stdout → Parser → onMessage → 1 postMessage call → Frontend discriminates
```

**Evidence for Webview Access**:

- LauncherDependencies already includes `readonly webview: vscode.Webview` (line 27)
- No additional dependency changes required

---

### 3. Webview Provider Integration (claude-webview-provider.ts)

**Changes Required**:

- **UPDATE**: Pass webview instance to ClaudeCliLauncher via LauncherDependencies
- **VERIFY**: Webview is available during launcher construction

**Implementation Pattern**:

```typescript
// In webview provider, when creating launcher
const launcherDependencies: LauncherDependencies = {
  webview: this._view.webview, // VS Code webview instance
  permissionService: this.permissionService,
  processManager: this.processManager,
  context: this.context,
};

const launcher = new ClaudeCliLauncher(installation, launcherDependencies);
```

**Estimated Changes**: ~10 lines (minimal - webview already accessible)

---

## Frontend Architecture

### 4. Message Router (vscode.service.ts)

**Current State**: No streaming message handling (RPC Phase 3.5 gap)

**New Single Handler**:

```typescript
// Add to VSCodeService constructor (message listener)
window.addEventListener('message', (event) => {
  const message = event.data;

  // Existing RPC message handling...
  if (message.type === 'rpc:response') {
    // ... existing code
  }

  // NEW: Unified JSONL message handler
  if (message.type === 'jsonl-message') {
    const { sessionId, message: jsonlMessage } = message.data;
    this.handleJSONLMessage(sessionId, jsonlMessage);
  }
});

/**
 * Discriminate JSONL messages based on type field
 * Routes to ChatStoreService for state updates
 */
private handleJSONLMessage(sessionId: SessionId, message: JSONLMessage): void {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init' && message.session_id) {
        this.chatStoreService.handleSessionInit(sessionId, message.session_id, message.model);
      }
      break;

    case 'assistant':
      this.chatStoreService.handleAssistantMessage(sessionId, message);
      break;

    case 'tool':
      this.chatStoreService.handleToolMessage(sessionId, message);
      break;

    case 'permission':
      this.chatStoreService.handlePermissionRequest(sessionId, message);
      break;

    case 'stream_event':
      this.chatStoreService.handleStreamEvent(sessionId, message);
      break;

    case 'result':
      this.chatStoreService.handleResult(sessionId, message);
      break;

    default:
      console.warn('[VSCodeService] Unknown JSONL message type:', message);
  }
}
```

**Discrimination Logic**:

- **assistant**: Check if `thinking` present → thinking block, else content block
- **assistant.message.content[]**: Array of ContentBlock objects (text, tool_use)
- **tool**: Discriminate by `subtype` (start, progress, result, error)
- **tool.parent_tool_use_id**: Check if parent is active agent (for agent activity correlation)
- **stream_event**: Discriminate by `event.type` (message_start, content_block_delta, message_stop)

**Why Frontend Discriminates**:

1. **Single Point of Logic**: All discrimination in one place (easier to maintain)
2. **Type Safety**: TypeScript discriminated unions work naturally
3. **No Duplication**: Backend doesn't duplicate discrimination
4. **Full Context**: Frontend has complete JSONL structure for decisions

**Estimated Changes**: ~80 lines (message router + discrimination switch)

---

### 5. State Management (chat-store.service.ts)

**New Signal Update Methods**:

```typescript
/**
 * Handle assistant messages (thinking vs content discrimination)
 */
handleAssistantMessage(sessionId: SessionId, message: JSONLAssistantMessage): void {
  // Thinking content
  if (message.thinking) {
    this.appendThinkingBlock(sessionId, {
      type: 'thinking',
      thinking: message.thinking,
      index: message.index,
    });
    return;
  }

  // Convert JSONL to ContentBlock array
  const blocks: ContentBlock[] = [];

  if (message.delta) {
    blocks.push({ type: 'text', text: message.delta, index: message.index });
  }

  if (message.content) {
    blocks.push({ type: 'text', text: message.content, index: message.index });
  }

  // Messages API format (message.content array)
  if (message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text) {
        blocks.push({ type: 'text', text: block.text, index: message.index });
      } else if (block.type === 'tool_use' && block.id && block.name) {
        blocks.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input || {},
          index: message.index,
        });
      }
    }
  }

  // Update signal with content blocks
  if (blocks.length > 0) {
    this.appendContentBlocks(sessionId, blocks);
  }

  // Agent activity correlation (if parent_tool_use_id present)
  if (message.parent_tool_use_id) {
    this.correlateAgentActivity(sessionId, message.parent_tool_use_id, message);
  }
}

/**
 * Handle tool messages (timeline + agent correlation)
 */
handleToolMessage(sessionId: SessionId, message: JSONLToolMessage): void {
  if (!message.tool_call_id || !message.subtype) {
    return;
  }

  // Update tool timeline signal
  switch (message.subtype) {
    case 'start':
      this.addToolEvent(sessionId, {
        type: 'start',
        toolCallId: message.tool_call_id,
        tool: message.tool || 'unknown',
        args: message.args || {},
        timestamp: Date.now(),
      });
      break;

    case 'result':
      this.addToolEvent(sessionId, {
        type: 'result',
        toolCallId: message.tool_call_id,
        output: message.output,
        duration: 0,
        timestamp: Date.now(),
      });
      break;

    case 'error':
      this.addToolEvent(sessionId, {
        type: 'error',
        toolCallId: message.tool_call_id,
        error: message.error || 'Unknown error',
        timestamp: Date.now(),
      });
      break;
  }

  // Agent activity correlation (if parent_tool_use_id present)
  if (message.parent_tool_use_id) {
    this.correlateToolActivity(sessionId, message.parent_tool_use_id, message);
  }

  // Task tool lifecycle tracking (agent start/complete)
  if (message.tool === 'Task') {
    this.handleTaskToolLifecycle(sessionId, message);
  }
}

/**
 * Handle permission requests
 */
handlePermissionRequest(sessionId: SessionId, message: JSONLPermissionMessage): void {
  if (message.subtype !== 'request') {
    return;
  }

  // Update signal with permission dialog state
  this.showPermissionDialog(sessionId, {
    toolCallId: message.tool_call_id,
    tool: message.tool,
    args: message.args,
    description: message.description,
    timestamp: Date.now(),
  });
}

/**
 * Handle stream control events
 */
handleStreamEvent(sessionId: SessionId, message: JSONLStreamEvent): void {
  switch (message.event.type) {
    case 'message_start':
      this.startStreamingMessage(sessionId, message.session_id, message.event.message?.model);
      break;

    case 'content_block_delta':
      if (message.event.delta?.type === 'text_delta' && message.event.delta.text) {
        this.appendContentBlocks(sessionId, [{
          type: 'text',
          text: message.event.delta.text,
          index: message.event.index,
        }]);
      }
      break;

    case 'message_stop':
      this.completeStreamingMessage(sessionId);
      break;
  }
}

/**
 * Handle final result (cost, usage, duration)
 */
handleResult(sessionId: SessionId, message: JSONLResultMessage): void {
  this.updateSessionMetrics(sessionId, {
    duration: message.duration_ms,
    cost: message.total_cost_usd,
    tokens: message.usage,
    modelUsage: message.modelUsage,
  });

  const reason = message.subtype === 'success' ? 'completed' : 'error';
  this.endSession(sessionId, reason);
}

/**
 * Correlate agent activity from assistant messages with parent_tool_use_id
 * Frontend maintains activeAgents Map (parallel to parser's Map)
 */
private correlateAgentActivity(
  sessionId: SessionId,
  parentToolUseId: string,
  message: JSONLAssistantMessage
): void {
  const agent = this.activeAgents().get(parentToolUseId);
  if (!agent) {
    // Not an agent, just a nested tool call
    return;
  }

  // Extract tool information from message content
  if (message.message?.content) {
    for (const block of message.message.content) {
      if (block.type === 'tool_use' && block.name) {
        this.addAgentActivity(sessionId, {
          agentId: parentToolUseId,
          toolName: block.name,
          toolInput: block.input || {},
          timestamp: Date.now(),
        });
      }
    }
  }
}
```

**State Signals Required**:

- `currentSessionId()` - Active session
- `messages()` - Array of ProcessedClaudeMessage
- `toolTimeline()` - Array of tool events
- `activeAgents()` - Map of agent metadata (parallel to parser's activeAgents)
- `permissionDialog()` - Permission request state
- `sessionMetrics()` - Cost, usage, duration

**Estimated Changes**: ~120 lines (5 handler methods + helper methods)

---

## Agent Activity Correlation Strategy

### Problem: How to Track Agent Tools?

**Challenge**: Not all tools with `parent_tool_use_id` are agents. Only Task tools create agents.

**Solution**: Frontend maintains parallel `activeAgents` Map synchronized with backend parser's Map.

### Backend Parser (jsonl-stream-parser.ts)

**Agent Detection Logic** (lines 517-526):

```typescript
// When Task tool starts, add to activeAgents Map
if (message.tool === 'Task' && message.subtype === 'start') {
  this.activeAgents.set(message.tool_call_id, {
    agentId: message.tool_call_id,
    subagentType: args.subagent_type,
    description: args.description,
    prompt: args.prompt,
    model: args.model,
    startTime: timestamp,
  });
}

// When Task tool completes, remove from activeAgents Map
if (message.tool === 'Task' && message.subtype === 'result') {
  this.activeAgents.delete(message.tool_call_id);
}
```

### Frontend State (chat-store.service.ts)

**Parallel Agent Tracking**:

```typescript
// Signal for active agents Map
private activeAgentsSignal = signal<Map<string, AgentMetadata>>(new Map());

handleToolMessage(sessionId: SessionId, message: JSONLToolMessage): void {
  // Detect Task tool lifecycle
  if (message.tool === 'Task') {
    if (message.subtype === 'start') {
      // Add to activeAgents Map
      const agents = new Map(this.activeAgentsSignal());
      agents.set(message.tool_call_id, {
        agentId: message.tool_call_id,
        subagentType: message.args.subagent_type,
        description: message.args.description,
        prompt: message.args.prompt,
        model: message.args.model,
        startTime: Date.now(),
      });
      this.activeAgentsSignal.set(agents);
    } else if (message.subtype === 'result') {
      // Remove from activeAgents Map
      const agents = new Map(this.activeAgentsSignal());
      agents.delete(message.tool_call_id);
      this.activeAgentsSignal.set(agents);
    }
  }

  // Correlate agent activity (only if parent is active agent)
  if (message.parent_tool_use_id) {
    const agent = this.activeAgentsSignal().get(message.parent_tool_use_id);
    if (agent) {
      // This is agent activity - display in agent timeline
      this.addAgentActivity(sessionId, {
        agentId: message.parent_tool_use_id,
        toolName: message.tool,
        toolInput: message.args,
        timestamp: Date.now(),
      });
    }
  }
}
```

**Why This Works**:

- Frontend knows which tools are agents (Task tools only)
- Frontend can correlate child tools to parent agents
- Frontend can display agent activity timeline correctly
- No false agent activity events for regular nested tools

---

## Files Affected

### Backend Changes

**MODIFY** (3 files):

1. `D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\jsonl-stream-parser.ts` (~200 lines changed)

   - Remove 10 callback constructors
   - Add single onMessage callback
   - Keep agent correlation logic (activeAgents Map)
   - Simplify handleMessage() routing

2. `D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-cli-launcher.ts` (~100 lines changed)

   - Replace 10 callbacks with single onMessage
   - Remove all TODO comments
   - Add webview.postMessage call
   - Keep permission handler
   - Keep error handler

3. `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\webview\claude-webview-provider.ts` (~10 lines changed)
   - Verify webview passed to LauncherDependencies
   - No structural changes (webview already accessible)

### Frontend Changes

**MODIFY** (2 files): 4. `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts` (~80 lines added)

- Add jsonl-message handler in message listener
- Add handleJSONLMessage discrimination method
- Route to ChatStoreService based on message.type

5. `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat-store.service.ts` (~120 lines added)
   - Add handleAssistantMessage method
   - Add handleToolMessage method
   - Add handlePermissionRequest method
   - Add handleStreamEvent method
   - Add handleResult method
   - Add activeAgents signal
   - Add agent correlation logic

**Total Changes**: ~510 lines across 5 files

---

## Implementation Complexity

### Backend: SIMPLE

- **Remove complexity**: Delete 10 callbacks, add 1 callback
- **No new abstractions**: Just forwarding parsed objects
- **Estimated Time**: 1 hour

### Frontend: MEDIUM

- **New discrimination logic**: Switch statement on message.type
- **State management**: 5 new handler methods + signals
- **Agent correlation**: Parallel activeAgents Map tracking
- **Estimated Time**: 2-3 hours

### Integration: SIMPLE

- **Webview wiring**: Verify webview passed to launcher (already done)
- **Testing**: Verify all JSONL message types flow correctly
- **Estimated Time**: 0.5 hours

**Total Estimated Time**: 3.5-4.5 hours

---

## Success Criteria

### Backend Success

- ✅ Parser has single onMessage callback
- ✅ Parser calls onMessage with typed JSONLMessage object
- ✅ Launcher calls webview.postMessage once per message
- ✅ Single postMessage type: `jsonl-message`
- ✅ Permission requests still handled separately (user interaction)
- ✅ Error handling preserved (logging/debugging)

### Frontend Success

- ✅ VSCodeService receives jsonl-message events
- ✅ Discrimination logic in handleJSONLMessage works
- ✅ All 6 JSONL message types handled (system, assistant, tool, permission, stream_event, result)
- ✅ ChatStoreService signals updated correctly
- ✅ Agent activity correlation works (only Task tools tracked)
- ✅ No false agent activity for regular nested tools

### Integration Success

- ✅ Real-time streaming UX preserved
- ✅ Tool timeline displays correctly
- ✅ Agent timeline displays correctly (only real agents)
- ✅ Permission dialogs appear correctly
- ✅ Session metrics updated (cost, usage, duration)
- ✅ No message duplication
- ✅ No message loss
- ✅ Correct block ordering

---

## Architecture Benefits

### Compared to 8-Type Approach

**Complexity Reduction**:

- **8 postMessage types** → **1 postMessage type**
- **8 backend handlers** → **1 backend handler**
- **8 frontend receivers** → **1 frontend receiver + 1 switch**
- **Duplication eliminated**: Discrimination logic in ONE place (frontend)

**Message Flow Simplification**:

```
BEFORE (8-type approach):
CLI → Parser → 8 callbacks → 8 postMessage calls → 8 frontend handlers → state

AFTER (1-type approach):
CLI → Parser → onMessage → 1 postMessage call → frontend discriminates → state
```

**Maintainability**:

- **Single point of change**: Add new JSONL type? Update frontend switch only
- **Type safety**: TypeScript discriminated unions work naturally
- **Debugging**: Easier to trace single message flow
- **Testing**: Test 1 postMessage type instead of 8

**Alignment with Philosophy**:

- ✅ Message-centric (not event-centric)
- ✅ No message splitting
- ✅ No transformation layers
- ✅ Real-time streaming preserved
- ✅ Follows streaming-architecture-philosophy.md

---

## JSONL Message Types Reference

### All Types Claude CLI Sends

**Evidence Source**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` lines 17-124

```typescript
export type JSONLMessage =
  | JSONLSystemMessage // Session initialization
  | JSONLAssistantMessage // Thinking + content blocks
  | JSONLToolMessage // Tool execution lifecycle
  | JSONLPermissionMessage // Permission requests
  | JSONLStreamEvent // Streaming control (message_start, message_stop)
  | JSONLResultMessage; // Final result (cost, usage, duration)
```

### Discrimination Strategy

**Frontend switch logic**:

```typescript
switch (message.type) {
  case 'system': // Session init (session_id, model)
  case 'assistant': // Thinking vs content discrimination
  case 'tool': // Tool lifecycle + agent correlation
  case 'permission': // Permission dialog
  case 'stream_event': // Streaming control events
  case 'result': // Final metrics (cost, usage, duration)
}
```

**Nested Discrimination**:

- **assistant**: Check `thinking` field → thinking block, else content blocks
- **assistant.message.content[]**: Array of ContentBlock (text, tool_use)
- **tool**: Discriminate by `subtype` (start, progress, result, error)
- **tool.parent_tool_use_id**: Check if parent in activeAgents Map
- **stream_event**: Discriminate by `event.type` (message_start, content_block_delta, message_stop)

---

## Next Steps (Team-Leader)

### Task Decomposition

**Team-leader will create tasks.md with atomic, git-verifiable tasks:**

1. **Task 1: Simplify Parser** (backend-developer, 1 hour)

   - Remove 10 callback constructors
   - Add single onMessage callback
   - Keep activeAgents Map logic
   - Update handleMessage() routing
   - Git commit: `refactor(backend): simplify parser to single onMessage callback`

2. **Task 2: Update Launcher** (backend-developer, 1 hour)

   - Replace 10 callbacks with onMessage
   - Add webview.postMessage call
   - Remove TODO comments
   - Keep permission/error handlers
   - Git commit: `refactor(backend): launcher uses single postMessage type`

3. **Task 3: Wire Webview** (backend-developer, 0.5 hours)

   - Verify webview in LauncherDependencies
   - Test postMessage flow
   - Git commit: `feat(vscode): verify webview wired to launcher`

4. **Task 4: Frontend Message Router** (frontend-developer, 1 hour)

   - Add jsonl-message handler
   - Add handleJSONLMessage discrimination
   - Route to ChatStoreService
   - Git commit: `feat(webview): add jsonl message router with discrimination`

5. **Task 5: Frontend State Management** (frontend-developer, 2 hours)

   - Add 5 handler methods
   - Add activeAgents signal
   - Add agent correlation logic
   - Git commit: `feat(webview): add jsonl message state handlers`

6. **Task 6: Integration Testing** (senior-tester, 1 hour)
   - Test all 6 JSONL message types
   - Verify real-time streaming
   - Verify agent correlation
   - Verify no duplication
   - Git commit: `test(webview): verify jsonl message flow`

### Developer Type Recommendation

**Tasks 1-3**: backend-developer (backend changes)
**Tasks 4-5**: frontend-developer (frontend changes)
**Task 6**: senior-tester (integration testing)

**Total Complexity**: MEDIUM (3-4 hours core implementation + 1 hour testing)

---

## Critical Verification Points

### Before Implementation

**Team-leader must ensure developer verifies:**

1. **Parser Interface Change**:

   - Verify JSONLParserCallbacks definition (line 153)
   - Verify all callback call sites removed
   - Verify onMessage callback added

2. **Launcher Integration**:

   - Verify webview in LauncherDependencies (line 27)
   - Verify callbacks object simplified (line 322)
   - Verify postMessage call added

3. **Frontend Message Handling**:

   - Verify message listener in VSCodeService
   - Verify discrimination switch complete (6 cases)
   - Verify ChatStoreService handler methods

4. **Agent Correlation Logic**:

   - Verify activeAgents Map in frontend
   - Verify Task tool lifecycle tracking
   - Verify parent_tool_use_id correlation

5. **No EventBus Patterns**:
   - No message splitting
   - No separate event types
   - Single postMessage type only
   - Discrimination in frontend only

### After Implementation

**Quality Gates**:

- ✅ All tests pass
- ✅ Real-time streaming works
- ✅ Tool timeline displays correctly
- ✅ Agent timeline shows only Task tools
- ✅ No message duplication
- ✅ No console errors
- ✅ Performance acceptable (< 5ms per message)

---

## Architecture Delivery Checklist

- ✅ Core principle documented (message-centric, not event-centric)
- ✅ Backend simplification strategy defined (1 callback, not 10)
- ✅ Frontend discrimination logic designed (switch on message.type)
- ✅ Agent correlation strategy documented (parallel activeAgents Map)
- ✅ Files affected identified (5 files, ~510 lines)
- ✅ Complexity assessed (MEDIUM, 3-4 hours)
- ✅ Success criteria defined (functional + non-functional)
- ✅ Evidence citations provided (parser:153, launcher:322, philosophy:8-34)
- ✅ No backward compatibility (direct replacement)
- ✅ No EventBus patterns (aligned with philosophy)

---

## References

**Documentation**:

- `task-tracking/TASK_2025_022/streaming-architecture-philosophy.md` - Core principles
- `task-tracking/TASK_2025_022/claude-cli-streaming-formats.md` - JSONL message types
- `task-tracking/TASK_2025_022/anti-patterns-and-pitfalls.md` - EventBus warnings

**Code Files**:

- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` - Parser implementation
- `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts` - Launcher integration
- `libs/backend/claude-domain/CLAUDE.md` - Library architecture

**Evidence Lines**:

- Parser callbacks: `jsonl-stream-parser.ts:153-165`
- Launcher callbacks: `claude-cli-launcher.ts:322-416`
- Agent correlation: `jsonl-stream-parser.ts:517-526`
- Message-centric principle: `streaming-architecture-philosophy.md:8-34`

---

## Conclusion

**This revised architecture is SIMPLER than the 8-type approach:**

- ✅ 1 postMessage type instead of 8
- ✅ 1 backend callback instead of 10
- ✅ Single discrimination point (frontend)
- ✅ Aligned with message-centric philosophy
- ✅ No EventBus patterns recreated
- ✅ Real-time streaming preserved

**Estimated implementation**: 3-4 hours core work + 1 hour testing = **4-5 hours total**

**Ready for team-leader decomposition into atomic tasks.**
