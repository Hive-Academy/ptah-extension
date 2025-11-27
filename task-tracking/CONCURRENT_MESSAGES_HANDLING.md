# Concurrent Message Handling in Ptah Extension

**Last Updated**: 2025-11-24
**Question**: What happens if the user sends another message while Claude CLI is still executing?

---

## Current Behavior

### The Scenario

```
User: "Explain React hooks"
  ↓
Claude CLI spawns, starts streaming response...
  ↓
[Claude is mid-response, outputting thinking/text/tools]
  ↓
User: "Also explain useState" ← SECOND MESSAGE SENT
```

### What Actually Happens

**Short Answer**: The second message is queued and will run sequentially after the first completes.

---

## Technical Details

### 1. **SessionManager Manages CLI Processes**

Each session has ONE active Claude CLI process at a time:

**File**: `libs/backend/claude-domain/src/cli/process-manager.ts`

```typescript
class ProcessManager {
  private processes = new Map<SessionId, ChildProcess>();

  registerProcess(sessionId: SessionId, process: ChildProcess): void {
    // If a process already exists for this session, kill it first
    this.killProcess(sessionId);
    this.processes.set(sessionId, process);
  }
}
```

**Key Point**: Only ONE process per session can be active. Sending a second message while the first is running will:

1. Kill the first Claude CLI process
2. Start a new process with the second message

### 2. **Claude CLI Session State**

Claude CLI itself manages conversation state in the session file (`.jsonl`):

```
.claude_sessions/
  session_abc123/
    session.jsonl     ← Conversation history
```

When you send a message to an existing session:

```bash
claude --session session_abc123 "Follow-up question"
```

Claude CLI:

1. Reads `session.jsonl` to load conversation history
2. Appends user message
3. Generates response
4. Appends response to `session.jsonl`

**Implication**: If you kill process mid-response, the partial response is NOT saved. The session file only contains complete turns.

### 3. **RPC Call Queue Behavior**

**Frontend**:

```typescript
// ChatService.sendMessage()
const result = await this.rpcService.startChat(sessionId, content, files);
```

**Backend**:

```typescript
// RpcMethodRegistrationService
rpcHandler.registerMethod('chat:start', async (params) => {
  await claudeCliService.sendMessage(sessionId, content, files);
  return { success: true };
});
```

**Sequential Execution**:

- Each RPC call (`chat:start`) is async and waits for the CLI process to spawn
- If user sends message #2 while #1 is streaming:
  - Message #2 RPC call starts
  - `ProcessManager.registerProcess()` kills process #1
  - CLI process #2 spawns with message #2

**Result**: Message #2 replaces message #1 mid-stream.

---

## Current Limitations

### ❌ Problem: Interrupted Responses

```
User: "Write a 1000-line React component"
  ↓
Claude CLI starts generating...
  ↓
[500 lines generated]
  ↓
User: "Actually, make it shorter" ← Interrupts
  ↓
First process killed, second starts
  ↓
First response LOST (not saved to session.jsonl)
```

**Issue**: The first response is incomplete and not persisted.

### ❌ Problem: No Queue Management

If user rapidly sends 3 messages:

```
Message 1: "Explain React hooks"
Message 2: "Explain useState"
Message 3: "Explain useEffect"
```

**Current Behavior**:

- Message 1 starts → immediately killed by Message 2
- Message 2 starts → immediately killed by Message 3
- Only Message 3 completes

**Expected Behavior** (not implemented):

- Message 1 completes
- Message 2 waits in queue
- Message 3 waits in queue

---

## Proposed Solution (Not Implemented)

### Option 1: Queue Messages Per Session

```typescript
class SessionManager {
  private messageQueues = new Map<SessionId, MessageQueue>();

  async sendMessage(sessionId: SessionId, content: string): Promise<void> {
    const queue = this.messageQueues.get(sessionId) || new MessageQueue();

    // Add to queue
    await queue.enqueue({
      content,
      timestamp: Date.now(),
    });

    // Process queue sequentially
    if (!queue.isProcessing) {
      await this.processQueue(sessionId, queue);
    }
  }

  private async processQueue(sessionId: SessionId, queue: MessageQueue): Promise<void> {
    while (!queue.isEmpty()) {
      const message = queue.dequeue();
      await this.spawnClaudeCliProcess(sessionId, message.content);
      // Wait for process to complete before next message
    }
  }
}
```

**Benefits**:

- No interrupted responses
- All messages are processed
- Sequential conversation flow

**Drawbacks**:

- User cannot interrupt long-running responses
- Latency increases with queue depth

### Option 2: Allow Interruption with User Confirmation

```typescript
// Frontend
if (isStreaming()) {
  const confirmed = await showDialog({
    message: 'Claude is currently responding. Send new message?',
    buttons: ['Wait', 'Interrupt'],
  });

  if (confirmed === 'Interrupt') {
    await rpcService.stopChat(sessionId);
    await rpcService.startChat(sessionId, newMessage);
  }
}
```

