VERDICT: APPROVED
Score: 9.5/10

# Code Logic Review — `TASK_2026_580_9f77` (Batch B3.2)

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

Batch B3.2 implements MCP worktree capture via the git namespace (`ptah_git_worktree_add`) and attributes created worktrees to the calling agent's SDK session (Implementation Plan Component 8 :775-801; Decisions D9 :140, D3 :134; Lane Rule L15 :1512).

Key logic verified:

1. **L15 / D9 Separation**: The shared change handler (`buildWorktreeChangeHandler`) only forwards `event.sessionId` to the `git:worktreeChanged` webview broadcast and records nothing. Recording occurs exclusively inside `buildGitNamespace.worktreeAdd` after `git worktree add` succeeds. This protects TASK_2026_584 child worktrees (which reuse the shared handler) from ever being attributed to the parent caller.
2. **SDK Session ID Isolation**: Tab IDs never reach the recorder. `resolveCallerSdkSessionId` queries `sdkSessionLifecycleManager.find(callerId)?.realSessionId` and returns only the real SDK UUID, returning `undefined` (and logging) if the caller has not resolved to an SDK session yet.
3. **Never-Throw Resiliency**: `captureForCaller` wraps resolution and recording in a `try ... catch { void 0; }` block, ensuring that an unexpected recorder or lifecycle error cannot convert a successful git worktree creation into an MCP failure.
4. **Test Verification**: 8 unit test cases in `git-namespace.builder.spec.ts` and 6 integration test cases in `ptah-api-builder.service.spec.ts` (using the real `buildGitNamespace` with mocked git execution). All 14 cases test non-vacuous assertions across happy paths, git failures, pre-git validation failures, missing callers, threw-recorder resilience, and handler isolation.
5. **Carried Nit Resolution**: The JSDoc on `GitWorktreeChangedNotification.sessionId` in `libs/shared/src/lib/types/rpc/rpc-git.types.ts:227-231` was accurately updated to document MCP agent worktree creation alongside SDK hooks. Monorepo MCP tool counts remain unchanged (56/53).

---

## Numbered Findings

### Finding 1 (Minor / Design Input for Batch A5) — Registration-order risk on constructor-injected `ISessionOrganizationRecorder`

- **Severity**: Minor (Design input for Batch A5 host wiring; not a defect in B3.2)
- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts:498-501`
- **Evidence**:
  ```ts
  @inject(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, { isOptional: true })
  private readonly sessionOrganizationRecorder?: ISessionOrganizationRecorder,
  ```
- **Context & Analysis**:
  `PtahAPIBuilder` is registered as a container singleton (`TOKENS.PTAH_API_BUILDER`). In Electron and CLI host bootstrapping, `registerSessionOrganizationServices(container)` is planned for Phase 2 (Component 9, lines 869-895: `phase-2-libraries.ts:393` and `register-thoth-libraries.ts:150`). `registerVsCodeLmToolsServices` runs in Phase 3 (Electron) and Phase 4 (CLI). In standard production startup, `PtahAPIBuilder` is first resolved during MCP server startup (`startCodeExecutionMcp` in `wire-runtime.ts:406`), which occurs well after Phase 2 completes.
  However, because `PtahAPIBuilder` captures `sessionOrganizationRecorder` at constructor instantiation time, if any test harness, CLI command mode (`bootstrapMode !== 'full'`), or startup refactor resolves `PtahAPIBuilder` (or `CodeExecutionMCP`) before Phase 2 finishes registering the recorder, `this.sessionOrganizationRecorder` will permanently remain `undefined` for the lifetime of the process.
- **Impact**: In standard production startup, there is no defect. If resolved early, worktree capture will silently be skipped.
- **Fix Options for Batch A5**:
  1. _Option A (Recommended / most resilient)_: Resolve lazily on invocation, or pass a lazy getter `() => container.isRegistered(PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, true) ? container.resolve(...) : undefined` (following the pattern of `SurfacePushHostProvider` in `libs/backend/vscode-lm-tools/src/lib/di/register.ts:121-126`).
  2. _Option B_: Register `PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER` earlier in container initialization (e.g. start of Phase 2).
  3. _Option C_: Retain constructor injection and pin the ordering with an explicit reachability test in `container.smoke.spec.ts` in Electron and CLI, verifying that resolving `PtahAPIBuilder` from the container yields a defined `sessionOrganizationRecorder`.

### Finding 2 (Nit) — Pre-existing error wrapping asymmetry on `onWorktreeChanged`

- **Severity**: Nit
- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts:186-193,221-230`
- **Evidence**:
  In `worktreeRemove` (:221-230):
  ```ts
  if (onWorktreeChanged) {
    try {
      onWorktreeChanged({ action: 'removed', worktreePath: params.path });
    } catch {
      void 0;
    }
  }
  ```
  In `worktreeAdd` (:186-193):
  ```ts
  if (onWorktreeChanged) {
    onWorktreeChanged({
      action: 'created',
      worktreePath,
      branch: params.branch,
      ...(sessionId ? { sessionId } : {}),
    });
  }
  ```
