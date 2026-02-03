# Message Duplication Fix Plan - OpenRouter Streaming

## Problem Statement

When using OpenRouter (and potentially other third-party providers routed through Claude Agent SDK), the assistant's message appears twice in the chat UI. The message streams correctly first, then the full message is printed again at the end.

## Log Evidence

From `D:\projects\ptah-extension\vscode-app-1768436443449.log`, lines 163-167:

```
Line 163: [RPC] Turn complete - sending chat:complete ... {"eventCount":845}
Line 165: [RPC] Turn complete - sending chat:complete ... {"eventCount":847}
```

Two `chat:complete` events are sent for the same session/tab, with event count jumping from 845 to 847 (2 extra events: a `message_start` + `message_complete` from the second representation).

---

## Root Cause Analysis

### The Dual-Representation Problem

The Claude Agent SDK, when configured with `includePartialMessages: true` (confirmed at `sdk-query-options-builder.ts:331`), yields TWO representations of the same assistant response:

1. **Streaming events** (`type: 'stream_event'`) -- A sequence of:

   - `message_start` (contains `message.id` from Anthropic API)
   - `content_block_start`
   - `content_block_delta` (text chunks)
   - `content_block_stop`
   - `message_delta` (token usage)
   - `message_stop`

2. **Complete assistant message** (`type: 'assistant'`) -- A single SDK message containing the entire response with all content blocks.

### How Both Representations Flow Through the Pipeline

**Step 1: StreamTransformer (`stream-transformer.ts:340-357`)**

The `for await` loop processes ALL SDK messages. The filter on line 340-344 passes through:

- `sdkMessage.type === 'stream_event'` -- streaming chunks
- `sdkMessage.type === 'assistant'` -- complete message
- `sdkMessage.type === 'user'` -- user/tool results

Both `stream_event` and `assistant` are passed to `messageTransformer.transform()`.

**Step 2: SdkMessageTransformer (`sdk-message-transformer.ts:113-160`)**

The `transform()` method dispatches based on type:

- `isAssistantMessage(sdkMessage)` (line 119) -> `transformAssistantToFlatEvents()` -- Emits `message_start` (source: 'complete'), `text_delta` (source: 'complete'), `message_complete` (source: 'complete')
- `isStreamEvent(sdkMessage)` (line 140) -> `transformStreamEventToFlatEvents()` -- Emits streaming events (source: 'stream')

**Step 3: Chat RPC Handler (`chat-rpc.handlers.ts:508-528`)**

The `streamExecutionNodesToWebview` method has a `turnCompleteSent` flag to prevent duplicate `chat:complete` signals. However:

```typescript
// Line 510: Reset on ANY message_start
if (event.eventType === 'message_start') {
  turnCompleteSent = false;
}

// Line 514: Send chat:complete on first message_complete
if (event.eventType === 'message_complete' && !turnCompleteSent) {
  turnCompleteSent = true;
  // ... sends chat:complete
}
```

The problem: When the **second** (complete) `assistant` message arrives, its events include a `message_start` event (line 561 of `sdk-message-transformer.ts`), which **resets `turnCompleteSent` to false** on line 510. Then the subsequent `message_complete` from the same complete assistant message triggers **another** `chat:complete` on line 514.

**Step 4: Frontend StreamingHandler (`streaming-handler.service.ts:146-402`)**

The frontend receives ALL events and stores them in the `StreamingState.events` map. While the `EventDeduplicationService` handles some deduplication for `message_start` (via `handleDuplicateMessageStart`) and individual deltas (via `isMessageAlreadyFinalized`), the problem is:

1. The `message_start` from the `complete` source has EQUAL priority to `stream` (`complete` priority = 2, `stream` priority = 1), so it REPLACES the stream event.
2. The `text_delta` from the `complete` source (containing the FULL text in one chunk) is stored with a new event ID, and because `source === 'complete'` on line 192, it **overwrites** the accumulator (not appends). This is correct for dedup but the damage is already done -- the `message_complete` from the `complete` source triggers re-rendering that shows the duplicate.
3. The critical issue: `message_complete` from the complete source arrives at line 390 and is unconditionally stored. The streaming handler returns `queuedContent` data, and the batched UI update gets scheduled.

### Why the Message Appears Twice in the UI

The sequence is:

1. Streaming events build up the message character by character -- user sees it streaming
2. `message_stop` (stream) triggers `message_complete` (stream source) -> first `chat:complete` sent -> **finalization #1** happens when SESSION_STATS arrives
3. `assistant` message arrives -> emits `message_start` (complete), `text_delta` (complete, full text), `message_complete` (complete) -> second `chat:complete` sent
4. The frontend accumulator gets the full text AGAIN (even though it's set-not-append for `complete` source), and the tree builder now has extra events for the same messageId

The visual duplication occurs because:

- The streaming message is finalized into a chat message by `MessageFinalizationService`
- Then the complete message's events create what looks like a SECOND message in the streaming state (additional `message_start` + `text_delta` + `message_complete` events accumulate)
- When SESSION_STATS triggers final finalization, or when the tree is rebuilt, the duplicate events cause duplicate display

### Why Standard Anthropic Flow Works

The standard Anthropic API (direct, not via OpenRouter) also sends both representations when `includePartialMessages: true` is set. However, with Anthropic's direct API, the `message.id` in both the streaming `message_start` event and the complete `assistant` message are **identical** (e.g., `"msg_01XYZ"`).

The existing deduplication in the frontend (`handleDuplicateMessageStart`) catches this because the same `messageId` is seen twice, and the `complete` source replaces the `stream` source. The `text_delta` events use accumulator overwrite (not append) for `complete` source, so the text doesn't double.

With OpenRouter and other third-party providers, the behavior appears to be the same in structure, but the timing or message IDs may differ slightly, causing the deduplication to fail. Specifically:

- If OpenRouter returns a different `message.id` format, or if the complete message has a slightly different ID, the frontend dedup wouldn't catch it.
- More likely: the backend `turnCompleteSent` reset is the primary issue, since it allows TWO `chat:complete` events through regardless of frontend dedup.

---

## Architecture Design -- Recommended Fix

### Design Philosophy

**Universal deduplication at the SdkMessageTransformer level** -- This is the cleanest approach because:

1. It prevents duplicate events from ever entering the pipeline
2. It's provider-agnostic (works for Anthropic, OpenRouter, any provider)
3. It's the single point where both SDK message types are transformed
4. It doesn't require changes to the frontend deduplication logic

### Why NOT the Other Options

- **Option B (StreamTransformer level)**: Would require the StreamTransformer to understand message semantics it shouldn't know about. It's a pipeline orchestrator, not a deduplication engine.
- **Option C (RPC handler level)**: The `turnCompleteSent` flag fix alone wouldn't prevent the duplicate events from reaching the frontend and causing UI duplication. The frontend would still get two sets of `message_start` + `text_delta` + `message_complete`.
- **Option D (Provider-aware)**: Violates the "no backward compatibility layers" principle. The fix should be universal.

### Chosen Approach: SdkMessageTransformer Message-Level Deduplication

**Track completed messageIds in `SdkMessageTransformer`. When a complete `assistant` message arrives with a messageId that was already fully processed via streaming (i.e., we received `message_stop` for it), skip re-emitting the complete message's events entirely.**

This is safe because:

- The streaming events already delivered all content to the frontend incrementally
- The complete `assistant` message is redundant when streaming was successful
- The `message_complete` event from streaming already includes all metadata needed
- For session resume/history loading, complete `assistant` messages arrive WITHOUT prior streaming, so they'll still be processed normally

---

## Implementation Plan

### File 1: `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

**Change Type**: MODIFY

#### Change 1: Add a Set to track messageIds that completed via streaming

**Location**: After line 87 (after `currentMessageIdByContext` declaration)

**Add**:

```typescript
/**
 * TASK_2025_134 FIX: Track messageIds that have completed via streaming.
 * When a complete 'assistant' message arrives with a messageId already
 * in this set, we skip re-emitting its events to prevent duplication.
 *
 * This handles the case where the SDK emits both:
 * 1. stream_event messages (text_delta chunks + message_stop)
 * 2. A complete assistant message (full text in one block)
 *
 * Both represent the same response. Without this, the frontend shows
 * the message twice: once from streaming, once from the complete message.
 *
 * The set is never cleared during a session because messageIds are globally
 * unique (Anthropic API format: "msg_01XYZ..."). For long sessions,
 * this grows linearly with the number of assistant messages (typically <100).
 */
private completedStreamMessageIds: Set<string> = new Set();
```

#### Change 2: Record completed messageId on `message_stop`

**Location**: In `transformStreamEventToFlatEvents`, inside the `case 'message_stop':` block (around line 273-306).

**Current code (lines 273-306)**:

```typescript
case 'message_stop': {
  // TASK_2025_096 FIX: Look up messageId by context
  const context = parentToolUseId || '';
  const currentMessageId = this.currentMessageIdByContext.get(context);

  // TASK_2025_086: Emit message_complete when stream ends
  const events: FlatStreamEventUnion[] = [];

  if (currentMessageId) {
    const messageCompleteEvent: MessageCompleteEvent = {
      // ... existing code
    };
    events.push(messageCompleteEvent);
  }

  // TASK_2025_096 FIX: Clear tracking for this context only
  this.currentMessageIdByContext.delete(context);
  for (const key of this.toolCallIdByContextAndBlock.keys()) {
    if (key.startsWith(`${context}:`)) {
      this.toolCallIdByContextAndBlock.delete(key);
    }
  }

  return events;
}
```

**Modified code** -- add one line after `events.push(messageCompleteEvent)`:

```typescript
case 'message_stop': {
  // TASK_2025_096 FIX: Look up messageId by context
  const context = parentToolUseId || '';
  const currentMessageId = this.currentMessageIdByContext.get(context);

  // TASK_2025_086: Emit message_complete when stream ends
  const events: FlatStreamEventUnion[] = [];

  if (currentMessageId) {
    const messageCompleteEvent: MessageCompleteEvent = {
      // ... existing code unchanged
    };
    events.push(messageCompleteEvent);

    // TASK_2025_134 FIX: Mark this messageId as completed via streaming.
    // When the complete 'assistant' message arrives later with the same
    // messageId, we'll skip it to prevent duplicate display.
    this.completedStreamMessageIds.add(currentMessageId);
  }

  // TASK_2025_096 FIX: Clear tracking for this context only
  this.currentMessageIdByContext.delete(context);
  for (const key of this.toolCallIdByContextAndBlock.keys()) {
    if (key.startsWith(`${context}:`)) {
      this.toolCallIdByContextAndBlock.delete(key);
    }
  }

  return events;
}
```

#### Change 3: Skip complete `assistant` messages that were already streamed

**Location**: In `transformAssistantToFlatEvents`, at the very beginning of the method (around line 540-544).

**Current code (lines 540-546)**:

```typescript
private transformAssistantToFlatEvents(
  sdkMessage: SDKAssistantMessage,
  sessionId?: SessionId
): FlatStreamEventUnion[] {
  const { uuid, message, parent_tool_use_id } = sdkMessage;

  const events: FlatStreamEventUnion[] = [];
```

**Modified code** -- add early return check after extracting messageId:

```typescript
private transformAssistantToFlatEvents(
  sdkMessage: SDKAssistantMessage,
  sessionId?: SessionId
): FlatStreamEventUnion[] {
  const { uuid, message, parent_tool_use_id } = sdkMessage;

  // TASK_2025_134 FIX: Use same messageId resolution as streaming path
  const messageId = message?.id || uuid;

  // TASK_2025_134 FIX: Skip complete assistant messages that were already
  // fully delivered via streaming events. The SDK emits both:
  //   1. stream_event messages (incremental text_delta + message_stop)
  //   2. A complete 'assistant' message (full text)
  // Both represent the same response. If we already processed the streaming
  // path (which added messageId to completedStreamMessageIds on message_stop),
  // skip the complete message to prevent duplicate display in the UI.
  //
  // This is safe because:
  // - All content was already delivered via streaming text_delta events
  // - The message_complete event was already emitted on message_stop
  // - Token usage was already captured via message_delta events
  // - For session history/resume, complete messages arrive WITHOUT prior
  //   streaming, so they will NOT be in completedStreamMessageIds
  if (this.completedStreamMessageIds.has(messageId)) {
    this.logger.debug(
      '[SdkMessageTransformer] Skipping duplicate assistant message (already streamed)',
      { messageId, uuid }
    );
    return [];
  }

  const events: FlatStreamEventUnion[] = [];
```

Also remove the now-redundant `messageId` declaration that was on line 558:

**Current code (line 558)**:

```typescript
const messageId = message?.id || uuid;
```

This line is now declared earlier (before the dedup check). Remove this line.

#### Change 4: Clear completedStreamMessageIds in `clearStreamingState`

**Location**: In `clearStreamingState()` method (around line 851-854).

**Current code**:

```typescript
clearStreamingState(): void {
  this.currentMessageIdByContext.clear();
  this.toolCallIdByContextAndBlock.clear();
}
```

**Modified code**:

```typescript
clearStreamingState(): void {
  this.currentMessageIdByContext.clear();
  this.toolCallIdByContextAndBlock.clear();
  // TASK_2025_134 FIX: Clear completed message tracking on reset
  this.completedStreamMessageIds.clear();
}
```

---

### File 2: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`

**Change Type**: MODIFY

#### Change: Fix the `turnCompleteSent` flag to not reset on same-messageId `message_start`

This is a **defense-in-depth** fix. Even with the SdkMessageTransformer dedup above, this fixes the structural issue in the RPC handler. The `turnCompleteSent` flag should only reset on a `message_start` for a NEW message, not for a duplicate.

**Location**: Lines 508-528 in `streamExecutionNodesToWebview`

**Current code (lines 508-528)**:

```typescript
// TASK_2025_092: Reset turnCompleteSent when new turn starts (message_start)
// This ensures multi-turn conversations properly signal completion for each turn
if (event.eventType === 'message_start') {
  turnCompleteSent = false;
}

if (event.eventType === 'message_complete' && !turnCompleteSent) {
  turnCompleteSent = true;
  this.logger.info(`[RPC] Turn complete - sending chat:complete for session ${sessionId}, tabId ${tabId}`, { eventCount });
  await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
    tabId,
    sessionId,
    code: 0,
  });
}
```

**Modified code**:

```typescript
// TASK_2025_134 FIX: Only reset turnCompleteSent on message_start for a
// genuinely NEW root-level message (no parentToolUseId = not a subagent message).
// Previously, every message_start reset the flag, including the duplicate
// message_start from the complete 'assistant' message that follows streaming.
// This allowed a second chat:complete to be sent for the same turn.
//
// We track the last completed messageId to detect true new turns.
// A new turn starts when we see a message_start with a DIFFERENT messageId
// than the one we just completed, at the root level (no parentToolUseId).
if (event.eventType === 'message_start' && !event.parentToolUseId) {
  if (lastCompletedMessageId && event.messageId === lastCompletedMessageId) {
    // Same messageId as last completed -- this is a duplicate, don't reset
    this.logger.debug(`[RPC] Skipping turnCompleteSent reset for duplicate message_start: ${event.messageId}`);
  } else {
    turnCompleteSent = false;
  }
}

if (event.eventType === 'message_complete' && !turnCompleteSent && !event.parentToolUseId) {
  turnCompleteSent = true;
  lastCompletedMessageId = event.messageId;
  this.logger.info(`[RPC] Turn complete - sending chat:complete for session ${sessionId}, tabId ${tabId}`, { eventCount });
  await this.webviewManager.broadcastMessage(MESSAGE_TYPES.CHAT_COMPLETE, {
    tabId,
    sessionId,
    code: 0,
  });
}
```

Also, add the `lastCompletedMessageId` variable declaration near `turnCompleteSent`:

**Current (line 485)**:

```typescript
let turnCompleteSent = false;
```

**Modified**:

```typescript
let turnCompleteSent = false;
let lastCompletedMessageId: string | undefined;
```

---

## Summary of All Changes

| File                         | Change                                           | Lines Affected | Purpose                                      |
| ---------------------------- | ------------------------------------------------ | -------------- | -------------------------------------------- |
| `sdk-message-transformer.ts` | Add `completedStreamMessageIds` Set              | After line 87  | Track which messages completed via streaming |
| `sdk-message-transformer.ts` | Add to set on `message_stop`                     | ~line 294      | Mark messageId as streamed                   |
| `sdk-message-transformer.ts` | Early return in `transformAssistantToFlatEvents` | ~lines 543-558 | Skip duplicate complete messages             |
| `sdk-message-transformer.ts` | Clear set in `clearStreamingState`               | ~line 853      | Cleanup on reset                             |
| `chat-rpc.handlers.ts`       | Add `lastCompletedMessageId` tracking            | ~line 485      | Defense-in-depth: track completed messages   |
| `chat-rpc.handlers.ts`       | Smarter `turnCompleteSent` reset logic           | ~lines 508-528 | Prevent duplicate `chat:complete`            |

---

## Verification Plan

### 1. Verify Standard Anthropic Flow is NOT Broken

**Test**: Send a message using direct Anthropic API (standard Claude, no OpenRouter)

**Expected behavior**:

- Message streams character by character
- Single `message_complete` event
- Single `chat:complete` signal
- No visual duplication

**Why it's safe**: With Anthropic direct API:

- Streaming events complete with `message_stop` -> messageId added to `completedStreamMessageIds`
- Complete `assistant` message arrives -> messageId IS in the set -> skipped
- Only ONE set of events reaches the frontend
- Result: identical behavior to before (the frontend dedup was already handling this case, now we prevent the events from being emitted at all)

### 2. Verify OpenRouter Fix

**Test**: Send a message using OpenRouter provider

**Expected behavior**:

- Message streams character by character
- Single `message_complete` event
- Single `chat:complete` signal
- NO visual duplication (the second complete assistant message is skipped)

**Log verification**:

- Should see: `[SdkMessageTransformer] Skipping duplicate assistant message (already streamed)`
- Should NOT see two `[RPC] Turn complete - sending chat:complete` entries

### 3. Verify Multi-Turn Conversations

**Test**: Send multiple messages in sequence (multi-turn conversation)

**Expected behavior**:

- Each turn streams correctly
- `turnCompleteSent` resets properly between turns (different messageIds)
- Each turn produces exactly one `chat:complete`

### 4. Verify Session Resume/History Loading

**Test**: Load a session from history (chat:resume)

**Expected behavior**:

- History events (complete messages from JSONL) are NOT affected
- `completedStreamMessageIds` is empty on history load (no prior streaming)
- All historical messages display correctly

### 5. Verify Tool Execution Flow

**Test**: Trigger a tool call (e.g., file read, bash execution)

**Expected behavior**:

- Tool-related messages (which involve multiple message_start/message_complete pairs) work correctly
- The `parentToolUseId` filter in the RPC handler prevents subagent messages from incorrectly triggering `chat:complete`
- Tool results display properly

### 6. Verify Subagent/Task Flow

**Test**: Trigger a Task tool call that spawns a subagent

**Expected behavior**:

- Subagent messages have `parentToolUseId` set
- The `!event.parentToolUseId` guard in the RPC handler ensures subagent `message_complete` events don't trigger `chat:complete`
- Only root-level `message_complete` triggers turn completion

---

## Risk Assessment

### Low Risk

- The `completedStreamMessageIds` set grows linearly with assistant messages per session. Even a very long session with 100 assistant messages uses negligible memory (~few KB of string IDs).
- The early return in `transformAssistantToFlatEvents` is a pure skip -- no side effects, no state mutation.
- The `clearStreamingState()` cleanup ensures no leaks across sessions.

### Potential Edge Cases

1. **SDK sends `assistant` BEFORE `message_stop`**: This shouldn't happen per the Anthropic API protocol (streaming always completes before the full message is sent), but if it does, the complete message would be processed normally (messageId not yet in the set), and the subsequent streaming `message_stop` would add it to the set without harm.

2. **SDK sends `assistant` WITHOUT prior streaming**: This happens during session resume or when `includePartialMessages` is false. In these cases, the messageId won't be in `completedStreamMessageIds`, so the complete message is processed normally. This is the correct behavior.

3. **Different messageId between streaming and complete**: If a provider returns a different `message.id` in the streaming `message_start` event vs. the complete `assistant` message, the dedup won't catch it. However, per the Anthropic API specification, `message.id` is consistent across both representations. If a third-party provider breaks this contract, the defense-in-depth fix in the RPC handler (`lastCompletedMessageId` check) provides a secondary safety net.

---

## Implementation Order

1. **First**: Modify `sdk-message-transformer.ts` (primary fix)
2. **Second**: Modify `chat-rpc.handlers.ts` (defense-in-depth)
3. **Third**: Test with OpenRouter and Anthropic
4. **Fourth**: Remove diagnostic logging added during investigation (the `messageDetails` logging in `stream-transformer.ts:222-240` was added for debugging and can be cleaned up)
