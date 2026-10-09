# Code Logic Review

WROTE: D:\projects\ptah-extension\.claude-worktrees\session-handoff-workflow\.ptah\specs\TASK_SESSION_HANDOFF\code-logic-review-final.md — REVISE, <B> 0, <S> 3, <M> 1, <F> 4

## Verdict: NEEDS_REVISION

The logic for transferring resources to the successor during a handover correctly preserves parent relationships and correctly delegates `worktree`/`mcpRoot` leases. However, the runtime timer and unattended execution policy maintain stale references to the old `childSessionId` (which gets deleted by `rekey`), causing the successor to run without a timeout and without unattended permissions. Additionally, there is a race condition where a failed session closure leaves an unstopped successor running in the background.

## Defects

### 1. Successor escapes the maximum runtime cap timer (Serious)
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:464`
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1027`

**Failure scenario:**
When `provisionAndStart` sets up a child session, it arms `runtime.runtimeTimer` with a closure that captures the initial `childTabId`. During a handover, `transferChildLease` calls `rekey` which deletes the old `childTabId` from the registry and assigns a new `successorTabId`. When the runtime cap is reached, the captured `childTabId` is used in `onRuntimeExceeded`, which fails to find the child (`!child` evaluates to true) and silently returns. The successor will run indefinitely and bypass the configured maximum runtime limit.

**Fix:**
Re-arm the timer inside `transferChildLease` with the new `successorTabId`, or change the timer closure to resolve the active `childSessionId` via a stable reference (such as looking up the child by its `mcpRoot` or by passing the `ChildRuntime` object itself).

### 2. Successor loses unattended execution permissions (Serious)
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:429`
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1050`

**Failure scenario:**
The unattended execution policy for a child is registered via `policies.register(childTabId, ...)` using the original `childTabId`. During a handover, the `childSessionId` is updated to `successorTabId`. When the successor attempts an unattended action (e.g., executing a command or modifying a file), the SDK will issue a permission prompt with `event.routingHint` equal to the new `successorTabId` or its new SDK session ID. The `SdkPermissionHandler` will not find a policy matching the new ID, so it will fall back to awaiting user input, breaking the successor's unattended capability.

**Fix:**
Re-register the unattended policy under the new `successorTabId` inside `transferChildLease` (and dispose of the old one), or update the policy registry to support rekeying.

### 3. Orphaned successor process if source closure fails (Serious)
`libs/backend/agent-sdk/src/lib/helpers/session-handoff/session-handover-coordinator.service.ts:451`

**Failure scenario:**
In `complete()`, the coordinator attempts to close the source session via `runtime.closeIfTokenMatches(...)`. If this returns `false` (e.g., the token mismatched because the session was concurrently restarted), the coordinator transitions to `failed` and returns. However, `successorHost.startSuccessorSession` has already started the successor in the background, and `transferChildLease` has already stripped the original session of its runtime resources. The successor is left running indefinitely (an orphaned background process), while the old session is corrupted and the user is shown a handover failure.

**Fix:**
If `closeIfTokenMatches` fails, ensure that `successorHost.stopSuccessorSession?.(operation.id)` is called to terminate the successor before returning. You should also consider rolling back the `transferChildLease` operation.

### 4. Memory leak in `transferredSourceIds` Set (Moderate)
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:1022`

**Failure scenario:**
`transferChildLease` adds the `sourceSessionId` and `source.childSessionId` to the `transferredSourceIds` Set, but they are never removed. Because these are unique UUIDs, the `Set` will grow indefinitely with every successful handover over the lifetime of the host process, causing a memory leak.

**Fix:**
Remove the IDs from `transferredSourceIds` when the successor session eventually ends (e.g., inside `onSessionEnd` or `releaseResources`), or use a bounded cache (like an LRU) instead of a raw `Set`.

## Decisions

- **Permission level propagation**: Verified that `session-lifecycle-manager.ts` successfully copies `rec.permissionLevel` into `successorConfig.permissionLevel`, and `chat-session.service.ts` correctly forwards this to `launchSdkSession`. The end-to-end logic correctly propagates permissions (answering Item 4 from the orchestrator findings).
- **Parent ID inheritance**: Verified that `session-spawner.service.ts`'s `setResourceLeaseProvider` correctly extracts and preserves `inheritedParentIds: [child.parentSessionId]` during handover, successfully satisfying Batch D's requirement.
- **Routing completions**: Verified that `rekey` accurately duplicates `parentSessionId` and `parentSdkSessionId` for the successor record. Therefore, events and reports from the successor will successfully route back to the correct parent CLI session.
