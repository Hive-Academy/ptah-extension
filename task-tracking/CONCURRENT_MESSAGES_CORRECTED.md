# Concurrent Message Handling in Ptah Extension (CORRECTED)

**Last Updated**: 2025-11-24
**Correction**: Initial analysis was incorrect. This document clarifies the actual behavior.

---

## TL;DR - Current Behavior

**Our Implementation**: Each message spawns a **new CLI process** in print mode (`-p` flag).

**Concurrent Messages**: The second message **kills** the first process and starts a new one.

**Why**: We use Claude CLI's **print mode** (`--print`), which is designed for one-shot execution. Print mode exits after each response, so we must spawn a new process for each message.

**Alternative**: Claude CLI's **interactive mode** (default, no `-p` flag) can handle multiple messages via stdin WITHOUT killing the process. We don't use this currently.

---

## How Claude CLI Works

### Mode 1: Interactive Mode (Default)

```bash
$ claude --session my-session

# Single process, multiple messages via stdin
User: Explain React hooks
Claude: [streams response]
User: Explain useState  ← Same process, new message via stdin
Claude: [streams response]
User: Explain useEffect ← Same process, new message via stdin
Claude: [streams response]
```

**Characteristics**:

- ✅ Single process per session
- ✅ Multiple messages via stdin
- ✅ No process killing needed
- ✅ Lower latency (process already running)
- ❌ More complex stdin management
- ❌ Need to detect when response completes

### Mode 2: Print Mode (Current Implementation)

```bash
$ echo "Explain React hooks" | claude -p --output-format stream-json --resume my-session
[Claude streams response and exits]

$ echo "Explain useState" | claude -p --output-format stream-json --resume my-session
[New process, Claude streams response and exits]

$ echo "Explain useEffect" | claude -p --output-format stream-json --resume my-session
[New process, Claude streams response and exits]
```

**Characteristics**:

- ✅ Simple: One process per message
- ✅ Easy to detect completion (process exits)
- ✅ Clean separation of turns
- ❌ Higher latency (spawn overhead ~500ms)
- ❌ Must kill previous process if concurrent

**Our Implementation**:

```typescript
// libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:186
private buildArgs(model?: string, resumeSessionId?: string): string[] {
  const args = [
    '-p',                          // ← Print mode (one-shot)
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
  ];
  // ...
}
```

---

## Current Behavior Explained

### Scenario: User Sends Message While Claude Is Responding

```
User: "Write a 1000-line React component"
  ↓
Backend: Spawn Process 1 with `-p` flag
  ↓
Process 1 starts streaming response...
  ↓
[500 lines generated]
  ↓
User: "Actually, make it shorter" ← SECOND MESSAGE SENT
  ↓
Backend: ProcessManager.registerProcess() called
  ↓
ProcessManager kills Process 1 (line 35: this.killProcess(sessionId))
  ↓
Backend: Spawn Process 2 with `-p` flag and new message
  ↓
Process 2 streams response...
```

**Result**: First response is interrupted, second message executes.

**Code**:

```typescript
// libs/backend/claude-domain/src/cli/process-manager.ts:28-36
registerProcess(
  sessionId: SessionId,
  process: ChildProcess,
  command: string,
  args: string[]
): void {
  // Kill existing process for this session if any
  this.killProcess(sessionId);  // ← This is WHERE interruption happens

  const metadata: ProcessMetadata = {
    sessionId,
    process,
    startedAt: Date.now(),
    command,
    args,
  };

  this.processes.set(sessionId, metadata);
  // ...
}
```

---

## Why We Use Print Mode

### Advantages of Print Mode

1. **Simpler State Management**

   - Process lifecycle matches message lifecycle
   - Easy to detect completion (process exits)
   - No need to parse stdin/stdout to determine turn boundaries

2. **Session Management**

   - Claude CLI manages session state via `.jsonl` files
   - `--resume session_id` loads conversation history
   - Each process reads/writes complete turns atomically

3. **Error Handling**
   - Process crash = message failed (clear failure mode)
   - No need to recover stdin/stdout state
   - Restart is just spawn new process

### Disadvantages of Print Mode

1. **Process Spawn Overhead**

   - ~500ms latency per message (Node.js spawn + CLI init)
   - Higher CPU usage (spawn + parse session file each time)

2. **Concurrent Messages Kill Each Other**

   - Rapid messages interrupt each other
   - Only last message completes
   - First N-1 messages are wasted work

3. **No True Concurrent Conversations**
   - One active turn per session at a time
   - Cannot run multiple independent prompts in parallel

---

## Alternative: Interactive Mode Implementation

### How It Would Work

