# Implementation Plan - TASK_2025_049: SDK Integration Critical Fixes

## Executive Summary

**Problem**: Multi-turn conversation is completely broken because we use string prompt instead of SDK's streaming input mode (`AsyncIterable<SDKUserMessage>`). Additional bugs: incorrect role assignment (line 284), custom parent tracking instead of SDK's native `parent_tool_use_id`, and SDK control methods (interrupt/setModel/setPermissionMode) not exposed.

**Solution**: Implement AsyncIterable message generator for continuous conversation, fix role assignment bug, use SDK's native parent linking, and expose SDK control methods to UI.

**Scope**: 5 targeted fixes across 4 files. No architectural rewrite—just fix what's broken.

---

## Codebase Investigation Summary

### Evidence: Current Implementation Problems

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`

**Problem 1: Multi-Turn Broken** (Lines 224-254):

```typescript
const sdkQuery = query({
  prompt: '', // ❌ Empty string - no conversation possible
  options: { ... }
});
```

**Problem 2: Role Assignment Bug** (Line 284):

```typescript
role: node.type === 'message' ? 'assistant' : 'assistant', // ❌ Always 'assistant'!
```

**Problem 3: Custom Parent Tracking** (Line 267):

```typescript
let currentParentId: MessageId | null = null; // ❌ SDK provides parent_tool_use_id
```

**Problem 4: sendMessageToSession() Stores But Never Sends** (Lines 347-398):

```typescript
await this.storage.addMessage(sessionId, userMessage);
// TODO: Implement streaming input mode for SDK
// ❌ Message stored but never sent to SDK!
```

**Problem 5: SDK Controls Not Exposed**:

- `query.interrupt()` - exists but not exposed to UI
- `query.setModel()` - exists but not exposed to UI
- `query.setPermissionMode()` - exists but not exposed to UI

### SDK Reference Evidence

**Source**: `task-tracking/TASK_2025_044/claude-agent-sdk.md`

**Streaming Input Mode** (Lines 20-21):

```typescript
function query({
  prompt: string | AsyncIterable<SDKUserMessage>, // ✅ AsyncIterable for multi-turn
  options?: Options
}): Query;
```

**Native Parent Linking** (Lines 405, 419):

```typescript
SDKAssistantMessage {
  parent_tool_use_id: string | null; // ✅ SDK's native linking
}

SDKUserMessage {
  parent_tool_use_id: string | null; // ✅ SDK's native linking
}
```

**Dynamic Controls** (Lines 117-121):

```typescript
interface Query extends AsyncGenerator<SDKMessage, void> {
  interrupt(): Promise<void>; // ✅ Stop agent mid-execution
  setPermissionMode(): Promise<void>; // ✅ Change autopilot mode
  setModel(): Promise<void>; // ✅ Switch Claude model
}
```

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Minimal Generator Pattern
**Rationale**: SDK's streaming input mode requires `AsyncIterable<SDKUserMessage>`. Simplest solution is a generator that yields messages from a queue.
**Evidence**: SDK docs (lines 20-21), existing code structure supports adding generator without major refactor.

---

## Component Changes

### Fix 1: Implement Streaming Input Mode (Multi-Turn Fix)

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
**Lines Changed**: 66-72 (ActiveSession interface), 224-225 (query call), 347-398 (sendMessageToSession)

#### Pattern (Verified from SDK docs):

```typescript
// Add message queue to ActiveSession interface (line 66)
interface ActiveSession {
  sessionId: SessionId;
  query: Query;
  config: AISessionConfig;
  abortController: AbortController;
  // NEW: Message queue for streaming input
  messageQueue: SDKUserMessage[];
  resolveNext: (() => void) | null;
}
```

```typescript
// Change from string to AsyncIterable generator (line 224)
// BEFORE:
const sdkQuery = query({
  prompt: '', // ❌ Empty string
  options: { ... }
});

// AFTER:
const messageQueue: SDKUserMessage[] = [];
let resolveNext: (() => void) | null = null;

const userMessageStream: AsyncIterable<SDKUserMessage> = {
  async *[Symbol.asyncIterator]() {
    while (!abortController.signal.aborted) {
      // Wait for next message to be queued
      if (messageQueue.length === 0) {
        await new Promise<void>(resolve => { resolveNext = resolve; });
      }

      const message = messageQueue.shift();
      if (!message) break;

      yield message;
    }
  }
};

const sdkQuery = query({
  prompt: userMessageStream, // ✅ Streaming input mode
  options: { ... }
});
```

```typescript
// Fix sendMessageToSession to queue messages (line 347)
// BEFORE:
async sendMessageToSession(sessionId, content, options) {
  await this.storage.addMessage(sessionId, userMessage);
  // TODO: Implement streaming input mode for SDK
}

