VERDICT: APPROVED
SCORE: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch B1)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nits        | 1        |
| Failure modes found | 0        |

Batch B1 implements SDK-side session organization capture in `@ptah-extension/agent-sdk` across two producers:

1. `WorktreeHookHandler` (`libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts`): injects `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` optionally and records worktree path and branch upon successful `addWorktree`, immediately before invoking `onWorktreeCreated`. The agent-sdk twin `WorktreeCreatedCallback` type adds required `worktreePath: string`.
2. `SessionForkService` (`libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts`): injects `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` optionally and records lineage (`forkOfSessionId: sessionId`, `sessionId: result.sessionId`) after `metadataStore.create(...)`.

Both services preserve existing logger instances (Decision D15), leave return values and existing error handling unchanged, and are covered by 10 comprehensive unit tests asserting exact arguments, execution call ordering, failure isolation, and behavior when the recorder is absent.

### Findings Table

| Finding                                                                        | Severity | File:Line                                                                                                                                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Concrete Fix                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Unwrapped `recorder` invocations rely strictly on port never-throw contract | MINOR    | `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:240-245`, `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts:149-153` | `recorder?.recordWorktree(...)` and `recorder?.recordLineage(...)` are called without a surrounding `try ... catch`. By port contract (`ISessionOrganizationRecorder`), recorder methods never throw. However, if an adapter implementation or unexpected runtime exception were to throw synchronously, the enclosing `try` block catches it and aborts the hook or rejects `forkSession`, even though filesystem/metadata changes have already taken effect. | (Optional defense-in-depth) Wrap `this.recorder?.recordWorktree` and `this.recorder?.recordLineage` in `try ... catch` blocks with debug logging, matching the pattern used in `PtahAPIBuilder.recordWorktreeForCaller` (`libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:1066-1078`). |

---

## Five Logic Questions

### 1. How does this fail silently?

- **Recorder port omission (`worktree-hook-handler.ts:132-133`, `session-fork.service.ts:68-69`)**: When running in an environment without SQLite persistence (e.g. VS Code host today), `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` is not registered. Optional injection resolves `null`, and optional chaining (`this.recorder?.recordWorktree(...)`, `this.recorder?.recordLineage(...)`) evaluates to a safe no-op. The callers proceed normally without error. This is intentional per architectural design (Decisions D2, D5).
- **Recorder drop on invalid/closed database**: Per the `ISessionOrganizationRecorder` port contract, if the underlying SQLite database is closed, undergoing migration, or the session metadata is absent, the adapter drops the record and logs a diagnostic line. Neither the worktree hook nor the fork operation fails as a result of observation drops.

### 2. What user action produces unexpected behaviour?

- **Creating a worktree or forking a session in VS Code**: Worktrees and fork lineage are not persisted to SQLite in the VS Code host because session organization is an Electron/CLI capability (Decision D5). The git worktree is created on disk and the session is forked in the SDK, but the session list organization metadata remains empty. This is expected by design (AC7).
- **Hypothetical synchronous recorder exception**: If a custom recorder throws, the user sees `Error in WorktreeCreate hook` or `Failed to fork session` even though git created the branch/directory or the SDK created the new transcript file. This risk is mitigated by the port's strict never-throw contract and can be further isolated via Finding 1.

### 3. What input data produces a wrong answer?

- **Unattributed/empty `input.session_id` in `WorktreeCreate`**: `input.session_id` is generated directly by the Claude Agent SDK runtime (`WorktreeCreateHookInput`). If `session_id` is empty or unknown, the recorder's metadata store lookup in `SessionOrganizationService` fails to find a record and drops the write, preventing corrupted or orphan database rows.
- **Missing `sourceMetadata.workspaceId` during `forkSession`**: Handled defensively at `session-fork.service.ts:133-140`. If both `sourceMetadata.workspaceId` and `workspaceProvider.getWorkspaceRoot()` are missing, the method throws an explicit `SdkError` _before_ `metadataStore.create` and _before_ `recorder.recordLineage`, preventing corrupted rows.

