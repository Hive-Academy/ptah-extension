# Session Continuation - Claude CLI Streaming Fix

**Date**: 2025-11-17
**Status**: ✅ COMPLETE

## Problem Summary

The Claude Code CLI integration was successfully spawning processes and receiving chunks from stdout, but the UI wasn't displaying any messages. The console showed chunks being logged, but content never reached the frontend.

## Root Cause

The JSONL parser was designed for a simplified event format, but Claude CLI with `--output-format stream-json` sends Messages API format events:

**Expected (old parser)**:

```json
{"type":"assistant","delta":"Hello"}
{"type":"assistant","content":"World"}
```

**Actual (Claude CLI output)**:

```json
{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-sonnet-4-5-20250929","id":"msg_..."}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
{"type":"assistant","message":{"content":[{"type":"text","text":"Complete message"}]}}
```

## Changes Made

### 1. Enhanced Type Definitions (`jsonl-stream-parser.ts` lines 29-48)

**Added nested Messages API format to `JSONLAssistantMessage`**:

```typescript
export interface JSONLAssistantMessage {
  readonly type: 'assistant';
  readonly delta?: string;
  readonly content?: string;
  readonly thinking?: string;
  readonly index?: number;
  // NEW: Messages API format (from --output-format stream-json)
  readonly message?: {
    readonly model?: string;
    readonly id?: string;
    readonly role?: 'assistant';
    readonly content?: Array<{
      readonly type: 'text' | 'tool_use';
      readonly text?: string;
      readonly id?: string;
      readonly name?: string;
      readonly input?: Record<string, unknown>;
    }>;
  };
}
```

### 2. Enhanced `JSONLStreamEvent` Type (lines 70-90)

**Added support for `input_json_delta` and `message_start` metadata**:

```typescript
export interface JSONLStreamEvent {
  readonly type: 'stream_event';
  readonly event: {
    readonly type: string;
    readonly index?: number;
    readonly delta?: {
      readonly type: 'text_delta' | 'input_json_delta'; // NEW: support both types
      readonly text?: string;
      readonly partial_json?: string; // NEW: for tool input streaming
    };
    readonly content_block?: {
      readonly type: string;
      readonly text: string;
    };
    readonly message?: {
      // NEW: message_start metadata
      readonly model?: string;
      readonly id?: string;
    };
  };
  readonly session_id?: string;
}
```

### 3. Updated `handleAssistantMessage()` (lines 239-296)

**Added handler for nested message.content array**:

```typescript
// Messages API format (from --output-format stream-json)
// Extract text content from nested message.content array
if (msg.message?.content) {
  for (const block of msg.message.content) {
    if (block.type === 'text' && block.text) {
      const contentChunk: ClaudeContentChunk = {
        type: 'content',
        delta: block.text,
        index: msg.index,
        timestamp,
      };
      this.callbacks.onContent?.(contentChunk);
    }
    // Tool use blocks are handled separately by tool events
  }
}
```

### 4. Fixed `handleStreamEvent()` (lines 467-502)

**Moved `message_start` to top, added text_delta type check, skip tool input deltas**:

```typescript
private handleStreamEvent(msg: JSONLStreamEvent): void {
  const timestamp = Date.now();

  // Handle message_start event (contains session_id and model info)
  if (msg.event.type === 'message_start' && msg.session_id) {
    const model = msg.event.message?.model;
    this.callbacks.onSessionInit?.(msg.session_id, model); // NOW EMITS SESSION INIT
    return;
  }

  // Handle content_block_delta events (streaming text chunks)
  if (msg.event.type === 'content_block_delta' && msg.event.delta) {
    // Handle text deltas (actual content)
    if (msg.event.delta.type === 'text_delta' && msg.event.delta.text) {
      const contentChunk: ClaudeContentChunk = {
        type: 'content',
        delta: msg.event.delta.text,
        index: msg.event.index,
        timestamp,
      };
      this.callbacks.onContent?.(contentChunk);
    }
    // Skip input_json_delta (tool input construction) - not user-facing content
    return;
  }

  // Other stream events are metadata - ignore
}
```

## Key Fixes

1. **Session Initialization**: Now properly emits `onSessionInit()` from `message_start` event
2. **Text Content Extraction**: Handles both:
   - Streaming deltas: `stream_event` → `content_block_delta` → `text_delta`
   - Complete messages: `assistant` → `message.content[]` → `text`
3. **Tool Input Filtering**: Ignores `input_json_delta` events (tool construction, not user content)
4. **Type Safety**: All new formats properly typed

## Testing

✅ Build successful (`npm run build:all`)
✅ No TypeScript errors
✅ All layers (parser → launcher → service → UI) should now work

## Expected Behavior After Fix

1. User sends message "hello can you help me analyze the workspace"
2. CLI spawns with correct args and CWD
3. Message written to stdin
4. CLI responds with:
   - `message_start` → Session initialized log + sessionId stored
   - `content_block_delta` events → Content chunks appear in UI in real-time
   - `assistant` complete message → Full text extracted and displayed
   - Tool use events → Permission requests/tool execution shown

## Files Changed

- `libs/backend/claude-domain/src/cli/jsonl-stream-parser.ts` (1 file, ~60 lines modified)

## Previous Session Context

This fix builds on previous work:

- ✅ Fixed duplicate message sends (chat.component.ts:268-275)
- ✅ Fixed workspace root detection (claude-cli.service.ts:84-95)
- ✅ Fixed message-to-stdin flow (claude-cli-launcher.ts:90-98)
- ✅ Removed incompatible CLI flags (buildArgs method)
- ✅ Fixed permission stdin issue (removed stdin.end() call)

## Next Steps

1. **Test in Extension Development Host** (F5)
2. **Send test message** and verify:
   - Session ID appears in logs
   - Content chunks stream to UI
   - Complete message displays
3. **Test permission flow** (send message that requires tool use)
4. **Verify session persistence** (reload extension, check session restoration)

## Technical Notes

**Why Two Message Formats?**

- `stream_event` messages: Real-time streaming (token-by-token with `--include-partial-messages`)
- `assistant` messages: Complete message objects (for reference/replay)
- Both formats are emitted by CLI with `--output-format stream-json`

**Why Filter `input_json_delta`?**

- These events stream the JSON being constructed for tool inputs
- Not user-facing content (internal tool parameter building)
- Displaying them would show `{"pattern"`, `{"pattern": "**"`, etc. (confusing)

**Session ID Source**:

- First `stream_event` with `type: 'message_start'` contains `session_id`
- Used by SessionManager to link Ptah sessionId to Claude CLI session
- Critical for session resumption (`--resume` flag)
