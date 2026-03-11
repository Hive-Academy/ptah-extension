# Purge Over-Engineered Layers

**Date**: 2025-12-18
**Task**: TASK_2025_088 - Pre-Production Cleanup
**Goal**: Remove tangled abstractions, dead code, and backward-compatibility shims that never reached production

---

## Executive Summary

The codebase has accumulated **~3,500 lines of over-engineered code** across:

- 8 transformation layers (should be 4)
- 6-layer facade pattern (should be 2-3 services)
- Duplicate type definitions scattered across files
- Wrapper classes that just delegate
- Incomplete/placeholder implementations
- Backward-compatibility code for formats that never shipped

**Rule of Thumb**: No type casting, no `any` usage, no businessless logic hacks.

---

## PHASE 1: DELETE (Remove Entirely)

### 1.1 Dead Files

| File                                                                          | Lines | Reason                                   |
| ----------------------------------------------------------------------------- | ----- | ---------------------------------------- |
| `libs/frontend/chat/src/lib/services/pending-session-manager.service.ts`      | ~150  | Already deleted, orphaned imports remain |
| `libs/frontend/chat/src/lib/services/pending-session-manager.service.spec.ts` | ~100  | Test file for deleted service            |
| `libs/frontend/chat/src/lib/services/message-sender.service.spec.ts`          | ~200  | Tests for old implementation             |

### 1.2 Orphaned Imports to Remove

**File**: `libs/frontend/chat/src/lib/services/chat-store/conversation.service.spec.ts`

```typescript
// DELETE these lines:
import { PendingSessionManagerService } from '../pending-session-manager.service'; // Line 24
let pendingSessionManager: PendingSessionManagerService; // Line 30
// Remove from TestBed.inject() - Line 98
// Remove variable reference - Line 108
```

### 1.3 Deprecated Message Types

**File**: `libs/shared/src/lib/types/message.types.ts` (Lines 228-231)

```typescript
// DELETE these deprecated aliases:
/** @deprecated Use SDK_PERMISSION_RESPONSE instead */
CHAT_PERMISSION_RESPONSE: 'chat:permission-response',  // Line 229

/** @deprecated Use MCP_PERMISSION_RESPONSE instead */
PERMISSION_RESPONSE: 'permission:response',  // Line 231
```

**Also delete** corresponding payload types and update any usages to new types.

---

## PHASE 2: CONSOLIDATE (Merge Duplicates)

### 2.1 SDK Type Definitions → Single Source

**Current State**: SDK types duplicated in 3+ files

- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` (Lines 1-149)
- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (Lines 1-75)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` (Lines 36-72)

**Action**: Use the new consolidated types file:

```
libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts
```

**Delete from each file**:

```typescript
// DELETE these local type definitions:
type SDKMessage = { type: string; [key: string]: any };
type SDKAssistantMessage = SDKMessage & { type: 'assistant' };
type SDKUserMessage = SDKMessage & { type: 'user' };
type SDKSystemMessage = SDKMessage & { type: 'system'; subtype: string };
type SDKResultMessage = SDKMessage & { type: 'result'; ... };
// And all associated type guards
```

**Replace with**:

```typescript
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKResultMessage,
  isStreamEvent,
  isResultMessage,
  // etc.
} from './types/sdk-types/claude-sdk.types';
```

### 2.2 Permission Systems → Single Handler

**Current State**: Two separate permission systems

| Backend                            | Frontend                                |
| ---------------------------------- | --------------------------------------- |
| `SdkPermissionHandler` (507 lines) | `PermissionHandlerService` (300+ lines) |
| Handles SDK canUseTool callback    | Stores requests, routes responses       |
| Manual emitter injection           | Signal-based storage                    |

**Action**: Consolidate into single permission flow:

1. **Keep**: `SdkPermissionHandler` for SDK callback interface
2. **Simplify**: Remove manual `setEventEmitter()` pattern
3. **Delete**: Redundant correlation logic in frontend `PermissionHandlerService`

**Delete from** `sdk-permission-handler.ts`:

```typescript
// DELETE: Manual emitter pattern
private eventEmitter: ((event: string, payload: any) => void) | null = null;

setEventEmitter(emitter: (event: string, payload: any) => void): void {
  this.eventEmitter = emitter;
}

// DELETE: Null checks everywhere
if (!this.eventEmitter) {
  this.logger.error('Event emitter not set');
  return { behavior: 'deny' as const, message: 'Permission system not initialized' };
}
```

**Replace with**: Direct EventBus injection or RPC call.

### 2.3 Message Sender + Conversation → Single Service

**Current State**: Two services with overlapping responsibility

| MessageSenderService (397 lines) | ConversationService                                |
| -------------------------------- | -------------------------------------------------- |
| `send()`, `sendOrQueue()`        | `startNewConversation()`, `continueConversation()` |
| Routes to new/continue           | Handles conversation lifecycle                     |
| Contains 210 lines of RPC logic  | Also has RPC logic                                 |

**Action**: Keep `ConversationService`, eliminate `MessageSenderService`

**Delete entire file**: `libs/frontend/chat/src/lib/services/message-sender.service.ts`

**Update** ChatStore to call ConversationService directly:

```typescript
// BEFORE (chat.store.ts)
await this.messageSender.send(content, files);

// AFTER
await this.conversation.sendMessage(content, files);
```

### 2.4 Tree Builders → Single Implementation

**Current State**: Multiple tree building implementations

- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts` (389 lines)
- `libs/frontend/chat/src/lib/services/tree-builder.service.ts` (older?)

**Action**:

1. Keep `ExecutionTreeBuilderService` (the newer, more complete one)
2. Delete `tree-builder.service.ts` if it's a duplicate
3. Verify no other code depends on the old one

---

## PHASE 3: SIMPLIFY (Reduce Layers)

### 3.1 StreamTransformer → Inline into Adapter

**Current State**: StreamTransformer wraps SdkMessageTransformer

```
SdkAgentAdapter
  └─→ StreamTransformer (328 lines) - extracts sessionId, stats
        └─→ SdkMessageTransformer (844 lines) - actual transformation
```

**Problem**: StreamTransformer just:

1. Extracts session ID from 'init' message
2. Extracts stats from 'result' message
3. Yields transformed events

**Action**: Move extraction logic to `SdkAgentAdapter`, eliminate `StreamTransformer`

**Delete file**: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts`

**Move to** `sdk-agent-adapter.ts`:

```typescript
async *startChatSession(...): AsyncIterable<FlatStreamEventUnion> {
  for await (const sdkMessage of sdkQuery) {
    // Extract session ID (moved from StreamTransformer)
    if (sdkMessage.type === 'system' && sdkMessage.subtype === 'init') {
      this.onSessionIdResolved?.(sdkMessage.session_id);
    }

    // Extract stats (moved from StreamTransformer)
    if (sdkMessage.type === 'result') {
      this.onResultStats?.(this.extractStats(sdkMessage));
      continue; // Don't yield result messages
    }

    // Transform and yield
    const events = this.messageTransformer.transform(sdkMessage, sessionId);
    for (const event of events) {
      yield event;
    }
  }
}
```

**Savings**: 328 lines removed, clearer data flow

### 3.2 ChatStore Facade → Direct Services

**Current State**: 6-layer ChatStore facade

```
ChatStore (714 lines)
  ├─→ StreamingHandlerService (574 lines)
  ├─→ CompletionHandlerService
  ├─→ SessionLoaderService
  ├─→ ConversationService
  └─→ PermissionHandlerService
```

**Problem**: ChatStore has 100+ pass-through methods:

```typescript
processStreamEvent(event) { this.streamingHandler.processStreamEvent(event); }
finalizeCurrentMessage(tabId) { this.streamingHandler.finalizeCurrentMessage(tabId); }
handleSessionStats(stats) { this.streamingHandler.handleSessionStats(stats); }
// ... 50+ more pass-through methods
```

**Action**: Reduce to 3 coordinated services, eliminate facade pass-throughs

