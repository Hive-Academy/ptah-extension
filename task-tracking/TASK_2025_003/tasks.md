# Development Tasks - TASK_2025_003

**Task Type**: Backend + Frontend Bugfix
**Developer Needed**: backend-developer (Tasks 1-3), frontend-developer (Task 4)
**Total Tasks**: 4 atomic tasks
**Decomposed From**:

- log-analysis-findings.md (comprehensive 1278-line analysis)
- context.md (3 critical blocking issues documented)

**Architecture Discovery**:

- ✅ Frontend ProviderService correctly implemented (signal-based, awaiting backend data)
- ✅ Backend provider registration EXISTS in `PtahExtension.registerProviders()` (line 448)
- ❌ **ROOT CAUSE**: Provider adapters failing to initialize silently, errors swallowed by try-catch
- ❌ **RESULT**: ProviderManager.providers Map empty → getAvailableProviders() returns Array(0)
- ❌ **IMPACT**: Frontend receives empty provider arrays, Claude CLI never spawns for AI requests

---

## Task Breakdown

### Task 1: Add Provider Registration Diagnostics 🔄 IN PROGRESS - Assigned to backend-developer

**Assigned To**: backend-developer
**Type**: DIAGNOSTIC (Add logging to identify silent failures)

**File(s)**:

- `apps/ptah-extension-vscode/src/core/ptah-extension.ts` (MODIFY - registerProviders method, lines 448-536)

**Specification Reference**:

- log-analysis-findings.md:100-150 (Empty provider arrays evidence)
- log-analysis-findings.md:1100-1200 (Recommendations - Add error logging)
- implementation-plan.md:N/A (No implementation plan - this is bugfix)

**Pattern to Follow**:

- Existing error logging pattern in `ptah-extension.ts:136-143` (activation error handling)

**Quality Requirements**:

- ✅ Add console.error() AND logger.error() before each early return in registerProviders()
- ✅ Log adapter initialization results (vsCodeInitialized, claudeInitialized boolean values)
- ✅ Log exact error when `availableCount === 0` condition triggered
- ✅ Log provider registration count BEFORE and AFTER registerProvider() calls
- ✅ Remove "extension will continue" graceful degradation - throw error if no providers

**Expected Commit**: `fix(providers): add diagnostics to identify silent registration failures`

**Verification Requirements**:

- ✅ File modified at specified path
- ✅ Git commit matches expected pattern
- ✅ Build passes (`npm run build:extension`)
- ✅ Test run shows diagnostic logs identifying WHY providers fail to initialize

**Implementation Guidance**:

```typescript
// BEFORE (lines 484-489 - swallows errors silently):
if (vsCodeInitialized) {
  this.providerManager.registerProvider(vsCodeLmAdapter);
  this.logger.info('VS Code LM provider registered with ProviderManager');
}

// AFTER (add diagnostics):
if (vsCodeInitialized) {
  const beforeCount = this.providerManager.getAvailableProviders().length;
  this.logger.info(`Registering VS Code LM provider (current count: ${beforeCount})...`);

  this.providerManager.registerProvider(vsCodeLmAdapter);

  const afterCount = this.providerManager.getAvailableProviders().length;
  if (afterCount === beforeCount) {
    const error = 'VS Code LM provider registered but NOT in provider map';
    this.logger.error(error);
    console.error('[CRITICAL]', error);
    throw new Error(error);
  }

  this.logger.info(`VS Code LM provider registered successfully (count: ${afterCount})`);
}

// CRITICAL: Also add diagnostics at lines 452-456 (adapter initialization):
this.logger.info('Initializing VS Code LM adapter...');
const vsCodeInitialized = await vsCodeLmAdapter.initialize();

if (!vsCodeInitialized) {
  const error = 'VS Code LM adapter initialization returned false';
  this.logger.error(error, {
    adapterHealth: vsCodeLmAdapter.getHealth(),
  });
  console.error('[CRITICAL]', error);
  // Continue to try Claude CLI, but we need visibility
}

// CRITICAL: Remove graceful degradation at lines 529-535:
// DELETE THIS (allows extension to activate with zero providers):
// this.logger.warn(
//   'Extension will continue without provider registration - user can configure manually'
// );

// REPLACE WITH (fail fast):
throw new Error(`Provider registration failed: ${errorMessage}. Extension cannot continue without providers.`);
```

**Success Criteria**:

- Test run produces logs like:
  - `[LOGGER] Resolving provider adapters from DI container...`
  - `[LOGGER] Initializing VS Code LM adapter...`
  - `[LOGGER] VS Code LM adapter initialized: false` (or true)
  - `[ERROR] VS Code LM adapter initialization returned false`
  - `[LOGGER] Registering VS Code LM provider (current count: 0)...`
  - `[ERROR] VS Code LM provider registered but NOT in provider map`
