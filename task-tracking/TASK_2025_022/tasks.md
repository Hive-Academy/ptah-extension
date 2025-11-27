# Development Tasks - TASK_2025_022 (REVISED)

**Task Type**: Full-Stack Implementation (Backend + Frontend)
**Total Tasks**: 6
**Total Batches**: 3
**Batching Strategy**: Layer-based (Backend) + Feature-based (Frontend)
**Status**: 0/3 batches complete (0%)

**Architecture**: Unified JSONL message streaming with single postMessage type
**Core Principle**: Parse once (backend), forward typed object, discriminate once (frontend)

---

## Batch 1: Backend Parser & Launcher Simplification (Backend Foundation) 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Tasks in Batch**: 3
**Dependencies**: None (foundation layer)
**Estimated Duration**: 2.5 hours
**Estimated Commits**: 3

### Task 1.1: Simplify JSONLStreamParser - Remove 10 Callbacks, Add 1 Unified Callback 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\jsonl-stream-parser.ts
**Specification Reference**: implementation-plan-revised.md:54-138
**Current State**: Lines 153-165 (JSONLParserCallbacks interface with 11 callbacks)
**Expected Commit Pattern**: `refactor(vscode): simplify parser to single onMessage callback`

**Quality Requirements**:

- ✅ Replace JSONLParserCallbacks interface (remove 11 callbacks, add 1 onMessage)
- ✅ Keep onPermission (special case - user interaction)
- ✅ Keep onError (special case - debugging/logging)
- ✅ Remove all ClaudeContentChunk, ClaudeThinkingEvent construction logic
- ✅ Keep activeAgents Map (needed for agent correlation)
- ✅ Call onMessage(jsonlMessage) for ALL parsed messages except permissions
- ✅ Simplify handleMessage() routing logic

**Implementation Details**:

**BEFORE (Current - lines 153-165)**:

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

**AFTER (New - simplified)**:

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

**Key Code Changes**:

1. **Remove callback constructors** (delete ~150 lines):

   - Remove onSessionInit constructor
   - Remove onContent constructor (ClaudeContentChunk construction)
   - Remove onThinking constructor (ClaudeThinkingEvent construction)
   - Remove onTool constructor (ClaudeToolEvent construction)
   - Remove onAgentStart constructor
   - Remove onAgentActivity constructor
   - Remove onAgentComplete constructor
   - Remove onMessageStop constructor
   - Remove onResult constructor

2. **Simplify handleMessage() method** (add ~20 lines):

```typescript
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

3. **Keep activeAgents Map** (no changes):
   - Parser maintains activeAgents Map for Task tool tracking
   - Frontend will use this for agent correlation
   - Evidence: implementation-plan-revised.md:531-559

**Verification Requirements**:

- ✅ JSONLParserCallbacks interface simplified (3 callbacks only)
- ✅ handleMessage() calls onMessage for all non-permission types
- ✅ activeAgents Map logic preserved
- ✅ No ClaudeContentChunk construction
- ✅ Git commit exists with proper commitlint format
- ✅ File changes verified via Read tool
- ✅ Build passes: `npx nx build claude-domain`

---

### Task 1.2: Update ClaudeCliLauncher - Replace 10 Callbacks with 1 postMessage Call 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-cli-launcher.ts
**Dependencies**: Task 1.1 (parser interface must be updated first)
**Specification Reference**: implementation-plan-revised.md:140-209
**Current State**: Lines 322-416 (callbacks object with 10 separate callbacks)
**Expected Commit Pattern**: `refactor(vscode): launcher uses single postMessage type`

**Quality Requirements**:

- ✅ Replace 10 callbacks with single onMessage callback
- ✅ Add webview.postMessage call (type: 'jsonl-message')
- ✅ Remove all TODO comments (Phase 2 RPC restoration)
- ✅ Keep onPermission handler (permissions require user interaction)
- ✅ Keep onError handler (error logging)
- ✅ Remove pushWithBackpressure calls for individual event types

**Implementation Details**:

**BEFORE (Current - lines 322-416)**:

```typescript
const callbacks: JSONLParserCallbacks = {
  onSessionInit: (claudeSessionId, model) => {
    // TODO: Phase 2 RPC - Restore via RPC
    this.deps.sessionManager?.setClaudeSessionId?.(sessionId, claudeSessionId);
    this.deps.eventPublisher?.emitSessionInit?.(sessionId, claudeSessionId, model);
  },

  onContent: (chunk) => {
    // TODO: Phase 2 RPC - Restore via RPC
    this.deps.sessionManager?.touchSession?.(sessionId);
    this.deps.eventPublisher?.emitContentChunk?.(sessionId, chunk.blocks);
    pushWithBackpressure({ type: 'content', data: chunk });
  },

  onThinking: (thinking) => {
    // TODO: Phase 2 RPC - Restore via RPC
    this.deps.eventPublisher?.emitThinking?.(sessionId, thinking);
    pushWithBackpressure({ type: 'thinking', data: thinking });
  },

  // ... 7 more callbacks with TODO comments
};
```

**AFTER (New - simplified)**:

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

**Key Code Changes**:

1. **Remove ALL 10 separate callbacks** (delete ~90 lines):

   - onSessionInit
   - onContent
   - onThinking
   - onTool
   - onAgentStart
   - onAgentActivity
   - onAgentComplete
   - onMessageStop
   - onResult
   - All TODO comments (Phase 2 RPC restoration)

2. **Add single onMessage callback** (add ~10 lines):

   - Forward complete JSONL object
   - Single postMessage type: 'jsonl-message'
   - Include sessionId for routing

3. **Verify webview access** (already exists - line 27):
   - LauncherDependencies includes `readonly webview: vscode.Webview`
   - No dependency changes required

**Message Flow Simplification**:

```
BEFORE (10 separate postMessage calls):
CLI stdout → Parser → 10 callbacks → 10 postMessage calls → Frontend router

