# Code Logic Review - TASK_2025_059

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 6.5/10         |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 4              |
| Moderate Issues     | 3              |
| Failure Modes Found | 9              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Silent Failure #1: Missing stats never propagate to UI**

- **Scenario**: SDK result message arrives but `onResultStats` callback is null/undefined
- **Impact**: Cost/token badges remain empty, user sees no feedback
- **Current Handling**: StreamTransformer checks `onResultStats` existence but doesn't log when missing
- **Evidence**: `stream-transformer.ts:167` - Silent null check with no warning

```typescript
if (sdkMessage.type === 'result' && onResultStats && ...) {
  // If onResultStats is null, this block never executes
  // No log, no error, just silent skip
}
```

**Silent Failure #2: Tab not found during stats update**

- **Scenario**: `session:stats` arrives for a closed/destroyed tab
- **Impact**: Stats lost, no user notification
- **Current Handling**: Logs warning but user never sees it
- **Evidence**: `streaming-handler.service.ts:276-280`

```typescript
if (!targetTab) {
  console.warn('[StreamingHandlerService] No tab found for session:', stats.sessionId);
  return; // Stats silently discarded
}
```

**Silent Failure #3: Message index search fails**

- **Scenario**: No assistant messages exist when stats arrive (race condition during rapid tab switching)
- **Impact**: Stats permanently lost for that response
- **Current Handling**: Logs warning, stats dropped
- **Evidence**: `streaming-handler.service.ts:301-306`

### 2. What user action causes unexpected behavior?

**UX Failure #1: Rapid tab switching during streaming**

- **Trigger**: User switches tabs while streaming completes, stats arrive for old tab
- **Symptoms**: Stats update wrong tab OR get lost entirely
- **Impact**: User sees incorrect cost data OR missing badges
- **Current Handling**: Tab lookup by sessionId may find wrong tab if IDs collide

**UX Failure #2: User closes tab before stats arrive**

- **Trigger**: User closes tab → SDK still processing → result message arrives
- **Symptoms**: Stats callback fires, no tab exists, silent failure
- **Impact**: No error shown to user, appears as if calculation failed

**UX Failure #3: Multiple messages streaming concurrently (multi-tab)**

- **Trigger**: User starts chat in Tab A, switches to Tab B, starts another chat
- **Symptoms**: Stats from Tab A arrive while Tab B is active → wrong message updated
- **Impact**: Tab B's message gets Tab A's stats (cost/token mismatch)

### 3. What data makes this produce wrong results?

**Data Failure #1: Malformed result message from SDK**

- **Trigger**: SDK sends result without `usage` or `total_cost_usd` fields
- **Symptoms**: `onResultStats` callback receives NaN or 0 values
- **Impact**: UI shows $0.00 cost when actual cost occurred
- **Evidence**: `stream-transformer.ts:186-194` - Falls back to 0 but doesn't validate data integrity

```typescript
onResultStats({
  sessionId,
  cost: (sdkMessage['total_cost_usd'] as number) || 0, // 0 on undefined/null - MISLEADING
  tokens: {
    input: usage.input_tokens || 0, // 0 on undefined - MISLEADING
    output: usage.output_tokens || 0,
  },
  duration: (sdkMessage['duration_ms'] as number) || 0,
});
```

**Data Failure #2: Negative token counts**

- **Trigger**: SDK bug or corrupted data sends negative values
- **Symptoms**: No validation, negative values propagate to UI
- **Impact**: UI shows "-1000 tokens" or "$ -0.50"

**Data Failure #3: sessionId mismatch between placeholder and real**

- **Trigger**: Tab uses placeholder ID, stats arrive with real Claude UUID
- **Symptoms**: Tab lookup fails, stats lost
- **Impact**: User never sees cost/token data for that session

### 4. What happens when dependencies fail?

