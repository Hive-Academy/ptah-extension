# Interactive Session Design - Migration from Print Mode

**Last Updated**: 2025-11-24
**Goal**: Replace print mode (`-p`) with interactive mode for natural concurrent message handling

---

## Executive Summary

**Current (Print Mode)**:

- Each message = new process
- Concurrent messages kill each other
- ~500ms latency per message

**Target (Interactive Mode)**:

- One process per session
- Concurrent messages queue naturally
- ~100ms latency (no spawn overhead)
- Native pause/resume support

---

## Architecture Design

### High-Level Flow

```
User sends Message 1
  ↓
InteractiveSessionManager: Get or create session process
  ↓
Session exists? NO → Spawn interactive CLI process
  ↓
Write Message 1 to stdin
  ↓
Listen for JSONL stream until message_stop
  ↓
User sends Message 2 (while Message 1 streaming)
  ↓
InteractiveSessionManager: Queue Message 2
  ↓
Message 1 completes (message_stop received)
  ↓
Write Message 2 to stdin
  ↓
Continue...
```

### Component Architecture

```
┌─────────────────────────────────────────────────────────┐
│  InteractiveSessionManager (NEW)                        │
│  - One CLI process per session                          │
│  - Message queue per session                            │
│  - Turn boundary detection                              │
│  - Pause/resume support                                 │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│  SessionProcess (NEW)                                   │
│  - Wraps ChildProcess                                   │
│  - Stdin writer with backpressure                       │
│  - State: idle | processing | paused                    │
│  - Message queue                                        │
└─────────────────────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────────────┐
│  TurnBoundaryDetector (NEW)                             │
│  - Parses JSONL stream                                  │
│  - Detects message_stop events                          │
│  - Signals turn completion                              │
└─────────────────────────────────────────────────────────┘
```

---

## Key Components

### 1. InteractiveSessionManager

**Responsibilities**:

- Manage one CLI process per session
- Queue messages when process is busy
- Detect turn boundaries to know when next message can be sent
- Support pause/resume

**Interface**:

```typescript
interface InteractiveSessionManager {
  // Send message (queues if busy)
  sendMessage(sessionId: SessionId, content: string, files?: string[]): Promise<void>;

  // Pause current turn (SIGTSTP)
  pauseSession(sessionId: SessionId): Promise<void>;

  // Resume paused turn (SIGCONT)
  resumeSession(sessionId: SessionId): Promise<void>;

  // Stop current turn and clear queue (SIGTERM)
  stopSession(sessionId: SessionId): Promise<void>;

  // Get session state
  getSessionState(sessionId: SessionId): SessionState;

  // Clean up idle sessions
  cleanupIdleSessions(maxIdleMs: number): void;
}

interface SessionState {
  status: 'idle' | 'processing' | 'paused' | 'stopped';
  queuedMessages: number;
  currentMessageStartedAt?: number;
  processId?: number;
}
```

### 2. SessionProcess

**Wraps a single CLI process for a session**:

```typescript
class SessionProcess {
  private process: ChildProcess;
  private messageQueue: MessageQueue;
  private state: 'idle' | 'processing' | 'paused';
  private currentTurnResolver?: () => void;

  constructor(sessionId: SessionId, process: ChildProcess, webview: vscode.Webview) {
    this.process = process;
    this.messageQueue = new MessageQueue();
    this.state = 'idle';
    this.setupStreamHandlers(webview);
  }

  async sendMessage(content: string): Promise<void> {
    // Queue message
    await this.messageQueue.enqueue({ content, timestamp: Date.now() });

    // Process queue if idle
    if (this.state === 'idle') {
      await this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    while (!this.messageQueue.isEmpty() && this.state === 'idle') {
      const message = this.messageQueue.dequeue();
      this.state = 'processing';

      // Write to stdin
      this.process.stdin!.write(message.content + '\n');

      // Wait for turn to complete (message_stop event)
      await this.waitForTurnComplete();

      this.state = 'idle';
    }
  }

  private async waitForTurnComplete(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.currentTurnResolver = resolve;
      // Resolver called when message_stop received
    });
  }

  pause(): void {
    if (this.state === 'processing') {
      this.process.kill('SIGTSTP'); // Pause signal
      this.state = 'paused';
    }
  }

  resume(): void {
    if (this.state === 'paused') {
      this.process.kill('SIGCONT'); // Resume signal
      this.state = 'processing';
    }
  }

  stop(): void {
    this.process.kill('SIGTERM');
    this.messageQueue.clear();
    this.state = 'idle';
  }

  private setupStreamHandlers(webview: vscode.Webview): void {
    const parser = new JSONLStreamParser({
      onMessage: (message) => {
        // Forward to webview (existing logic)
        webview.postMessage({ type: 'jsonl-message', data: { message } });

        // Detect turn completion
        if (this.isMessageStop(message)) {
          this.onTurnComplete();
        }
      },
      onError: (error) => {
        webview.postMessage({ type: 'jsonl-error', data: { error } });
      },
    });

    this.process.stdout!.on('data', (chunk) => {
      parser.processChunk(chunk);
    });
  }

  private isMessageStop(message: JSONLMessage): boolean {
    // Detect message_stop event OR result message
    return (message.type === 'stream_event' && (message.event as any)?.type === 'message_stop') || message.type === 'result';
  }

  private onTurnComplete(): void {
    if (this.currentTurnResolver) {
      this.currentTurnResolver();
      this.currentTurnResolver = undefined;
    }
  }
}
```

