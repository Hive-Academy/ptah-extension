# Migration Strategy: Complete Message Streaming & Event Handling Fix

## Overview

This document outlines the strategy for migrating the frontend from the current dual-state, multi-service architecture to the new unified single-source-of-truth architecture while maintaining system stability and backward compatibility.

---

## Migration Phases

### Phase 0: Preparation (COMPLETED ✅)

**Timeline**: Day 1
**Status**: ✅ COMPLETED

**Tasks**:

- [x] Document current architecture (event flow diagram)
- [x] Identify all duplicate subscriptions
- [x] Identify all state sources
- [x] Create comprehensive analysis report
- [x] Create task tracking documentation

**Deliverables**:

- ✅ PARSER_MISSING_EVENTS_ANALYSIS.md
- ✅ Frontend event flow comprehensive report
- ✅ Task tracking directory (TASK_2025_007)

---

### Phase 1: Backend Fixes & Validation (IN PROGRESS)

**Timeline**: Day 1-2
**Status**: 🎯 50% COMPLETE

**Tasks**:

- [x] Add JSONLResultMessage interface
- [x] Add onMessageStop and onResult callbacks
- [x] Handle message_stop stream event
- [x] Handle result message type
- [x] Wire up callbacks in launcher
- [x] Fix stdin.end() EOF signaling
- [ ] Build extension with all fixes
- [ ] Run backend validation tests (Test 1.1-1.5)
- [ ] Verify "Claude is typing..." stops
- [ ] Verify no duplicate messages

**Deliverables**:

- ✅ Updated jsonl-stream-parser.ts
- ✅ Updated claude-cli-launcher.ts
- 🎯 Backend validation test results

**Rollback Plan**:

- Git tag: `before-backend-fixes`
- Revert commits if critical issues
- Keep test scripts for regression testing

---

### Phase 2: Frontend Quick Wins (PLANNED)

**Timeline**: Day 2-3
**Status**: 📋 PLANNED

**Objective**: Fix immediate issues with minimal architectural changes

**Tasks**:

- [ ] Add MESSAGE_COMPLETE handler in ChatService
- [ ] Clear \_currentThinking on MESSAGE_COMPLETE
- [ ] Add timeout fallback for thinking indicator
- [ ] Add timeout fallback for typing indicator
- [ ] Test: Verify indicators clear reliably

**Code Changes**:

```typescript
// In ChatService, MESSAGE_COMPLETE handler
onMessageComplete: (payload) => {
  // Existing: Clear streaming state
  this._streamState.update((state) => ({
    ...state,
    isStreaming: false,
    currentMessageId: null,
  }));

  // NEW: Clear thinking indicator
  this._currentThinking.set(null);

  // NEW: Clear any pending timeouts
  if (this.thinkingTimeout) {
    clearTimeout(this.thinkingTimeout);
    this.thinkingTimeout = null;
  }

  this.appState.setLoading(false);
};

// In THINKING handler
onThinking: (payload) => {
  this._currentThinking.set(payload);

  // NEW: Set timeout fallback (60 seconds)
  this.thinkingTimeout = setTimeout(() => {
    console.warn('[ChatService] Thinking timeout, forcing clear');
    this._currentThinking.set(null);
  }, 60000);
};
```

**Testing**:

- Run frontend validation tests (Test 2.1-2.5)
- Verify no regressions

**Rollback Plan**:

- Feature flag: `ENABLE_QUICK_WINS` (default: true)
- Can disable if issues found
- Minimal risk (only adds timeouts)

**Deliverables**:

- Updated ChatService with timeout logic
- Frontend validation test results

---

### Phase 3: Event Deduplication (PLANNED)

**Timeline**: Day 3-4
**Status**: 📋 PLANNED

**Objective**: Prevent duplicate event processing

**Tasks**:

- [ ] Create EventDeduplicationService
- [ ] Integrate with VSCodeService
- [ ] Add unit tests for deduplication
- [ ] Test with simulated duplicate events
- [ ] Monitor production logs for duplicates prevented

**Implementation**:

1. Create service: `libs/frontend/core/src/lib/services/event-deduplication.service.ts`
2. Register in providers: `libs/frontend/core/src/index.ts`
3. Inject into VSCodeService
4. Add deduplication check before messageSubject.next()

**Testing**:

```typescript
// Unit test
it('should ignore duplicate events within 1 second', () => {
  const msg = createTestMessage('chat:messageChunk');

  expect(deduplicator.isDuplicate(msg)).toBe(false); // First time
  expect(deduplicator.isDuplicate(msg)).toBe(true); // Duplicate

  // Wait 1.1 seconds
  jasmine.clock().tick(1100);
  expect(deduplicator.isDuplicate(msg)).toBe(false); // Allowed again
});
```

