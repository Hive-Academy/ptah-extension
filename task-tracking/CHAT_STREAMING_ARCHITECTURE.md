# Chat Streaming Architecture - Complete Flow Documentation

**Last Updated**: 2025-11-24
**Context**: Post-TASK_2025_022, RPC Migration Complete

---

## Executive Summary

The Ptah extension uses a **hybrid architecture** for chat functionality:

- **RPC**: Used for initiating chat sessions (`chat:start` method)
- **postMessage Streaming**: Used for real-time message delivery (JSONL format)

**Key Insight**: RPC is NOT used for streaming. The `chat:start` RPC method returns immediately after spawning the Claude CLI process. Streaming happens asynchronously via VS Code's `webview.postMessage()` API.

---

## Complete Message Flow

### 1. User Sends Message

```
User types: "Explain React hooks"
  ↓
ChatInputAreaComponent.sendMessage() emits event
  ↓
ChatComponent.sendMessage() calls ChatService.sendMessage(content)
```

**File**: `libs/frontend/chat/src/lib/containers/chat/chat.component.ts:447-470`

```typescript
public sendMessage(): void {
  const content = this.chatState.currentMessage().trim();
  this.chat.sendMessage(content);  // Calls ChatService
}
```

---

### 2. ChatService Initiates RPC Call

```
ChatService.sendMessage(content)
  ↓
ClaudeRpcService.startChat(sessionId, content, files)
  ↓
VSCodeService.vscode.postMessage({ type: 'rpc:request', method: 'chat:start', ... })
```

**File**: `libs/frontend/core/src/lib/services/chat.service.ts:129-164`

```typescript
async sendMessage(content: string, files?: string[]): Promise<void> {
  const currentSession = this.currentSession();

  // Start chat via RPC - streaming handled by ClaudeCliLauncher postMessage callbacks
  const result = await this.rpcService.startChat(
    currentSession.id,
    content,
    files
  );

  if (!result.isSuccess()) {
    throw new Error(result.error || 'Failed to start chat');
  }

  // RPC returns immediately - streaming happens asynchronously
}
```

**File**: `libs/frontend/core/src/lib/services/claude-rpc.service.ts:184-190`

```typescript
startChat(
  sessionId: SessionId,
  content: string,
  files?: string[]
): Promise<RpcResult<void>> {
  return this.call<void>('chat:start', { sessionId, content, files });
}
```

---

### 3. Backend Receives RPC Request

```
RpcHandler receives 'rpc:request' with method='chat:start'
  ↓
main.ts rpcHandler.registerMethod('chat:start', ...) handler executes
  ↓
ClaudeCliService.sendMessage(sessionId, content, files)
  ↓
ClaudeCliLauncher.spawnTurn() spawns Claude CLI process
```

**File**: `apps/ptah-extension-vscode/src/main.ts:124-150`

```typescript
rpcHandler.registerMethod('chat:start', async (params: any) => {
  const { content, files, sessionId } = params;

  // Start Claude CLI process - streaming happens asynchronously via webview.postMessage
  // The stream itself is handled by ClaudeCliLauncher callbacks (see claude-cli-launcher.ts:321-347)
  await claudeCliService.sendMessage(sessionId, content, files);

  // Return immediately - frontend will receive streaming chunks via 'jsonl-message' postMessage
  return { success: true };
});
```

---

### 4. Claude CLI Process Spawns (Streaming Begins)

```
ClaudeCliLauncher.spawnTurn()
  ↓
spawn('claude', ['--session', sessionId, content])
  ↓
JSONLStreamParser receives stdout lines
  ↓
Parser callbacks forward to webview.postMessage()
```

**File**: `libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:321-347`

```typescript
const callbacks: JSONLParserCallbacks = {
  onMessage: (message) => {
    // ✅ CORRECT: Forward parsed JSONL directly to webview
    this.deps.webview.postMessage({
      type: 'jsonl-message',
      data: {
        sessionId, // SessionId branded type
        message, // Complete JSONL object with type field
      },
    });
  },

  onPermission: async (request) => {
    // Keep existing permission handling (user interaction required)
    await this.handlePermissionRequest(sessionId, request, childProcess);
  },

  onError: (error, rawLine) => {
    // Keep existing error handling (debugging/logging)
    console.error('[ClaudeCliLauncher] Parser error:', error.message);
  },
};
```

**Key Points**:

- **One postMessage per JSONL line** - No buffering, no splitting
- **Unified message structure** - Content blocks array preserved
- **No RPC involvement** - Pure push notification pattern

---

### 5. Frontend Receives Streaming Messages

