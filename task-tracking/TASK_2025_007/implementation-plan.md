# Implementation Plan: Complete Message Streaming & Event Handling Fix

## Phase 1: Backend Parser & Launcher Fixes (COMPLETED ✅)

### 1.1: Add Missing JSONL Message Interfaces

**File**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

**Changes Made**:

```typescript
// Added JSONLResultMessage interface (lines 97-119)
export interface JSONLResultMessage {
  readonly type: 'result';
  readonly subtype: 'success' | 'error';
  readonly session_id?: string;
  readonly result?: string;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly usage?: { ... };
  readonly modelUsage?: Record<string, { ... }>;
}

// Updated JSONLMessage union type (lines 16-22)
export type JSONLMessage =
  | JSONLSystemMessage
  | JSONLAssistantMessage
  | JSONLToolMessage
  | JSONLPermissionMessage
  | JSONLStreamEvent
  | JSONLResultMessage; // ADDED
```

**Status**: ✅ COMPLETED

---

### 1.2: Add Missing Parser Callbacks

**File**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

**Changes Made**:

```typescript
// Updated JSONLParserCallbacks interface (lines 149-161)
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void;
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onMessageStop?: () => void; // ADDED - signals streaming complete
  onResult?: (result: JSONLResultMessage) => void; // ADDED - final result
  onError?: (error: Error, rawLine?: string) => void;
}
```

**Status**: ✅ COMPLETED

---

### 1.3: Handle message_stop Stream Event

**File**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

**Changes Made**:

```typescript
// In handleStreamEvent() method (lines 761-766)
// CRITICAL: Handle message_stop to signal end of streaming
if (msg.event.type === 'message_stop') {
  console.log('[JSONLStreamParser] message_stop received - streaming complete');
  this.callbacks.onMessageStop?.();
  return;
}
```

**Status**: ✅ COMPLETED

---

### 1.4: Handle result Message Type

**File**: `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts`

**Changes Made**:

```typescript
// Added case in handleMessage() switch (line 279-281)
case 'result':
  this.handleResultMessage(json);
  break;

// Added handleResultMessage() method (lines 732-744)
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

**Status**: ✅ COMPLETED

---

### 1.5: Wire Up Callbacks in Launcher

**File**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`

**Changes Made**:

```typescript
// Added to callbacks object (lines 356-382)
onMessageStop: () => {
  console.log('[ClaudeCliLauncher] Streaming complete (message_stop received)');
  this.deps.eventPublisher.emitMessageComplete(sessionId);
},

onResult: (result) => {
  console.log('[ClaudeCliLauncher] Final result received:', {
    cost: result.total_cost_usd,
    duration: result.duration_ms,
    tokens: result.usage,
  });

  // Emit token usage if available
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
},
```

**Status**: ✅ COMPLETED

---

### 1.6: Fix stdin EOF Signaling

**File**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`

**Changes Made**:

```typescript
// In spawnTurn() method (lines 126-143)
// CRITICAL: Write message to stdin (required for -p flag)
// CRITICAL: Must call stdin.end() to signal EOF, otherwise CLI hangs forever!
if (childProcess.stdin && !childProcess.stdin.destroyed) {
  console.log('[ClaudeCliLauncher] Writing message to stdin:', {
    messageLength: message.length,
    messagePreview: message.substring(0, 50),
  });
  childProcess.stdin.write(message + '\n');
  console.log('[ClaudeCliLauncher] Message written to stdin');

  // CRITICAL FIX: End stdin to signal EOF (like echo pipe does)
  // Without this, Claude CLI waits forever for more stdin input!
  childProcess.stdin.end();
  console.log('[ClaudeCliLauncher] stdin ended (EOF signaled)');
} else {
  console.error('[ClaudeCliLauncher] ERROR: stdin is not writable!');
}
```

**Root Cause**: Claude CLI's `-p` flag expects stdin to be closed (EOF) after the message, like `echo "message" |` does. Without `stdin.end()`, the CLI waits forever.

**Status**: ✅ COMPLETED

---

## Phase 2: Frontend Quick Wins (IN PROGRESS)

### 2.1: Build and Test Backend Fixes

**Tasks**:

- [ ] Build `@ptah-extension/claude-domain` library
- [ ] Build `ptah-extension-vscode` extension
- [ ] Test: Send message → Should get response
- [ ] Test: Streaming works (chunks appear)
- [ ] Test: "Claude is typing..." stops on completion
- [ ] Verify logs show `message_stop` and `result` events

**Expected Logs**:

```
[ClaudeCliLauncher] Process spawned successfully, PID: 12345
[ClaudeCliLauncher] Writing message to stdin: ...
[ClaudeCliLauncher] Message written to stdin
[ClaudeCliLauncher] stdin ended (EOF signaled)
[ClaudeCliLauncher] Received stdout data: ...
[JSONLStreamParser] message_stop received - streaming complete
[ClaudeCliLauncher] Streaming complete (message_stop received)
[JSONLStreamParser] result message received: { cost: 0.016, duration: 2866, ... }
[ClaudeCliLauncher] Final result received: ...
```

**Status**: 🎯 NEXT STEP

---

### 2.2: Fix Message Duplication (Frontend)

**File**: `libs/frontend/core/src/lib/services/chat.service.ts`

**Problem**: Both `messages[]` and `claudeMessages[]` updated for same event

**Solution**: Use ONLY `claudeMessages[]`, remove `messages[]` updates

**Changes Required**:

```typescript
// REMOVE: _messages signal (line 198)
// KEEP ONLY: _claudeMessages signal (line 199)