**Monitoring**:

- Add metrics for duplicate events prevented
- Log to console (debug level) when duplicates caught
- Track percentage of events that are duplicates

**Rollback Plan**:

- Feature flag: `ENABLE_DEDUPLICATION` (default: true)
- Can disable if false positives occur
- No data loss risk (only filters events)

**Deliverables**:

- EventDeduplicationService implementation
- Unit tests
- Integration with VSCodeService
- Metrics dashboard (optional)

---

### Phase 4: Event Cleanup Registry (PLANNED)

**Timeline**: Day 4-5
**Status**: 📋 PLANNED

**Objective**: Auto-clear transient states with timeout fallback

**Tasks**:

- [ ] Create EventCleanupRegistry service
- [ ] Register cleanup strategies in ChatService
- [ ] Test timeout fallback behavior
- [ ] Test trigger event cleanup
- [ ] Monitor for stuck states in production

**Implementation**:

1. Create service: `libs/frontend/core/src/lib/services/event-cleanup-registry.service.ts`
2. Register strategies in ChatService constructor
3. Schedule cleanup in event handlers
4. Trigger cleanup on completion events

**Strategies to Register**:

```typescript
// Thinking cleanup
{
  triggerEvents: ['chat:messageChunk', 'chat:messageComplete'],
  timeout: 60000, // 60 seconds
  clearSignals: ['_currentThinking']
}

// Streaming cleanup
{
  triggerEvents: ['chat:messageComplete'],
  timeout: 30000, // 30 seconds
  clearSignals: ['_streamState.isStreaming']
}

// Tool execution cleanup (if needed)
{
  triggerEvents: ['chat:toolResult', 'chat:toolError'],
  timeout: 120000, // 2 minutes
  clearSignals: ['_toolExecutions[id].pending']
}
```

**Testing**:

```typescript
// Unit test
it('should clear thinking after timeout', fakeAsync(() => {
  // Trigger thinking event
  registry.scheduleCleanup('chat:thinking', ...);
  expect(thinkingSignal()).toBeTruthy();

  // Wait for timeout
  tick(60000);
  expect(thinkingSignal()).toBeNull(); // Cleared
}));

it('should clear thinking on completion event', () => {
  // Trigger thinking event
  registry.scheduleCleanup('chat:thinking', ...);
  expect(thinkingSignal()).toBeTruthy();

  // Trigger completion
  registry.triggerCleanup('chat:messageComplete', ...);
  expect(thinkingSignal()).toBeNull(); // Cleared immediately
});
```

**Rollback Plan**:

- Feature flag: `ENABLE_CLEANUP_REGISTRY` (default: true)
- Falls back to manual timeout logic if disabled
- No data loss risk

**Deliverables**:

- EventCleanupRegistry implementation
- Unit tests
- Integration with ChatService
- Monitoring for stuck states (logs)

---

### Phase 5: Remove Duplicate Subscriptions (PLANNED)

**Timeline**: Day 5-6
**Status**: 📋 PLANNED

**Objective**: Consolidate event handling to ChatService only

**Tasks**:

- [ ] Audit all event subscriptions across services
- [ ] Remove duplicate subscriptions from ChatStateManagerService
- [ ] Move session state management to ChatService
- [ ] Update components to use ChatService only
- [ ] Test all affected components

**Migration Steps**:

**Step 1: Move Session State to ChatService**

```typescript
// In ChatService, add:
private readonly _availableSessions = signal<StrictChatSession[]>([]);
private readonly _sessionStats = signal<SessionStats | null>(null);

readonly availableSessions = this._availableSessions.asReadonly();
readonly sessionStats = this._sessionStats.asReadonly();

// Move methods from ChatStateManagerService:
createSession(name: string): void { ... }
switchSession(sessionId: SessionId): void { ... }
deleteSession(sessionId: SessionId): void { ... }
// etc.
```

**Step 2: Remove Subscriptions from ChatStateManagerService**

```typescript
// REMOVE these from ChatStateManagerService:
// - INITIAL_DATA subscription (line 230)
// - SESSIONS_UPDATED subscription (line 257)
// - SESSION_CREATED subscription (line 296)
// - SESSION_SWITCHED subscription (line 318)

// KEEP ONLY in ChatService
```

**Step 3: Update Component Imports**

```typescript
// BEFORE
export class SessionSelectorComponent {
  private readonly sessionState = inject(ChatStateManagerService);
  readonly sessions = this.sessionState.availableSessions;
}

// AFTER
export class SessionSelectorComponent {
  private readonly chat = inject(ChatService);
  readonly sessions = this.chat.availableSessions;
}
```

**Step 4: Deprecate ChatStateManagerService**