| Integration                                 | Failure Mode                     | Current Handling                 | Assessment                          |
| ------------------------------------------- | -------------------------------- | -------------------------------- | ----------------------------------- |
| SDK result message never arrives            | Timeout/crash before completion  | NO HANDLING                      | CRITICAL: Badges stay empty forever |
| WebviewManager.sendMessage fails            | Network error, webview destroyed | Catch block logs error, no retry | SERIOUS: Stats lost, no UI feedback |
| TabManager.findTabBySessionId returns null  | Tab closed/destroyed             | Warn and return                  | SERIOUS: Stats silently dropped     |
| StreamingHandlerService injection fails     | DI container error               | Service null, app crashes        | CRITICAL: Entire feature broken     |
| ChatStore not registered with VSCodeService | Race condition during init       | Warning logged, message ignored  | SERIOUS: Stats never reach handler  |

### 5. What's missing that the requirements didn't mention?

**Gap #1: No timeout handling**

- SDK result message might arrive after user closes app → stats lost
- Should persist stats to storage for later display

**Gap #2: No retry logic**

- If webview message send fails, stats lost forever
- Should queue failed stats and retry

**Gap #3: No validation of SDK data**

- No min/max bounds checking on costs/tokens
- No detection of obviously wrong values (e.g., $1000 for single message)

**Gap #4: No user notification of missing stats**

- If stats fail to load, user just sees empty badges
- Should show "Stats unavailable" or retry button

**Gap #5: No offline/persistence handling**

- Stats only stored in memory (tab state)
- If user reloads session, stats lost forever

## Failure Mode Analysis

### Failure Mode 1: Stats Message Lost in Transit

- **Trigger**: WebviewManager.sendMessage throws error (webview destroyed, IPC failure)
- **Symptoms**: Backend logs success, frontend never receives message
- **Impact**: Cost/token badges remain empty, user thinks feature is broken
- **Current Handling**: Error caught and logged, no retry
- **Recommendation**: Implement retry queue with exponential backoff, persist to storage as fallback

### Failure Mode 2: Race Condition on Tab Closure

- **Trigger**:
  1. User starts streaming message
  2. User closes tab before completion
  3. SDK result message arrives
  4. Stats callback fires → tab lookup fails
- **Symptoms**: Warning logged, stats discarded
- **Impact**: Permanent data loss, no recovery path
- **Current Handling**: Silent warning, no persistence
- **Recommendation**: Persist stats to storage keyed by sessionId, load on session resume

### Failure Mode 3: Multiple Messages in Flight (Multi-Tab)

- **Trigger**:
  1. Tab A starts streaming (sessionId: A1)
  2. Tab B starts streaming (sessionId: B1)
  3. Tab A completes → stats arrive for A1
  4. Tab B completes → stats arrive for B1
  5. If timing overlaps, wrong message might get wrong stats
- **Symptoms**: Message in Tab A shows Tab B's costs/tokens
- **Impact**: User sees incorrect financial data (CRITICAL for billing!)
- **Current Handling**: Tab lookup by sessionId, assumes no race
- **Recommendation**: Add message-level correlation (messageId + sessionId), verify match before update

### Failure Mode 4: SDK Returns Invalid Data

- **Trigger**: SDK bug, API change, or corrupted response sends:
  - Negative token counts
  - Cost > $100 (unrealistic for single message)
  - Missing required fields
- **Symptoms**: Invalid data propagates to UI unchecked
- **Impact**: User sees nonsensical values, loses trust in feature
- **Current Handling**: Falls back to 0 for missing fields, no validation
- **Recommendation**: Add validation layer with min/max bounds, reject obviously wrong data

### Failure Mode 5: Callback Not Set (Initialization Race)

- **Trigger**:
  1. SdkAgentAdapter created
  2. Stream started before RpcMethodRegistrationService sets callback
  3. Result message arrives → callback null
- **Symptoms**: Stats never sent to webview
- **Impact**: All messages missing cost/token data
- **Current Handling**: Silent null check in StreamTransformer
- **Recommendation**: Lazy callback invocation with buffering OR fail-fast error if callback null

