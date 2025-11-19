# JSONL Parser - Missing Events Analysis

## 🚨 Critical Issues Found

### Issue 1: `message_stop` Event IGNORED ❌

**Location**: `jsonl-stream-parser.ts:734-736`

```typescript
// Other stream events (content_block_start, content_block_stop, message_delta, message_stop)
// are metadata events that we don't need to process for content streaming
```

**Impact**: "Claude is typing..." indicator NEVER stops!

**Claude CLI Output**:

```json
{ "type": "stream_event", "event": { "type": "message_stop" }, "session_id": "..." }
```

**Solution**: Handle `message_stop` and call `onMessageStop()` callback.

---

### Issue 2: `result` Message Type NOT PARSED ❌

**Location**: `jsonl-stream-parser.ts:16-21` (JSONLMessage union type)

**Missing from parser**: The `result` message type is NOT in the union!

```typescript
export type JSONLMessage = JSONLSystemMessage | JSONLAssistantMessage | JSONLToolMessage | JSONLPermissionMessage | JSONLStreamEvent;
// ❌ MISSING: JSONLResultMessage
```

**Claude CLI Output**:

```json
{
  "type": "result",
  "subtype": "success",
  "duration_ms": 2866,
  "duration_api_ms": 2515,
  "num_turns": 1,
  "result": "Hey! How can I help...",
  "session_id": "878fe64d-04ad-4cb0-83fb-998fbceab2be",
  "total_cost_usd": 0.016623600000000002,
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 3328,
    "cache_read_input_tokens": 13192,
    "output_tokens": 12
  },
  "modelUsage": {
    "claude-sonnet-4-5-20250929": {
      "inputTokens": 2,
      "outputTokens": 12,
      "cacheReadInputTokens": 13192,
      "cacheCreationInputTokens": 3328,
      "costUSD": 0.016623600000000002
    }
  }
}
```

**Impact**:

- No cost tracking
- No token usage stats
- No performance metrics
- Process never properly closes

---

### Issue 3: Missing Callbacks in Interface ❌

**Location**: `jsonl-stream-parser.ts:124-134`

**Current callbacks**:

```typescript
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void;
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onError?: (error: Error, rawLine?: string) => void;
  // ❌ MISSING: onMessageStop
  // ❌ MISSING: onResult
}
```

---

## 📋 Complete List of Claude CLI Events

### System Events

- ✅ `type: "system", subtype: "init"` - Session initialization (HANDLED)

### Stream Events

- ✅ `stream_event.type: "message_start"` - Start of message (HANDLED)
- ✅ `stream_event.type: "content_block_start"` - Start of content block (IGNORED - OK)
- ✅ `stream_event.type: "content_block_delta"` - Text streaming (HANDLED)
- ❌ `stream_event.type: "content_block_stop"` - End of content block (IGNORED)
- ❌ `stream_event.type: "message_delta"` - Message metadata (IGNORED)
- ❌ **`stream_event.type: "message_stop"`** - **END OF STREAMING (IGNORED - BUG!)**

### Assistant Messages

- ✅ `type: "assistant"` - Assistant responses (HANDLED)

### Tool Messages

- ✅ `type: "tool", subtype: "start|progress|result|error"` (HANDLED)

### Permission Messages

- ✅ `type: "permission", subtype: "request"` (HANDLED)

### Result Message

- ❌ **`type: "result", subtype: "success"`** - **FINAL RESULT WITH COST/USAGE (NOT PARSED!)**

---

## 🔧 Required Fixes

### 1. Add Missing Interfaces

```typescript
// Add to jsonl-stream-parser.ts after JSONLStreamEvent

export interface JSONLResultMessage {
  readonly type: 'result';
  readonly subtype: 'success' | 'error';
  readonly session_id?: string;
  readonly result?: string;
  readonly duration_ms?: number;
  readonly duration_api_ms?: number;
  readonly num_turns?: number;
  readonly total_cost_usd?: number;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  readonly modelUsage?: Record<
    string,
    {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cacheReadInputTokens: number;
      readonly cacheCreationInputTokens: number;
      readonly costUSD: number;
    }
  >;
}
```

### 2. Update JSONLMessage Union Type

```typescript
export type JSONLMessage = JSONLSystemMessage | JSONLAssistantMessage | JSONLToolMessage | JSONLPermissionMessage | JSONLStreamEvent | JSONLResultMessage; // ADD THIS
```

### 3. Add Missing Callbacks

