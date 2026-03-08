# Research Report: TASK_2025_093 - Remove temp_id Pattern

## Executive Intelligence Brief

**Research Classification**: ARCHITECTURAL_ANALYSIS
**Confidence Level**: 95% (based on comprehensive codebase analysis)
**Key Insight**: The temp_id pattern is a vestigial workaround from async SDK initialization. Frontend already routes by tabId, making temp_id elimination straightforward with minimal risk.

---

## 1. Files Containing temp_id Pattern

### Primary Source Files (Active Code)

| File                                                                             | Line(s)      | Purpose                                                       | Impact Level |
| -------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------- | ------------ |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`      | 98-100       | **Creates temp_id**: `temp_${Date.now()}_${random}`           | CRITICAL     |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`                   | 168, 218     | **effectiveSessionId tracking**: Updates temp_id to real UUID | HIGH         |
| `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`                            | 682, 722     | Passes `onSessionIdResolved` callback to transformer          | HIGH         |
| `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts` | 132-150      | **Sends session:id-resolved event** to webview                | HIGH         |
| `libs/frontend/core/src/lib/services/vscode.service.ts`                          | 318-343      | **Receives session:id-resolved event**                        | MEDIUM       |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                              | 676-720      | **handleSessionIdResolved()**: Updates tab's claudeSessionId  | MEDIUM       |
| `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`    | 157, 193-202 | Fallback: Sets claudeSessionId from event if not set          | LOW          |

### Type Definitions

| File                                         | Line | Pattern                                      |
| -------------------------------------------- | ---- | -------------------------------------------- |
| `libs/shared/src/lib/types/message.types.ts` | 305  | `SESSION_ID_RESOLVED: 'session:id-resolved'` |

---

## 2. Current Flow Diagram: temp_id Creation to Real UUID Resolution

```
BACKEND (chat-rpc.handlers.ts)
================================
1. registerChatStart() receives prompt + tabId
   |
   v
2. Creates tempSessionId: `temp_${Date.now()}_${random}`
   |                                                   LINE 98
   v
3. Calls sdkAdapter.startChatSession(tempSessionId, config)
   |
   v
4. SDK query() starts - returns AsyncIterable<SDKMessage>

BACKEND (stream-transformer.ts)
================================
5. effectiveSessionId = sessionId (temp_id initially)    LINE 168
   |
   v
6. For each SDK message:
   |
   +---> If isSystemInit(sdkMessage):
   |       Extract realSessionId from sdkMessage.session_id
   |       effectiveSessionId = realSessionId            LINE 218
   |       Call onSessionIdResolved(realSessionId)       LINE 222
   |
   +---> All subsequent events use effectiveSessionId   LINE 289
         (real UUID after init, not temp_id)

BACKEND (rpc-method-registration.service.ts)
================================
7. onSessionIdResolved callback fires
   |
   v
8. Sends MESSAGE_TYPES.SESSION_ID_RESOLVED to webview   LINE 139
   Payload: { sessionId: realSessionId, realSessionId }

FRONTEND (vscode.service.ts)
================================
9. Receives session:id-resolved message                 LINE 321
   |
   v
10. Calls chatStore.handleSessionIdResolved()          LINE 330

FRONTEND (chat.store.ts)
================================
11. handleSessionIdResolved(data):                      LINE 676
    - Find tab by sessionId (old temp_id)
    - Update tab.claudeSessionId = realSessionId
    |
    v
12. Tab now has real SDK UUID for future resume
```

### Key Observations

1. **temp_id is NEVER sent to SDK** - SDK internally generates the real UUID
2. **temp_id is only used for internal tracking** between chat-rpc.handlers and stream-transformer
3. **Frontend never sees temp_id** - By line 289, events already have effectiveSessionId (real UUID)
4. **tabId is the primary routing key** - Frontend routes events by tabId, not sessionId (see chat-rpc.handlers.ts line 355)

---

## 3. Impact Analysis

### 3.1 Live Streaming

**Question**: Will removing temp_id break streaming?

**Answer**: NO - Streaming will NOT break.

**Evidence**:

- `streamExecutionNodesToWebview()` (chat-rpc.handlers.ts:321-441) already uses `tabId` for routing
- Events sent to webview include `tabId` for routing (line 355) AND `event.sessionId` (real UUID from transformer)
- StreamingHandlerService.processStreamEvent() routes by tabId first (line 105-112), falls back to sessionId lookup

**Current Code** (chat-rpc.handlers.ts:351-358):

```typescript
const sendResult = await this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.CHAT_CHUNK, {
  tabId, // For frontend tab routing
  sessionId: event.sessionId, // Real SDK UUID from the event
  event,
});
```