### Failure Mode 6: VSCodeService Routing Fails

- **Trigger**:
  - `session:stats` message arrives
  - ChatStore not registered with VSCodeService (race condition)
- **Symptoms**: Warning logged, message dropped
- **Impact**: Stats never reach StreamingHandlerService
- **Current Handling**: Warning logged, silent failure
- **Recommendation**: Queue messages until ChatStore ready OR throw error to force proper initialization

### Failure Mode 7: Streaming Never Completes (stop_reason Never Arrives)

- **Trigger**: SDK bug or network issue prevents stop_reason from being set
- **Symptoms**: Message stays in "streaming" state forever, markdown never finalizes
- **Impact**: User sees pulsing animation forever, can't interact with message
- **Current Handling**: No timeout, relies entirely on SDK's stop_reason
- **Recommendation**: Add client-side timeout (30s), force complete if exceeded

### Failure Mode 8: Empty Execution Tree on Finalization

- **Trigger**:
  - Stats arrive before any ExecutionNodes processed
  - Tab has no execution tree yet
- **Symptoms**: No message to attach stats to
- **Impact**: Stats discarded, badges empty
- **Current Handling**: Early return if no messages
- **Recommendation**: Buffer stats and apply when message arrives (eventual consistency)

### Failure Mode 9: Cost Calculation Exception

- **Trigger**: calculateMessageCost throws error (unknown model, invalid tokens)
- **Symptoms**: Try-catch logs error, cost undefined
- **Impact**: Badges show tokens but no cost
- **Current Handling**: Graceful degradation (tokens shown, cost hidden)
- **Recommendation**: OK - this is acceptable fallback, but should show "Cost unavailable" tooltip

## Critical Issues

### Issue 1: No Callback Null Protection

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts:167`
- **Scenario**: RpcMethodRegistrationService initialization delayed, callback not set before first result message
- **Impact**: ALL stats messages lost for early messages, silent failure
- **Evidence**:

```typescript
// Line 164-195
if (
  sdkMessage.type === 'result' &&
  onResultStats && // <-- Silent skip if null, no warning!
  'total_cost_usd' in sdkMessage &&
  'usage' in sdkMessage &&
  'duration_ms' in sdkMessage
) {
  // This entire block skipped silently if onResultStats is null
}
```

- **Fix**: Add explicit null check with error logging:

```typescript
if (sdkMessage.type === 'result') {
  if (!onResultStats) {
    logger.error('[StreamTransformer] Result stats callback not set - stats will be lost!');
    return; // Or throw error to fail fast
  }
  // ... rest of logic
}
```

### Issue 2: No Validation of SDK Stats Data

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts:186-194`
- **Scenario**: SDK returns negative tokens, cost > $100, or NaN values
- **Impact**: Invalid data propagates to UI unchecked, user sees nonsensical values
- **Evidence**:

```typescript
onResultStats({
  sessionId,
  cost: (sdkMessage['total_cost_usd'] as number) || 0, // No validation!
  tokens: {
    input: usage.input_tokens || 0, // Could be negative or NaN
    output: usage.output_tokens || 0,
  },
  duration: (sdkMessage['duration_ms'] as number) || 0,
});
```

- **Fix**: Add validation layer:

```typescript
const cost = (sdkMessage['total_cost_usd'] as number) || 0;
const inputTokens = usage.input_tokens || 0;
const outputTokens = usage.output_tokens || 0;
const duration = (sdkMessage['duration_ms'] as number) || 0;

// Validate bounds
if (cost < 0 || cost > 100) {
  logger.warn('[StreamTransformer] Invalid cost value:', cost);
  // Use undefined instead of invalid value
}
if (inputTokens < 0 || outputTokens < 0) {
  logger.warn('[StreamTransformer] Invalid token values:', { inputTokens, outputTokens });
}
```

## Serious Issues

