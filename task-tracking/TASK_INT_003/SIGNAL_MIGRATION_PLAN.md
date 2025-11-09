# Signal-Based Architecture Migration Plan

**Task**: TASK_INT_003  
**Created**: 2025-01-15  
**Status**: 🔄 In Progress

## 🎯 Objective

Migrate all frontend services from RxJS Observable/Subject pattern to pure Angular 20+ signal-based architecture to eliminate state inconsistencies caused by multiple subscription streams.

## 🔍 Root Cause Analysis

### The Problem

Multiple services subscribe to `VSCodeService.onMessageType()` Observable streams, creating:

- **Race Conditions**: Multiple handlers processing same message at different times
- **Duplicate Processing**: Same message triggers multiple state updates
- **State Conflicts**: Concurrent updates to shared state cause inconsistencies
- **Timing Issues**: No guaranteed order of execution across services

### Current Architecture (PROBLEMATIC)

```
VSCodeService.messageSubject (RxJS Subject)
    ↓ .asObservable()
    ├─→ ChatService.subscribe() → state update
    ├─→ ProviderService.subscribe() → state update
    ├─→ ChatStateManager.subscribe() → state update
    └─→ FilePickerService.subscribe() → state update

Result: 4 separate streams, no coordination, race conditions
```

### Target Architecture (SIGNAL-BASED)

```
VSCodeService._messageQueue (WritableSignal<StrictMessage[]>)
    ↓ computed signals
    ├─→ messagesOfType('chat:messageChunk')
    ├─→ latestMessageOfType('chat:messageChunk')
    └─→ Services use effect() to react to signal changes

Result: Single source of truth, coordinated reactivity, no races
```

## 📊 Service Inventory

### ✅ Already Signal-Pure (No Changes Needed)

- `stream-handling.service.ts`
- `chat-state.service.ts`
- `chat-validation.service.ts`
- `message-processing.service.ts`
- `analytics.service.ts`
- `app-state.service.ts`
- `logging.service.ts`
- `view-manager.service.ts`

### 🔴 HIGH PRIORITY - Heavy RxJS Usage

#### 1. chat.service.ts (CRITICAL)

**RxJS Usage**: 9+ subscriptions in `initializeMessageHandling()`
**Impact**: Core chat functionality, most affected by state inconsistencies
**Subscriptions**:

- `chat:messageChunk`
- `chat:sessionCreated`
- `chat:sessionSwitched`
- `chat:messageAdded`
- `chat:tokenUsageUpdated`
- `chat:sessionsUpdated`
- `chat:getHistory:response`
- `initialData`

**Migration Strategy**:

```typescript
// OLD: Observable subscription
this.vscode.onMessageType('chat:messageChunk')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    this._streamState.update(...);
  });

// NEW: Signal-based effect
effect(() => {
  const chunk = this.vscode.latestMessageOfType('chat:messageChunk')();
  if (chunk) {
    this._streamState.update((state) => ({
      ...state,
      isStreaming: !chunk.payload.isComplete,
      lastMessageTimestamp: Date.now(),
    }));
  }
});
```

#### 2. provider.service.ts (CRITICAL)

**RxJS Usage**: 6+ subscriptions + Subject for cleanup
**Impact**: AI provider management, health monitoring, auto-refresh
**Subscriptions**:

- `provider:getAvailableProviders:response`
- `provider:getCurrentProvider:response`
- `provider:switchProvider`
- `provider:getProviderHealth:response`
- `provider:error`
- Auto-refresh timer (uses effect, but subscribes to messages)

**Migration Strategy**:

```typescript
// Remove: private readonly destroy$ = new Subject<void>();

// OLD: Observable subscription with takeUntil
this.vscodeService
  .onMessageType(toResponseType(PROVIDER_MESSAGE_TYPES.GET_AVAILABLE_PROVIDERS))
  .pipe(takeUntil(this.destroy$))
  .subscribe((response) => { ... });

// NEW: Signal-based effect
effect(() => {
  const response = this.vscodeService.latestMessageOfType(
    toResponseType(PROVIDER_MESSAGE_TYPES.GET_AVAILABLE_PROVIDERS)
  )();
  if (response?.success && response.data) {
    this._availableProviders.set(response.data.providers);
  }
});
```

### 🟡 MEDIUM PRIORITY

#### 3. chat-state-manager.service.ts

**RxJS Usage**: 4 subscriptions for session management
**Subscriptions**:

- `initialData`
- `chat:sessionsUpdated`
- `chat:sessionCreated`
- `chat:sessionSwitched`

#### 4. webview-config.service.ts

**RxJS Usage**: Uses `toObservable()` + multiple subscriptions
**Subscriptions**:

- Connection state monitoring
- Message handling

### 🟢 LOW PRIORITY - Light RxJS Usage

#### 5. file-picker.service.ts

**RxJS Usage**: 1 subscription
**Subscription**: `context:getFiles:response`

#### 6. webview-navigation.service.ts

**RxJS Usage**: 1 subscription
**Subscription**: `navigate`

#### 7. message-handler.service.ts

**RxJS Usage**: 1 subscription to all messages
**Subscription**: `vscodeService.onMessage()`

## 🎨 Migration Patterns

### Pattern 1: Simple Message Handler

**Use Case**: React to latest message of specific type