- Extension activation FAILS with clear error message (no silent degradation)
- User can identify EXACT failure point from logs

---

### Task 2: Fix Provider Adapter Initialization ⏸️ PENDING

**Assigned To**: backend-developer
**Type**: BUG FIX (Fix root cause based on Task 1 diagnostics)

**File(s)**: (DETERMINED BY TASK 1 FINDINGS)

- **IF** VS Code LM fails: `libs/backend/ai-providers-core/src/adapters/vscode-lm-adapter.ts`
- **IF** Claude CLI fails: `libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts` (read lines 1-151)
- **IF** Both fail: Investigate DI container registration in `apps/ptah-extension-vscode/src/di/container.ts`

**Specification Reference**:

- Task 1 completion report (diagnostic logs showing exact failure)
- log-analysis-findings.md:600-700 (Provider refresh still returns empty)
- claude-cli-adapter.ts:119-156 (initialize() method implementation)

**Pattern to Follow**:

- provider-manager.ts:68-82 (registerProvider implementation shows ProviderManager.providers Map usage)

**Quality Requirements**:

- ✅ Adapter initialize() method returns true when successful
- ✅ Adapter performHealthCheck() returns status 'available' when working
- ✅ ProviderManager.registerProvider() adds provider to internal Map
- ✅ getAvailableProviders() returns non-empty array after registration
- ✅ Build passes

**Expected Commit**: `fix(providers): resolve adapter initialization failure preventing registration`

**Verification Requirements**:

- ✅ File modified at determined path
- ✅ Git commit matches expected pattern
- ✅ Build passes
- ✅ Test run shows: `Available providers: Array(1)` or `Array(2)` (NOT Array(0))
- ✅ Logs show: "VS Code LM provider registered successfully (count: 1)"

**Implementation Guidance** (PLACEHOLDER - Task 1 will determine):

```typescript
// Example fix if ClaudeCliAdapter.initialize() is issue:
async initialize(): Promise<boolean> {
  try {
    const installation = await this.detector.findExecutable();

    if (installation) {
      this.healthStatus = {
        status: 'available', // CRITICAL: Must set status to 'available'
        lastCheck: Date.now(),
        uptime: 0,
      };

      // ADD: Verify health status before returning
      const health = this.getHealth();
      this.logger.info('Claude CLI adapter initialized', { health });

      return true; // CRITICAL: Return true for successful init
    } else {
      // ADD: Log WHY initialization failed
      this.logger.error('Claude CLI not found - no executable detected');

      this.healthStatus = {
        status: 'unavailable',
        lastCheck: Date.now(),
        errorMessage: 'Claude CLI executable not found',
      };
      return false;
    }
  } catch (error) {
    // ADD: Log the actual error
    this.logger.error('Claude CLI adapter initialization failed', error);

    this.healthStatus = {
      status: 'error',
      lastCheck: Date.now(),
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    };
    return false;
  }
}
```

**Success Criteria**:

- Extension activates successfully WITH providers registered
- Logs show: `[ProviderService] Available providers: Array(1)` (or Array(2))
- Frontend receives provider data in `providers:getAvailable:response` message
- User can see providers in UI

---

### Task 3: Add Claude CLI Process Spawn Logging ⏸️ PENDING

**Assigned To**: backend-developer
**Type**: DIAGNOSTIC (Add visibility to AI request processing)

**File(s)**:

- `libs/backend/claude-domain/src/messaging/message-handler.service.ts` (MODIFY - subscribeToChatMessages, line 172)
- `libs/backend/claude-domain/src/orchestration/chat-orchestration.service.ts` (INVESTIGATE)
- `libs/backend/ai-providers-core/src/adapters/claude-cli-adapter.ts` (MODIFY - sendMessage method)

**Specification Reference**:

- log-analysis-findings.md:1200-1250 (Message sent but no Claude CLI spawn)
- message-handler.service.ts:172-178 (chat:sendMessage event handler)

**Pattern to Follow**:

- Existing logging pattern in ptah-extension.ts (detailed operation logs)

**Quality Requirements**:

- ✅ Log when chat:sendMessage event received by MessageHandlerService
- ✅ Log when ChatOrchestrationService.sendMessage() called with payload
- ✅ Log when provider selected for message processing
- ✅ Log when ClaudeCliAdapter.sendMessage() invoked
- ✅ Log when Claude CLI process spawn attempted
- ✅ Log success/failure of CLI spawn
- ✅ Build passes

**Expected Commit**: `feat(claude-cli): add comprehensive logging for AI request lifecycle`

**Verification Requirements**:

