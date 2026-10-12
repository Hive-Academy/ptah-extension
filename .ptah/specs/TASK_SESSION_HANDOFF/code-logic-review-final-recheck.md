# Code Logic Review - Final Recheck

## Verdict
REVISE

## Earlier Defects

### Defect 1: Successor escapes the maximum runtime cap timer
**FIXED**. `transferChildLease` now computes the remaining deadline (`Math.max(0, runtimeDeadline - Date.now())`) and correctly arms the timer using the new `successorTabId` instead of capturing the old closure ID.

### Defect 2: Successor loses unattended execution permissions
**FIXED**. `transferChildLease` properly cleans up the old policy via `runtime.releasePolicy?.()` and re-registers it under the new `successorTabId` (`this.policies.register(successorTabId, runtime.policy)`), maintaining unattended permissions for the successor.

### Defect 3: Orphaned successor process if source closure fails
**NOT FIXED** (Accepted per orchestrator decisions). If the source close fails, the successor is intentionally left running because it holds delivered FIFO inputs which would be lost if stopped.

### Defect 4: Memory leak in `transferredSourceIds` Set
**FIXED**. The unbounded `Set` was replaced with a bounded `pendingLeaseTransfers` map. The map is correctly cleared on successful lease transfers or whenever the handover phase transitions to terminal states (`failed`, `cancelled`, `closed`).

## New Defects

### 1. `transferChildLease` is never executed due to premature cleanup (Serious)
`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:263`
`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts:691`

**Failure scenario:**
When a handover succeeds, the `SessionHandoverCoordinator` attempts to close the source session by calling `SessionLifecycleManager.endSessionIfTokenMatches()`. Inside `endSessionIfTokenMatches()`, it synchronously calls `this.handoverCoordinator?.sourceEnded()` BEFORE it delegates to `_control.endSessionIfTokenMatches()` to actually end the session.
This causes the `handoverCoordinator` to immediately transition to the `closed` phase. The `SessionSpawnerService` observes this phase change in its state listener and calls `this.clearPendingLeaseTransfer()`, prematurely wiping the pending lease transfer from the map.
Later, when the SDK finishes closing the session asynchronously and fires the `onSessionEnd` callback, `SessionSpawnerService` checks the `pendingLeaseTransfers` map, finds nothing, and skips `transferChildLease`. The successor is left permanently orphaned from `SessionSpawnerService`'s resource tracking without an unattended policy, without a runtime limit, and without its child registry record.

**Fix:**
In `SessionSpawnerService`'s state listener, do not clear the pending lease on the `closed` state since the transfer relies on the subsequent `onSessionEnd` event to process the handover (e.g. remove `state.phase === 'closed'` from the cleanup condition since `onSessionEnd` already handles the cleanup on success). Alternatively, adjust `SessionLifecycleManager` or `SessionHandoverCoordinator` so the `closed` state is only reached *after* `onSessionEnd` has fired.
