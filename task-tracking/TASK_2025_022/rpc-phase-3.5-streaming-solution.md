# RPC Migration Phase 3.5: Streaming Gap Solution

**Last Updated**: 2025-11-23
**Context**: TASK_2025_021 completed Phases 1-3 (RPC system), Phase 3.5 restores real-time streaming

---

## Problem Statement

**Current State** (after TASK_2025_021 Phase 1-3):

- ✅ RPC system exists (`RpcHandler`, `ClaudeRpcService`)
- ✅ Session loading works (reads `.jsonl` files)
- ✅ Message sending works (spawns CLI)
- ❌ **Streaming broken**: `ClaudeCliLauncher` has `// TODO: Phase 2 RPC` comments where EventBus calls were deleted
- ❌ **No real-time UX**: Messages don't stream word-by-word to frontend

**Root Cause**: EventBus deletion left parser callbacks incomplete (lines 319-410 in `claude-cli-launcher.ts`).

---

## Solution Architecture

**Goal**: Wire parser callbacks → postMessage → frontend signals WITHOUT recreating EventBus complexity.

```
ClaudeCliLauncher (spawns CLI + parser)
  ↓ Parser callbacks (onContent, onThinking, onTool, etc.)
Backend RpcHandler (NEW: streaming postMessage endpoints)
  ↓ postMessage(type, chunk)
Frontend VSCodeService (message listener)
  ↓ Route by type
ChatStoreService (append content to signals)
  ↓ Signal change detection
ChatMessageContentComponent (renders updated contentBlocks)
  ↓ Real-time streaming UX restored ✅
```

---

## Phase 3.5 Implementation (< 4 hours)

### Backend Changes (1-2 hours)

**File**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts`

#### Step 1: Replace TODO Comments with postMessage Forwarding

**Current Code** (lines 319-410):

```typescript
const callbacks: JSONLParserCallbacks = {
  onSessionInit: (claudeSessionId, model) => {
    // TODO: Phase 2 RPC - Restore via RPC
    this.deps.sessionManager?.setClaudeSessionId?.(sessionId, claudeSessionId);
    this.deps.eventPublisher?.emitSessionInit?.(sessionId, claudeSessionId, model);
  },

  onContent: (chunk) => {
    // TODO: Phase 2 RPC - Restore via RPC
    this.deps.sessionManager?.touchSession?.(sessionId);
    this.deps.eventPublisher?.emitContentChunk?.(sessionId, chunk.blocks);
    pushWithBackpressure({ type: 'content', data: chunk });
  },

  // ... 8 more TODO comments
};
```

**Updated Code** (Phase 3.5):

```typescript
// Add webview dependency to LauncherDependencies interface
export interface LauncherDependencies {
  readonly permissionService: PermissionService;
  readonly processManager: ProcessManager;
  readonly webview: vscode.Webview; // ← NEW: Direct webview access for postMessage
  readonly context: vscode.ExtensionContext;
}

// Replace callbacks with simple postMessage forwarding
const callbacks: JSONLParserCallbacks = {
  onSessionInit: (claudeSessionId, model) => {
    this.deps.webview.postMessage({
      type: 'streaming:session-init',
      data: { sessionId: sessionId.value, claudeSessionId, model },
    });
  },

  onContent: (chunk) => {
    // ✅ CORRECT: Forward chunk AS-IS with blocks array intact
    this.deps.webview.postMessage({
      type: 'streaming:content',
      data: {
        sessionId: sessionId.value,
        chunk, // { type: 'content', blocks: ContentBlock[], timestamp }
      },
    });
  },

  onThinking: (event) => {
    this.deps.webview.postMessage({
      type: 'streaming:thinking',
      data: { sessionId: sessionId.value, event },
    });
  },

  onTool: (event) => {
    this.deps.webview.postMessage({
      type: 'streaming:tool',
      data: { sessionId: sessionId.value, event },
    });
  },

  onPermission: async (request) => {
    // Permission requires user interaction (already implemented)
    await this.handlePermissionRequest(sessionId, request, childProcess);
  },

  onAgentStart: (event) => {
    this.deps.webview.postMessage({
      type: 'streaming:agent-start',
      data: { sessionId: sessionId.value, event },
    });
  },

  onAgentActivity: (event) => {
    this.deps.webview.postMessage({
      type: 'streaming:agent-activity',
      data: { sessionId: sessionId.value, event },
    });
  },

  onAgentComplete: (event) => {
    this.deps.webview.postMessage({
      type: 'streaming:agent-complete',
      data: { sessionId: sessionId.value, event },
    });
  },

  onMessageStop: () => {
    this.deps.webview.postMessage({
      type: 'streaming:message-stop',
      data: { sessionId: sessionId.value },
    });
  },

  onResult: (result) => {
    this.deps.webview.postMessage({
      type: 'streaming:result',
      data: { sessionId: sessionId.value, result },
    });
  },

  onError: (error, rawLine) => {
    console.error('[ClaudeCliLauncher] Parser error:', error.message);
    this.deps.webview.postMessage({
      type: 'streaming:error',
      data: {
        sessionId: sessionId.value,
        message: error.message,
        rawLine,
      },
    });
  },
};
```

**Lines Changed**: ~100 lines (8 TODO replacements + interface update)

**Complexity**: Low (simple postMessage calls, no transformation)

---

### Frontend Changes (1-2 hours)

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

#### Step 2: Add Message Listeners

```typescript
import { Injectable, inject } from '@angular/core';
import { ChatStoreService } from './chat-store.service';