```typescript
class InteractiveModeManager {
  private sessionProcesses = new Map<SessionId, ChildProcess>();
  private messageQueues = new Map<SessionId, MessageQueue>();

  async sendMessage(sessionId: SessionId, content: string): Promise<void> {
    // Get or create process for this session
    let process = this.sessionProcesses.get(sessionId);
    if (!process || process.killed) {
      process = await this.spawnInteractiveSession(sessionId);
      this.sessionProcesses.set(sessionId, process);
    }

    // Queue message (interactive mode processes messages sequentially)
    const queue = this.messageQueues.get(sessionId) || new MessageQueue();
    await queue.enqueue({ content, timestamp: Date.now() });

    // Process queue
    if (!queue.isProcessing) {
      await this.processQueue(sessionId, queue);
    }
  }

  private async processQueue(sessionId: SessionId, queue: MessageQueue): Promise<void> {
    const process = this.sessionProcesses.get(sessionId)!;

    while (!queue.isEmpty()) {
      const message = queue.dequeue();

      // Write message to stdin (interactive mode)
      process.stdin!.write(message.content + '\n');

      // Wait for response to complete (detect via JSONL message_stop)
      await this.waitForResponseComplete(sessionId);
    }
  }

  private spawnInteractiveSession(sessionId: SessionId): ChildProcess {
    const args = [
      // NO -p flag! Interactive mode
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--resume',
      sessionId,
    ];

    return spawn('claude', args, { cwd: workspaceRoot });
  }

  private async waitForResponseComplete(sessionId: SessionId): Promise<void> {
    // Listen for JSONL message with type="result" or "stream_event" with stop_reason
    // Return when message is complete
  }
}
```

### Benefits of Interactive Mode

1. **No Process Killing**

   - Concurrent messages are queued, not interrupted
   - All messages complete successfully
   - No wasted work

2. **Lower Latency**

   - Process already running (no spawn overhead)
   - Session file already loaded in memory
   - ~100ms faster per message

3. **Better Resource Usage**
   - One process per session (not per message)
   - Less CPU (no repeated spawning)
   - Less memory churn

### Challenges of Interactive Mode

1. **Turn Boundary Detection**

   - Must parse JSONL to know when message is complete
   - `message_stop` event or `result` message signals end
   - More complex state machine

2. **Error Recovery**

   - If process crashes, must restart and replay queue
   - Need to handle partial responses
   - More complex failure modes

3. **Stdin Management**

   - Must manage write backpressure
   - Cannot send message #2 until #1 completes
   - Need message queue per session

4. **Session Initialization**
   - Process spawn time is paid upfront (first message slower)
   - Need timeout/health checks for idle sessions
   - Must clean up long-idle sessions

---

## Recommendation

### Short-Term: Keep Print Mode, Add UI Feedback

**Current behavior is acceptable** because:

- Simple implementation (matches current codebase)
- Users can interrupt long responses (feature, not bug)
- Print mode is Claude CLI's recommended mode for programmatic use

**Improvements**:

1. **Add "Interrupting..." Toast**

   ```typescript
   // Before spawning new process
   if (processManager.hasActiveProcess(sessionId)) {
     showNotification('Interrupting current response...');
     processManager.killProcess(sessionId);
   }
   ```

2. **Add Stop Button** (explicit control)

   ```typescript
   <button (click)="onStopStreaming()">Stop Generating</button>

   // RPC method
   rpcHandler.registerMethod('chat:stop', async (params) => {
     processManager.killProcess(params.sessionId);
     return { success: true };
   });
   ```

3. **Debounce Message Sending** (prevent accidental rapid-fire)
   ```typescript
   const debouncedSendMessage = debounce((content) => {
     chatService.sendMessage(content);
   }, 500); // 500ms delay
   ```

### Long-Term: Consider Interactive Mode (Optional)

**Only if users request**:

- Queueing instead of interruption
- Lower latency requirement
- High message volume per session

**Implementation Effort**: ~2-3 days (complex state management)

**Benefits**: More efficient, no interruptions

**Drawbacks**: More complex, users lose ability to interrupt

---

## Testing Concurrent Messages

### Test Case 1: Rapid Fire Messages

```typescript
// Send 3 messages rapidly
await chatService.sendMessage('Message 1');
await chatService.sendMessage('Message 2'); // Kills Message 1
await chatService.sendMessage('Message 3'); // Kills Message 2

// Expected: Only Message 3 completes
```

### Test Case 2: Mid-Response Interruption

```typescript
// Send long message
chatService.sendMessage('Write 1000 lines of code');

// Wait 5 seconds, then interrupt
setTimeout(() => {
  chatService.sendMessage('Actually, stop');
}, 5000);

// Expected: First message interrupted, second message executes
```

### Test Case 3: Stop Button

```typescript
// Start long response
chatService.sendMessage('Write comprehensive guide');

// User clicks stop button
await rpcService.stopChat(sessionId);

// Expected: Process killed, UI shows "Stopped generating"
```

---

## Conclusion

**Current Implementation (Print Mode)**:

- ✅ Simple and reliable
- ✅ Matches Claude CLI's one-shot design
- ✅ Users can interrupt responses (feature)
- ❌ Process spawn overhead (~500ms)
- ❌ Concurrent messages kill each other

**Alternative (Interactive Mode)**:

- ✅ Lower latency (~100ms faster)
- ✅ No interruptions (messages queue)
- ✅ Better resource usage
- ❌ More complex state management
- ❌ Users cannot interrupt

**Recommendation**: **Keep print mode**, add UI feedback (toast + stop button).

Interactive mode is **optional future enhancement** if users specifically request queueing behavior.

---

## Key Correction

**Original (Incorrect) Analysis**:

> "Concurrent messages are intelligently handled by Claude CLI"

**Corrected Analysis**:

> "Concurrent messages **kill previous process** because we use print mode (`-p` flag), which is one-shot execution. Claude CLI's **interactive mode** (no `-p`) can handle concurrent messages via stdin, but we don't use it."

**User was correct** to point out the distinction between interruption and concurrent message handling. The current implementation **interrupts** (kills process), which is different from **queueing** messages intelligently.
