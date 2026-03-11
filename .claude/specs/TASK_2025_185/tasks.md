# Development Tasks - TASK_2025_185: Graceful Re-Steering

**Total Tasks**: 8 | **Batches**: 3 | **Status**: 0/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `messageSender.send()` routes through `continueConversation()` -> `chat:continue` RPC -> `sendMessageToSession()` -> `messageQueue`: VERIFIED in conversation.service.ts line 429
- `ConfirmationDialogService.confirm()` accepts `{title, message, confirmLabel, cancelLabel, confirmStyle}`: VERIFIED in confirmation-dialog.service.ts line 6-12 (note: plan says `variant: 'warning'` but actual API uses `confirmStyle: 'warning'`)
- `SubagentRegistryService` already injected in chat-rpc.handlers.ts via `TOKENS.SUBAGENT_REGISTRY_SERVICE`: VERIFIED at line 76
- `handleSessionStats` path already uses `messageSender.send()` directly (line 999-1000) without calling `interruptAndSend`: VERIFIED -- this path is already safe
- `ChatAbortParams` defined in `libs/shared/src/lib/types/rpc.types.ts` line 116: VERIFIED
- Stop button handler at chat-input.component.ts line 801 calls `chatStore.abortCurrentMessage()`: VERIFIED

### Risks Identified

| Risk                                                                                                                                                       | Severity | Mitigation                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| Plan Phase 4 uses `variant: 'warning'` but actual API uses `confirmStyle: 'warning'`                                                                       | LOW      | Developer must use `confirmStyle` not `variant`                                                          |
| `handleSessionStats` path (line 997-1013) already sends without interrupt -- no change needed there                                                        | LOW      | Document clearly that only `processStreamEvent` trigger (line 806) needs fixing                          |
| `sendQueuedMessage` calls `messageSender.send()` during streaming status -- need to verify `continueConversation` handles `streaming` status tab correctly | MED      | `continueConversation` sets status to `'resuming'` (line 395) which is valid transition from `streaming` |

### Edge Cases to Handle

- [ ] What if `messageSender.send()` fails during `sendQueuedMessage` -> restore content to queue (plan covers this)
- [ ] What if no session exists when stop button clicked -> skip confirmation, abort immediately (plan covers this)
- [ ] What if `chat:running-agents` RPC fails -> fallback to immediate abort without confirmation (plan covers this)

---

## Batch 1: Backend + Shared Types IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None

### Task 1.1: Add `getRunningBySession()` to SubagentRegistryService IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subagent-registry.service.ts`
**Method to add**: `getRunningBySession(parentSessionId: string): SubagentRecord[]`
**Insert after**: Line 342 (after `getResumableBySession` method)
**Pattern to Follow**: `getBackgroundAgents()` at line 313-325 (same iteration + filter pattern)

**Quality Requirements**:

- Filter by `parentSessionId`, `status === 'running'`, and `!record.isBackground`
- Return `SubagentRecord[]` (same type used by `getResumable()`)
- No TTL check needed (running agents are by definition recent)
- Add JSDoc following existing style

**Implementation Details**:

- Iterate `this.registry.values()`
- Filter: `record.parentSessionId === parentSessionId && record.status === 'running' && !record.isBackground`
- Push matching records to result array and return

---

### Task 1.2: Add RPC types for `chat:running-agents` IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`
**Types to add**: `ChatRunningAgentsParams` and `ChatRunningAgentsResult`
**Insert after**: Line 125 (after `ChatAbortResult` interface)
**Registry entry**: Add to `RpcMethodRegistry` interface after `'chat:abort'` entry at line 1425

**Quality Requirements**:

- `ChatRunningAgentsParams`: `{ sessionId: SessionId }`
- `ChatRunningAgentsResult`: `{ agents: { agentId: string; agentType: string }[] }`
- Follow existing pattern of `ChatAbortParams`/`ChatAbortResult` (same file, line 116-125)
- Add JSDoc comments matching existing style

**Implementation Details**:

- Import `SessionId` already available (line 10)
- Add interfaces after `ChatAbortResult` (line 125)
- Add registry entry: `'chat:running-agents': { params: ChatRunningAgentsParams; result: ChatRunningAgentsResult };` after `'chat:abort'` in `RpcMethodRegistry` (line 1425)

---

### Task 1.3: Register `chat:running-agents` RPC handler IMPLEMENTED