### 4. What happens when a dependency fails?

- **`gitInfo.addWorktree` fails or returns no path (`worktree-hook-handler.ts:217-231`)**: Throws an error. `this.recorder?.recordWorktree` is never called, and `capturedCreatedCallback` is never called. No false worktree fact is recorded.
- **SDK `forkSession` fails or rejects (`session-fork.service.ts:118-124`)**: Throws before reaching `metadataStore.create` and `recorder.recordLineage`. Lineage is not recorded.
- **`metadataStore.create` fails or rejects (`session-fork.service.ts:141-146`)**: Throws before reaching `recorder.recordLineage`. Lineage is not recorded.
- **`capturedCreatedCallback` throws (`worktree-hook-handler.ts:259-268`)**: Isolated with internal `try ... catch` and logged as an error. The hook completes and returns `{ hookSpecificOutput: { worktreePath }, continue: true }`.

### 5. What is missing that the requirements never mentioned?

- **Defensive isolation around recorder calls**: The port contract requires `never throw`, so the lack of `try ... catch` is compliant with the port contract and implementation plan (:708-709). However, defense-in-depth against faulty recorder implementations (as added to `PtahAPIBuilder` in B3.2/B3.3) provides extra resilience against runtime failures.

---

## Failure Modes

No unhandled failure modes found.

- Scope examined: `worktree-hook-handler.ts`, `worktree-hook-handler.spec.ts`, `session-fork.service.ts`, `session-fork.service.spec.ts`, `ISessionOrganizationRecorder` interface contract, DI container registrations in Electron and CLI, and callback wiring in `cli-agent-runtime`.
- Diagnostics: 0 TypeScript typecheck errors, 0 warnings.
- Verification: 10 unit test cases covering all capture branches, call orders, failure bailouts, and recorder-absent scenarios.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

- **Finding 1 (Minor)** — `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:240-245` & `libs/backend/agent-sdk/src/lib/helpers/session-fork.service.ts:149-153`:
  - Scenario: If a recorder implementation throws an unhandled synchronous exception, the enclosing catch block intercepts the error, aborting the SDK hook or rejecting `forkSession` after disk/metadata mutations have succeeded.
  - Impact: Hook fails or fork reports failure to the caller despite underlying resources being created.
  - Fix: Wrap `this.recorder?.recordWorktree(...)` and `this.recorder?.recordLineage(...)` in a `try ... catch` block with `this.logger.debug(...)` logging.

---

## Specific Audit Checks

### (a) Worktree Record Flow & Hook Input Verification

- **Execution Point**: In `worktree-hook-handler.ts:240-245`, `this.recorder?.recordWorktree(...)` is placed inside the existing `try` block, immediately after `addWorktree` succeeds and validates `result.success && result.worktreePath`, and immediately before `if (capturedCreatedCallback)`.
- **Failure Isolation**: If `addWorktree` fails (`success: false`, throws, or lacks `worktreePath`), execution throws at line 227 or line 289; `recordWorktree` is never called.
- **Return Value**: Returns `{ hookSpecificOutput: { hookEventName: 'WorktreeCreate', worktreePath: result.worktreePath }, continue: true }` unchanged.
- **Session ID Provenance**: `input.session_id` originates from `WorktreeCreateHookInput` passed by the Claude Agent SDK to the hook callback. It is the SDK session UUID and never a webview tab ID.
- **Empty / Malformed Session ID**: If `input.session_id` is missing or empty, `recordWorktree` forwards it to `SessionOrganizationService`, which performs a metadata check and drops unattributed/unmatched sessions with a diagnostic log.

### (b) Fork Lineage Record Flow

