VERDICT: APPROVED
SCORE: 9.8/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch B3.4)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.8/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nits        | 1        |
| Failure modes found | 0        |

Batch B3.4 hardens the `PtahAPI.sessionOrganization` namespace builder and completes the integration tests deferred from Batch B3.3. Specifically:

1. `deps.getWorkspaceRootHint()` is moved inside the `try ... catch` block in `session-organization-namespace.builder.ts:145`, ensuring throwing root hint readers fail gracefully to `{ ok: false, error: 'link-failed' }` (closing B3.3 Finding 1).
2. A unit test verifying the root-hint throw degradation was added to `session-organization-namespace.builder.spec.ts:160-177`.
3. Three builder-level integration tests were added in `ptah-api-builder.service.spec.ts` (closing B3.3 Finding 2):
   - A throwing recorder in `recordWorktreeForCaller` preserves `{ success: true }` on `git.worktreeAdd` and logs exactly one debug line with error context (`:812-838`).
   - `ptahAPI.sessionOrganization.linkTask` inside `runWithMcpRequestContext` resolves the caller's tab ID to the SDK session UUID via lifecycle `find(tab)` and invokes `recorder.linkTask` with `source: 'agent'`, `role: 'primary'`, and never leaks the tab ID (`:926-955`).
   - `linkTask` without a registered recorder returns `organization-unavailable` (`:957-967`).
4. The `buildTestBuilder` test helper was updated with an optional trailing `logger` parameter (`:339`), preserving exact behavior for all existing tests while allowing isolated log assertions.
5. Production MCP tool counts in `mcp-contract.sweep.spec.ts` remain intact at 56 (full) and 53 (headless/no-IDE).

---

## Findings Table

