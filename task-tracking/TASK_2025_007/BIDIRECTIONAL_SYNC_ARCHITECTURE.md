# Bidirectional Synchronization Architecture

## Document Metadata

- **Task**: TASK_2025_007
- **Created**: 2025-11-19
- **Author**: software-architect
- **Status**: Architecture Design
- **Version**: 1.0

---

## Executive Summary

This document defines a comprehensive bidirectional synchronization architecture for the Ptah extension, ensuring seamless communication between Angular UI, VS Code Webview, Claude CLI backend, and the EventBus messaging system. The architecture eliminates duplicate event processing, prevents side effects, maintains state consistency, and provides automatic error recovery.

**Key Design Principles**:

1. **Single Source of Truth (SSOT)**: Backend is authoritative for sessions/messages, frontend mirrors state
2. **Command-Event Separation**: Frontend sends commands (intent), backend publishes events (facts)
3. **Correlation-Based Tracking**: Every command generates events with matching correlation IDs
4. **Idempotent Processing**: Safe to process same event multiple times
5. **Automatic Reconciliation**: Periodic state sync on errors or connection recovery

---

## 1. Architecture Overview

### 1.1 Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ANGULAR WEBVIEW                          │
│  ┌───────────────────────────────────────────────────────┐     │
│  │            Frontend State (Mirror of Backend)          │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  AppStateManager (UI State - Frontend SSOT)     │  │     │
│  │  │  - currentView, isLoading, workspaceInfo        │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  ChatStateService (Session/Message Mirror)      │  │     │
│  │  │  - messages[], currentSession, streamState      │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  └───────────────────────────────────────────────────────┘     │
│  ┌───────────────────────────────────────────────────────┐     │
│  │              Synchronization Services                  │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  StateSyncService (NEW)                         │  │     │
│  │  │  - Periodic reconciliation, version tracking    │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  EventDeduplicationService (NEW)                │  │     │
│  │  │  - Time-window dedup, idempotency keys         │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  CommandBus (NEW)                               │  │     │
│  │  │  - Send commands, await acknowledgments         │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  └───────────────────────────────────────────────────────┘     │
│                            ▲ │                                  │
│                    Events  │ │ Commands                         │
│                            │ ▼                                  │
│  ┌───────────────────────────────────────────────────────┐     │
│  │              VSCodeService (Transport)                 │     │
│  │  - postMessage() / onMessage()                         │     │
│  └───────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
                            ▲ │
                    Events  │ │ Commands
                            │ ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VS CODE EXTENSION HOST                       │
│  ┌───────────────────────────────────────────────────────┐     │
│  │              WebviewMessageBridge                      │     │
│  │  - Forward events to webview                           │     │
│  │  - Forward commands to backend                         │     │
│  └───────────────────────────────────────────────────────┘     │
│                            ▲ │                                  │
│                            │ ▼                                  │
│  ┌───────────────────────────────────────────────────────┐     │
│  │                    EventBus (RxJS)                     │     │
│  │  - Pub/sub messaging, correlation tracking            │     │
│  └───────────────────────────────────────────────────────┘     │
│                            ▲ │                                  │
│                            │ ▼                                  │
│  ┌───────────────────────────────────────────────────────┐     │
│  │         Backend State (SSOT for Sessions/Messages)     │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  SessionManager (Backend SSOT)                  │  │     │
│  │  │  - sessions Map, currentSessionId               │  │     │
│  │  │  - CRUD operations, persistence                 │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  ClaudeCliService (CLI Integration)             │  │     │
│  │  │  - Process spawning, JSONL parsing              │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  │  ┌─────────────────────────────────────────────────┐  │     │
│  │  │  ChatOrchestrationService (Workflow Logic)      │  │     │
│  │  │  - Command handling, event publishing           │  │     │
│  │  └─────────────────────────────────────────────────┘  │     │
│  └───────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Single Source of Truth (SSOT) Assignments

| **State Domain**              | **SSOT Location**             | **Frontend Role**     | **Sync Strategy**        |
| ----------------------------- | ----------------------------- | --------------------- | ------------------------ |
| Sessions (list, metadata)     | Backend SessionManager        | Mirror (read-only)    | Event-driven updates     |
| Messages (content, chunks)    | Backend SessionManager        | Mirror (read-only)    | Event-driven updates     |
| Session selection (current)   | Backend SessionManager        | Mirror (read-only)    | Command → Event → Update |
| Streaming state (isStreaming) | Backend ClaudeCliService      | Mirror (read-only)    | Event-driven updates     |
| Thinking indicators           | Backend ClaudeCliService      | Mirror (read-only)    | Event-driven updates     |
| Tool executions               | Backend ClaudeCliService      | Mirror (read-only)    | Event-driven updates     |
| Permission requests           | Backend PermissionService     | Mirror (read-only)    | Event-driven updates     |
| UI State (view, loading)      | Frontend AppStateManager      | Frontend SSOT (write) | Local state only         |
| Provider selection            | Backend ProviderOrchestration | Mirror (read-only)    | Command → Event → Update |

**SSOT Principle**: Backend owns all domain data (sessions, messages, streaming). Frontend owns only UI-specific transient state (currentView, isLoading).

---

## 2. Event Flow Patterns

### 2.1 Command Pattern (Frontend → Backend)

**Commands represent user intent** - they request backend actions but do not directly modify state.

```typescript
// Command Structure
interface Command<T extends keyof MessagePayloadMap> {
  readonly type: T; // e.g., 'chat:sendMessage'
  readonly payload: MessagePayloadMap[T];
  readonly correlationId: CorrelationId; // Links command to events
  readonly timestamp: number;
}

// Frontend sends command
commandBus.send('chat:sendMessage', {
  content: 'Hello',
  sessionId,
  correlationId: CorrelationId.create(),
});

// Backend processes command
chatOrchestration.handleSendMessage(payload) {
  // 1. Validate command
  // 2. Execute business logic (add to SessionManager)
  // 3. Publish events (messageAdded, messageChunk, messageComplete)
}
```

**Command Types** (Frontend → Backend):

- `chat:sendMessage` → Send user message to Claude
- `chat:switchSession` → Switch active session
- `chat:newSession` → Create new session
- `chat:deleteSession` → Delete session
- `chat:stopGeneration` → Cancel streaming
- `chat:permissionResponse` → User permission decision
- `providers:switch` → Switch AI provider
- `context:includeFile` → Include file in context

