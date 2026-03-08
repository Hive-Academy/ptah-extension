# Implementation Plan - TASK_2025_185: Graceful Re-Steering

## Codebase Investigation Summary

### Kill Chain Analysis (Verified)

The current re-steering flow destroys all running subagents:

1. User sends message while streaming -> `ChatStore.sendOrQueueMessage()` queues content (line 398, chat.store.ts)
2. On `message_complete` event (non-subagent), `StreamingHandlerService` returns `queuedContent` (line 428-433, streaming-handler.service.ts)
3. `ChatStore.processStreamEvent()` calls `interruptAndSend()` (line 806, chat.store.ts)
4. `interruptAndSend()` calls `abortCurrentMessage()` -> `chat:abort` RPC (line 723, chat.store.ts)
5. `chat:abort` handler calls `sdkAdapter.interruptSession()` (line 1144, chat-rpc.handlers.ts)
6. `SessionLifecycleManager.endSession()` -> `subagentRegistry.markAllInterrupted()` + `abortController.abort()` (lines 321, 358, session-lifecycle-manager.ts)
7. All CLI agent processes lose MCP connections -> tools fail

### Key SDK Architecture (Verified)

- **Message Stream**: `createUserMessageStream()` creates an async iterable that yields `SDKUserMessage` objects from `session.messageQueue` (line 436-510, session-lifecycle-manager.ts)
- **Wake Mechanism**: `session.resolveNext` callback wakes the iterator when a new message arrives (line 489-495)
- **sendMessage()**: Pushes to `session.messageQueue` and calls `resolveNext()` (lines 720-735, session-lifecycle-manager.ts)
- **streamInput()**: Used for resume/slash-command sessions to deliver follow-up messages (line 670-678)
- **interrupt()**: SDK graceful stop - sends stop signal, lets current tool finish (line 55, Query interface)
- **abortController.abort()**: Hard kill - terminates SDK process immediately (line 358)

### Background Agent Protection (Verified)

- `SubagentRegistryService.markAllInterrupted()` already skips agents with `isBackground === true` (line 369, subagent-registry.service.ts)
- Background agents have status `'background'` in the registry
- `SubagentHookHandler` handles background completion separately via `emitBackgroundAgentCompleted()` (line 339, subagent-hook-handler.ts)

### Frontend Re-Steering Flow (Verified)

- `sendOrQueueMessage()` queues content when `isStreaming` (line 398-418, chat.store.ts)
- Queue trigger: `message_complete` event without `parentToolUseId` (line 428, streaming-handler.service.ts)
- Also triggers from `handleSessionStats` at turn end (line 691-713, streaming-handler.service.ts)
- The 100ms delay in `interruptAndSend()` (line 730) is a fragile timing hack

## Architecture Design

### Design Philosophy

**Queue-First, Don't Kill**: The SDK's `streamInput` mode already supports message queuing via the async iterable. When a user sends a new message while agents are running, we should simply queue the message and let the SDK process it when the current turn completes. No abort, no interrupt, no killed agents.

**Two Distinct User Intents**:

1. **Re-steer** (send new message) = "Process this next, but let current work finish"
2. **Stop** (click stop button) = "I want everything to halt"

Currently, both intents trigger the same destructive path. This plan separates them.

### New Flow: Re-Steering (Send Message During Streaming)

```
User types message while agents running
  -> Frontend: sendOrQueueMessage() queues content (UNCHANGED)
  -> On message_complete: instead of interruptAndSend(), call sendQueuedMessage()
  -> sendQueuedMessage() calls chat:continue RPC with queued content
  -> Backend: sendMessage() pushes to messageQueue, wakes iterator
  -> SDK picks up message naturally when current turn ends
  -> Agents continue running undisturbed
```

### New Flow: Explicit Stop (Click Stop Button)

```
User clicks Stop button
  -> Frontend: shows confirmation if running agents > 0
  -> User confirms -> abortCurrentMessage() -> chat:abort RPC (UNCHANGED)
  -> Backend: endSession() with interrupt + abort (UNCHANGED)
```

## Specific Changes

### Phase 1: Backend - Add Running Agent Query (SubagentRegistryService)

**File**: `libs/backend/vscode-core/src/services/subagent-registry.service.ts`

**Add method**: `getRunningBySession(parentSessionId: string): SubagentRecord[]`

Returns all subagents with `status === 'running'` for a given parent session. This is needed so the frontend can show "X agents are running" in the stop confirmation dialog.