// In MESSAGE_CHUNK handler (lines 430-510):
// BEFORE: Update both messages[] and claudeMessages[]
// AFTER: Update only claudeMessages[]

private handleMessageChunk(payload: MessageChunkPayload): void {
  // Transform StrictChatMessage → ProcessedClaudeMessage once
  const processedMsg = this.transformToProcessedMessage(payload);

  // Update ONLY claudeMessages[]
  const current = this._claudeMessages();
  const index = current.findIndex(m => m.id === processedMsg.id);

  if (index >= 0) {
    // Update existing
    current[index] = { ...current[index], ...processedMsg };
    this._claudeMessages.set([...current]);
  } else {
    // Add new
    this._claudeMessages.set([...current, processedMsg]);
  }

  // NO LONGER UPDATE messages[] - eliminate dual state
}
```

**Status**: 📋 PLANNED

---

### 2.3: Remove Duplicate Subscriptions

**Files**:

- `libs/frontend/core/src/lib/services/chat.service.ts`
- `libs/frontend/chat/src/lib/services/chat-state-manager.service.ts`

**Problem**: Same events handled in both services

**Solution**: ChatService handles ALL events, ChatStateManagerService removed or reduced

**Changes Required**:

**Option A: Remove ChatStateManagerService entirely**

- Move `_availableSessions` signal to ChatService
- Move session CRUD methods to ChatService
- Update components to use ChatService only

**Option B: Split responsibilities clearly**

- ChatService: Message events (MESSAGE*\*, THINKING, TOOL*\*)
- ChatStateManagerService: Session events (SESSION*\*, SESSIONS*\*)
- NO overlap

**Recommended**: Option B (cleaner separation)

**Status**: 📋 PLANNED

---

### 2.4: Add Thinking Cleanup

**File**: `libs/frontend/core/src/lib/services/chat.service.ts`

**Problem**: `_currentThinking` signal set but never cleared

**Solution**: Clear on `MESSAGE_CHUNK` or `MESSAGE_COMPLETE`

**Changes Required**:

```typescript
// In MESSAGE_COMPLETE handler (lines 661-676)
onMessageComplete: (payload) => {
  // Clear streaming state
  this._streamState.update((state) => ({
    ...state,
    isStreaming: false,
    currentMessageId: null,
  }));

  // ADDED: Clear thinking indicator
  this._currentThinking.set(null);

  // Clear loading
  this.appState.setLoading(false);
};

// Alternative: Clear on first MESSAGE_CHUNK
onMessageChunk: (payload) => {
  // If thinking was active, clear it (chunks mean thinking is done)
  if (this._currentThinking()) {
    this._currentThinking.set(null);
  }

  // ... rest of handler
};
```

**Status**: 📋 PLANNED

---

## Phase 3: Frontend Architecture Refactor (PLANNED)

### 3.1: Implement Event Deduplication Service

**File**: `libs/frontend/core/src/lib/services/event-deduplication.service.ts` (NEW)

**Purpose**: Prevent duplicate event processing if backend sends same event twice

**Implementation**:

```typescript
@Injectable({ providedIn: 'root' })
export class EventDeduplicationService {
  private readonly processedEvents = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 1000; // 1 second
  private readonly MAX_CACHE_SIZE = 1000;

