# State Synchronization Gaps Analysis

**Analysis Date**: 2025-01-20
**Backend State Source**: SessionManager (libs/backend/claude-domain/src/session/)
**Frontend State Source**: ChatStateService + AppStateManager (libs/frontend/core/src/lib/services/)

---

## Executive Summary

**KEY FINDING**: Backend and frontend maintain **SEPARATE state stores** with **PARTIAL synchronization**:

- **Backend**: SessionManager stores sessions in VS Code workspace state (persistent)
- **Frontend**: ChatStateService stores sessions in Angular signals (volatile - lost on webview reload)
- **Sync Mechanism**: EventBus messages (SESSION_CREATED, SESSION_UPDATED, etc.)
- **CRITICAL GAP**: Frontend doesn't restore state from backend on webview reload

**Desync Scenarios Identified**: 5 critical scenarios where backend/frontend states diverge

---

## Gap 1: Session Active State After Webview Reload

### Backend Source of Truth

**File**: `D:/projects/ptah-extension/libs/backend/claude-domain/src/session/session-manager.ts`

```typescript
// Line 208-213
getCurrentSession(): StrictChatSession | undefined {
  if (!this.currentSessionId) return undefined;
  return this.sessions.get(this.currentSessionId);
}
```

**Backend State**: Persists in VS Code workspace state (survives webview reload)

### Frontend State

**File**: `D:/projects/ptah-extension/libs/frontend/core/src/lib/services/chat-state.service.ts`

```typescript
// Frontend stores current session in signal
private readonly _currentSession = signal<StrictChatSession | null>(null);
```

**Frontend State**: Volatile - cleared when webview is closed/reloaded

### Desync Scenario

1. User creates session "Project Analysis"
2. Backend saves to workspace state ✅
3. Frontend updates `_currentSession` signal ✅
4. **User closes/reloads webview** (e.g., switches tabs, reloads VS Code)
5. **Frontend signal reset to null** ❌
6. **Backend still has "Project Analysis" as current session** ✅
7. **RESULT**: Frontend shows no active session, backend thinks session is active

### Evidence

**App.ngOnInit()** (apps/ptah-extension-webview/src/app/app.ts, line 73):

```typescript
// Line 73: Requests initial data
this.vscodeService.postStrictMessage(VIEW_MESSAGE_TYPES.CHANGED, { view: 'chat' });
```

**Problem**: Frontend requests initial data via `VIEW_MESSAGE_TYPES.CHANGED`, but this is a NAVIGATION message, NOT a state restoration message.

**Missing**: No `requestInitialData` or `state:load` message to restore sessions from backend

### Impact

- **User Experience**: Opens webview, sees empty chat (no sessions listed)
- **Data Loss Risk**: User thinks sessions were deleted
- **Workaround**: Create new session → Backend loads existing session from storage

### Recommendation

```typescript
// In App.ngOnInit():
ngOnInit(): void {
  // ADD:
  this.vscodeService.postStrictMessage(SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA, {});

  // Backend should respond with:
  // { sessions: [...], currentSessionId, workspaceInfo, config }
}
```

---

## Gap 2: Message History Lost on Webview Reload

### Backend Source of Truth

**SessionManager.getSession()** returns full session with message history:

```typescript
// Line 221-223
getSession(sessionId: SessionId): StrictChatSession | undefined {
  return this.sessions.get(sessionId); // Includes messages[] array
}
```

### Frontend State

**ChatStateService** maintains separate messages array:

```typescript
private readonly _messages = signal<readonly StrictChatMessage[]>([]);
```

### Desync Scenario

1. User has 50 messages in session
2. Backend stores all 50 in workspace state ✅
3. Frontend displays all 50 in ChatMessagesContainerComponent ✅
4. **User reloads webview**
5. **Frontend `_messages` signal reset to []** ❌
6. **Backend still has all 50 messages** ✅
7. **RESULT**: User sees empty chat despite backend having message history

### Impact

- **User Experience**: All chat history appears lost on reload
- **Data Loss Perception**: User panics, thinks conversations deleted
- **Actual State**: Messages exist in backend, just not loaded to frontend

### Recommendation

```typescript
// In ChatService or ChatStateService initialization:
async loadInitialState(): Promise<void> {
  const response = await this.vscode.requestInitialData();
  if (response.currentSession) {
    this._messages.set(response.currentSession.messages); // Restore messages
    this._currentSession.set(response.currentSession);
  }
}
```

---

## Gap 3: Backend Session Ends Unexpectedly, Frontend Unaware

### Backend Event