### 3. MessageQueue

**Simple FIFO queue with backpressure**:

```typescript
class MessageQueue {
  private queue: QueuedMessage[] = [];
  private readonly maxSize = 100; // Prevent memory exhaustion

  async enqueue(message: QueuedMessage): Promise<void> {
    if (this.queue.length >= this.maxSize) {
      throw new Error('Message queue full');
    }
    this.queue.push(message);
  }

  dequeue(): QueuedMessage | undefined {
    return this.queue.shift();
  }

  isEmpty(): boolean {
    return this.queue.length === 0;
  }

  clear(): void {
    this.queue = [];
  }

  size(): number {
    return this.queue.length;
  }
}

interface QueuedMessage {
  content: string;
  timestamp: number;
  files?: string[];
}
```

---

## CLI Argument Changes

### Current (Print Mode)

```typescript
const args = [
  '-p', // ← Remove this!
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--resume',
  sessionId,
];
```

### New (Interactive Mode)

```typescript
const args = [
  // NO -p flag!
  '--output-format',
  'stream-json',
  '--verbose',
  '--include-partial-messages',
  '--resume',
  sessionId,
];

// After spawn, write messages to stdin:
process.stdin.write(message + '\n');
// DO NOT call stdin.end() - keep stdin open for more messages!
```

**Key Differences**:

1. **Remove `-p` flag** - enables interactive mode
2. **Keep stdin open** - don't call `stdin.end()` after first message
3. **Write newline-separated messages** - Claude CLI reads line-by-line

---

## Turn Boundary Detection

Claude CLI signals turn completion via JSONL:

### Option 1: `message_stop` Event

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_stop"
  }
}
```

### Option 2: `result` Message

```json
{
  "type": "result",
  "subtype": "success",
  "usage": { ... }
}
```

**Implementation**:

```typescript
function isMessageStop(message: JSONLMessage): boolean {
  // Check for message_stop event
  if (message.type === 'stream_event' && (message.event as any)?.type === 'message_stop') {
    return true;
  }

  // Check for result message
  if (message.type === 'result') {
    return true;
  }

  return false;
}
```

---

## Pause/Resume Implementation

### Backend RPC Methods

```typescript
// RpcMethodRegistrationService
rpcHandler.registerMethod('chat:pause', async (params: any) => {
  const { sessionId } = params;
  await interactiveSessionManager.pauseSession(sessionId);
  return { success: true };
});

rpcHandler.registerMethod('chat:resume', async (params: any) => {
  const { sessionId } = params;
  await interactiveSessionManager.resumeSession(sessionId);
  return { success: true };
});

rpcHandler.registerMethod('chat:stop', async (params: any) => {
  const { sessionId } = params;
  await interactiveSessionManager.stopSession(sessionId);
  return { success: true };
});
```

### Frontend Controls

```typescript
// ClaudeRpcService
pauseChat(sessionId: SessionId): Promise<RpcResult<void>> {
  return this.call<void>('chat:pause', { sessionId });
}

resumeChat(sessionId: SessionId): Promise<RpcResult<void>> {
  return this.call<void>('chat:resume', { sessionId });
}

stopChat(sessionId: SessionId): Promise<RpcResult<void>> {
  return this.call<void>('chat:stop', { sessionId });
}

// ChatStreamingStatusComponent
<div class="streaming-controls">
  @if (isPaused()) {
    <button (click)="onResume()">Resume</button>
  } @else {
    <button (click)="onPause()">Pause</button>
  }
  <button (click)="onStop()">Stop</button>
</div>
```

---

## Session Lifecycle

### 1. Session Creation (First Message)

```
User sends first message
  ↓
InteractiveSessionManager.sendMessage(sessionId, content)
  ↓
No process exists → spawn interactive CLI
  ↓
Store SessionProcess in map
  ↓
Write message to stdin
  ↓
Wait for message_stop
  ↓
Ready for next message
```

### 2. Subsequent Messages (Same Session)

```
User sends second message (while first is streaming)
  ↓
InteractiveSessionManager.sendMessage(sessionId, content)
  ↓
Process exists, state = 'processing'
  ↓
Queue message
  ↓
First message completes (message_stop)
  ↓
Process queue, write second message to stdin
  ↓
Wait for message_stop
  ↓
Ready for next message
```

### 3. Session Pause

```
User clicks "Pause" button
  ↓
Frontend: rpcService.pauseChat(sessionId)
  ↓
Backend: interactiveSessionManager.pauseSession(sessionId)
  ↓
Send SIGTSTP to CLI process
  ↓
State = 'paused'
  ↓
User clicks "Resume"
  ↓
Frontend: rpcService.resumeChat(sessionId)
  ↓