@Injectable({
  providedIn: 'root',
})
export class VSCodeService {
  private readonly chatStore = inject(ChatStoreService);

  constructor() {
    // Listen for streaming messages from backend
    window.addEventListener('message', (event) => {
      const message = event.data;
      this.handleBackendMessage(message);
    });
  }

  private handleBackendMessage(message: { type: string; data: unknown }): void {
    switch (message.type) {
      case 'streaming:session-init':
        this.handleSessionInit(message.data);
        break;

      case 'streaming:content':
        this.handleContentChunk(message.data);
        break;

      case 'streaming:thinking':
        this.handleThinking(message.data);
        break;

      case 'streaming:tool':
        this.handleTool(message.data);
        break;

      case 'streaming:agent-start':
        this.handleAgentStart(message.data);
        break;

      case 'streaming:agent-activity':
        this.handleAgentActivity(message.data);
        break;

      case 'streaming:agent-complete':
        this.handleAgentComplete(message.data);
        break;

      case 'streaming:message-stop':
        this.handleMessageStop(message.data);
        break;

      case 'streaming:result':
        this.handleResult(message.data);
        break;

      case 'streaming:error':
        this.handleError(message.data);
        break;

      // Existing RPC response handling
      case 'rpc:response':
        this.handleRpcResponse(message.data);
        break;
    }
  }

  private handleSessionInit(data: { sessionId: string; claudeSessionId: string; model?: string }): void {
    console.log('[VSCodeService] Session initialized:', data);
    // Update session metadata if needed
  }

  private handleContentChunk(data: { sessionId: string; chunk: ClaudeContentChunk }): void {
    this.chatStore.appendContentChunk(data.chunk);
  }

  private handleThinking(data: { sessionId: string; event: ClaudeThinkingEvent }): void {
    // Thinking is already in contentBlocks (parser includes it)
    // This callback is for analytics/logging only
    console.log('[VSCodeService] Thinking event:', data.event);
  }

  private handleTool(data: { sessionId: string; event: ClaudeToolEvent }): void {
    // Tool events update tool timeline UI (optional)
    this.chatStore.updateToolTimeline(data.event);
  }

  private handleAgentStart(data: { sessionId: string; event: ClaudeAgentStartEvent }): void {
    this.chatStore.addAgent(data.event);
  }

  private handleAgentActivity(data: { sessionId: string; event: ClaudeAgentActivityEvent }): void {
    this.chatStore.updateAgentActivity(data.event);
  }

  private handleAgentComplete(data: { sessionId: string; event: ClaudeAgentCompleteEvent }): void {
    this.chatStore.completeAgent(data.event);
  }

  private handleMessageStop(data: { sessionId: string }): void {
    console.log('[VSCodeService] Message streaming complete');
    this.chatStore.finalizeStreamingMessage();
  }

  private handleResult(data: { sessionId: string; result: JSONLResultMessage }): void {
    console.log('[VSCodeService] Final result:', data.result);
    // Update token usage UI
    this.chatStore.updateTokenUsage({
      inputTokens: data.result.usage?.input_tokens || 0,
      outputTokens: data.result.usage?.output_tokens || 0,
      cacheReadTokens: data.result.usage?.cache_read_input_tokens || 0,
      cacheCreationTokens: data.result.usage?.cache_creation_input_tokens || 0,
      totalCost: data.result.total_cost_usd || 0,
    });
  }