| Finding                                                     | Severity | File:Line                                                                                                                  | Description                                                                                                                                                                                                                                                                                                                                                                                      | Concrete Fix                                                                                                  |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 1. Unwrapped `getRecorder()` and `resolveCallerSessionId()` | NIT      | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts:123,132` | `deps.getRecorder()` and `deps.resolveCallerSessionId()` are called before the `try ... catch` block. In production (`ptah-api-builder.service.ts:837-838`), `getRecorder` is a property read and `resolveCallerSessionId` internally catches lifecycle lookup errors, so neither throws in production. If a third-party or faulty test dependency threw, the exception would escape `linkTask`. | Wrap the entire method execution in the `try ... catch` block or coalesce resolver exceptions to `undefined`. |

---

## Detailed Check Analysis

### (a) Finding 1 Closure and Dependency Exception Isolation

- **`getWorkspaceRootHint()`**: Moved inside the `try` block (`session-organization-namespace.builder.ts:144-153`). Any thrown error during workspace root resolution is caught and returns `{ ok: false, error: 'link-failed', message: error.message }`.
- **`recorder.linkTask(...)`**: Located inside the `try` block (`:146-152`). A throwing recorder is caught and returns `{ ok: false, error: 'link-failed' }`.
- **`getRecorder()` & `resolveCallerSessionId()`**: Called outside the `try` block (`:123, 132`). In production (`ptah-api-builder.service.ts:1025-1049`), `this.resolveCallerSdkSessionId()` catches all lifecycle manager errors with `try ... catch` and returns `undefined`, while `getRecorder` returns the injected field `this.sessionOrganizationRecorder`. Thus, production dependencies never throw. The residual risk is purely theoretical (non-production test doubles), classified as a Nit.

### (b) Test Rigor and Non-Vacuity

- **Test (i) - Throwing recorder in worktree add (`ptah-api-builder.service.spec.ts:812-838`)**:
  - Uses `buildWithRealGit` which delegates to `realBuildGitNamespace` and real `PtahAPIBuilder` logic; only `execGit` is mocked to simulate clean git output.
  - Clears pre-existing debug logs from builder initialization (`debug.mockClear()`).
  - Asserts `expect(result).toEqual({ success: true, worktreePath: WORKTREE })`.
  - Asserts `expect(recorder.recordWorktree).toHaveBeenCalledTimes(1)`.
  - Asserts `expect(debug).toHaveBeenCalledTimes(1)` and validates the message contains `'Worktree capture failed'`.
- **Test (ii) - Contextual caller attribution (`:926-955`)**:
  - Invokes `api.sessionOrganization.linkTask` via real `buildSessionOrganizationNamespace` (imported directly, not through the mocked barrel).
  - Asserts result `{ ok: true, sessionId: SDK_ID, taskId: TASK_ID, role: 'primary' }`.
  - Asserts recorder received `{ sessionId: SDK_ID, workspaceRootHint: TAB_ROOT, taskId: TASK_ID, role: 'primary', source: 'agent' }`.
  - Explicitly asserts that `TAB_ID` was NOT passed to the recorder (`expect(recorder.linkTask.mock.calls[0][0].sessionId).not.toBe(TAB_ID)`).
- **Test (iii) - Absent recorder degradation (`:957-967`)**:
  - Instantiates builder with `undefined` recorder.
  - Asserts result `{ ok: false, error: 'organization-unavailable' }`.

### (c) Helper Compatibility

- `buildTestBuilder` (`ptah-api-builder.service.spec.ts:331-340`) adds `logger: Logger = makeLogger()` as an optional trailing parameter.
- All existing call sites passing fewer arguments continue to construct a fresh `makeLogger()` instance with no change in semantics.

### (d) Contract Sweep Preservation

- MCP tool counts in `mcp-contract.sweep.spec.ts` remain pinned at 56 and 53 (`:1707, 1731`). No tool definition changes were introduced in B3.4, matching plan boundaries for Batch B3.5.

---

## Five Logic Questions

### 1. How does this fail silently?

- **Worktree add recording failure (`ptah-api-builder.service.ts:1073-1078`)**: If `recorder.recordWorktree` throws, the error is logged as debug and suppressed, allowing `git.worktreeAdd` to report `{ success: true }`. This silent swallow is intentional: git already created the worktree on disk, so metadata capture failure must not abort or misrepresent git operations.
- **Recorder drop on SQLite lock or shutdown**: Per `ISessionOrganizationRecorder` port contract, write failures inside SQLite are logged and dropped, returning `{ ok: true }` from `linkTask` once accepted by the recorder.

### 2. What user action produces unexpected behaviour?

- **Agent invoking `ptah_session_link_task` before SDK session assignment**: If called in the transient initialization window before `sdkSessionLifecycleManager` binds the tab ID to an SDK session UUID, `resolveCallerSdkSessionId` returns `undefined`, producing `{ ok: false, error: 'unattributed-caller' }`. The agent must wait or retry.
- **Calling `linkTask` on VS Code host**: Returns `{ ok: false, error: 'organization-unavailable' }` gracefully because VS Code does not implement `ISessionOrganizationRecorder`.

### 3. What input data produces a wrong answer?

- None. `SessionLinkTaskArgsSchema` enforces `TaskIdRefSchema` (rejecting directory traversal `../`, slashes, empty strings) and `z.enum(SESSION_TASK_LINK_ROLES)` on `role`. The schema is marked `.strict()`, rejecting forged `sessionId` parameters.

### 4. What happens when a dependency fails?

- **`deps.getWorkspaceRootHint()` throws**: Now enclosed in `try ... catch` (`session-organization-namespace.builder.ts:144-159`), returning `{ ok: false, error: 'link-failed', message: error.message }`.
- **`recorder.linkTask` throws**: Caught in `linkTask`, returning `{ ok: false, error: 'link-failed', message: error.message }`.
- **`sdkSessionLifecycleManager.find()` throws**: Caught inside `resolveCallerSdkSessionId` (`ptah-api-builder.service.ts:1031-1041`), logged at debug level, and returned as `undefined`, producing `{ ok: false, error: 'unattributed-caller' }`.

### 5. What is missing that the requirements never mentioned?

- Tool registration for `ptah_session_link_task` and dispatcher cases in `protocol-dispatcher.ts` are deliberately deferred to Batch B3.5 per `batches.md` to prevent coupling tool count bumps with builder hardening.

---

## Failure Modes

No unhandled failure modes found.

- Scope examined: `session-organization-namespace.builder.ts`, `session-organization-namespace.builder.spec.ts`, and `ptah-api-builder.service.spec.ts`, along with `PtahAPIBuilder` dependency resolutions.
- Diagnostics: 0 errors, 0 warnings reported by TypeScript compiler via `ptah_get_diagnostics`.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

- **Finding 1 (Nit)** — `session-organization-namespace.builder.ts:123, 132`: `deps.getRecorder()` and `deps.resolveCallerSessionId()` are invoked outside the `try` block. Production methods are non-throwing, but enclosing the entire function body would eliminate any possible mock leakage.

---

## Data Flow

1. **Invocation**: Agent or test calls `ptahAPI.sessionOrganization.linkTask(args)`.
2. **Schema Validation**: `SessionLinkTaskArgsSchema.safeParse(args ?? {})` parses `taskId` and optional `role` -> [OK: invalid shapes return `invalid-args`].
3. **Host Availability**: `deps.getRecorder()` checks for recorder instance -> [OK: missing recorder returns `organization-unavailable`].
4. **Attribution**: `deps.resolveCallerSessionId()` maps caller tab ID to SDK session UUID -> [OK: unmapped caller returns `unattributed-caller`].
5. **Execution & Isolation**: `try` block executes `deps.getWorkspaceRootHint()` and `recorder.linkTask({...})` -> [OK: exceptions return `link-failed`].
6. **Result**: Returns `{ ok: true, sessionId, taskId, role }` -> [OK].

---

## Requirements Fulfilment

| Requirement                                                                                 | Status   | Gap  |
| ------------------------------------------------------------------------------------------- | -------- | ---- |
| Root-hint read moved inside `try` block (`batches.md:1055-1059`)                            | COMPLETE | None |
| Unit test for throwing root-hint read (`batches.md:1059`)                                   | COMPLETE | None |
| Worktree capture recorder throw test in builder spec (`batches.md:1061-1062`)               | COMPLETE | None |
| Caller attribution integration test via `runWithMcpRequestContext` (`batches.md:1063-1066`) | COMPLETE | None |
| Unavailable recorder integration test in builder spec (`batches.md:1067`)                   | COMPLETE | None |
| Optional logger parameter in `buildTestBuilder` preserving existing tests                   | COMPLETE | None |
| Sweep tool counts unchanged at 56/53                                                        | COMPLETE | None |

---

## Edge Cases

| Case                                         | Handled | How                                                             | Concern |
| -------------------------------------------- | ------- | --------------------------------------------------------------- | ------- |
| `getWorkspaceRootHint()` throws              | YES     | Caught in `try`, returns `{ ok: false, error: 'link-failed' }`  | None    |
| `recorder.linkTask()` throws                 | YES     | Caught in `try`, returns `{ ok: false, error: 'link-failed' }`  | None    |
| `recorder.recordWorktree()` throws           | YES     | Caught in `recordWorktreeForCaller`, debug logged, add succeeds | None    |
| Caller tab ID not found in lifecycle manager | YES     | Returns `undefined`, degrades to `unattributed-caller`          | None    |
| Extraneous `sessionId` passed in args        | YES     | Rejected by `.strict()` as `invalid-args`                       | None    |
| Host has no recorder                         | YES     | Returns `organization-unavailable`                              | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None in Batch B3.4; ready for MCP tool exposure in Batch B3.5.
- What a robust implementation would add:
  1. (Nit) Wrap `deps.getRecorder()` and `deps.resolveCallerSessionId()` inside the `try` block in `session-organization-namespace.builder.ts:123, 132` to guarantee no external mock can ever throw out of the namespace.
