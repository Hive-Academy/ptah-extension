VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch B3.1)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nits        | 3        |
| Failure modes found | 0        |

Batch B3.1 implements runtime-side capture in `cli-agent-runtime`:

1. **Worktree Created Broadcast (`sdk-callbacks.ts`)**: `wireWorktreeCallbacks` carries `sessionId: data.sessionId` in the `git:worktreeChanged` broadcast payload, prioritizes `data.worktreePath` when present over the platform resolver `resolveWorktreePath`, and preserves the removed callback path unchanged (Plan Component 8 :779-783, D8 :139).
2. **Ptah CLI Child Lineage Capture (`agent-events.ts`)**: `persistCliSessionReference` invokes `recordChildLineage` only in the `.then` callback after `metadataStore.addCliSession` succeeds, guarded by `sdkSessionId && sdkSessionId !== parentSessionId`. The recorder is resolved lazily from the container with an `isRegistered` check, and any runtime throw is trapped in `try/catch` and logged with `logger.warn` (Plan Component 8 :784-789, D13 :144, D15 :146, Assumption A2 :202-205).
3. **Comprehensive Unit Tests (`sdk-callbacks.spec.ts`, `agent-events.spec.ts`)**: Verified non-vacuous assertions covering the broadcast payload, path preference, fallback to resolver, exact lineage recording arguments, "Parent session not found" rejection, child-equal-parent guard, unregistered recorder no-op, and recorder-thrown error isolation.

---

## Numbered Findings

### Finding 1 (Nit) — `worktreePath` empty vs whitespace handling

- **Severity**: Nit
- **File**: `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:356`
- **Evidence**:
  ```ts
  let worktreePath: string | undefined = data.worktreePath || undefined;
  if (!worktreePath && resolveWorktreePath) {
  ```
- **Context & Analysis**:
  Using `data.worktreePath || undefined` correctly converts `undefined` and `""` to `undefined`, triggering the fallback to `resolveWorktreePath`. If a hook were ever to report a whitespace-only string (e.g. `" "`), `|| undefined` evaluates to truthy, skipping the resolver while broadcasting an invalid path. In practice, `WorktreeHookHandler` reports either a valid canonical absolute path or undefined.
- **Impact**: Zero in production; minor defensive robustness gap.
- **Fix**: Consider `data.worktreePath?.trim() || undefined`.

### Finding 2 (Nit) — Missing explicit spec for empty string `worktreePath: ""` fallback

- **Severity**: Nit
- **File**: `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.spec.ts:652-668`
- **Evidence**:
  The suite tests `worktreePath: '/repo/.worktrees/feat-x'` and `worktreePath: undefined` (omitted from `base`), but does not have a dedicated test case verifying that `worktreePath: ""` falls back to `resolver`.
- **Impact**: None in production; test coverage gap for an edge value.
- **Fix**: Add a third test case in `sdk-callbacks.spec.ts` asserting that `{ ...base, worktreePath: '' }` triggers `resolver` and broadcasts the resolved path.

### Finding 3 (Nit) — Repeated resolution pattern vs lazy singleton caching

- **Severity**: Nit
- **File**: `libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts:534-555`
- **Evidence**:
  ```ts
  function recordChildLineage(
    container: DependencyContainer,
    logger: Logger,
    tag: string,
    input: {
      readonly sessionId: string;
      readonly parentSessionId: string;
      readonly workspaceRootHint: string;
    },
  ): void {
    if (!container.isRegistered(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER)) {
      return;
    }
    try {
      const recorder = container.resolve<ISessionOrganizationRecorder>(
        PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER,
      );
      recorder.recordLineage({ ... });
  ```
- **Context**:
  `recordChildLineage` queries `container.isRegistered` and calls `container.resolve` on every finished reference persist. This is intentional and superior to constructor injection because it eliminates the risk identified in R-TL11 (where early resolution captures `undefined` forever if registered later). Because CLI agent reference persistence occurs at lifecycle boundaries (`agent:spawned`, `agent:completed`), the microsecond lookup cost is negligible.
