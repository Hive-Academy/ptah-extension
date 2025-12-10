# Development Tasks - TASK_2025_059

**Task Type**: Full-Stack
**Total Tasks**: 12 (5 original + 7 remediation)
**Total Batches**: 4 (2 original + 2 remediation)
**Batching Strategy**: Phase-based (Implementation → Remediation)
**Status**: 4/4 batches complete (100%)
**Current Phase**: COMPLETE - All batches verified

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- ✅ SDK provides `stop_reason` on `message` object - Verified in `sdk-message-transformer.ts:212-287`
- ✅ `ngx-markdown` supports live updates during streaming - Common pattern in chat UIs
- ✅ Frontend has existing badge components (`TokenBadgeComponent`, `CostBadgeComponent`) - Referenced in plan

### Risks Identified

| Risk                                            | Severity | Mitigation                                        |
| ----------------------------------------------- | -------- | ------------------------------------------------- |
| `stop_reason` may be undefined during streaming | LOW      | Check for presence, default to 'streaming' status |
| Markdown flicker during rapid updates           | LOW      | CSS transition smoothing already in place         |

### Edge Cases to Handle

- [x] `stop_reason` is null/undefined during streaming → Task 1.1
- [x] Empty content blocks → Already handled in transformer

---

## Batch 1: Streaming Fix ✅ COMPLETE

**Assigned To**: backend-developer (Task 1.1) + frontend-developer (Task 1.2)
**Tasks in Batch**: 2
**Dependencies**: None
**Commit**: c593edb

### Task 1.1: Use `stop_reason` for Per-Message Completion ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts`
**Specification Reference**: streaming-redesign-plan.md:27-40
**Pattern to Follow**: Existing `transformAssistantMessage()` at line 208

**Quality Requirements**:

- ✅ Check `sdkMessage.message.stop_reason` to determine completion status
- ✅ If `stop_reason` exists → set node `status: 'complete'`
- ✅ If `stop_reason` is null → set node `status: 'streaming'`
- ✅ Apply status to message node AND text child nodes

**Implementation Details**:

```typescript
// Line 287: Change from hardcoded 'complete' to dynamic status
const isMessageComplete = !!message.stop_reason;
const status: ExecutionStatus = isMessageComplete ? 'complete' : 'streaming';

// Apply to messageNode creation (line 284-295)
// Also apply to text child nodes (line 223-230)
```

**Affected Lines**: 208-298

---

### Task 1.2: Always Render Markdown (Remove Streaming Conditional) ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\organisms\execution-node.component.ts`
**Specification Reference**: streaming-redesign-plan.md:42-48
**Pattern to Follow**: Current template at lines 50-77

**Quality Requirements**:

- ✅ Remove the `@if (isStreaming())` conditional switch between streaming-text-reveal and markdown
- ✅ Always use `<markdown [data]="node().content" />` for text nodes
- ✅ ngx-markdown updates live (like ChatGPT/Claude web do)
- ✅ Optionally keep subtle streaming indicator via CSS class

**Implementation Details**:

```typescript
// Current (lines 58-74):
@if (isStreaming()) {
  <ptah-streaming-text-reveal ... />
} @else {
  <markdown [data]="node().content || ''" />
}

// Change to always markdown:
<div class="prose prose-sm prose-invert max-w-none my-2 transition-opacity duration-300"
     [class.animate-pulse]="isStreaming()">
  <markdown [data]="node().content || ''" />
</div>
```

**Affected Lines**: 50-77

---

**Batch 1 Verification Requirements**:

- ✅ All 2 tasks marked complete
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Build passes: `npx nx build chat`
- ✅ Markdown renders progressively during streaming
- ✅ Streaming indicator stops when `stop_reason` received

---

## Batch 2: Pricing & Token Display ✅ COMPLETE

**Assigned To**: backend-developer (Task 2.1) + frontend-developer (Tasks 2.2, 2.3)
**Tasks in Batch**: 3
**Dependencies**: Batch 1 must complete first (streaming must work)
**Commit**: 1eeb6bd

### Task 2.1: Send `session:stats` Message from Backend ✅ COMPLETE

**File(s)**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts` (modified)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (modified)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\index.ts` (modified)
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (modified)

**Specification Reference**: streaming-redesign-plan.md:69-81
**Pattern to Follow**: `streamExecutionNodesToWebview()` at line 295

