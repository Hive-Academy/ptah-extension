# Implementation Plan: Message Queue & Session Control

## Overview

This document outlines the implementation plan for two related features:
1. **Message Queue** - Allow users to queue messages while Claude is working
2. **Session Control** - Stop/interrupt Claude mid-response

## Research Summary

### Experiment Results (Validated)

| Test | Result | Finding |
|------|--------|---------|
| Interactive mode (no -p) | Works | Claude processes after stdin.end() |
| stdin.end vs newline | stdin.end required | Newline alone doesn't trigger processing |
| SIGINT interrupt | Works | Clean interruption with SIGINT |
| Multiple messages per process | Failed | Session closes after result |
| --resume pattern | Works | Context preserved across processes |

### Key Insights

1. **Claude CLI is spawn-per-turn by design** - Each message requires a new process
2. **stdin.end() is the submit trigger** - Not newline character
3. **--resume maintains context** - Session ID links conversations
4. **SIGINT cleanly interrupts** - Can stop mid-response

### Sources Referenced

- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Claude Agent SDK TypeScript](https://docs.claude.com/en/docs/claude-code/sdk/sdk-typescript)
- [node-pty (Microsoft)](https://github.com/microsoft/node-pty)
- [VS Code Terminal Advanced](https://code.visualstudio.com/docs/terminal/advanced)

## Architecture

### Option A: Queue + --resume Pattern (Recommended)

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (Angular)                      │
├─────────────────────────────────────────────────────────────┤
│  ChatStore                                                   │
│  ├── _messages: Signal<Message[]>                           │
│  ├── _queuedMessages: Signal<QueuedMessage[]>  [NEW]        │
│  ├── _isStreaming: Signal<boolean>                          │
│  └── stopCurrentResponse()  [NEW]                           │
├─────────────────────────────────────────────────────────────┤
│  ChatViewComponent                                           │
│  ├── Message List                                           │
│  ├── Streaming Indicator                                    │
│  ├── Queued Messages Display  [NEW]                         │
│  └── Chat Input (always enabled)  [MODIFIED]                │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ RPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Backend (VS Code)                       │
├─────────────────────────────────────────────────────────────┤
│  RpcMethodRegistrationService                               │
│  ├── chat:start                                             │
│  ├── chat:continue                                          │
│  ├── chat:abort  → chat:stop (SIGINT)  [RENAMED]           │
│  └── chat:queue  [NEW - optional backend queue]             │
├─────────────────────────────────────────────────────────────┤
│  SessionProcessManager  [NEW]                               │
│  ├── Map<SessionId, SessionProcess>                         │
│  ├── spawnProcess(sessionId, prompt)                        │
│  ├── stopProcess(sessionId) → SIGINT                        │
│  └── getActiveProcess(sessionId)                            │
└─────────────────────────────────────────────────────────────┘
```

### Message Queue Flow

```
User sends message
        │
        ▼
┌───────────────────┐     Yes    ┌─────────────────────┐
│   isStreaming?    │──────────▶│  Add to queue       │
└───────────────────┘            │  Show visual        │
        │ No                     │  indicator          │
        ▼                        └─────────────────────┘
┌───────────────────┐
│  Start process    │
│  Stream response  │
└───────────────────┘
        │
        ▼ (on close)
┌───────────────────┐     Yes    ┌─────────────────────┐
│  Queue has items? │──────────▶│  Pop first item     │
└───────────────────┘            │  Start with --resume│
        │ No                     └─────────────────────┘
        ▼
┌───────────────────┐
│  Set state: idle  │
└───────────────────┘
```

### Stop Flow

```
User clicks Stop
        │
        ▼
┌───────────────────┐
│  Send SIGINT      │
│  to process       │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Clear streaming  │
│  Finalize message │
└───────────────────┘
        │
        ▼
┌───────────────────┐     Yes    ┌─────────────────────┐
│  Process queue?   │──────────▶│  Show user choice   │
└───────────────────┘            │  Keep/Clear queue   │
        │ No                     └─────────────────────┘
        ▼
┌───────────────────┐
│  Ready for input  │
└───────────────────┘
```

## Implementation Plan

### Phase 1: Message Queue (Frontend Focus)

#### Task 1.1: Extend ChatStore with Queue State

```typescript
// libs/frontend/chat/src/lib/services/chat.store.ts

interface QueuedMessage {
  id: string;
  content: string;
  files?: string[];
  queuedAt: number;
}

// Add to ChatStore:
private readonly _queuedMessages = signal<readonly QueuedMessage[]>([]);
readonly queuedMessages = this._queuedMessages.asReadonly();

// Queue a message
queueMessage(content: string, files?: string[]): void {
  const queued: QueuedMessage = {
    id: this.generateId(),
    content,
    files,
    queuedAt: Date.now(),
  };
  this._queuedMessages.update(q => [...q, queued]);
}

// Cancel queued message
cancelQueuedMessage(id: string): void {
  this._queuedMessages.update(q => q.filter(m => m.id !== id));
}

// Process next in queue (called on process close)
private processQueue(): void {
  const queue = this._queuedMessages();
  if (queue.length === 0) return;

  const [next, ...rest] = queue;
  this._queuedMessages.set(rest);

  // Continue conversation with queued message
  this.continueConversation(next.content, next.files);
}
```

#### Task 1.2: Create QueuedMessageComponent

```typescript
// libs/frontend/chat/src/lib/components/molecules/queued-message.component.ts

@Component({
  selector: 'ptah-queued-message',
  template: `
    <div class="chat chat-end opacity-60">
      <div class="chat-bubble chat-bubble-primary relative group">
        <!-- Queued badge -->
        <div class="badge badge-sm badge-warning absolute -top-2 -right-2">
          <lucide-angular [img]="ClockIcon" class="w-3 h-3 mr-1" />
          Queued
        </div>

        <!-- Message content -->
        <markdown [data]="message().content" class="prose prose-sm" />

        <!-- Action buttons (hover) -->
        <div class="absolute -left-8 top-1/2 -translate-y-1/2
                    opacity-0 group-hover:opacity-100 transition-opacity
                    flex flex-col gap-1">
          <button
            class="btn btn-xs btn-circle btn-ghost"
            (click)="onCancel.emit()"
            title="Cancel"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" />
          </button>
        </div>
      </div>

      <!-- Queue position indicator -->
      <div class="chat-footer text-xs opacity-50">
        {{ position() > 1 ? '#' + position() + ' in queue' : 'Next up' }}
      </div>
    </div>
  `
})
export class QueuedMessageComponent {
  readonly message = input.required<QueuedMessage>();
  readonly position = input.required<number>();
  readonly onCancel = output<void>();

  readonly ClockIcon = Clock;
  readonly XIcon = X;
}
```

#### Task 1.3: Update ChatViewComponent

```html
<!-- chat-view.component.html -->
<div class="flex flex-col h-full">
  <!-- Message List -->
  <div class="flex-1 overflow-y-auto p-4 space-y-3" #messageContainer>
    @for (message of chatStore.messages(); track message.id) {
      <ptah-message-bubble [message]="message" />
    }

    <!-- Streaming indicator with Stop button -->
    @if (chatStore.isStreaming()) {
      <div class="flex items-center gap-2 text-sm text-base-content/60 ml-4">
        <span class="loading loading-dots loading-sm"></span>
        Claude is responding...
        <button
          class="btn btn-xs btn-ghost text-error"
          (click)="stopResponse()"
        >
          <lucide-angular [img]="StopCircleIcon" class="w-4 h-4" />
          Stop
        </button>
      </div>
    }

    <!-- Queued messages (NEW) -->
    @if (chatStore.queuedMessages().length > 0) {
      <div class="border-t border-dashed border-base-300 pt-3 mt-3">
        <div class="text-xs text-base-content/50 mb-2 ml-4">
          Queued messages (will send when Claude finishes)
        </div>
        @for (queued of chatStore.queuedMessages(); track queued.id; let i = $index) {
          <ptah-queued-message
            [message]="queued"
            [position]="i + 1"
            (onCancel)="cancelQueued(queued.id)"
          />
        }
      </div>
    }
  </div>

  <!-- Input Area (always enabled) -->
  <ptah-chat-input class="border-t border-base-300" />
</div>
```

#### Task 1.4: Update ChatInputComponent

```typescript
// Remove disable when streaming - always allow typing
readonly isDisabled = computed(() => false); // Was: this.chatStore.isStreaming()

// Smart send: queue if streaming, send if not
async handleSend(): Promise<void> {
  const content = this.currentMessage().trim();
  if (!content) return;

  if (this.chatStore.isStreaming()) {
    // Queue the message
    this.chatStore.queueMessage(content, this.selectedFiles());
  } else {
    // Send immediately
    await this.chatStore.sendMessage(content, this.selectedFiles());
  }

  this._currentMessage.set('');
  this.clearFiles();
}
```

### Phase 2: Stop Functionality (Backend + Frontend)

#### Task 2.1: Add chat:stop RPC Method

```typescript
// libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts

// Rename chat:abort to chat:stop with SIGINT
this.rpcHandler.registerMethod('chat:stop', async (params: any) => {
  try {
    const { sessionId } = params;
    this.logger.debug('RPC: chat:stop called', { sessionId });

    const process = this.activeProcesses.get(sessionId);
    if (process && process.isRunning()) {
      // Send SIGINT for clean interrupt (not SIGTERM/SIGKILL)
      process.kill('SIGINT');
      this.activeProcesses.delete(sessionId);
      return { success: true, interrupted: true };
    }

    return { success: false, error: 'No active process for session' };
  } catch (error) {
    // ... error handling
  }
});
```

#### Task 2.2: Add stopCurrentResponse to ChatStore

```typescript
// libs/frontend/chat/src/lib/services/chat.store.ts

async stopCurrentResponse(): Promise<void> {
  if (!this._isStreaming()) return;

  const sessionId = this._currentSessionId();
  if (!sessionId) return;

  try {
    const result = await this.claudeRpcService.call<{ interrupted: boolean }>(
      'chat:stop',
      { sessionId }
    );

    if (result.success) {
      console.log('[ChatStore] Response stopped');
      this.finalizeCurrentMessage(); // Mark current message as complete
      this._isStreaming.set(false);
    }
  } catch (error) {
    console.error('[ChatStore] Failed to stop response:', error);
  }
}
```

### Phase 3: Queue Processing (Auto-continue)

#### Task 3.1: Handle Process Close with Queue Check

```typescript
// In RpcMethodRegistrationService - process close handler

process.on('close', (code: number | null) => {
  this.logger.debug('ClaudeProcess closed', { sessionId, code });
  this.activeProcesses.delete(sessionId);

  this.webviewManager.sendMessage('ptah.main', 'chat:complete', {
    sessionId,
    code,
    // Signal frontend to check queue
    shouldProcessQueue: true,
  });
});
```

#### Task 3.2: Frontend Queue Processing

```typescript
// In ChatStore or VSCodeService message handler

handleChatComplete(data: { sessionId: string; code: number; shouldProcessQueue: boolean }) {
  this._isStreaming.set(false);
  this.finalizeCurrentMessage();

  // Process queue after short delay (UX)
  if (data.shouldProcessQueue) {
    setTimeout(() => this.processQueue(), 500);
  }
}
```

## Visual Design

### Queued Message Appearance

```
┌──────────────────────────────────────────────────────────────┐
│                        Chat Messages                          │
│                                                               │
│  [User] How do I implement authentication?                   │
│                                                               │
│  [Claude] Let me help you with authentication...             │
│           [streaming dots] Claude is responding... [Stop]    │
│                                                               │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Queued messages (will send when Claude finishes)            │
│                                                               │
│                    ┌─────────────────────────┐                │
│              [X]   │ Also add rate limiting  │ [Queued]      │
│                    │ to the endpoints        │  Next up      │
│                    └─────────────────────────┘                │
│                                                               │
│                    ┌─────────────────────────┐                │
│              [X]   │ And don't forget CORS   │ [Queued]      │
│                    │ configuration           │  #2 in queue  │
│                    └─────────────────────────┘                │
│                                                               │
├──────────────────────────────────────────────────────────────┤
│  [Input always enabled - type next message here...]    [Send]│
└──────────────────────────────────────────────────────────────┘
```

### States

| State | Input | Send Button | Indicator |
|-------|-------|-------------|-----------|
| Idle | Enabled | "Send" | None |
| Streaming | Enabled | "Queue" or "Send" | Streaming + Stop |
| Has Queue | Enabled | "Send"/"Queue" | Queue count badge |

## Future Enhancements

### Multi-Session Support (Phase 2)

When implementing tab-based sessions (from future-enhancements doc):

```typescript
// SessionProcessManager for concurrent sessions
class SessionProcessManager {
  private sessions = new Map<SessionId, SessionProcess>();

  // Each session independent
  async spawnForSession(sessionId: SessionId, prompt: string) {
    const existing = this.sessions.get(sessionId);
    if (existing?.isRunning()) {
      // Queue or error based on policy
    }

    const process = new SessionProcess(sessionId);
    await process.spawn(prompt);
    this.sessions.set(sessionId, process);
  }

  // Multiple sessions can stream concurrently
  getActiveSessions(): SessionId[] {
    return [...this.sessions.entries()]
      .filter(([_, p]) => p.isRunning())
      .map(([id]) => id);
  }
}
```

### node-pty Integration (Deferred - Not Recommended)

**Status: DEFERRED** - Native dependency complexity outweighs benefits.

While `node-pty` would enable true interactive control (send messages while Claude works, Esc key interrupt), it has significant drawbacks:
- Native compilation required (node-gyp)
- Windows complexity (conpty vs winpty)
- Build failures common on different environments
- VS Code extension packaging complexity

The queue + --resume pattern works reliably and covers 95% of use cases. The only lost feature is "send message while Claude is mid-response" which queues instead of interrupts.

**If revisited in future**: Consider `@lydell/node-pty` (prebuilt binaries) or `node-pty-prebuilt-multiarch`.

## Testing Plan

### Unit Tests

1. **ChatStore queue operations**
   - queueMessage adds to queue
   - cancelQueuedMessage removes from queue
   - processQueue pops and sends
   - Queue cleared on session change

2. **Stop functionality**
   - stopCurrentResponse sends RPC
   - Streaming state cleared
   - Current message finalized

### Integration Tests

1. **End-to-end queue flow**
   - Send message → streams
   - Send second message → queued
   - First completes → second auto-sends

2. **Stop and continue**
   - Send message → streams
   - Click stop → interrupted
   - Send new message → works

### Manual Testing

1. Queue multiple messages rapidly
2. Stop mid-response, verify cleanup
3. Stop with queue, verify queue handling
4. Session switch with queue (should clear)

## Implementation Order

1. **Week 1: Frontend Queue**
   - QueuedMessage type in shared
   - ChatStore queue signals/methods
   - QueuedMessageComponent UI
   - ChatView integration
   - ChatInput always-enabled

2. **Week 2: Stop Functionality**
   - chat:stop RPC method
   - Backend SIGINT handling
   - Frontend stop button
   - Message finalization on stop

3. **Week 3: Auto-Processing**
   - Queue processing on close
   - Visual feedback during processing
   - Edge case handling
   - Testing & polish

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Queue grows too large | Low | Medium | Max queue size (5-10) |
| Stop doesn't cleanup properly | Medium | High | Thorough testing |
| Race conditions in queue | Medium | Medium | Proper state management |
| User confusion about queue | Low | Low | Clear visual design |

## Success Criteria

- [ ] User can type while Claude is responding
- [ ] Messages queue visually at bottom of chat
- [ ] Queued messages can be cancelled
- [ ] Stop button interrupts Claude cleanly
- [ ] Queue auto-processes after response
- [ ] No messages lost during queue/stop operations
- [ ] Performance not impacted by queue