// AFTER:
async sendMessageToSession(sessionId, content, options) {
  const session = this.activeSessions.get(sessionId as string);
  if (!session) throw new Error('Session not found');

  // Create SDKUserMessage
  const userMessage: SDKUserMessage = {
    type: 'user',
    uuid: MessageId.create().toString(),
    session_id: sessionId,
    message: {
      role: 'user',
      content: content,
    },
    parent_tool_use_id: null, // SDK manages this
  };

  // Store for UI (still needed for session history)
  await this.storage.addMessage(sessionId, storedMessage);

  // Queue message for SDK generator
  session.messageQueue.push(userMessage);
  if (session.resolveNext) {
    session.resolveNext(); // Wake up iterator
    session.resolveNext = null;
  }

  // ✅ Message now sent to SDK!
}
```

**Quality Requirements**:

- **Functional**: User sends message → SDK receives it within 100ms
- **Non-Functional**: Generator cleanup on session end (no memory leaks)
- **Pattern Compliance**: Matches SDK AsyncIterable pattern (claude-agent-sdk.md:20-21)

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)

---

### Fix 2: Correct Role Assignment

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
**Line Changed**: 284

#### Pattern (Verified from SDK docs):

```typescript
// BEFORE (line 284):
role: node.type === 'message' ? 'assistant' : 'assistant', // ❌ Always 'assistant'

// AFTER:
role: sdkMessage.type === 'user' ? 'user' : 'assistant', // ✅ Correct based on SDK message type
```

**Alternative (More Robust)**:

```typescript
// Helper function for type-safe role mapping
function getRoleFromSDKMessage(sdkMessage: SDKMessage): 'user' | 'assistant' | 'system' {
  switch (sdkMessage.type) {
    case 'user':
      return 'user';
    case 'assistant':
      return 'assistant';
    case 'system':
    case 'result':
      return 'system';
    default:
      return 'assistant'; // fallback
  }
}

// Usage (line 284):
role: getRoleFromSDKMessage(sdkMessage), // ✅ Type-safe role assignment
```

**Quality Requirements**:

- **Functional**: User messages have role='user', assistant messages have role='assistant'
- **Pattern Compliance**: Matches SDK message types (claude-agent-sdk.md:399-421)

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)

---

### Fix 3: Use SDK's Native Parent Linking

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
**Lines Changed**: 267-297 (remove custom tracking, use SDK field)

#### Pattern (Verified from SDK docs):

```typescript
// BEFORE (lines 267-297):
let currentParentId: MessageId | null = null; // ❌ Custom tracking
// ... custom parent tracking logic
currentParentId = messageId; // ❌ Manual assignment

// AFTER:
// DELETE custom parent tracking variable (line 267)
// Use SDK's parent_tool_use_id directly (line 283)

const storedMessage: StoredSessionMessage = {
  id: messageId,
  parentId: sdkMessage.parent_tool_use_id ? MessageId.from(sdkMessage.parent_tool_use_id) : null, // ✅ SDK's native linking
  role: getRoleFromSDKMessage(sdkMessage),
  content: [node],
  timestamp: Date.now(),
  model: config?.model,
  tokens: node.tokenUsage,
};
```

**Quality Requirements**:

- **Functional**: Message parent-child relationships match SDK's native linking
- **Code Quality**: Remove 30 lines of custom parent tracking logic
- **Pattern Compliance**: Uses SDK's parent_tool_use_id (claude-agent-sdk.md:405, 419)

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)

---

### Fix 4: Expose SDK Control Methods

**File**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
**Lines Added**: After line 413 (new methods)

#### Pattern (Verified from SDK docs):

```typescript
// Add new methods to SdkAgentAdapter class (after line 413)

/**
 * Interrupt active session (stop agent mid-execution)
 * Only available when using streaming input mode
 */
async interruptSession(sessionId: SessionId): Promise<void> {
  const session = this.activeSessions.get(sessionId as string);
  if (!session) throw new Error('Session not found');

  await session.query.interrupt();
  this.logger.info(`[SdkAgentAdapter] Interrupted session: ${sessionId}`);
}

/**
 * Change model mid-conversation
 * Only available when using streaming input mode
 */
async setSessionModel(sessionId: SessionId, model: string): Promise<void> {
  const session = this.activeSessions.get(sessionId as string);
  if (!session) throw new Error('Session not found');

  await session.query.setModel(model);
  this.logger.info(`[SdkAgentAdapter] Changed model to ${model} for session: ${sessionId}`);
}

/**
 * Change permission mode (autopilot toggle)
 * Only available when using streaming input mode
 */
