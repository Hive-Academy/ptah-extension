# Code Logic Review — `TASK_2026_555` (Batch 13: New State Writes)

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 1                                    |

The implementation in Batch 13 correctly adds the write operations for the redesigned Providers and Orchestration surfaces across [providers-settings-state.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-settings-state.service.ts), [providers-commit.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts), and [providers-connection-setup.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-connection-setup.service.ts). All six required verification criteria are honored:
1. Every write routes through `ProvidersCommitService.run` with read-back verification (`deleteStoredKey`, `disconnectCopilot`, `removeCustomEntry`, `updateCustomEntryFields`, `updateCustomEntryEndpoint`, `updateLocalBaseUrl`, `setMainAgentTier`, `setCliInstanceTiers`, and widened orchestration policy fields).
2. D15 invariants are enforced: never "Saved" after failure; refused with `false` when another save is in flight without modifying commit state; raw host error text never enters `commit()`.
3. The `verifiedFor(providerId, probeId)` gate correctly gates endpoint and local base URL updates without changing `connectProvider` logic.
4. `removeCustomEntry` is blocked when driving the main agent or when the route is not ready.
5. `cliInstanceTiersOperation` sends the full mapping and omits blank tiers; backend investigation of [ptah-cli-registry.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts#L353-L357) confirmed that `updateAgent` replaces `tierMappings` entirely (`...existing, ...updates`), ensuring blank tiers clear as intended.
6. The state facade remains under 700 lines (674 raw lines, 574 counted lines) with only public delegation API added.

What separates this score (8/10) from 9-10 is a subtle edge case in `cliInstanceTiersOperation.readBack` where a missing agent record in the persisted array would evaluate to matching an empty tier mapping rather than failing read-back.

---

## Five logic questions

### 1. How does this fail silently?

- In [providers-commit.service.ts:280-288](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L280-L288) (`cliInstanceTiersOperation`), `readBack` queries `'settings:get'` for `'ptahCliAgents'`. If an agent is missing from the returned array, `agent` is `undefined` and `saved` is `undefined`. If the write operation requested all blank tiers (`tierMappings = {}`), `MODEL_TIERS.every(...)` evaluates `(undefined ?? undefined) === undefined` (`true`) for all three tiers. As a result, the read-back returns `true` even though the target agent record was not present in the settings collection.

### 2. What user action produces unexpected behaviour?

- Attempting to remove a custom connection immediately after opening the Providers settings before the route has completed loading ([providers-connection-setup.service.ts:326-330](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-connection-setup.service.ts#L326-L330)) sets the commit state to `blocked` with `'Refresh the main agent route before removing this connection.'`. While this protects against removing the active driver, the UI should keep the action button disabled while `route.status !== 'ready'` so users do not trigger an error state during normal startup.

### 3. What input data produces a wrong answer?

- Passing an empty object `{}` to `updateCustomEntryFields` ([providers-connection-setup.service.ts:346-350](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-connection-setup.service.ts#L346-L350)) correctly blocks the commit with `'Check the help URL and prices; prices cannot be negative.'`, preventing empty metadata writes.
- In `cliInstanceTiersOperation` ([providers-commit.service.ts:270-274](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L270-L274)), tiers with whitespace-only values (e.g. `'   '`) are stripped via `.trim()` and correctly omitted from the mapping payload.

### 4. What happens when a dependency fails?

- If an RPC write rejects or throws ([providers-commit.service.ts:385-391](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L385-L391)), `settle()` marks the outcome as `'unconfirmed'` (if thrown) or `'unsaved'` (if `success: false`). `readBack` is never invoked, preventing false promotions to `'saved'`.
- If an RPC read-back throws or times out ([providers-commit.service.ts:401-404](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L401-L404)), the outcome transitions to `'unconfirmed'`. No raw error message or credential enters UI state.
- If `hooks.refresh()` fails after the commit ([providers-commit.service.ts:350, 368](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L350-L368)), `refreshFailed` is flagged and a non-fatal message is surfaced to the user without masking the committed state.

### 5. What is missing that the requirements never mentioned?

- In `cliInstanceTiersOperation`, the requirement specifies that the host replaces the full object and blank tiers are omitted. However, the read-back did not account for the target agent being completely absent when clearing all tiers. An explicit check `if (!agent) return false;` should be present in the read-back.

---

## Failure modes

### Empty Tier Clearing on Missing Agent Evaluates True in Read-Back

- Trigger: Calling `setCliInstanceTiers` with all blank or empty tiers (e.g., `{ sonnet: '', opus: '', haiku: '' }`) for an agent ID that does not exist in `ptahCliAgents` settings.
- Symptom: If the write RPC were to succeed, `readBack` would return `true` rather than detecting that the agent was absent.
- Evidence: [providers-commit.service.ts:280-288](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L280-L288):
  ```typescript
  const agent: unknown = stored.value.find((item: unknown) =>
    !!item && typeof item === 'object' && 'id' in item && item.id === id);
  const saved: unknown = agent && typeof agent === 'object' && 'tierMappings' in agent ? agent.tierMappings : undefined;
  return MODEL_TIERS.every((tier) => {
    const value: unknown = saved && typeof saved === 'object' ? (saved as Record<string, unknown>)[tier] : undefined;
    return (value ?? undefined) === tierMappings[tier];
  });
  ```
- Current handling: When `agent` is `undefined`, `saved` is `undefined`. Because all tiers are omitted from `tierMappings`, `tierMappings[tier]` is `undefined`. `(undefined ?? undefined) === undefined` evaluates to `true`.
- Recommendation: Add an explicit guard: `if (!agent) return false;`.

---

## Blocking issues

None.

---

## Serious issues

None.

---

## Moderate and minor issues

### 1. Missing Agent Guard in `cliInstanceTiersOperation` Read-Back (Moderate)
- File: [providers-commit.service.ts:281](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-commit.service.ts#L281)
- Scenario: Clearing all tiers on a non-existent agent evaluates `every(...)` as `true` because `value` and `tierMappings[tier]` are both `undefined`.
- Fix: Guard with `if (!agent) return false;` immediately after the `.find(...)` call.

### 2. Provider Existence in `deleteStoredKey` Read-Back (Minor)
- File: [providers-connection-setup.service.ts:311-313](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-connection-setup.service.ts#L311-L313)
- Scenario: `auth:getApiKeyStatus` read-back checks `.providers.find((entry) => entry.provider === providerId)?.hasApiKey !== true`. For a provider ID not present in the returned list, optional chaining evaluates to `undefined !== true` (`true`).
- Note: The backend schema in `auth:deleteStoredKey` already rejects unknown provider IDs before attempting deletion, so this does not result in runtime defects.

### 3. Early Action Availability Before Route Initialization (Minor)
- File: [providers-connection-setup.service.ts:326-330](file:///D:/projects/ptah-extension/.claude-worktrees/task-555-settings-redesign/libs/frontend/core/src/lib/services/providers-connection-setup.service.ts#L326-L330)
- Scenario: Triggering `removeCustomEntry` while `route.status !== 'ready'` sets commit state to `blocked`.
- Note: UI controls in later batches (Batch 22/27) should bind button disabled state to `route.status !== 'ready'`.

---

## Data flow

1. **Invocation**: Facade method called with parameters and `ProvidersEditContext`. [OK]
2. **In-flight Guard**: `if (this.commits.commit().status === 'saving') return false;` returns `false` immediately without touching `commit()`. [OK]
3. **Pre-write Validation / Gates**:
   - `removeCustomEntry`: Route readiness and active driver checked via `hooks.route()`. Blocked if driver matches. [OK]
   - `updateCustomEntryFields`: Checked against `CustomProviderEntryChangesSchema`. Blocked if invalid or empty. [OK]
   - `updateCustomEntryEndpoint` & `updateLocalBaseUrl`: Gated by `this.verifiedFor(providerId, probeId)`. Blocked if unverified or probe mismatch. [OK]
4. **Execution**: `ProvidersCommitService.run` sets status to `'saving'`, verifies workspace/scope context, and runs operations sequentially. [OK]
5. **Write Execution**: Dispatches RPC via `requireRpcData`. Catches exceptions without exposing raw errors. [OK]
6. **Read-Back Verification**: Reads back persisted state from host and compares values strictly or via `sameSetting` for arrays. [OK]
7. **Settlement**: State updated to `'saved'`, `'failed'`, `'partial'`, `'unconfirmed'`, or `'blocked'`. [OK]
8. **Post-commit Refresh**: Invokes `hooks.refresh()` across all sections. [OK]

---

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| `deleteStoredKey` through commit with read-back | COMPLETE | None |
| `disconnectCopilot` through commit with read-back | COMPLETE | None |
| `removeCustomEntry` blocked for active driver & unloaded route | COMPLETE | None |
| `updateCustomEntryFields` with metadata schema validation | COMPLETE | None |
| `updateCustomEntryEndpoint` with `verifiedFor` probe gate | COMPLETE | None |
| `updateLocalBaseUrl` with `verifiedFor` probe gate | COMPLETE | None |
| `setMainAgentTier` (+clear support) through commit with read-back | COMPLETE | None |
| `setCliInstanceTiers` full object write & omission of blank tiers | COMPLETE | Missing `!agent` guard in read-back when all tiers are blank |
| Orchestration policy fields array order-sensitive read-back | COMPLETE | None |
| D15: No "Saved" after failure; refused returns false when saving | COMPLETE | None |
| Facade stays under 700 counted lines; public API only added | COMPLETE | None (674 raw lines, 574 counted lines) |

Implicit requirements not addressed: None.

---

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| In-flight save collision | YES | `commit().status === 'saving'` checks in setup service and commit service return `false` | None |
| Active driver removal | YES | `route.data.driverProviderId === id` blocks with "Switch the main agent first." | None |
| Route unloaded during removal | YES | `route.status !== 'ready'` blocks with "Refresh the main agent route before removing this connection." | None |
| Probe ID mismatch on endpoint update | YES | `verifiedFor` verifies `probe.data.probeId === probeId` and `verifiedProviderId === providerId` | None |
| Clear main-agent tier | YES | Empty `modelId` calls `provider:clearModelTier` and reads back `null ?? ''` | None |
| Whitespace in CLI tiers | YES | `tiers[tier]?.trim()` drops whitespace-only entries from `tierMappings` | None |
| Host replaces full tier mappings | YES | Confirmed in backend `ptah-cli-registry.ts:353-357` that `updates.tierMappings` replaces `existing.tierMappings` | None |
| Array order mutation in orchestration | YES | `sameSetting` enforces length equality and element-by-element order | None |
| RPC failure / timeout | YES | Caught in `settle()`, yields `'unconfirmed'`, no raw error enters commit state | None |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Clearing all tiers for a deleted CLI agent would read back as matching if the host did not fail the write.
- What a robust implementation would add:
  1. Add `if (!agent) return false;` in `cliInstanceTiersOperation.readBack`.
  2. Disable remove connection actions in the UI while `route.status !== 'ready'`.
