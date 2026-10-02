VERDICT: APPROVED
SCORE: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch B3.3)

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 9.5/10   |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor / Nits        | 2        |
| Failure modes found | 0        |

Batch B3.3 implements the `PtahAPI.sessionOrganization` namespace builder (`session-organization-namespace.builder.ts`), wires it into `PtahAPIBuilder` (`ptah-api-builder.service.ts`), updates `PtahAPI` type definitions (`types.ts`), and resolves the two carried nits from Batch B3.2 in `git-namespace.builder.ts` (defensive wrapper for `onWorktreeChanged` and logging for resolver/recorder throws).

### Findings Table

| Finding                               | Severity | File:Line                                                                                                              | Description                                                                                                                                                                                                                                                                                                    | Concrete Fix                                                                                            |
| ------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1. Unwrapped `getWorkspaceRootHint()` | MINOR    | `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts:144` | `deps.getWorkspaceRootHint()` is called immediately before the `try ... catch` block wrapping `recorder.linkTask`. If a custom dependency throws, the exception escapes instead of degrading to `{ ok: false, error: 'link-failed' }`.                                                                         | Wrap `deps.getWorkspaceRootHint()` inside the `try` block or safely coalesce exceptions to `undefined`. |
| 2. Deferred B3.4 integration tests    | MINOR    | `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:1066`                                 | Builder-level tests verifying that a throwing recorder logs one debug line in `recordWorktreeForCaller` and that `ptahAPI.sessionOrganization.linkTask` passes SDK IDs inside `runWithMcpRequestContext` were deferred to B3.4 per `batches.md` (lines 1058-1067). Production implementation in B3.3 is sound. | Ensure Batch B3.4 includes the two builder-level tests in `ptah-api-builder.service.spec.ts`.           |

---

## Five Logic Questions

### 1. How does this fail silently?

- **Git worktree change notifications (`git-namespace.builder.ts:115-126`)**: If the `onWorktreeChanged` callback throws synchronously, `notifyWorktreeChanged` catches the exception and discards it. The user still receives `{ success: true, worktreePath }`. This silent swallow is intentional and correct: git already created/removed the worktree on disk, so a downstream UI notification failure must not mislead the caller into believing the filesystem operation failed.
- **Worktree caller capture (`git-namespace.builder.ts:94-109`)**: If `resolveCallerSessionId` or `recordWorktreeForCaller` fails, `captureForCaller` catches the exception, and `worktreeAdd` proceeds to return `{ success: true, worktreePath }`.
- **Recorder drop on unavailable database (`session-organization-namespace.builder.ts:145-152`)**: A return value of `{ ok: true, sessionId, taskId, role }` indicates that the request was successfully validated and handed off to `recorder.linkTask(...)`. By port contract (`ISessionOrganizationRecorder`), if the underlying SQLite database is closed or in a boot window, the recorder logs and drops the write rather than throwing.
- **Unattributed caller (`ptah-api-builder.service.ts:1026-1044`)**: If the MCP caller tab ID has not resolved to an SDK session UUID in `sdkSessionLifecycleManager`, a debug log is emitted and `undefined` is returned. In `sessionOrganization.linkTask`, this produces an explicit `{ ok: false, error: 'unattributed-caller' }` result rather than a silent failure.

### 2. What user action produces unexpected behaviour?

- **Agent calls `ptah_session_link_task` before SDK ID resolution**: If an agent issues `ptah_session_link_task` in the window before the tab ID has been bound to a real SDK session ID, `resolveCallerSdkSessionId()` yields `undefined`. The caller receives `{ ok: false, error: 'unattributed-caller', message: 'The calling session has no SDK session id yet...' }`. The agent must wait or retry.
- **Calling `ptah_session_link_task` on VS Code**: VS Code does not register `ISessionOrganizationRecorder`. The call returns `{ ok: false, error: 'organization-unavailable', message: 'Session organization is not available on this host.' }`. The tool degrades gracefully without error propagation.
- **Linking to a non-existent task folder**: If the agent provides a task ID that adheres to `TaskIdRefSchema` (e.g. `TASK_9999_NONEXISTENT`) but has no matching folder in `.ptah/specs/`, the link is recorded successfully. Per AC6 design, missing task folders are resolved on read by `session:list`, which marks them with `missing: true`.