AFTER (1 unified postMessage call):
CLI stdout → Parser → onMessage → 1 postMessage call → Frontend discriminates
```

**Verification Requirements**:

- ✅ Callbacks object simplified (3 callbacks only)
- ✅ Single postMessage call with type 'jsonl-message'
- ✅ All TODO comments removed
- ✅ Permission handler preserved
- ✅ Error handler preserved
- ✅ Git commit exists with proper commitlint format
- ✅ File changes verified via Read tool
- ✅ Build passes: `npx nx build claude-domain`

---

### Task 1.3: Verify Webview Wiring - Ensure Launcher Has postMessage Access 🔄 IN PROGRESS

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\webview\claude-webview-provider.ts
**Dependencies**: Task 1.2 (launcher must be updated to use webview.postMessage)
**Specification Reference**: implementation-plan-revised.md:211-235
**Estimated Duration**: 0.5 hours
**Expected Commit Pattern**: `feat(vscode): verify webview wired to launcher`

**Quality Requirements**:

- ✅ Verify webview passed to ClaudeCliLauncher via LauncherDependencies
- ✅ Verify webview is available during launcher construction
- ✅ Test postMessage flow (send test message, verify frontend receives)
- ✅ No structural changes (webview already accessible)

**Implementation Details**:

**Verification Steps**:

1. **Check LauncherDependencies construction**:

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

2. **Verify webview is available**:

   - Check `this._view.webview` exists at launcher construction time
   - Verify webview has `postMessage` method
   - Ensure no null/undefined issues

3. **Test postMessage flow**:
   - Send test JSONL message via launcher
   - Verify frontend receives message via window.addEventListener('message')
   - Confirm message structure: `{ type: 'jsonl-message', data: { sessionId, message } }`

**Expected Changes**: ~10 lines (minimal - webview already accessible)

**Verification Requirements**:

- ✅ Webview passed to LauncherDependencies (verified via code inspection)
- ✅ postMessage method accessible from launcher
- ✅ Test message sent and received successfully
- ✅ Git commit exists with proper commitlint format
- ✅ File changes verified via Read tool
- ✅ Build passes: `npx nx build ptah-extension-vscode`

---

**Batch 1 Verification Requirements**:

- ✅ All 3 files modified successfully
- ✅ All 3 git commits match expected patterns
- ✅ Backend parser simplified (1 callback instead of 10)
- ✅ Backend launcher simplified (1 postMessage instead of 10)
- ✅ Webview wiring verified
- ✅ Build passes: `npx nx build claude-domain && npx nx build ptah-extension-vscode`
- ✅ No compilation errors

---

## Batch 2: Frontend Message Router & State Management (Frontend Foundation) ⏸️ PENDING

**Assigned To**: frontend-developer
**Tasks in Batch**: 2
**Dependencies**: Batch 1 complete (backend must send unified messages first)
**Estimated Duration**: 3 hours
**Estimated Commits**: 2

### Task 2.1: Add Frontend Message Router - Unified JSONL Discrimination ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts
**Dependencies**: Batch 1 complete (backend sending jsonl-message type)
**Specification Reference**: implementation-plan-revised.md:237-316
**Current State**: Lines 0-49 (VSCodeService with message listener stub)
**Expected Commit Pattern**: `feat(webview): add jsonl message router with discrimination`

**Quality Requirements**:

- ✅ Add message listener for 'jsonl-message' type
- ✅ Add handleJSONLMessage discrimination method (switch on message.type)
- ✅ Route to ChatStoreService methods (6 JSONL types)
- ✅ Handle: system, assistant, tool, permission, stream_event, result
- ✅ No EventBus patterns (no message splitting)

**Implementation Details**:

**Add to VSCodeService constructor** (add ~80 lines):

```typescript
// Add to existing message listener
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