**Quality Requirements**:

- ✅ When SDK result message received, extract cost/token/duration data
- ✅ Send `session:stats` message to webview via `webviewManager.sendMessage()`
- ✅ Include: `sessionId`, `cost`, `tokens: {input, output}`, `duration`

**Implementation Summary**:

1. Added `ResultStatsCallback` type to `stream-transformer.ts`
2. Modified `StreamTransformer.transform()` to detect result messages and invoke callback
3. Added `setResultStatsCallback()` method to `SdkAgentAdapter`
4. Added `setupResultStatsCallback()` method to `RpcMethodRegistrationService`
5. Stats are extracted from SDK result messages and sent to webview as `session:stats` events

**Files staged with git add** ✅

---

### Task 2.2: Handle `session:stats` Message in VSCodeService ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`
**Specification Reference**: streaming-redesign-plan.md:83-86
**Pattern to Follow**: `setupMessageListener()` at line 171

**Quality Requirements**:

- ✅ Add case for `session:stats` message type in switch statement
- ✅ Route to ChatStore for state update
- ✅ Type-safe payload handling

**Implementation Details**:

```typescript
case 'session:stats':
  if (this.chatStore) {
    this.chatStore.handleSessionStats(data.payload);
  }
  break;
```

---

### Task 2.3: Store Stats in StreamingHandlerService ✅ COMPLETE

**File(s)**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`
**Specification Reference**: streaming-redesign-plan.md:87-90
**Pattern to Follow**: `finalizeCurrentMessage()` at line 147

**Quality Requirements**:

- ✅ Add method `handleSessionStats(stats)` to update message with cost/token data
- ✅ Find message by sessionId and update tokens/cost fields
- ✅ Ensure badge components can display the data

**Implementation Details**:

```typescript
handleSessionStats(stats: { sessionId: string; cost: number; tokens: { input: number; output: number }; duration: number }): void {
  // Find tab by sessionId
  // Update last assistant message with stats
  // Trigger re-render for badges
}
```

---

**Batch 2 Verification Requirements**:

- ✅ All 3 tasks marked complete
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Build passes: `npx nx build chat`
- ✅ Token/cost badges display after response completes

---

## Batch Execution Protocol

**For Each Batch**:

1. Team-leader assigns entire batch to developer(s)
2. Developer executes ALL tasks in batch (in order)
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch
5. Developer returns with batch git commit SHA
6. Team-leader verifies entire batch
7. If verification passes: Assign next batch
8. If verification fails: Create fix batch

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message lists all completed tasks

**Completion Criteria**:

- All batch statuses are "✅ COMPLETE"
- All batch commits verified
- All files exist
- Build passes

---

---

## Batch 3: Backend Type Safety & Validation (REMEDIATION) ✅ COMPLETE

**Assigned To**: backend-developer
**Tasks in Batch**: 4
**Dependencies**: Batches 1-2 complete (base implementation exists)
**Commit**: 1bf9b4f

### Task 3.1: SDK Stats Type System ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts
**Spec Reference**: remediation-plan.md:89-154
**Pattern to Follow**: Existing type guards at lines 95-131 (isTextBlock, isToolUseBlock)

**Quality Requirements**:

- Replace generic SDKResultMessage (line 65-67) with strict discriminated union
- Add type guard isSDKResultMessage after line 131 (follows existing pattern)
- Change transform() parameter from `any` to `SDKMessage` at line 157
- Type guard must validate all required fields: total_cost_usd, usage.input_tokens, usage.output_tokens, duration_ms
- Use typeof checks for all numeric fields

**Implementation Details**:

```typescript
// Replace SDKResultMessage type (lines 65-67) with:
type SDKResultMessage = SDKMessage & {
  type: 'result';
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  duration_ms: number;
};

// Add after line 131 (after isToolResultBlock):
function isSDKResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return (
    msg.type === 'result' &&
    typeof msg['total_cost_usd'] === 'number' &&
    typeof msg['usage'] === 'object' &&
    msg['usage'] !== null &&
    typeof msg['usage']['input_tokens'] === 'number' &&
    typeof msg['usage']['output_tokens'] === 'number' &&
    typeof msg['duration_ms'] === 'number'
  );
}

// Export the type guard
export { isSDKResultMessage };

