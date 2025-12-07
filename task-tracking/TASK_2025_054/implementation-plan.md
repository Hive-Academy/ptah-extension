# ChatStore Service Architecture Cleanup - Implementation Plan

## Goal Description

Refactor ChatStore service architecture to eliminate technical debt identified during TASK_2025_053 code review. This involves extracting 3 new services, redesigning session ID management, and centralizing validation logic.

---

## Batch 1: Extract PendingSessionManager Service

### Objective

Eliminate shared mutable state by extracting `pendingSessionResolutions` Map into dedicated service.

### Files

#### [NEW] pending-session-manager.service.ts

**Location**: `libs/frontend/chat/src/lib/services/pending-session-manager.service.ts`

**Purpose**: Manage pending session ID resolutions with timeout-based cleanup

**Interface**:

```typescript
@Injectable({ providedIn: 'root' })
export class PendingSessionManagerService {
  private resolutions = new Map<string, string>();
  private timeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Add pending session resolution
   * Auto-cleanup after 60 seconds if not resolved
   */
  add(sessionId: string, tabId: string): void {
    this.resolutions.set(sessionId, tabId);

    // Auto-cleanup timeout
    const timeout = setTimeout(() => {
      console.warn(`[PendingSessionManager] Timeout for session: ${sessionId}`);
      this.remove(sessionId);
    }, 60000);

    this.timeouts.set(sessionId, timeout);
  }

  /**
   * Remove pending resolution (on success or failure)
   * Clears associated timeout
   */
  remove(sessionId: string): string | undefined {
    const tabId = this.resolutions.get(sessionId);
    this.resolutions.delete(sessionId);

    const timeout = this.timeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(sessionId);
    }

    return tabId;
  }

  /**
   * Get tab ID for pending session
   */
  get(sessionId: string): string | undefined {
    return this.resolutions.get(sessionId);
  }

  /**
   * Check if session has pending resolution
   */
  has(sessionId: string): boolean {
    return this.resolutions.has(sessionId);
  }
}
```

**Dependencies**: None (standalone service)

**Testing**:

- Unit test: `add()` creates entry
- Unit test: `get()` retrieves entry
- Unit test: `remove()` clears entry and timeout
- Unit test: Timeout fires after 60s
- Unit test: `remove()` prevents timeout from firing

#### [MODIFY] session-loader.service.ts

**Changes**:

1. Remove `public readonly pendingSessionResolutions = new Map<string, string>();`
2. Inject `PendingSessionManagerService`
3. Replace all Map access with manager methods:
   - `this.pendingSessionResolutions.get(id)` → `this.pendingSessionManager.get(id)`
   - `this.pendingSessionResolutions.delete(id)` → `this.pendingSessionManager.remove(id)`

**Modified Methods**:

- `handleSessionIdResolved()`: Use manager instead of direct Map access

#### [MODIFY] conversation.service.ts

**Changes**:

1. Inject `PendingSessionManagerService`
2. Replace direct SessionLoader Map mutation:
   - `this.sessionLoader.pendingSessionResolutions.set()` → `this.pendingSessionManager.add()`

**Modified Methods**:

- `startNewConversation()`: Use manager to add pending resolution
- Error handlers: Use manager to remove on failure

**Benefits**:

- ✅ Eliminates shared mutable state
- ✅ Single Responsibility (manager owns Map)
- ✅ Encapsulation (no direct Map access)
- ✅ Easier to test (mock manager)

---

## Batch 2: Add Cleanup Mechanisms

### Objective

Fix memory leak by adding error cleanup and timeout mechanisms.

### Files

#### [MODIFY] pending-session-manager.service.ts

**Changes** (already included in Batch 1):

- Timeout logic (60s auto-cleanup)
- `remove()` method clears timeout

#### [MODIFY] conversation.service.ts

**Changes**: Add error cleanup in all RPC failure paths

**Modified Methods**:

```typescript
private async startNewConversation(content: string): Promise<void> {
  const placeholderSessionId = this.generateId() as SessionId;

  // Add pending resolution
  this.pendingSessionManager.add(
    placeholderSessionId,
    this.tabManager.activeTabId() ?? ''
  );

  try {
    const response = await this.claudeRpc.call('chat:start', {
      content,
      sessionId: placeholderSessionId,
      // ...
    });

    // Success - wait for session:id-resolved event
  } catch (error) {
    console.error('[ConversationService] Failed to start conversation:', error);

    // ✅ CLEANUP: Remove pending resolution on failure
    this.pendingSessionManager.remove(placeholderSessionId);

    // Update session state to failed
    this.sessionManager.setSessionLoaded(true);
    throw error;
  }
}
```

**Error Cleanup Points**:

1. `startNewConversation()` - RPC failure
2. `continueConversation()` - RPC failure (if applicable)
3. Any other async operations that create pending resolutions

**Testing**:

- Integration test: RPC failure → verify Map entry removed
- Integration test: Timeout → verify Map entry removed
- Integration test: Success → verify Map entry removed
- Manual test: Network disconnect during session creation

**Benefits**:

- ✅ No memory leaks
- ✅ Cleanup on all failure paths
- ✅ Auto-cleanup for stuck sessions

---

## Batch 3: Extract MessageSender Service

### Objective

Eliminate callback indirection by extracting message sending logic into mediator service.

### Files

#### [NEW] message-sender.service.ts

**Location**: `libs/frontend/chat/src/lib/services/message-sender.service.ts`

**Purpose**: Centralized message sending logic (mediator pattern)

**Interface**:

```typescript
@Injectable({ providedIn: 'root' })
export class MessageSenderService {
  private claudeRpc = inject(ClaudeRpcService);
  private tabManager = inject(TabManagerService);
  private sessionManager = inject(SessionManager);
  private pendingSessionManager = inject(PendingSessionManagerService);

  /**
   * Send message (new conversation or continue existing)
   * Replaces ChatStore.sendMessage() logic
   */
  async send(content: string): Promise<void> {
    const activeTab = this.tabManager.activeTab();
    if (!activeTab) {
      console.warn('[MessageSender] No active tab');
      return;
    }

    const sessionId = activeTab.sessionId;
    const hasExistingSession = sessionId && sessionId !== ('' as SessionId);

    if (hasExistingSession) {
      await this.continueConversation(content, sessionId);
    } else {
      await this.startNewConversation(content);
    }
  }

  /**
   * Start new conversation
   * Extracted from ConversationService.startNewConversation()
   */
  private async startNewConversation(content: string): Promise<void> {
    // Implementation from ConversationService
    // ...
  }

  /**
   * Continue existing conversation
   * Extracted from ConversationService.continueConversation()
   */
  private async continueConversation(content: string, sessionId: SessionId): Promise<void> {
    // Implementation from ConversationService
    // ...
  }

  /**
   * Send message or queue if streaming
   * Extracted from ConversationService.sendOrQueueMessage()
   */
  sendOrQueue(content: string): void {
    const isStreaming = this.sessionManager.isStreaming();

    if (isStreaming) {
      // Queue for later
      this.queue(content);
    } else {
      // Send immediately
      this.send(content);
    }
  }

  /**
   * Queue message for later sending
   */
  private queue(content: string): void {
    // Queue implementation
  }
}
```

**Dependencies**:

- ClaudeRpcService (RPC calls)
- TabManagerService (active tab)
- SessionManager (session state)
- PendingSessionManagerService (Batch 1)

**Testing**:

- Unit test: `send()` with existing session → calls `continueConversation()`
- Unit test: `send()` without session → calls `startNewConversation()`
- Unit test: `sendOrQueue()` while streaming → queues message
- Unit test: `sendOrQueue()` while not streaming → sends immediately

#### [MODIFY] chat.store.ts

