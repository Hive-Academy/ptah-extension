# Implementation Plan - TASK_2025_093: Remove temp_id Pattern and Use Real SDK UUIDs

## Executive Summary

This refactoring task eliminates the vestigial `temp_id` pattern (`temp_${Date.now()}_random`) from chat session initialization. The pattern was a workaround for async SDK initialization but is no longer needed because:

1. **Frontend routes by tabId** - Events are routed to tabs via tabId, not sessionId
2. **Events already use real UUIDs** - StreamTransformer's effectiveSessionId ensures all events have real UUIDs after system init
3. **temp_id is never persisted** - SDK handles message persistence with real UUIDs only
4. **No backward compatibility concerns** - temp_id is purely ephemeral

**Migration Strategy**: Simplify by deletion. Instead of creating temp_id, use `null` placeholder until SDK returns real UUID in system init message. Frontend continues using tabId for routing.

---

## Codebase Investigation Summary

### Libraries Analyzed

- **agent-sdk** (D:\projects\ptah-extension\libs\backend\agent-sdk) - StreamTransformer, SdkAgentAdapter, session lifecycle
- **vscode-core** (D:\projects\ptah-extension\apps\ptah-extension-vscode) - ChatRpcHandlers, RpcMethodRegistrationService
- **frontend/core** (D:\projects\ptah-extension\libs\frontend\core) - VSCodeService message handling
- **frontend/chat** (D:\projects\ptah-extension\libs\frontend\chat) - ChatStore, StreamingHandlerService

### Patterns Identified

**Pattern 1: temp_id Creation and Propagation**

- Created in `chat-rpc.handlers.ts:98-100`
- Passed to `sdkAdapter.startChatSession(tempSessionId, config)`
- Used in `stream-transformer.ts` as initial `effectiveSessionId`
- Updated to real UUID on system init message (line 218)

**Pattern 2: tabId-Based Event Routing (Already Implemented)**

- TASK_2025_092 added tabId to all streaming events
- Frontend routes by tabId first (streaming-handler.service.ts:105-112)
- sessionId lookup is fallback only (line 115-124)

**Pattern 3: session:id-resolved Event**

- Sent when real UUID is extracted from SDK's system init message
- Updates tab's claudeSessionId from placeholder to real UUID
- Currently uses sessionId lookup (old temp_id) - can be simplified to tabId

---

## Phase 1: Simplify Backend (LOW RISK)

### Overview

Remove temp_id creation and initialize effectiveSessionId as null. Wait for system init message to set real UUID before emitting events.

### Component 1: chat-rpc.handlers.ts

**Purpose**: Remove temp_id creation, use null placeholder

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`

**Pattern**: Direct replacement
**Evidence**: Lines 96-130 show temp_id creation and usage

**Changes**:

1. **Remove tempSessionId creation** (lines 96-100)

   ```typescript
   // BEFORE (lines 96-100)
   // Generate a temporary session ID for SDK lifecycle tracking
   // Real UUID will come from SDK system init message
   const tempSessionId = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}` as SessionId;

   // AFTER
   // Session ID will be null until SDK returns real UUID in system init message
   // Events are routed by tabId, not sessionId, so null is safe here
   const placeholderSessionId = null;
   ```

2. **Update startChatSession call** (line 103)

   ```typescript
   // BEFORE
   const stream = await this.sdkAdapter.startChatSession(tempSessionId, {

   // AFTER - Pass null, adapter will handle it
   const stream = await this.sdkAdapter.startChatSession(null, {
   ```

3. **Update sendMessageToSession call** (lines 122-125)

   ```typescript
   // BEFORE
   if (prompt) {
     await this.sdkAdapter.sendMessageToSession(tempSessionId, prompt, {

   // AFTER - Queue message for session, sessionId not needed yet
   // Session lifecycle manager will queue message and SDK will process it
   if (prompt) {
     // Note: Message will be queued and sent when session is fully initialized
     // The stream will emit events with real sessionId after system init
   ```

   **Decision**: Keep sendMessageToSession call but with tabId-based queuing approach (see sdk-agent-adapter changes)

