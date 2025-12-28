# TASK_2025_027: Edge Case Analysis

## Overview

Analysis of edge cases for session lifecycle implementation and their handling in the current codebase.

---

## Edge Case 1: Session ID Never Received

### Scenario

Claude CLI process spawns successfully but never emits a `session_id` in the JSONL stream.

### Current Behavior

- **Backend**: `ClaudeProcess.parseLine()` only emits `session-id` event when `parsed.type === 'system' && parsed.session_id`
- **Frontend**: Session stays in `draft` state indefinitely
- **Impact**: User can see streaming response but cannot continue conversation

### Risk Assessment

**Low** - Claude CLI always emits session_id in first system message based on CLI documentation

### Mitigation Strategy

**Status**: ✅ ADEQUATE - Implicit timeout via process lifecycle

**Reasoning**:

1. If Claude CLI process errors/closes without session_id, the `close` event fires
2. Backend sends `chat:error` or `chat:complete` to frontend
3. Frontend's error handlers set `_isStreaming.set(false)` and clear draft state
4. User can restart conversation

**Potential Enhancement** (not required for this task):

- Add explicit timeout (30s) in SessionManager to auto-clear draft state
- Show warning message: "Session initialization timed out. Please try again."

---

## Edge Case 2: User Sends Message Before Session ID Resolved

### Scenario

User types and sends a second message while first message is still streaming and session ID hasn't been resolved yet.

### Current Behavior

1. User sends message while status is `draft`
2. `continueConversation()` called
3. Checks `sessionManager.claudeSessionId()` → returns `null`
4. Falls back to `startNewConversation()` (line 335 in chat.store.ts)

```typescript
const sessionId = this.sessionManager.claudeSessionId();
if (!sessionId) {
  console.error('[ChatStore] No Claude session ID - cannot continue');
  return this.startNewConversation(content, files);
}
```

### Risk Assessment

**Medium** - Could create orphaned sessions if user spams send button

### Mitigation Strategy

**Status**: ✅ ADEQUATE - Fallback to new conversation prevents errors

**Current Protection**:

- UI should disable send button while `_isStreaming() === true`
- If user bypasses UI, fallback creates new session (acceptable)

**UI Enhancement** (recommended but not blocking):

- Disable message input while `sessionManager.status() === 'draft'`
- Show loading indicator: "Initializing session..."

---

## Edge Case 3: Session ID Resolved After Process Ends

### Scenario

Process closes/errors before `session:id-resolved` message reaches frontend.

### Current Behavior

1. Backend: `ClaudeProcess` emits `session-id` event
2. Backend: `rpc-method-registration.service.ts` sends `session:id-resolved` message
3. Backend: Process closes immediately after
4. Frontend: Receives `session:id-resolved` message
5. Frontend: `handleSessionIdResolved()` executes successfully
6. Frontend: `chat:complete` or `chat:error` received afterward
7. Frontend: Session finalized correctly

### Risk Assessment

**Very Low** - Message ordering preserved by event loop

### Mitigation Strategy

**Status**: ✅ ADEQUATE - Event ordering guaranteed by JavaScript event loop

**Why This Works**:

1. Backend emits `session-id` event BEFORE `close` event (line 272 in claude-process.ts)
2. Backend sends `session:id-resolved` message synchronously in event handler
3. VS Code webview message queue preserves order
4. Frontend processes messages in order received

---

## Edge Case 4: Multiple Rapid Session Creations

### Scenario

User starts multiple conversations rapidly (e.g., clicking "New Chat" multiple times).

### Current Behavior

1. Each click calls `startNewConversation()`
2. Each call:
   - Clears `_messages`
   - Sets status to `draft`
   - Sends `chat:start` RPC call
3. Multiple backend processes spawn
4. Multiple `session:id-resolved` messages arrive
5. Last one wins (sets `_currentSessionId`)

### Risk Assessment

**Low** - Last session wins, others orphaned but harmless

### Mitigation Strategy

**Status**: ⚠️ ACCEPTABLE - No data loss, orphaned sessions auto-expire

**Current Protection**:

- UI should debounce "New Chat" button
- Orphaned backend processes will auto-cleanup when frontend disconnects

**Enhancement** (not required):

- Track pending session creation with atomic flag
- Reject new session requests while one is pending

---

## Edge Case 5: Session ID Resolved for Wrong Session

### Scenario

User switches sessions while session ID is being resolved.

### Current Behavior

1. User starts session A (status: `draft`)
2. User switches to existing session B
3. Session A's `session:id-resolved` arrives
4. `handleSessionIdResolved()` called
5. Updates `_currentSessionId` to session A's ID (incorrect!)
6. User is now viewing session B with session A's ID

### Risk Assessment

**Medium** - Could cause session confusion

### Mitigation Strategy

