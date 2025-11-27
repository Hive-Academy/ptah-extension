# RPC Migration Completion Plan - TASK_2025_021

**Created**: 2025-01-24
**Status**: INCOMPLETE - Need to restore all commented-out functionality
**Current Phase**: Analysis & Planning

---

## Executive Summary

The RPC migration is **NOT complete** yet. While we have:

- ✅ Core RPC infrastructure (RpcHandler, ClaudeRpcService, ChatStoreService)
- ✅ SessionManager restored
- ✅ Security hardening complete
- ✅ Basic session operations wired

**We are missing**:

- ❌ **Streaming support** - All streaming events commented out with `// TODO: Phase 2 RPC`
- ❌ **Analytics tracking** - 40+ analytics calls commented out
- ❌ **Error reporting** - Error events not propagated to frontend
- ❌ **Provider events** - Provider health/switch events not emitted
- ❌ **Command service integration** - CommandService has 8 commented-out event calls

**Impact**: The extension will compile but **critical runtime functionality is broken**:

- User cannot see streaming responses (content chunks, thinking states)
- No analytics data collection
- No error notifications to frontend
- Provider switching UI won't update
- Command execution feedback missing

---

## Current State Analysis

### Phase 0 Purge Damage Assessment

Phase 0 deleted the **entire EventBus system** but the RPC replacement is incomplete:

| Category             | Event-Based (Deleted)                        | RPC Replacement (Status)                    |
| -------------------- | -------------------------------------------- | ------------------------------------------- |
| **Streaming Events** | EventBus.publish() for content/thinking/tool | ❌ Commented with TODO                      |
| **Session Events**   | EventBus.publish() for session lifecycle     | ⚠️ Partially restored (SessionManager only) |
| **Provider Events**  | EventBus.publish() for health/switch         | ❌ Commented with TODO                      |
| **Analytics Events** | EventBus.publish() for tracking              | ❌ Commented with TODO (40+ calls)          |
| **Error Events**     | EventBus.publish() for errors                | ❌ Commented with TODO                      |

### Files With Commented-Out Functionality

#### Critical (Blocks Core Features)

**1. claude-cli-launcher.ts** - **10 streaming event callbacks** commented out

- Lines 321-399: ALL streaming events have `// TODO: Phase 2 RPC`
  ```typescript
  onSessionInit: // TODO: Phase 2 RPC - Restore via RPC
  onContent: // TODO: Phase 2 RPC - Restore via RPC
  onThinking: // TODO: Phase 2 RPC - Restore via RPC
  onTool: // TODO: Phase 2 RPC - Restore via RPC
  onError: // TODO: Phase 2 RPC - Restore via RPC
  onAgentStart: // TODO: Phase 2 RPC - Restore via RPC
  onAgentActivity: // TODO: Phase 2 RPC - Restore via RPC
  onAgentComplete: // TODO: Phase 2 RPC - Restore via RPC
  onResult: // TODO: Phase 2 RPC - Restore via RPC (token usage)
  ```

**Impact**: **USER CANNOT SEE STREAMING RESPONSES**. This is the #1 blocker.

**2. command.service.ts** - **8 session method calls** commented out

- Lines 164, 177, 185, 226, 239, 247, 278: All session operations commented
  ```typescript
  // TODO: Phase 2 RPC - Restore via RPC
  // const session = await this.sessionManager.getSession(sessionId);
  ```

**Impact**: Command execution (code review, test generation) broken.

**3. provider-manager.ts** - **9 provider event emissions** commented out

- Lines 111, 160, 237, 322, 382, 423, 467, 516, 523: All provider events
  ```typescript
  // this.eventBus.publish(PROVIDER_MESSAGE_TYPES.AVAILABLE_UPDATED, {...}); // TODO: Phase 2 RPC
  // this.eventBus.publish(PROVIDER_MESSAGE_TYPES.CURRENT_CHANGED, {...}); // TODO: Phase 2 RPC
  ```

**Impact**: Provider switching UI won't update, health monitoring broken.

#### Important (Blocks Observability)

**4. file-system-manager.ts** - **14 analytics calls** commented out

- Lines 132, 174, 214, 255, 296, 323, 364, 417, 421, 445, 449, 488, 490, 583, 602
  ```typescript
  // TODO: Phase 2 - Restore analytics via RPC (file read operation completed)
  // TODO: Phase 2 - Restore error reporting via RPC
  ```