  private handleError(data: { sessionId: string; message: string; rawLine?: string }): void {
    console.error('[VSCodeService] Streaming error:', data);
    // Show error toast
    this.chatStore.addErrorMessage(data.message);
  }

  private handleRpcResponse(data: RpcResponse): void {
    // Existing RPC handling (from Phase 2)
    this.rpcService.resolveCall(data);
  }
}
```

**Lines Added**: ~100 lines (message router + handlers)

---

**File**: `libs/frontend/chat/src/lib/services/chat-store.service.ts`

#### Step 3: Update ChatStoreService Signal Logic

```typescript
import { Injectable } from '@angular/core';
import { signal, computed } from '@angular/core';
import { ProcessedClaudeMessage, ClaudeContentChunk, MessageId, SessionId } from '@ptah-extension/shared';

@Injectable({
  providedIn: 'root',
})
export class ChatStoreService {
  private _messages = signal<ProcessedClaudeMessage[]>([]);
  readonly messages = this._messages.asReadonly();

  private _isStreaming = signal(false);
  readonly isStreaming = this._isStreaming.asReadonly();

  readonly messageCount = computed(() => this.messages().length);

  /**
   * Append content chunk to existing streaming message
   * Called by VSCodeService when 'streaming:content' message received
   */
  appendContentChunk(chunk: ClaudeContentChunk): void {
    this._messages.update((messages) => {
      const lastMessage = messages[messages.length - 1];

      if (lastMessage && lastMessage.streaming) {
        // Append blocks to existing streaming message
        return messages.map((msg, idx) =>
          idx === messages.length - 1
            ? {
                ...msg,
                contentBlocks: [...msg.contentBlocks, ...chunk.blocks],
                timestamp: chunk.timestamp, // Update timestamp
              }
            : msg
        );
      }

      // Create new streaming message if none exists
      const newMessage: ProcessedClaudeMessage = {
        id: MessageId.create(),
        type: 'assistant',
        content: chunk.blocks,
        contentBlocks: chunk.blocks,
        timestamp: chunk.timestamp,
        streaming: true,
      };

      return [...messages, newMessage];
    });

    this._isStreaming.set(true);
  }

  /**
   * Finalize streaming message (called on message_stop)
   */
  finalizeStreamingMessage(): void {
    this._messages.update((messages) => messages.map((msg) => ({ ...msg, streaming: false })));
    this._isStreaming.set(false);
  }

  /**
   * Update tool timeline (optional - for tool execution status UI)
   */
  updateToolTimeline(event: ClaudeToolEvent): void {
    // Update tool execution state in separate signal if needed
    console.log('[ChatStore] Tool event:', event);
  }

  /**
   * Add agent to tracking (for agent tree UI)
   */
  addAgent(event: ClaudeAgentStartEvent): void {
    // Track active agents in separate signal
    console.log('[ChatStore] Agent started:', event);
  }

  updateAgentActivity(event: ClaudeAgentActivityEvent): void {
    console.log('[ChatStore] Agent activity:', event);
  }

  completeAgent(event: ClaudeAgentCompleteEvent): void {
    console.log('[ChatStore] Agent completed:', event);
  }

  /**
   * Update token usage stats
   */
  updateTokenUsage(usage: TokenUsage): void {
    console.log('[ChatStore] Token usage:', usage);
    // Update token usage signal for ChatTokenUsageComponent
  }

  /**
   * Add error message to chat
   */
  addErrorMessage(errorText: string): void {
    const errorMessage: ProcessedClaudeMessage = {
      id: MessageId.create(),
      type: 'system',
      content: errorText,
      contentBlocks: [{ type: 'text', text: errorText }],
      timestamp: Date.now(),
      streaming: false,
    };

    this._messages.update((messages) => [...messages, errorMessage]);
  }
}
```

**Lines Modified**: ~60 lines (signal updates)

---

### Component Wiring (No Changes Needed!)

**ChatComponent** already uses `ChatStoreService` signals:

```typescript
// libs/frontend/chat/src/lib/containers/chat/chat.component.ts (EXISTING)
@Component({
  selector: 'ptah-chat',
  template: `
    <ptah-chat-streaming-status [isVisible]="chatStore.isStreaming()" [streamingMessage]="'Claude is responding...'" [canStop]="true" (stopStreaming)="handleStopStreaming()" />

    <ptah-chat-messages-list [messages]="chatStore.messages()" [isStreaming]="chatStore.isStreaming()" />
  `,
})
export class ChatComponent {
  protected readonly chatStore = inject(ChatStoreService);