### 3. What input data produces a wrong answer?

- **Path traversal or malformed task IDs**: If an agent passes a path traversal (`../escape`), nested segments (`a/b`), an empty string, or non-string values, `SessionLinkTaskArgsSchema` rejects the input immediately at the Zod boundary with `error: 'invalid-args'`.
- **Caller-supplied `sessionId`**: If an agent attempts to forge or pass a `sessionId` argument (e.g. `{ taskId: 'TASK_1', sessionId: 'fake' }`), the `.strict()` schema rejects the extraneous key with `error: 'invalid-args'`. The target session is strictly determined by the transport context.
- **Invalid roles**: Any role outside `['primary', 'related']` (e.g. `'owner'`) is rejected by `z.enum(SESSION_TASK_LINK_ROLES)` with `error: 'invalid-args'`.

### 4. What happens when a dependency fails?

- **Recorder throws an error**: If `recorder.linkTask` throws (violating its never-throw contract), `session-organization-namespace.builder.ts:153-159` catches the exception and returns `{ ok: false, error: 'link-failed', message: error.message }`. The error is isolated and does not crash the namespace or host.
- **`sdkSessionLifecycleManager.find()` throws**: In `PtahAPIBuilder.resolveCallerSdkSessionId` (`ptah-api-builder.service.ts:1030-1039`), the call is wrapped in `try ... catch`. It logs a debug line and returns `undefined`, leading to `{ ok: false, error: 'unattributed-caller' }`.
- **Git operation fails**: If `runGit` exits with non-zero or throws an error, `worktreeAdd` returns `{ success: false, error }`. Neither `captureForCaller` nor `notifyWorktreeChanged` is invoked.
- **`onWorktreeChanged` listener throws**: Wrapped in `try ... catch` inside `notifyWorktreeChanged` (`git-namespace.builder.ts:121-125`). The git operation's `{ success: true }` return is preserved.

### 5. What is missing that the requirements never mentioned?

- **Synchronous `getWorkspaceRootHint()` guard**: `deps.getWorkspaceRootHint()` at line 144 is invoked right before the `try` block. Wrapping it inside the `try` block would be even more defensive against unexpected getter failures (Finding 1).
- **Tool description & dispatcher case**: As planned in `batches.md`, the MCP tool `ptah_session_link_task`, the protocol dispatcher case, and help text in `system-namespace.builders.ts` are deferred to Batch B3.4 to maintain the 6-file batch size limit.

---

## Failure Modes

No unhandled failure modes found.

- Scope examined: All 6 files in Batch B3.3, plus `SessionLifecycleManager.find`, `TaskIdRefSchema`, and `ISessionOrganizationRecorder`.
- Diagnostics: 0 TypeScript typecheck errors, 0 ESLint errors.
- Verification: 43 unit tests passing in `@ptah-extension/vscode-lm-tools`.

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

- **Finding 1 (Minor)** — `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/session-organization-namespace.builder.ts:144`: `const workspaceRootHint = deps.getWorkspaceRootHint();` sits outside the `try ... catch` block. While `resolveSessionWorkspaceRoot()` is currently safe, placing all dependency calls inside the error boundary prevents future regressions.
- **Finding 2 (Minor)** — `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:1066`: Builder-level test cases for recorder throw logging and `runWithMcpRequestContext` integration with `sessionOrganization.linkTask` are deferred to B3.4 per plan.

---

## Data Flow