```typescript
// Add deprecation notice
/**
 * @deprecated Use ChatService instead. This service will be removed in v2.0.
 */
@Injectable({ providedIn: 'root' })
export class ChatStateManagerService {
  // Keep shell for backward compatibility
  // Forward all calls to ChatService
}
```

**Testing**:

- Test session CRUD operations
- Test session switching
- Test component rendering
- Verify no regressions

**Rollback Plan**:

- Keep ChatStateManagerService as shell
- Can re-enable if issues found
- Use feature flag: `USE_CHAT_SERVICE_FOR_SESSIONS`

**Deliverables**:

- Updated ChatService with session management
- Deprecated ChatStateManagerService
- Updated components
- Integration tests

---

### Phase 6: Eliminate Dual Message Collections (PLANNED)

**Timeline**: Day 6-7
**Status**: 📋 PLANNED

**Objective**: Use only `claudeMessages[]`, remove `messages[]`

**Tasks**:

- [ ] Audit all usages of `messages[]` signal
- [ ] Migrate to use `claudeMessages[]` instead
- [ ] Remove `messages[]` signal definition
- [ ] Update MESSAGE_CHUNK handler to only update `claudeMessages[]`
- [ ] Test message rendering

**Migration Steps**:

**Step 1: Find All Usages**

```bash
# Search for messages[] usage
cd D:\projects\ptah-extension
grep -r "\.messages()" libs/frontend/
grep -r "_messages" libs/frontend/core/src/lib/services/chat.service.ts
```

**Step 2: Update MESSAGE_CHUNK Handler**

```typescript
// BEFORE: Update both collections
onMessageChunk: (payload) => {
  // Update messages[]
  const messages = this._messages();
  const index = messages.findIndex((m) => m.id === payload.messageId);
  if (index >= 0) {
    messages[index] = { ...messages[index], content: payload.content };
    this._messages.set([...messages]);
  }

  // Update claudeMessages[]
  const claudeMessages = this._claudeMessages();
  // ... similar logic
};

// AFTER: Update only claudeMessages[]
onMessageChunk: (payload) => {
  const processedMsg = this.transformToProcessedMessage(payload);

  const current = this._claudeMessages();
  const index = current.findIndex((m) => m.id === processedMsg.id);

  if (index >= 0) {
    // Update existing
    current[index] = { ...current[index], ...processedMsg };
  } else {
    // Add new
    current.push(processedMsg);
  }

  this._claudeMessages.set([...current]);
  // NO update to messages[] - REMOVED
};
```

**Step 3: Remove Signal Definition**

```typescript
// REMOVE from ChatStateService
// private readonly _messages = signal<StrictChatMessage[]>([]);
// readonly messages = this._messages.asReadonly();

// KEEP ONLY
private readonly _claudeMessages = signal<ProcessedClaudeMessage[]>([]);
readonly claudeMessages = this._claudeMessages.asReadonly();

// Rename for clarity
private readonly _messages = signal<ProcessedClaudeMessage[]>([]);
readonly messages = this._messages.asReadonly();
```

**Testing**:

- Verify all messages render correctly
- Verify streaming still works
- Verify message updates work
- Check for rendering performance

**Rollback Plan**:

- Can temporarily re-add `messages[]` if needed
- Use feature flag: `USE_SINGLE_MESSAGE_COLLECTION`
- No data loss (claudeMessages[] has all data)

**Deliverables**:

- Updated ChatService (single collection)
- Updated components (if any were using messages[])
- Performance benchmarks

---

### Phase 7: MessageDispatchService (PLANNED)

**Timeline**: Day 7-8
**Status**: 📋 PLANNED

**Objective**: Centralize event routing through single service

**Tasks**:

- [ ] Create MessageDispatchService
- [ ] Register all handlers in ChatService
- [ ] Remove direct VSCodeService subscriptions
- [ ] Add handler registration validation
- [ ] Test event routing

**Implementation**:

1. Create service: `libs/frontend/core/src/lib/services/message-dispatch.service.ts`
2. Integrate with VSCodeService
3. Update ChatService to register handlers instead of subscribe
4. Update other services similarly

**Migration**:

```typescript
// BEFORE: Direct subscriptions
constructor(private readonly vscode: VSCodeService) {
  this.vscode.onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK)
    .pipe(takeUntilDestroyed())
    .subscribe(payload => this.handleMessageChunk(payload));
}

// AFTER: Handler registration
constructor(private readonly dispatcher: MessageDispatchService) {
  this.registerHandlers();
}

private registerHandlers(): void {
  this.dispatcher.register(
    CHAT_MESSAGE_TYPES.MESSAGE_CHUNK,
    (payload) => this.handleMessageChunk(payload)
  );
  // ... all other handlers
}
```