**Target Architecture**:

```
ChatStore (300 lines - state only)
  ├─→ StreamingService (handles events + tree building)
  └─→ SessionService (handles lifecycle + loading)
```

**Delete from** `chat.store.ts`:

```typescript
// DELETE: All pass-through methods
processStreamEvent(event: FlatStreamEventUnion): void {
  this.streamingHandler.processStreamEvent(event);
}

finalizeCurrentMessage(tabId?: string): void {
  this.streamingHandler.finalizeCurrentMessage(tabId);
}

// ... delete 50+ similar methods
```

**Replace with**: Direct service injection where needed, or computed signals.

### 3.3 UserMessageStreamFactory → Inline Function

**Current State**: Factory class for single async generator

**File**: `libs/backend/agent-sdk/src/lib/helpers/user-message-stream-factory.ts` (129 lines)

```typescript
@injectable()
export class UserMessageStreamFactory {
  create(sessionId, abortController): AsyncIterable<SDKUserMessage> {
    // 80 lines of generator logic
  }
}
```

**Action**: Convert to standalone function

**Delete file**: `libs/backend/agent-sdk/src/lib/helpers/user-message-stream-factory.ts`

**Move to** `sdk-agent-adapter.ts` as private method:

```typescript
private createUserMessageStream(
  sessionId: SessionId,
  abortController: AbortController
): AsyncIterable<SDKUserMessage> {
  // Same implementation, no factory wrapper
}
```

**Savings**: 129 lines → ~80 lines (factory boilerplate removed)

### 3.4 SdkQueryBuilder → Inline Method

**Current State**: Single-use factory class

**File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-builder.ts` (172 lines)

```typescript
@injectable()
export class SdkQueryBuilder {
  async build(config: QueryBuildConfig): Promise<SdkQueryOptions> {
    // Object field extraction and assembly
  }
}
```

**Action**: Convert to private method in `SdkAgentAdapter`

**Delete file**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-builder.ts`

**Move to** `sdk-agent-adapter.ts`:

```typescript
private buildQueryOptions(config: QueryBuildConfig): SdkQueryOptions {
  // Same implementation, no class wrapper
}
```

**Savings**: 172 lines → ~100 lines

---

## PHASE 4: FIX TYPE SAFETY

### 4.1 Replace `any` with Proper Types

| File                    | Line | Current                  | Replace With              |
| ----------------------- | ---- | ------------------------ | ------------------------- |
| `sdk-rpc-handlers.ts`   | 48   | `modifiedInput?: any`    | `Record<string, unknown>` |
| `sdk-rpc-handlers.ts`   | 52   | `payload: any`           | `FlatStreamEventUnion`    |
| `sdk-rpc-handlers.ts`   | 57   | `sendMessage(..., any)`  | `sendMessage<T>(...)`     |
| `sdk-rpc-handlers.ts`   | 97   | `payload: any`           | Typed event union         |
| `stream-transformer.ts` | 28   | `[key: string]: unknown` | Discriminated union       |

### 4.2 Replace Type Casts with Type Guards

**File**: `sdk-message-transformer.ts` (Lines 669-675)

```typescript
// DELETE: Unsafe casts
const subagentType = (block.input as { subagent_type?: string }).subagent_type;
const description = (block.input as { description?: string }).description;
const prompt = (block.input as { prompt?: string }).prompt;

// REPLACE WITH: Type guard
function isTaskInput(input: unknown): input is TaskToolInput {
  return typeof input === 'object' && input !== null && ('subagent_type' in input || 'description' in input || 'prompt' in input);
}

if (isTaskInput(block.input)) {
  const { subagent_type, description, prompt } = block.input;
}
```

### 4.3 Fix JSON.parse Data Loss

**File**: `execution-tree-builder.service.ts` (Lines 292-303)