1. **MCP / Code Execution Call**: Agent invokes `ptahAPI.sessionOrganization.linkTask(args)`.
2. **Input Validation**: `SessionLinkTaskArgsSchema.safeParse(args)` validates `taskId` (`TaskIdRefSchema`) and optional `role` (`primary` \| `related`). Fails with `{ ok: false, error: 'invalid-args' }` on bad shape or extra keys -> [OK].
3. **Recorder Availability Check**: `deps.getRecorder()` resolves `this.sessionOrganizationRecorder`. If absent (VS Code host), returns `{ ok: false, error: 'organization-unavailable' }` -> [OK].
4. **Caller Attribution**: `deps.resolveCallerSessionId()` retrieves `callerId` via `getCallerSessionId()`, then resolves to SDK UUID via `sdkSessionLifecycleManager.find(callerId)?.realSessionId`. If unresolved or throwing, returns `{ ok: false, error: 'unattributed-caller' }` -> [OK: tab IDs never reach recorder].
5. **Execution**: Calls `recorder.linkTask({ sessionId, taskId, role, source: 'agent', workspaceRootHint })`.
6. **Exception Isolation**: Caught exceptions map to `{ ok: false, error: 'link-failed', message }` -> [OK: never throws].
7. **Success Return**: Returns `{ ok: true, sessionId, taskId, role }` -> [OK].
8. **Git Worktree Add & Notification**: In `buildGitNamespace.worktreeAdd`, `notifyWorktreeChanged` safely wraps `onWorktreeChanged` so listener errors never fail the command -> [OK].

---

## Requirements Fulfilment

| Requirement                                                                                    | Status   | Gap  |
| ---------------------------------------------------------------------------------------------- | -------- | ---- |
| `PtahAPI.sessionOrganization` namespace builder with `linkTask` (`batches.md:993-1011`)        | COMPLETE | None |
| Zod validation with `TaskIdRefSchema` and default role `primary` (`batches.md:1004`)           | COMPLETE | None |
| Caller resolved to SDK session ID from transport context, never from args (`batches.md:1005`)  | COMPLETE | None |
| Unresolvable caller returns `{ ok: false, error: 'unattributed-caller' }` (`batches.md:1006`)  | COMPLETE | None |
| Absent recorder returns `{ ok: false, error: 'organization-unavailable' }` (`batches.md:1007`) | COMPLETE | None |
| `source: 'agent'` hardcoded (`batches.md:1008`)                                                | COMPLETE | None |
| Non-throwing execution with `{ ok: false, error: 'link-failed' }` on throw (`batches.md:1072`) | COMPLETE | None |
| Worktree change notification isolated in `worktreeAdd` (`batches.md:1018-1020`)                | COMPLETE | None |
| Worktree capture resolver/recorder errors caught and logged (`batches.md:1021-1026`)           | COMPLETE | None |
| Full typecheck & test suite passing                                                            | COMPLETE | None |

---

## Edge Cases

| Case                                           | Handled | How                                                                                   | Concern |
| ---------------------------------------------- | ------- | ------------------------------------------------------------------------------------- | ------- |
| `args` is `null` or `undefined`                | YES     | `args ?? {}` passed to `safeParse`; returns `invalid-args`                            | None    |
| Extraneous fields in `args` (e.g. `sessionId`) | YES     | `.strict()` on schema rejects unexpected keys                                         | None    |
| `taskId` contains path traversal (`../`)       | YES     | `TaskIdRefSchema` enforces single path segment                                        | None    |
| `role` omitted                                 | YES     | Defaults to `'primary'`                                                               | None    |
| Host has no recorder (VS Code)                 | YES     | Returns `{ ok: false, error: 'organization-unavailable' }`                            | None    |
| Caller has not yet bound real SDK ID           | YES     | Returns `{ ok: false, error: 'unattributed-caller' }`                                 | None    |
| `SessionLifecycleManager.find()` throws        | YES     | Caught in `resolveCallerSdkSessionId`, logs debug, returns `undefined`                | None    |
| `recorder.linkTask` throws                     | YES     | Caught in `linkTask`, returns `{ ok: false, error: 'link-failed' }`                   | None    |
| `onWorktreeChanged` throws on add              | YES     | Caught in `notifyWorktreeChanged`; `worktreeAdd` still returns `{ success: true }`    | None    |
| `onWorktreeChanged` throws on remove           | YES     | Caught in `notifyWorktreeChanged`; `worktreeRemove` still returns `{ success: true }` | None    |
| `runGit` fails on worktree add/remove          | YES     | Returns `{ success: false, error }`; notifications skipped                            | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: None in Batch B3.3 code; ensure B3.4 completes the builder-level tests deferred from this batch.
- What a robust implementation would add:
  1. Wrap `deps.getWorkspaceRootHint()` inside the `try` block in `session-organization-namespace.builder.ts:144` (Finding 1).
  2. Implement the deferred builder-level tests in Batch B3.4 (`ptah-api-builder.service.spec.ts`).
