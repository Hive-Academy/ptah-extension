# Task Breakdown for TASK_2025_007

**RECOVERY MODE**: This tasks.md is created retroactively to document backend work completed outside the normal orchestration workflow.

**Task Type**: Backend + Frontend (Full-Stack)
**Total Tasks**: 12 tasks (5 backend + 7 frontend)
**Total Batches**: 3 batches
**Batching Strategy**: Layer-based (backend) + Architecture-based (frontend)
**Status**: 1/3 batches complete (33%)

---

## Batch 1: Backend Parser & Launcher Fixes ✅ COMPLETE

**Assigned To**: backend-developer (completed outside orchestration)
**Tasks in Batch**: 5
**Dependencies**: None (foundation)
**Estimated Commits**: 1 (batch commit)
**Actual Commit**: fd1bf34e6eafe72f038a2c1cfd6c2d9784dd322b

### Task 1.1: Add JSONLResultMessage Interface ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts (lines 98-123)
**Specification Reference**: implementation-plan.md:8-34
**Pattern to Follow**: Existing JSONLSystemMessage, JSONLAssistantMessage interfaces
**Expected Commit Pattern**: `feat(vscode): add result message interface to parser`

**Quality Requirements**:

- ✅ Interface includes all result fields (cost, usage, duration)
- ✅ Added to JSONLMessage union type
- ✅ Follows readonly property pattern
- ✅ TypeScript compilation passes

**Implementation Details**:

- **Interface Location**: Lines 98-123
- **Fields Added**:
  - `type: 'result'`
  - `subtype: 'success' | 'error'`
  - `session_id?: string`
  - `result?: string`
  - `duration_ms?: number`
  - `duration_api_ms?: number`
  - `num_turns?: number`
  - `total_cost_usd?: number`
  - `usage?: { input_tokens, output_tokens, cache_*_tokens }`
  - `modelUsage?: Record<string, { ... }>`
- **Union Type**: Updated JSONLMessage (line 18) to include JSONLResultMessage

**Verification**: ✅ File exists, interface complete, build passes

**Git Commit**: fd1bf34 - "chore: update claude cli nnode starter"

---

### Task 1.2: Add Missing Parser Callbacks ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts (lines 161-162)
**Dependencies**: Task 1.1 (JSONLResultMessage must exist)
**Specification Reference**: implementation-plan.md:40-63
**Pattern to Follow**: Existing onContent, onThinking callbacks

**Quality Requirements**:

- ✅ onMessageStop callback added
- ✅ onResult callback added with JSONLResultMessage type
- ✅ Optional callback pattern maintained
- ✅ TypeScript compilation passes

**Implementation Details**:

- **Callbacks Added**:
  - `onMessageStop?: () => void` (line 161) - Signals streaming complete
  - `onResult?: (result: JSONLResultMessage) => void` (line 162) - Final result with cost/usage
- **Callback Interface**: JSONLParserCallbacks (lines 152-164)

**Verification**: ✅ Callbacks defined, types correct, build passes

**Git Commit**: fd1bf34 - "chore: update claude cli nnode starter"

---

### Task 1.3: Handle message_stop Stream Event ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts (lines 782-788)
**Dependencies**: Task 1.2 (onMessageStop callback must exist)
**Specification Reference**: implementation-plan.md:68-82
**Pattern to Follow**: Existing stream event handlers (content_block_delta, etc.)

**Quality Requirements**:

- ✅ message_stop event type detected
- ✅ onMessageStop callback invoked
- ✅ Console logging for debugging
- ✅ Returns early (no further processing)

**Implementation Details**:

- **Location**: handleStreamEvent() method (lines 782-788)
- **Logic**:

  ```typescript
  if (msg.event.type === 'message_stop') {
    console.log('[JSONLStreamParser] message_stop received - streaming complete');
    this.callbacks.onMessageStop?.();
    return;
  }
  ```

- **Critical**: Signals end of streaming to prevent "Claude is typing..." from hanging

**Verification**: ✅ Event handler added, logic correct, build passes

**Git Commit**: fd1bf34 - "chore: update claude cli nnode starter"

---