### 2.2 Event Pattern (Backend → Frontend)

**Events represent facts** - they announce state changes that have already occurred.

```typescript
// Event Structure
interface Event<T extends keyof MessagePayloadMap> {
  readonly type: T; // e.g., 'chat:messageAdded'
  readonly payload: MessagePayloadMap[T];
  readonly correlationId: CorrelationId; // Links to original command
  readonly source: 'extension'; // Always from backend
  readonly timestamp: number;
}

// Backend publishes event
eventBus.publish('chat:messageAdded', {
  message: { id, content, type: 'assistant', ... },
  sessionId,
});

// Frontend consumes event
stateSyncService.onEvent('chat:messageAdded', (payload) => {
  // Update local mirror state
  chatState.addMessage(payload.message);
});
```

**Event Types** (Backend → Frontend):

- `chat:messageAdded` → New message created
- `chat:messageChunk` → Streaming chunk received
- `chat:messageComplete` → Streaming finished
- `chat:thinking` → Claude is thinking
- `chat:toolStart` → Tool execution started
- `chat:toolResult` → Tool execution completed
- `chat:sessionCreated` → New session created
- `chat:sessionSwitched` → Active session changed
- `chat:sessionsUpdated` → Session list updated
- `providers:switched` → Provider changed
- `providers:healthUpdate` → Provider health status

### 2.3 Correlation ID Protocol

**Every command generates a unique correlation ID** that links it to all resulting events.

```typescript
// Frontend: Send command
const correlationId = CorrelationId.create();
commandBus.send('chat:sendMessage', {
  content: 'Explain async/await',
  correlationId,
});

// Backend: Process command, publish events with same correlationId
chatOrchestration.handleSendMessage(payload) {
  const { correlationId } = payload;

  // Event 1: Message added
  eventBus.publish('chat:messageAdded', {
    message: assistantMessage,
    correlationId, // SAME ID
  });

  // Event 2: Thinking started
  eventBus.publish('chat:thinking', {
    content: 'Analyzing async patterns...',
    correlationId, // SAME ID
  });

  // Event 3-N: Message chunks
  for (const chunk of stream) {
    eventBus.publish('chat:messageChunk', {
      chunk: chunk.content,
      messageId: assistantMessage.id,
      correlationId, // SAME ID
    });
  }

  // Event N+1: Message complete
  eventBus.publish('chat:messageComplete', {
    messageId: assistantMessage.id,
    correlationId, // SAME ID
  });
}
```

**Benefits**:

1. **Traceability**: Frontend can track which events resulted from which commands
2. **Debugging**: Log all events for a specific user action
3. **Request-Response Mapping**: Know when a command is fully processed
4. **Deduplication**: Detect duplicate events by correlationId + eventType

---

## 3. State Management Strategy

### 3.1 Backend SSOT (SessionManager)

**Source**: `libs/backend/claude-domain/src/session/session-manager.ts`

```typescript
@injectable()
export class SessionManager {
  // SSOT: In-memory state
  private sessions: Map<SessionId, StrictChatSession> = new Map();
  private currentSessionId?: SessionId;
  private claudeSessionIds = new Map<SessionId, string>();

  // SSOT operations
  async createSession(options): Promise<StrictChatSession> {
    const session = { id, name, messages: [], ... };
    this.sessions.set(session.id, session);
    this.currentSessionId = session.id;

    // Persist to disk
    await this.saveSessions();

    // Notify frontend
    this.eventBus.publish('chat:sessionCreated', { session });
    this.eventBus.publish('chat:sessionsUpdated', {
      sessions: this.getAllSessions(),
    });

    return session;
  }

  async addMessage(sessionId, message): Promise<void> {
    const session = this.sessions.get(sessionId);
    session.messages.push(message);
    session.lastActiveAt = Date.now();

    // Update tokens
    session.tokenUsage.total += message.tokenCount || 0;

    // Persist
    await this.saveSessions();

    // Notify frontend
    this.eventBus.publish('chat:messageAdded', { message, sessionId });
  }

  async switchSession(sessionId): Promise<boolean> {
    this.currentSessionId = sessionId;
    await this.saveSessions();

    // Notify frontend
    this.eventBus.publish('chat:sessionSwitched', {
      sessionId,
      session: this.sessions.get(sessionId),
    });

    return true;
  }
}
```

**SSOT Guarantees**:

- All writes go through SessionManager methods
- All state changes publish events
- Persistence happens synchronously (no stale state on crash)
- Frontend cannot directly modify sessions/messages

### 3.2 Frontend Mirror (ChatStateService)

**Source**: `libs/frontend/core/src/lib/services/chat-state.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class ChatStateService {
  // Mirror state (READ-ONLY from backend)
  private readonly _messages = signal<readonly StrictChatMessage[]>([]);
  private readonly _currentSession = signal<StrictChatSession | null>(null);
  private readonly _allSessions = signal<readonly StrictChatSession[]>([]);

  // Public readonly signals
  readonly messages = this._messages.asReadonly();
  readonly currentSession = this._currentSession.asReadonly();
  readonly allSessions = this._allSessions.asReadonly();

  // Event handlers (called by StateSyncService)
  onMessageAdded(payload: ChatMessageAddedPayload): void {
    // Validate event
    if (!this.validator.validateMessage(payload.message)) {
      console.error('[ChatStateService] Invalid message, ignoring');
      return;
    }

    // Update mirror state
    const current = this._messages();
    this._messages.set([...current, payload.message]);

    // Update current session if it's the active one
    const session = this._currentSession();
    if (session?.id === payload.sessionId) {
      this._currentSession.set({
        ...session,
        messages: [...session.messages, payload.message],
        messageCount: session.messageCount + 1,
      });
    }
  }

  onSessionSwitched(payload: ChatSessionSwitchedPayload): void {
    this._currentSession.set(payload.session);
    this._messages.set(payload.session.messages);
  }

  onSessionsUpdated(payload: ChatSessionsUpdatedPayload): void {
    this._allSessions.set(payload.sessions);
  }
}
```

**Mirror Principles**:

1. **Read-Only Signals**: Frontend components can only read state via signals
2. **Event-Driven Updates**: State only changes via backend events
3. **No Local Mutations**: Frontend never directly modifies sessions/messages
4. **Validation**: All incoming events validated before updating state
5. **Optimistic Updates**: Optional for better UX (reverted on failure)

### 3.3 UI State (Frontend SSOT)