- ✅ Files modified at specified paths
- ✅ Git commit matches expected pattern
- ✅ Build passes
- ✅ Test run shows complete trace from user message → provider selection → CLI spawn
- ✅ Can identify EXACT point where Claude CLI processing stops

**Implementation Guidance**:

```typescript
// In message-handler.service.ts (line 172):
this.eventBus.subscribe('chat:sendMessage').subscribe(async (event) => {
  this.logger.info('[CHAT] Received chat:sendMessage event', {
    correlationId: event.correlationId,
    content: event.payload.content?.substring(0, 50), // First 50 chars
    hasFiles: !!event.payload.files,
  });

  const result = await this.chatOrchestration.sendMessage({
    content: event.payload.content,
    files: event.payload.files as string[] | undefined,
    currentSessionId: undefined,
  });

  this.logger.info('[CHAT] ChatOrchestration completed', {
    correlationId: event.correlationId,
    success: result.success,
  });

  this.publishResponse('chat:sendMessage', event.correlationId, result);
});

// In claude-cli-adapter.ts (sendMessage method):
async sendMessage(
  content: string,
  options?: AIMessageOptions
): Promise<AsyncIterable<string>> {
  this.logger.info('[CLAUDE-CLI] sendMessage called', {
    content: content.substring(0, 50),
    sessionId: options?.sessionId,
  });

  // ... existing code ...

  this.logger.info('[CLAUDE-CLI] Spawning CLI process', {
    executable: 'claude',
    args: ['chat', '--stream'],
  });

  // After spawn:
  this.logger.info('[CLAUDE-CLI] CLI process spawned successfully', {
    pid: processId,
  });
}
```

**Success Criteria**:

- Test run produces complete trace:
  - `[CHAT] Received chat:sendMessage event`
  - `[CHAT] ChatOrchestration completed`
  - `[CLAUDE-CLI] sendMessage called`
  - `[CLAUDE-CLI] Spawning CLI process`
  - `[CLAUDE-CLI] CLI process spawned successfully`
- OR produces diagnostic showing WHERE the chain breaks
- Can identify if issue is: message routing, provider selection, or CLI spawn

---

### Task 4: Add Frontend Message Type Handlers ⏸️ PENDING

**Assigned To**: frontend-developer
**Type**: FEATURE (Add 5+ missing message handlers)

**File(s)**:

- `apps/ptah-extension-webview/src/app/services/vscode.service.ts` (MODIFY - add message subscriptions)
- `libs/frontend/chat/src/lib/services/chat.service.ts` (MODIFY - add message handlers)
- `libs/frontend/session/src/lib/services/session.service.ts` (MODIFY - add message handlers)

**Specification Reference**:

- log-analysis-findings.md:400-500 (5+ unhandled message types logged)
- vscode.service.ts implementation (need to read to see missing handlers)

**Pattern to Follow**:

- provider.service.ts:165-180 (existing message handler pattern with onMessageType)

**Quality Requirements**:

- ✅ Handle message type: `chat:sendMessage:response`
- ✅ Handle message type: `chat:newSession:response`
- ✅ Handle message type: `chat:switchSession:response`
- ✅ Handle message type: `session:list:response`
- ✅ Handle message type: `session:current:response`
- ✅ All handlers update Angular signals (NO direct state mutation)
- ✅ All handlers use OnPush-compatible patterns
- ✅ Build passes (`npm run build:webview`)
- ✅ Lint passes (`npm run lint:webview`)

**Expected Commit**: `feat(frontend): add missing message handlers for chat and session events`

**Verification Requirements**:

- ✅ Files modified at specified paths
- ✅ Git commit matches expected pattern
- ✅ Webview build passes
- ✅ Test run shows messages being processed (no more "WARN: Unhandled message type")
- ✅ UI updates reactively when messages received

**Implementation Guidance**:

```typescript
// In chat.service.ts (add to constructor or init method):
this.vscodeService
  .onMessageType('chat:sendMessage:response')
  .pipe(takeUntilDestroyed())
  .subscribe((payload) => {
    this.logger.info('[ChatService] Received sendMessage response', payload);

    if (payload.success) {
      // Update chat state signal
      this._messageProcessing.set(false);

      // If streaming response, handle chunks via separate handler
      // If final response, update message history
    } else {
      this._error.set(payload.error?.message ?? 'Failed to send message');
    }
  });

// In session.service.ts:
this.vscodeService
  .onMessageType('session:list:response')
  .pipe(takeUntilDestroyed())
  .subscribe((payload) => {
    this.logger.info('[SessionService] Received session list', payload);

    if (payload.success && payload.sessions) {
      this._sessions.set(payload.sessions);
    }
  });

this.vscodeService
  .onMessageType('session:current:response')
  .pipe(takeUntilDestroyed())
  .subscribe((payload) => {
    this.logger.info('[SessionService] Received current session', payload);

    if (payload.success && payload.session) {
      this._currentSession.set(payload.session);
    }
  });
```

