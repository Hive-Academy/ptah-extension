# Development Tasks - TASK_2025_213

**Total Tasks**: 6 | **Batches**: 2 | **Status**: 2/2 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- Registry removal at `chat-rpc.handlers.ts:879-881` exists and works for current run: VERIFIED
- `registerFromHistoryEvents` re-registers from JSONL on every session load: VERIFIED (line 1074 of chat-rpc.handlers.ts)
- `markLastAgentAsInterrupted` only marks last agent: VERIFIED (line 465-489 of message-finalization.service.ts)
- `_lastDenyWasHardInterrupt` is a boolean signal, not tool-specific: VERIFIED (line 54 of permission-handler.service.ts)
- `consumeHardDenyFlag` is consumed in `handleSessionStats`: VERIFIED (line 703 of streaming-handler.service.ts)
- SDK sends completion events before exiting on hard deny (nodes are 'complete' not 'streaming'): VERIFIED per comment at line 712-715

### Risks Identified

| Risk                                                                               | Severity | Mitigation                                                                       |
| ---------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Cleared toolCallIds set grows unbounded if sessions are very long-lived            | LOW      | Use same TTL cleanup as registry records; set is cleared when session is removed |
| Multiple concurrent hard denies could overwrite toolUseId tracking                 | LOW      | Use array/Set instead of single value for `_lastDenyToolUseIds`                  |
| `markLastAgentAsInterrupted` is still useful as a fallback if toolUseId is missing | MED      | Keep the fallback path but prefer targeted marking when toolUseId is available   |

### Edge Cases to Handle

- [x] Multiple interrupted agents from same session (Bug 1) -- handled by iterating all in clearInjected set
- [x] Permission denied on non-agent tool (no agent to mark) -- handled by checking node type
- [x] Session reload after clearing -- `registerFromHistoryEvents` must skip cleared IDs
- [x] Hard deny when no agents are running (deny on root-level tool) -- no-op is correct behavior
- [x] Concurrent deny of multiple tools in same session -- Set-based tracking handles this

---

## Batch 1: Backend - Stale Interrupted Record Fix (Bug 1) -- COMPLETE

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Commit**: dd653ad1

### Task 1.1: Add `clearInjectedToolCallIds` tracking to SubagentRegistryService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subagent-registry.service.ts`
**Spec Reference**: context.md Bug 1 - Option C (clear after injection)

**Quality Requirements**:

- Add a private `clearedToolCallIds: Set<string>` field to track toolCallIds that have been injected into context and should not be re-registered
- Add a public `markAsInjected(toolCallId: string): void` method that adds to the cleared set
- Add a public `wasInjected(toolCallId: string): boolean` method for checking
- Add a `clearInjectedBySession(parentSessionId: string): void` method for cleanup
- Integrate cleanup of `clearedToolCallIds` into `removeBySessionId()` and `clear()` methods
- The `clearedToolCallIds` set should also be cleaned during `cleanupExpired()` (same TTL concept)

**Validation Notes**:

- This set prevents `registerFromHistoryEvents` from re-registering agents that were already presented to Claude
- Records in the set should survive across session loads within the same extension session
- The set is per-extension-instance (in-memory), which is correct since JSONL re-registration only happens on session load

**Implementation Details**:

- Add `private readonly clearedToolCallIds = new Set<string>();` after the `registry` Map declaration
- `markAsInjected(toolCallId)`: adds to set, logs at debug level
- `wasInjected(toolCallId)`: returns `this.clearedToolCallIds.has(toolCallId)`
- In `removeBySessionId()`: also clear entries from `clearedToolCallIds` (iterate and filter by looking up the parentSessionId association -- will need a parallel Map `clearedToolCallIdToSession: Map<string, string>` for this, or simply accept the set grows until TTL cleanup)
- In `clear()`: also call `this.clearedToolCallIds.clear()`
- Simpler approach: just use `clearedToolCallIds` as a flat Set without session tracking. It only grows by the number of injected agents (typically 0-5 per session). Memory is negligible. Clean up in `clear()`.

---

### Task 1.2: Update `registerFromHistoryEvents` to skip previously injected toolCallIds -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\vscode-core\src\services\subagent-registry.service.ts`
**Dependencies**: Task 1.1

**Quality Requirements**:

- In `registerFromHistoryEvents`, after the existing `this.registry.has(toolCallId)` check (line 707), add a check for `this.clearedToolCallIds.has(toolCallId)`
- If the toolCallId was previously injected, skip it with a debug log explaining why
- This prevents the re-registration cycle: inject context -> remove from registry -> reload session -> re-register from history -> inject again