**ClaudeDomainEventPublisher.publishSessionEnd()** (claude-domain.events.ts, line 203-204):

```typescript
publishSessionEnd(sessionId: SessionId, cliSessionId: string, reason?: string): void {
  this.eventBus.publish<ClaudeSessionEndEvent>(
    CHAT_MESSAGE_TYPES.SESSION_END,
    { sessionId, cliSessionId, reason, timestamp: Date.now() }
  );
}
```

### Frontend Listener

**ChatService**: ❌ **NO LISTENER** for `chat:sessionEnd`

### Desync Scenario

1. User sends message, Claude CLI starts processing
2. **CLI process crashes** (out of memory, killed by OS, network timeout)
3. Backend detects crash, publishes `chat:sessionEnd` ✅
4. **Frontend never receives event** ❌
5. **Frontend still shows isStreaming = true** ❌
6. **User waits forever for response**

### Impact

- **User Experience**: Infinite loading state, no response
- **UI Stuck**: ChatStreamingStatusComponent shows "Claude is responding..." indefinitely
- **Workaround**: User must reload webview to reset state

### Recommendation

```typescript
// In ChatService constructor:
this.vscode.onMessageType('chat:sessionEnd').subscribe((payload) => {
  this._streamState.update((state) => ({ ...state, isStreaming: false }));
  this.logger.error('Claude session ended', 'ChatService', {
    reason: payload.reason,
  });
  // Show error notification to user
});
```

---

## Gap 4: Token Usage Desync (Backend vs Frontend)

### Backend Calculation

**SessionManager.addMessage()** (session-manager.ts, line 424-425):

```typescript
// Line 424: Backend publishes TOKEN_USAGE_UPDATED
this.eventBus.publish(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED, {
  sessionId: session.id,
  tokenUsage: {
    input: session.tokenUsage.input,
    output: session.tokenUsage.output,
    total: session.tokenUsage.total,
    percentage: session.tokenUsage.percentage,
    maxTokens: session.tokenUsage.maxTokens,
  },
});
```

### Frontend Display

**ChatTokenUsageComponent** receives tokenUsage from ChatComponent.tokenUsage() computed signal (chat.component.ts, line 360-368):

```typescript
readonly tokenUsage = computed((): TokenUsage | null => {
  const session = this.currentSession();
  if (!session?.tokenUsage) return null;

  return {
    used: session.tokenUsage.input + session.tokenUsage.output,
    total: session.tokenUsage.total,
    percentage: session.tokenUsage.percentage
  };
});
```

### Desync Scenario

1. Backend calculates token usage from message content length
2. Backend publishes `TOKEN_USAGE_UPDATED` event ✅
3. **Frontend doesn't update `currentSession()` signal with new tokenUsage** ❌
4. **Frontend continues showing old token count** ❌

### Verification Needed

- Check if ChatService updates currentSession() when TOKEN_USAGE_UPDATED is received
- Confirm ChatStateService.currentSession() is mutable or replaced entirely

### Impact

- **User Experience**: Token usage progress bar shows stale values
- **Cost Tracking**: User doesn't know actual token consumption
- **Rate Limiting**: User unaware of approaching context limit

---

## Gap 5: Provider Health Status (Pull vs Event-Driven)

### Backend Health Monitoring

**ClaudeDomainEventPublisher.publishHealthUpdate()** (claude-domain.events.ts, line 213-214):

```typescript
publishHealthUpdate(health: ProviderHealth): void {
  this.eventBus.publish<ClaudeHealthUpdateEvent>(
    CHAT_MESSAGE_TYPES.HEALTH_UPDATE,
    { health, timestamp: Date.now() }
  );
}
```

### Frontend State

**ProviderService**: ❌ **NO LISTENER** for `chat:healthUpdate`

**SettingsViewComponent** (settings-view.component.ts, line 60):

```typescript
constructor() {
  // PULL model: Frontend requests data manually
  this.providerService.refreshProviders();
}
```

### Desync Scenario

1. Backend detects Claude CLI health degradation (slow responses, errors)
2. Backend publishes `chat:healthUpdate` event ✅
3. **Frontend doesn't listen** ❌
4. **User still sees "Online" status in ChatHeaderComponent** ❌
5. **User sends message, waits 30 seconds, gets timeout**
6. **User confused - UI said provider was online**

### Impact

- **User Experience**: Misleading provider status
- **Wasted Time**: User attempts to use offline provider
- **No Proactive Alerts**: User not warned before provider fails

### Recommendation