  isDuplicate(message: StrictMessage): boolean {
    const key = `${message.type}:${this.extractId(message)}`;
    const lastTime = this.processedEvents.get(key);
    const now = Date.now();

    // Same event within 1 second = duplicate
    if (lastTime && now - lastTime < this.DEDUP_WINDOW_MS) {
      console.debug('[EventDedup] Duplicate event ignored:', key);
      return true;
    }

    this.processedEvents.set(key, now);
    this.cleanup(now);

    return false;
  }

  private extractId(message: StrictMessage): string {
    // Extract unique ID from payload based on message type
    if ('messageId' in message.payload) {
      return message.payload.messageId;
    }
    if ('sessionId' in message.payload) {
      return message.payload.sessionId;
    }
    return message.id; // Fallback to correlation ID
  }

  private cleanup(now: number): void {
    if (this.processedEvents.size < this.MAX_CACHE_SIZE) return;

    // Remove entries older than 5 minutes
    for (const [key, time] of this.processedEvents) {
      if (now - time > 300000) {
        this.processedEvents.delete(key);
      }
    }
  }
}
```

**Integration**:

```typescript
// In VSCodeService.setupMessageListener() (line 177)
private setupMessageListener(): void {
  window.addEventListener('message', (event: MessageEvent) => {
    // ... existing validation ...

    const message = event.data as StrictMessage;

    // ADDED: Deduplication check
    if (this.deduplicator.isDuplicate(message)) {
      return; // Skip duplicate
    }

    this.messageSubject.next(message);
    this._lastMessageTime.set(Date.now());
  });
}
```

**Status**: 📋 PLANNED

---

### 3.2: Implement Event Cleanup Registry

**File**: `libs/frontend/core/src/lib/services/event-cleanup-registry.service.ts` (NEW)

**Purpose**: Auto-clear transient states (thinking, streaming) with timeout fallback

**Implementation**:

```typescript
interface CleanupStrategy {
  triggerEvents: string[]; // Events that mark completion
  timeout?: number; // Fallback timeout (ms)
  clearSignals: string[]; // What to clear
}

@Injectable({ providedIn: 'root' })
export class EventCleanupRegistry {
  private readonly strategies = new Map<string, CleanupStrategy>();
  private readonly activeTimers = new Map<string, NodeJS.Timeout>();

  register(eventType: string, strategy: CleanupStrategy): void {
    this.strategies.set(eventType, strategy);
  }

  scheduleCleanup(eventType: string, context: any, signalSetters: Record<string, (value: any) => void>): void {
    const strategy = this.strategies.get(eventType);
    if (!strategy) return;

    // Clear any existing timer
    this.clearTimer(eventType);

    // Set timeout fallback
    if (strategy.timeout) {
      const timer = setTimeout(() => {
        console.warn(`[CleanupRegistry] Timeout reached for ${eventType}, forcing cleanup`);
        this.cleanup(strategy, signalSetters);
      }, strategy.timeout);

      this.activeTimers.set(eventType, timer);
    }
  }

  triggerCleanup(completionEvent: string, signalSetters: Record<string, (value: any) => void>): void {
    // Find strategies triggered by this event
    for (const [eventType, strategy] of this.strategies) {
      if (strategy.triggerEvents.includes(completionEvent)) {
        this.clearTimer(eventType);
        this.cleanup(strategy, signalSetters);
      }
    }
  }

  private cleanup(strategy: CleanupStrategy, signalSetters: Record<string, (value: any) => void>): void {
    for (const signalPath of strategy.clearSignals) {
      const setter = signalSetters[signalPath];
      if (setter) {
        setter(null); // Clear signal
        console.debug(`[CleanupRegistry] Cleared signal: ${signalPath}`);
      }
    }
  }