1. **system**: Session init (session_id, model)
2. **assistant**: Thinking vs content discrimination (check `thinking` field)
3. **tool**: Tool lifecycle + agent correlation (check `subtype` + `parent_tool_use_id`)
4. **permission**: Permission dialog (check `subtype === 'request'`)
5. **stream_event**: Streaming control events (check `event.type`)
6. **result**: Final metrics (cost, usage, duration)

**Key Code Changes**:

- Add handleJSONLMessage method (private)
- Add switch statement for 6 JSONL types
- Inject ChatStoreService (add to constructor)
- Route all messages to ChatStoreService handlers

**Verification Requirements**:

- ✅ Message listener handles 'jsonl-message' type
- ✅ Discrimination switch covers all 6 JSONL types
- ✅ Routes to ChatStoreService methods correctly
- ✅ No console errors for unknown message types
- ✅ Git commit exists with proper commitlint format
- ✅ File changes verified via Read tool
- ✅ Build passes: `npx nx build core`

---

### Task 2.2: Add State Management Methods - Signal-Based JSONL Handlers ⏸️ PENDING

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat-store.service.ts
**Dependencies**: Task 2.1 (message router must call these methods)
**Specification Reference**: implementation-plan-revised.md:318-527
**Estimated Duration**: 2 hours
**Expected Commit Pattern**: `feat(webview): add jsonl message state handlers`

**Quality Requirements**:

- ✅ Add handleAssistantMessage() - discriminate thinking vs content
- ✅ Add handleToolMessage() - update tool timeline + agent correlation
- ✅ Add handlePermissionRequest() - update permission dialog signal
- ✅ Add handleStreamEvent() - handle message_stop event
- ✅ Add handleResult() - update session metrics (cost, usage, duration)
- ✅ Add activeAgents Map (signal) for agent tracking
- ✅ Use signal updates (NOT RxJS)

**Implementation Details**:

**Add State Signals** (add to class properties):

```typescript
// Agent tracking (parallel to backend parser's activeAgents Map)
private readonly _activeAgents = signal<Map<string, AgentMetadata>>(new Map());
readonly activeAgents = this._activeAgents.asReadonly();

// Permission dialog state
private readonly _permissionDialog = signal<PermissionDialogState | null>(null);
readonly permissionDialog = this._permissionDialog.asReadonly();

// Session metrics
private readonly _sessionMetrics = signal<SessionMetrics | null>(null);
readonly sessionMetrics = this._sessionMetrics.asReadonly();
```

**Add Handler Methods** (add ~120 lines):

1. **handleAssistantMessage()** - Discriminate thinking vs content
2. **handleToolMessage()** - Tool timeline + agent correlation
3. **handlePermissionRequest()** - Permission dialog
4. **handleStreamEvent()** - Stream control (message_stop)
5. **handleResult()** - Final metrics
6. **Agent Correlation Logic** - Helper methods for agent tracking

**Key Code Changes**:

- Add 5 handler methods (handleAssistantMessage, handleToolMessage, etc.)
- Add 3 state signals (activeAgents, permissionDialog, sessionMetrics)
- Add agent correlation helper methods
- Use signal updates (NOT RxJS)

**Verification Requirements**:

- ✅ All 5 handler methods implemented
- ✅ activeAgents Map signal added
- ✅ Agent correlation works (Task tools tracked)
- ✅ Thinking blocks appear correctly
- ✅ Tool timeline updates correctly
- ✅ Permission dialog shows correctly
- ✅ Session metrics updated correctly
- ✅ Git commit exists with proper commitlint format
- ✅ File changes verified via Read tool
- ✅ Build passes: `npx nx build core`

---

**Batch 2 Verification Requirements**:

- ✅ All 2 files modified successfully
- ✅ All 2 git commits match expected patterns
- ✅ Frontend message router discriminates JSONL types correctly
- ✅ Frontend state management handles all JSONL types
- ✅ Agent correlation works (Task tools only)
- ✅ Build passes: `npx nx build core`
- ✅ No compilation errors