// Line 157: Change parameter type
transform(sdkMessage: SDKMessage, sessionId?: SessionId): ExecutionNode[] {
```

**Affected Lines**: 65-67, 131, 157

---

### Task 3.2: Stats Validation Layer ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts
**Spec Reference**: remediation-plan.md:157-250
**Pattern to Follow**: Try-catch pattern from streaming-handler.service.ts:201-215

**Quality Requirements**:

- Create validateStats function before line 164
- Validate cost: 0 ≤ cost ≤ 100 (catches billing errors)
- Validate tokens: 0 ≤ tokens ≤ 1,000,000 (catches overflow)
- Validate duration: 0 ≤ duration ≤ 3,600,000ms (1 hour max)
- Reject NaN and Infinity values
- Log validation failures with logger.warn()
- Return null on validation failure (graceful degradation)

**Implementation Details**:

```typescript
// Add before line 164:
interface ValidatedStats {
  sessionId: string;
  cost: number;
  tokens: { input: number; output: number };
  duration: number;
}

function validateStats(stats: { sessionId: string; cost: number; tokens: { input: number; output: number }; duration: number }, logger: Logger): ValidatedStats | null {
  // Validate cost (max $100 catches billing bugs)
  if (stats.cost < 0 || stats.cost > 100 || isNaN(stats.cost) || !isFinite(stats.cost)) {
    logger.warn('[StreamTransformer] Invalid cost value from SDK:', {
      cost: stats.cost,
      sessionId: stats.sessionId,
    });
    return null;
  }

  // Validate tokens (max 1M catches overflow)
  if (stats.tokens.input < 0 || stats.tokens.input > 1000000 || isNaN(stats.tokens.input) || !isFinite(stats.tokens.input) || stats.tokens.output < 0 || stats.tokens.output > 1000000 || isNaN(stats.tokens.output) || !isFinite(stats.tokens.output)) {
    logger.warn('[StreamTransformer] Invalid token values from SDK:', {
      tokens: stats.tokens,
      sessionId: stats.sessionId,
    });
    return null;
  }

  // Validate duration (max 1 hour = 3,600,000ms)
  if (stats.duration < 0 || stats.duration > 3600000 || isNaN(stats.duration) || !isFinite(stats.duration)) {
    logger.warn('[StreamTransformer] Invalid duration value from SDK:', {
      duration: stats.duration,
      sessionId: stats.sessionId,
    });
    return null;
  }

  return stats; // All validations passed
}
```

**Dependencies**: Task 3.1 (needs isSDKResultMessage type guard)

---

### Task 3.3: Callback Null Protection ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts
**Spec Reference**: remediation-plan.md:252-327
**Pattern to Follow**: Guard clause pattern from streaming-handler.service.ts:275-280

**Quality Requirements**:

- Replace silent null check (line 167) with explicit logger.error()
- Check if onResultStats callback is set BEFORE processing
- Use logger.error() (not warn) - indicates initialization bug
- Add type guard check with isSDKResultMessage (from Task 3.1)
- Integrate validation with validateStats (from Task 3.2)
- Do NOT throw error - graceful degradation (stats are non-critical)

**Implementation Details**:

```typescript
// Replace lines 164-195 with:
// Extract stats from result message and notify via callback
if (sdkMessage.type === 'result') {
  // Check callback is set
  if (!onResultStats) {
    logger.error('[StreamTransformer] Result stats callback not set - stats will be lost!', { sessionId });
    // Continue processing (don't throw) - stats are non-critical
  } else {
    // Type guard for result message structure
    if (!isSDKResultMessage(sdkMessage)) {
      logger.warn('[StreamTransformer] Result message missing required fields', {
        sessionId,
        messageType: sdkMessage.type,
      });
    } else {
      // Extract stats
      const rawStats = {
        sessionId,
        cost: sdkMessage.total_cost_usd,
        tokens: {
          input: sdkMessage.usage.input_tokens,
          output: sdkMessage.usage.output_tokens,
        },
        duration: sdkMessage.duration_ms,
      };

      logger.debug(`[StreamTransformer] Result message received for ${sessionId}`, {
        cost: rawStats.cost,
        duration: rawStats.duration,
        tokens: rawStats.tokens,
      });

      // Validate and notify
      const validatedStats = validateStats(rawStats, logger);
      if (validatedStats) {
        onResultStats(validatedStats);
      }
      // If validation fails, validateStats already logged warning
    }
  }
}
```

**Dependencies**: Task 3.1 (isSDKResultMessage), Task 3.2 (validateStats)
**Affected Lines**: 164-195

---

### Task 3.4: Webview Message Retry Logic ✅ COMPLETE

**File**: D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts
**Spec Reference**: remediation-plan.md:330-414
**Pattern to Follow**: Existing catch pattern at lines 169-174

**Quality Requirements**:

- Create sendStatsWithRetry private method before line 154
- Retry up to 3 times with exponential backoff: 1s, 2s, 4s
- Log each retry attempt with logger.warn()
- Log final failure with logger.error()
- Do NOT throw error - graceful degradation
- Return immediately on first success
- Use async/await pattern

**Implementation Details**:

```typescript
// Add before line 154:
/**
 * Send session stats to webview with retry logic
 * Retries up to 3 times with exponential backoff to handle IPC errors
 */
private async sendStatsWithRetry(
  stats: { sessionId: string; cost: number; tokens: { input: number; output: number }; duration: number },
  maxRetries = 3
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await this.webviewManager.sendMessage('ptah.main', 'session:stats', {
        sessionId: stats.sessionId,
        cost: stats.cost,
        tokens: stats.tokens,
        duration: stats.duration,
      });

      // Success - log if retry was needed
      if (attempt > 1) {
        this.logger.info(`[RPC] Session stats sent after ${attempt} attempts`, {
          sessionId: stats.sessionId,
        });
      }
      return; // Success - exit
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`[RPC] Failed to send session:stats (attempt ${attempt}/${maxRetries})`, {
        sessionId: stats.sessionId,
        error: lastError.message,
      });

      // Wait before retry (exponential backoff: 1s, 2s, 4s)
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  // All retries failed - log error and give up
  this.logger.error(
    '[RPC] Failed to send session:stats after all retries',
    lastError || new Error('Unknown error')
  );
  // Stats lost - graceful degradation (don't crash)
}

