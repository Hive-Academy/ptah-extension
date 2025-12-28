# TASK_2025_040: Message Queue & Session Control

## Task Overview

Implement message queuing and stop/interrupt functionality for the chat system, allowing users to queue messages while Claude is working and stop execution mid-response.

## User Requirements

### 1. Message Queue (Simplified)

- User can send messages while Claude is streaming
- **Single queued message only** - NOT an array
- If user sends multiple messages while streaming, **append to same queued content** (separated by newlines)
- When Claude finishes, automatically send queued content via `continueConversation()`
- Show queued content visually in chat

### 2. Stop/Interrupt Functionality

- User can click "Stop" to interrupt Claude mid-response
- Backend sends SIGINT to Claude CLI process (clean interrupt)
- Frontend finalizes current message and resets to loaded state

### 3. Stop + Queue Behavior (Critical)

- If user clicks Stop while having queued content:
  - Do NOT auto-send the queued content
  - Move queued content BACK to the chat input textarea
  - Clear the queue
- This allows user to edit/reconsider before sending

## Technical Context

### Claude CLI Behavior (from research)

- Claude CLI is spawn-per-turn by design - each message requires new process
- `stdin.end()` is the submit trigger - newline alone doesn't work
- `--resume` flag maintains context across processes
- SIGINT cleanly interrupts mid-response

### Current Architecture

**ChatStore** (`libs/frontend/chat/src/lib/services/chat.store.ts`):

- `isStreaming()` computed signal (lines 137-140)
- `handleChatComplete()` handles process exit (lines 1196-1255)
- `continueConversation()` uses `--resume` flag (lines 660-752)
- `abortCurrentMessage()` calls `chat:abort` RPC (lines 954-983)

**ChatInputComponent** (`libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`):

- `isDisabled = computed(() => this.chatStore.isStreaming())` (line 118)
- `handleSend()` blocks during streaming (lines 150-168)

**TabState** (`libs/frontend/chat/src/lib/services/chat.types.ts`):

- Per-tab state with status, messages, executionTree (lines 111-144)

**Backend RPC** (`libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts`):

- `chat:abort` method exists but uses `kill()` not SIGINT (lines 433-456)

## Implementation Approach (YAGNI/DRY/SOLID)

### Minimal Changes Required

1. **TabState**: Add single `queuedContent?: string | null` field
2. **ChatStore**:
   - Add `queueOrAppendMessage(content: string)` method
   - Add `clearQueuedContent()` method
   - Add `moveQueueToInput()` method (returns content and clears)
   - Modify `handleChatComplete()` to process queue
   - Modify `abortCurrentMessage()` to handle queue→input flow
3. **ChatInputComponent**:
   - Remove streaming disable constraint
   - Smart send: queue if streaming, send if not
   - Accept content from queue on stop
4. **ChatViewComponent**: Add queued content indicator in template
5. **Backend RPC**: Rename `chat:abort` to `chat:stop`, use SIGINT

### NOT Needed (YAGNI)

- `QueuedMessage[]` array - single string suffices
- `QueuedMessageComponent` - inline template
- Cancel individual messages - only one queued item
- Complex queue management service

## Key Files to Modify

| File                                                                        | Changes                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------- |
| `libs/frontend/chat/src/lib/services/chat.types.ts`                         | Add `queuedContent` to TabState                     |
| `libs/frontend/chat/src/lib/services/chat.store.ts`                         | Add queue methods, modify completion/abort handlers |
| `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`   | Smart send, accept queue on stop                    |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`  | Queued content indicator                            |
| `libs/backend/vscode-core/src/messaging/rpc-method-registration.service.ts` | SIGINT for stop                                     |

## Reference Document

See: `docs/future-enhancements/message-queue-and-session-control.md` for original research and diagrams

## Success Criteria

- [ ] User can type and send while Claude is streaming
- [ ] Multiple sends while streaming append to single queued message
- [ ] Queued content shows visually in chat
- [ ] Stop button interrupts Claude cleanly (SIGINT)
- [ ] Stop with queue moves content to input (not auto-send)
- [ ] Queue auto-sends when Claude finishes normally
- [ ] No data loss during queue/stop operations