**Changes**:

1. Inject `MessageSenderService`
2. Remove callback registration in `initializeServices()`
3. Delegate `sendMessage()` to MessageSender:

```typescript
public sendMessage(content: string): Promise<void> {
  return this.messageSender.send(content);
}

public sendOrQueueMessage(content: string): void {
  this.messageSender.sendOrQueue(content);
}
```

#### [MODIFY] conversation.service.ts

**Changes**:

1. Remove `setSendMessageCallback()` method
2. Remove `_sendMessageCallback` property
3. Move `startNewConversation()` and `continueConversation()` to MessageSender
4. Keep queue management methods (delegate to MessageSender)

#### [MODIFY] completion-handler.service.ts

**Changes**:

1. Remove `setContinueConversationCallback()` method
2. Remove `_continueConversationCallback` property
3. Inject `MessageSenderService`
4. Replace callback calls with direct service calls:

```typescript
// Before:
if (this._continueConversationCallback) {
  this._continueConversationCallback(content);
}

// After:
this.messageSender.send(content);
```

**Benefits**:

- ✅ No callback indirection (0 levels instead of 3)
- ✅ Clear service responsibility (MessageSender handles all sending)
- ✅ Easier to trace (direct method calls)
- ✅ Easier to test (mock MessageSender)
- ✅ No circular dependency (mediator pattern)

---

## Batch 4: Session ID System Redesign

### Objective

Simplify dual session ID system (sessionId vs claudeSessionId) into single ID with state machine.

### Design Decision

**Approach**: Single `sessionId` property with state tracking

**State Machine**:

```
DRAFT → CONFIRMING → CONFIRMED → FAILED
  ↓         ↓           ↓          ↓
draft_123  draft_123  real_abc  (cleared)
```

### Files

#### [MODIFY] session-manager.service.ts

**Location**: `libs/backend/claude-domain/src/lib/session/session-manager.service.ts`

**Changes**:

1. Remove `claudeSessionId` signal
2. Add `sessionState` signal
3. Consolidate into single `sessionId` with state

**New Interface**:

```typescript
export type SessionState = 'draft' | 'confirming' | 'confirmed' | 'failed';

@Injectable({ providedIn: 'root' })
export class SessionManager {
  // Single session ID (replaces sessionId + claudeSessionId)
  private readonly _sessionId = signal<SessionId>('' as SessionId);
  readonly sessionId = this._sessionId.asReadonly();

  // Session state tracking
  private readonly _sessionState = signal<SessionState>('draft');
  readonly sessionState = this._sessionState.asReadonly();

  // Store original draft ID for reference
  private readonly _draftId = signal<SessionId | null>(null);
  readonly draftId = this._draftId.asReadonly();

  /**
   * Set session ID (draft or confirmed)
   */
  setSessionId(id: SessionId, state: SessionState = 'draft'): void {
    this._sessionId.set(id);
    this._sessionState.set(state);

    if (state === 'draft') {
      this._draftId.set(id);
    }
  }

  /**
   * Confirm session ID (after backend resolves)
   * Replaces setClaudeSessionId()
   */
  confirmSessionId(realId: SessionId): void {
    if (this._sessionState() === 'confirmed') {
      console.warn('[SessionManager] Session already confirmed');
      return;
    }

    this._sessionId.set(realId);
    this._sessionState.set('confirmed');
  }

  /**
   * Mark session as failed
   */
  failSession(): void {
    this._sessionState.set('failed');
  }

  /**
   * Check if session is confirmed (not draft)
   */
  isSessionConfirmed(): boolean {
    return this._sessionState() === 'confirmed';
  }

  /**
   * Get current session ID (regardless of state)
   */
  getCurrentSessionId(): SessionId {
    return this._sessionId();
  }
}
```

**Removed Methods**:

- `setClaudeSessionId()` → replaced by `confirmSessionId()`
- `getClaudeSessionId()` → replaced by `getCurrentSessionId()` + state check