```typescript
export interface JSONLParserCallbacks {
  onSessionInit?: (sessionId: string, model?: string) => void;
  onContent?: (chunk: ClaudeContentChunk) => void;
  onThinking?: (event: ClaudeThinkingEvent) => void;
  onTool?: (event: ClaudeToolEvent) => void;
  onPermission?: (request: ClaudePermissionRequest) => void;
  onAgentStart?: (event: ClaudeAgentStartEvent) => void;
  onAgentActivity?: (event: ClaudeAgentActivityEvent) => void;
  onAgentComplete?: (event: ClaudeAgentCompleteEvent) => void;
  onMessageStop?: () => void; // ADD THIS - signals end of streaming
  onResult?: (result: JSONLResultMessage) => void; // ADD THIS - final result with cost/usage
  onError?: (error: Error, rawLine?: string) => void;
}
```

### 4. Handle `message_stop` Event

```typescript
// In handleStreamEvent method, BEFORE the comment about ignoring metadata events:

// CRITICAL: Handle message_stop to signal end of streaming
if (msg.event.type === 'message_stop') {
  console.log('[JSONLStreamParser] message_stop received - streaming complete');
  this.callbacks.onMessageStop?.();
  return;
}
```

### 5. Handle `result` Message

```typescript
// In handleMessage method, add new case:

case 'result':
  this.handleResultMessage(json);
  break;

// Add new method:
private handleResultMessage(msg: JSONLResultMessage): void {
  console.log('[JSONLStreamParser] result received:', {
    duration: msg.duration_ms,
    cost: msg.total_cost_usd,
    tokens: msg.usage,
  });
  this.callbacks.onResult?.(msg);
}
```

### 6. Wire Up in Launcher

```typescript
// In claude-cli-launcher.ts, add to callbacks:

onMessageStop: () => {
  console.log('[ClaudeCliLauncher] Streaming complete');
  this.deps.eventPublisher.emitMessageComplete(sessionId);
},

onResult: (result) => {
  console.log('[ClaudeCliLauncher] Final result:', {
    cost: result.total_cost_usd,
    duration: result.duration_ms,
    tokens: result.usage,
  });
  // Emit token usage, cost, and session end
  if (result.usage) {
    this.deps.eventPublisher.emitTokenUsage(sessionId, result.usage);
  }
  this.deps.eventPublisher.emitSessionEnd(sessionId, 'completed');
},
```

---

## 🎨 Frontend Issues

### Issue 1: Message Duplication

**Observed**: Each message appears twice in the UI

**Possible Causes**:

1. Multiple event listeners registered for same event
2. Event handler not cleaned up on component destroy
3. Double rendering due to state updates

**Need to check**:

- `libs/frontend/chat/` - Message components
- `libs/frontend/core/` - ChatService event subscriptions

### Issue 2: "Claude is typing..." Never Stops

**Root Cause**: `message_stop` event not handled (see Issue 1 above)

**Fix**:

1. Parser emits `onMessageStop()`
2. Launcher emits `MESSAGE_COMPLETE` event
3. Frontend listens for `MESSAGE_COMPLETE` and stops typing indicator

---

## 📊 Event Flow (Current vs. Fixed)

### Current (BROKEN) ❌

```
User sends message
  ↓
Process spawns ✅
  ↓
stdin.write() + stdin.end() ✅
  ↓
Streaming starts ✅
  ↓
content_block_delta → UI updates ✅
  ↓
message_stop → IGNORED ❌
  ↓
result → NOT PARSED ❌
  ↓
"Claude is typing..." NEVER STOPS ❌
Process NEVER closes properly ❌
```

### Fixed ✅

```
User sends message
  ↓
Process spawns ✅
  ↓
stdin.write() + stdin.end() ✅
  ↓
Streaming starts ✅
  ↓
content_block_delta → UI updates ✅
  ↓
message_stop → onMessageStop() → MESSAGE_COMPLETE event ✅
  ↓
result → onResult() → TOKEN_USAGE + SESSION_END events ✅
  ↓
"Claude is typing..." STOPS ✅
Process closes cleanly ✅
Cost/usage displayed ✅
```

---

## 🎯 Priority Order

1. **CRITICAL**: Handle `message_stop` event (stops typing indicator)
2. **CRITICAL**: Parse `result` message (enables session cleanup)
3. **HIGH**: Wire up `onMessageStop` in launcher
4. **HIGH**: Wire up `onResult` in launcher
5. **MEDIUM**: Display cost/usage in UI
6. **MEDIUM**: Fix duplicate messages in frontend

---

## 🧪 Testing Checklist

- [ ] Send message → Streaming works
- [ ] Streaming completes → "Claude is typing..." STOPS
- [ ] Result parsed → Cost/usage logged
- [ ] Process closes cleanly (no zombie processes)
- [ ] Frontend shows single message (no duplication)
- [ ] Token usage displayed in UI
- [ ] Session end event emitted