  private clearTimer(eventType: string): void {
    const timer = this.activeTimers.get(eventType);
    if (timer) {
      clearTimeout(timer);
      this.activeTimers.delete(eventType);
    }
  }
}
```

**Registration** (in ChatService):

```typescript
constructor(
  private readonly cleanupRegistry: EventCleanupRegistry
) {
  // Register cleanup strategies
  this.cleanupRegistry.register(CHAT_MESSAGE_TYPES.THINKING, {
    triggerEvents: [
      CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
      CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE
    ],
    timeout: 60000, // 60 sec fallback
    clearSignals: ['_currentThinking']
  });

  this.cleanupRegistry.register(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK, {
    triggerEvents: [CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE],
    timeout: 30000, // 30 sec fallback
    clearSignals: ['_streamState.isStreaming', '_currentThinking']
  });
}

// In event handlers
onThinking(payload): void {
  this._currentThinking.set(payload);

  // Schedule cleanup with timeout fallback
  this.cleanupRegistry.scheduleCleanup(
    CHAT_MESSAGE_TYPES.THINKING,
    this,
    { '_currentThinking': (v) => this._currentThinking.set(v) }
  );
}

onMessageComplete(payload): void {
  // Trigger cleanup for all relevant strategies
  this.cleanupRegistry.triggerCleanup(
    CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE,
    {
      '_streamState.isStreaming': (v) => this._streamState.update(s => ({ ...s, isStreaming: v })),
      '_currentThinking': (v) => this._currentThinking.set(v),
    }
  );
}
```

**Status**: 📋 PLANNED

---

### 3.3: Create MessageDispatchService (Central Router)

**File**: `libs/frontend/core/src/lib/services/message-dispatch.service.ts` (NEW)

**Purpose**: Single entry point for all backend events, routes to typed handlers

**Implementation**:

```typescript
type MessageHandler<T extends keyof MessagePayloadMap> = (payload: MessagePayloadMap[T]) => void;

@Injectable({ providedIn: 'root' })
export class MessageDispatchService {
  private readonly handlers = new Map<string, MessageHandler<any>[]>();

  constructor(private readonly vscodeService: VSCodeService, private readonly deduplicator: EventDeduplicationService) {
    this.setupGlobalListener();
  }

  private setupGlobalListener(): void {
    this.vscodeService
      .onMessage()
      .pipe(
        filter((msg) => !this.deduplicator.isDuplicate(msg)),
        takeUntilDestroyed()
      )
      .subscribe((msg) => {
        this.dispatch(msg);
      });
  }

  register<T extends keyof MessagePayloadMap>(messageType: T, handler: MessageHandler<T>): void {
    const handlers = this.handlers.get(messageType) || [];
    handlers.push(handler);
    this.handlers.set(messageType, handlers);
  }

  private dispatch(message: StrictMessage): void {
    const handlers = this.handlers.get(message.type);
    if (!handlers || handlers.length === 0) {
      console.debug('[MessageDispatch] No handler for:', message.type);
      return;
    }

    if (handlers.length > 1) {
      console.warn('[MessageDispatch] Multiple handlers for:', message.type, handlers.length);
    }

    // Execute all handlers (should be only 1)
    for (const handler of handlers) {
      try {
        handler(message.payload);
      } catch (error) {
        console.error('[MessageDispatch] Handler error:', message.type, error);
      }
    }
  }
}
```

**Integration** (in ChatService):

```typescript
constructor(
  private readonly dispatcher: MessageDispatchService,
  // Remove: private readonly vscodeService: VSCodeService
) {
  this.registerHandlers();
}

private registerHandlers(): void {
  // Register all event handlers with dispatcher
  this.dispatcher.register(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
    (payload) => this.handleMessageChunk(payload));

  this.dispatcher.register(CHAT_MESSAGE_TYPES.MESSAGE_COMPLETE,
    (payload) => this.handleMessageComplete(payload));

  this.dispatcher.register(CHAT_MESSAGE_TYPES.THINKING,
    (payload) => this.handleThinking(payload));

  // ... all other handlers
}

// Remove all vscodeService.onMessageType() subscriptions!
// Dispatcher handles routing now
```

**Status**: 📋 PLANNED

---

### 3.4: Consolidate State to Single Source

**Goal**: Components read from ONE service only

**Changes Required**:

**ChatService becomes THE state manager**:

```typescript
// Move from ChatStateManagerService to ChatService:
- _availableSessions signal
- _sessionStats signal
- Session CRUD methods

// Keep in ChatService:
- _claudeMessages (ONLY message collection, remove _messages)
- _currentSession
- _streamState
- _currentThinking
- _toolExecutions
- _pendingPermissions
- _agents