- **Context**: In `worktreeRemove`, calling `onWorktreeChanged` is guarded by an inner `try ... catch { void 0; }`. In `worktreeAdd`, `onWorktreeChanged` is called directly. If a custom or test callback threw synchronously, `worktreeAdd` would enter the outer `catch` block (:196) and return `{ success: false }` despite the worktree already having been created by `git`. In production, `buildWorktreeChangeHandler` catches promise rejections asynchronously and returns `void`, so this does not trigger in practice.
- **Impact**: None in production; minor inconsistency in defensive error isolation.
- **Fix**: Wrap `onWorktreeChanged` in `try { ... } catch { void 0; }` inside `worktreeAdd` to match `worktreeRemove`.

### Finding 3 (Nit) — `captureForCaller` swallows resolver errors without logging

- **Severity**: Nit
- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts:104-107`
- **Evidence**:
  ```ts
  } catch {
    // Recorder contract is never-throw; this guards a faulty implementation
    // so the successful add is still reported as one.
    void 0;
  }
  ```
- **Context**: `GitNamespaceDependencies` does not take a logger, keeping the namespace builder cleanly decoupled from logging implementations. `PtahAPIBuilder.recordWorktreeForCaller` already logs debug messages when the recorder is absent. However, if an unexpected exception occurs inside `resolveCallerSessionId()`, it is silently discarded without observability.
- **Impact**: None in normal operation; slight reduction in diagnostic visibility if a resolver defect occurs.

---

## Five Logic Questions

### 1. How does this fail silently?

- In `captureForCaller` (`git-namespace.builder.ts:98-107`), if `resolveCallerSessionId` or `recordWorktreeForCaller` throws, the exception is caught and discarded (`catch { void 0; }`). The caller still receives `{ success: true, worktreePath }`. This silent swallow is an intentional contract decision: git already created the worktree directory on disk, so metadata capture failure must never mislead the caller into thinking the filesystem operation failed.
- In `PtahAPIBuilder.recordWorktreeForCaller` (`ptah-api-builder.service.ts:1037-1051`), if `this.sessionOrganizationRecorder` is `undefined` (VS Code host), it logs a debug line and returns. The worktree is created, and `git:worktreeChanged` is broadcast with `sessionId`, but no SQLite record is written.
- In `PtahAPIBuilder.resolveCallerSdkSessionId` (`ptah-api-builder.service.ts:1015-1030`), if an MCP caller has no SDK session ID yet (e.g., initial tab ID before SDK resolution), it logs at `debug` level and returns `undefined`. Attribution is silently skipped.

### 2. What user action produces unexpected behaviour?

- **Immediate tool execution before session UUID resolution**: If an agent issues `ptah_git_worktree_add` before the tab ID is bound to a real SDK session ID in `SessionLifecycleManager`, `resolveCallerSdkSessionId()` yields `undefined`. The worktree is created on disk and in git, but it is not linked to the session in the organization database. When the session later binds its SDK ID, existing worktrees are not retroactively linked. This adheres to Lane Rule L8 (captures before resolution are dropped, not buffered).
- **Removing a worktree via `ptah_git_worktree_remove`**: Worktree deletion emits `git:worktreeChanged { action: 'removed' }`, but does not invoke `ISessionOrganizationRecorder` directly (as `ISessionOrganizationRecorder` only defines `recordWorktree`). Cleanup of stale records is handled by session deletion cascades (D7) or downstream metadata maintenance.

### 3. What input data produces a wrong answer?

- **Declared workspace root in MCP URL segment**:
  When `recordWorktreeForCaller` executes, it passes `workspaceRootHint: this.resolveSessionWorkspaceRoot()`. If an external caller supplied a custom workspace segment in the URL (`/workspace/...`), `resolveWorkspaceRootWithPrecedence` yields that segment. However, in `SessionOrganizationService` (Plan D3 :134 / Lane Rule L9 :1506), the service always checks `SessionMetadataStore.find(sessionId)?.workspaceId` _first_, using `workspaceRootHint` only when session metadata is absent. Therefore, caller-supplied URL data cannot corrupt the workspace key of an existing session.

### 4. What happens when a dependency fails?

- **Git failure**: If `git worktree add` returns a non-zero exit code or stderr, `buildGitNamespace` returns `{ success: false, error }` at line 180. `captureForCaller` is never called. Neither `recordWorktreeForCaller` nor `onWorktreeChanged` is invoked.
- **Path escaping**: If `params.path` is outside the workspace root, path validation fails before `runGit`. `captureForCaller` is never called.
- **Recorder throws**: If `recordWorktree` throws, `captureForCaller` catches the exception. `worktreeAdd` returns `{ success: true, worktreePath }` and `onWorktreeChanged` still fires.
- **Webview manager broadcast failure**: In `buildWorktreeChangeHandler`, `webviewManager.broadcastMessage` has a `.catch(error => { logger.error(...) })` handler, preventing unhandled promise rejections.

### 5. What is missing that the requirements never mentioned?

- Pre-existing asymmetry: `worktreeRemove` catches callback errors from `onWorktreeChanged`, while `worktreeAdd` does not (Finding 2).
- The requirements explicitly specified that `buildGitNamespace` must not log or pull in `IOutputChannel`, which necessitated the silent catch in `captureForCaller` (Finding 3).

---

## Evaluation of Executor Deviations

1. **Broadcasting `sessionId` without a registered recorder (VS Code)**:
   - _Behavior_: In `buildGitNamespace`, `captureForCaller` returns `sessionId` whenever `resolveCallerSessionId()` resolves, regardless of whether `recordWorktreeForCaller` is present. `buildWorktreeChangeHandler` forwards `event.sessionId` to `git:worktreeChanged`.
   - _Judgment_: **SOUND & ACCEPTABLE**. The webview notification `GitWorktreeChangedNotification` carries `sessionId?: string`. Even in VS Code where SQLite persistence is absent, the webview UI benefits from knowing which session created the worktree. This satisfies Decision D9 and JSDoc specifications without violating the VS Code persistence boundary.

2. **Passing `workspaceRootHint: this.resolveSessionWorkspaceRoot()`**:
   - _Behavior_: `recordWorktreeForCaller` passes `this.resolveSessionWorkspaceRoot()` as `workspaceRootHint`. This resolver can return a caller-declared root (MCP URL segment) if present.
   - _Judgment_: **SOUND & ACCEPTABLE**. In `ISessionOrganizationRecorder`, `workspaceRootHint?: string` is defined as an optional fallback. In `SessionOrganizationService` (Decision D3 :134 and Lane Rule L9 :1506), the session metadata `workspaceId` takes precedence over any hint. Supplying the session's resolved workspace root is the most accurate hint available when metadata is pending.

---

## Failure Modes

No active failure modes found.

- Scope examined: All 5 files under review, plus `SessionLifecycleManager.find`, `mcp-request-context.ts`, and host registration in Electron and CLI.
- Diagnostics: 0 errors across all modified projects (`@ptah-extension/vscode-lm-tools`, `@ptah-extension/shared`).

---

## Blocking Issues

None.

---

## Serious Issues

None.

---

## Moderate and Minor Issues

See Numbered Findings:

- Finding 1 (Minor / Design Input for Batch A5) — Registration-order risk on constructor injection of `ISessionOrganizationRecorder`.
- Finding 2 (Nit) — Pre-existing error wrapping asymmetry on `onWorktreeChanged`.
- Finding 3 (Nit) — `captureForCaller` swallows resolver errors without logging.

---

## Data Flow

1. Agent calls MCP tool `ptah_git_worktree_add({ branch, path })` via HTTP transport.
2. `HttpMcpServerService` wraps execution in `runWithMcpRequestContext({ callerSessionId: tabId })` -> [OK].
3. `PtahAPI.git.worktreeAdd` delegates to `buildGitNamespace.worktreeAdd(params)` -> [OK].
4. Workspace root check & path bounds check execute -> [OK: path escape rejected before git runs].
5. `runGit(['worktree', 'add', ...])` executes -> [OK: non-zero exit code halts flow immediately without attribution].
6. On git success, `captureForCaller(worktreePath, params.branch)` runs -> [OK].
7. `resolveCallerSessionId()` queries `getCallerSessionId()`, then `sdkSessionLifecycleManager.find(tabId)?.realSessionId` -> [OK: tab ID never returned; only real SDK UUID].
8. If resolved, `recordWorktreeForCaller({ sessionId, worktreePath, branch })` passes data to `ISessionOrganizationRecorder.recordWorktree` with `workspaceRootHint` -> [OK].
9. `onWorktreeChanged({ action: 'created', worktreePath, branch, sessionId })` fires -> [OK].
10. `buildWorktreeChangeHandler` forwards `event.sessionId` to `webviewManager.broadcastMessage('git:worktreeChanged', ...)` -> [OK: change handler records nothing, protecting child worktrees].

---

## Requirements Fulfilment

| Requirement                                                                                                         | Status   | Gap  |
| ------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| L15 / D9: Shared change handler records nothing, only forwards `sessionId` (`implementation-plan.md:797-801, 1512`) | COMPLETE | None |
| L15 / D9: Recording happens only inside git namespace `worktreeAdd` on success (`implementation-plan.md:790-795`)   | COMPLETE | None |
| Tab id never reaches recorder; only SDK UUID (`session-organization-recorder.interface.ts:8-10`)                    | COMPLETE | None |
| Failed add or unresolved caller records nothing                                                                     | COMPLETE | None |
| Never-throw resilience in `captureForCaller`                                                                        | COMPLETE | None |
| Carried JSDoc nit on `GitWorktreeChangedNotification.sessionId` updated (`rpc-git.types.ts:227-231`)                | COMPLETE | None |
| Monorepo MCP tool counts remain unchanged (56/53)                                                                   | COMPLETE | None |
| Unit and integration spec coverage (8 namespace cases, 6 builder cases)                                             | COMPLETE | None |

---

## Edge Cases

| Case                                                        | Handled | How                                                              | Concern |
| ----------------------------------------------------------- | ------- | ---------------------------------------------------------------- | ------- |
| Git worktree add command fails                              | YES     | Returns `{ success: false }`; skips capture & notification       | None    |
| Path rejected before git runs                               | YES     | Fails before `runGit`; skips capture & notification              | None    |
| Caller tab has no SDK session ID yet                        | YES     | Logs debug message; returns `undefined`; skips capture           | None    |
| Call outside MCP request context                            | YES     | `getCallerSessionId()` returns `undefined`; skips capture        | None    |
| No recorder registered (VS Code)                            | YES     | Logs debug message; returns `void`; worktree add succeeds        | None    |
| Recorder throws exception                                   | YES     | `catch { void 0; }` in `captureForCaller`; worktree add succeeds | None    |
| Shared change handler invoked directly (584 child worktree) | YES     | Handler only broadcasts; does not invoke recorder                | None    |
| Webview manager broadcast rejects                           | YES     | Caught via `.catch()` on broadcast promise                       | None    |

---

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: In Batch A5 (host wiring), ensure `registerSessionOrganizationServices` runs before `PtahAPIBuilder` is instantiated, or resolve `sessionOrganizationRecorder` lazily (Finding 1).
- What a robust implementation would add:
  1. Batch A5 host-wiring verification: implement Option A (lazy getter) or Option C (smoke spec assertion) to eliminate registration-order risk.
  2. Parity try/catch on `onWorktreeChanged` in `worktreeAdd` (Finding 2).