---

## Batch 3: Integration Testing (Testing & Validation) ⏸️ PENDING

**Assigned To**: senior-tester
**Tasks in Batch**: 1
**Dependencies**: Batch 1 + Batch 2 complete (backend + frontend both ready)
**Estimated Duration**: 1 hour
**Estimated Commits**: 1 (test report documentation)

### Task 3.1: Integration Testing - End-to-End JSONL Message Flow ⏸️ PENDING

**File**: Manual testing (no file changes, test report documentation)
**Dependencies**: Batch 1 + Batch 2 complete
**Specification Reference**: implementation-plan-revised.md:687-717
**Expected Commit Pattern**: `test(webview): verify jsonl message flow`

**Quality Requirements**:

- ✅ Test all 6 JSONL message types (system, assistant, tool, permission, stream_event, result)
- ✅ Verify real-time streaming UX (word-by-word typing effect)
- ✅ Verify thinking blocks appear correctly
- ✅ Verify tool timeline updates correctly
- ✅ Verify agent activity (Task tool tracking)
- ✅ Verify permission dialogs appear correctly
- ✅ Verify session metrics updated correctly
- ✅ Verify no message duplication
- ✅ Verify no message loss
- ✅ Verify correct block ordering

**Test Plan**: 8 comprehensive tests covering all JSONL message types and UX flows

**Verification Requirements**:

- ✅ All 8 integration tests executed
- ✅ Test report created in task-tracking/TASK_2025_022/test-report.md
- ✅ All tests passed (or failures documented)
- ✅ No EventBus patterns detected
- ✅ Real-time streaming UX preserved
- ✅ Git commit exists with proper commitlint format

---

**Batch 3 Verification Requirements**:

- ✅ All 8 integration tests executed
- ✅ Test report documented
- ✅ All tests passed (or failures documented)
- ✅ Git commit created for test report
- ✅ No blocking issues detected

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch (after all tasks complete)
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message lists all completed tasks
- Avoids running pre-commit hooks multiple times
- Still maintains verifiability

**Example Commit Messages**:

```bash
# Batch 1 (Backend)
refactor(vscode): batch 1 - backend parser & launcher simplification

- Task 1.1: simplify parser to single onMessage callback
- Task 1.2: launcher uses single postMessage type
- Task 1.3: verify webview wired to launcher

# Batch 2 (Frontend)
feat(webview): batch 2 - frontend message router & state management

- Task 2.1: add jsonl message router with discrimination
- Task 2.2: add jsonl message state handlers

# Batch 3 (Testing)
test(webview): batch 3 - integration testing

- Task 3.1: verify jsonl message flow (8 tests passed)
```

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified (1 commit per batch)
- All files exist
- Build passes

---

## Architecture Summary

**Core Principle**: Parse once (backend), forward typed object, discriminate once (frontend)

**Message Flow**:

```
Claude CLI stdout
  ↓ (JSONL line)
Parser validates JSON
  ↓ (1 onMessage callback)
Launcher forwards parsed object
  ↓ (1 postMessage: 'jsonl-message')
Frontend discriminates by JSONL type
  ↓ (1 switch statement)
State updated (signals)
```

**Complexity Reduction**:

- **BEFORE (8-type approach)**: 8 postMessage types, 8 backend callbacks, 8 frontend handlers
- **AFTER (1-type approach)**: 1 postMessage type, 1 backend callback, 1 frontend handler with switch

**Benefits**:

- ✅ 60% less complexity
- ✅ 36% fewer code changes
- ✅ 40% faster implementation
- ✅ Single discrimination point
- ✅ Aligned with message-centric philosophy
- ✅ No EventBus patterns

**References**:

- implementation-plan-revised.md - Complete specifications
- architecture-pivot-summary.md - Architecture decision rationale
- streaming-architecture-philosophy.md - Core principles

---

## Task Completion Summary

**Total Tasks**: 6 (3 backend + 2 frontend + 1 testing)
**Total Batches**: 3 (Backend, Frontend, Testing)
**Estimated Duration**: 6.5 hours (2.5h backend + 3h frontend + 1h testing)
**Architecture**: Unified JSONL message streaming with single postMessage type

**Success Criteria**:

- ✅ All batches complete
- ✅ All git commits verified
- ✅ All files exist
- ✅ Build passes
- ✅ Integration tests pass
- ✅ Real-time streaming UX preserved
- ✅ No EventBus patterns
