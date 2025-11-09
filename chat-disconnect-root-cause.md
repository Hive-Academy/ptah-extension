# Chat Disconnect Root Cause Analysis - TASK_INT_003

**Date**: 2025-01-17  
**Investigator**: Frontend Developer  
**Issue**: Chat messages and sessions not displayed in Angular frontend

---

## 🎯 ROOT CAUSE IDENTIFIED

**The backend and frontend are using completely different event naming conventions.**

### Backend Events (SessionManager publishes)

```typescript
// libs/backend/claude-domain/src/session/session-manager.ts

this.eventBus.publish('session:created', session);      // Line 194
this.eventBus.publish('session:switched', session);     // Line 255
this.eventBus.publish('session:deleted', { sessionId }); // Line 286
this.eventBus.publish('session:renamed', { ... });       // Line 317
this.eventBus.publish('session:updated', session);       // Line 355
this.eventBus.publish('message:added', { ... });         // Lines 425, 488
this.eventBus.publish('tokenUsage:updated', { ... });   // Lines 429, 492
this.eventBus.publish('sessions:changed', ...);          // Line 855
```

### WebviewMessageBridge Forwarding Rules

```typescript
// libs/backend/vscode-core/src/messaging/webview-message-bridge.ts:59-81

alwaysForward: [
  'chat:messageChunk',
  'chat:messageAdded', // ❌ Backend publishes 'message:added'
  'chat:messageComplete',
  'chat:streamStopped',

  'chat:sessionCreated', // ❌ Backend publishes 'session:created'
  'chat:sessionSwitched', // ❌ Backend publishes 'session:switched'
  'chat:sessionDeleted', // ❌ Backend publishes 'session:deleted'
  'chat:sessionRenamed', // ❌ Backend publishes 'session:renamed'
  'chat:sessionsUpdated', // ❌ Backend publishes 'sessions:changed'

  // ... other events
];
```

### Frontend Subscriptions (ChatService listens for)

```typescript
// libs/frontend/core/src/lib/services/chat.service.ts

// Currently listening for :response pattern (WRONG)
this.vscode.onMessageType('chat:switchSession:response'); // ❌ Never sent
this.vscode.onMessageType('chat:newSession:response'); // ❌ Never sent
this.vscode.onMessageType('chat:getHistory:response'); // ❌ Never sent

// Should be listening for events (but with WRONG names)
// Frontend expects: 'chat:sessionSwitched'
// Backend publishes: 'session:switched'
```

---

## 🔍 Event Flow Analysis

### What SHOULD Happen

1. **User switches session**:

   - Frontend calls `vscode.postStrictMessage('chat:switchSession', { sessionId })`
   - Backend handler processes request
   - SessionManager publishes `'session:switched'` event to EventBus
   - WebviewMessageBridge forwards event to webview
   - Frontend ChatService subscribes to event and updates UI

2. **User sends message**:

   - Frontend calls `vscode.postStrictMessage('chat:sendMessage', { content })`
   - Backend processes message
   - SessionManager publishes `'message:added'` event to EventBus
   - WebviewMessageBridge forwards event to webview
   - Frontend ChatService subscribes to event and adds message to UI

3. **Initial load**:
   - Backend sends `'initialData'` with current session + messages
   - Frontend ChatService processes initialData
   - UI displays messages

### What ACTUALLY Happens

1. **User switches session**:

   - ✅ Frontend sends `'chat:switchSession'` message
   - ✅ Backend handler processes request
   - ✅ SessionManager publishes `'session:switched'` event
   - ❌ WebviewMessageBridge DOES NOT forward (looking for `'chat:sessionSwitched'` but got `'session:switched'`)
   - ❌ Frontend never receives event
   - ❌ UI never updates

2. **User sends message**:

   - ✅ Frontend sends `'chat:sendMessage'` message
   - ✅ Backend processes message
   - ✅ SessionManager publishes `'message:added'` event
   - ❌ WebviewMessageBridge DOES NOT forward (looking for `'chat:messageAdded'` but got `'message:added'`)
   - ❌ Frontend never receives event
   - ❌ Message never appears in UI