**Pattern to Follow**: The existing skip patterns at lines 707-731 (skip already registered, skip completed, skip superseded)

**Implementation Details**:

- Add after line 712 (after the `registry.has(toolCallId)` skip block):

```typescript
// Skip agents whose context was already injected (cleared from registry after injection)
if (this.clearedToolCallIds.has(toolCallId)) {
  this.logger.debug('[SubagentRegistryService.registerFromHistoryEvents] Agent already injected into context, skipping', { toolCallId, agentType });
  continue;
}
```

---

### Task 1.3: Update `chat:continue` handler to call `markAsInjected` before removing -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts`
**Dependencies**: Task 1.1

**Quality Requirements**:

- In the context injection block (around lines 879-881), before calling `this.subagentRegistry.remove(s.toolCallId)`, first call `this.subagentRegistry.markAsInjected(s.toolCallId)`
- This ensures the toolCallId is recorded in the cleared set before the record is deleted from the registry
- The remove call stays as-is (still removes from registry Map)

**Pattern to Follow**: The existing loop at lines 879-881

**Implementation Details**:

- Modify the loop at lines 879-881:

```typescript
for (const s of resumableSubagents) {
  this.subagentRegistry.markAsInjected(s.toolCallId);
  this.subagentRegistry.remove(s.toolCallId);
}
```

---

**Batch 1 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build vscode-core` and `npx nx build rpc-handlers`
- code-logic-reviewer approved
- Re-registration cycle is broken: inject -> clear -> reload -> skip (via clearedToolCallIds)

---

## Batch 2: Frontend - Permission Denial Interruption Fix (Bug 2) -- COMPLETE

**Developer**: frontend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (conceptually independent, can run in parallel)
**Commit**: c312bb05

### Task 2.1: Change `_lastDenyWasHardInterrupt` from boolean to Set of toolUseIds -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\permission-handler.service.ts`

**Quality Requirements**:

- Change `_lastDenyWasHardInterrupt` from `signal(false)` to `signal<Set<string>>(new Set())`
- Update `handlePermissionResponse` to add the `response.toolUseId` (from the PermissionResponse) to the set instead of setting boolean true
- Update `consumeHardDenyFlag()` to return the entire Set (and then clear it), renaming to `consumeHardDenyToolUseIds(): Set<string>`
- If `response.toolUseId` is undefined, fall back to adding a sentinel value (e.g., `'__unknown__'`) so the old `markLastAgentAsInterrupted` fallback still triggers

**Validation Notes**:

- PermissionResponse type must include `toolUseId` -- need to verify. The request has `toolUseId` but the response may not carry it back. If not, we need to store the mapping from `response.id` to `toolUseId` from the original request.
- Check: `handlePermissionResponse` receives a `PermissionResponse` which has `id` (the request ID). The original `handlePermissionRequest` receives the `PermissionRequest` which has `toolUseId`. We need to look up the toolUseId from the stored request before removing it.

**Implementation Details**:

- Rename signal: `private readonly _hardDenyToolUseIds = signal<Set<string>>(new Set());`
- In `handlePermissionResponse`: before removing from `_permissionRequests`, look up the original request to get its `toolUseId`:

```typescript
if (response.decision === 'deny') {
  const originalRequest = this._permissionRequests().find((r) => r.id === response.id);
  const toolUseId = originalRequest?.toolUseId ?? '__unknown__';
  this._hardDenyToolUseIds.update((ids) => {
    const next = new Set(ids);
    next.add(toolUseId);
    return next;
  });
}
```

- `consumeHardDenyToolUseIds()`:

```typescript
consumeHardDenyToolUseIds(): Set<string> {
  const ids = this._hardDenyToolUseIds();
  if (ids.size > 0) {
    this._hardDenyToolUseIds.set(new Set());
  }
  return ids;
}
```

---

### Task 2.2: Update `StreamingHandlerService.handleSessionStats` to use targeted marking -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\streaming-handler.service.ts`
**Dependencies**: Task 2.1

**Quality Requirements**:

- Replace `const wasHardDeny = this.permissionHandler.consumeHardDenyFlag();` with `const hardDenyToolUseIds = this.permissionHandler.consumeHardDenyToolUseIds();`
- Replace the `if (wasHardDeny)` block (lines 716-718) with logic that:
  1. If `hardDenyToolUseIds.size > 0`, call a new method `this.finalization.markAgentsAsInterrupted(targetTabId, hardDenyToolUseIds)` that marks SPECIFIC agent nodes
  2. The new method finds agent nodes whose `toolCallId` is in the `hardDenyToolUseIds` set and marks them as 'interrupted'
  3. If `hardDenyToolUseIds` contains `'__unknown__'` (the sentinel), fall back to `markLastAgentAsInterrupted` for backward compatibility