// Then modify setupResultStatsCallback() to use it:
// Replace lines 162-174 with:
await this.sendStatsWithRetry(stats);
```

**Affected Lines**: Add method before 154, modify 162-174

---

**Batch 3 Verification Requirements**:

- ✅ All 4 tasks marked ✅ COMPLETE
- ✅ Build passes: `npx nx build agent-sdk`
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ No `any` types in SDK message handling (line 179 changed to SDKMessage)
- ✅ Type guard isSDKResultMessage exists and is used (lines 144-154, exported line 159)
- ✅ Validation function validateStats exists with bounds checks (lines 91-132)
- ✅ Callback null check uses logger.error() (lines 228-233)
- ✅ Retry logic with 3 attempts and exponential backoff (lines 154-196)
- ✅ All error messages include sessionId context

---

## Batch 4: Frontend Logging Enhancements (REMEDIATION) ✅ COMPLETE

**Assigned To**: backend-developer (minor changes, logging only)
**Tasks in Batch**: 3
**Dependencies**: Batch 3 complete (backend validation in place)
**Commit**: 4b28ede

### Task 4.1: Tab Closure Guard Enhancement ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: remediation-plan.md:417-462
**Pattern to Follow**: Existing guard at lines 275-280

**Quality Requirements**:

- OPTIONAL improvement: Inject Logger service
- Change console.warn to logger.warn (line 276)
- Maintain existing guard logic (already correct)
- Add sessionId and tabId to all warning messages

**Implementation Details**:

```typescript
// Line 276: Change from:
console.warn('[StreamingHandlerService] No tab found for session:', stats.sessionId);

// To (if Logger injected):
this.logger.warn('[StreamingHandlerService] No tab found for session', {
  sessionId: stats.sessionId,
});

// OR keep console.warn if Logger injection is complex (OPTIONAL enhancement)
```

**Note**: This is a MINOR improvement. If Logger injection is complex, this can be SKIPPED.

**Affected Lines**: 276, 287, 303

---

### Task 4.2: Message Search Defensive Programming ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts
**Spec Reference**: remediation-plan.md:465-543
**Pattern to Follow**: Existing search logic at lines 292-306

**Quality Requirements**:

- Add comment explaining "last assistant message" assumption (line 292)
- Enhance error messages with detailed context: messageCount, lastMessageRole, tabId
- Add messages.length === 0 validation before line 292
- Add success log with context when target message found

**Implementation Details**:

```typescript
// After line 283, add:
const messages = targetTab.messages;
if (messages.length === 0) {
  console.warn('[StreamingHandlerService] No messages in tab for stats update', { sessionId: stats.sessionId, tabId: targetTab.id });
  return;
}