### Issue 3: Tab Closure Race Condition

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts:273-282`
- **Scenario**:
  1. User starts streaming in Tab A
  2. User closes Tab A mid-stream
  3. SDK completes, sends stats for Tab A's session
  4. Tab lookup fails → stats lost
- **Impact**: Permanent data loss, no recovery mechanism
- **Evidence**:

```typescript
const targetTab = this.tabManager.findTabBySessionId(stats.sessionId);
if (!targetTab) {
  console.warn('[StreamingHandlerService] No tab found for session:', stats.sessionId);
  return; // Stats permanently lost
}
```

- **Fix**: Persist stats to storage as fallback:

```typescript
if (!targetTab) {
  console.warn('[StreamingHandlerService] Tab closed, persisting stats for later');
  await this.statsStorage.persistStats(stats.sessionId, stats);
  return;
}
```

### Issue 4: No Retry on Webview Message Failure

- **File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc-method-registration.service.ts:162-175`
- **Scenario**: WebviewManager.sendMessage throws (webview destroyed, IPC error)
- **Impact**: Stats lost, user never sees badges
- **Evidence**:

```typescript
this.webviewManager
  .sendMessage('ptah.main', 'session:stats', { ... })
  .catch((error) => {
    this.logger.error('Failed to send session:stats to webview', ...);
    // No retry, stats lost forever
  });
```

- **Fix**: Implement retry queue:

```typescript
const maxRetries = 3;
let attempt = 0;
const sendWithRetry = async () => {
  try {
    await this.webviewManager.sendMessage('ptah.main', 'session:stats', { ... });
  } catch (error) {
    if (++attempt < maxRetries) {
      await delay(1000 * attempt); // Exponential backoff
      return sendWithRetry();
    }
    this.logger.error('Failed after retries, persisting to storage');
    await this.statsStorage.persistStats(stats.sessionId, stats);
  }
};
```

### Issue 5: Message Index Search Fragility

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts:292-306`
- **Scenario**: Rapid message sending/deleting causes messages array to be in inconsistent state when stats arrive
- **Impact**: Stats applied to wrong message OR lost entirely
- **Evidence**:

```typescript
for (let i = messages.length - 1; i >= 0; i--) {
  if (messages[i].role === 'assistant') {
    lastAssistantIndex = i;
    break;
  }
}
// What if messages array changed during iteration?
// What if last assistant message is NOT the one that just completed?
```

- **Fix**: Use message correlation (match by ID or timestamp):

```typescript
// Store messageId with stats for correlation
const targetMessage = messages.find(
  (m) =>
    m.role === 'assistant' &&
    m.sessionId === stats.sessionId &&
    m.timestamp > stats.startTime - 1000 && // Within 1s tolerance
    !m.tokens // Not already updated
);
if (!targetMessage) {
  console.warn('[StreamingHandlerService] No matching message for stats');
  return;
}
```

### Issue 6: ChatStore Registration Race Condition

- **File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts:283-296`
- **Scenario**:
  1. VSCodeService created, message listener registered
  2. `session:stats` message arrives BEFORE ChatStore sets itself
  3. Message dropped silently
- **Impact**: First few messages missing stats
- **Evidence**:

```typescript
if (message.type === 'session:stats') {
  if (message.payload && this.chatStore) {
    // <-- chatStore might be null!
    this.chatStore.handleSessionStats(message.payload);
  } else {
    console.warn('[VSCodeService] session:stats received but ChatStore not registered!');
    // Message lost, no buffering
  }
}
```

- **Fix**: Buffer messages until ChatStore ready:

```typescript
private statsBuffer: Array<{ sessionId: string; cost: number; tokens: any; duration: number }> = [];

if (message.type === 'session:stats') {
  if (!this.chatStore) {
    this.statsBuffer.push(message.payload);
    console.warn('[VSCodeService] Buffering stats until ChatStore ready');
    return;
  }
  // Process buffered messages when ChatStore sets itself
  this.chatStore.handleSessionStats(message.payload);
}
```

