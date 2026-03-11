# Streaming Architecture Redesign for Agent SDK

## Problem Statement

The current chat streaming architecture was designed for CLI-era one-shot request/response model:

- `chat:complete` waits for entire CLI process to exit
- Global `isStreaming()` flag controls all UI rendering
- Markdown only renders when streaming stops (waiting for `chat:complete`)
- Agent SDK uses multi-turn conversations where messages complete individually

**Result**: Broken UX where streaming never stops, markdown never renders.

## Root Cause Analysis

| Component     | CLI-era Design              | Agent SDK Reality                  |
| ------------- | --------------------------- | ---------------------------------- |
| Session       | One CLI process per message | Persistent session, multiple turns |
| Streaming end | CLI exits → `chat:complete` | Each message has `stop_reason`     |
| UI state      | Global `isStreaming()`      | Per-message status                 |
| Markdown      | Wait for session complete   | Render per-message completion      |

---

## Section 1: Streaming Fix

### 1.1 Backend: Use `stop_reason` for Message Completion

**File**: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

In `transformAssistantMessage()`:

- Check `sdkMessage.message.stop_reason`
- If `stop_reason` exists → set node `status: 'complete'`
- If `stop_reason` is null → set node `status: 'streaming'`

```typescript
const isMessageComplete = !!sdkMessage.message.stop_reason;
const status: ExecutionStatus = isMessageComplete ? 'complete' : 'streaming';
```

### 1.2 Frontend: Always Render Markdown (Option A - Recommended)

**File**: `libs/frontend/chat/src/lib/components/organisms/execution-node.component.ts`

- Remove the `@if (isStreaming())` conditional switch
- Always use `<markdown [data]="node().content" />`
- ngx-markdown updates live (like ChatGPT/Claude web do)

### 1.3 Keep `chat:complete` for Session Cleanup Only

- `chat:complete` still sent when SDK session ends
- Used only for resetting tab state
- NOT used for markdown rendering decisions

---

## Section 2: Pricing & Token Display

### Problem

UI has `TokenBadgeComponent`, `CostBadgeComponent`, `DurationBadgeComponent` but they show nothing because:

1. We skip result messages (`return []`)
2. Data never reaches frontend

### Solution

Add `session:stats` message type:

**File**: `apps/ptah-extension-vscode/src/services/rpc-method-registration.service.ts`

```typescript
// When result message received:
await this.webviewManager.sendMessage('ptah.main', 'session:stats', {
  sessionId,
  cost: sdkMessage.total_cost_usd,
  tokens: { input: sdkMessage.usage.input_tokens, output: sdkMessage.usage.output_tokens },
  duration: sdkMessage.duration_ms,
});
```

**File**: `libs/frontend/core/src/lib/services/vscode.service.ts`

- Handle `session:stats` message

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

- Store cost/token data on message for badge display

---

## Estimated Effort

| Section        | Files | Effort        |
| -------------- | ----- | ------------- |
| Streaming fix  | 2     | 30-60 min     |
| Pricing/tokens | 3     | 1-2 hours     |
| **Total**      | 5     | **2-3 hours** |

---

## Success Criteria

- [ ] Markdown renders progressively during streaming
- [ ] Streaming indicator stops when `stop_reason` received
- [ ] Multi-turn conversations work
- [ ] Token/cost badges display after response completes
- [ ] Old sessions load with proper markdown