4. **Update streamExecutionNodesToWebview call** (line 130)

   ```typescript
   // BEFORE
   this.streamExecutionNodesToWebview(tempSessionId, stream, tabId);

   // AFTER - tabId is the primary routing key, sessionId comes from events
   this.streamExecutionNodesToWebview(stream, tabId);
   ```

5. **Update streamExecutionNodesToWebview signature** (lines 321-325)

   ```typescript
   // BEFORE
   private async streamExecutionNodesToWebview(
     sessionId: SessionId,
     stream: AsyncIterable<FlatStreamEventUnion>,
     tabId: string
   ): Promise<void> {

   // AFTER - Remove sessionId parameter, events carry their own sessionId
   private async streamExecutionNodesToWebview(
     stream: AsyncIterable<FlatStreamEventUnion>,
     tabId: string
   ): Promise<void> {
   ```

**Quality Requirements**:

- Streaming must continue to work
- Events must have real SDK UUIDs (from event.sessionId)
- tabId routing must remain functional

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts` (MODIFY)

### Component 2: stream-transformer.ts

**Purpose**: Initialize effectiveSessionId as null, skip events until system init provides real UUID

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`

**Pattern**: Null initialization with defensive buffering
**Evidence**: Lines 156, 168, 218 show effectiveSessionId lifecycle

**Changes**:

1. **Update StreamTransformConfig interface** (lines 46-52)

   ```typescript
   // BEFORE
   export interface StreamTransformConfig {
     sdkQuery: AsyncIterable<SDKMessage>;
     sessionId: SessionId;
     initialModel: string;
     onSessionIdResolved?: SessionIdResolvedCallback;
     onResultStats?: ResultStatsCallback;
   }

   // AFTER - sessionId is now optional (null for new sessions)
   export interface StreamTransformConfig {
     sdkQuery: AsyncIterable<SDKMessage>;
     sessionId?: SessionId | null; // Optional - null for new sessions, real UUID for resumed
     initialModel: string;
     onSessionIdResolved?: SessionIdResolvedCallback;
     onResultStats?: ResultStatsCallback;
   }
   ```

2. **Update effectiveSessionId initialization** (line 168)

   ```typescript
   // BEFORE
   let effectiveSessionId = sessionId;

   // AFTER - Start with null, set from system init
   let effectiveSessionId: SessionId | null = sessionId ?? null;
   ```

3. **Add defensive check before emitting events** (around lines 287-290)

   ```typescript
   // BEFORE
   const flatEvents = messageTransformer.transform(sdkMessage, effectiveSessionId);

   // AFTER - Skip events if we don't have a real session ID yet
   if (!effectiveSessionId) {
     logger.warn('[StreamTransformer] Skipping event - no session ID yet', {
       messageType: sdkMessage.type,
       eventNumber: sdkMessageCount,
     });
     continue;
   }

   const flatEvents = messageTransformer.transform(sdkMessage, effectiveSessionId);
   ```

**Quality Requirements**:

- System init message must always arrive before other processable events
- If events arrive before system init, they should be logged and skipped (defensive)
- After system init, all events use real UUID

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (MODIFY)

### Component 3: sdk-agent-adapter.ts