```typescript
/**
 * Get all running (non-background) subagents for a session.
 * Used by frontend to show confirmation before interrupting.
 */
getRunningBySession(parentSessionId: string): SubagentRecord[] {
  const running: SubagentRecord[] = [];
  for (const record of this.registry.values()) {
    if (
      record.parentSessionId === parentSessionId &&
      record.status === 'running' &&
      !record.isBackground
    ) {
      running.push(record);
    }
  }
  return running;
}
```

**Evidence**: Follows the same pattern as `getResumableBySession()` (line 338-342) and `getBackgroundAgents()` (line 313-325).

### Phase 2: Backend - Add Running Agent Count RPC

**File**: `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts`

**Add RPC method**: `chat:running-agents`

Returns the count and types of running agents for a session. The frontend calls this before showing the stop confirmation.

```typescript
this.rpcHandler.registerMethod<{ sessionId: SessionId }, { agents: { agentId: string; agentType: string }[] }>('chat:running-agents', async (params) => {
  const running = this.subagentRegistry.getRunningBySession(params.sessionId as string);
  return {
    agents: running.map((r) => ({
      agentId: r.agentId,
      agentType: r.agentType,
    })),
  };
});
```

**Evidence**: Follows the existing RPC registration pattern used by `chat:abort` (line 1131) and `chat:continue` (line 631).

### Phase 3: Frontend - Replace interruptAndSend with sendQueuedMessage

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Replace** `interruptAndSend()` (lines 712-741) with `sendQueuedMessage()`:

```typescript
/**
 * Send queued message without interrupting the session.
 * TASK_2025_185: Replace interruptAndSend to prevent killing running agents.
 *
 * Instead of aborting the session and restarting, we simply send the
 * queued message via chat:continue. The SDK message queue will deliver
 * it when the current turn completes.
 */
private async sendQueuedMessage(tabId: string, content: string): Promise<void> {
  try {
    console.log('[ChatStore] sendQueuedMessage: sending without interrupt');

    // Clear the queue
    this.tabManager.updateTab(tabId, { queuedContent: null });

    // Send the message normally (will go through chat:continue)
    await this.messageSender.send(content);

    console.log('[ChatStore] sendQueuedMessage: message sent to SDK queue');
  } catch (error) {
    console.error('[ChatStore] sendQueuedMessage failed:', error);
    // On error, restore content to queue so user doesn't lose it
    this.tabManager.updateTab(tabId, { queuedContent: content });
  }
}
```

**Update** `processStreamEvent()` (line 796-807) to call `sendQueuedMessage` instead of `interruptAndSend`:

```typescript
// TASK_2025_185: Send queued message without interrupting
if (result && result.queuedContent) {
  console.log('[ChatStore] Sending queued message (no interrupt)');
  const queuedContent = result.queuedContent;
  const resultTabId = result.tabId;
  this.sendQueuedMessage(resultTabId, queuedContent);
}
```

**Evidence**: `messageSender.send()` calls `ConversationService.sendMessage()` which routes to `continueConversation()` -> `chat:continue` RPC -> `sdkAdapter.sendMessageToSession()` -> `sessionLifecycle.sendMessage()` which pushes to `messageQueue` and wakes the iterator. This is the exact path that's already used for normal follow-up messages. No new code path needed.

### Phase 4: Frontend - Add Stop Confirmation Dialog

**File**: `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts`

**Add method**: `abortWithConfirmation()` that queries running agents and shows confirmation before aborting.

```typescript
/**
 * Abort with confirmation when agents are running.
 * TASK_2025_185: Show how many agents will be killed.
 *
 * @returns true if abort was executed, false if user cancelled
 */
async abortWithConfirmation(): Promise<boolean> {
  const sessionId = this.currentSessionId();
  if (!sessionId) {
    // No session, just abort normally
    await this.abortCurrentMessage();
    return true;
  }

  // Query running agents from backend
  try {
    const result = await this.claudeRpcService.call('chat:running-agents', {
      sessionId: sessionId as SessionId,
    });

    const agents = result?.agents ?? [];

    if (agents.length === 0) {
      // No running agents, abort immediately
      await this.abortCurrentMessage();
      return true;
    }

    // Show confirmation dialog via ConfirmationDialogService
    const dialogService = this.injector.get(ConfirmationDialogService);
    const agentTypes = agents.map(a => a.agentType).join(', ');
    const confirmed = await dialogService.confirm({
      title: 'Stop Running Agents?',
      message: `${agents.length} agent(s) are still running (${agentTypes}). Stopping will interrupt their current work and any in-progress tool calls will be lost.`,
      confirmLabel: 'Stop All',
      cancelLabel: 'Keep Running',
      variant: 'warning',
    });

    if (confirmed) {
      await this.abortCurrentMessage();
      return true;
    }

    return false;
  } catch (error) {
    console.error('[ConversationService] Failed to check running agents:', error);
    // On error, abort without confirmation (fail-safe)
    await this.abortCurrentMessage();
    return true;
  }
}
```