**Source**: `libs/frontend/core/src/lib/services/app-state.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class AppStateManager {
  // Frontend owns these states
  private readonly _currentView = signal<ViewType>('chat');
  private readonly _isLoading = signal(false);
  private readonly _errorMessage = signal<string | null>(null);

  // Public API
  readonly currentView = this._currentView.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly errorMessage = this._errorMessage.asReadonly();

  // Mutations (frontend-only, no backend sync)
  setCurrentView(view: ViewType): void {
    this._currentView.set(view);
  }

  setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }

  setError(message: string | null): void {
    this._errorMessage.set(message);
  }
}
```

**UI State Characteristics**:

- **Transient**: Does not persist across sessions
- **Frontend-Only**: Backend never needs to know about UI state
- **No Sync**: Changes do not generate commands or events
- **Derived**: Often computed from backend state (e.g., `isLoading = isStreaming()`)

---

## 4. Message Bus Architecture

### 4.1 CommandBus (Frontend → Backend)

**New Service**: `libs/frontend/core/src/lib/services/command-bus.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class CommandBus {
  private readonly vscode = inject(VSCodeService);
  private readonly logger = inject(LoggingService);

  // Pending commands awaiting acknowledgment
  private readonly pendingCommands = new Map<
    CorrelationId,
    {
      command: Command;
      resolve: (ack: Acknowledgment) => void;
      reject: (error: Error) => void;
      timeout: NodeJS.Timeout;
    }
  >();

  /**
   * Send command to backend with acknowledgment tracking
   *
   * @param type - Command type
   * @param payload - Command payload (without correlationId)
   * @param options - Timeout, retry options
   * @returns Promise that resolves when backend acknowledges command
   */
  async send<T extends keyof MessagePayloadMap>(type: T, payload: Omit<MessagePayloadMap[T], 'correlationId'>, options: CommandOptions = {}): Promise<Acknowledgment> {
    const correlationId = CorrelationId.create();
    const timeout = options.timeout ?? 5000;

    const command: Command<T> = {
      type,
      payload: { ...payload, correlationId } as MessagePayloadMap[T],
      correlationId,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutHandle = setTimeout(() => {
        this.pendingCommands.delete(correlationId);
        reject(new Error(`Command timeout after ${timeout}ms: ${type}`));
      }, timeout);

      // Track pending command
      this.pendingCommands.set(correlationId, {
        command,
        resolve,
        reject,
        timeout: timeoutHandle,
      });

      // Send to backend via VS Code message passing
      this.vscode.postStrictMessage(type, command.payload);

      this.logger.debug(`[CommandBus] Sent command: ${type}`, {
        correlationId,
        type,
      });
    });
  }

  /**
   * Handle acknowledgment from backend
   * Called by StateSyncService when ack events arrive
   */
  handleAcknowledgment(ack: Acknowledgment): void {
    const pending = this.pendingCommands.get(ack.correlationId);
    if (!pending) {
      this.logger.warn('[CommandBus] Received ack for unknown command', ack);
      return;
    }

    clearTimeout(pending.timeout);
    this.pendingCommands.delete(ack.correlationId);

    if (ack.success) {
      pending.resolve(ack);
      this.logger.debug('[CommandBus] Command acknowledged', ack);
    } else {
      pending.reject(new Error(ack.error?.message || 'Command failed'));
      this.logger.error('[CommandBus] Command failed', ack);
    }
  }
}

interface Acknowledgment {
  readonly correlationId: CorrelationId;
  readonly success: boolean;
  readonly error?: { code: string; message: string };
  readonly timestamp: number;
}

interface CommandOptions {
  timeout?: number; // Default: 5000ms
  retry?: boolean; // Default: false
  retryCount?: number; // Default: 3
  retryDelay?: number; // Default: 1000ms
}
```

**Backend Command Handler** (in ChatOrchestrationService):

```typescript
async handleSendMessage(payload: ChatSendMessagePayload): Promise<void> {
  const { correlationId } = payload;

  try {
    // Validate command
    if (!payload.content || payload.content.trim().length === 0) {
      throw new Error('Message content cannot be empty');
    }

    // Send acknowledgment immediately (command received)
    this.eventBus.publish('system:commandAck', {
      correlationId,
      success: true,
      timestamp: Date.now(),
    });

    // Execute business logic
    await this.sessionManager.addMessage(payload.sessionId, {
      id: MessageId.create(),
      type: 'user',
      content: payload.content,
      timestamp: Date.now(),
    });

    // Invoke Claude CLI (async streaming)
    await this.claudeCliService.sendMessage(
      payload.sessionId,
      payload.content
    );
  } catch (error) {
    // Send error acknowledgment
    this.eventBus.publish('system:commandAck', {
      correlationId,
      success: false,
      error: {
        code: 'SEND_MESSAGE_FAILED',
        message: error.message,
      },
      timestamp: Date.now(),
    });

    throw error;
  }
}
```

### 4.2 EventBus (Backend → Frontend)

**Existing Service**: `libs/backend/vscode-core/src/messaging/event-bus.ts`

```typescript
@injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();

  /**
   * Publish event to all subscribers
   */
  publish<T extends keyof MessagePayloadMap>(type: T, payload: MessagePayloadMap[T], source: 'extension' | 'webview' | 'provider' = 'extension'): void {
    const event: TypedEvent<T> = {
      type,
      payload,
      source,
      timestamp: Date.now(),
      correlationId: 'correlationId' in payload ? payload.correlationId : CorrelationId.create(),
    };

    // Emit typed event
    this.emitter.emit(type as string, event);

    // Emit wildcard for logging/debugging
    this.emitter.emit('*', event);
  }

  /**
   * Subscribe to events of specific type
   */
  subscribe<T extends keyof MessagePayloadMap>(messageType: T): Observable<TypedEvent<T>> {
    return fromEvent<TypedEvent<T>>(this.emitter, messageType as string);
  }

  /**
   * Subscribe to all events (for debugging)
   */
  subscribeToAll(): Observable<TypedEvent> {
    return fromEvent<TypedEvent>(this.emitter, '*');
  }
}
```

**WebviewMessageBridge** (forwards events to webview):

```typescript
@injectable()
export class WebviewMessageBridge {
  constructor(
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewManager
  ) {
    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    // Forward ALL backend events to webview
    this.eventBus.subscribeToAll().subscribe((event) => {
      // Skip internal events not meant for webview
      if (event.type.startsWith('internal:')) {
        return;
      }

      // Forward to webview via postMessage
      this.webviewManager.sendMessage('ptah.main', event.type, event.payload);
    });
  }
}
```

