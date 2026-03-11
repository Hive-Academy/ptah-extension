# Tasks - TASK_2025_081: SDK Streaming & Session Management Fixes

## Status: IN PROGRESS (Fixes Applied, Testing Required)

## Completed Work

### Fixes Applied (2025-12-16)

- [x] **Fix 1**: Skip yielding complete `assistant` messages to UI

  - File: `stream-transformer.ts:373-387`
  - Prevents hierarchical structure conflicting with streaming

- [x] **Fix 2**: Create message wrapper on `message_start`

  - File: `sdk-message-transformer.ts:571-585`
  - Provides proper root structure for content nodes

- [x] **Fix 3**: Enhanced `mergeExecutionNode` for proper nesting

  - File: `streaming-handler.service.ts:139-254`
  - Content nodes added as children of message wrapper

- [x] **Fix 4**: Legacy session aggregation and deduplication

  - File: `session-loader.service.ts`
  - Handles older chunk-per-message format

- [x] **Fix 5**: User message content extraction fix

  - File: `session-loader.service.ts`
  - Check `node.content` directly, not just text children

- [x] **Fix 6**: Don't double-save user messages from stream

  - File: `stream-transformer.ts`
  - Only save assistant messages from stream

- [x] **Build verified**: All changes compile successfully
  - Budget temporarily increased to 1.25MB (see TASK_2025_080)

## Remaining Tasks

### Phase 1: Verification Testing (Priority: HIGH)

- [ ] **1.1 Live Streaming Test - Simple Message**

  - Send basic text message
  - Verify single streaming message bubble
  - Verify text updates in place
  - Verify finalization creates proper message

- [ ] **1.2 Live Streaming Test - Tool Use**

  - Send message that triggers tool (e.g., "read file X")
  - Verify tool node appears nested under message
  - Verify tool result displays correctly
  - Verify tool status updates (pending → complete)

- [ ] **1.3 Live Streaming Test - Sub-Agent**

  - Trigger sub-agent spawn (e.g., "use Task agent to...")
  - Verify sub-agent bubble nests under parent
  - Verify sub-agent's tools nest under sub-agent
  - Verify proper parentToolUseId linking

- [ ] **1.4 Session Loading Test - New Session**

  - Create new session with messages
  - Close and reopen session
  - Verify messages load correctly
  - Verify user messages have content

- [ ] **1.5 Session Loading Test - Legacy Format**
  - Find or create legacy session
  - Load and verify aggregation works
  - Verify no duplicate messages

### Phase 2: Edge Case Testing (Priority: MEDIUM)

- [ ] **2.1 Abort and Resume**

  - Start streaming, click stop
  - Verify state resets properly
  - Send new message, verify works

- [ ] **2.2 Rapid Messages**

  - Send multiple messages quickly
  - Verify no message mixing
  - Verify session ID tracking

- [ ] **2.3 Deep Nesting**

  - Trigger multi-level agent spawning
  - Verify proper nesting at each level
  - Verify parentToolUseId chain

- [ ] **2.4 Long Response**
  - Trigger response with many tool calls
  - Verify memory/performance
  - Verify all tools display

### Phase 3: Bug Fixes (As Needed)

- [ ] **3.1 Address any issues from testing**
- [ ] **3.2 Refine nesting logic if needed**
- [ ] **3.3 Add missing debug logging**

### Phase 4: Cleanup (Priority: LOW)

- [ ] **4.1 Remove excessive debug logging**

  - Remove console.log statements added for debugging
  - Keep only essential logging

- [ ] **4.2 Code review**

  - Review all changes for edge cases
  - Check for memory leaks
  - Verify immutability patterns

- [ ] **4.3 Documentation**
  - Update CLAUDE.md files if needed
  - Document streaming architecture

## Issue Tracking

| Issue                          | Status | Notes                                |
| ------------------------------ | ------ | ------------------------------------ |
| Chunks as complete messages    | FIXED  | Skip assistant in stream             |
| Tools detached from sub-agents | FIXED  | Message wrapper + mergeExecutionNode |
| Empty user messages            | FIXED  | Direct content extraction            |
| Duplicate messages             | FIXED  | Skip user from stream + dedup        |
| Legacy format                  | FIXED  | Aggregation logic                    |

## Files Changed

```
libs/backend/agent-sdk/src/lib/
├── helpers/stream-transformer.ts     # Skip user/assistant for UI
└── sdk-message-transformer.ts        # Message wrapper on start

libs/frontend/chat/src/lib/services/chat-store/
├── streaming-handler.service.ts      # Enhanced mergeExecutionNode
└── session-loader.service.ts         # Aggregation + dedup + extraction

apps/ptah-extension-webview/
└── project.json                      # Budget 1.2MB → 1.25MB (temporary)
```

## Debug Points

If issues persist, check these locations:

1. **SDK message flow**: `stream-transformer.ts:198` - log each sdkMessage.type
2. **Node creation**: `sdk-message-transformer.ts:537` - log transformStreamEvent output
3. **Frontend merge**: `streaming-handler.service.ts:34` - already has detailed logging
4. **Session load**: `session-loader.service.ts:207` - log converted messages

## Architecture Notes

### Message Flow During Streaming

```
SDK Stream
    ↓
stream_event (message_start) → Create MESSAGE wrapper node
    ↓
stream_event (content_block_*) → Create TEXT/TOOL nodes
    ↓
mergeExecutionNode() → Add as children of MESSAGE
    ↓
UI renders single message with children
    ↓
assistant (complete) → SKIP for UI (save only)
    ↓
finalizeCurrentMessage() → Mark complete, add to messages
```

### Message Flow for Sub-Agents

```
Parent agent sends Task tool_use
    ↓
SDK spawns sub-agent
    ↓
Sub-agent messages have parent_tool_use_id
    ↓
SdkMessageTransformer captures currentParentToolUseId
    ↓
Sub-agent nodes created with parentToolUseId
    ↓
mergeExecutionNode finds parent by toolCallId
    ↓
Sub-agent content nested under Task tool
```