3. **Initial load**:
   - ✅ Backend sends `'initialData'` with current session + messages
   - ✅ Frontend ChatService processes initialData
   - ✅ ChatService transforms messages to ProcessedClaudeMessage
   - ✅ ChatService sets claudeMessages signal
   - ⚠️ UI should display messages BUT may not due to component state issues

---

## 📋 Event Naming Mismatch Table

| What Backend Publishes | What Bridge Expects    | What Frontend Should Listen For | Status      |
| ---------------------- | ---------------------- | ------------------------------- | ----------- |
| `session:created`      | `chat:sessionCreated`  | `chat:sessionCreated`           | ❌ MISMATCH |
| `session:switched`     | `chat:sessionSwitched` | `chat:sessionSwitched`          | ❌ MISMATCH |
| `session:deleted`      | `chat:sessionDeleted`  | `chat:sessionDeleted`           | ❌ MISMATCH |
| `session:renamed`      | `chat:sessionRenamed`  | `chat:sessionRenamed`           | ❌ MISMATCH |
| `session:updated`      | ❌ NOT IN BRIDGE       | ❌ NOT SUBSCRIBED               | ❌ MISSING  |
| `sessions:changed`     | `chat:sessionsUpdated` | `chat:sessionsUpdated`          | ❌ MISMATCH |
| `message:added`        | `chat:messageAdded`    | `chat:messageAdded`             | ❌ MISMATCH |
| `tokenUsage:updated`   | ❌ NOT IN BRIDGE       | ❌ NOT SUBSCRIBED               | ❌ MISSING  |

---

## 🚨 Impact Assessment

### Critical Impact

1. **Session switching doesn't work** - Users can't switch between sessions
2. **New sessions don't appear** - Creating new session doesn't update UI
3. **Messages don't appear** - Sent messages never show up in chat
4. **Token usage not updated** - No real-time token tracking
5. **Welcome screen always shown** - UI thinks there are no messages

### Why Initial Data Works (Partially)

The `'initialData'` event IS forwarded correctly because:

1. It's in the WebviewMessageBridge `alwaysForward` list
2. Backend sends it with the correct name: `'initialData'`
3. Frontend subscribes to it correctly: `onMessageType('initialData')`

**BUT**: Even though initial messages load, the UI may not reflect them due to:

- Component not re-rendering after signal updates
- Empty state logic not checking messages correctly
- Race condition between initialization and message loading

---

## 🔧 Solution Options

### Option 1: Fix Backend Event Names (RECOMMENDED)

**Change backend to use `chat:` prefix to match MessagePayloadMap**:

```typescript
// In SessionManager (libs/backend/claude-domain/src/session/session-manager.ts)

// BEFORE
this.eventBus.publish('session:created', session);
this.eventBus.publish('session:switched', session);
this.eventBus.publish('message:added', { ... });

// AFTER
this.eventBus.publish('chat:sessionCreated', session);
this.eventBus.publish('chat:sessionSwitched', session);
this.eventBus.publish('chat:messageAdded', { ... });
```

**Pros**:

- Aligns backend with shared MessagePayloadMap types
- WebviewMessageBridge already configured correctly
- Frontend just needs to subscribe to events (not :response)
- Single source of truth for event names

**Cons**:

- Requires changing backend code
- May affect other backend subscribers (need to check)

### Option 2: Fix WebviewMessageBridge Forwarding Rules

**Change bridge to forward backend's actual event names**:

```typescript
// In WebviewMessageBridge (libs/backend/vscode-core/src/messaging/webview-message-bridge.ts)

alwaysForward: [
  'session:created', // Match backend
  'session:switched', // Match backend
  'session:deleted', // Match backend
  'message:added', // Match backend
  'sessions:changed', // Match backend
  'tokenUsage:updated', // Add missing event
  // ... keep existing events
];
```

**Then update frontend to match**:

```typescript
// In ChatService
this.vscode.onMessageType('session:switched').subscribe(...)
this.vscode.onMessageType('message:added').subscribe(...)
```

**Pros**:

- Keeps backend unchanged
- Simple fix in one place (bridge)