#### [MODIFY] All Services Using Session IDs

**Files to Update**:

1. `session-loader.service.ts`
2. `conversation.service.ts`
3. `chat.store.ts`
4. `streaming-handler.service.ts`
5. `completion-handler.service.ts`

**Changes Pattern**:

```typescript
// Before:
this.sessionManager.setSessionId(draftId);
this.sessionManager.setClaudeSessionId(realId);

// After:
this.sessionManager.setSessionId(draftId, 'draft');
this.sessionManager.confirmSessionId(realId);
```

**Migration Checklist**:

- [ ] Replace all `setClaudeSessionId()` calls with `confirmSessionId()`
- [ ] Replace all `getClaudeSessionId()` calls with `getCurrentSessionId()`
- [ ] Update session state checks to use `sessionState` signal
- [ ] Remove all references to `claudeSessionId` property

**Testing**:

- Unit test: `setSessionId('draft_123', 'draft')` → state = draft, id = draft_123
- Unit test: `confirmSessionId('real_abc')` → state = confirmed, id = real_abc
- Unit test: Double confirm throws warning
- Integration test: Full session lifecycle (draft → confirmed)
- Manual test: Create session → verify UI shows correct ID at each stage

**Benefits**:

- ✅ Single source of truth (one ID property)
- ✅ Clear state machine (draft → confirmed)
- ✅ No confusion about which ID to use
- ✅ Easier to understand code flow
- ✅ Better type safety (state-based logic)

---

## Batch 5: Centralize Message Validation

### Objective

Create centralized validation service for consistent message content validation.

### Files

#### [NEW] message-validation.service.ts

**Location**: `libs/frontend/chat/src/lib/services/message-validation.service.ts`

**Purpose**: Centralized message content validation rules

**Interface**:

```typescript
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

@Injectable({ providedIn: 'root' })
export class MessageValidationService {
  /**
   * Validate message content
   * Centralized rules for all message sending paths
   */
  validate(content: unknown): ValidationResult {
    // Rule 1: Null/undefined check
    if (content === null || content === undefined) {
      return { valid: false, reason: 'Content is null or undefined' };
    }

    // Rule 2: Type check
    if (typeof content !== 'string') {
      return { valid: false, reason: 'Content must be a string' };
    }

    // Rule 3: Whitespace-only check
    if (content.trim() === '') {
      return { valid: false, reason: 'Content is empty or whitespace-only' };
    }

    // Rule 4: Maximum length check (prevent token waste)
    if (content.length > 100000) {
      return { valid: false, reason: 'Content exceeds maximum length (100,000 characters)' };
    }

    // Rule 5: Minimum meaningful content (optional - can be removed if too strict)
    // If content is only punctuation (no alphanumeric), consider invalid
    if (!/[a-zA-Z0-9]/.test(content)) {
      return { valid: false, reason: 'Content contains no alphanumeric characters' };
    }

    return { valid: true };
  }

  /**
   * Sanitize content (trim whitespace)
   */
  sanitize(content: string): string {
    return content.trim();
  }
}
```

**Dependencies**: None (standalone service)

**Testing**:

- Unit test: `validate(null)` → invalid
- Unit test: `validate(undefined)` → invalid
- Unit test: `validate('')` → invalid
- Unit test: `validate('   ')` → invalid (whitespace-only)
- Unit test: `validate('Hello')` → valid
- Unit test: `validate('!')` → invalid (no alphanumeric)
- Unit test: `validate(long_string_100001_chars)` → invalid
- Unit test: `sanitize('  Hello  ')` → 'Hello'

#### [MODIFY] message-sender.service.ts

**Changes**: Add validation to all send methods

```typescript
async send(content: string): Promise<void> {
  // Validate content
  const validation = this.validator.validate(content);
  if (!validation.valid) {
    console.warn(`[MessageSender] Invalid content: ${validation.reason}`);
    return;
  }

  // Sanitize content
  const sanitized = this.validator.sanitize(content);

  // Send sanitized content
  // ... rest of logic
}
```