**Status**: ⚠️ NEEDS VALIDATION - Verify current session before applying ID

**Current Code**:

```typescript
handleSessionIdResolved(sessionId: string): void {
  console.log('[ChatStore] Session ID resolved:', sessionId);

  // ⚠️ No validation if this ID belongs to current session
  this.sessionManager.setClaudeSessionId(sessionId);
  this._currentSessionId.set(sessionId);
  // ...
}
```

**Recommended Fix**:

```typescript
handleSessionIdResolved(payload: { sessionId: string; correlationId?: string }): void {
  const { sessionId } = payload;

  // Only apply if still in draft state (haven't switched sessions)
  if (this.sessionManager.status() !== 'draft') {
    console.warn('[ChatStore] Ignoring session ID for switched session:', sessionId);
    return;
  }

  console.log('[ChatStore] Session ID resolved:', sessionId);
  this.sessionManager.setClaudeSessionId(sessionId);
  this._currentSessionId.set(sessionId);
  // ...
}
```

**Priority**: Medium - Add this validation to prevent race condition

---

## Edge Case 6: Backend Process Crashes During Session Start

### Scenario

Node.js backend crashes or extension deactivates while session is starting.

### Current Behavior

1. Frontend in `draft` state
2. Backend process killed
3. Frontend never receives `session:id-resolved` or `chat:error`
4. Frontend stuck in streaming state

### Risk Assessment

**Low** - Extension restart clears state

### Mitigation Strategy

**Status**: ✅ ADEQUATE - State cleared on extension reload

**Current Protection**:

- VS Code extension deactivation clears all state
- Frontend reinitializes on webview reload
- User can close/reopen chat panel to reset

**Enhancement** (optional):

- Add connection health check in VSCodeService
- Auto-reset to `fresh` state if backend disconnected

---

## Edge Case 7: Invalid Session ID Format From Claude

### Scenario

Claude CLI emits session_id in unexpected format (not UUID).

### Current Behavior

1. Backend extracts whatever value is in `parsed.session_id`
2. Sends to frontend
3. Frontend stores it
4. User sends second message
5. Backend calls `chat:continue` with invalid UUID
6. UUID validation fails (line 232 in implementation plan)

### Risk Assessment

**Very Low** - Claude CLI consistently uses UUIDs

### Mitigation Strategy

**Status**: ✅ ADEQUATE - Backend validates UUID format

**Current Validation** (in rpc-method-registration.service.ts):

```typescript
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!uuidPattern.test(sessionId)) {
  throw new Error(`Invalid session ID format: ${sessionId}. Expected UUID.`);
}
```

**This catches**:

- Malformed UUIDs
- Frontend-generated IDs that slip through
- Corrupted session IDs

---

## Summary

### Critical Issues (Blocking)

**None** - All critical paths have adequate error handling

### Medium Priority Enhancements

1. **Edge Case 5**: Validate session status before applying resolved ID
   - **Fix**: Add `status === 'draft'` check in `handleSessionIdResolved()`
   - **Impact**: Prevents race condition when switching sessions rapidly
   - **Priority**: Should fix before release

### Low Priority Enhancements

1. **Edge Case 2**: Disable input during draft state

   - **Fix**: UI-level protection (disable send button)
   - **Impact**: Better UX, prevents accidental new sessions

2. **Edge Case 4**: Debounce "New Chat" button
   - **Fix**: UI-level debouncing
   - **Impact**: Prevents orphaned sessions

### Acceptable As-Is

- **Edge Case 1**: Process lifecycle handles missing session ID
- **Edge Case 3**: Event ordering guaranteed
- **Edge Case 6**: Extension restart clears state
- **Edge Case 7**: UUID validation in place

---

## Recommended Actions

### For This Task (TASK_2025_027)

1. ✅ **Add validation in `handleSessionIdResolved()`** (Edge Case 5)
   - Quick fix: 3-line check
   - High value: Prevents session confusion

### For Future Tasks

2. UI improvements (debouncing, loading states)
3. Connection health monitoring
4. Explicit timeout handling

---

## Code Quality Observations

### Strengths

✅ Comprehensive error handling in critical paths
✅ UUID validation at backend
✅ Fallback to new session when continuation fails
✅ Event ordering preserved by architecture

### Areas for Improvement

⚠️ Missing validation: Apply session ID only when appropriate
⚠️ No explicit timeout for draft state (relies on process lifecycle)
⚠️ No correlation ID tracking (makes debugging harder)

---

## Testing Recommendations

### Critical Test Cases

1. Normal flow: Start → Resolve → Continue
2. Session switch during resolution
3. Multiple rapid "New Chat" clicks
4. Backend disconnect during draft state

### Edge Case Tests

1. Process close before session_id emitted
2. Session ID resolution after 30+ seconds
3. Malformed session_id in JSONL
4. User sends message while status=draft