## Moderate Issues

### Issue 7: No User Feedback on Missing Stats

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts:285-290`
- **Scenario**: Stats never arrive, badges remain empty
- **Impact**: User assumes feature is broken, no way to know if it's still loading or failed
- **Evidence**: No timeout, no loading state, no error state
- **Fix**: Add timeout and error state to badge components:

```typescript
// Set loading state when streaming completes
this.tabManager.updateTab(targetTabId, { statsLoading: true });

// If stats don't arrive within 10s, show error
setTimeout(() => {
  if (!message.tokens) {
    this.tabManager.updateTab(targetTabId, { statsError: true });
  }
}, 10000);
```

### Issue 8: Cost Calculation Silent Failure

- **File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts:201-215`
- **Scenario**: calculateMessageCost throws for unknown model
- **Impact**: Cost badge hidden, user doesn't know why
- **Evidence**:

```typescript
try {
  const modelId = finalTree.model ?? 'default';
  cost = calculateMessageCost(modelId, tokens);
} catch (error) {
  console.error('[StreamingHandlerService] Cost calculation failed', error);
  cost = undefined; // No user notification
}
```

- **Fix**: Set error flag and show tooltip:

```typescript
catch (error) {
  console.error('[StreamingHandlerService] Cost calculation failed', error);
  cost = undefined;
  this.tabManager.updateTab(targetTabId, { costCalculationError: error.message });
}
```

### Issue 9: stop_reason Assumption Never Validated

- **File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-message-transformer.ts:217-222`
- **Scenario**: SDK changes behavior, stop_reason field removed or renamed
- **Impact**: All messages stuck in "streaming" state forever
- **Evidence**:

```typescript
const isMessageComplete = !!message.stop_reason;
const messageStatus: ExecutionStatus = isMessageComplete ? 'complete' : 'streaming';
// No validation that stop_reason format is what we expect
```

- **Fix**: Add validation and fallback timeout:

```typescript
const isMessageComplete = message.stop_reason && typeof message.stop_reason === 'string' && ['end_turn', 'max_tokens', 'stop_sequence'].includes(message.stop_reason);

// Add client-side timeout as safety net
if (!isMessageComplete) {
  setTimeout(() => {
    if (node.status === 'streaming') {
      logger.warn('[SdkMessageTransformer] Forcing completion after timeout');
      node.status = 'complete';
    }
  }, 30000);
}
```

## Data Flow Analysis

```
┌─────────────────────────────────────────────────────────────────────┐
│ SDK Result Message Flow                                             │
└─────────────────────────────────────────────────────────────────────┘

1. SDK emits result message
   └─> StreamTransformer.transform() receives it
       ├─> [CHECK] onResultStats callback exists? (NO ERROR IF NULL)
       ├─> [CHECK] Required fields present? (NO VALIDATION)
       └─> [CALL] onResultStats(stats) if all checks pass
           │
           └─> RpcMethodRegistrationService.setupResultStatsCallback()
               ├─> [CALL] webviewManager.sendMessage('session:stats', stats)
               │   ├─> [FAILURE POINT] Webview destroyed? -> catch logs, stats lost
               │   ├─> [FAILURE POINT] IPC error? -> catch logs, stats lost
               │   └─> [FAILURE POINT] Timeout? -> No timeout handling
               │
               └─> VSCodeService.setupMessageListener()
                   ├─> [CHECK] message.type === 'session:stats'?
                   ├─> [CHECK] this.chatStore exists? (WARN IF NULL)
                   └─> [CALL] this.chatStore.handleSessionStats(payload)
                       │
                       └─> ChatStore.handleSessionStats()
                           └─> StreamingHandlerService.handleSessionStats()
                               ├─> [LOOKUP] Find tab by sessionId
                               │   ├─> [FAILURE POINT] Tab closed? -> warn, stats lost
                               │   └─> [FAILURE POINT] Session ID wrong? -> warn, stats lost
                               │
                               ├─> [SEARCH] Find last assistant message
                               │   ├─> [FAILURE POINT] No messages? -> warn, stats lost
                               │   └─> [FAILURE POINT] No assistant messages? -> warn, stats lost
                               │
                               └─> [UPDATE] Update message with stats
                                   └─> TabManager.updateTab() triggers re-render
                                       └─> Badges display cost/tokens