**5. command-manager.ts** - **3 analytics calls** commented out

- Lines 64, 74, 81: Command execution analytics
  ```typescript
  // TODO: Phase 2 - Restore analytics via RPC (command execution started)
  ```

**6. output-manager.ts** - **12 analytics/error calls** commented out

- Lines 130, 135, 158, 177, 183, 224, 228, 253, 257, 281, 285, 355, 359, 376, 378

**7. webview-manager.ts** - **5 analytics calls** commented out

- Lines 158, 192, 195, 232

**8. claude-cli.service.ts** - **4 event publisher dependencies** commented out

- Lines 45, 51, 189, 192: EventPublisher injection and usage

**Impact**: No analytics data, no observability, can't track errors or performance.

#### Low Priority (Nice-to-Have)

**9. dashboard.component.ts** - **1 performance monitoring call** commented out

- Line 245: Dashboard performance monitoring

**10. analytics-data-collector.ts** - **1 EventBus subscription** commented out

- Line 483: Analytics event subscription

---

## Migration Strategy

### Strategy 1: WebSocket-Style Streaming (RECOMMENDED)

**Design**: Add **streaming RPC methods** that forward events via postMessage in real-time.

**Architecture**:

```
Claude CLI stdout
  ↓ JSONL parsing
JSONLStreamParser callbacks
  ↓ streaming events
ClaudeCliLauncher (NEW: RPC event emitter)
  ↓ rpcHandler.emit('stream:content', data)
RPC Channel
  ↓ postMessage({ type: 'rpc:stream', event: 'content', data })
ClaudeRpcService (NEW: event handlers)
  ↓ EventEmitter.emit('content', data)
Frontend Components
  ↓ subscribe to events
UI updates (live streaming)
```

**Implementation**:

1. **Backend: Add RPC Streaming Methods**

   ```typescript
   // libs/backend/vscode-core/src/messaging/rpc-handler.ts
   export class RpcHandler {
     // NEW: Streaming event emitter
     emitStreamEvent(event: string, data: unknown): void {
       webview.postMessage({
         type: 'rpc:stream',
         event,
         data,
       });
     }
   }
   ```

2. **Backend: Wire Streaming in claude-cli-launcher.ts**

   ```typescript
   // Replace TODO comments with RPC calls
   onContent: (chunk) => {
     this.rpcHandler.emitStreamEvent('stream:content', {
       sessionId,
       blocks: chunk.blocks,
     });
     pushWithBackpressure({ type: 'content', data: chunk });
   },

   onThinking: (thinking) => {
     this.rpcHandler.emitStreamEvent('stream:thinking', {
       sessionId,
       thinking,
     });
     pushWithBackpressure({ type: 'thinking', data: thinking });
   },
   ```

3. **Frontend: Add Streaming Event Handlers**

   ```typescript
   // libs/frontend/core/src/lib/services/claude-rpc.service.ts
   export class ClaudeRpcService {
     private streamEventEmitter = new EventEmitter(); // or RxJS Subject

     handleStreamEvent(event: string, data: unknown): void {
       this.streamEventEmitter.emit(event, data);
     }

     onStreamEvent(event: string, callback: (data: unknown) => void): void {
       this.streamEventEmitter.on(event, callback);
     }
   }
   ```

4. **Frontend: Subscribe in Components**

   ```typescript
   // libs/frontend/chat/src/lib/containers/chat/chat.component.ts
   ngOnInit() {
     this.rpcService.onStreamEvent('stream:content', (data) => {
       // Update UI with streaming content
       this.messages.update(msgs => [...msgs, data]);
     });

     this.rpcService.onStreamEvent('stream:thinking', (data) => {
       // Show thinking indicator
       this.thinkingState.set(data);
     });
   }
   ```

**Pros**:

- ✅ Real-time streaming (no polling)
- ✅ Type-safe event names
- ✅ Minimal architectural change
- ✅ Preserves existing streaming pipeline

**Cons**:

- ❌ Not true RPC (events != request/response)
- ❌ Adds new message type (`rpc:stream`)

---

### Strategy 2: Polling-Based Updates (NOT RECOMMENDED)

**Design**: Frontend polls backend for updates via RPC calls.

**Why NOT Recommended**:

- ❌ Defeats purpose of streaming (adds latency)
- ❌ Increases network traffic (constant polling)
- ❌ Poor UX (chunks arrive in batches, not real-time)
- ❌ Higher CPU usage (polling overhead)

---

## Implementation Plan

### Phase 1: Streaming RPC Infrastructure (2-3 hours)

**Goal**: Restore all streaming events from ClaudeCliLauncher

**Tasks**:

1. **Add RPC Stream Emitter to RpcHandler**

   - File: `libs/backend/vscode-core/src/messaging/rpc-handler.ts`
   - Add: `emitStreamEvent(event: string, data: unknown): void`
   - Inject WebviewManager to call postMessage

2. **Wire RpcHandler in ClaudeCliLauncher**

   - File: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`
   - Inject RpcHandler in LauncherDependencies
   - Replace ALL 10 `// TODO: Phase 2 RPC` comments in JSONLParserCallbacks

3. **Add Stream Message Type**

   - File: `libs/shared/src/lib/types/message.types.ts`
   - Add: `'rpc:stream'` to StrictMessageType
   - Add payload: `{ event: string; data: unknown; }`

4. **Handle Stream Messages in Frontend**

   - File: `libs/frontend/core/src/lib/services/claude-rpc.service.ts`
   - Add: `handleStreamEvent()` and `onStreamEvent()`
   - Wire to VSCodeService message handler

5. **Subscribe in ChatStoreService**
   - File: `libs/frontend/chat/src/lib/services/chat-store.service.ts`
   - Subscribe to `stream:content`, `stream:thinking`, `stream:tool`
   - Update signals in real-time

**Deliverable**: Streaming responses work end-to-end

---

### Phase 2: Analytics RPC Methods (1-2 hours)

**Goal**: Restore analytics tracking via RPC

**Tasks**:

1. **Add Analytics RPC Methods**

   - Method: `analytics:track` (event name, properties)
   - Method: `analytics:error` (error message, context)

2. **Replace TODO Comments in API Wrappers**

   - `file-system-manager.ts`: 14 calls
   - `command-manager.ts`: 3 calls
   - `output-manager.ts`: 12 calls
   - `webview-manager.ts`: 5 calls

3. **Wire Backend Analytics Service**

   - Register `analytics:track` → AnalyticsDataCollector.trackEvent()
   - Register `analytics:error` → AnalyticsDataCollector.trackError()

4. **Frontend Analytics Service**
   - Add ClaudeRpcService.trackEvent() wrapper
   - Add ClaudeRpcService.trackError() wrapper

**Deliverable**: Analytics data collection works

---

### Phase 3: Provider Events (30 mins)

**Goal**: Restore provider switching and health monitoring

**Tasks**:

1. **Add Provider Stream Events**

   - Event: `stream:provider:healthChanged`
   - Event: `stream:provider:currentChanged`
   - Event: `stream:provider:availableUpdated`

2. **Replace TODO Comments in provider-manager.ts**

   - 9 event emissions → RPC stream events

3. **Subscribe in Frontend ProviderService**
   - Update provider state on health changes
   - Update current provider on switch

**Deliverable**: Provider UI updates work

---

### Phase 4: Command Service Integration (30 mins)

**Goal**: Restore command execution (code review, test generation)

**Tasks**:

1. **Wire CommandService to SessionManager**

   - Uncomment 8 `// TODO: Phase 2 RPC` session calls
   - Use restored SessionManager directly (no RPC needed - backend-only)

2. **Test Command Execution**
   - Verify code review works
   - Verify test generation works

**Deliverable**: Command execution works

---

### Phase 5: Error Propagation (30 mins)

**Goal**: Propagate errors to frontend

**Tasks**:

1. **Add Error Stream Event**

   - Event: `stream:error` (error message, sessionId, context)

2. **Replace TODO Comments in claude-cli-launcher.ts**

   - Line 358-361: `onError` callback

3. **Subscribe in Frontend**
   - Show error notifications
   - Update error state in ChatStoreService

**Deliverable**: Error notifications work

---

## Success Criteria

### Functional Requirements

- ✅ User can see streaming responses (content chunks appear in real-time)
- ✅ User can see thinking indicators
- ✅ User can see tool execution events
- ✅ Provider switching updates UI immediately
- ✅ Command execution (code review, tests) works
- ✅ Analytics data is collected
- ✅ Errors are shown in UI

### Technical Requirements