**Conclusion**: Frontend routing is already tabId-based. The event.sessionId from stream-transformer is already the real UUID (effectiveSessionId after line 218).

### 3.2 Session History Loading

**Question**: Does session history ever see temp_id?

**Answer**: NO - Session history NEVER contains temp_id.

**Evidence**:

- Session history is read via `sessionHistoryReader.readSessionHistory()` (chat-rpc.handlers.ts:245)
- This reads from SDK's native storage at `~/.claude/projects/{sessionId}.jsonl`
- SDK stores messages under the real UUID it generates internally
- temp_id is never persisted anywhere

**Conclusion**: Session resume always uses real SDK UUIDs. temp_id is purely ephemeral.

### 3.3 Frontend Routing

**Question**: Does frontend need sessionId for routing?

**Answer**: NO - Frontend uses tabId exclusively for routing.

**Evidence** (streaming-handler.service.ts:101-124):

```typescript
// Primary: Use tabId for direct routing
if (tabId) {
  targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
}

// Fallback: Find target tab by event.sessionId
if (!targetTab) {
  targetTab = this.tabManager.findTabBySessionId(event.sessionId) ?? undefined;
}
```

The sessionId lookup is a fallback only. With tabId provided in all events (as of TASK_2025_092), this fallback is rarely used.

### 3.4 Session:id-resolved Event

**Question**: Is the session:id-resolved event still needed?

**Answer**: MAYBE - It serves a purpose but could be simplified.

**Current Purpose**:

1. Updates tab's `claudeSessionId` from placeholder to real UUID
2. Enables future session resume (SDK needs real UUID format)

**Observation**:

- StreamingHandlerService already sets `claudeSessionId` from event.sessionId (line 169-172, 193-202)
- This happens on first streaming event, BEFORE session:id-resolved arrives
- So session:id-resolved might be redundant if streaming events always have real UUID

**Recommendation**: Keep session:id-resolved but simplify:

- Remove the placeholder-based lookup (since no placeholder will exist)
- Use tabId for routing instead of sessionId lookup

---

## 4. Migration Approach

### Strategy: Wait for Real UUID Before Streaming

**Principle**: Don't create temp_id at all. Wait for SDK to provide real UUID in system init message before sending any events to frontend.

### Implementation Steps

#### Step 1: Modify chat-rpc.handlers.ts (registerChatStart)

**Current** (lines 96-103):

```typescript
const tempSessionId = `temp_${Date.now()}_${Math.random()
  .toString(36)
  .substring(2, 9)}` as SessionId;

const stream = await this.sdkAdapter.startChatSession(tempSessionId, {
  ...
});
```

**Proposed**:

```typescript
// Don't pass a sessionId - let SDK generate one
// SDK returns the real UUID in the first system init message
const stream = await this.sdkAdapter.startChatSession(null as unknown as SessionId, {
  ...
});

// OR: Generate a placeholder locally but don't use it for anything
// The stream will contain real UUID from first message
```

#### Step 2: Modify stream-transformer.ts

**Current** (lines 156, 168):

```typescript
const { sdkQuery, sessionId, onSessionIdResolved, onResultStats } = config;
...
let effectiveSessionId = sessionId; // temp_id initially
```

**Proposed**:

```typescript
const { sdkQuery, onSessionIdResolved, onResultStats } = config;
...
let effectiveSessionId: SessionId | null = null; // No ID until SDK provides one

// In system init handling (line 210-223):
if (isSystemInit(sdkMessage)) {
  effectiveSessionId = sdkMessage.session_id as SessionId;
  if (onSessionIdResolved) {
    onSessionIdResolved(sdkMessage.session_id);
  }
}

// For events before system init (shouldn't happen, but defensive):
if (!effectiveSessionId) {
  logger.warn('[StreamTransformer] Event received before session init');
  continue; // Skip until we have real ID
}
```

#### Step 3: Simplify session:id-resolved handling

**Current** (chat.store.ts:676-720): Complex placeholder lookup + fallback

**Proposed**: Simple tabId-based update

```typescript
handleSessionIdResolved(data: {
  tabId: string;        // NEW: Add tabId to payload
  realSessionId: string;
}): void {
  const { tabId, realSessionId } = data;

  // Direct update by tabId - no placeholder lookup needed
  this.tabManager.updateTab(tabId, {
    claudeSessionId: realSessionId,
  });
}
```

#### Step 4: Update rpc-method-registration.service.ts

**Current** (lines 139-142):

```typescript
.sendMessage('ptah.main', MESSAGE_TYPES.SESSION_ID_RESOLVED, {
  sessionId: realSessionId as SessionId,
  realSessionId: realSessionId,
})
```

**Proposed**: Include tabId (requires tracking in adapter)