---

## 5. Deduplication Strategy

### 5.1 EventDeduplicationService

**New Service**: `libs/frontend/core/src/lib/services/event-deduplication.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class EventDeduplicationService {
  // Time-window cache: Map<eventKey, lastSeenTimestamp>
  private readonly seenEvents = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 1000; // 1 second
  private readonly MAX_CACHE_SIZE = 1000;

  /**
   * Check if event is a duplicate within time window
   */
  isDuplicate(event: StrictMessage): boolean {
    const key = this.getEventKey(event);
    const lastSeen = this.seenEvents.get(key);
    const now = Date.now();

    // Same event within 1 second = duplicate
    if (lastSeen && now - lastSeen < this.DEDUP_WINDOW_MS) {
      console.debug('[EventDedup] Duplicate event ignored:', key);
      return true;
    }

    // Update last seen timestamp
    this.seenEvents.set(key, now);

    // Cleanup old entries
    this.cleanup(now);

    return false;
  }

  /**
   * Generate unique key for event
   * Format: "type:correlationId:payloadHash"
   */
  private getEventKey(event: StrictMessage): string {
    const correlationId = 'correlationId' in event.payload ? event.payload.correlationId : '';
    const payloadHash = this.hashPayload(event.payload);
    return `${event.type}:${correlationId}:${payloadHash}`;
  }

  /**
   * Hash payload for deduplication (simple implementation)
   */
  private hashPayload(payload: unknown): string {
    // Use JSON stringify for simple hash (good enough for dedup)
    const json = JSON.stringify(payload);
    return json.length.toString(36) + json.slice(0, 10);
  }

  /**
   * Cleanup old entries to prevent memory leak
   */
  private cleanup(now: number): void {
    if (this.seenEvents.size < this.MAX_CACHE_SIZE) return;

    // Remove entries older than 5 minutes
    for (const [key, timestamp] of this.seenEvents.entries()) {
      if (now - timestamp > 300000) {
        this.seenEvents.delete(key);
      }
    }
  }

  /**
   * Clear all deduplication state (for testing)
   */
  clear(): void {
    this.seenEvents.clear();
  }
}
```

### 5.2 Idempotency Protocol

**Backend services must be idempotent** - safe to process same command multiple times:

```typescript
// Example: addMessage is idempotent via message ID
async addMessage(sessionId: SessionId, message: StrictChatMessage): Promise<void> {
  const session = this.sessions.get(sessionId);

  // Check if message already exists (idempotency)
  const exists = session.messages.some((m) => m.id === message.id);
  if (exists) {
    console.debug('[SessionManager] Message already exists, skipping', message.id);
    return; // NO-OP
  }

  // Add message
  session.messages.push(message);
  await this.saveSessions();

  // Publish event (even if duplicate - frontend will deduplicate)
  this.eventBus.publish('chat:messageAdded', { message, sessionId });
}
```

**Idempotency Keys**:

- **Messages**: `MessageId` (UUID v4)
- **Sessions**: `SessionId` (UUID v4)
- **Tool Executions**: `toolCallId`
- **Permission Requests**: `requestId`
- **Events**: `correlationId + timestamp`

---

## 6. Error Handling & Recovery

### 6.1 Connection Loss Detection

**Frontend Detection**:

```typescript
@Injectable({ providedIn: 'root' })
export class ConnectionMonitorService {
  private readonly vscode = inject(VSCodeService);
  private readonly _isConnected = signal(true);
  readonly isConnected = this._isConnected.asReadonly();

  private lastMessageTime = 0;
  private readonly HEARTBEAT_INTERVAL = 5000; // 5 seconds
  private readonly CONNECTION_TIMEOUT = 15000; // 15 seconds

  constructor() {
    this.startHeartbeat();
    this.monitorMessages();
  }

  private startHeartbeat(): void {
    setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageTime;

      if (timeSinceLastMessage > this.CONNECTION_TIMEOUT) {
        if (this._isConnected()) {
          this._isConnected.set(false);
          console.error('[ConnectionMonitor] Connection lost');
          this.attemptReconnection();
        }
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private monitorMessages(): void {
    this.vscode.onMessage().subscribe(() => {
      this.lastMessageTime = Date.now();

      if (!this._isConnected()) {
        this._isConnected.set(true);
        console.info('[ConnectionMonitor] Connection restored');
        this.triggerReconciliation();
      }
    });
  }

  private attemptReconnection(): void {
    // Request backend to send heartbeat
    this.vscode.postStrictMessage('system:ping', {});
  }

  private triggerReconciliation(): void {
    // Request full state resync from backend
    this.vscode.postStrictMessage('system:requestFullState', {});
  }
}
```

### 6.2 State Drift Detection

**Version Vector Approach**:

```typescript
// Backend tracks state version
export class SessionManager {
  private stateVersion = 0; // Incremented on every mutation

  async addMessage(...): Promise<void> {
    // ... add message logic
    this.stateVersion++; // Increment version

    // Include version in events
    this.eventBus.publish('chat:messageAdded', {
      message,
      sessionId,
      stateVersion: this.stateVersion,
    });
  }
}

// Frontend tracks expected version
@Injectable({ providedIn: 'root' })
export class StateSyncService {
  private expectedStateVersion = 0;

  onEvent(event: TypedEvent): void {
    const { stateVersion } = event.payload;

    // Check for version mismatch (state drift)
    if (stateVersion && stateVersion !== this.expectedStateVersion + 1) {
      console.warn('[StateSyncService] State drift detected', {
        expected: this.expectedStateVersion + 1,
        received: stateVersion,
      });

      this.requestFullReconciliation();
    }

    this.expectedStateVersion = stateVersion || this.expectedStateVersion + 1;

    // Process event normally
    this.processEvent(event);
  }

  private requestFullReconciliation(): void {
    this.vscode.postStrictMessage('system:requestFullState', {});
  }
}
```

### 6.3 Reconciliation Protocol

**Full State Resync**:

```typescript
// Backend: Handle full state request
async handleRequestFullState(payload: SystemRequestFullStatePayload): Promise<void> {
  const sessions = this.sessionManager.getAllSessions();
  const currentSession = this.sessionManager.getCurrentSession();
  const providers = await this.providerOrchestration.getAvailableProviders();

  // Send complete state snapshot
  this.eventBus.publish('system:fullStateSnapshot', {
    sessions,
    currentSession,
    providers,
    currentProvider: this.providerOrchestration.getCurrentProvider(),
    stateVersion: this.sessionManager.stateVersion,
    timestamp: Date.now(),
  });
}

// Frontend: Apply full state snapshot
onFullStateSnapshot(payload: SystemFullStateSnapshotPayload): void {
  // Replace all local state with backend state
  this.chatState.replaceAllSessions(payload.sessions);
  this.chatState.setCurrentSession(payload.currentSession);
  this.providerService.replaceProviders(payload.providers);
  this.providerService.setCurrentProvider(payload.currentProvider);

  this.expectedStateVersion = payload.stateVersion;

  console.info('[StateSyncService] Full state reconciliation complete', {
    sessionCount: payload.sessions.length,
    messageCount: payload.currentSession?.messages.length || 0,
  });
}
```

### 6.4 Retry Strategy

**Exponential Backoff**:

```typescript
async sendWithRetry<T>(
  commandType: keyof MessagePayloadMap,
  payload: unknown,
  options: RetryOptions = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelay = options.baseDelay ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await this.commandBus.send(commandType, payload, {
        timeout: options.timeout ?? 5000,
      });
    } catch (error) {
      if (attempt === maxRetries) {
        throw error; // Final attempt failed
      }

      // Exponential backoff: 1s, 2s, 4s, ...
      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `[CommandBus] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`,
        error
      );

      await this.sleep(delay);
    }
  }
}

private sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

---

## 7. Service Responsibilities

### 7.1 Backend Services

**SessionManager** (SSOT for sessions/messages):

- CRUD operations for sessions
- Add/update/delete messages
- Token usage tracking
- Persistence to disk
- Event publishing on all mutations
- State version tracking

**ClaudeCliService** (CLI integration):

- Process spawning/management
- JSONL stream parsing
- Streaming event emission (chunks, thinking, tools)
- Process cleanup on errors

**ChatOrchestrationService** (command handling):

- Handle `chat:*` commands from frontend
- Validate command payloads
- Send acknowledgments
- Coordinate between SessionManager and ClaudeCliService
- Error handling and reporting

**WebviewMessageBridge** (event forwarding):

- Subscribe to all backend events
- Forward events to webview via postMessage
- Filter internal events
- No business logic (pure transport)

### 7.2 Frontend Services

**VSCodeService** (transport layer):

- postMessage() for sending commands
- onMessage() Observable for receiving events
- VS Code API wrapper
- Connection status tracking

**CommandBus** (command orchestration):

- Send commands to backend
- Track pending commands
- Handle acknowledgments
- Timeout/retry logic
- Correlation ID management

**StateSyncService** (NEW - event orchestration):

- Subscribe to all backend events
- Route events to appropriate state services
- Handle deduplication
- Trigger reconciliation on errors
- State version tracking

**ChatStateService** (state mirror):

- Signal-based state storage
- Event handlers (messageAdded, sessionSwitched, etc.)
- Validation of incoming events
- No business logic (pure state)

**EventDeduplicationService** (deduplication):

- Time-window based deduplication
- Event key generation (type + correlationId + hash)
- Memory-efficient cleanup

**AppStateManager** (UI state):

- Frontend-only transient state
- No backend sync required

---

## 8. Event Subscription Registry

### 8.1 Subscription Map

**New Service**: `libs/frontend/core/src/lib/services/event-subscription-registry.service.ts`

```typescript
@Injectable({ providedIn: 'root' })
export class EventSubscriptionRegistry {
  // Map<eventType, Set<serviceName>>
  private readonly subscriptions = new Map<string, Set<string>>();

  /**
   * Register event handler
   */
  register(eventType: keyof MessagePayloadMap, serviceName: string, handler: (payload: unknown) => void): void {
    const handlers = this.subscriptions.get(eventType) || new Set();

    if (handlers.has(serviceName)) {
      console.warn(`[EventSubscriptionRegistry] Duplicate subscription: ${serviceName} already handles ${eventType}`);
    }

    handlers.add(serviceName);
    this.subscriptions.set(eventType, handlers);
  }

  /**
   * Validate no duplicate subscriptions
   */
  validateNoDuplicates(): ValidationResult {
    const duplicates: string[] = [];

    for (const [eventType, handlers] of this.subscriptions.entries()) {
      if (handlers.size > 1) {
        duplicates.push(`${eventType}: ${Array.from(handlers).join(', ')}`);
      }
    }

    if (duplicates.length > 0) {
      console.error('[EventSubscriptionRegistry] Duplicate handlers detected:', duplicates);
      return { valid: false, errors: duplicates };
    }

    return { valid: true, errors: [] };
  }