// Remove: messages[] signal entirely
```

**Update Component Imports**:

```typescript
// BEFORE: Multiple service dependencies
export class ChatComponent {
  private readonly chat = inject(ChatService);
  private readonly chatState = inject(ChatStateService);
  private readonly sessionState = inject(ChatStateManagerService);
  private readonly appState = inject(AppStateManager);

  readonly messages = this.chatState.claudeMessages;
  readonly sessions = this.sessionState.availableSessions;
  readonly isLoading = this.appState.isLoading;
}

// AFTER: Single service dependency
export class ChatComponent {
  private readonly chat = inject(ChatService);

  // All state from one source
  readonly messages = this.chat.messages;
  readonly sessions = this.chat.sessions;
  readonly isLoading = this.chat.isLoading;
  readonly currentSession = this.chat.currentSession;
  readonly isStreaming = this.chat.isStreaming;
  readonly thinking = this.chat.currentThinking;
}
```

**Status**: 📋 PLANNED

---

## Phase 4: Testing & Validation

### 4.1: Unit Tests

**Files to Test**:

- `event-deduplication.service.spec.ts`
- `event-cleanup-registry.service.spec.ts`
- `message-dispatch.service.spec.ts`
- `chat.service.spec.ts` (updated for new architecture)

**Test Cases**:

- Deduplication: Same event twice within 1 second → only processed once
- Cleanup: Thinking set, timeout expires → thinking cleared
- Dispatch: Multiple handlers registered → warning logged
- State: Message added, signal updated → components react once

**Status**: 📋 PLANNED

---

### 4.2: Integration Tests

**Scenarios**:

1. Full message flow: Send → Stream → Complete → State updated
2. Duplicate event handling: Event sent twice → processed once
3. Timeout cleanup: Thinking set, no completion → cleared after timeout
4. Session switch: Switch session → messages load → UI updates

**Status**: 📋 PLANNED

---

### 4.3: E2E Tests

**User Workflows**:

1. User sends message → Response appears → Typing indicator stops
2. User sends second message → Works seamlessly
3. User switches sessions → Messages load correctly
4. Network issue (simulated) → Duplicate events → No duplicate UI

**Status**: 📋 PLANNED

---

## Phase 5: Migration & Rollout

### 5.1: Backward Compatibility

**Strategy**:

- Keep dual state (`messages[]` + `claudeMessages[]`) temporarily during migration
- Add feature flag to enable new architecture
- Gradually migrate components one by one
- Remove old code after all components migrated

**Status**: 📋 PLANNED

---

### 5.2: Documentation

**Documents to Create/Update**:

- [ ] Frontend architecture diagram (updated)
- [ ] Event flow documentation
- [ ] State management guide
- [ ] Component migration guide
- [ ] Testing guide

**Status**: 📋 PLANNED

---

### 5.3: Rollout Plan

**Phases**:

1. Deploy backend fixes (parser + launcher) → Validate streaming works
2. Deploy deduplication service → Validate no duplicates
3. Deploy cleanup registry → Validate states clear properly
4. Deploy state consolidation → Validate single source of truth
5. Migrate components → Validate UI works correctly

**Status**: 📋 PLANNED

---

## Timeline Estimate

| Phase                          | Estimated Time | Status           |
| ------------------------------ | -------------- | ---------------- |
| Phase 1: Backend Fixes         | 4 hours        | ✅ COMPLETED     |
| Phase 2: Frontend Quick Wins   | 2 hours        | 🎯 IN PROGRESS   |
| Phase 3: Architecture Refactor | 8 hours        | 📋 PLANNED       |
| Phase 4: Testing               | 4 hours        | 📋 PLANNED       |
| Phase 5: Migration & Rollout   | 2 hours        | 📋 PLANNED       |
| **TOTAL**                      | **20 hours**   | **20% Complete** |

---

## Next Actions

1. ✅ Build backend with all fixes
2. ✅ Test message streaming end-to-end
3. ✅ Verify "Claude is typing..." stops
4. ✅ Verify no duplicate messages
5. 📋 Implement deduplication service
6. 📋 Implement cleanup registry
7. 📋 Remove duplicate subscriptions
8. 📋 Consolidate state management
9. 📋 Update components
10. 📋 Write tests