- **Impact**: Positive design choice for initialization order safety.

---

## Specific Inquiries & Architecture Audits

### (a) `sdk-callbacks`: Broadcast payload, path preference, fallback, and error handling

- **Carries `sessionId`**: In [sdk-callbacks.ts:373](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts#L373), `sessionId: data.sessionId` is explicitly added to the `git:worktreeChanged` broadcast payload.
- **Authoritative path preference**: Line 356 inspects `data.worktreePath || undefined`. If provided, it bypasses the resolver entirely.
- **Resolver fallback**: If `data.worktreePath` is absent or empty string `""`, `!worktreePath` evaluates to `true`, invoking `resolveWorktreePath(data)`.
- **Removed path preserved**: Lines 383-398 remain untouched, broadcasting `{ action: 'removed', path: data.worktreePath }`.
- **Resolver failure resilience**: In lines 358-365, `await resolveWorktreePath(data)` is guarded by `try ... catch (err)` which logs a warning (`${tag} Failed to resolve worktree path for notification`) and allows `broadcastMessage` to proceed with `path: undefined` rather than rejecting unhandled.

### (b) `agent-events`: Execution ordering, parent validation, SDK ID guarantees

- **Execution sequencing**: `recordChildLineage` is located in the `.then` resolution handler of `retryWithBackoff(persistBulkThenReference, ...)`. It runs **only** after `addCliSession` succeeds.
- **Rejection behavior**: When `addCliSession` throws `"Parent session not found"`, `shouldRetry` explicitly checks `msg.includes('Parent session not found')` and returns `false` ([agent-events.ts:452,462](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts#L452-L462)). The retry loop terminates immediately without retrying, and the promise rejects into `.catch()`, completely bypassing `.then()` and preventing `recordChildLineage` from running.
- **Parent ID validation guarantee**: `SessionMetadataStore.addCliSession(sessionId, ...)` queries `await this.get(sessionId)` ([session-metadata-store.ts:903-906](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L903-L906)). Because `SessionMetadataStore` only stores records for canonical SDK session UUIDs (created via `create`, `createChild`, or `importSession`), a successful lookup guarantees that `parentSessionId` is a real SDK session UUID and not an unresolved webview tab ID.
- **Child `sdkSessionId` guarantee**: Lines 389-395 resolve `sdkSessionId` from `getSdkSessionId(info.ptahCliId)` (mapped from `event.sessionId`) or `info.cliSessionId` (for ptah-cli, which is the SDK session UUID).
- **Self-lineage prevention**: The guard `if (sdkSessionId && sdkSessionId !== parentSessionId)` strictly prevents self-referencing lineage if an agent were misconfigured with its own ID as parent.

### (c) Assumption A2 Ruling & RPC Handlers Audit

- **`agent-rpc.handlers.ts:971` (`resumePtahCliSession`)**:
  - `params.parentSessionId` arrives from the RPC caller (webview) and can be a tab ID or absent.
  - Line 971 calls `this.sessionMetadataStore.createChild(sessionId, workspaceRoot, spawnResult.agentName)`. This initializes metadata for the child, but does not take or store a parent ID.
  - Lines 981-994 call `this.agentProcessManager.spawnFromSdkHandle(spawnResult.handle, { ..., parentSessionId, ... })`.
  - When the agent process spawns or completes, the process events trigger `persistCliSessionReference`, which runs the validated `addCliSession` + `recordChildLineage` path.
  - Adding a `recordLineage` call directly at line 971 would be harmful: `params.parentSessionId` may be a tab ID (violating the port's strict "SDK session UUIDs only" contract), and if valid, would produce a duplicate write.
- **`chat-stream-broadcaster.service.ts:211`**:
  - In `chat-stream-broadcaster.service.ts:200-232`, the method handles `event.sessionId` and calls `this.sessionMetadataStore.createChild(event.sessionId, workspacePath, sessionName)`.
  - No parent session ID exists at this layer (only `tabId`, which is a webview tab ID).
  - The service records `this.ptahCli.setSdkSessionId(tabId, event.sessionId)` and `setSdkSessionId(ptahCliAgentId, event.sessionId)`, which populates the map that `persistCliSessionReference` subsequently reads to obtain `sdkSessionId`.
- **Verdict on A2**: Both code paths confirm the executor's and coordinator's ruling. No additional `recordLineage` calls should be placed in `rpc-handlers`.

### (d) Idempotency of Repeat Lineage Calls

- A child agent triggers `persistCliSessionReference` upon initial spawn (`agent:spawned`) and again upon process exit (`agent:completed` / `agent:failed`).
- In `SessionOrganizationStore.upsertOrganization` ([session-organization.store.ts:516-524,752-765](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/session-organization/src/lib/session-organization.store.ts#L516-L524)):
  - It executes `SQL.ensureOrganization`: `INSERT INTO session_organization ... ON CONFLICT(workspace_root, session_id) DO UPDATE SET updated_at = excluded.updated_at`.
  - It then executes `SQL.setParentSessionId` and `SQL.setStartedBy`.
  - Repeat calls write identical column values (`parent_session_id`, `started_by`), modifying only `updated_at`.
- Each write fires `SessionOrganizationService.onDidChange`, broadcasting `session:organizationChanged`. The frontend debounces this event by 250ms (Plan Component 11 :911-919; Batches :1006). Since `agent:spawned` and process completion occur across realistic time spans (or within debounce windows), repeat change events do not cause UI thrashing or excessive reloads.

### (e) Logger Usage Consistency (Plan D15)

- Plan D15 explicitly states:
  > "New backend classes log via IOutputChannel with a [SessionOrganization] prefix. Modified existing classes (WorktreeHookHandler, SessionForkService, agent-events, handlers) keep their current logger."
- `sdk-callbacks.ts` and `agent-events.ts` are existing wiring modules that inject `Logger`. Utilizing `logger.warn` and `logger.info` is completely compliant with Plan D15 and avoids unnecessary refactoring.

### (f) Specification & Test Robustness

- **Exact argument verification**: `agent-events.spec.ts:573-578` explicitly tests `toHaveBeenCalledWith({ sessionId: CHILD_SESSION, parentSessionId: PARENT_SESSION, startedBy: 'agent', workspaceRootHint: '/repo' })`.
- **Rejected parent handling**: Lines 581-591 test rejection with `"Parent session not found"` after 60,000ms timer advance, asserting `recordLineage` was not called.
- **Equal ID guard**: Lines 593-604 assert that `cliSessionId: PARENT_SESSION` results in no `recordLineage` invocation.
- **Unregistered recorder**: Lines 606-615 assert that persist succeeds without warning or error when `SESSION_ORGANIZATION_RECORDER` is absent.
- **Faulty recorder resilience**: Lines 617-632 assert that a thrown error inside `recordLineage` logs a warning and does not cause `logger.error` or unhandled promise rejection.
- **Broadcast verification**: `sdk-callbacks.spec.ts:632-668` directly awaits `onCreated` and asserts `sessionId: REAL_SESSION_ID` and the respective resolved/authoritative `path`. No assertions pass vacuously.

---

## Five Logic Questions

### 1. How does this fail silently?

- In `sdk-callbacks.ts:360-365`, if `resolveWorktreePath` throws, the error is caught, logged with `logger.warn`, and the broadcast message is sent with `path: undefined`. This is safe because missing a resolved path should not block notifying the UI of a worktree creation event.
- In `agent-events.ts:538-540`, if `SESSION_ORGANIZATION_RECORDER` is not registered in the container (e.g., in VS Code runtime), `recordChildLineage` returns silently without action. This matches the optional port design.
- In `agent-events.ts:550-555`, if `recorder.recordLineage` throws, the exception is caught and logged at `warn` level. It does not fail the reference persist, which is the primary operational requirement.
- In `agent-events.ts:488-491`, if `addCliSession` rejects with `"Parent session not found"`, the error is caught, logged at `debug` level, and deferred, skipping lineage recording.

### 2. What user action produces unexpected behaviour?

- If the user deletes or clears the parent session while a child agent is actively executing, the child's final exit reference persistence will reject with `"Parent session not found"`. As designed, child lineage will not be attached to the deleted session.
- If multiple child agents are run concurrently under the same parent, multiple `recordChildLineage` calls execute concurrently. Because the underlying SQLite store uses atomic transactions and idempotent upserts, there is no risk of race conditions or inconsistent states.

### 3. What input data produces a wrong answer?

- If `info.workingDirectory` is relative or empty, it is passed as `workspaceRootHint`. However, downstream in `SessionOrganizationService`, workspace root hints are validated against `SessionMetadataStore.workspaceId` and normalized via `normalizeWorkspaceRoot`, preventing dirty keys in SQLite.
- If `info.cliSessionId` is equal to `info.parentSessionId`, the equality guard prevents recording self-referential lineage.

### 4. What happens when a dependency fails?

- **Metadata store failure**: If `addCliSession` fails with a non-parent error (e.g. disk full), `retryWithBackoff` retries 3 times before logging an error; lineage is never recorded for unpersisted references.
- **Recorder failure**: If `recordLineage` throws (e.g. database locked or corrupted), it is caught and logged at `warn` level; reference persistence remains intact.
- **Webview broadcast failure**: In `sdk-callbacks.ts:375-380`, `webviewManager.broadcastMessage` rejections are caught and logged at `error` level.

### 5. What is missing that the requirements never mentioned?

- Handling of whitespace-only strings in `data.worktreePath` (addressed in Finding 1).

---

## Failure Modes

| Name                                 | Trigger                                                | Symptom                                  | Evidence                   | Current Handling                                         | Recommendation              |
| ------------------------------------ | ------------------------------------------------------ | ---------------------------------------- | -------------------------- | -------------------------------------------------------- | --------------------------- |
| FM-1: Unregistered Recorder          | SQLite / organization service not registered (VS Code) | Lineage is not recorded                  | `agent-events.ts:538-540`  | `isRegistered` check returns early                       | Correct per spec; no action |
| FM-2: Parent Session Not Found       | Child completes after parent session removed           | Lineage write skipped                    | `agent-events.ts:488-491`  | Logged at `debug` level; `recordChildLineage` not called | Correct per spec; no action |
| FM-3: Faulty Recorder Implementation | Bug or constraint error in recorder adapter            | Reference persist could fail if uncaught | `agent-events.ts:550-555`  | Caught and logged via `logger.warn`                      | Correct per spec; no action |
| FM-4: Resolver Error                 | Platform worktree resolver rejects                     | Broadcast sent without path              | `sdk-callbacks.ts:360-365` | Caught and logged; `path: undefined` broadcast           | Correct per spec; no action |

---

## Blocking Issues

None.

## Serious Issues

None.

## Moderate and Minor Issues

- **Finding 1 (Nit)**: `data.worktreePath || undefined` does not trim whitespace (`sdk-callbacks.ts:356`).
- **Finding 2 (Nit)**: Absence of explicit unit test for empty string `worktreePath: ""` fallback (`sdk-callbacks.spec.ts:652-668`).
- **Finding 3 (Nit)**: Repeated container lookup on agent event vs caching (justified by R-TL11 immunity).

---

## Data Flow

1. **Worktree Created Flow**:
   - `sdkAdapter.onWorktreeCreated(data)` enters `wireWorktreeCallbacks` ([sdk-callbacks.ts:349](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts#L349)) [OK]
   - Checks `data.worktreePath || undefined` [OK]
   - If falsy and `resolveWorktreePath` exists, resolves path via `resolveWorktreePath(data)` under `try/catch` [OK]
   - Broadcasts `git:worktreeChanged` with `{ action: 'created', name, path, sessionId: data.sessionId }` [OK]
   - Traps broadcast promise rejections with `logger.error` [OK]

2. **Ptah CLI Lineage Capture Flow**:
   - `agent:spawned` or `agent:completed` triggers `persistCliSessionReference` ([agent-events.ts:340](file:///D:/projects/ptah-extension/.claude-worktrees/task-580/libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts#L340)) [OK]
   - Resolves `sdkSessionId` from `ptahCliId` map or `info.cliSessionId` [OK]
   - Assembles `ref: CliSessionReference` and executes `retryWithBackoff(persistBulkThenReference)` [OK]
   - `addCliSession` validates parent exists in `SessionMetadataStore` [OK]
   - On rejection with `"Parent session not found"`, `shouldRetry` aborts immediately, logs debug, and skips `.then()` [OK]
   - On resolution, enters `.then()`, checks `if (sdkSessionId && sdkSessionId !== parentSessionId)` [OK]
   - Calls `recordChildLineage(container, logger, tag, ...)` [OK]
   - Checks `container.isRegistered(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER)` [OK]
   - Resolves recorder and calls `recorder.recordLineage({ sessionId, parentSessionId, startedBy: 'agent', workspaceRootHint })` [OK]
   - Traps any thrown error in `try/catch` with `logger.warn` [OK]

---

## Requirements Fulfilment

| Requirement                                                                                          | Status   | Gap  |
| ---------------------------------------------------------------------------------------------------- | -------- | ---- |
| Component 8: `wireWorktreeCallbacks` sends `sessionId: data.sessionId`                               | COMPLETE | None |
| Component 8: prefers `data.worktreePath` before falling back to resolver                             | COMPLETE | None |
| Component 8 / D13: `persistCliSessionReference` calls `recordLineage` after `addCliSession` succeeds | COMPLETE | None |
| Component 8 / D13: calls `recordLineage` only when `sdkSessionId` is set and differs from parent     | COMPLETE | None |
| Component 8: `isRegistered` container guard                                                          | COMPLETE | None |
| D15: modified existing classes keep current logger                                                   | COMPLETE | None |
| Assumption A2: confirmation that no extra `recordLineage` call is needed in `rpc-handlers`           | COMPLETE | None |
| Idempotent lineage re-writes and debounce safety verified                                            | COMPLETE | None |

---

## Edge Cases

| Case                                                  | Handled | How                                                                                 | Concern |
| ----------------------------------------------------- | ------- | ----------------------------------------------------------------------------------- | ------- |
| `data.worktreePath` is non-empty string               | YES     | Directly used; resolver skipped                                                     | None    |
| `data.worktreePath` is `undefined`                    | YES     | Falls back to `resolveWorktreePath`                                                 | None    |
| `data.worktreePath` is `""`                           | YES     | Evaluated as falsy; falls back to resolver                                          | None    |
| `resolveWorktreePath` throws                          | YES     | Caught in `try/catch`, logged, broadcast with `path: undefined`                     | None    |
| `parentSessionId` is a tab ID                         | YES     | Rejected by `addCliSession` ("Parent session not found"); lineage recording skipped | None    |
| `parentSessionId` equals `sdkSessionId`               | YES     | Filtered by `sdkSessionId !== parentSessionId` guard                                | None    |
| Recorder token unregistered                           | YES     | Guarded by `container.isRegistered`                                                 | None    |
| Recorder throws                                       | YES     | Caught in `try/catch`, logged via `logger.warn`                                     | None    |
| Multiple sequential reference persists (spawn + exit) | YES     | SQLite store upsert is idempotent on data columns; frontend debounces change events | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None in Batch B3.1.
- What a robust implementation would add: Trim whitespace in `data.worktreePath?.trim() || undefined` and add a test case for `worktreePath: ""`.