```
window.addEventListener('message') in VSCodeService
  ↓
VSCodeService.handleJSONLMessage(sessionId, message)
  ↓
Discriminates on message.type
  ↓
Calls ChatStateService.handleAssistantMessage() / handleToolMessage() / etc.
  ↓
Updates signals (_messages, _claudeMessages, _toolTimeline, etc.)
```

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts:275-348`

```typescript
private setupMessageListener(): void {
  window.addEventListener('message', (event) => {
    const message = event.data;

    // Existing RPC message handling
    if (message.type === 'rpc:response') {
      console.debug('[VSCodeService] RPC response:', message);
    }

    // NEW: Unified JSONL message handler
    if (message.type === 'jsonl-message') {
      const { sessionId, message: jsonlMessage } = message.data;
      this.handleJSONLMessage(sessionId, jsonlMessage);
    }
  });
}

private handleJSONLMessage(
  sessionId: SessionId,
  message: JSONLMessage
): void {
  switch (message.type) {
    case 'system':
      if (message.subtype === 'init' && message.session_id) {
        this.chatStateService.handleSessionInit(
          sessionId,
          message.session_id,
          message.model
        );
      }
      break;

    case 'assistant':
      this.chatStateService.handleAssistantMessage(sessionId, message);
      break;

    case 'tool':
      this.chatStateService.handleToolMessage(sessionId, message);
      break;

    case 'permission':
      this.chatStateService.handlePermissionRequest(sessionId, message);
      break;

    case 'stream_event':
      this.chatStateService.handleStreamEvent(sessionId, message);
      break;

    case 'result':
      this.chatStateService.handleResult(sessionId, message);
      break;

    default:
      console.warn('[VSCodeService] Unknown JSONL message type:', message);
  }
}
```

---

### 6. ChatStateService Updates Signals

```
ChatStateService.handleAssistantMessage(message)
  ↓
Extracts content blocks from message.content array
  ↓
Updates _claudeMessages signal (append blocks)
  ↓
Angular change detection triggers
  ↓
ChatMessageContentComponent re-renders with new blocks
```

**File**: `libs/frontend/core/src/lib/services/chat-state.service.ts` (handlers)

**Key Methods**:

- `handleSessionInit()` - Sets Claude session ID and model
- `handleAssistantMessage()` - Appends content blocks (text, thinking, tool_use)
- `handleToolMessage()` - Updates tool timeline
- `handlePermissionRequest()` - Shows permission dialog
- `handleStreamEvent()` - Tracks streaming progress
- `handleResult()` - Updates session metrics (tokens, cost)

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  RPC Layer (Control Plane)                                          │
│  - Initiates chat session                                           │
│  - Returns immediately                                              │
│  - No streaming data                                                │
└─────────────────────────────────────────────────────────────────────┘
         ↓
    Frontend: claudeRpcService.startChat(sessionId, content)
         ↓
    Backend: rpcHandler 'chat:start' method
         ↓
    ClaudeCliService.sendMessage() spawns CLI process
         ↓
         ✅ RPC returns { success: true }

┌─────────────────────────────────────────────────────────────────────┐
│  postMessage Streaming (Data Plane)                                 │
│  - Real-time JSONL chunks                                           │
│  - No RPC correlation needed                                        │
│  - Push-based notifications                                         │
└─────────────────────────────────────────────────────────────────────┘
         ↓
    Claude CLI stdout → JSONLStreamParser
         ↓
    Parser callbacks → webview.postMessage('jsonl-message')
         ↓
    Frontend: window.addEventListener('message')
         ↓
    VSCodeService.handleJSONLMessage()
         ↓
    ChatStateService updates signals
         ↓
    Angular change detection
         ↓
    UI updates in real-time ✅
```

---

## Why This Design?

### ✅ Advantages of Hybrid Architecture

1. **RPC for Control**: Simple request/response for session management
2. **postMessage for Streaming**: Native browser API, no protocol overhead
3. **No Request Matching**: Streaming messages don't need correlation IDs
4. **Unified Message Structure**: Parser preserves content blocks array
5. **Real-time Performance**: No buffering, chunks arrive immediately
6. **Separation of Concerns**: Control plane ≠ data plane

### ❌ Why NOT RPC Streaming?

1. **RPC is request/response** - Not designed for push notifications
2. **Would require correlation IDs** - Overhead for every chunk
3. **Adds complexity** - postMessage is simpler and native to webviews
4. **VS Code API already provides it** - Why reinvent?

---

## Message Types

### JSONL Message Types (from Claude CLI)

| Type           | Subtype                    | Purpose                         | Handler                     |
| -------------- | -------------------------- | ------------------------------- | --------------------------- |
| `system`       | `init`                     | Session initialization          | `handleSessionInit()`       |
| `assistant`    | -                          | Text, thinking, tool_use blocks | `handleAssistantMessage()`  |
| `tool`         | `start`, `result`, `error` | Tool execution lifecycle        | `handleToolMessage()`       |
| `permission`   | `request`                  | Permission dialog               | `handlePermissionRequest()` |
| `stream_event` | -                          | Streaming control events        | `handleStreamEvent()`       |
| `result`       | `success`, `error`         | Final metrics                   | `handleResult()`            |