**Pattern to Follow**: The existing `handleSessionStats` pattern at lines 702-718

**Implementation Details**:

```typescript
const hardDenyToolUseIds = this.permissionHandler.consumeHardDenyToolUseIds();

console.log('[StreamingHandlerService] Finalizing streaming on stats received for tab:', targetTabId, { hardDenyToolUseIds: [...hardDenyToolUseIds] });
this.finalization.finalizeCurrentMessage(targetTabId);

if (hardDenyToolUseIds.size > 0) {
  if (hardDenyToolUseIds.has('__unknown__')) {
    // Fallback: no specific toolUseId, mark last agent
    this.finalization.markLastAgentAsInterrupted(targetTabId);
  } else {
    // Targeted: mark specific denied agents
    this.finalization.markAgentsAsInterruptedByToolCallIds(targetTabId, hardDenyToolUseIds);
  }
}
```

---

### Task 2.3: Add `markAgentsAsInterruptedByToolCallIds` to MessageFinalizationService -- COMPLETE

**File**: `D:\projects\ptah-extension\libs\frontend\chat\src\lib\services\chat-store\message-finalization.service.ts`
**Dependencies**: None (method is new, can be written independently)

**Quality Requirements**:

- Add a new public method `markAgentsAsInterruptedByToolCallIds(tabId: string, toolCallIds: Set<string>): void`
- This method finds the last assistant message (same as `markLastAgentAsInterrupted`)
- Instead of recursively finding the "last" agent, it recursively finds ALL agent nodes whose `toolCallId` matches any ID in the provided set
- Mark those nodes as `status: 'interrupted'`
- This handles the case where multiple agents had their permissions denied (not just the last one)

**Pattern to Follow**: `markLastAgentAsInterrupted` at lines 427-489 and `findAndMarkLastAgent` at lines 465-489

**Implementation Details**:

- Add after `markLastAgentAsInterrupted`:

```typescript
/**
 * Mark specific agent nodes as interrupted by their toolCallIds.
 * Used when permission deny identifies the exact agent(s) that were denied.
 * More precise than markLastAgentAsInterrupted (which guesses the last one).
 */
markAgentsAsInterruptedByToolCallIds(tabId: string, toolCallIds: Set<string>): void {
  const tab = this.tabManager.tabs().find((t) => t.id === tabId);
  if (!tab || tab.messages.length === 0) return;

  const messages = tab.messages;
  let lastAssistantIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].streamingState) {
      lastAssistantIndex = i;
      break;
    }
  }
  if (lastAssistantIndex === -1) return;

  const msg = messages[lastAssistantIndex];
  const tree = msg.streamingState;
  if (!tree) return;

  const updatedTree = this.markMatchingAgentsAsInterrupted(tree, toolCallIds);
  if (updatedTree === tree) return; // No change

  const updatedMessages = [...messages];
  updatedMessages[lastAssistantIndex] = {
    ...msg,
    streamingState: updatedTree,
  };

  this.tabManager.updateTab(tabId, { messages: updatedMessages });
  console.log(
    '[MessageFinalizationService] Marked agents as interrupted by toolCallIds',
    { toolCallIds: [...toolCallIds] }
  );
}

/**
 * Recursively find and mark agent nodes whose toolCallId matches any in the set.
 */
private markMatchingAgentsAsInterrupted(
  node: ExecutionNode,
  toolCallIds: Set<string>
): ExecutionNode {
  let changed = false;
  const updatedChildren = node.children.map((child) => {
    const updated = this.markMatchingAgentsAsInterrupted(child, toolCallIds);
    if (updated !== child) changed = true;
    return updated;
  });

  // Check if THIS node should be marked
  if (
    node.type === 'agent' &&
    node.status === 'complete' &&
    node.toolCallId &&
    toolCallIds.has(node.toolCallId)
  ) {
    return { ...node, children: changed ? updatedChildren : node.children, status: 'interrupted' };
  }

  if (changed) {
    return { ...node, children: updatedChildren };
  }

  return node;
}
```

---

**Batch 2 Verification**:

- All files exist at specified paths
- Build passes: `npx nx build chat`
- code-logic-reviewer approved
- Permission deny correctly marks specific agent(s) as interrupted
- Fallback to `markLastAgentAsInterrupted` when toolUseId is unavailable
- Multiple concurrent denies handled via Set