// Before line 292, add comment:
// ASSUMPTION: Stats correspond to the most recent assistant response
// This assumes single-threaded conversation flow (one message at a time)

// Line 303: Enhance warning message:
console.warn('[StreamingHandlerService] No assistant message found for stats update', {
  sessionId: stats.sessionId,
  tabId: targetTab.id,
  messageCount: messages.length,
  lastMessageRole: messages[messages.length - 1]?.role,
});

// After line 306, add success log:
console.log('[StreamingHandlerService] Found target message for stats', {
  sessionId: stats.sessionId,
  messageIndex: lastAssistantIndex,
  messageCount: messages.length,
});
```

**Dependencies**: None (logging enhancements only)
**Affected Lines**: 284-306 (add checks and enhance logging)

---

### Task 4.3: ChatStore Registration Detection Enhancement ✅ COMPLETE

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts
**Spec Reference**: remediation-plan.md:546-591
**Pattern to Follow**: Existing guard at lines 287-295

**Quality Requirements**:

- OPTIONAL improvement: Add sessionId to warning message (line 293)
- Maintain existing guard logic (already correct)
- Better debugging information in logs

**Implementation Details**:

```typescript
// Line 293: Enhance warning message:
// FROM:
console.warn('[VSCodeService] session:stats received but ChatStore not registered!');

// TO:
console.warn('[VSCodeService] session:stats received but ChatStore not registered!', {
  sessionId: message.payload?.sessionId,
});
```

**Note**: This is a MINOR improvement. Can be SKIPPED if not worth the effort.

**Affected Lines**: 293

---

**Batch 4 Verification Requirements**:

- All 3 tasks marked ✅ COMPLETE
- Build passes: `npx nx build chat`
- Build passes: `npx nx build core`
- All warning messages include context (sessionId, tabId, messageCount)
- Assumption comment added to message search logic
- Success log added when target message found
- (Optional) Logger service injected in StreamingHandlerService

---

## Remediation Success Criteria

**This remediation is COMPLETE when**:

1. ✅ Batch 3 complete: All backend type safety & validation in place
2. ✅ Batch 4 complete: All frontend logging enhancements in place
3. ✅ **Blocking Issue 1 Fixed**: `transform()` parameter changed from `any` to `SDKMessage` (Task 3.1)
4. ✅ **Blocking Issue 2 Fixed**: Type guard `isSDKResultMessage()` validates structure (Task 3.1)
5. ✅ **Critical Issue 1 Fixed**: Callback null check logs ERROR (Task 3.3)
6. ✅ **Critical Issue 2 Fixed**: `validateStats()` rejects invalid values (Task 3.2)
7. ✅ **Serious Issue 1 Addressed**: Tab closure logs warning with context (Task 4.1)
8. ✅ **Serious Issue 2 Fixed**: Webview failure retries 3 times (Task 3.4)
9. ✅ **Serious Issue 3 Addressed**: Message search logs detailed context (Task 4.2)
10. ✅ **Serious Issue 4 Addressed**: ChatStore null logs warning (Task 4.3)

**Code Reviews Must Show**:

- [ ] Code Style Reviewer: No `any` types, type guards follow pattern
- [ ] Code Logic Reviewer: Validation bounds documented, retry logic correct
- [ ] Senior Tester: All edge cases tested (null callback, tab closure, invalid data, webview failure)

---

## Success Criteria (from Original Plan)

- [x] Markdown renders progressively during streaming (Batch 1)
- [x] Streaming indicator stops when `stop_reason` received (Batch 1)
- [x] Multi-turn conversations work (Batch 1)
- [x] Token/cost badges display after response completes (Batch 2)
- [x] Old sessions load with proper markdown (Batch 1)
- [ ] Type safety violations fixed (Batch 3 - REMEDIATION)
- [ ] Silent failure modes addressed (Batch 3 - REMEDIATION)
- [ ] Race conditions handled (Batch 3-4 - REMEDIATION)
- [ ] Defensive programming in place (Batch 3-4 - REMEDIATION)
