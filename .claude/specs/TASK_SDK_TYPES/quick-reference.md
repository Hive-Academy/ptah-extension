# Claude Agent SDK - Quick Reference

**TL;DR Guide for Working with SDK Messages**

---

## Message Flow Cheat Sheet

### New Session

```
SDKSystemMessage (init)
  → session metadata, tools, agents, config

SDKPartialAssistantMessage (stream_event: message_start)
  → message.id = canonical messageId

SDKPartialAssistantMessage (stream_event: content_block_start)
  → tool_use: capture content_block.id as toolCallId

SDKPartialAssistantMessage (stream_event: content_block_delta)
  → text_delta, input_json_delta, thinking_delta

SDKPartialAssistantMessage (stream_event: message_stop)
  → emit message_complete here!

SDKResultMessage (success)
  → costs, tokens, stats
```

### Resume Session

```
SDKSystemMessage (init)

SDKUserMessageReplay (isReplay: true)    ← CHECK THIS FLAG
SDKAssistantMessage
SDKUserMessageReplay (isReplay: true)    ← DON'T STORE THESE
SDKAssistantMessage

SDKUserMessage (no isReplay)             ← NEW MESSAGE
... streaming continues ...
```

---

## Critical Type Guards

### Check Message Type

```typescript
switch (message.type) {
  case 'system':
    if (message.subtype === 'init') {
      // Session metadata
    }
    break;

  case 'user':
    const isReplay = 'isReplay' in message && message.isReplay === true;
    if (!isReplay) {
      // Store only new messages
    }
    break;

  case 'assistant':
    // Complete message
    const messageId = message.message.id; // Use this!
    break;

  case 'stream_event':
    // Streaming content
    handleStreamEvent(message.event);
    break;

  case 'result':
    // Final stats (extract via callback)
    break;
}
```

### Check Stream Event Type

```typescript
switch (event.type) {
  case 'message_start':
    const messageId = event.message.id; // CRITICAL: canonical ID
    break;

  case 'content_block_start':
    if (event.content_block.type === 'tool_use') {
      const toolCallId = event.content_block.id; // CRITICAL: real tool ID
      const toolName = event.content_block.name;
    }
    break;

  case 'content_block_delta':
    switch (event.delta.type) {
      case 'text_delta':
        // Regular text
        break;
      case 'input_json_delta':
        // Tool input JSON
        break;
      case 'thinking_delta':
        // Extended thinking
        break;
    }
    break;

  case 'message_stop':
    // CRITICAL: Emit message_complete here!
    break;
}
```

---

## Common Pitfalls

### ❌ WRONG: Using wrong message ID

```typescript
// DON'T use message.uuid for stream events
const messageId = sdkMessage.uuid; // ❌ Different per event!
```

### ✅ CORRECT: Using canonical message ID

```typescript
// DO use event.message.id from message_start
const messageId = event.message.id; // ✅ Consistent across stream
```

---

### ❌ WRONG: Missing tool call ID

```typescript
// DON'T generate placeholder IDs
const toolCallId = `tool-${index}`; // ❌ Not the real ID!
```

### ✅ CORRECT: Capturing real tool call ID

```typescript
// DO capture from content_block_start
if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
  const toolCallId = event.content_block.id; // ✅ Real ID
  toolCallIdMap.set(event.index, toolCallId);
}
```

---

### ❌ WRONG: Storing replayed messages

```typescript
// DON'T store all user messages
if (message.type === 'user') {
  storage.addMessage(message); // ❌ Duplicates history!
}
```

### ✅ CORRECT: Checking replay flag

```typescript
// DO check isReplay flag
if (message.type === 'user') {
  const isReplay = 'isReplay' in message && message.isReplay === true;
  if (!isReplay) {
    storage.addMessage(message); // ✅ Only new messages
  }
}
```

---

### ❌ WRONG: Missing message_complete