- **Execution Point**: In `session-fork.service.ts:149-153`, `this.recorder?.recordLineage(...)` is called immediately after `await this.metadataStore.create(...)`.
- **Session IDs**: `sessionId` is the source SDK session UUID (validated prior to fork by `authorizeSessionAccess` in `session-rpc.handlers.ts:1057` and metadata lookup at line 94; an SDK session cannot be forked by tab ID). `result.sessionId` is the newly created SDK session UUID returned by the SDK `forkSession` method.
- **Failure Paths**: If SDK `fork()` fails or `metadataStore.create()` fails, `recordLineage` is bypassed completely.

### (c) Type Compatibility (`WorktreeCreatedCallback`)

- In `libs/shared/src/lib/types/agent-adapter.types.ts:96-105`, `worktreePath?: string` is optional on the shared `IAgentAdapter.setWorktreeCreatedCallback` parameter.
- In `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:53-59`, `worktreePath: string` is required on the agent-sdk twin `WorktreeCreatedCallback`.
- **Assignability**: `SdkAgentAdapter` implements `IAgentAdapter`. When `setWorktreeCreatedCallback` is invoked (such as in `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:347`), callers receive `data` where `worktreePath` is guaranteed to be present as a concrete `string` at runtime because `WorktreeHookHandler` enforces `result.worktreePath` before calling the callback. The assignability is sound and typechecks cleanly with 0 TypeScript diagnostics without any type casts.

### (d) Never-Throw Contract & Exception Handling

- `ISessionOrganizationRecorder` specifies that recorder methods must never throw.
- Comparing with B3.2/B3.3 (`PtahAPIBuilder.recordWorktreeForCaller`), where the call was wrapped in `try ... catch` with debug logging: adding an error boundary in B1 would provide defense-in-depth against buggy recorder implementations. Classified as **Minor** (Finding 1) because the port contract guarantees never-throw behavior.

### (e) DI Registration Order (Risk R-TL11)

- Verified `apps/ptah-electron/src/di/phase-2-libraries.ts` (lines 194-393) and `libs/backend/cli-engine/src/lib/container.ts` (lines 640-716).
- `SDK_WORKTREE_HOOK_HANDLER` and `SDK_SESSION_FORK_SERVICE` are singletons registered in `registerSdkServices`.
- Between `registerSdkServices` and the subsequent Thoth/Phase-2 registration where `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` is bound:
  - In Electron: only `SDK_PROCESS_SPAWNER` and `SQLITE_CONNECTION` are resolved synchronously. Plugin loader lookups are wrapped in lazy resolver lambdas.
  - In CLI: `wireAgentAdapterAliases` registers a `useFactory` provider and does not resolve `SDK_AGENT_ADAPTER` eagerly.
- Neither service nor any dependent service is eagerly resolved before recorder registration.
- The registration order is currently safe, and Batch A5.1's planned smoke test (`container.smoke.spec.ts`) will pin this invariant.

### (f) Test Rigour & Vacuity Check

- `worktree-hook-handler.spec.ts`:
  - Directly exercises `createHooks(cb).WorktreeCreate[0].hooks[0]`.
  - Asserts exact parameters passed to `recorder.recordWorktree`.
  - Asserts `recorder.recordWorktree` is called _before_ `onCreated` via `mock.invocationCallOrder`.
  - Asserts negative cases: `addWorktree` reports failure, succeeds without path, or throws; verifies `recordWorktree` is not called.
  - Asserts behavior without a registered recorder (`withRecorder = false`).
- `session-fork.service.spec.ts`:
  - Directly executes `forkSession(...)`.
  - Asserts exact parameters passed to `recorder.recordLineage`.
  - Asserts `recordLineage` is called _after_ `metadataStore.create` via `mock.invocationCallOrder`.
  - Asserts fallback to `workspaceProvider.getWorkspaceRoot()` when source metadata is missing.
  - Asserts negative cases: SDK `fork` rejects, `metadataStore.create` rejects; verifies `recordLineage` is not called.
  - Asserts behavior when `recorder` is null (`withRecorder: false`).
- No tests pass vacuously; all assertions verify active state, execution order, and strict error rejection.