Backend: interactiveSessionManager.resumeSession(sessionId)
  ↓
Send SIGCONT to CLI process
  ↓
State = 'processing'
```

### 4. Session Stop

```
User clicks "Stop" button
  ↓
Frontend: rpcService.stopChat(sessionId)
  ↓
Backend: interactiveSessionManager.stopSession(sessionId)
  ↓
Send SIGTERM to CLI process
  ↓
Clear message queue
  ↓
State = 'idle'
  ↓
Next message spawns new process
```

### 5. Session Cleanup (Idle Timeout)

```
Session idle for 5 minutes
  ↓
InteractiveSessionManager.cleanupIdleSessions()
  ↓
Send SIGTERM to idle processes
  ↓
Remove from session map
  ↓
Next message spawns new process
```

---

## Migration Strategy

### Phase 1: Core Infrastructure (Day 1)

1. ✅ Create `InteractiveSessionManager` class
2. ✅ Create `SessionProcess` class
3. ✅ Create `MessageQueue` class
4. ✅ Implement turn boundary detection
5. ✅ Update `ClaudeCliLauncher` to remove `-p` flag

### Phase 2: Integration (Day 2)

1. ✅ Update `ClaudeCliService` to use `InteractiveSessionManager`
2. ✅ Add `chat:pause`, `chat:resume`, `chat:stop` RPC methods
3. ✅ Update `RpcMethodRegistrationService`
4. ✅ Register in DI container

### Phase 3: Frontend (Day 2)

1. ✅ Add `pauseChat()`, `resumeChat()`, `stopChat()` to `ClaudeRpcService`
2. ✅ Update `ChatStreamingStatusComponent` with pause/resume/stop buttons
3. ✅ Add UI state for paused sessions
4. ✅ Show queued message count

### Phase 4: Testing (Day 3)

1. ✅ Test concurrent message queueing
2. ✅ Test pause/resume functionality
3. ✅ Test stop functionality
4. ✅ Test session cleanup
5. ✅ Load testing (100+ queued messages)

---

## Error Handling

### Process Crash

```typescript
sessionProcess.on('close', (code) => {
  if (code !== 0) {
    // Process crashed
    this.handleProcessCrash(sessionId, code);
  }
});

private handleProcessCrash(sessionId: SessionId, code: number): void {
  const session = this.sessions.get(sessionId);
  if (!session) return;

  // Notify frontend
  this.webview.postMessage({
    type: 'session-error',
    data: {
      sessionId,
      error: `CLI process crashed (exit code ${code})`,
    },
  });

  // Clear session
  this.sessions.delete(sessionId);

  // Next message will spawn new process
}
```

### Queue Overflow

```typescript
async enqueue(message: QueuedMessage): Promise<void> {
  if (this.queue.length >= this.maxSize) {
    throw new Error('Message queue full (max 100)');
  }
  this.queue.push(message);
}

// In InteractiveSessionManager
try {
  await sessionProcess.sendMessage(content);
} catch (error) {
  // Notify frontend
  webview.postMessage({
    type: 'session-error',
    data: { sessionId, error: 'Message queue full' },
  });
}
```

### Stdin Backpressure

```typescript
private async writeToStdin(message: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const canWrite = this.process.stdin!.write(message + '\n');

    if (canWrite) {
      resolve();
    } else {
      // Wait for drain event
      this.process.stdin!.once('drain', () => resolve());
      this.process.stdin!.once('error', (err) => reject(err));
    }
  });
}
```

---

## Benefits Summary

### ✅ Advantages Over Print Mode

1. **No Interruptions**: Messages queue naturally
2. **Lower Latency**: ~100ms faster (no spawn overhead)
3. **Better UX**: Natural pause/resume/stop controls
4. **Less CPU**: One process per session (not per message)
5. **More Reliable**: No race conditions from killing processes

### ⚠️ Complexity Trade-offs

1. **State Management**: Need to track process state
2. **Turn Detection**: Must parse JSONL for boundaries
3. **Queue Management**: Need message queue per session
4. **Error Recovery**: More failure modes to handle

### 📊 Performance Comparison

| Metric              | Print Mode | Interactive Mode |
| ------------------- | ---------- | ---------------- |
| Spawn Overhead      | ~500ms     | 0ms (amortized)  |
| Message Latency     | ~600ms     | ~100ms           |
| CPU per Message     | High       | Low              |
| Memory per Session  | Low        | Medium           |
| Concurrent Messages | Kills      | Queues           |

---

## Next Steps

1. **Implement Phase 1** (Core Infrastructure)

   - Create `InteractiveSessionManager`
   - Create `SessionProcess`
   - Create `MessageQueue`

2. **Update `ClaudeCliLauncher`**

   - Remove `-p` flag
   - Keep stdin open (don't call `stdin.end()`)
   - Add turn boundary detection

3. **Add RPC Methods**

   - `chat:pause`
   - `chat:resume`
   - `chat:stop`

4. **Update Frontend**
   - Pause/resume/stop buttons
   - Show queued message count
   - Show paused state

Ready to implement?
