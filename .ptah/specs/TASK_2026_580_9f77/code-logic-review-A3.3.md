VERDICT: APPROVED

Score: 9/10

# Code Logic Review — Batch A3.3 (`SessionOrganizationCaptureService`)

Read in full:

- [session-organization-capture.service.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts) (111 lines)
- [session-organization-capture.service.spec.ts](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.spec.ts) (301 lines, 12 tests)
- [session-organization.service.ts:540-590](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L540-L590) (`removeSession`, `rekeySession`, `resolveRoot`)
- [session-metadata-store.ts:411-431, 976-982](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L411-L431) (`onMetadataChanged`, `emitChange`, `delete`)
- [session-id-resolved-callback-registry.ts:1-77](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts#L1-L77)
- [callback-registry.base.ts:1-55](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/callback-registry.base.ts#L1-L55)
- [session-rpc.handlers.ts:500-530](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L500-L530) (`session:delete`)
- [session-importer.service.ts:330-360](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/session-importer.service.ts#L330-L360) (contentless phantom session prune)
- [normalize-workspace-root.ts:1-41](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/platform-core/src/utils/normalize-workspace-root.ts#L1-L41)
- [implementation-plan.md:468-485, 138, 531-539, 1225-1235](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/implementation-plan.md#L468-L485)
- [batches.md:657-720](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/batches.md#L657-L720) (Batch A3.3)

Read-only review: no source files were modified, and no test or build commands were executed.

---

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues        | 1        |
| Nit issues          | 2        |
| Failure modes found | 3        |

---

## Verification of Prompt Checks

### (a) Delete cascade covers every delete path — PASS

- **Event source & emission**: Production session deletions happen via [session-rpc.handlers.ts:510](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts#L510) (`session:delete` RPC) and [session-importer.service.ts:344](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/session-importer.service.ts#L344) (phantom session prune). Both call `await this.metadataStore.delete(sessionId)`.
- In [session-metadata-store.ts:976-982](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L976-L982), `delete()` reads `existing = await this.get(sessionId)` before deleting, and fires `this.emitChange('deleted', sessionId, existing.workspaceId)` synchronously via EventEmitter on the `metadataChanged` channel.
- In [session-organization-capture.service.ts:94-103](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L94-L103), `onMetadataChanged` filters `kind === 'deleted'`, guards against an empty `workspaceId`, and invokes `this.service.removeSession(payload.workspaceId, payload.sessionId)`.
- In [session-organization.service.ts:542-559](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L542-L559), `removeSession` normalizes the root with `normalizeWorkspaceRoot(workspaceRoot)` and calls `this.store.deleteSession(root, sessionId)`. When rows were originally written in `SessionOrganizationService.resolveRoot`, the root was normalized using the same `normalizeWorkspaceRoot` from `metadata.workspaceId`. Both keys match exactly.

### (b) Rekey on session id resolved — PASS

- In [session-organization-capture.service.ts:105-109](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L105-L109), `onSessionIdResolved` executes:
  ```typescript
  const previous = payload.previousSessionId;
  if (!previous || previous === payload.realSessionId) return;
  this.service.rekeySession(previous, payload.realSessionId);
  ```
  The rekey runs only when `previousSessionId` is truthy and differs from `realSessionId`.
- In [session-organization.service.ts:565-590](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L565-L590), `rekeySession` is completely synchronous, invoking SQLite transactions via `better-sqlite3`. No Promises are returned or unhandled, strictly honouring `SessionIdResolvedCallbackRegistry`'s contract ("subscribers MUST treat the handler as synchronous", [session-id-resolved-callback-registry.ts:26-27](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/session-id-resolved-callback-registry.ts#L26-L27)).

### (c) Service methods never throw & subscriber isolation — PASS

- Both `removeSession` and `rekeySession` in `SessionOrganizationService` are guarded with `isAvailable()` and wrap all work in `try { ... } catch (error: unknown) { this.log(...) }`. Neither method can throw an unhandled error.
- Even if a subscriber threw, both emitters provide isolation:
  - `SessionMetadataStore.emitChange` ([session-metadata-store.ts:423-430](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L423-L430)) catches subscriber errors and logs a warning.
  - `CallbackRegistryBase.register` ([callback-registry.base.ts:23-40](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/helpers/callback-registry.base.ts#L23-L40)) catches both synchronous and asynchronous subscriber errors.
    No subscriber failure can compromise another subscriber or the host runtime.

### (d) start() and dispose() lifecycle — PASS

- In [session-organization-capture.service.ts:71-92](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L71-L92):
  - `start()` is guarded by `if (this.started) return;` and assigns two disposers.
  - `dispose()` is guarded by `if (!this.started) return;`, resets `this.started = false`, drains `this.disposers`, and invokes each release callback.
  - Calling `start()` after `dispose()` cleanly resubscribes.
  - Both methods are synchronous, idempotent, allocate zero timers (`setInterval`/`setTimeout`), and register no per-session listeners.

### (e) Deviation: empty workspaceId dropped with one log line — PASS

- In [session-organization-capture.service.ts:96-101](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L96-L101), an event with an empty `workspaceId` logs `[SessionOrganization] delete cascade dropped for <sessionId>: metadata named no workspace` and returns.
- **Why workspaceId can be empty**: If legacy metadata lacked a workspace root or if metadata was created without a root.
- **Can this leave orphan rows?**: If a session was recorded using `workspaceRootHint` while `metadata.workspaceId` was empty, rows exist in SQLite under `normalizeWorkspaceRoot(hint)`. When deleted, metadata emits `workspaceId: ''`. Because `SessionOrganizationStore.deleteSession(root, sessionId)` requires a workspace root, the capture service cannot determine which root to delete from. The rows remain in SQLite.
- **Impact**: Per [implementation-plan.md:1233](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/implementation-plan.md#L1233) and [batches.md:559-562](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/batches.md#L559-L562) (R-TL12), orphan rows are accepted residuals: `session:list` joins outward from `SessionMetadataStore.getForWorkspace`, so once metadata is deleted, the session is never queried or displayed.

### (f) Spec quality and reachability (AC8) — PASS

- [session-organization-capture.service.spec.ts:89-114](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.spec.ts#L89-L114):
  - The delete cascade tests construct a **REAL** `SessionMetadataStore` over `createMockStateStorage()` and trigger deletions via `await h.metadata.delete(SESSION)`, verifying that the real event pipeline reaches `SessionOrganizationService.removeSession`.
  - The rekey tests construct a **REAL** `SessionIdResolvedCallbackRegistry` and trigger rekeys via `h.registry.notifyAll(...)`, verifying that the real registry reaches `SessionOrganizationService.rekeySession`.
  - Detached operations are awaited via `flush()` before assertions.
  - All 12 test assertions are non-vacuous, inspecting exact method parameters, state transitions, emitted change events, and output channel logs.

---

## Five Logic Questions

### 1. How does this fail silently?

- When `payload.workspaceId` is empty ([session-organization-capture.service.ts:96](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L96)): The delete cascade drops with an output channel log line. SQLite rows (if any existed from a `workspaceRootHint` capture) remain as harmless orphans.
- When `SessionOrganizationStore` is closed or unavailable during a delete or rekey: The service logs `removeSession dropped...` or `rekeySession dropped...` ([session-organization.service.ts:544, 568](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L544)). The event is dropped without retrying.

### 2. What user action produces unexpected behaviour?

- Deleting a session while the persistence connection is disconnected or initializing: The metadata record is deleted from JSON storage, but SQLite organization rows are not cleaned up. However, the user observes no anomaly because `session:list` filters on metadata records.

### 3. What input data produces a wrong answer?

- A `payload.workspaceId` consisting purely of whitespace (e.g. `'   '`): It bypasses `if (!payload.workspaceId)` because `'   '` is truthy. It passes `'   '` to `removeSession`, which resolves it via `normalizeWorkspaceRoot('   ')` against `process.cwd()`.

### 4. What happens when a dependency fails?

- If `SessionMetadataStore.delete` emits or listener throws: Caught by `SessionMetadataStore.emitChange` or `SessionOrganizationService.removeSession`, logged, and does not crash the caller.
- If `SessionIdResolvedCallbackRegistry.notifyAll` triggers an error: Caught by `CallbackRegistryBase.register`, logged, and does not crash other subscribers.

### 5. What is missing that the requirements never mentioned?

- If `SessionOrganizationCaptureService.start()` throws on the second registration (`sessionIdResolved.register`), `this.started` was already set to `true`, leaving the first registration orphaned if `dispose()` is subsequently called.

---

## Failure Modes

### FM-1: Delete Cascade on Whitespace-Only Workspace Root

- **Trigger**: Session metadata contains `workspaceId: "   "`.
- **Symptom**: `removeSession` resolves `"   "` to `path.resolve("   ")` (`process.cwd()`) instead of dropping the event.
- **Evidence**: [session-organization-capture.service.ts:96](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L96).
- **Current handling**: `if (!payload.workspaceId)` evaluates to `false` for non-empty whitespace strings.
- **Recommendation**: Check `!payload.workspaceId?.trim()`.

### FM-2: Closed Store During Delete Cascade or Rekey

- **Trigger**: Metadata deletion or ID resolution fires while SQLite connection is closed or uninitialized.
- **Symptom**: Organization rows are not deleted or rekeyed; one log line is written to `IOutputChannel`.
- **Evidence**: [session-organization.service.ts:543-546, 567-570](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.service.ts#L543-L546).
- **Current handling**: Drops the operation with a log line.
- **Recommendation**: Matches design specifications ([implementation-plan.md:1230-1233](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/.ptah/specs/TASK_2026_580_9f77/implementation-plan.md#L1230-L1233)); no change needed.

### FM-3: Partial Failure During `start()`

- **Trigger**: The second registration in `start()` throws an unexpected runtime exception.
- **Symptom**: `this.started` remains `true` with an empty `this.disposers` array, preventing cleanup.
- **Evidence**: [session-organization-capture.service.ts:74-82](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L74-L82).
- **Current handling**: `this.started = true` is set before array assignment.
- **Recommendation**: Set `this.started = true` only after all disposers are collected.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

### 1. Minor — Whitespace-only `workspaceId` bypasses empty check

- **File**: [session-organization-capture.service.ts:96](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L96)
- **Scenario**: When `payload.workspaceId` is `"   "`, `if (!payload.workspaceId)` is false. `this.service.removeSession` is called with `"   "`, causing `normalizeWorkspaceRoot` to resolve the current process directory.
- **Impact**: Harmless because no session organization rows will match `(process.cwd(), sessionId)`, but undesirable resolution behavior.
- **Fix**: Use `if (!payload.workspaceId || !payload.workspaceId.trim())`.

### 2. Nit — Whitespace-only `previousSessionId` in `onSessionIdResolved`

- **File**: [session-organization-capture.service.ts:106-107](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L106-L107)
- **Scenario**: If `payload.previousSessionId` is `"   "`, `!previous` evaluates to false, calling `rekeySession("   ", payload.realSessionId)`.
- **Impact**: Harmless; `store.rekeySession` finds no rows and returns `[]`.
- **Fix**: Check `if (!previous || !previous.trim() || previous.trim() === payload.realSessionId)`.

### 3. Nit — `start()` sets `this.started = true` before disposers are assigned

- **File**: [session-organization-capture.service.ts:74-75](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization-capture.service.ts#L74-L75)
- **Scenario**: If the second registration throws, `this.started` is left `true` while `this.disposers` is empty. A subsequent `dispose()` will not release the first listener.
- **Impact**: Negligible in practice as synchronous event emitter registrations do not throw under normal conditions.
- **Fix**: Collect disposers in a local array and set `this.disposers` and `this.started = true` at the end of the method.

---

## Data Flow

1. **Delete Cascade**:
   - External trigger: RPC `session:delete` or `SessionImporter.pruneContentlessSessions`.
   - Entry: `SessionMetadataStore.delete(sessionId)`.
   - Notification: `SessionMetadataStore.emitChange('deleted', sessionId, workspaceId)` [OK].
   - Subscriber: `SessionOrganizationCaptureService.onMetadataChanged(payload)` [OK].
   - Filtering: Checks `kind === 'deleted'` and `Boolean(payload.workspaceId)` [OK].
   - Service sink: `SessionOrganizationService.removeSession(workspaceId, sessionId)` [OK].
   - Normalization: `normalizeWorkspaceRoot(workspaceId)` [OK].
   - Store sink: `SessionOrganizationStore.deleteSession(root, sessionId)` inside SQLite transaction [OK].
   - Event broadcast: `SessionOrganizationService.emitChange({ workspaceRoot, sessionIds, reason: 'delete' })` [OK].

2. **Rekey Cascade**:
   - External trigger: `SdkAgentAdapter.createSessionIdCallback` rebinds session.
   - Entry: `SessionIdResolvedCallbackRegistry.notifyAll(payload)`.
   - Subscriber: `SessionOrganizationCaptureService.onSessionIdResolved(payload)` [OK].
   - Filtering: Verifies `previousSessionId` is present and `previousSessionId !== realSessionId` [OK].
   - Service sink: `SessionOrganizationService.rekeySession(previous, realSessionId)` [OK].
   - Store sink: `SessionOrganizationStore.rekeySession(oldId, newId)` [OK].
   - Event broadcast: `SessionOrganizationService.emitChange({ workspaceRoot, sessionIds: [oldId, newId], reason: 'capture' })` for each affected root [OK].

---

## Requirements Fulfilment

| Requirement                                                                                       | Status   | Gap  |
| ------------------------------------------------------------------------------------------------- | -------- | ---- |
| Delete cascade on `SessionMetadataStore` `'deleted'` events (D7, AC6)                             | COMPLETE | None |
| Rekey on `SessionIdResolvedCallbackRegistry` payload with `previousSessionId` (G1)                | COMPLETE | None |
| Synchronous handler execution for `SessionIdResolved`                                             | COMPLETE | None |
| Host-wide subscriptions only (no per-session listeners, no timers)                                | COMPLETE | None |
| Synchronous and idempotent `start()` and `dispose()` (CONVENTIONS.md §9)                          | COMPLETE | None |
| Empty workspaceId dropped with single log line                                                    | COMPLETE | None |
| Reachability specs with real `SessionMetadataStore` and `SessionIdResolvedCallbackRegistry` (AC8) | COMPLETE | None |

---

## Edge Cases

| Case                                         | Handled | How                                                       | Concern |
| -------------------------------------------- | ------- | --------------------------------------------------------- | ------- |
| Multiple calls to `start()`                  | YES     | `if (this.started) return;`                               | None    |
| Multiple calls to `dispose()`                | YES     | `if (!this.started) return;`                              | None    |
| `start()` after `dispose()`                  | YES     | Re-registers both listeners                               | None    |
| Metadata event is `'created'` or `'updated'` | YES     | Guard `if (payload.kind !== 'deleted') return;`           | None    |
| Empty `workspaceId` in delete event          | YES     | Logs warning and drops cascade                            | None    |
| `previousSessionId` absent or undefined      | YES     | Guard `if (!previous) return;`                            | None    |
| `previousSessionId === realSessionId`        | YES     | Guard `if (previous === payload.realSessionId) return;`   | None    |
| Store closed during delete or rekey          | YES     | Caught inside service, logged to output channel, no throw | None    |

---

## Verdict

- **Recommendation**: APPROVE
- **Confidence**: HIGH
- **Top risk**: An edge-case session recorded with an empty metadata workspaceId leaves orphaned SQLite rows upon deletion (benign residual, filtered by metadata-driven list).
- **What a robust implementation would add**: Add `.trim()` to the `workspaceId` and `previousSessionId` guards.