**Cons**:

- Diverges from MessagePayloadMap standard
- Inconsistent naming across codebase
- Two different naming conventions to maintain

### Option 3: Hybrid Approach (BEST)

**Fix backend event names AND update frontend subscriptions**:

1. **Backend**: Change SessionManager to use `chat:` prefix
2. **Frontend**: Change ChatService to subscribe to events (not :response)
3. **Bridge**: Already correct, no changes needed
4. **Shared Types**: Ensure MessagePayloadMap has all event types

**Pros**:

- Consistent naming across entire stack
- Type-safe end-to-end
- Bridge already configured correctly
- Clean architecture

**Cons**:

- Most work (backend + frontend changes)
- Need to ensure no breaking changes

---

## 📝 Detailed Fix Plan (Option 3 - Recommended)

### Step 1: Update Backend Event Names (1 hour)

**File**: `libs/backend/claude-domain/src/session/session-manager.ts`

**Changes**:

```typescript
// Line 194 - BEFORE
this.eventBus.publish('session:created', session);
// AFTER
this.eventBus.publish('chat:sessionCreated', session);

// Line 255 - BEFORE
this.eventBus.publish('session:switched', session);
// AFTER
this.eventBus.publish('chat:sessionSwitched', session);

// Line 286 - BEFORE
this.eventBus.publish('session:deleted', { sessionId });
// AFTER
this.eventBus.publish('chat:sessionDeleted', { sessionId });

// Line 317 - BEFORE
this.eventBus.publish('session:renamed', { sessionId, newName });
// AFTER
this.eventBus.publish('chat:sessionRenamed', { sessionId, newName });

// Line 355, 433, 496 - BEFORE
this.eventBus.publish('session:updated', session);
// AFTER
this.eventBus.publish('chat:sessionUpdated', session);

// Lines 425, 488 - BEFORE
this.eventBus.publish('message:added', { ... });
// AFTER
this.eventBus.publish('chat:messageAdded', { ... });

// Lines 429, 492 - BEFORE
this.eventBus.publish('tokenUsage:updated', { ... });
// AFTER
this.eventBus.publish('chat:tokenUsageUpdated', { ... });

// Line 855 - BEFORE
this.eventBus.publish('sessions:changed', ...);
// AFTER
this.eventBus.publish('chat:sessionsUpdated', ...);
```

**Testing**: Verify no other backend code subscribes to old event names

### Step 2: Update Frontend Subscriptions (1 hour)

**File**: `libs/frontend/core/src/lib/services/chat.service.ts`

**Remove** (lines 285-365):

```typescript
// ❌ REMOVE - These :response subscriptions never receive events
this.vscode.onMessageType('chat:switchSession:response');
this.vscode.onMessageType('chat:newSession:response');
this.vscode.onMessageType('chat:getHistory:response');
```

**Add** (new subscriptions):