---

## Data Flow

1. **Worktree Creation**:
   - SDK triggers `WorktreeCreate` hook with `{ session_id, cwd, name }`.
   - `WorktreeHookHandler` resolves sibling worktree path under main repository root -> [OK].
   - Calls `gitInfo.addWorktree(cwd, { branch, path, createBranch: true })` -> [OK].
   - Checks `result.success && result.worktreePath`; throws if invalid -> [OK].
   - Calls `recorder?.recordWorktree({ sessionId, worktreePath, branch, workspaceRootHint })` -> [OK: SDK UUID used].
   - Invokes `capturedCreatedCallback({ sessionId, name, worktreePath, cwd, timestamp })` inside `try ... catch` -> [OK].
   - Returns `{ hookSpecificOutput: { hookEventName: 'WorktreeCreate', worktreePath }, continue: true }` -> [OK].

2. **Session Fork**:
   - Caller invokes `SessionForkService.forkSession({ sessionId, upToMessageId, title, kind })`.
   - Verifies session workspace path from `sourceMetadata.workspaceId` or `workspaceProvider.getWorkspaceRoot()` -> [OK].
   - SDK standalone `fork(sessionId, { upToMessageId, title, dir })` creates new session transcript -> [OK].
   - `metadataStore.create(result.sessionId, workspaceId, forkName, 'forked')` persists session row -> [OK].
   - Calls `recorder?.recordLineage({ sessionId: result.sessionId, forkOfSessionId: sessionId, workspaceRootHint })` -> [OK: both IDs are SDK UUIDs].
   - Emits info log and returns `result` (`{ sessionId }`) -> [OK].

---

## Requirements Fulfilment

| Requirement                                                                      | Status   | Gap  |
| -------------------------------------------------------------------------------- | -------- | ---- |
| Record worktree only on successful add (`worktree-hook-handler.ts:240`)          | COMPLETE | None |
| Record inside existing try, before callback (`worktree-hook-handler.ts:240-246`) | COMPLETE | None |
| Failed `addWorktree` records nothing                                             | COMPLETE | None |
| Hook return value unchanged                                                      | COMPLETE | None |
| `input.session_id` is SDK UUID, never tab ID                                     | COMPLETE | None |
| Agent-sdk callback type gains required `worktreePath: string`                    | COMPLETE | None |
| Record fork lineage after `metadataStore.create` (`session-fork.service.ts:149`) | COMPLETE | None |
| Use new SDK ID and source SDK ID for lineage                                     | COMPLETE | None |
| Fork result and error paths unchanged                                            | COMPLETE | None |
| Keep existing `Logger` instances (D15)                                           | COMPLETE | None |
| Optional DI injection of recorder port                                           | COMPLETE | None |

---

## Edge Cases

| Case                                                            | Handled | How                                                                 | Concern |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------- | ------- |
| Recorder token not bound (VS Code)                              | YES     | Evaluates to `null`; optional chaining skips calls safely           | None    |
| `addWorktree` returns `{ success: true }` but no `worktreePath` | YES     | Throws error at line 227; records nothing                           | None    |
| `addWorktree` throws                                            | YES     | Caught by outer try/catch and rethrown; records nothing             | None    |
| `onWorktreeCreated` callback throws                             | YES     | Isolated in internal try/catch; does not fail hook                  | None    |
| Source session has no `workspaceId` during fork                 | YES     | Falls back to active workspace root; throws if neither present      | None    |
| SDK `fork()` fails                                              | YES     | Caught by outer try/catch and rethrown as SdkError; records nothing | None    |
| `metadataStore.create` fails                                    | YES     | Caught by outer try/catch and rethrown as SdkError; records nothing | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: Unwrapped recorder invocations could theoretically bubble if a recorder implementation violates the never-throw contract (Finding 1, Minor).
- What a robust implementation would add: Wrap recorder calls in `try ... catch` with debug logging as defense-in-depth against non-conforming recorder implementations.