**Benefits**:

- User controls interruption
- Prevents accidental interruptions
- Allows stopping long responses

**Drawbacks**:

- Extra UI friction
- Requires stop RPC method

### Option 3: Debounce Message Sending

```typescript
const debouncedSendMessage = debounce(async (content: string) => {
  await chatService.sendMessage(content);
}, 1000); // 1 second delay

// User types rapidly → only last message sent
```

**Benefits**:

- Prevents rapid-fire interruptions
- Matches user intent (latest message)

**Drawbacks**:

- Delays message sending
- Doesn't solve mid-response interruption

---

## Claude CLI Behavior

### Native Interruption Support

Claude CLI **does support** interruption via `Ctrl+C` (SIGINT):

```bash
$ claude "Write a long essay"
[Claude starts generating...]
^C  # User presses Ctrl+C
Session interrupted. Partial response discarded.
```

**Key Points**:

- Partial responses are NOT saved to session.jsonl
- Session state is preserved (previous messages intact)
- Next message continues from last complete turn

### Our Implementation

```typescript
// ProcessManager.killProcess()
killProcess(sessionId: SessionId): void {
  const process = this.processes.get(sessionId);
  if (process && !process.killed) {
    process.kill('SIGTERM'); // ← Sends SIGTERM signal
  }
  this.processes.delete(sessionId);
}
```

**Matches CLI behavior**: Interrupted processes discard partial responses.

---

## Recommendations

### Short-Term (Current Behavior is Acceptable)

**Reasoning**:

- Claude CLI is designed for interruption (Ctrl+C)
- Users expect ability to correct/interrupt LLM responses
- Queueing adds complexity without clear benefit

**UI Improvement**:

```typescript
// Show "Interrupting..." state when new message sent while streaming
if (isStreaming()) {
  showNotification('Interrupting current response...');
}
```

### Medium-Term (Add Stop Button)

**Implementation**:

```typescript
// RPC method to stop current chat
rpcHandler.registerMethod('chat:stop', async (params: any) => {
  const { sessionId } = params;
  processManager.killProcess(sessionId);
  return { success: true };
});

// Frontend ChatStreamingStatusComponent
<button (click)="onStopStreaming()">Stop Generating</button>
```

**Benefits**:

- Explicit user control
- No accidental interruptions
- Preserves current behavior (kill process)

### Long-Term (Optional Queueing)

**Make it opt-in**:

```jsonc
// settings.json
{
  "ptah.chat.queueMessages": false, // Default: allow interruption
  "ptah.chat.confirmInterruption": true // Show dialog before interrupting
}
```

**Implementation**: Only add if users request it.

---

## Current State Summary

### ✅ What Works

1. **One message at a time per session** (enforced by ProcessManager)
2. **Interruption supported** (matches Claude CLI behavior)
3. **Session state preserved** (only complete turns saved)
4. **No race conditions** (ProcessManager handles process lifecycle)

### ⚠️ Known Limitations

1. **No queue** - Rapid messages interrupt each other
2. **No UI feedback** - User doesn't see "interrupting" state
3. **No stop button** - Can't explicitly stop long responses
4. **Partial responses lost** - Expected behavior, matches CLI

### 📝 Future Improvements

1. **Add stop button** (Priority: High)
2. **Show "Interrupting..." toast** (Priority: Medium)
3. **Optional message queueing** (Priority: Low)
4. **Confirmation dialog** (Priority: Low)

---

## Testing Concurrent Messages

### Manual Test

1. Start chat with long response:

   ```
   "Write a comprehensive guide to React hooks with 2000 words"
   ```

2. After 5 seconds, send another message:

   ```
   "Actually, just explain useState in 100 words"
   ```

3. **Expected Result**:
   - First response stops mid-stream
   - Second response starts immediately
   - Session history shows only second complete turn

### Debug Points

**Backend**:

```typescript
// libs/backend/claude-domain/src/cli/process-manager.ts:20
killProcess(sessionId: SessionId): void {
  console.log('[ProcessManager] Killing process for session:', sessionId);
  // ...
}
```

**Frontend**:

```typescript
// libs/frontend/core/src/lib/services/chat.service.ts:140
async sendMessage(content: string, files?: string[]): Promise<void> {
  console.log('[ChatService] Sending message while streaming:', this.isStreaming());
  // ...
}
```

---

## Conclusion

**Current behavior is acceptable** because:

1. It matches Claude CLI's native interruption behavior
2. Users expect ability to interrupt/correct LLM responses
3. No data loss (session state preserved)
4. Simple implementation (no complex queueing)

**Future improvements are nice-to-have**, not critical.

The key insight: **This is a feature, not a bug**. Users should be able to interrupt and redirect the conversation.