```typescript
// ✅ ADD - Subscribe to actual events forwarded by WebviewMessageBridge

// Session lifecycle events
this.vscode
  .onMessageType('chat:sessionCreated')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload: ChatSessionCreatedPayload) => {
    this._streamState.update((state) => ({ ...state, isConnected: true }));

    if (this.validator.validateSession(payload.session).isValid) {
      this.chatState.setCurrentSession(payload.session);
      this.chatState.clearMessages(); // New session starts empty
      this.chatState.clearClaudeMessages();
      this.logger.info('New session created successfully', 'ChatService');
    }
  });

this.vscode
  .onMessageType('chat:sessionSwitched')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload: ChatSessionSwitchedPayload) => {
    this._streamState.update((state) => ({ ...state, isConnected: true }));

    if (this.validator.validateSession(payload.session).isValid) {
      this.chatState.setCurrentSession(payload.session);

      // Load messages for switched session
      if (payload.session.messages) {
        const validMessages = payload.session.messages.filter((msg) => this.validator.validateStrictMessage(msg).isValid);
        this.chatState.setMessages(validMessages);

        // Transform to ProcessedClaudeMessage for UI
        const processedMessages = validMessages.map((msg) => this.messageProcessor.convertToProcessedMessage(msg));
        this.chatState.setClaudeMessages(processedMessages);

        this.logger.info(`Session switched - loaded ${processedMessages.length} messages`, 'ChatService');
      }
    }
  });

// Message events
this.vscode
  .onMessageType('chat:messageAdded')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload: ChatMessageAddedPayload) => {
    // Validate and add message to state
    if (this.validator.validateStrictMessage(payload.message).isValid) {
      this.chatState.addMessage(payload.message);

      // Transform to ProcessedClaudeMessage for UI
      const processedMessage = this.messageProcessor.convertToProcessedMessage(payload.message);
      this.chatState.addClaudeMessage(processedMessage);

      this.logger.info('Message added to chat', 'ChatService');
    }
  });

// Token usage updates
this.vscode
  .onMessageType('chat:tokenUsageUpdated')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    // Update token usage in current session
    const currentSession = this.currentSession();
    if (currentSession && payload.sessionId === currentSession.id) {
      // TODO: Update session token usage when ChatStateService supports it
      this.logger.info('Token usage updated', 'ChatService', payload);
    }
  });

// Sessions list updated
this.vscode
  .onMessageType('chat:sessionsUpdated')
  .pipe(takeUntilDestroyed(this.destroyRef))
  .subscribe((payload) => {
    // TODO: Update available sessions list when ChatStateService supports it
    this.logger.info('Sessions list updated', 'ChatService', payload);
  });
```

### Step 3: Verify WebviewMessageBridge (No changes needed)

**File**: `libs/backend/vscode-core/src/messaging/webview-message-bridge.ts`

**Verification**: Confirm `alwaysForward` already includes:

- ✅ `'chat:messageAdded'`
- ✅ `'chat:sessionCreated'`
- ✅ `'chat:sessionSwitched'`
- ✅ `'chat:sessionDeleted'`
- ✅ `'chat:sessionRenamed'`
- ✅ `'chat:sessionsUpdated'`

**Add missing** (if not present):

```typescript
alwaysForward: [
  // ... existing events
  'chat:sessionUpdated', // Add if missing
  'chat:tokenUsageUpdated', // Add if missing
];
```

### Step 4: Update Shared Types (30 min)

**File**: `libs/shared/src/lib/types/message-payload-map.ts`

**Verify all payload types exist**:

```typescript
export interface MessagePayloadMap {
  // ... existing types

  // Session lifecycle events
  'chat:sessionCreated': ChatSessionCreatedPayload;
  'chat:sessionSwitched': ChatSessionSwitchedPayload;
  'chat:sessionDeleted': ChatSessionDeletedPayload;
  'chat:sessionRenamed': ChatSessionRenamedPayload;
  'chat:sessionUpdated': ChatSessionUpdatedPayload;
  'chat:sessionsUpdated': ChatSessionsUpdatedPayload;

  // Message events
  'chat:messageAdded': ChatMessageAddedPayload;

  // Token usage
  'chat:tokenUsageUpdated': ChatTokenUsageUpdatedPayload;
}
```

**Add missing payload types**:

```typescript
export interface ChatSessionCreatedPayload {
  session: StrictChatSession;
}

export interface ChatSessionSwitchedPayload {
  session: StrictChatSession;
}

export interface ChatSessionDeletedPayload {
  sessionId: SessionId;
}

export interface ChatSessionRenamedPayload {
  sessionId: SessionId;
  newName: string;
}

export interface ChatSessionUpdatedPayload {
  session: StrictChatSession;
}

export interface ChatSessionsUpdatedPayload {
  sessions: readonly StrictChatSession[];
}

export interface ChatMessageAddedPayload {
  message: StrictChatMessage;
  sessionId: SessionId;
}

export interface ChatTokenUsageUpdatedPayload {
  sessionId: SessionId;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    percentage: number;
  };
}
```

### Step 5: Manual Testing (1 hour)

**Test Scenarios**:

1. **Initial Load**:

   - Press F5 to launch Extension Development Host
   - Open Ptah webview
   - Check DevTools Console for:
     - ✅ `VSCodeService: Processing message type: initialData`
     - ✅ `ChatService: Loaded X messages from initial data`
     - ✅ `ChatService: Transformed X messages to ProcessedClaudeMessage`
   - **Expected**: Welcome screen if no messages, or message list if messages exist

2. **Send Message**:

   - Type message in input box
   - Click send
   - Check DevTools Console for:
     - ✅ `ChatComponent.sendMessage() called`
     - ✅ `VSCodeService: Processing message type: chat:messageAdded`
     - ✅ `ChatService: Message added to chat`
   - **Expected**: User message appears immediately, Claude response streams in

3. **Switch Session**:

   - Click session selector
   - Choose different session
   - Check DevTools Console for:
     - ✅ `VSCodeService: Processing message type: chat:sessionSwitched`
     - ✅ `ChatService: Session switched - loaded X messages`
   - **Expected**: UI clears and shows messages from selected session

4. **Create New Session**:
   - Click "New Session" button
   - Check DevTools Console for:
     - ✅ `VSCodeService: Processing message type: chat:sessionCreated`
     - ✅ `ChatService: New session created successfully`
   - **Expected**: New empty session with welcome screen

---

## ✅ Success Criteria

After implementing the fix:

- [ ] Session switching works - UI updates with selected session's messages
- [ ] New sessions appear in session selector
- [ ] Sent messages appear in chat immediately
- [ ] Token usage updates in real-time
- [ ] Welcome screen only shown when truly no messages exist
- [ ] Console shows all event subscriptions receiving data
- [ ] No more `:response` subscriptions (they never receive data)
- [ ] All event names consistent: backend → bridge → frontend

---

## 📊 Event Flow Diagram

```
USER ACTION (Switch Session)
         ↓
┌────────────────────────────────────────────────────────────────┐
│ FRONTEND (Angular)                                             │
│                                                                 │
│ ChatComponent.switchToSession(sessionId)                       │
│         ↓                                                       │
│ ChatService.switchToSession(sessionId)                         │
│         ↓                                                       │
│ vscode.postStrictMessage('chat:switchSession', {sessionId})    │
└────────────────────────────────────────────────────────────────┘
         ↓ (postMessage to extension)
┌────────────────────────────────────────────────────────────────┐
│ BACKEND (VS Code Extension)                                    │
│                                                                 │
│ MessageHandler receives 'chat:switchSession'                   │
│         ↓                                                       │
│ SessionManager.switchSession(sessionId)                        │
│         ↓                                                       │
│ eventBus.publish('chat:sessionSwitched', {session})  ✅ FIXED  │
└────────────────────────────────────────────────────────────────┘
         ↓ (EventBus)
┌────────────────────────────────────────────────────────────────┐
│ WebviewMessageBridge                                           │
│                                                                 │
│ Receives 'chat:sessionSwitched' from EventBus                  │
│         ↓                                                       │
│ Checks alwaysForward[] - ✅ FOUND                              │
│         ↓                                                       │
│ webviewManager.sendMessage('ptah.main', 'chat:sessionSwitched')│
└────────────────────────────────────────────────────────────────┘
         ↓ (postMessage to webview)
┌────────────────────────────────────────────────────────────────┐
│ FRONTEND (Angular)                                             │
│                                                                 │
│ VSCodeService receives message event                           │
│         ↓                                                       │
│ messageSubject.next('chat:sessionSwitched')                    │
│         ↓                                                       │
│ ChatService.onMessageType('chat:sessionSwitched') ✅ SUBSCRIBED│
│         ↓                                                       │
│ chatState.setCurrentSession(session)                           │
│ chatState.setMessages(session.messages)                        │
│ chatState.setClaudeMessages(processedMessages)                 │
│         ↓                                                       │
│ UI UPDATES - Messages displayed ✅                             │
└────────────────────────────────────────────────────────────────┘
```

---

**Conclusion**: The chat disconnect is caused by event naming mismatches between backend (`session:*`, `message:*`) and frontend/bridge expectations (`chat:*`). Fix by standardizing all events to use `chat:` prefix and subscribing to events (not `:response` messages).
