# TASK_2025_086: SDK Streaming & Session Loading Fixes

## Overview

This task addressed critical bugs in the SDK integration that caused:

1. Chat messages appearing as empty boxes when loading previous sessions
2. Streaming messages appearing as fragmented chunks instead of single messages
3. Real-time streaming not working (messages only appearing after completion)

---

## Problem 1: Wrong Message Type in RPC Handler

**Symptom:** Streaming events never reached the frontend. Only `message_complete` events were logged.

**Root Cause:** `sdk-rpc-handlers.ts` was sending messages with type `sdk:executionNode`, but the frontend was listening for `chat:chunk` (MESSAGE_TYPES.CHAT_CHUNK).

**File:** `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts`

**Fix:**

- Changed message type from `'sdk:executionNode'` to `'chat:chunk'`
- Changed completion message from `'sdk:sessionComplete'` to `'chat:complete'`
- Changed error message from `'sdk:error'` to `'chat:error'`
- Changed payload from `{ sessionId, node }` to `{ sessionId, event }`
- Fixed interface type from `ExecutionNode` to `FlatStreamEventUnion`

---

## Problem 2: Each Streaming Event Stored as Separate Message

**Symptom:** Loading a session showed each word/chunk as a separate Claude message bubble (e.g., "I'm", "ready", "to", "help" as 4 separate messages).

**Root Cause:** `stream-transformer.ts` was storing EACH `stream_event` as a separate `StoredSessionMessage`:

```typescript
// OLD (broken)
content: [event as any]; // Each text_delta became a separate "message"
```

**Discovery:** Using the infra-test app with `includePartialMessages: true`, we discovered the SDK actually sends:

1. `stream_event` (many) - For real-time UI streaming only
2. `assistant` (one) - Complete message with ALL content aggregated
3. `result` (one) - Stats

**File:** `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`

**Fix:**

- DON'T store `stream_event` messages (they're for real-time UI only)
- ONLY store complete `assistant` and `user` type messages
- Convert `message.content` blocks to proper `ExecutionNode[]` format:

```typescript
// NEW (correct)
if (sdkMessage.type === 'assistant' || sdkMessage.type === 'user') {
  const executionNodes = [];
  for (const block of message.content) {
    if (block.type === 'text') {
      executionNodes.push({ type: 'text', content: block.text, ... });
    }
  }
  storage.addMessage(sessionId, { content: executionNodes, ... });
}
```

---

## Problem 3: Session Loader Expected Wrong Format

**Symptom:** Old sessions showed empty message boxes.

**Root Cause:** Sessions contained MIXED formats:

- User messages: `ExecutionNode` format (with `type: "text"`)
- Assistant messages: `FlatStreamEventUnion` format (with `eventType: "text_delta"`)

The session loader checked only the FIRST message's format and applied it to ALL messages.

**File:** `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts`

**Fix:**

- Detect format PER MESSAGE, not per session
- For each message, check if content has `eventType` (FlatStreamEventUnion) or `type` (ExecutionNode)
- Convert each message appropriately based on its individual format:

```typescript
for (const stored of chatMessages) {
  const firstContent = stored.content[0];
  const isFlatEventFormat = 'eventType' in firstContent;

  if (isFlatEventFormat) {
    converted = this.convertSingleFlatEventMessage(stored, events, sessionId);
  } else {
    converted = this.convertSingleLegacyMessage(stored, nodes, sessionId);
  }
}
```

---

## Files Modified

| File                                                                       | Changes                                                     |
| -------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts`               | Fixed message types (chat:chunk, chat:complete, chat:error) |
| `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`             | Store complete messages only, not individual events         |
| `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts` | Per-message format detection                                |

---

## Testing Checklist

### 1. New Session - Real-time Streaming

- [ ] Start a new chat session
- [ ] Send a message that triggers a long response
- [ ] **Verify:** Text appears character-by-character (real-time streaming)
- [ ] **Verify:** No delay before text starts appearing
- [ ] **Verify:** Final message is ONE bubble, not multiple fragments

### 2. New Session - Message Storage

- [ ] Send a message and wait for response
- [ ] Check DevTools console for: `Stored complete assistant message xxx with N nodes`
- [ ] **Verify:** Only 1 message per user input, 1 message per assistant response
- [ ] **Verify:** NOT "71 messages" for a single response

### 3. Load Previous Session (Mixed Format)

- [ ] Open an OLD session that was saved before this fix
- [ ] **Verify:** User messages display with content (not empty)
- [ ] **Verify:** Assistant messages display with content (not empty)
- [ ] **Verify:** Console shows per-message format detection logs

### 4. Load Previous Session (New Format)

- [ ] Create a NEW session after this fix
- [ ] Close and reopen it
- [ ] **Verify:** All messages display correctly
- [ ] **Verify:** Messages are properly grouped (not fragmented)

### 5. Tool Use / Agent Messages

- [ ] Trigger a response that uses tools
- [ ] **Verify:** Tool execution displays correctly
- [ ] **Verify:** Tool results are grouped with their parent message

### 6. Error Handling

- [ ] Trigger an error (e.g., network disconnect)
- [ ] **Verify:** Error message appears in chat
- [ ] **Verify:** Can continue chatting after error

---

## SDK Message Flow Reference

With `includePartialMessages: true`:

```
SDK Query Start
    │
    ├── system (1) ─────────────────── Contains session_id, tools, model
    │
    ├── stream_event (N) ───────────── Real-time streaming (message_start, text_delta, etc.)
    │   │                               └── Yield to frontend for live updates
    │   │                               └── DO NOT store
    │   ├── message_start
    │   ├── content_block_delta (many)
    │   ├── content_block_stop
    │   ├── message_delta
    │   └── message_stop
    │
    ├── assistant (1) ──────────────── Complete message with all content
    │                                   └── STORE this (has message.content[])
    │
    └── result (1) ─────────────────── Stats (cost, tokens, duration)
```

---

## Console Logs to Look For

### Backend (Extension Host):

```
[StreamTransformer] Stored complete assistant message xxx with N nodes
[SdkRpcHandlers] Streaming event #1 to webview { eventType: 'message_start' }
[SdkRpcHandlers] Streaming event #2 to webview { eventType: 'text_delta' }
```

### Frontend (DevTools):

```
[SessionLoaderService] Message xxx (user): format=ExecutionNode
[SessionLoaderService] Message xxx (assistant): format=FlatStreamEventUnion
[ChatStore] processStreamEvent called: { eventType: 'text_delta' }
```