  protected handleStopStreaming(): void {
    // Send RPC call to kill CLI process
    this.claudeRpcService.call('chat:stopMessage', {});
  }
}
```

**No changes needed**: Signal reactivity auto-updates UI!

---

## Verification Checklist

After implementing Phase 3.5, verify:

- [ ] **Messages stream in real-time**: Type message → see word-by-word response
- [ ] **No message duplication**: Each content chunk appears exactly once
- [ ] **Thinking blocks appear live**: `<thinking>` content shows during streaming
- [ ] **Tool usage shows in timeline**: Tool execution (start/result/error) visible
- [ ] **Agent activity renders correctly**: Agent tree shows nested agent tools
- [ ] **No EventBus-style event splitting**: All blocks arrive in `contentBlocks` array
- [ ] **ChatStreamingStatusComponent shows during stream**: Banner visible with "Claude is responding..."
- [ ] **ChatStreamingStatusComponent hides on message_stop**: Banner disappears when streaming ends
- [ ] **Token usage updates**: Final result shows cost/duration in UI
- [ ] **Stop button works**: Kills CLI process, streaming stops immediately

---

## Testing Commands

```bash
# 1. Build backend (verify no TypeScript errors)
npx nx build claude-domain

# 2. Build frontend (verify no TypeScript errors)
npx nx build chat

# 3. Launch extension in VS Code
npm run watch  # Terminal 1: Watch mode
F5             # VS Code: Launch Extension Development Host

# 4. Test streaming
# - Open chat UI in extension
# - Send message: "Explain how React hooks work"
# - Verify: Word-by-word typing effect visible
# - Verify: Thinking blocks appear live
# - Verify: No duplicate text

# 5. Test stop button
# - Send long message: "Write a 1000 line React component"
# - Click stop button mid-stream
# - Verify: Streaming stops immediately
```

---

## Estimated Effort

**Total**: < 4 hours (experienced developer)

| Task                              | Estimated Time |
| --------------------------------- | -------------- |
| Backend: Replace TODO comments    | 1 hour         |
| Frontend: Add message listeners   | 1 hour         |
| Frontend: Update ChatStoreService | 30 min         |
| Testing & Debugging               | 1 hour         |
| Documentation                     | 30 min         |

**Complexity**: Low (mostly copy-paste templates, simple postMessage forwarding)

---

## What NOT to Do (EventBus Traps)

### ❌ WRONG: Transform chunks before forwarding

```typescript
// DON'T DO THIS
onContent: (chunk) => {
  const transformed = {
    text: chunk.blocks.filter((b) => b.type === 'text'),
    tools: chunk.blocks.filter((b) => b.type === 'tool_use'),
  };
  this.deps.webview.postMessage('content', transformed); // ❌ Split!
};
```

**Why Wrong**: Destroys unified structure, recreates EventBus splitting.

### ❌ WRONG: Buffer chunks before sending

```typescript
// DON'T DO THIS
private buffer: ClaudeContentChunk[] = [];

onContent: (chunk) => {
  this.buffer.push(chunk); // ❌ Buffer!

  if (this.buffer.length >= 10) {
    this.deps.webview.postMessage('content', this.buffer); // ❌ Delay!
    this.buffer = [];
  }
};
```

**Why Wrong**: Destroys real-time streaming, adds visible lag.

### ❌ WRONG: Create new event taxonomy

```typescript
// DON'T DO THIS
onContent: (chunk) => {
  this.deps.webview.postMessage('MESSAGE_CHUNK_STARTED', chunk); // ❌ New event
  this.deps.webview.postMessage('MESSAGE_PROCESSING', chunk); // ❌ New event
  this.deps.webview.postMessage('MESSAGE_READY_TO_RENDER', chunk); // ❌ New event
};
```

**Why Wrong**: Complexity explosion, recreates EventBus architecture.

---

## Summary

**Phase 3.5 Solution**:

- **Backend**: Replace 8 TODO comments with postMessage forwarding (~100 lines)
- **Frontend**: Add message router + ChatStoreService updates (~160 lines)
- **Total Code**: ~260 lines (vs 14,000 lines EventBus deleted)
- **Estimated Time**: < 4 hours
- **Result**: Real-time streaming restored WITHOUT recreating EventBus complexity

**Key Insight**: Streaming is SIMPLE when you preserve unified message structure. Don't transform, don't split, don't buffer — just forward.

**Next Steps**: See `anti-patterns-and-mistakes.md` to avoid recreating EventBus.