```typescript
// DELETE: Silent failure
try {
  toolInput = JSON.parse(inputString);
} catch {
  toolInput = undefined; // Data loss!
}

// REPLACE WITH: Error tracking
interface ParseResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  raw?: string;
}

function parseToolInput(input: string): ParseResult<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(input);
    if (typeof parsed !== 'object' || parsed === null) {
      return { success: false, error: 'Not an object', raw: input };
    }
    return { success: true, data: parsed };
  } catch (e) {
    return { success: false, error: String(e), raw: input };
  }
}

// Usage - surface errors in UI
const result = parseToolInput(inputString);
if (result.success) {
  toolInput = result.data;
} else {
  toolInput = { __parseError: result.error, __raw: result.raw };
}
```

---

## PHASE 5: REMOVE INCOMPLETE IMPLEMENTATIONS

### 5.1 sendOrQueue() - Incomplete Queueing

**File**: `message-sender.service.ts` (Line 246)

```typescript
// DELETE: This method does nothing useful
async sendOrQueue(content: string, files?: string[]): Promise<void> {
  const isStreaming = activeTab?.status === 'streaming';
  if (isStreaming) {
    console.log('[MessageSender] Streaming active, message will be queued');
    return; // NO-OP! Message is NOT actually queued!
  } else {
    await this.send(content, files);
  }
}
```

**Action**: Either implement proper queueing or delete the method entirely.

### 5.2 Phase 2 TODOs - Clean Up or Implement

**Files with incomplete implementations**:

- `libs/backend/vscode-core/src/api-wrappers/index.ts` (Lines 8, 12, 16, 23, 31)
- `libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts` (Lines 222, 248)
- `libs/frontend/chat/src/lib/services/tab-manager.service.ts` (Lines 18, 388, 393, 412)

**Action**: Review each TODO - implement or remove the placeholder code.

---

## Summary: Lines to Remove/Refactor

| Phase     | Category           | Lines Affected | Action                             |
| --------- | ------------------ | -------------- | ---------------------------------- |
| 1         | Dead Files         | ~450           | Delete entirely                    |
| 2         | Duplicate Types    | ~300           | Consolidate to single file         |
| 2         | Duplicate Services | ~700           | Merge MessageSender → Conversation |
| 3         | StreamTransformer  | 328            | Inline into Adapter                |
| 3         | ChatStore Facade   | ~400           | Remove pass-throughs               |
| 3         | Factory Classes    | ~300           | Convert to functions               |
| 4         | Type Safety        | ~200           | Add type guards                    |
| 5         | Incomplete Code    | ~100           | Delete or implement                |
| **Total** |                    | **~2,778**     |                                    |

---

## Execution Order

1. **Week 1**: Phase 1 (Delete dead code) + Phase 4 (Type safety)
2. **Week 2**: Phase 2 (Consolidate duplicates)
3. **Week 3**: Phase 3 (Simplify layers)
4. **Week 4**: Phase 5 (Clean up incomplete) + Testing

---

## Validation Checklist

After each phase:

- [ ] `npm run build:all` passes
- [ ] `npm run typecheck:all` passes
- [ ] `npm run lint:all` passes
- [ ] `npm run test` passes (or tests updated)
- [ ] Manual testing: Start session, stream messages, permissions work

---

## Files Reference

### To Delete Entirely

```
libs/frontend/chat/src/lib/services/pending-session-manager.service.ts
libs/frontend/chat/src/lib/services/pending-session-manager.service.spec.ts
libs/frontend/chat/src/lib/services/message-sender.service.spec.ts
libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts
libs/backend/agent-sdk/src/lib/helpers/user-message-stream-factory.ts
libs/backend/agent-sdk/src/lib/helpers/sdk-query-builder.ts
```

### To Heavily Refactor

```
libs/frontend/chat/src/lib/services/message-sender.service.ts → Delete or merge
libs/frontend/chat/src/lib/services/chat.store.ts → Remove facade methods
libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts → Absorb helper logic
libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts → Use centralized types
libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts → Remove emitter pattern
```

### Type Safety Fixes

```
libs/backend/vscode-core/src/messaging/sdk-rpc-handlers.ts
libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts
libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts
```