#### [MODIFY] conversation.service.ts

**Changes**: Apply validation in queue methods

```typescript
public queueOrAppendMessage(content: string): void {
  // Validate content
  const validation = this.validator.validate(content);
  if (!validation.valid) {
    console.warn(`[Conversation] Invalid queue content: ${validation.reason}`);
    return;
  }

  // Queue validated content
  // ... rest of logic
}
```

**Benefits**:

- ✅ Consistent validation across all paths
- ✅ Centralized rules (easy to modify)
- ✅ Prevents token waste (max length, empty content)
- ✅ Clear error messages
- ✅ Sanitization (trim whitespace)

---

## Verification Plan

### Type-Check (Per Batch)

```bash
# After each batch
npx tsc -p libs/frontend/chat/tsconfig.lib.json --noEmit
npx tsc -p libs/backend/claude-domain/tsconfig.lib.json --noEmit
```

### Lint (Per Batch)

```bash
npx nx lint chat
npx nx lint claude-domain
```

### Unit Tests (Per Batch)

```bash
# Test new services
npx nx test chat --testPathPattern=pending-session-manager
npx nx test chat --testPathPattern=message-sender
npx nx test chat --testPathPattern=message-validation
```

### Integration Tests (After All Batches)

```bash
# Full suite
npx nx test chat
npx nx test claude-domain
```

### Manual Testing (After All Batches)

**Session Flow**:

1. Create new conversation → verify session ID resolves
2. Create conversation, kill backend mid-flight → verify cleanup (no memory leak)
3. Create conversation, wait 61 seconds without resolution → verify timeout cleanup

**Message Flow**: 4. Send message with existing session → verify sends 5. Send message while streaming → verify queues 6. Stop streaming → verify queue sends

**Validation**: 7. Try sending empty message → verify rejected 8. Try sending whitespace-only → verify rejected 9. Try sending valid message → verify accepted

**Permission Flow**: 10. Trigger tool permission → approve → verify works

---

## Final Code Review Checklist

### Architecture

- [ ] No shared mutable state between services
- [ ] No callback indirection (direct service calls)
- [ ] Single session ID system (state-based)
- [ ] Centralized validation

### Code Quality

- [ ] All files follow SOLID principles
- [ ] All services have single responsibility
- [ ] All dependencies injected via DI
- [ ] All signals readonly for public access

### Testing

- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Manual testing complete
- [ ] No regressions

### Documentation

- [ ] Code comments explain complex logic
- [ ] CLAUDE.md updated (if needed)
- [ ] Task tracking updated

---

## Rollback Strategy

Each batch creates independent commit. If issues:

**Option A**: Revert specific batch

```bash
git revert <batch-commit-sha>
```

**Option B**: Revert all batches

```bash
git revert <batch-1-sha>..<batch-5-sha>
```

**Option C**: Branch revert

```bash
git checkout main
git branch -D feature/chatstore-architecture-cleanup
```

---

## Success Metrics

### Before (TASK_2025_053 Complete)

- Code-Style Score: 6.5/10
- Code-Logic Score: 6.5/10
- Serious Issues: 5
- Services: 5 child services
- Callbacks: 2 callback chains
- Session IDs: 2 properties (dual system)

### After (TASK_2025_054 Complete)

- Code-Style Score: 9/10+ (target)
- Code-Logic Score: 9/10+ (target)
- Serious Issues: 0
- Services: 8 (3 new: PendingSessionManager, MessageSender, MessageValidation)
- Callbacks: 0
- Session IDs: 1 property (state-based)

### Measurable Improvements

- ✅ -100% shared mutable state
- ✅ -100% callback indirection
- ✅ -50% session ID properties
- ✅ +3 specialized services
- ✅ +60% code review scores
