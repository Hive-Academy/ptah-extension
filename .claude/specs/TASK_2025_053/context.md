# TASK_2025_053: ChatStore Refactoring - Complete Service Extraction

## Overview

Continue the ChatStore refactoring started in TASK_2025_050 Batch 4. The goal is to split the monolithic `chat.store.ts` (1500+ lines) into smaller, focused child services following the Facade pattern.

## Current State

**Folder structure created:** `libs/frontend/chat/src/lib/services/chat-store/`

**Child services already extracted:**

- `streaming-handler.service.ts` - ExecutionNode processing, tree merge, finalize message
- `completion-handler.service.ts` - Chat complete/error handling, auto-send queue

**ChatStore currently delegates:**

- `processExecutionNode()` → `StreamingHandlerService.processExecutionNode()`

## Remaining Work

### Services to Create

1. **`session-loader.service.ts`** (~200 lines)

   - `loadSessions()`, `loadMoreSessions()`, `switchSession()`
   - `handleSessionIdResolved()`
   - Pagination state signals

2. **`conversation.service.ts`** (~300 lines)

   - `startNewConversation()`, `continueConversation()`
   - `sendMessage()`, `sendOrQueueMessage()`
   - `abortCurrentMessage()`

3. **`permission-handler.service.ts`** (~100 lines)
   - `handlePermissionRequest()`, `handlePermissionResponse()`
   - `getPermissionForTool()`
   - Permission request signals

### Final Step

Generate new clean `chat.store.ts` (~400 lines) that:

- Keeps all public signals and computed properties
- Delegates all action methods to child services
- Maintains backward compatibility (same public API)

## Files to Modify

| File                                       | Action                              |
| ------------------------------------------ | ----------------------------------- |
| `chat-store/session-loader.service.ts`     | CREATE                              |
| `chat-store/conversation.service.ts`       | CREATE                              |
| `chat-store/permission-handler.service.ts` | CREATE                              |
| `chat.store.ts`                            | REPLACE with new delegating version |
| `chat-store/index.ts`                      | CREATE barrel export                |

## Dependencies

- TASK_2025_050 (complete) - Stop button and SDK sync features

## Commits from TASK_2025_050

| Commit    | Description                                              |
| --------- | -------------------------------------------------------- |
| `3f78af5` | Extract streaming and completion handlers from ChatStore |
| `407000e` | Move child services to chat-store/ folder                |

## Approach

1. Create all remaining child services in `chat-store/` folder
2. Test each service with typecheck
3. Generate new refactored `chat.store.ts` that delegates to all services
4. Run full typecheck and lint
5. Commit as single atomic change