**Validation**:

```typescript
// In MessageDispatchService.register()
if (this.handlers.has(messageType)) {
  console.warn(`Duplicate handler registered for ${messageType}`);
  // Optionally throw error in development
}
```

**Testing**:

- Verify all events still routed correctly
- Verify warning logs for duplicate handlers
- Test event flow end-to-end

**Rollback Plan**:

- Feature flag: `USE_MESSAGE_DISPATCHER` (default: true)
- Can fall back to direct subscriptions if issues
- No functional change (same behavior)

**Deliverables**:

- MessageDispatchService implementation
- Updated ChatService (handlers registered)
- Integration tests
- Warning logs for duplicates

---

## Rollout Strategy

### Development Environment

**Timeline**: Days 1-8

- Implement all phases sequentially
- Test after each phase
- Fix issues before proceeding to next phase

### Staging Environment

**Timeline**: Days 9-10

- Deploy all changes
- Run full regression test suite
- Performance testing
- User acceptance testing (internal team)

### Production Rollout

**Timeline**: Days 11-14

- **Day 11**: Deploy Phase 1 (backend fixes) only
- **Day 12**: Monitor, deploy Phases 2-3 if stable
- **Day 13**: Monitor, deploy Phases 4-5 if stable
- **Day 14**: Monitor, deploy Phases 6-7 if stable

**Feature Flags**:

- `ENABLE_BACKEND_FIXES` (default: true)
- `ENABLE_QUICK_WINS` (default: true)
- `ENABLE_DEDUPLICATION` (default: true)
- `ENABLE_CLEANUP_REGISTRY` (default: true)
- `USE_CHAT_SERVICE_FOR_SESSIONS` (default: true)
- `USE_SINGLE_MESSAGE_COLLECTION` (default: true)
- `USE_MESSAGE_DISPATCHER` (default: true)

Can toggle off individually if issues arise.

---

## Monitoring & Validation

### Metrics to Track

1. **Message duplication rate**: Should be 0%
2. **Typing indicator clear time**: < 1 second after completion
3. **Event processing latency**: < 50ms
4. **Memory growth**: < 10MB per 20 messages
5. **Change detection cycles**: Reduced by 40%
6. **Duplicate events prevented**: Log count

### Dashboards

- **User**: Message send success rate, response time
- **System**: Event processing metrics, memory usage
- **Errors**: Failed event handlers, cleanup timeouts triggered

### Alerts

- **Critical**: Extension crash, messages not sending
- **Warning**: High duplicate event rate, cleanup timeouts
- **Info**: Feature flag changes, degraded performance

---

## Communication Plan

### Internal Team

- Daily standup updates during implementation
- Slack notifications for phase completions
- Demo sessions after major milestones

### Users

- Release notes for each production deployment
- Known issues documentation
- Support channel for feedback

### Documentation

- Update architecture diagrams
- Update developer guides
- Update component migration guides

---

## Success Criteria

### Phase 1 (Backend)

- ✅ All events parsed correctly
- ✅ Messages stream in real-time
- ✅ Typing indicator stops reliably

### Phase 2-3 (Quick Wins + Dedup)

- ✅ No duplicate messages in UI
- ✅ Thinking indicator clears properly
- ✅ Duplicate events prevented

### Phase 4-5 (Cleanup + Consolidation)

- ✅ Stuck states eliminated
- ✅ Single service for sessions
- ✅ Event handlers reduced by 50%

### Phase 6-7 (Architecture)

- ✅ Single message collection
- ✅ Centralized event routing
- ✅ 40% fewer change detection cycles

### Overall

- ✅ Zero critical bugs
- ✅ No performance regressions
- ✅ User satisfaction maintained or improved

---

## Timeline Summary

| Phase                      | Days        | Status          |
| -------------------------- | ----------- | --------------- |
| Phase 0: Preparation       | 1           | ✅ COMPLETED    |
| Phase 1: Backend Fixes     | 1-2         | 🎯 IN PROGRESS  |
| Phase 2: Quick Wins        | 2-3         | 📋 PLANNED      |
| Phase 3: Deduplication     | 3-4         | 📋 PLANNED      |
| Phase 4: Cleanup Registry  | 4-5         | 📋 PLANNED      |
| Phase 5: Remove Duplicates | 5-6         | 📋 PLANNED      |
| Phase 6: Single Collection | 6-7         | 📋 PLANNED      |
| Phase 7: Dispatch Service  | 7-8         | 📋 PLANNED      |
| Staging & Testing          | 9-10        | 📋 PLANNED      |
| Production Rollout         | 11-14       | 📋 PLANNED      |
| **TOTAL**                  | **14 days** | **7% Complete** |
