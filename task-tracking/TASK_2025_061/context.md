# Context - TASK_2025_061: Chat Input UX Enhancement

## User Intent

Improve the chat input UX during streaming to match modern coding agents (ChatGPT, Cursor):

1. Toggle send/stop button in same position (not separate buttons)
2. Allow typing and Enter to queue messages during streaming
3. Show "message queued" indicator when content is queued

## Current State

- Backend supports message queueing via `sendOrQueueMessage()` ✅
- Stop streaming via `abortCurrentMessage()` works ✅
- UI shows loading spinner on send button during streaming ❌
- Input feels blocked even though queueing works ❌
- No visual feedback for queued messages ❌

## Source Files

- `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`
- `libs/frontend/chat/src/lib/services/chat.store.ts`