async setSessionPermissionMode(
  sessionId: SessionId,
  mode: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
): Promise<void> {
  const session = this.activeSessions.get(sessionId as string);
  if (!session) throw new Error('Session not found');

  await session.query.setPermissionMode(mode);
  this.logger.info(`[SdkAgentAdapter] Changed permission mode to ${mode} for session: ${sessionId}`);
}
```

**Quality Requirements**:

- **Functional**: UI can call interrupt/setModel/setPermissionMode and SDK responds
- **Error Handling**: Throw clear errors if session not found or not in streaming mode
- **Pattern Compliance**: Uses SDK Query methods (claude-agent-sdk.md:117-121)

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (MODIFY)

**Integration Points**:

- Frontend will need to call these methods via RPC (out of scope for this task)
- Methods are exposed via IAIProvider interface extension (optional - can add later)

---

### Fix 5: Simplify Session Storage (Optional - Phase 2)

**File**: `libs/backend/agent-sdk/src/lib/sdk-session-storage.ts`
**Status**: DEFERRED to Phase 2

**Rationale**: Multi-turn fix is critical. Storage simplification is optimization.
**Future Work**: Remove message storage (SDK handles this via resume option), keep only UI metadata (session name, createdAt, isFavorite).

---

## Implementation Tasks (Priority Order)

### Task 1: Fix Role Assignment Bug ⚡ (5 minutes)

**Description**: Change line 284 from `'assistant' : 'assistant'` to correct role logic.

**Steps**:

1. Open `sdk-agent-adapter.ts`
2. Find line 284
3. Change to: `role: sdkMessage.type === 'user' ? 'user' : 'assistant'`
4. Test: Create session, send user message, verify role='user' in storage

**Verification**:

- User message has role='user' ✅
- Assistant message has role='assistant' ✅

---

### Task 2: Implement Streaming Input Mode 🔥 (2-3 hours)

**Description**: Replace string prompt with AsyncIterable message generator.

**Steps**:

1. Update `ActiveSession` interface (add messageQueue, resolveNext)
2. Create `userMessageStream` AsyncIterable generator in `startChatSession()`
3. Pass generator to `query({ prompt: userMessageStream })`
4. Update `sendMessageToSession()` to queue messages and wake iterator
5. Test: Send 3 messages in conversation, verify all received by SDK

**Verification**:

- User sends message 1 → SDK processes ✅
- User sends message 2 → SDK processes (multi-turn works!) ✅
- Generator cleans up on session end (no memory leak) ✅

---

### Task 3: Use SDK's Native Parent Linking (1 hour)

**Description**: Remove custom parent tracking, use `parent_tool_use_id`.

**Steps**:

1. Delete `currentParentId` variable (line 267)
2. Delete custom parent tracking logic (lines 267-297)
3. Change line 283 to: `parentId: sdkMessage.parent_tool_use_id ? MessageId.from(sdkMessage.parent_tool_use_id) : null`
4. Test: Verify message parent-child relationships in UI tree

**Verification**:

- Message parent links match SDK's `parent_tool_use_id` ✅
- 30 lines of code removed ✅

---

### Task 4: Expose SDK Control Methods (1 hour)

**Description**: Add interrupt/setModel/setPermissionMode methods to adapter.

**Steps**:

1. Add `interruptSession()` method (after line 413)
2. Add `setSessionModel()` method
3. Add `setSessionPermissionMode()` method
4. Test: Call each method, verify SDK responds

**Verification**:

- `interruptSession()` stops agent within 500ms ✅
- `setSessionModel()` changes model for next message ✅
- `setSessionPermissionMode()` updates permission mode ✅

---

### Task 5: Update Message Transformer (30 minutes)

**Description**: Ensure transformer preserves `parent_tool_use_id`.

**File**: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

**Steps**:

1. Review transformer (already extracts `parent_tool_use_id`)
2. No changes needed - transformer already correct!
3. Verify: parent_tool_use_id flows through to ExecutionNode

**Verification**:

- Transformer extracts `parent_tool_use_id` from SDK messages ✅
- No code changes required (already correct) ✅

---

## Risk Mitigation

### Risk 1: AsyncIterable Complexity

**Probability**: High
**Impact**: Medium
**Mitigation**:

- Reference SDK examples (claude-agent-sdk.md has AsyncIterable usage patterns)
- Use simple generator pattern (no complex queue logic)
- Test with 3-message conversation before multi-turn stress test

### Risk 2: Iterator Hang/Deadlock

**Probability**: Medium
**Impact**: High
**Mitigation**:

- Implement cleanup in `finally` block of generator
- Use `abortController.signal.aborted` check in iterator loop
- Add timeout to `resolveNext` promise (fallback to null message)

### Risk 3: Breaking Existing Sessions

**Probability**: High
**Impact**: Low
**Mitigation**:

- Acceptable for beta - existing sessions created with string mode cannot resume
- Document in changelog: "Multi-turn conversation now works - old sessions incompatible"

### Risk 4: SDK Behavior Differs from Docs

**Probability**: Low
**Impact**: Medium
**Mitigation**:

- Test against real SDK (not mocks)
- Check SDK GitHub issues for AsyncIterable edge cases
- Contact Anthropic support if unexpected behavior

---

## Testing Strategy

### Unit Tests (Out of Scope)

Testing is handled by senior-tester after implementation.

### Manual Testing Checklist

**Multi-Turn Conversation**:

1. Start session, send "What is 2+2?"
2. Send follow-up: "What about 3+3?"
3. Verify both messages processed by SDK
4. Check UI shows 2 user messages + 2 assistant responses

**Role Assignment**:

1. Send user message
2. Verify `role='user'` in storage
3. Receive assistant message
4. Verify `role='assistant'` in storage

**Parent Linking**:

1. Send message that triggers tool use
2. Verify tool_use node has `parent_tool_use_id`
3. Verify UI tree shows correct parent-child relationship

**SDK Controls**:

1. Start long-running task
2. Click interrupt button → verify agent stops
3. Change model dropdown → verify next message uses new model
4. Toggle autopilot → verify permission mode changes

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- Pure TypeScript backend work (NestJS patterns, dependency injection)
- No UI changes required (ExecutionNode format preserved)
- SDK integration knowledge required
- Async/generator patterns (backend expertise)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Task 1 (Role fix): 5 minutes
- Task 2 (Streaming input): 2-3 hours
- Task 3 (Parent linking): 1 hour
- Task 4 (SDK controls): 1 hour
- Task 5 (Transformer review): 30 minutes
- Testing: 1 hour

### Files Affected Summary

**MODIFY**:

- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (primary file - all 4 fixes)

**READ-ONLY** (verification):

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` (confirm parent_tool_use_id extracted)
- `task-tracking/TASK_2025_044/claude-agent-sdk.md` (SDK reference)

