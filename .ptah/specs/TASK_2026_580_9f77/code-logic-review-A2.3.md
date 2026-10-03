VERDICT: APPROVED

# Code Logic Review — TASK_2026_580_9f77 (Batch A2.3)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nit issues  | 2        |
| Failure modes found | 0        |

Score justification: Batch A2.3 implements component 13 (Revision 2) of TASK_2026_580 with exemplary precision. The implementation satisfies the G1 gate decisions, strictly maintains byte-identity on `bindRefused` and both of its call sites, preserves the merge boundary with TASK_2026_584 (R-TL6), executes the rebound read synchronously prior to registry mutation, conditionally spreads `previousSessionId` to avoid `undefined` keys, and adds thorough, non-vacuous unit tests including the Revision 2 regression guard. Diagnostic check via `ptah_get_diagnostics` reports 0 errors and 0 warnings. A score of 9.5/10 reflects flawless logic and adherence to architectural invariants, separated from 10.0 only by minor documentation and test double observations.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Failure if read occurred post-bind**: If `this.readReboundSource` were invoked after `this.bindRefused(tabId, realSessionId, sessionToken)` rather than before, a `'rebound'` outcome in the registry would mutate `rec.realSessionId = realSessionId` in place ([session-registry.service.ts:321](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts#L321)). The subsequent read would observe `priorId === realSessionId` and return `undefined`, silently suppressing `previousSessionId` on the fan-out payload. The implementation avoids this silent failure completely by reading prior state synchronously at [sdk-agent-adapter.ts:1134-1136](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1134-L1136) before calling `bindRefused` at [sdk-agent-adapter.ts:1138](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1138).
- **Callback exceptions in fan-out subscribers**: In [session-id-resolved-callback-registry.ts:72](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts#L72), `SessionIdResolvedCallbackRegistry` extends `CallbackRegistryBase`. When `notifyAll` executes, individual subscriber errors are caught and logged without aborting downstream notifications or failing the adapter's `init` callback.

### 2. What user action produces unexpected behaviour?

- **User initiates multiple concurrent chats in the same tab**: If a rapid turn sequence or re-query attempts to rebind a session with an owner token from a previous generation, the registry returns `'stale-mismatch'` ([session-registry.service.ts:329](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts#L329)). `bindRefused` returns `true`, and `createSessionIdCallback` exits at [sdk-agent-adapter.ts:1138-1140](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1138-L1140) without broadcasting or updating metadata, preventing state corruption.
- **User restarts tab or runs `/clear`**: A `/clear` starts a fresh record rather than a rebind (`chat-session.service.ts:473-483`). The initial `init` on the fresh record has `realSessionId: null`, yielding `previousSessionId: undefined` (first bind), which does not trigger false rekeying.

### 3. What input data produces a wrong answer?

- **Blank or whitespace `realSessionId`**: In [sdk-agent-adapter.ts:1119-1124](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1119-L1124), `blankToUndefined(realSessionId)` short-circuits execution before `readReboundSource` or `bindRefused`. Thus, empty strings cannot be treated as valid session identifiers or rotation targets.
- **Tab ID matching a session UUID (`bySessionId` fallback)**: In `SessionLifecycleManager.find`, lookup checks `byTabId.get(id) ?? bySessionId.get(id)`. If a `tabId` string somehow collided with an existing session ID from another tab, `find` could return that session's record. However, `bindRealSessionId` explicitly indexes `byTabId.get(tabId)` ([session-registry.service.ts:297](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts#L297)), resulting in `'no-record'`, causing `bindRefused` to return `true` and drop the broadcast. Wrong answers remain unreachable.

### 4. What happens when a dependency fails?

- **`sessionLifecycle.find` returns undefined**: `readReboundSource` safely uses optional chaining `this.sessionLifecycle.find(tabId)?.realSessionId` ([sdk-agent-adapter.ts:1182](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1182)) and falls through to `return undefined`.
- **`bindRealSessionId` refuses the bind**: If the outcome is `'stale-mismatch'`, `'no-record'`, or `'invalid'`, `bindRefused` returns `true`. The guard `if (tabId && this.bindRefused(tabId, realSessionId, sessionToken)) return;` halts callback execution before metadata creation, activity flush, single-slot callback emission, or fan-out registry notification.

### 5. What is missing that the requirements never mentioned?

- **Resume path with session rotation**: The requirements explicitly restrict `previousSessionId` to the new-chat path (`createSessionIdCallback`), noting that `resumeCallback` only calls `metadataStore.touch(realSessionId)` and never creates a new metadata record (G1 step 3). If an SDK resume operation were to emit a new session ID (e.g. internal fork), the visible row in `SessionMetadataStore` retains the resumed session ID. This design choice is deliberate and fully documented in G1 and Revision 2.

---

## Failure Modes

No failure modes found. The code operates synchronously on in-memory data structures with defensive guards at every boundary.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### 1. [Nit] Spec uses `wireFakeRegistry` harness double instead of `SessionRegistryService` class instance

- **File**: [libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts:2521](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts#L2521)
- **Scenario**: The unit tests in `describe('session id rotation signal (TASK_2026_580)')` use `wireFakeRegistry(h)`, which is a stateful mock double over `h.sessionLifecycle.find` and `h.sessionLifecycle.bindRealSessionId`, rather than the concrete `SessionRegistryService`.
- **Impact**: Zero runtime impact. This follows the existing facade testing pattern of `sdk-agent-adapter.spec.ts` (which tests the adapter orchestrator in isolation with mock collaborators), while `SessionRegistryService` has dedicated unit test suites in `session-registry.service.spec.ts`.
- **Fix**: Informational note only. No code modification required.

### 2. [Nit] Documenting non-emptiness invariant of `readReboundSource`

- **File**: [libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1178-1187](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1178-L1187)
- **Scenario**: `readReboundSource` checks `priorId === null || priorId === undefined || priorId === realSessionId`. Because `SessionRecord.realSessionId` is typed `string | null` and empty IDs are rejected upon registration/binding, `priorId` is guaranteed to be a non-empty string when returned.
- **Impact**: Code clarity and future maintainability.
- **Fix**: Optional comment addition clarifying that `priorId` is guaranteed non-empty by upstream registry invariants.

---

## Data Flow

```
1. [ENTRY] StreamTransformer receives SDK system 'init' event
   └── Invokes onSessionIdResolved(tabId, realSessionId)
       └── Handled by createSessionIdCallback [OK]

2. [VALIDATION] Blank ID check
   └── blankToUndefined(realSessionId) === undefined ? return [OK]

3. [PRE-READ] Read prior session ID before mutation
   └── const previousSessionId = tabId ? this.readReboundSource(tabId, realSessionId) : undefined
       └── Calls sessionLifecycle.find(tabId)?.realSessionId
       └── If null, undefined, or equals realSessionId => undefined
       └── Else => returns prior session UUID [OK]

4. [MUTATION & GUARD] Bind in registry
   └── tabId && this.bindRefused(tabId, realSessionId, sessionToken)
       └── Calls sessionLifecycle.bindRealSessionId(tabId, realSessionId, sessionToken)
       └── Outcome:
           ├── 'bound': rec.realSessionId set from null => bindRefused = false [OK]
           ├── 'already-bound': rec.realSessionId === realSessionId => bindRefused = false [OK]
           ├── 'rebound': rec.realSessionId rebound (token match) => bindRefused = false [OK]
           └── 'stale-mismatch' / 'no-record' / 'invalid' => bindRefused = true => return [OK]

5. [METADATA & FLUSH] Post-bind side effects
   └── statsOwner.rebind(tabId, realSessionId, statsGeneration) [OK]
   └── await metadataStore.create(realSessionId, workspaceId, sessionName) [OK]
   └── flushPendingUserActivity(tabId) [OK]

6. [SINGLE-SLOT EMIT] Legacy callback
   └── emitSessionIdResolved(tabId, realSessionId) [OK]

7. [FAN-OUT NOTIFY] Multi-subscriber dispatch
   └── sessionIdResolvedRegistry.notifyAll({
         tabId,
         realSessionId,
         ...(previousSessionId === undefined ? {} : { previousSessionId }),
         timestamp: Date.now()
       }) [OK]
```

---

## Requirements Fulfilment

| Requirement                                                                                                                                                                                                                                                                                         | Status   | Gap                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------- |
| `SessionIdResolvedPayload` gains `readonly previousSessionId?: string` with documentation ([session-id-resolved-callback-registry.ts:57-64](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts#L57-L64)) | COMPLETE | None. Exactly matches plan.               |
| `bindRefused` signature (`boolean`) and body byte-identical to base ([sdk-agent-adapter.ts:1213-1229](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1213-L1229))                                                               | COMPLETE | None. Verified byte-identical.            |
| Both `bindRefused` call sites (`:1017` resume, `:1138` new chat) byte-identical                                                                                                                                                                                                                     | COMPLETE | None. Verified byte-identical.            |
| `createSessionIdCallback` parameter list and `metadataStore.create(...)` untouched (TASK_2026_584 merge point / R-TL6)                                                                                                                                                                              | COMPLETE | None. Preserved exactly.                  |
| `resumeCallback` and `emitSessionIdResolved` unchanged                                                                                                                                                                                                                                              | COMPLETE | None. Unchanged.                          |
| `readReboundSource` private method read-only, checks null, undefined, same-id ([sdk-agent-adapter.ts:1178-1187](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1178-L1187))                                                     | COMPLETE | None. Matches specification.              |
| `readReboundSource` called BEFORE `bindRefused` synchronously without await ([sdk-agent-adapter.ts:1134-1138](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1134-L1138))                                                       | COMPLETE | None. Synchronous and ordered correctly.  |
| `previousSessionId` conditionally spread in `notifyAll` (no `undefined` key) ([sdk-agent-adapter.ts:1166](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L1166))                                                                 | COMPLETE | None. Key is absent when undefined.       |
| Unit tests covering first bind, rebound, stale-mismatch, resume, regression guard, and 4-row reader table ([sdk-agent-adapter.spec.ts:2515-2699](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.spec.ts#L2515-L2699))               | COMPLETE | None. All 6 cases tested and non-vacuous. |

Implicit requirements not addressed: None.

---

## Edge Cases

| Case                                                     | Handled | How                                                                                                    | Concern |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------ | ------- |
| First bind (`realSessionId` initially null)              | YES     | `readReboundSource` returns `undefined`; payload omits `previousSessionId` key                         | None    |
| Idempotent re-bind (`realSessionId` unchanged)           | YES     | `readReboundSource` returns `undefined`; payload omits `previousSessionId` key                         | None    |
| Rebound (valid rotation under same owner token)          | YES     | `readReboundSource` returns old ID; bind accepts `rebound`; payload includes `previousSessionId`       | None    |
| Stale mismatch (out-of-order callback from dead session) | YES     | `readReboundSource` reads current ID, but `bindRefused` returns `true`; callback halts immediately     | None    |
| Tab with no record                                       | YES     | `readReboundSource` returns `undefined`; `bindRefused` returns `true` on `'no-record'`; callback halts | None    |
| Missing `tabId` (tabless session)                        | YES     | Ternary evaluates to `undefined`; payload omits `previousSessionId` key                                | None    |
| Blank/whitespace `realSessionId`                         | YES     | `blankToUndefined` halts callback before reading rebound source or binding                             | None    |
| Resume path with new ID                                  | YES     | `resumeCallback` does not call `readReboundSource` and does not set `previousSessionId`                | None    |
| Resume regression guard (accepted bind with tabId)       | YES     | Explicitly tested for `'bound'` and `'already-bound'` to ensure `touch` and notifications are fired    | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None. The change is isolated, adheres to established contracts, and passes all scoped typechecks and diagnostics.
- What a robust implementation would add: The implementation is already robust and complete. Downstream consumers in Batch A3 (`SessionOrganizationCaptureService`) can safely subscribe to `SessionIdResolvedCallbackRegistry` and consume `previousSessionId` for store rekeying.