```typescript
// In ProviderService:
this.vscode.onMessageType('chat:healthUpdate').subscribe((payload) => {
  this.providerHealth.update((healthMap) => {
    const updated = new Map(healthMap);
    updated.set(payload.health.providerId, payload.health);
    return updated;
  });
});
```

---

## Summary Table: Synchronization Gaps

| Gap                    | Backend State | Frontend State    | Sync Mechanism                 | Impact |
| ---------------------- | ------------- | ----------------- | ------------------------------ | ------ |
| Session after reload   | ✅ Persistent | ❌ Lost           | ❌ No restoration              | HIGH   |
| Message history reload | ✅ Saved      | ❌ Lost           | ❌ No restoration              | HIGH   |
| CLI session end        | ✅ Detects    | ❌ Not notified   | ❌ No listener                 | HIGH   |
| Token usage updates    | ✅ Calculated | ⚠️ Delayed update | ⚠️ Event may not update signal | MEDIUM |
| Provider health        | ✅ Monitors   | ❌ Not notified   | ❌ Pull model                  | MEDIUM |

---

## Critical Findings

### 1. **NO STATE RESTORATION ON WEBVIEW RELOAD** (HIGH IMPACT)

**Evidence**:

- App.ngOnInit() sends `VIEW_MESSAGE_TYPES.CHANGED`, not `REQUEST_INITIAL_DATA`
- No backend handler to send initial state (sessions, messages, config)
- Frontend signals reset to default values on every reload

**Impact**: **CRITICAL** - User loses all chat context on webview reload (switching tabs, VS Code restart)

### 2. **MISSING EVENT LISTENERS** (3 critical events)

**Frontend doesn't listen for**:

- `chat:sessionEnd` → Silent CLI crashes
- `chat:healthUpdate` → Stale provider status
- `chat:sessionInit` → No CLI capabilities shown

**Impact**: **HIGH** - User has NO visibility into backend state changes

### 3. **PULL MODEL FOR PROVIDERS** (Inconsistent Architecture)

**Chat/Sessions**: Event-driven (backend pushes updates) ✅
**Providers**: Pull model (frontend manually refreshes) ❌

**Impact**: **MEDIUM** - Provider UI lags behind actual backend state

---

## Recommendations (Priority Order)

### 1. CRITICAL: Implement State Restoration Protocol

**Backend**:

```typescript
// In MessageHandlerService:
this.eventBus.subscribe(SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA)
  .subscribe(async (event) => {
    const currentSession = this.sessionManager.getCurrentSession();
    const allSessions = this.sessionManager.getAllSessions();
    const workspaceInfo = /* get workspace info */;

    this.eventBus.publish(SYSTEM_MESSAGE_TYPES.INITIAL_DATA, {
      currentSession,
      sessions: allSessions,
      workspaceInfo,
      config: /* current config */
    });
  });
```

**Frontend**:

```typescript
// In App.ngOnInit():
this.vscodeService.postStrictMessage(SYSTEM_MESSAGE_TYPES.REQUEST_INITIAL_DATA, {});

// In AppStateManager or ChatService:
this.vscode.onMessageType('initialData').subscribe((payload) => {
  this.chatState.restoreState(payload);
  this.appState.setWorkspaceInfo(payload.workspaceInfo);
});
```

### 2. HIGH: Add Missing Event Listeners

**ChatService**:

```typescript
// Add to constructor:
this.vscode.onMessageType('chat:sessionEnd').subscribe(this.handleSessionEnd.bind(this));
this.vscode.onMessageType('chat:healthUpdate').subscribe(this.handleHealthUpdate.bind(this));
this.vscode.onMessageType('chat:sessionInit').subscribe(this.handleSessionInit.bind(this));
```

### 3. MEDIUM: Convert Provider Management to Event-Driven

**Backend**:

```typescript
// ProviderOrchestrationService should emit:
this.eventBus.publish('providers:currentChanged', { providerId, provider });
this.eventBus.publish('providers:healthChanged', { providerId, health });
```

**Frontend**:

```typescript
// ProviderService should listen:
this.vscode.onMessageType('providers:currentChanged').subscribe(/* update */);
this.vscode.onMessageType('providers:healthChanged').subscribe(/* update */);
```

---

**Conclusion**: The PTAH extension has **CRITICAL state synchronization gaps**. Frontend loses all state on webview reload because there's NO state restoration protocol. Backend emits important lifecycle events (`sessionEnd`, `healthUpdate`) but frontend doesn't listen. User experiences data loss perception, stale UI status, and silent failures. **Immediate fix required**: Implement REQUEST_INITIAL_DATA / INITIAL_DATA message pair for state restoration on webview init.