---

## Testing the Flow

### Manual Test Steps

1. **Build backend and frontend**:

   ```bash
   npm run build:all
   ```

2. **Launch extension development host**:

   ```bash
   npm run watch  # Terminal 1
   # Press F5 in VS Code to launch Extension Development Host
   ```

3. **Open Ptah chat UI** in extension

4. **Send a message**: "Explain how React hooks work"

5. **Verify**:
   - ✅ Message appears in chat input
   - ✅ RPC call succeeds (check console: "Chat started successfully")
   - ✅ Streaming starts (word-by-word text appears)
   - ✅ No duplicate text
   - ✅ Thinking blocks appear (if present)
   - ✅ Tool use blocks render correctly
   - ✅ Agent tree shows active agents

### Debug Points

**Backend Logs**:

```typescript
// apps/ptah-extension-vscode/src/main.ts:127
logger.debug('RPC: chat:start called', { contentLength, sessionId });

// libs/backend/claude-domain/src/cli/claude-cli-launcher.ts:353
console.log('[ClaudeCliLauncher] Received stdout data:', { chunkLength });
```

**Frontend Logs**:

```typescript
// libs/frontend/core/src/lib/services/chat.service.ts:151
this.logger.info('Chat started successfully', 'ChatService', { sessionId });

// libs/frontend/core/src/lib/services/vscode.service.ts:284
console.debug('[VSCodeService] RPC response:', message);

// libs/frontend/core/src/lib/services/vscode.service.ts:290
// Check for 'jsonl-message' events arriving
```

---

## Anti-Patterns (What NOT to Do)

### ❌ WRONG: Use RPC for Streaming

```typescript
// DON'T DO THIS
rpcHandler.registerMethod('chat:streamChunk', async (params) => {
  return { chunk: ... };  // ❌ RPC is request/response, not push
});
```

### ❌ WRONG: Transform Messages in Parser

```typescript
// DON'T DO THIS
onMessage: (message) => {
  const transformed = {
    text: message.content.filter((b) => b.type === 'text'),
    tools: message.content.filter((b) => b.type === 'tool_use'),
  };
  this.webview.postMessage('content', transformed); // ❌ Splits unified structure
};
```

### ❌ WRONG: Buffer Chunks Before Sending

```typescript
// DON'T DO THIS
private buffer: JSONLMessage[] = [];

onMessage: (message) => {
  this.buffer.push(message);  // ❌ Buffers!
  if (this.buffer.length >= 10) {
    this.webview.postMessage('batch', this.buffer);  // ❌ Delays streaming
  }
};
```

---

## Related Documentation

- **TASK_2025_022**: Complete streaming architecture documentation

  - `task-tracking/TASK_2025_022/streaming-architecture-philosophy.md`
  - `task-tracking/TASK_2025_022/rpc-phase-3.5-streaming-solution.md`
  - `task-tracking/TASK_2025_022/anti-patterns-and-pitfalls.md`

- **TASK_2025_021**: RPC migration (Phases 1-3)
  - `task-tracking/TASK_2025_021/implementation-plan.md`

---

## Changes Made (2025-11-24)

### Issue Identified

The backend had a **faulty** `chat:sendMessage` RPC method that:

1. Created a stream but never consumed it
2. Returned `{ success: true }` immediately, ignoring streaming
3. Had a misleading TODO comment about "RPC streaming"

### Fix Applied

1. **Backend** (`apps/ptah-extension-vscode/src/main.ts:124-150`):

   - ✅ Renamed `chat:sendMessage` → `chat:start`
   - ✅ Added clear comments explaining streaming happens via postMessage
   - ✅ Removed misleading TODO about RPC streaming

2. **Frontend** (`libs/frontend/core/src/lib/services/claude-rpc.service.ts:177-190`):

   - ✅ Renamed `sendMessage()` → `startChat()`
   - ✅ Added `sessionId` parameter (was missing!)
   - ✅ Added documentation explaining async streaming

3. **Frontend** (`libs/frontend/core/src/lib/services/chat.service.ts:129-164`):
   - ✅ Implemented actual RPC call to `startChat()`
   - ✅ Removed TODO comment
   - ✅ Added error handling
   - ✅ Added logging

### Verification

```bash
# Type checks passed
npx nx run claude-domain:typecheck  # ✅ Pass
npx nx run core:typecheck            # ✅ Pass
```

---

## Summary

**The Ptah chat system uses a clear separation of concerns**:

1. **RPC** = Control plane (start/stop chat, session management)
2. **postMessage** = Data plane (streaming JSONL chunks)

This design is **simple, fast, and correct**. It preserves Claude's unified message structure (content blocks array) and enables real-time streaming without RPC overhead.

**Key Takeaway**: Never confuse the control plane (RPC) with the data plane (streaming). They serve different purposes and use different protocols.