**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\chat-rpc.handlers.ts`
**Method to add**: `registerChatRunningAgents()` private method
**Call site**: Add `this.registerChatRunningAgents();` in `register()` method at line 453 (after `registerChatAbort()`)
**Import to add**: `ChatRunningAgentsParams, ChatRunningAgentsResult` in the shared import block (line 43-52)

**Quality Requirements**:

- Follow same pattern as `registerChatAbort()` (line 1130-1164)
- Use `this.subagentRegistry.getRunningBySession()` (already injected at line 76)
- Map results to `{ agentId, agentType }` objects
- Wrap in try/catch with proper error logging

**Implementation Details**:

- Register method name: `'chat:running-agents'`
- Type params: `ChatRunningAgentsParams, ChatRunningAgentsResult`
- Extract `sessionId` from params, cast to string for registry call
- Return `{ agents: running.map(r => ({ agentId: r.agentId, agentType: r.agentType })) }`
- Add `'chat:running-agents'` to the methods array in the debug log at line 458

---

**Batch 1 Verification**:

- All files exist at paths
- Build passes: `npx nx build vscode-core` and `npx nx build shared`
- code-logic-reviewer approved
- No stubs or TODOs

---

## Batch 2: Frontend Core Fix (Replace interruptAndSend) IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Replace `interruptAndSend` with `sendQueuedMessage` in ChatStore IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
**Method to replace**: `interruptAndSend()` at lines 712-741
**Method to add**: `sendQueuedMessage()` (private, same location)
**Caller to update**: `processStreamEvent()` at lines 796-807

**Quality Requirements**:

- New `sendQueuedMessage()` must NOT call `abortCurrentMessage()` -- this is the core fix
- Clear `queuedContent` from tab before sending
- On error, restore content to queue (preserve user input)
- Update `processStreamEvent()` call at line 806 from `this.interruptAndSend(resultTabId, queuedContent)` to `this.sendQueuedMessage(resultTabId, queuedContent)`
- Update the console.log at line 797-799 to say "Sending queued message (no interrupt)" instead of "Re-steering: interrupting and sending queued content"

**Implementation Details**:

- `sendQueuedMessage(tabId: string, content: string): Promise<void>`
- Body: clear queue via `this.tabManager.updateTab(tabId, { queuedContent: null })`, then `await this.messageSender.send(content)`
- Wrap in try/catch, restore queue on error: `this.tabManager.updateTab(tabId, { queuedContent: content })`
- Delete the old `interruptAndSend` method entirely

---

### Task 2.2: Add `abortWithConfirmation()` to ConversationService IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\conversation.service.ts`
**Method to add**: `abortWithConfirmation(): Promise<boolean>` (public)
**Insert after**: `abortCurrentMessage()` method (which starts at line 466)

**Quality Requirements**:

- Get `sessionId` from active tab's `claudeSessionId` (same pattern as `continueConversation` line 374)
- If no sessionId, abort immediately without confirmation
- Call `claudeRpcService.call('chat:running-agents', { sessionId })` to get running agent count
- If 0 agents, abort immediately
- If agents running, use `ConfirmationDialogService.confirm()` with `confirmStyle: 'warning'` (NOT `variant`)
- On RPC error, fall back to immediate abort (fail-safe)
- Return `true` if aborted, `false` if user cancelled

**Implementation Details**:

- Import `ConfirmationDialogService` from `'../confirmation-dialog.service'`
- Use `this.injector.get(ConfirmationDialogService)` for lazy injection (same pattern as `StreamingHandlerService` at line 401)
- Import `SessionId` from `@ptah-extension/shared` (already imported at line 19)
- Dialog message: `"${agents.length} agent(s) are still running (${agentTypes}). Stopping will interrupt their current work and any in-progress tool calls will be lost."`
- Dialog options: `title: 'Stop Running Agents?'`, `confirmLabel: 'Stop All'`, `cancelLabel: 'Keep Running'`, `confirmStyle: 'warning'`

---

### Task 2.3: Expose `abortWithConfirmation()` on ChatStore IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
**Method to add**: `abortWithConfirmation(): Promise<boolean>` (public)
**Insert after**: `abortCurrentMessage()` at line 674-676

**Quality Requirements**:

- Simple delegation: `return this.conversation.abortWithConfirmation()`
- Add TASK_2025_185 reference in JSDoc

**Implementation Details**:

- One-liner method delegating to `this.conversation.abortWithConfirmation()`

---

**Batch 2 Verification**:

- `interruptAndSend` is fully removed from chat.store.ts
- `sendQueuedMessage` exists and does NOT call abort
- `abortWithConfirmation` exists on both ConversationService and ChatStore
- Build passes: `npx nx build chat`
- code-logic-reviewer approved

---

## Batch 3: Frontend UX (Wire Stop Button to Confirmation) IMPLEMENTED

**Developer**: frontend-developer
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 3.1: Wire stop button to `abortWithConfirmation()` IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\chat-input\chat-input.component.ts`
**Method to modify**: `handleStop()` at line 801-808
**Change**: Replace `this.chatStore.abortCurrentMessage()` with `this.chatStore.abortWithConfirmation()`

**Quality Requirements**:

- The stop button must now call `abortWithConfirmation()` instead of `abortCurrentMessage()`
- The method returns `boolean` (true if aborted, false if user cancelled) -- log accordingly
- Keep the try/catch error handling

**Implementation Details**:

- Change line 803: `await this.chatStore.abortCurrentMessage()` -> `const aborted = await this.chatStore.abortWithConfirmation()`
- Update log at line 804: `console.log('[ChatInputComponent] Stopped streaming')` -> `console.log('[ChatInputComponent] Stop requested, aborted:', aborted)`

---

### Task 3.2: Clean up processStreamEvent comments IMPLEMENTED

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat.store.ts`
**Lines to update**: 792-807 (the comment block above the queued content handling)

**Quality Requirements**:

- Update the TASK_2025_100 comment block at lines 792-795 to reference TASK_2025_185
- Remove references to "INTERRUPT" in the comments since we no longer interrupt
- Keep the code logic from Task 2.1 intact, only update comments

**Implementation Details**:

- Line 792-795: Change comment from "Handle re-steering via queued content on message_complete / we INTERRUPT the current execution" to "Handle re-steering via queued content on message_complete / TASK_2025_185: Send queued message without interrupting - agents continue running"
- Line 804: Remove comment "First: Interrupt current execution so Claude stops its current plan"

---

**Batch 3 Verification**:

- Stop button calls `abortWithConfirmation()` not `abortCurrentMessage()`
- All comments reference TASK_2025_185 where applicable
- Build passes: `npx nx build chat`
- code-logic-reviewer approved

---