### Critical Verification Points

**Before Implementation, Backend Developer Must Verify**:

1. **SDK imports work**:

   - `import type { SDKUserMessage, Query } from '@anthropic-ai/claude-agent-sdk' with { 'resolution-mode': 'import' };`
   - Verified: claude-agent-sdk.md (ESM module in CommonJS context)

2. **AsyncIterable pattern matches SDK**:

   - Reference: claude-agent-sdk.md:20-21
   - Pattern: `async *[Symbol.asyncIterator]() { yield message; }`

3. **SDK Query methods exist**:

   - `query.interrupt()` - claude-agent-sdk.md:118
   - `query.setModel()` - claude-agent-sdk.md:120
   - `query.setPermissionMode()` - claude-agent-sdk.md:119

4. **No hallucinated APIs**:
   - All SDK types verified in claude-agent-sdk.md
   - All methods verified as exports

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase/SDK docs
- [x] All imports/methods verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (team-leader's job to create tasks.md)

---

## Quality Gates

**Before marking task complete, verify**:

- [ ] User can send 3+ messages in single conversation without errors
- [ ] Role assignment correct (user='user', assistant='assistant')
- [ ] Parent-child relationships use SDK's `parent_tool_use_id`
- [ ] `interruptSession()` stops agent within 500ms
- [ ] `setSessionModel()` changes model for next message
- [ ] `setSessionPermissionMode()` updates permission mode
- [ ] No memory leaks (generator cleanup verified)
- [ ] No regressions in single-turn conversation

---

## References

- **SDK TypeScript Reference**: `D:\projects\ptah-extension\task-tracking\TASK_2025_044\claude-agent-sdk.md` (lines 20-21, 117-121, 399-421)
- **Requirements Document**: `D:\projects\ptah-extension\task-tracking\TASK_2025_049\task-description.md`
- **Current Implementation**: `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` (lines 224-254, 267-297, 347-398)

---

## Implementation Notes

### Why Minimal Approach?

We're NOT rewriting the entire SDK integration. We're fixing 5 specific bugs:

1. String prompt → AsyncIterable (multi-turn fix)
2. Role assignment logic error (1-line fix)
3. Custom parent tracking → SDK's native field (delete custom code)
4. Expose 3 SDK methods (add 30 lines)
5. Transformer verification (no changes needed)

**Total LOC**: ~100 lines added, ~30 lines deleted, 1 line changed.

### What We're NOT Changing

- ExecutionNode format (UI compatibility preserved)
- SdkMessageTransformer logic (already correct)
- SdkPermissionHandler (unchanged)
- SdkSessionStorage (simplified in Phase 2)
- IAIProvider interface (methods added, not changed)

### Phase 2 Future Work (Out of Scope)

- Simplify SdkSessionStorage (remove message storage, use SDK's resume)
- Add UI controls for interrupt/setModel/setPermissionMode
- Investigate SDK's native session management (reduce custom storage)
- Performance optimization (stream partial messages to UI)

This is a **targeted bug fix**, not an architectural rewrite. Focus on getting multi-turn conversation working with minimal changes.