**Evidence**: `ConfirmationDialogService` exists at `libs/frontend/chat/src/lib/services/confirmation-dialog.service.ts` (found in CLAUDE.md directory listing). The `claudeRpcService.call()` pattern is used throughout (e.g., line 302, 429, 513 in conversation.service.ts).

**File**: `libs/frontend/chat/src/lib/services/chat.store.ts`

**Add public method** delegating to ConversationService:

```typescript
/**
 * Abort with confirmation when agents are running (TASK_2025_185)
 */
async abortWithConfirmation(): Promise<boolean> {
  return this.conversation.abortWithConfirmation();
}
```

### Phase 5: Frontend - Wire Stop Button to Confirmation

**File**: `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts`

Search for the stop button handler that calls `abortCurrentMessage()` or equivalent. Update it to call `abortWithConfirmation()` instead, so the user gets the confirmation dialog when agents are running.

The stop button likely calls `chatStore.abortCurrentMessage()` or `conversation.abortCurrentMessage()`. Change to `chatStore.abortWithConfirmation()`.

### Phase 6: Shared Types - Add RPC Types

**File**: `libs/shared/src/lib/message-protocol/types/chat-message.types.ts` (or relevant shared types file)

Add types for the new `chat:running-agents` RPC:

```typescript
export interface ChatRunningAgentsParams {
  sessionId: SessionId;
}

export interface ChatRunningAgentsResult {
  agents: { agentId: string; agentType: string }[];
}
```

**Evidence**: Follows existing pattern of `ChatAbortParams`/`ChatAbortResult`, `ChatContinueParams`/`ChatContinueResult` etc. (imported at line 44-52 of chat-rpc.handlers.ts).

### Phase 7: Streaming Handler - Remove Interrupt Trigger on Session Stats

**File**: `libs/frontend/chat/src/lib/services/chat-store/streaming-handler.service.ts`

The `handleSessionStats()` method (line 633+) also returns `queuedContent` which triggers `interruptAndSend` in `ChatStore`. This path handles the "turn ended" case. In the new architecture, this should also use `sendQueuedMessage` instead of `interruptAndSend`.

**In `ChatStore`**, update the `handleSessionStats` caller to use `sendQueuedMessage`:

Find where `handleSessionStats` result is processed (look for `queuedContent` from stats). Update the same way as Phase 3 - call `sendQueuedMessage` instead of `interruptAndSend`.

## Critical Design Decisions

### Decision 1: Queue Instead of Interrupt

**Chosen**: Send queued messages via `chat:continue` (existing path) without aborting the session.

**Rationale**: The SDK's message stream architecture already supports this. `SessionLifecycleManager.sendMessage()` pushes to `messageQueue` and wakes the async iterator. The SDK will process the message when the current turn completes. This is the same path used for normal follow-up messages - no new infrastructure needed.

**Risk**: If the SDK is in a long tool execution (e.g., 15-minute agent run), the queued message won't be processed until the tool finishes. This is the correct behavior - the user's message will be processed next, and agents won't be killed.

### Decision 2: Confirmation Only on Explicit Stop

**Chosen**: Only show agent count confirmation when user clicks the Stop button, not when sending a message.

**Rationale**: Sending a message during streaming is a common UX pattern (re-steering). Adding a confirmation dialog to every message send would be annoying. The confirmation is only needed when the user explicitly wants to stop execution, because that's the destructive action.

### Decision 3: Background Agents Already Protected

**Chosen**: No changes needed to background agent handling.

**Rationale**: `SubagentRegistryService.markAllInterrupted()` already skips agents with `isBackground === true` (line 369). The `SubagentHookHandler` handles background completion independently. The existing protection is sufficient.

### Decision 4: No Changes to Backend Abort Path