  /**
   * Generate subscription map for documentation
   */
  generateSubscriptionMap(): SubscriptionMap {
    const map: Record<string, string[]> = {};

    for (const [eventType, handlers] of this.subscriptions.entries()) {
      map[eventType] = Array.from(handlers);
    }

    return map;
  }
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

type SubscriptionMap = Record<string, string[]>;
```

### 8.2 Registration Example

```typescript
// In StateSyncService constructor
constructor(
  private readonly registry: EventSubscriptionRegistry,
  private readonly chatState: ChatStateService,
  private readonly providerService: ProviderService
) {
  this.registerHandlers();
  this.validateRegistrations();
}

private registerHandlers(): void {
  // Chat events → ChatStateService
  this.registry.register('chat:messageAdded', 'ChatStateService',
    (payload) => this.chatState.onMessageAdded(payload));

  this.registry.register('chat:messageChunk', 'ChatStateService',
    (payload) => this.chatState.onMessageChunk(payload));

  this.registry.register('chat:sessionSwitched', 'ChatStateService',
    (payload) => this.chatState.onSessionSwitched(payload));

  // Provider events → ProviderService
  this.registry.register('providers:switched', 'ProviderService',
    (payload) => this.providerService.onProviderSwitched(payload));

  this.registry.register('providers:healthUpdate', 'ProviderService',
    (payload) => this.providerService.onHealthUpdate(payload));

  // ... all other event handlers
}

private validateRegistrations(): void {
  const result = this.registry.validateNoDuplicates();

  if (!result.valid) {
    console.error('[StateSyncService] Duplicate event handlers detected!');
    console.error('Fix these duplicates:', result.errors);
    // Optionally throw error in development
    if (!environment.production) {
      throw new Error('Duplicate event handlers found');
    }
  } else {
    console.info('[StateSyncService] All event handlers validated (no duplicates)');
  }
}
```

---

## 9. State Reconciliation Protocol

### 9.1 Optimistic Updates

**Frontend can update UI immediately** (before backend confirmation) for better UX:

```typescript
async sendMessage(content: string): Promise<void> {
  // Optimistic: Add user message immediately
  const optimisticMessage: StrictChatMessage = {
    id: MessageId.create(),
    type: 'user',
    content,
    timestamp: Date.now(),
    sessionId: this.currentSession()!.id,
    optimistic: true, // Mark as optimistic
  };

  this.chatState.addOptimisticMessage(optimisticMessage);

  try {
    // Send command to backend
    const ack = await this.commandBus.send('chat:sendMessage', {
      content,
      sessionId: this.currentSession()!.id,
    });

    // Backend will send messageAdded event with final message
    // When event arrives, replace optimistic message
  } catch (error) {
    // Revert optimistic update on error
    this.chatState.removeOptimisticMessage(optimisticMessage.id);
    throw error;
  }
}

// In ChatStateService
onMessageAdded(payload: ChatMessageAddedPayload): void {
  const { message } = payload;

  // Replace optimistic message if exists
  const current = this._messages();
  const optimisticIndex = current.findIndex(
    (m) => m.optimistic && m.content === message.content
  );

  if (optimisticIndex >= 0) {
    // Replace optimistic with real message
    const updated = [...current];
    updated[optimisticIndex] = message;
    this._messages.set(updated);
  } else {
    // Add new message
    this._messages.set([...current, message]);
  }
}
```

### 9.2 State Snapshots

**Backend sends full state on session switch** (eliminates need for incremental sync):

```typescript
async switchSession(sessionId: SessionId): Promise<void> {
  const session = this.sessions.get(sessionId);

  // Send FULL session state (not just ID)
  this.eventBus.publish('chat:sessionSwitched', {
    sessionId,
    session: {
      ...session,
      messages: session.messages, // All messages included
    },
    stateVersion: this.stateVersion,
  });
}

// Frontend replaces state entirely
onSessionSwitched(payload: ChatSessionSwitchedPayload): void {
  // Replace all session state
  this._currentSession.set(payload.session);
  this._messages.set(payload.session.messages);

  console.info('[ChatStateService] Session switched, state replaced', {
    sessionId: payload.sessionId,
    messageCount: payload.session.messages.length,
  });
}
```

### 9.3 Incremental Updates

**For performance, use incremental updates for streaming**:

```typescript
// Backend sends chunks incrementally
for (const chunk of stream) {
  this.eventBus.publish('chat:messageChunk', {
    chunk: chunk.content,
    messageId: assistantMessage.id,
    sessionId,
    index: chunk.index, // Chunk sequence number
  });
}

// Frontend applies chunks incrementally
onMessageChunk(payload: ChatMessageChunkPayload): void {
  const messages = this._messages();
  const index = messages.findIndex((m) => m.id === payload.messageId);

  if (index >= 0) {
    // Append chunk to existing message
    const message = messages[index];
    messages[index] = {
      ...message,
      content: message.content + payload.chunk,
      streaming: true,
    };
    this._messages.set([...messages]);
  } else {
    // Create new streaming message
    this._messages.set([
      ...messages,
      {
        id: payload.messageId,
        type: 'assistant',
        content: payload.chunk,
        timestamp: Date.now(),
        sessionId: payload.sessionId,
        streaming: true,
      },
    ]);
  }
}
```

### 9.4 Version Vectors

**Track state versions to detect out-of-sync**:

```typescript
// Backend maintains version counter
export class SessionManager {
  private stateVersion = 0;

  async addMessage(...): Promise<void> {
    // ... mutation logic
    this.stateVersion++;

    this.eventBus.publish('chat:messageAdded', {
      message,
      sessionId,
      stateVersion: this.stateVersion, // Include version
    });
  }
}

// Frontend tracks expected version
export class StateSyncService {
  private expectedVersion = 0;