**Success Criteria**:

- No more "WARN: Unhandled message type: chat:sendMessage:response" in logs
- Chat messages appear in UI after being sent
- Session list updates when sessions created/switched
- UI remains reactive and responsive to backend events

---

## Verification Protocol

**After Each Task Completion**:

1. Developer updates task status to "✅ COMPLETE"
2. Developer adds git commit SHA
3. Developer provides completion report with:
   - Files modified
   - Key changes made
   - Test results (logs showing diagnostic output)
   - Verification of success criteria
4. Team-leader verifies:
   - `git log --oneline -1` matches expected commit pattern
   - `Read([file-path])` confirms changes exist
   - Build passes (if applicable)
   - Success criteria from task met
5. If verification passes: Assign next task
6. If verification fails: Mark task as "❌ FAILED", request corrections

---

## Task Dependencies

**Sequential Execution Required**:

1. **Task 1 MUST complete first** - diagnostics identify exact failure point
2. **Task 2 depends on Task 1** - fix is based on diagnostic findings
3. **Task 3 can run parallel with Task 2** - adds logging to different code path
4. **Task 4 can run parallel with Tasks 2-3** - frontend work independent of backend fixes

**Recommended Order**:

- Phase A: Task 1 (Diagnostics) → Verify → Get findings
- Phase B: Task 2 (Fix based on findings) + Task 3 (Logging) in parallel
- Phase C: Task 4 (Frontend handlers) after Tasks 2-3 verified
- Phase D: Integration test with all fixes applied

---

## Completion Criteria

**All tasks complete when**:

- ✅ All 4 task statuses are "✅ COMPLETE"
- ✅ All git commits verified
- ✅ Extension activates WITH providers registered
- ✅ Logs show: `Available providers: Array(1)` or `Array(2)` (not Array(0))
- ✅ User sends message → Claude CLI spawns → AI response streams back
- ✅ Frontend handles all message types without warnings
- ✅ UI shows providers, sessions, and chat messages correctly

**Return to orchestrator with**: "All 4 tasks completed and verified ✅ - Critical blockers resolved"

---

## Notes for Developers

### Backend Developer Notes:

**Task 1 (Diagnostics)**: Your job is to make the SILENT failures LOUD. Add logs everywhere in the provider registration flow. Remove the try-catch that swallows errors. Make the extension fail fast with clear error messages.

**Task 2 (Fix)**: Based on Task 1 findings, you'll fix WHY adapters aren't initializing. Most likely issues:

- ClaudeCliDetector.findExecutable() returning null (Claude CLI not installed?)
- VS Code LM API not available (need to check capabilities?)
- DI container not resolving adapters correctly (check TOKENS registration)

**Task 3 (Logging)**: Trace the complete path from user typing message → backend receives → provider selected → CLI spawns. This helps us verify Task 2 fix actually works end-to-end.

### Frontend Developer Notes:

**Task 4 (Message Handlers)**: The backend is ALREADY SENDING these messages (infrastructure 100% working per log analysis). Your job is to ADD the frontend listeners so the UI reacts to them.

**Pattern**: Look at `provider.service.ts:165-180` for the exact pattern:

```typescript
this.vscodeService
  .onMessageType('message:type:response')
  .pipe(takeUntilDestroyed())
  .subscribe((payload) => {
    // Update signals here
  });
```

**Signal Updates**: NEVER mutate state directly. Always use `.set()` or `.update()` on signals. This ensures OnPush change detection works.

### Critical Architecture Points:

1. **Provider Registration Flow**:

   - main.ts activates → PtahExtension.initialize() → PtahExtension.registerAll() → registerProviders()
   - registerProviders() resolves adapters from DI → calls adapter.initialize() → registers with ProviderManager
   - ProviderManager.registerProvider() adds to internal Map + publishes 'providers:availableUpdated' event
   - Frontend ProviderService listens for event + updates signals

2. **Message Flow**:

   - Frontend sends message via vscodeService.postMessage()
   - Backend WebviewMessageBridge forwards to EventBus
   - MessageHandlerService subscribes to EventBus events
   - ChatOrchestrationService orchestrates provider selection + message send
   - Provider (ClaudeCliAdapter) spawns CLI process + streams response
   - Response published to EventBus as 'chat:sendMessage:response'
   - WebviewMessageBridge forwards response to webview
   - Frontend handlers update signals + UI

3. **Why Empty Providers**:
   - ProviderManager.providers Map is empty because registerProvider() never called successfully
   - registerProvider() not called because adapter.initialize() returned false
   - initialize() returned false because... (Task 1 will tell us!)