Gap Points Identified:
1. [Line 167] Callback null check - no error logged
2. [Line 186] No validation of stats values (negative, NaN, excessive)
3. [Line 162] No retry on webview send failure
4. [Line 273] Tab closure race - stats lost permanently
5. [Line 292] Message search fragile - could match wrong message
6. [Line 284] No user notification if stats never arrive
```

## Requirements Fulfillment

| Requirement                                    | Status   | Concern                                                         |
| ---------------------------------------------- | -------- | --------------------------------------------------------------- |
| Use `stop_reason` for per-message completion   | COMPLETE | No validation of stop_reason format, could break on SDK changes |
| Always render markdown (no conditional switch) | COMPLETE | Depends on stop_reason being reliable                           |
| Send `session:stats` after streaming completes | COMPLETE | No retry on failure, stats can be lost                          |
| Route stats through VSCodeService → ChatStore  | COMPLETE | Race condition if ChatStore not registered, no buffering        |
| Update message with stats for badge display    | PARTIAL  | Updates message but no error handling, silent failures          |

### Implicit Requirements NOT Addressed:

1. **Stats persistence**: What if user reloads session? Stats lost forever (not persisted to storage)
2. **Error recovery**: What if stats send fails? No retry, no persistence, permanent data loss
3. **Multi-tab safety**: What if stats arrive for closed tab? Lost, no recovery
4. **Data validation**: What if SDK sends invalid data? No bounds checking, propagates to UI
5. **User feedback**: What if stats fail to load? User sees empty badges, no indication of why
6. **Timeout handling**: What if result message never arrives? Badges empty forever, no timeout
7. **Backward compatibility**: What if old sessions have no stats? No "Stats unavailable" indicator

## Edge Case Analysis

| Edge Case                                  | Handled | How                         | Concern                                                     |
| ------------------------------------------ | ------- | --------------------------- | ----------------------------------------------------------- |
| stop_reason is null                        | YES     | Falls back to 'streaming'   | RISK: If SDK changes behavior, all messages stuck streaming |
| stop_reason is undefined                   | YES     | !! coerces to false         | Same as above                                               |
| SDK result message never arrives           | NO      | No timeout                  | CRITICAL: Badges empty forever, no user feedback            |
| WebviewManager.sendMessage fails           | NO      | Logs error, stats lost      | SERIOUS: One-shot send, no retry or persistence             |
| Tab closed before stats arrive             | NO      | Warns, stats lost           | SERIOUS: User loses financial data                          |
| Multiple messages streaming (multi-tab)    | PARTIAL | Tab lookup by sessionId     | RISK: Race conditions, wrong message updated                |
| ChatStore not registered when stats arrive | NO      | Warns, message dropped      | SERIOUS: Early messages missing stats                       |
| Negative token counts from SDK             | NO      | No validation               | MODERATE: Invalid data shown to user                        |
| Cost > $100 (unrealistic)                  | NO      | No validation               | MODERATE: User sees wrong data, loses trust                 |
| Empty execution tree when stats arrive     | PARTIAL | Early return if no messages | RISK: Stats lost if timing issue                            |
| calculateMessageCost throws exception      | YES     | Try-catch, cost undefined   | OK: Graceful degradation, but no user notification          |

## Integration Risk Assessment

| Integration                                   | Failure Probability         | Impact                                 | Mitigation                                  |
| --------------------------------------------- | --------------------------- | -------------------------------------- | ------------------------------------------- |
| SDK → StreamTransformer → Callback            | LOW (assuming callback set) | CRITICAL (all stats lost)              | Add null check with error logging           |
| RpcMethodRegistrationService → WebviewManager | MEDIUM (IPC failures)       | SERIOUS (stats lost for that message)  | Add retry queue with persistence            |
| VSCodeService → ChatStore                     | MEDIUM (race condition)     | SERIOUS (early messages missing stats) | Add message buffering until ChatStore ready |
| TabManager → Tab lookup                       | MEDIUM (user closes tabs)   | SERIOUS (stats lost permanently)       | Persist stats to storage, load on resume    |
| StreamingHandler → Message search             | LOW (array operations)      | SERIOUS (wrong message updated)        | Add correlation by messageId + timestamp    |

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Stats message silently lost due to missing callback, closed tab, or IPC failure - no retry, no persistence, permanent data loss

## What Robust Implementation Would Include

1. **Retry & Persistence Layer**

   - Retry failed webview messages with exponential backoff (3 attempts)
   - Persist stats to storage if all retries fail
   - Load persisted stats on session resume

2. **Data Validation Layer**

   - Min/max bounds checking on costs ($0 - $100), tokens (0 - 1M), duration (0 - 1 hour)
   - Reject obviously invalid data (negative values, NaN, Infinity)
   - Log validation failures with SDK message for debugging

3. **Race Condition Protection**

   - Buffer stats messages until ChatStore registered
   - Correlate stats with specific messageId (not just "last assistant message")
   - Handle tab closure by persisting stats for later retrieval

4. **User Feedback System**

   - Loading state on badges while waiting for stats (10s timeout)
   - Error state with tooltip if stats fail to load ("Stats unavailable - click to retry")
   - "Stats unavailable" indicator for old sessions without stats

5. **Timeout & Recovery**

   - Client-side timeout (30s) on streaming if stop_reason never arrives
   - Server-side timeout (60s) on result message, trigger manual stats request
   - Graceful degradation: show partial data (tokens only) if cost calculation fails

6. **Observability**

   - Log stats lifecycle: sent → received → applied
   - Metrics: stats delivery success rate, average latency
   - Alerts: if stats drop rate > 5% over 5 minutes

7. **Backward Compatibility**
   - Handle sessions without stats (pre-migration)
   - Show "Stats not available for this session" tooltip
   - Optional: "Recalculate stats" button for admin users

## Code Quality Observations

### Strengths

- Clear separation of concerns (StreamTransformer, RpcMethodRegistration, StreamingHandler)
- Proper use of callbacks for loose coupling
- Comprehensive logging (though missing critical error cases)
- Type-safe message passing

### Weaknesses

- No error recovery strategies (one-shot operations)
- Silent failures with only console.warn (user never sees issues)
- No data validation (trusts SDK implicitly)
- Fragile tab/message lookup logic (race conditions)
- No timeout handling (infinite waits)

### Technical Debt

- Stats not persisted to storage (memory-only)
- No retry logic on any operations
- Message correlation by "last assistant message" is fragile
- Callback registration race condition not solved

## Final Assessment

This implementation covers the **happy path** well but has **significant gaps in error handling**. The streaming logic (stop_reason, markdown rendering) is solid, but the stats flow is **fragile and prone to silent data loss**.

**Primary Concerns**:

1. Stats lost on tab closure (no persistence)
2. Stats lost on IPC failure (no retry)
3. Invalid data from SDK (no validation)
4. Race conditions (callback not set, ChatStore not registered)

**Recommendation**: Address Critical Issues #1-2 and Serious Issues #3-4 before production deployment. The current implementation will work 90% of the time, but the 10% failure cases result in permanent data loss, which is unacceptable for financial/billing data (token costs).

**Estimated Risk**: If deployed as-is, expect 5-10% of messages to have missing or incorrect cost/token data due to the identified failure modes.