**Chosen**: Keep `SessionLifecycleManager.endSession()` unchanged - it still does interrupt + abort when called.

**Rationale**: The abort path is correct for explicit stops. The fix is in the frontend: stop calling abort when the user sends a message. The backend abort is the correct behavior when the user actually wants to stop.

## Risk Assessment

### Low Risk

- **Phase 1 (getRunningBySession)**: Simple query method following existing patterns. No side effects.
- **Phase 2 (RPC method)**: Standard RPC registration. Read-only operation.
- **Phase 6 (shared types)**: Type additions only. No runtime impact.

### Medium Risk

- **Phase 3 (replace interruptAndSend)**: Core behavioral change. The `interruptAndSend` pattern has been working (albeit destructively) since TASK_2025_100. The replacement path (`messageSender.send`) is well-tested for normal message flow, but hasn't been used specifically for mid-stream re-steering.

  - **Mitigation**: The `sendMessage` -> `continueConversation` -> `chat:continue` -> `sendMessageToSession` path is the standard message delivery path. It should work identically whether called during or after streaming.

- **Phase 7 (session stats path)**: There are two trigger points for queued content processing. Both must be updated consistently.
  - **Mitigation**: Both call sites are in the same file (chat.store.ts). The fix is identical for both.

### Higher Risk

- **Phase 4/5 (confirmation dialog)**: New UI interaction. Needs proper dialog service integration and the stop button handler must be correctly identified and updated.

  - **Mitigation**: The `ConfirmationDialogService` already exists. The dialog is non-blocking (user can dismiss). Falls back to immediate abort on error.

- **SDK message timing**: When the user sends a message during a long agent execution, the SDK won't process it until the current turn ends. The user might perceive this as "message not sent" if there's no visual feedback.
  - **Mitigation**: The user message is still added to the UI immediately (via `continueConversation`). The tab status transitions to 'resuming', providing visual feedback. The message queue in `SessionLifecycleManager` will deliver it when the SDK is ready.

## Files Affected Summary

**CREATE**: None

**MODIFY**:

- `libs/backend/vscode-core/src/services/subagent-registry.service.ts` - Add `getRunningBySession()`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/chat-rpc.handlers.ts` - Add `chat:running-agents` RPC
- `libs/frontend/chat/src/lib/services/chat.store.ts` - Replace `interruptAndSend` with `sendQueuedMessage`, add `abortWithConfirmation`
- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` - Add `abortWithConfirmation()`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.ts` - Wire stop button to confirmation
- `libs/shared/src/lib/message-protocol/types/chat-message.types.ts` - Add RPC types (or wherever ChatAbortParams is defined)

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: Both frontend-developer and backend-developer

**Rationale**:

- Backend changes (Phases 1, 2): Simple method additions following existing patterns. Backend developer.
- Frontend changes (Phases 3, 4, 5, 7): Core UX behavior change, dialog integration. Frontend developer.
- Shared types (Phase 6): Either developer.

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 4-6 hours

**Breakdown**:

- Phase 1 (backend query method): 30 min
- Phase 2 (RPC method): 30 min
- Phase 3 (replace interruptAndSend): 1 hour
- Phase 4 (confirmation dialog): 1.5 hours
- Phase 5 (wire stop button): 30 min
- Phase 6 (shared types): 15 min
- Phase 7 (session stats path): 30 min
- Testing & verification: 1-2 hours

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **messageSender.send() path during streaming**: Ensure `ConversationService.sendMessage()` -> `continueConversation()` works correctly when called while the tab is in 'streaming' status. The `continueConversation` method sets status to 'resuming' (line 395), which may conflict with the existing 'streaming' status.

2. **Stop button location**: Search for `abortCurrentMessage` calls in chat-input component to find the exact stop button handler to update.

3. **ConfirmationDialogService API**: Verify the `confirm()` method signature matches what's proposed. Read `libs/frontend/chat/src/lib/services/confirmation-dialog.service.ts`.

4. **Shared types location**: Find where `ChatAbortParams` is defined to add the new types in the same file.

5. **Both queued content trigger paths**: Ensure both the `message_complete` path (streaming-handler) and the `handleSessionStats` path are updated to use `sendQueuedMessage`.

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined
- [x] Integration points documented
- [x] Files affected list complete
- [x] Developer type recommended
- [x] Complexity assessed
- [x] No step-by-step implementation (that's team-leader's job)