### Task 1.4: Handle result Message Type ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts (lines 279-281, 738-747)
**Dependencies**: Task 1.1 (JSONLResultMessage), Task 1.2 (onResult callback)
**Specification Reference**: implementation-plan.md:87-110
**Pattern to Follow**: Existing handleSystemMessage, handleAssistantMessage methods

**Quality Requirements**:

- ✅ 'result' case added to handleMessage() switch
- ✅ handleResultMessage() method implemented
- ✅ Console logging for cost, usage, duration
- ✅ onResult callback invoked

**Implementation Details**:

- **Switch Case**: Line 279-281

  ```typescript
  case 'result':
    this.handleResultMessage(json);
    break;
  ```

- **Handler Method**: Lines 738-747

  ```typescript
  private handleResultMessage(msg: JSONLResultMessage): void {
    console.log('[JSONLStreamParser] result message received:', {
      subtype: msg.subtype,
      duration: msg.duration_ms,
      cost: msg.total_cost_usd,
      tokens: msg.usage,
    });
    this.callbacks.onResult?.(msg);
  }
  ```

**Verification**: ✅ Handler implemented, callback invoked, build passes

**Git Commit**: fd1bf34 - "chore: update claude cli nnode starter"

---

### Task 1.5: Wire Up Callbacks in Launcher ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/claude-cli-launcher.ts (lines 356-386)
**Dependencies**: Tasks 1.2, 1.3, 1.4 (parser callbacks must exist)
**Specification Reference**: implementation-plan.md:118-152
**Pattern to Follow**: Existing onContent, onThinking callback wiring

**Quality Requirements**:

- ✅ onMessageStop callback wired to emitMessageComplete()
- ✅ onResult callback wired to emitTokenUsage() and emitSessionEnd()
- ✅ Console logging for debugging
- ✅ Event publisher integration working

**Implementation Details**:

- **onMessageStop Callback** (lines 356-361):

  ```typescript
  onMessageStop: () => {
    console.log('[ClaudeCliLauncher] Streaming complete (message_stop received)');
    this.deps.eventPublisher.emitMessageComplete(sessionId);
  };
  ```

- **onResult Callback** (lines 363-386):

  ```typescript
  onResult: (result) => {
    console.log('[ClaudeCliLauncher] Final result received:', {
      cost: result.total_cost_usd,
      duration: result.duration_ms,
      tokens: result.usage,
    });

    // Emit token usage
    if (result.usage) {
      this.deps.eventPublisher.emitTokenUsage(sessionId, {
        inputTokens: result.usage.input_tokens || 0,
        outputTokens: result.usage.output_tokens || 0,
        cacheReadTokens: result.usage.cache_read_input_tokens || 0,
        cacheCreationTokens: result.usage.cache_creation_input_tokens || 0,
        totalCost: result.total_cost_usd || 0,
      });
    }

    // Emit session end
    const reason = result.subtype === 'success' ? 'completed' : 'error';
    this.deps.eventPublisher.emitSessionEnd(sessionId, reason);
  };
  ```

**Verification**: ✅ Callbacks wired, events published, build passes

**Git Commit**: fd1bf34 - "chore: update claude cli nnode starter"

---

### Task 1.6: Fix stdin EOF Signaling ✅ COMPLETE

**File(s)**: D:/projects/ptah-extension/libs/backend/claude-domain/src/cli/claude-cli-launcher.ts (lines 126-143)
**Dependencies**: None (independent fix)
**Specification Reference**: implementation-plan.md:159-186
**Pattern to Follow**: Standard Node.js stdin.end() pattern (like echo pipe)

**Quality Requirements**:

- ✅ stdin.write() sends message
- ✅ stdin.end() called after write
- ✅ Console logging for debugging
- ✅ Fixes Claude CLI hang (required for -p flag)

**Implementation Details**:

- **Critical Fix**: Lines 137-140

  ```typescript
  // CRITICAL FIX: End stdin to signal EOF (like echo pipe does)
  // Without this, Claude CLI waits forever for more stdin input!
  childProcess.stdin.end();
  console.log('[ClaudeCliLauncher] stdin ended (EOF signaled)');
  ```

- **Root Cause**: Claude CLI's `-p` flag expects stdin to be closed (EOF) after the message, like `echo "message" |` does
- **Impact**: WITHOUT this fix, CLI waits forever for stdin input