```typescript
// OLD
this.vscode
  .onMessageType('messageType')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    this.handlePayload(payload);
  });

// NEW
effect(() => {
  const message = this.vscode.latestMessageOfType('messageType')();
  if (message) {
    this.handlePayload(message.payload);
  }
});
```

### Pattern 2: Accumulating Messages

**Use Case**: Process all messages of a type

```typescript
// OLD
this.vscode.onMessageType('messageType')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    this.processItem(payload);
  });

// NEW
private readonly _lastProcessedIndex = signal(0);

effect(() => {
  const messages = this.vscode.messagesOfType('messageType')();
  const lastIndex = this._lastProcessedIndex();

  // Process only new messages
  for (let i = lastIndex; i < messages.length; i++) {
    this.processItem(messages[i].payload);
  }

  this._lastProcessedIndex.set(messages.length);
});
```

### Pattern 3: Conditional Processing

**Use Case**: Only process when certain conditions met

```typescript
// OLD
combineLatest([this.vscode.onMessageType('messageType'), this.otherService.state$])
  .pipe(
    filter(([msg, state]) => state.isReady),
    takeUntilDestroyed(this.destroyRef)
  )
  .subscribe(([msg, state]) => {
    this.process(msg, state);
  });

// NEW
effect(() => {
  const message = this.vscode.latestMessageOfType('messageType')();
  const state = this.otherService.state(); // signal

  if (message && state.isReady) {
    this.process(message.payload, state);
  }
});
```

### Pattern 4: Derived State from Messages

**Use Case**: Create computed values from message stream

```typescript
// OLD
readonly messageCount$ = this.vscode.onMessageType('messageType').pipe(
  scan((count) => count + 1, 0)
);

// NEW
readonly messageCount = computed(() => {
  return this.vscode.messagesOfType('messageType')().length;
});
```

## 🚀 Execution Plan

### Phase 1: Foundation (COMPLETED ✅)

- [x] VSCodeService signal-based message queue
- [x] Add computed signal accessors: `messagesOfType()`, `latestMessageOfType()`
- [x] Keep Observable methods for backward compatibility

### Phase 2: Critical Services

**Order**: High impact, high complexity first

1. **chat.service.ts** (~2-3 hours)

   - Replace 9 subscriptions with effects
   - Test message handling flow
   - Verify streaming state management
   - **Deliverable**: No RxJS subscriptions in chat.service.ts

2. **provider.service.ts** (~2-3 hours)
   - Remove `destroy$` Subject
   - Replace 6 subscriptions with effects
   - Convert auto-refresh to pure signal pattern
   - Test provider switching and health monitoring
   - **Deliverable**: No RxJS in provider.service.ts

### Phase 3: Session Management

3. **chat-state-manager.service.ts** (~1-2 hours)
   - Replace 4 session-related subscriptions
   - Test session list updates
   - Verify session switching
   - **Deliverable**: Signal-based session management

### Phase 4: Supporting Services

4. **file-picker.service.ts** (~30 min)
5. **webview-navigation.service.ts** (~30 min)
6. **webview-config.service.ts** (~1 hour)
7. **message-handler.service.ts** (~30 min)

### Phase 5: Cleanup & Documentation

- Remove unused RxJS imports
- Remove backward-compat Observable methods from VSCodeService
- Update service documentation
- Create migration guide for future developers

## ✅ Success Criteria

### Functional Tests

- [ ] Chat messages send/receive correctly
- [ ] Streaming responses work without loops
- [ ] Session switching preserves state
- [ ] Provider switching works
- [ ] File picker autocomplete functions
- [ ] Navigation between views works
- [ ] No console errors (especially NG0203)

### Performance Tests

- [ ] No infinite message loops
- [ ] Message processing latency < 50ms
- [ ] Memory usage stable over time
- [ ] No memory leaks from subscriptions

### Code Quality

- [ ] Zero RxJS subscriptions in services (except backward compat layer)
- [ ] All effects properly use signal dependencies
- [ ] No `any` types introduced
- [ ] Test coverage maintained or improved

## 📋 Risk Mitigation

### Risk 1: Breaking Existing Functionality

**Mitigation**:

- Migrate one service at a time
- Test thoroughly after each service migration
- Keep backward compat layer during transition

### Risk 2: Effect Timing Issues

**Mitigation**:

- Use `untracked()` where needed to prevent cascading effects
- Document effect dependencies clearly
- Test effect execution order

### Risk 3: Message Processing Gaps

**Mitigation**:

- Use message queue indexing pattern for accumulating messages
- Test with rapid message sequences
- Add logging to track message processing

## 🔧 Development Notes

### Testing Strategy

1. **Unit Tests**: Mock VSCodeService signal methods
2. **Integration Tests**: Test service interactions
3. **E2E Tests**: Full workflow testing in browser mode
4. **Manual Testing**: Verify in Extension Development Host

### Debugging Tips

- Use `effect(() => { console.log('Signal changed:', signal()); })` for debugging
- Check message queue size: `vscode.messageQueue().length`
- Verify message deduplication: Check for duplicate IDs in queue

### Common Pitfalls

- ❌ Don't call signals inside `untracked()` blocks
- ❌ Don't mutate signal values directly
- ❌ Don't create effects inside conditional blocks
- ✅ Do use computed() for derived state
- ✅ Do use effect() for side effects
- ✅ Do batch signal updates when possible

---

**Next Step**: Start with chat.service.ts migration (highest priority, most subscriptions)