```typescript
// DON'T skip message_stop
case 'message_stop':
  return []; // ❌ StreamTransformer never stores message!
```

### ✅ CORRECT: Emitting message_complete

```typescript
// DO emit message_complete on message_stop
case 'message_stop':
  return [{
    eventType: 'message_complete',
    messageId: this.currentMessageId,
    // ... other fields
  }]; // ✅ Finalizes message storage
```

---

## Field Quick Lookup

| Field                 | Guaranteed? | Source                         | Purpose                    |
| --------------------- | ----------- | ------------------------------ | -------------------------- |
| `type`                | ✅ Always   | All messages                   | Message discriminator      |
| `session_id`          | ✅ Always   | All messages                   | Session identifier         |
| `uuid`                | ⚠️ Mostly   | Most (not new user)            | Message UUID (varies)      |
| `message.id`          | ✅ Yes      | Assistant/stream_event         | **Canonical message ID**   |
| `parent_tool_use_id`  | ✅ Yes      | User/Assistant/stream_event    | null or agent parent       |
| `content_block.id`    | ✅ Yes      | tool_use blocks                | **Canonical tool call ID** |
| `isReplay`            | ⚠️ Resume   | User message replay            | Skip storage if true       |
| `event.message.id`    | ✅ Yes      | message_start                  | **Use this as messageId**  |
| `event.content_block` | ✅ Yes      | content_block_start            | **Capture tool IDs here**  |
| `event.delta`         | ✅ Yes      | content_block_delta            | Streaming content          |
| `message.usage`       | ✅ Yes      | Assistant/message_start/result | Token counts               |
| `total_cost_usd`      | ✅ Yes      | Result messages                | USD cost                   |
| `modelUsage`          | ✅ Yes      | Result messages                | Per-model breakdown        |

---

## One-Line Rules

1. **Message ID**: Always use `event.message.id` from `message_start`, never `uuid`
2. **Tool Call ID**: Capture `content_block.id` from `content_block_start` (type: tool_use)
3. **Replay Check**: Test `'isReplay' in message && message.isReplay === true`
4. **Message Complete**: Emit on `message_stop` event (critical for storage)
5. **Parent Tracking**: Use `parent_tool_use_id` for nested agent messages
6. **Block Index**: Map `event.index` to `content_block.id` for tool deltas
7. **Token Usage**: Comes from `message_delta` (cumulative), not `message_stop`
8. **Final Stats**: Extract from `SDKResultMessage` via callback, not flat events

---

## Type Import Guide

```typescript
// From SDK package (use structural typing to avoid ESM issues)
import type { SDKMessage, SDKSystemMessage, SDKUserMessage, SDKUserMessageReplay, SDKAssistantMessage, SDKPartialAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

// Check at runtime
function isSDKResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  return msg.type === 'result' && 'total_cost_usd' in msg && typeof msg.total_cost_usd === 'number';
}

function isReplayMessage(msg: SDKMessage): boolean {
  return msg.type === 'user' && 'isReplay' in msg && msg.isReplay === true;
}
```

---

## Debugging Checklist

- [ ] Are you using `message.id` (not `uuid`) as messageId?
- [ ] Are you capturing tool IDs from `content_block_start`?
- [ ] Are you emitting `message_complete` on `message_stop`?
- [ ] Are you checking `isReplay` before storing user messages?
- [ ] Are you handling all delta types (text, input_json, thinking)?
- [ ] Are you mapping `event.index` to tool IDs for deltas?
- [ ] Are you propagating `parent_tool_use_id` for nested agents?
- [ ] Are you extracting `SDKResultMessage` via callback (not flat events)?

---

## See Also

- **Full Reference**: [sdk-type-reference.md](./sdk-type-reference.md)
- **Implementation**: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`
- **Types**: `node_modules/@anthropic-ai/claude-agent-sdk/entrypoints/agentSdkTypes.d.ts`