**Verification**: ✅ stdin.end() called, EOF signaled, build passes

**Git Commit**: fd1bf34 - "chore: update claude cli nnode starter"

---

**Batch 1 Git Commit**: fd1bf34e6eafe72f038a2c1cfd6c2d9784dd322b

**Commit Message**:

```
chore: update claude cli nnode starter

- Add JSONLResultMessage interface for final result parsing
- Add onMessageStop and onResult callbacks
- Handle message_stop stream event
- Handle result message type
- Wire callbacks in launcher
- Fix stdin.end() to signal EOF
```

**Batch 1 Verification Results**:

- ✅ All 6 tasks completed
- ✅ Batch commit exists (fd1bf34)
- ✅ All files modified correctly
- ✅ Build passes: `npm run build:all`
- ✅ No TypeScript errors
- ✅ Dependencies respected (task order maintained)

**Files Modified in Batch 1**:

1. libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts (4 tasks)
2. libs/backend/claude-domain/src/cli/claude-cli-launcher.ts (2 tasks)

---

## Batch 2: Frontend Quick Wins ⏸️ PENDING

**Assigned To**: frontend-developer
**Tasks in Batch**: 3
**Dependencies**: Batch 1 complete (backend events must emit)
**Estimated Commits**: 3

### Task 2.1: Add MESSAGE_COMPLETE Handler in ChatService ⏸️ PENDING

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
**Specification Reference**: implementation-plan.md:220-336
**Pattern to Follow**: Existing MESSAGE_CHUNK handler

**Quality Requirements**:

- ✅ MESSAGE_COMPLETE event subscribed
- ✅ Clear \_streamState.isStreaming on completion
- ✅ Clear \_currentThinking on completion
- ✅ Call appState.setLoading(false)

**Implementation Details**:

- **Subscription**: Use vscodeService.onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE)
- **Handler Logic**:

  ```typescript
  onMessageComplete: (payload) => {
    // Clear streaming state
    this._streamState.update((state) => ({
      ...state,
      isStreaming: false,
      currentMessageId: null,
    }));

    // Clear thinking indicator
    this._currentThinking.set(null);

    // Clear loading
    this.appState.setLoading(false);
  };
  ```

---

### Task 2.2: Add Thinking Cleanup on MESSAGE_CHUNK ⏸️ PENDING

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
**Dependencies**: Task 2.1 (MESSAGE_COMPLETE handler should exist)
**Specification Reference**: implementation-plan.md:299-332

**Quality Requirements**:

- ✅ Clear \_currentThinking when first chunk arrives
- ✅ Logic: "If thinking active and chunk arrives, thinking is done"
- ✅ No side effects on existing chunk handling

**Implementation Details**:

- **Location**: Beginning of onMessageChunk handler
- **Logic**:

  ```typescript
  onMessageChunk: (payload) => {
    // If thinking was active, clear it (chunks mean thinking is done)
    if (this._currentThinking()) {
      this._currentThinking.set(null);
    }

    // ... existing chunk handling
  };
  ```

---

### Task 2.3: Add Timeout Fallbacks for Indicators ⏸️ PENDING

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
**Dependencies**: Tasks 2.1, 2.2
**Specification Reference**: migration-strategy.md:69-113

**Quality Requirements**:

- ✅ Thinking timeout: 60 seconds
- ✅ Streaming timeout: 30 seconds
- ✅ Timeout cleared on normal completion
- ✅ Console warning when timeout fires

**Implementation Details**:

- **Thinking Timeout**:

  ```typescript
  private thinkingTimeout?: NodeJS.Timeout;

  onThinking: (payload) => {
    this._currentThinking.set(payload);

    // Set timeout fallback (60 seconds)
    this.thinkingTimeout = setTimeout(() => {
      console.warn('[ChatService] Thinking timeout, forcing clear');
      this._currentThinking.set(null);
    }, 60000);
  }

  // In MESSAGE_COMPLETE:
  if (this.thinkingTimeout) {
    clearTimeout(this.thinkingTimeout);
    this.thinkingTimeout = null;
  }
  ```

---

**Batch 2 Verification Requirements**:

- ✅ All 3 handlers added
- ✅ All 3 git commits match expected patterns
- ✅ Build passes: `npx nx build @ptah-extension/core`
- ✅ No TypeScript errors
- ✅ "Claude is typing..." clears within 1 second
- ✅ Thinking indicator clears properly

---

## Batch 3: Frontend Architecture Refactor ⏸️ PENDING

**Assigned To**: frontend-developer
**Tasks in Batch**: 4
**Dependencies**: Batch 2 complete (quick wins must work)
**Estimated Commits**: 4

### Task 3.1: Create EventDeduplicationService ⏸️ PENDING

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/event-deduplication.service.ts (NEW)
**Specification Reference**: implementation-plan.md:340-415
**Pattern to Follow**: Standard Angular injectable service

**Quality Requirements**:

- ✅ Injectable with providedIn: 'root'
- ✅ isDuplicate() method checks within 1-second window
- ✅ Automatic cleanup of old cache entries
- ✅ Unit tests written

**Implementation Details**:

- **Service Structure**:

  ```typescript
  @Injectable({ providedIn: 'root' })
  export class EventDeduplicationService {
    private readonly processedEvents = new Map<string, number>();
    private readonly DEDUP_WINDOW_MS = 1000;

    isDuplicate(message: StrictMessage): boolean {
      const key = `${message.type}:${this.extractId(message)}`;
      const lastTime = this.processedEvents.get(key);
      const now = Date.now();

      if (lastTime && now - lastTime < this.DEDUP_WINDOW_MS) {
        return true; // Duplicate
      }

      this.processedEvents.set(key, now);
      return false;
    }
  }
  ```

- **Integration**: VSCodeService.setupMessageListener() checks isDuplicate() before emitting

---

### Task 3.2: Create EventCleanupRegistry Service ⏸️ PENDING

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/event-cleanup-registry.service.ts (NEW)
**Dependencies**: Task 3.1
**Specification Reference**: implementation-plan.md:420-540

**Quality Requirements**:

- ✅ Injectable with providedIn: 'root'
- ✅ register() method accepts cleanup strategies
- ✅ scheduleCleanup() sets timeout fallback
- ✅ triggerCleanup() executes on completion events
- ✅ Unit tests written

**Implementation Details**:

- **Cleanup Strategy Interface**:

  ```typescript
  interface CleanupStrategy {
    triggerEvents: string[]; // Events that mark completion
    timeout?: number; // Fallback timeout (ms)
    clearSignals: string[]; // Signals to clear
  }
  ```

- **Registration** (in ChatService constructor):

  ```typescript
  this.cleanupRegistry.register(CHAT_MESSAGE_TYPES.THINKING, {
    triggerEvents: [CHAT_MESSAGE_TYPES.MESSAGE_CHUNK, CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE],
    timeout: 60000,
    clearSignals: ['_currentThinking'],
  });
  ```

---

### Task 3.3: Remove Duplicate Event Subscriptions ⏸️ PENDING

**File(s)**:

- D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
- D:/projects/ptah-extension/libs/frontend/chat/src/lib/services/chat-state-manager.service.ts
  **Dependencies**: Tasks 3.1, 3.2
  **Specification Reference**: implementation-plan.md:269-293, migration-strategy.md:279-374

**Quality Requirements**:

- ✅ ChatService handles ALL message events
- ✅ ChatStateManagerService handles ONLY session events
- ✅ NO overlap between services
- ✅ Duplicate subscriptions removed

**Implementation Details**:

- **Split Responsibilities**:
  - ChatService: MESSAGE*\*, THINKING, TOOL*\* events
  - ChatStateManagerService: SESSION*\*, SESSIONS*\* events
- **Remove from ChatStateManagerService**:
  - INITIAL_DATA subscription
  - MESSAGE_CHUNK subscription (if exists)
  - Any MESSAGE\_\* event subscriptions

---

### Task 3.4: Eliminate Dual Message Collections ⏸️ PENDING

**File(s)**: D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat.service.ts
**Dependencies**: Task 3.3
**Specification Reference**: implementation-plan.md:222-261, migration-strategy.md:376-475

**Quality Requirements**:

- ✅ Remove \_messages signal
- ✅ Rename \_claudeMessages to_messages
- ✅ Update MESSAGE_CHUNK handler to only update one collection
- ✅ No duplicate message rendering

**Implementation Details**:

- **Remove**:

  ```typescript
  private readonly _messages = signal<StrictChatMessage[]>([]);
  readonly messages = this._messages.asReadonly();
  ```

- **Rename**:

  ```typescript
  // BEFORE: _claudeMessages
  // AFTER: _messages
  private readonly _messages = signal<ProcessedClaudeMessage[]>([]);
  readonly messages = this._messages.asReadonly();
  ```

- **Update MESSAGE_CHUNK**: Only update \_messages, remove dual update logic

---

**Batch 3 Verification Requirements**:

- ✅ All 4 services/refactors complete
- ✅ All 4 git commits match expected patterns
- ✅ Build passes: `npx nx build @ptah-extension/core`
- ✅ Unit tests pass: `npx nx test core`
- ✅ No duplicate messages in UI
- ✅ Event deduplication working (logs show duplicates prevented)
- ✅ Cleanup timeouts working (logs show forced cleanups if needed)

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates commits as appropriate for the batch
5. Developer returns with batch completion summary
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- Batch 1: Single commit (already done) - fd1bf34
- Batch 2: 3 commits (one per handler/feature)
- Batch 3: 4 commits (one per service/refactor)

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified
- All files exist
- Build passes
- Manual testing confirms: "Claude is typing..." stops, no duplicate messages

---

## Verification Protocol

**After Batch Completion**:

1. Developer updates all task statuses in batch to "✅ COMPLETE"
2. Developer adds git commit SHAs to task headers
3. Team-leader verifies:
   - Batch commits exist: `git log --oneline -1`
   - All files in batch exist: `Read([file-path])` for each task
   - Build passes: `npx nx build [affected-project]`
   - Dependencies respected: Task order maintained
4. If all pass: Update batch status to "✅ COMPLETE", assign next batch
5. If any fail: Mark batch as "❌ PARTIAL", create fix batch

---

## Testing Validation (Phase 1 - Backend)

**Manual Testing Required** (from testing-checklist.md):

### Test 1.1: Basic Message Sending

- [ ] Launch extension (F5)
- [ ] Send message: "Hello"
- [ ] Verify response appears
- [ ] Check logs for process spawn, stdin write, EOF signal

### Test 1.2: Streaming Works

- [ ] Send message: "Write a 200-word story"
- [ ] Watch for incremental text updates
- [ ] Verify chunks logged in console

### Test 1.3: message_stop Event Handled

- [ ] Send message: "Hello"
- [ ] Wait for completion
- [ ] Check console logs for "[JSONLStreamParser] message_stop received"

### Test 1.4: result Message Parsed

- [ ] Send message: "Hello"
- [ ] Wait for completion
- [ ] Check console logs for "[JSONLStreamParser] result message received"
- [ ] Verify cost, tokens, duration logged

### Test 1.5: Process Cleanup

- [ ] Send message: "Hello"
- [ ] Check Task Manager for process PID during streaming
- [ ] Verify process disappears after completion

**All Phase 1 tests MUST PASS before proceeding to Batch 2.**

---

## Current Status Summary

**Completed Work**:

- ✅ Batch 1: Backend Parser & Launcher Fixes (6 tasks) - fd1bf34
- ✅ Build passes with no errors
- ✅ All backend code changes verified

**Pending Work**:

- ⏸️ Batch 2: Frontend Quick Wins (3 tasks)
- ⏸️ Batch 3: Frontend Architecture Refactor (4 tasks)

**Next Actions**:

1. **CRITICAL**: Run Phase 1 manual tests (Test 1.1-1.5)
2. If tests pass: Assign Batch 2 to frontend-developer
3. If tests fail: Create bugfix batch for backend

**Estimated Completion**:

- Batch 2: 2-3 hours
- Batch 3: 4-6 hours
- Total remaining: 6-9 hours

---

## Notes

- This tasks.md was created retroactively on 2025-11-19
- Backend work (Batch 1) was completed outside the normal orchestration workflow
- All backend changes consolidated in commit fd1bf34
- Frontend work (Batches 2-3) remains pending
- Manual testing required before proceeding to frontend implementation