  onEvent(event: TypedEvent): void {
    const { stateVersion } = event.payload;

    // Check version sequence
    if (stateVersion) {
      const gap = stateVersion - this.expectedVersion;

      if (gap > 1) {
        console.warn('[StateSyncService] Version gap detected', {
          expected: this.expectedVersion,
          received: stateVersion,
          gap,
        });
        this.requestReconciliation();
      }

      this.expectedVersion = stateVersion;
    }

    this.processEvent(event);
  }
}
```

### 9.5 Full Resync

**Request complete state from backend** on errors:

```typescript
// Frontend: Request full state
async requestFullState(): Promise<void> {
  await this.commandBus.send('system:requestFullState', {});
}

// Backend: Send complete state snapshot
async handleRequestFullState(): Promise<void> {
  const snapshot = {
    sessions: this.sessionManager.getAllSessions(),
    currentSession: this.sessionManager.getCurrentSession(),
    providers: await this.providerOrchestration.getAvailableProviders(),
    currentProvider: this.providerOrchestration.getCurrentProvider(),
    stateVersion: this.sessionManager.stateVersion,
  };

  this.eventBus.publish('system:fullStateSnapshot', snapshot);
}

// Frontend: Replace all state
onFullStateSnapshot(snapshot: SystemFullStateSnapshotPayload): void {
  this.chatState.replaceAllState(snapshot);
  this.providerService.replaceState(snapshot);
  this.expectedVersion = snapshot.stateVersion;
}
```

---

## 10. Implementation Roadmap

### Phase 1: Foundation (Week 1)

**Goal**: Establish core synchronization infrastructure

- [ ] Create `CommandBus` service (frontend)
- [ ] Create `EventDeduplicationService` (frontend)
- [ ] Create `StateSyncService` (frontend)
- [ ] Create `EventSubscriptionRegistry` (frontend)
- [ ] Add acknowledgment handling to backend orchestration services
- [ ] Add `stateVersion` tracking to SessionManager
- [ ] Add `system:commandAck` event type to MessagePayloadMap

**Deliverables**:

- 4 new frontend services
- Backend acknowledgment infrastructure
- State versioning system

### Phase 2: Command-Event Migration (Week 2)

**Goal**: Migrate existing request-response patterns to command-event

- [ ] Migrate `chat:sendMessage` to command-event pattern
- [ ] Migrate `chat:switchSession` to command-event pattern
- [ ] Migrate `chat:newSession` to command-event pattern
- [ ] Migrate `providers:switch` to command-event pattern
- [ ] Update all frontend services to use CommandBus
- [ ] Remove direct VSCodeService.postMessage calls (except CommandBus)

**Deliverables**:

- All chat operations use command-event pattern
- Provider switching uses command-event pattern
- Zero direct postMessage calls in feature services

### Phase 3: Deduplication & Cleanup (Week 3)

**Goal**: Eliminate duplicate event processing

- [ ] Integrate EventDeduplicationService into VSCodeService
- [ ] Validate event deduplication with duplicate event tests
- [ ] Remove duplicate subscriptions in ChatService
- [ ] Remove duplicate subscriptions in ChatStateManagerService
- [ ] Consolidate event handlers in StateSyncService
- [ ] Validate subscription registry (no duplicates)

**Deliverables**:

- Zero duplicate event handlers
- Deduplication service active
- Subscription registry validated

### Phase 4: State Reconciliation (Week 4)

**Goal**: Add automatic error recovery

- [ ] Create `ConnectionMonitorService` (frontend)
- [ ] Implement heartbeat mechanism
- [ ] Implement full state resync protocol
- [ ] Add version vector tracking
- [ ] Add state drift detection
- [ ] Test reconciliation on connection loss
- [ ] Test reconciliation on version mismatch

**Deliverables**:

- Connection monitoring active
- Automatic reconciliation on errors
- Version vector validation

### Phase 5: Optimistic Updates (Week 5)

**Goal**: Improve UX with optimistic updates

- [ ] Add optimistic message rendering
- [ ] Add optimistic session creation
- [ ] Add rollback on command failure
- [ ] Test optimistic update edge cases
- [ ] Add UI indicators for optimistic state (e.g., pending badge)

**Deliverables**:

- Optimistic UI updates
- Rollback on errors
- Clear UI indicators

### Phase 6: Testing & Documentation (Week 6)

**Goal**: Comprehensive testing and documentation

- [ ] Unit tests for CommandBus
- [ ] Unit tests for EventDeduplicationService
- [ ] Unit tests for StateSyncService
- [ ] Integration tests for command-event flows
- [ ] E2E tests for reconciliation
- [ ] Update architecture diagrams
- [ ] Update developer documentation

**Deliverables**:

- 80%+ test coverage
- Updated documentation
- Architecture diagrams

---

## 11. Success Criteria

### Functional Requirements

- [ ] All commands acknowledged within 100ms
- [ ] All events processed exactly once
- [ ] State sync maintained across connection loss
- [ ] No duplicate message rendering
- [ ] No stuck "typing" indicators
- [ ] Automatic recovery from errors

### Non-Functional Requirements

- [ ] Event routing overhead < 5ms
- [ ] Support 1000+ events/second
- [ ] Memory usage < 50MB for deduplication cache
- [ ] Zero data loss on connection failures
- [ ] Reconciliation completes within 1 second

### Quality Gates

- [ ] Zero duplicate subscriptions (validated by registry)
- [ ] All events have correlation IDs
- [ ] All commands have acknowledgments
- [ ] State version tracking active
- [ ] Deduplication service prevents 99%+ duplicates
- [ ] Test coverage > 80%

---

## 12. Migration Strategy

### Backward Compatibility

**Phase 1-2**: Dual mode (old + new patterns coexist)

- CommandBus sends commands but also publishes events (for old handlers)
- Old handlers still active but deprecated
- Feature flag: `ENABLE_COMMAND_EVENT_PATTERN` (default: true)

**Phase 3**: Remove old patterns

- Remove direct VSCodeService subscriptions
- Remove dual message collections (messages[] → claudeMessages[])
- Remove deprecated handlers

**Phase 4**: Production rollout

- Enable feature flag for all users
- Monitor for errors/regressions
- Rollback plan: disable feature flag

### Migration Checklist

- [ ] No breaking changes to message protocol
- [ ] All existing features work with new architecture
- [ ] Performance equal or better than before
- [ ] Test coverage maintained/improved
- [ ] Documentation updated

---

## 13. Monitoring & Observability

### Metrics to Track

**Event Processing**:

- Events received per second
- Events deduplicated (count, percentage)
- Average event processing time
- Event handler errors (count, types)

**Command Execution**:

- Commands sent per second
- Command acknowledgment time (avg, p95, p99)
- Command timeouts (count)
- Command retry count

**State Synchronization**:

- State version gaps detected
- Full reconciliations triggered
- Optimistic updates rolled back
- Connection losses detected

**Health Checks**:

- Heartbeat interval (should be < 5s)
- Last message timestamp
- Pending command count
- EventBus subscription count

### Logging Strategy

**Structured Logging**:

```typescript
logger.debug('[CommandBus] Sent command', {
  type: 'chat:sendMessage',
  correlationId,
  timestamp,
});

logger.info('[StateSyncService] Event processed', {
  type: 'chat:messageAdded',
  correlationId,
  stateVersion,
  processingTime: 3,
});

logger.warn('[EventDedup] Duplicate event ignored', {
  type: 'chat:messageChunk',
  correlationId,
  timeSinceLastSeen: 234,
});

logger.error('[ConnectionMonitor] Connection lost', {
  lastMessageTime: Date.now() - 16000,
  timeSinceLastMessage: 16000,
});
```

**Log Levels**:

- **DEBUG**: Event processing details, deduplication
- **INFO**: State changes, reconciliation, commands
- **WARN**: Duplicates, retries, version gaps
- **ERROR**: Timeouts, connection loss, failures

---

## Appendix A: Message Type Reference

### Commands (Frontend → Backend)

| **Command Type**          | **Payload**                   | **Acknowledgment**         |
| ------------------------- | ----------------------------- | -------------------------- |
| `chat:sendMessage`        | content, sessionId            | `system:commandAck`        |
| `chat:switchSession`      | sessionId                     | `system:commandAck`        |
| `chat:newSession`         | name?, workspaceId?           | `system:commandAck`        |
| `chat:deleteSession`      | sessionId                     | `system:commandAck`        |
| `chat:stopGeneration`     | sessionId                     | `system:commandAck`        |
| `chat:permissionResponse` | requestId, decision, remember | `system:commandAck`        |
| `providers:switch`        | providerId                    | `system:commandAck`        |
| `context:includeFile`     | filePath                      | `system:commandAck`        |
| `system:requestFullState` | {}                            | `system:fullStateSnapshot` |

### Events (Backend → Frontend)

| **Event Type**             | **Payload**                   | **Triggered By**        |
| -------------------------- | ----------------------------- | ----------------------- |
| `chat:messageAdded`        | message, sessionId            | Message created         |
| `chat:messageChunk`        | chunk, messageId              | Streaming content       |
| `chat:messageComplete`     | messageId                     | Streaming finished      |
| `chat:thinking`            | content, timestamp            | Claude thinking         |
| `chat:toolStart`           | toolCallId, tool, args        | Tool execution start    |
| `chat:toolProgress`        | toolCallId, progress          | Tool progress update    |
| `chat:toolResult`          | toolCallId, output            | Tool execution complete |
| `chat:permissionRequest`   | requestId, type, details      | Permission needed       |
| `chat:sessionCreated`      | session                       | Session created         |
| `chat:sessionSwitched`     | sessionId, session            | Session switched        |
| `chat:sessionsUpdated`     | sessions                      | Session list changed    |
| `providers:switched`       | providerId, provider          | Provider changed        |
| `providers:healthUpdate`   | providerId, health            | Provider health check   |
| `system:commandAck`        | correlationId, success, error | Command processed       |
| `system:fullStateSnapshot` | sessions, currentSession, ... | Full state requested    |

---

## Appendix B: Correlation ID Flow Example

**Scenario**: User sends message "Explain async/await"

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. FRONTEND: User clicks Send                                   │
│    correlationId: "550e8400-e29b-41d4-a716-446655440000"        │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. FRONTEND CommandBus: Send command                            │
│    Command: chat:sendMessage                                    │
│    Payload: { content: "Explain async/await", correlationId }  │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. BACKEND ChatOrchestrationService: Receive command            │
│    Validate: ✓ Content not empty                               │
│    Acknowledge: system:commandAck (correlationId, success=true) │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. BACKEND SessionManager: Add user message                     │
│    Event: chat:messageAdded (correlationId)                     │
│    Payload: { message: {...}, sessionId }                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. BACKEND ClaudeCliService: Invoke Claude CLI                  │
│    Event: chat:thinking (correlationId)                         │
│    Payload: { content: "Analyzing async patterns..." }          │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. BACKEND ClaudeCliService: Stream chunks                      │
│    Event: chat:messageChunk (correlationId) × N                 │
│    Payload: { chunk: "async/await is...", messageId }           │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. BACKEND ClaudeCliService: Streaming complete                 │
│    Event: chat:messageComplete (correlationId)                  │
│    Payload: { messageId }                                       │
└─────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. FRONTEND StateSyncService: Process all events                │
│    Filter by correlationId: All events for this user action     │
│    Update UI: Message added → Thinking → Chunks → Complete     │
└─────────────────────────────────────────────────────────────────┘

**Result**: Every event from step 3-7 has the SAME correlationId, enabling:
  - Debugging: View all events for a single user action
  - Deduplication: Detect if same event arrives twice
  - Request-response: Know when command is fully processed
```

---

## Appendix C: Deduplication Algorithm

```typescript
/**
 * Deduplication algorithm: Time-window + payload hash
 */
function isDuplicate(event: StrictMessage): boolean {
  // 1. Generate event key
  const key = generateKey(event);
  // Format: "chat:messageChunk:550e8400:123abc"
  //          ^type          ^correlationId ^payloadHash

  // 2. Check if seen within time window (1 second)
  const lastSeen = seenEvents.get(key);
  const now = Date.now();

  if (lastSeen && now - lastSeen < 1000) {
    return true; // DUPLICATE
  }

  // 3. Update last seen timestamp
  seenEvents.set(key, now);

  return false; // NOT DUPLICATE
}

/**
 * Key generation
 */
function generateKey(event: StrictMessage): string {
  const correlationId = event.payload.correlationId || '';
  const hash = hashPayload(event.payload);
  return `${event.type}:${correlationId}:${hash}`;
}

/**
 * Payload hashing (simple implementation)
 */
function hashPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  // Simple hash: length + first 10 chars
  return json.length.toString(36) + json.slice(0, 10);
}

/**
 * Cleanup old entries (prevent memory leak)
 */
function cleanup(now: number): void {
  if (seenEvents.size < 1000) return;

  for (const [key, timestamp] of seenEvents.entries()) {
    if (now - timestamp > 300000) {
      // 5 minutes
      seenEvents.delete(key);
    }
  }
}
```

---

## Appendix D: State Version Tracking

```typescript
/**
 * Backend: Increment version on every mutation
 */
export class SessionManager {
  private stateVersion = 0;

  async createSession(...): Promise<StrictChatSession> {
    const session = { ... };
    this.sessions.set(session.id, session);

    this.stateVersion++; // Increment

    this.eventBus.publish('chat:sessionCreated', {
      session,
      stateVersion: this.stateVersion, // Include version
    });

    return session;
  }

  async addMessage(...): Promise<void> {
    // ... mutation logic

    this.stateVersion++; // Increment

    this.eventBus.publish('chat:messageAdded', {
      message,
      sessionId,
      stateVersion: this.stateVersion, // Include version
    });
  }
}

/**
 * Frontend: Validate version sequence
 */
export class StateSyncService {
  private expectedVersion = 0;

  onEvent(event: TypedEvent): void {
    const { stateVersion } = event.payload;

    if (!stateVersion) {
      // Legacy event without version, process normally
      this.processEvent(event);
      return;
    }

    // Check version sequence
    const expectedNext = this.expectedVersion + 1;

    if (stateVersion < expectedNext) {
      // Old event (arrived out of order), ignore
      console.warn('[StateSyncService] Old event ignored', {
        expected: expectedNext,
        received: stateVersion,
      });
      return;
    }

    if (stateVersion > expectedNext) {
      // Gap detected (missed events), request reconciliation
      console.error('[StateSyncService] Version gap detected!', {
        expected: expectedNext,
        received: stateVersion,
        gap: stateVersion - expectedNext,
      });
      this.requestFullReconciliation();
      return;
    }

    // Version is correct (stateVersion === expectedNext)
    this.expectedVersion = stateVersion;
    this.processEvent(event);
  }
}
```

---

## End of Document

**Next Steps**: Review with team-leader for implementation task breakdown.