**Purpose**: Update startChatSession to accept null sessionId

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`

**Pattern**: Optional parameter with null handling
**Evidence**: Lines 591-685 show startChatSession implementation

**Changes**:

1. **Update startChatSession signature** (lines 591-594)

   ```typescript
   // BEFORE
   async startChatSession(
     sessionId: SessionId,
     config?: AISessionConfig & { name?: string }
   ): Promise<AsyncIterable<FlatStreamEventUnion>> {

   // AFTER - sessionId is optional (null for new sessions)
   async startChatSession(
     sessionId: SessionId | null,
     config?: AISessionConfig & { name?: string }
   ): Promise<AsyncIterable<FlatStreamEventUnion>> {
   ```

2. **Update preRegisterActiveSession call** (lines 610-614)

   ```typescript
   // BEFORE
   this.sessionLifecycle.preRegisterActiveSession(sessionId, config || {}, abortController);

   // AFTER - Use placeholder ID for lifecycle tracking, will be updated on session ID resolution
   // Generate a unique placeholder for internal tracking only
   const trackingId = (sessionId ?? `pending_${Date.now()}`) as SessionId;
   this.sessionLifecycle.preRegisterActiveSession(trackingId, config || {}, abortController);
   ```

3. **Update streamTransformer.transform call** (lines 678-684)

   ```typescript
   // BEFORE
   return this.streamTransformer.transform({
     sdkQuery: sdkQuery as unknown as AsyncIterable<SDKMessage>,
     sessionId,
     initialModel,
     onSessionIdResolved: sessionIdCallback,
     onResultStats: this.resultStatsCallback || undefined,
   });

   // AFTER - Pass null sessionId, will be set from system init
   return this.streamTransformer.transform({
     sdkQuery: sdkQuery as unknown as AsyncIterable<SDKMessage>,
     sessionId: null, // Will be set from system init message
     initialModel,
     onSessionIdResolved: sessionIdCallback,
     onResultStats: this.resultStatsCallback || undefined,
   });
   ```

**Quality Requirements**:

- Session lifecycle tracking must still work with pending placeholder
- SDK query must start successfully without a real sessionId
- Real sessionId must be extracted and propagated via onSessionIdResolved

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts` (MODIFY)

### Component 4: rpc-method-registration.service.ts

**Purpose**: Add tabId to session:id-resolved event payload for direct routing

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`

**Pattern**: Payload enhancement
**Evidence**: Lines 132-149 show setupSessionIdResolvedCallback

**Changes**:

1. **Update session:id-resolved payload** (lines 138-143)

   ```typescript
   // BEFORE
   this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.SESSION_ID_RESOLVED, {
     sessionId: realSessionId as SessionId,
     realSessionId: realSessionId,
   });

   // AFTER - Add tabId for direct routing (requires callback modification)
   // Note: tabId must be passed through the callback chain
   // For now, frontend can use active tab fallback (already implemented)
   this.webviewManager.sendMessage('ptah.main', MESSAGE_TYPES.SESSION_ID_RESOLVED, {
     realSessionId: realSessionId,
     // tabId will be added in Phase 2 when callback is enhanced
   });
   ```

**Note**: Full tabId routing through callback chain is Phase 2 work. Current fallback to active tab is sufficient.

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts` (MODIFY)

---

## Phase 2: Simplify Frontend (LOW RISK)

### Overview

Update frontend to use tabId-based routing for session:id-resolved events. Simplify handleSessionIdResolved to not look up by old sessionId.

### Component 5: chat.store.ts - handleSessionIdResolved

**Purpose**: Simplify session ID resolution to use tabId or active tab fallback

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`

**Pattern**: Simplification by removal
**Evidence**: Lines 676-720 show complex placeholder lookup

**Changes**:

1. **Simplify handleSessionIdResolved method** (lines 676-720)

   ```typescript
   // BEFORE - Complex placeholder lookup
   handleSessionIdResolved(data: {
     sessionId: string;
     realSessionId: string;
   }): void {
     const { sessionId, realSessionId } = data;
     console.log('[ChatStore] Session ID resolved:', { sessionId, realSessionId });

     // Find the tab with the placeholder session ID
     const targetTab = this.tabManager.findTabBySessionId(sessionId);

     if (targetTab) {
       // Update the tab with the real session ID
       this.tabManager.updateTab(targetTab.id, { claudeSessionId: realSessionId });
       // ...
     } else {
       // Fallback: Check active tab
       // ...
     }
   }

   // AFTER - Direct update via tabId or active tab
   handleSessionIdResolved(data: {
     tabId?: string;      // Optional: Direct routing
     realSessionId: string;
   }): void {
     const { tabId, realSessionId } = data;
     console.log('[ChatStore] Session ID resolved:', { tabId, realSessionId });

     // Primary: Use tabId for direct routing
     if (tabId) {
       const targetTab = this.tabManager.tabs().find((t) => t.id === tabId);
       if (targetTab) {
         this.tabManager.updateTab(tabId, { claudeSessionId: realSessionId });
         console.log('[ChatStore] Tab updated with real session ID:', {
           tabId,
           newId: realSessionId,
         });
         return;
       }
     }

     // Fallback: Use active tab (for new conversations)
     const activeTab = this.tabManager.activeTab();
     if (activeTab && (activeTab.status === 'streaming' || activeTab.status === 'draft')) {
       this.tabManager.updateTab(activeTab.id, { claudeSessionId: realSessionId });
       console.log('[ChatStore] Active tab updated with real session ID:', {
         tabId: activeTab.id,
         newId: realSessionId,
       });
     } else {
       console.warn('[ChatStore] No tab found for session ID resolution:', { realSessionId });
     }
   }
   ```

**Quality Requirements**:

- Active tab fallback must work for new conversations
- No errors if session:id-resolved arrives before tab is ready
- Real UUID must be set on correct tab

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts` (MODIFY)

### Component 6: vscode.service.ts - Session ID resolved handler

**Purpose**: Update to pass simplified data structure

**File**: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`

**Pattern**: Payload simplification
**Evidence**: Lines 321-343 show session:id-resolved handling

**Changes**:

1. **Update session:id-resolved handler** (lines 321-343)

   ```typescript
   // BEFORE
   if (message.type === MESSAGE_TYPES.SESSION_ID_RESOLVED) {
     const { sessionId, realSessionId } = message.payload ?? {};
     console.log('[VSCodeService] Session ID resolved:', { sessionId, realSessionId });

     if (realSessionId && this.chatStore) {
       this.chatStore.handleSessionIdResolved({
         sessionId: sessionId as string,
         realSessionId: realSessionId as string,
       });
     }
     // ...
   }

   // AFTER - Pass tabId if available, realSessionId always
   if (message.type === MESSAGE_TYPES.SESSION_ID_RESOLVED) {
     const { tabId, realSessionId } = message.payload ?? {};
     console.log('[VSCodeService] Session ID resolved:', { tabId, realSessionId });

     if (realSessionId && this.chatStore) {
       this.chatStore.handleSessionIdResolved({
         tabId: tabId as string | undefined,
         realSessionId: realSessionId as string,
       });
     } else if (!realSessionId) {
       console.warn('[VSCodeService] session:id-resolved received but realSessionId is undefined!');
     } else {
       console.warn('[VSCodeService] session:id-resolved received but ChatStore not registered!');
     }
   }
   ```

**Quality Requirements**:

- Must handle missing tabId gracefully (fallback to active tab in ChatStore)
- realSessionId is required - log warning if missing

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts` (MODIFY)

### Component 7: streaming-handler.service.ts - Cleanup

**Purpose**: Remove comments referencing temp_id, simplify sessionId handling comments

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`

**Pattern**: Documentation cleanup
**Evidence**: Lines 157-202 have comments about temp ID handling

**Changes**:

1. **Update comments about session ID initialization** (lines 156-165)

   ```typescript
   // BEFORE (comments)
   // TASK_2025_092: Use the real SDK sessionId if provided, otherwise fall back to event.sessionId
   const realSessionId = sessionId || event.sessionId;

   // AFTER (updated comments)
   // Session ID from event is always the real SDK UUID (after TASK_2025_093)
   // tabId is used for routing, sessionId for storage/resume
   const realSessionId = sessionId || event.sessionId;
   ```

2. **Remove temp_id related comments throughout file**

**Quality Requirements**:

- No functional changes, comments only
- Existing behavior must remain identical

**Files Affected**:

- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts` (MODIFY)

---

## Phase 3: Remove Dead Code and Documentation Cleanup

### Overview

Remove all references to temp_id pattern from comments and update documentation.

### Component 8: chat-rpc.handlers.ts - Comment cleanup

**Purpose**: Remove temp_id comments

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`

**Changes**:

- Remove comment "// Generate a temporary session ID for SDK lifecycle tracking"
- Remove comment "// Real UUID will come from SDK system init message"
- Update method documentation to reflect new flow

**Files Affected**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts` (MODIFY)

### Component 9: stream-transformer.ts - Comment cleanup

**Purpose**: Remove temp_id comments, update effectiveSessionId documentation

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`

**Changes**:

- Update comment at line 166-168 to reflect new null initialization approach
- Remove "temp ID from config" references
- Update SessionIdResolvedCallback JSDoc

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts` (MODIFY)

### Component 10: agent-sdk CLAUDE.md - Documentation update

**Purpose**: Update library documentation to reflect new session ID flow

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`

**Changes**:

- Update session lifecycle documentation
- Remove any temp_id references
- Document new null-to-real-UUID flow

**Files Affected**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md` (MODIFY)

---

## Risk Mitigation Strategies

### Risk 1: Events Lost Before System Init

**Risk Level**: LOW

**Description**: If events are emitted before system init message, they would be skipped.

**Mitigation**:

1. SDK sends system init as first message (verified behavior)
2. Add defensive logging for any events before init
3. If this occurs, events are logged with warning - no silent failures
4. System init is part of SDK protocol - must arrive before content events

**Verification**:

- Test new conversation flow
- Verify first event is always system init
- Check logs for any "Skipping event - no session ID yet" warnings

### Risk 2: Frontend Tab Not Ready

**Risk Level**: LOW

**Description**: session:id-resolved might arrive before tab is created.

**Current Handling**: Already implemented - fallback to active tab (chat.store.ts:701-712)

**Mitigation**:

- Keep active tab fallback
- Log warning if no tab found
- Frontend state is already resilient to out-of-order events

### Risk 3: sendMessageToSession Without Session ID

**Risk Level**: MEDIUM

**Description**: sendMessageToSession uses sessionId to queue messages. With null sessionId, queuing might fail.

**Mitigation**:

1. Use internal tracking ID (pending\_${timestamp}) for session lifecycle
2. Message queue is per-session in sessionLifecycle, keyed by tracking ID
3. When real UUID arrives, session can be re-keyed
4. Alternative: Queue message with prompt, send after session init

**Decision**: Use pending\_${timestamp} for internal tracking, SDK doesn't care about our tracking ID.

### Risk 4: Multi-Tab Race Conditions

**Risk Level**: LOW

**Description**: Multiple tabs starting simultaneously could confuse session routing.

**Current Handling**: tabId-based routing eliminates this (TASK_2025_092)

**Mitigation**:

- Every event includes tabId for routing
- sessionId is for storage, not routing
- Each tab tracks its own streaming state

---

## Testing Approach

### Unit Tests

1. **StreamTransformer Tests**

   - Test effectiveSessionId starts as null
   - Test events are skipped before system init
   - Test effectiveSessionId is set from system init
   - Test subsequent events use real UUID

2. **ChatRpcHandlers Tests**

   - Test startChatSession with null sessionId
   - Test streamExecutionNodesToWebview without sessionId parameter
   - Test events still flow correctly to webview

3. **ChatStore Tests**
   - Test handleSessionIdResolved with tabId
   - Test handleSessionIdResolved with active tab fallback
   - Test no errors when tab not found

### Integration Tests

1. **New Conversation Flow**

   - Start new conversation
   - Verify first event is system init
   - Verify tab gets real UUID
   - Verify streaming completes successfully
   - Verify cost/tokens display correctly

2. **Multi-Tab Flow**

   - Start conversation in Tab A
   - Start conversation in Tab B
   - Verify each tab gets correct events
   - Verify each tab has unique real UUID

3. **Session Resume Flow**
   - Load existing session
   - Verify sessionId is preserved (real UUID from storage)
   - Verify conversation continues correctly

### Manual Testing Checklist

- [ ] Start new conversation - verify events flow correctly
- [ ] Check logs - no "temp\_" strings should appear
- [ ] Verify tab's claudeSessionId is real UUID format (not temp_xxx)
- [ ] Multi-tab: start 2 conversations, verify isolation
- [ ] Resume session: click sidebar session, verify it loads
- [ ] Cost/tokens: verify stats display after completion
- [ ] Abort: interrupt streaming, verify no errors

---

## Dependencies Between Phases

```
Phase 1: Backend Simplification
├── Component 1: chat-rpc.handlers.ts (temp_id removal)
├── Component 2: stream-transformer.ts (null initialization)
├── Component 3: sdk-agent-adapter.ts (null parameter)
└── Component 4: rpc-method-registration.service.ts (payload)

Phase 2: Frontend Simplification (depends on Phase 1)
├── Component 5: chat.store.ts (handleSessionIdResolved)
├── Component 6: vscode.service.ts (payload handling)
└── Component 7: streaming-handler.service.ts (comments)

Phase 3: Cleanup (depends on Phase 1 & 2)
├── Component 8: chat-rpc.handlers.ts (comments)
├── Component 9: stream-transformer.ts (comments)
└── Component 10: CLAUDE.md (documentation)
```

**Order Matters**:

1. Phase 1 must complete first (backend changes)
2. Phase 2 depends on Phase 1 (frontend must handle new payloads)
3. Phase 3 is independent (can run in parallel with testing)

---

## Files Affected Summary

### CREATE

- None

### MODIFY

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\stream-transformer.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-agent-adapter.ts`
- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
- `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\vscode.service.ts`
- `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\CLAUDE.md`

### REWRITE

- None

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer (Phase 1), then frontend-developer (Phase 2)

**Rationale**:

- Phase 1 is primarily backend TypeScript changes in NestJS-style services
- Phase 2 is frontend Angular signal-based service changes
- Phase 3 is documentation and can be done by either

**Alternative**: Single full-stack developer can handle all phases (changes are interconnected)

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Phase 1: 2-3 hours (backend modifications)
- Phase 2: 1-2 hours (frontend simplification)
- Phase 3: 30 minutes (cleanup)
- Testing: 1 hour (integration verification)

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

1. **All imports exist in codebase**:

   - SessionId from `@ptah-extension/shared`
   - FlatStreamEventUnion from `@ptah-extension/shared`
   - Logger, TOKENS from `@ptah-extension/vscode-core`

2. **All patterns verified from examples**:

   - Stream transformation pattern in stream-transformer.ts
   - Event routing pattern in streaming-handler.service.ts
   - Tab management pattern in tab-manager.service.ts

3. **Library documentation consulted**:

   - `libs/backend/agent-sdk/CLAUDE.md`
   - `libs/frontend/chat/CLAUDE.md`
   - `libs/frontend/core/CLAUDE.md`

4. **No hallucinated APIs**:
   - All method signatures verified from source files
   - All interface changes verified as possible
   - All event payloads verified against MESSAGE_TYPES

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)

---

## Success Criteria

1. **No `temp_${timestamp}` pattern anywhere in codebase** (except task-tracking docs)
2. **All streaming events use real SDK UUIDs**
3. **Live streaming continues to work**
4. **Session history loading continues to work**
5. **No breaking changes to frontend**
6. **Multi-tab conversations work correctly**
7. **Cost/token stats display correctly**
8. **No errors in console logs related to session IDs**