```typescript
.sendMessage('ptah.main', MESSAGE_TYPES.SESSION_ID_RESOLVED, {
  tabId: currentTabId, // From startChatSession params
  realSessionId: realSessionId,
})
```

---

## 5. Risk Analysis

### Risk 1: Events Lost Before System Init

**Risk Level**: LOW

**Description**: If we don't buffer events before system init message, early events could be lost.

**Mitigation**:

- SDK typically sends system init as first message
- Add defensive buffering in stream-transformer if needed
- Log warnings for any events before init (should never happen in practice)

### Risk 2: Frontend Tab Not Ready

**Risk Level**: LOW

**Description**: session:id-resolved might arrive before tab is created.

**Current Handling**: Already handled - fallback to active tab (chat.store.ts:701-712)

**Mitigation**: Keep active tab fallback. With tabId-based routing, this becomes simpler.

### Risk 3: Backward Compatibility

**Risk Level**: NONE

**Description**: Existing sessions might have temp_id stored.

**Reality**: temp_id is NEVER persisted. Session storage always uses real UUID. No migration needed.

### Risk 4: Multi-Tab Race Conditions

**Risk Level**: LOW

**Description**: Multiple tabs starting simultaneously could confuse session routing.

**Current Handling**: tabId-based routing eliminates this (TASK_2025_092)

**Mitigation**: Ensure every event includes tabId from start.

---

## 6. Recommended Migration Approach

### Phase 1: Simplify Backend (Low Risk)

1. **Modify stream-transformer.ts**:

   - Initialize `effectiveSessionId` as `null`
   - Set it from system init message (first message)
   - Skip/buffer events before init (defensive)

2. **Modify chat-rpc.handlers.ts**:

   - Remove `tempSessionId` creation entirely
   - Pass tabId through to stream transformer
   - Include tabId in session:id-resolved callback

3. **Modify sdk-agent-adapter.ts**:
   - Update startChatSession signature (optional sessionId param)
   - Pass tabId to transformer config

### Phase 2: Simplify Frontend (Low Risk)

1. **Modify session:id-resolved payload**:

   - Add tabId to payload
   - Update MESSAGE_TYPES type if needed

2. **Simplify handleSessionIdResolved**:

   - Remove placeholder lookup logic
   - Update by tabId directly

3. **Clean up StreamingHandlerService**:
   - Remove effectiveSessionId-related fallback logic
   - Trust that events always have real sessionId

### Phase 3: Remove Dead Code (Cleanup)

1. Remove `effectiveSessionId` tracking comments about temp_id
2. Update documentation references to temp_id pattern
3. Remove any remaining placeholder-related code paths

---

## 7. Files to Modify (Summary)

| File                                 | Change Type                               | Complexity |
| ------------------------------------ | ----------------------------------------- | ---------- |
| `chat-rpc.handlers.ts`               | Remove temp_id creation, pass tabId       | LOW        |
| `stream-transformer.ts`              | Change effectiveSessionId initialization  | MEDIUM     |
| `sdk-agent-adapter.ts`               | Optional: signature changes               | LOW        |
| `rpc-method-registration.service.ts` | Add tabId to callback                     | LOW        |
| `vscode.service.ts`                  | Pass tabId to handleSessionIdResolved     | LOW        |
| `chat.store.ts`                      | Simplify handleSessionIdResolved          | LOW        |
| `streaming-handler.service.ts`       | Remove redundant fallback code            | LOW        |
| `message.types.ts`                   | Optional: Update SESSION_ID_RESOLVED type | LOW        |

---

## 8. Conclusion

**GO Recommendation**: PROCEED WITH CONFIDENCE

- **Technical Feasibility**: HIGH - All pieces are already in place
- **Risk Level**: LOW - temp_id is purely ephemeral, never persisted
- **Complexity**: LOW-MEDIUM - Mostly removal/simplification
- **ROI**: HIGH - Cleaner code, simpler mental model, no race conditions

**Key Points**:

1. temp_id is a vestigial pattern from async SDK initialization
2. Frontend already routes by tabId (TASK_2025_092)
3. Events already contain real UUID after system init
4. No backward compatibility concerns (temp_id never persisted)
5. Migration is mostly deletion of code

**Recommended Next Steps**:

1. **Software Architect**: Create implementation plan following Phase 1-3 above
2. **Backend Developer**: Implement Phase 1 changes
3. **Frontend Developer**: Implement Phase 2 changes
4. **Tester**: Verify streaming, resume, multi-tab scenarios

---

**Output**: task-tracking/TASK_2025_093/research-report.md
**Next Agent**: software-architect
**Architect Focus**: Design the migration in 3 phases (backend simplification -> frontend simplification -> cleanup), ensuring tabId-based routing is complete before removing temp_id