- ✅ All `// TODO: Phase 2 RPC` comments removed
- ✅ Build passes with no TypeScript errors
- ✅ No commented-out event code remains
- ✅ RPC streaming infrastructure complete

### Testing Requirements

- ✅ Manual test: Send message and see streaming response
- ✅ Manual test: Switch provider and see UI update
- ✅ Manual test: Trigger error and see notification
- ✅ Unit tests for RpcHandler streaming
- ✅ Integration test for streaming pipeline

---

## Risk Assessment

| Risk                                          | Likelihood | Impact | Mitigation                                   |
| --------------------------------------------- | ---------- | ------ | -------------------------------------------- |
| Streaming RPC adds complexity                 | High       | Medium | Use simple EventEmitter pattern, clear docs  |
| Performance regression from too many messages | Medium     | Medium | Batch content chunks, debounce events        |
| Frontend misses stream events                 | Low        | High   | Add event replay buffer for late subscribers |
| Analytics overhead                            | Low        | Low    | Async fire-and-forget RPC calls              |

---

## Timeline Estimate

| Phase                      | Estimated Time  | Complexity      |
| -------------------------- | --------------- | --------------- |
| Phase 1: Streaming         | 2-3 hours       | High            |
| Phase 2: Analytics         | 1-2 hours       | Medium          |
| Phase 3: Provider Events   | 30 mins         | Low             |
| Phase 4: Command Service   | 30 mins         | Low             |
| Phase 5: Error Propagation | 30 mins         | Low             |
| **Total**                  | **5-6.5 hours** | **Medium-High** |

---

## Next Steps

1. **Review this plan** with user - confirm approach before implementation
2. **Execute Phase 1** - Most critical (streaming)
3. **Test streaming** - Verify user can see responses
4. **Execute Phases 2-5** - Restore remaining functionality
5. **Final testing** - End-to-end verification
6. **Create git commits** - One commit per phase

---

## Related Documents

- `task-tracking/TASK_2025_021/implementation-plan.md` - Original RPC migration plan
- `task-tracking/TASK_2025_022/rpc-phase-3.5-streaming-solution.md` - Streaming architecture notes
- `task-tracking/TASK_2025_022/jsonl-stream-parser-integration.md` - Parser integration details

---

## Appendix: Full TODO Comment Locations

### claude-cli-launcher.ts

- Line 321: onSessionInit
- Line 334: onContent
- Line 340: onThinking
- Line 346: onTool
- Line 358: onError
- Line 365: onAgentStart
- Line 370: onAgentActivity
- Line 375: onAgentComplete
- Line 397: onResult (token usage)

### command.service.ts

- Line 136: Constructor injection
- Line 164: getSession call
- Line 177: getSession call
- Line 185: addMessage call
- Line 226: getSession call
- Line 239: getSession call
- Line 247: addMessage call
- Line 278: getSession call

### provider-manager.ts

- Line 49: EventBus injection
- Line 66: setupEventListeners
- Line 111: AVAILABLE_UPDATED
- Line 160: CURRENT_CHANGED
- Line 237: CURRENT_CHANGED
- Line 322: setupEventListeners
- Line 382: setupHealthMonitoring
- Line 423: HEALTH_CHANGED
- Line 467: ERROR
- Line 516: CURRENT_CHANGED
- Line 523: ERROR

### file-system-manager.ts

- Line 132: readFile analytics
- Line 174: writeFile analytics
- Line 214: deleteFile analytics
- Line 255: copyFile analytics
- Line 296: moveFile analytics
- Line 323: statFile analytics
- Line 364: readDirectory analytics
- Line 417: createWatcher analytics
- Line 421: createWatcher error
- Line 445: disposeWatcher analytics
- Line 449: disposeWatcher error
- Line 488: dispose analytics
- Line 490: dispose error
- Line 583: watcher event analytics
- Line 602: watcher error

### command-manager.ts

- Line 64: command execution started
- Line 74: command executed successfully
- Line 81: command execution error

### output-manager.ts

- 12 locations for analytics/error reporting

### webview-manager.ts

- Line 158: webview created
- Line 192: webview disposed
- Line 195: webview created
- Line 232: error reporting

### claude-cli.service.ts

- Line 45: SessionManager injection
- Line 51: EventPublisher injection
- Line 189: sessionManager param
- Line 192: eventPublisher param

---

**END OF PLAN**
