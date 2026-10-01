# Batch 5 — GitInfoService Facade B, Write Lock, Hook Runner & Timeout Hardening (`TASK_2026_576_e16a`)

- **Author**: in-process subagent (`backend-developer`)
- **Reviewer**: CLI lane (`antigravity`), cross-side
- **Round**: 0
- **Score**: 5/10
- **Verdict**: CHANGES_REQUIRED

---

## Summary

| Metric              | Value                             |
| ------------------- | --------------------------------- |
| Overall score       | 5/10                              |
| Assessment          | CHANGES_REQUIRED (NEEDS_REVISION) |
| Blocking issues     | 2                                 |
| Serious issues      | 2                                 |
| Moderate issues     | 2                                 |
| Failure modes found | 4                                 |

Batch 5 implements the core write lock (`GitRepoWriteLock`), the hook-aware commit runner (`GitCommitRunner`), timeout classifications, own `index.lock` recovery (`GitCommitKillGuard`), and RPC handler pass-through for `HOOK_FAILED`, `hookOutput`, `exitCode`, and mutation codes (`TIMEOUT`, `CANCELLED`, `LOCKED`).

While the write-lock scoping across mutation methods, the atomicity of the `applyHunks` ladder, the bigint lock fingerprinting, and the handler pass-through are well-designed and verified, there are **two critical blocking defects**:

1. **Windows kill order in `exec-git.ts` breaks RC2 / Requirement 1.3**: `terminate()` calls `child.kill('SIGTERM')` before `killProcessTree(pid)`. On Windows, killing `git.exe` first means subsequent `taskkill /pid <pid> /T /F` cannot find `<pid>`, leaving hook processes (`sh.exe`, `sleep.exe`, scripts) running as background orphans. If a hook hangs, `onExit` never fires, causing `recoverIndexLock` to time out and leave `.git/index.lock` permanently held.
2. **Real-git test failure in `git-info.service.hooks.real-git.spec.ts`**: The test suite fails on Windows (`logger.warn` assertion receives 0 calls instead of the expected recovery log, and `afterAll` crashes with `EPERM` trying to delete temporary directories because orphaned child processes from earlier hook tests still hold file handles).

Additionally, `git-info.service.ts` expanded by **+102 net lines**, breaching the plan's line ceiling (net delta $\le 0$), and `onExit` in `exec-git.ts` has zero unit test coverage in `exec-git.spec.ts`.

---

## Five Logic Questions

### 1. How does this fail silently — where does a failure produce a success-looking result?

- **Orphaned hook processes on Windows during abort / timeout** ([`exec-git.ts:762-772`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L762-L772)): When a commit times out or is cancelled, `terminate()` immediately invokes `child.kill('SIGTERM')`. On Windows, this terminates `git.exe` via `TerminateProcess`. When `killProcessTree` runs asynchronously via `child.whenSpawned.then(pid => ...)`, `taskkill /pid <pid> /T /F` fails with `ERROR: The process with PID <pid> not found`. The child shell and hook processes continue executing in the background unnoticed. If the hook held `.git/index.lock`, `recoverIndexLock` waits for `onExit` which never arrives until the orphaned hook completes. If the hook is hung, `waitForExit` times out after 5 s, logs a warning, leaves the lock file on disk, and the next git operation fails with `LOCKED`.
- **POSIX non-executable hook misclassification** ([`git-commit-runner.ts:301-317`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-commit-runner.ts#L301-L317)): `hasCommitHook` checks `stats.isFile()`. On Linux/macOS, if an inactive or non-executable file exists at `.git/hooks/pre-commit` (e.g. mode `0644`), git ignores it and runs the commit normally. If git refuses the commit for a standard reason (e.g., empty commit message or unmerged conflicts), `hasCommitHook` returns `true`, and Ptah misclassifies the failure as `HOOK_FAILED` rather than `GIT_ERROR`.

### 2. What user action produces unexpected behaviour?

- **Cancelling a slow or hung pre-commit hook on Windows**: The user clicks Cancel (or an abort signal is fired). Ptah reports `CANCELLED`, but on Windows the underlying hook (`sh.exe`, `sleep`, linters) is not killed. The background process continues running, holding file handles in the repository. If the user immediately tries to modify files or run git commands, they encounter Windows file-locking `EPERM` errors or persistent lock contention.
- **Triggering a commit while `workspaceRoot` is resolving in the UI**: In the Electron frontend, if a commit is submitted before `gitStatus.activeWorkspacePath()` has settled, `source-control-panel.component.ts` stores feedback and message drafts under key `''`. Once the workspace path updates, the draft and feedback disappear from view, leaving the commit button disabled and the feedback block hidden.

### 3. What input data produces a wrong answer rather than an error?

- **Git hook with non-standard line endings or non-executable attributes on POSIX**: A hook file without execute permissions (`+x`) on POSIX produces `stats.isFile() === true` in `hasCommitHook`, causing normal commit failures to return `HOOK_FAILED` with misleading error envelopes.

### 4. What happens when a dependency fails, times out, or returns a shape it should not?

- **Git times out during a commit**: `GitCommitKillGuard` registers a timeout for `GIT_HOOK_TIMEOUT_MS`. If `execGit` times out, `abort()` terminates git and rejects with `GitTimeoutError`. `GitCommitRunner` catches it, identifies `reason === 'TIMEOUT'`, runs `recoverIndexLock()`, and returns `{ success: false, code: 'TIMEOUT', error: '...' }`.
- **Another process holds `index.lock`**: `execWrite` in `GitRepoWriteLock` catches `isIndexLockFailure(stderr)` and executes 5 retries with exponential backoff (100, 200, 400, 800, 1600 ms, summing 3,100 ms). If the lock persists, it returns `{ success: false, code: 'LOCKED', message: GIT_LOCKED_MESSAGE }` without leaking stderr. `applyHunks` maps this to `{ success: false, code: 'APPLY_FAILED', error: 'Another git process is using this repository. Nothing was changed.' }`.

### 5. What is missing that the requirements never mentioned?

- **Process-tree termination order on Windows**: Requirement 1.3 states that a cancel or timeout during a hook must not leave `index.lock` behind. It did not mention the Windows process-tree kill requirement: `taskkill /T` requires the parent process to be alive while finding descendants. Calling `child.kill()` first breaks process tree reaping.
- **Unit test coverage for `onExit`**: `exec-git.ts` added `onExit?: () => void` to `ExecGitOptions`, but `exec-git.spec.ts` has zero tests asserting that `onExit` is called on child process exit, called after timeout/cancel, or safely handles exceptions thrown by the callback.

---

## Points Judged Explicitly

### 1. Lock Scope Correctness

- **Every mutation is one `writeLock.run()` body**:
  - `stageFiles`: Wraps `execWrite(['add', ...])` in `this.writeLock.run()`.
  - `unstageFiles`: Wraps `execWrite(['reset', 'HEAD', ...])` in `this.writeLock.run()`.
  - `discardChanges`: Wraps `this.discardClassified(workspacePath, paths)` in `this.writeLock.run()`.
  - `commit`: Wraps `this.commitRunner.run(...)` in `this.writeLock.run()`.
  - `checkout`: Wraps status check and `execWrite(['checkout', ...])` in `this.writeLock.run()`.
  - `applyHunks`: Wraps `this.applyHunksLocked(...)` in `this.writeLock.run()`.
  - `stashApply` / `stashPop` / `stashDrop`: Inside `stashMutate`, wraps verification and `execWrite(['stash', ...])` in `this.writeLock.run()`.
  - `pull`: Wraps `execWrite(['pull', '--ff-only'], ...)` in `this.writeLock.run()`.
- **Push, fetch, and worktree operations remain unlocked**:
  - `push`: Uses plain `this.execGit(['push', ...])` with `GIT_HOOK_TIMEOUT_MS`. Unlocked.
  - `fetch`: Uses plain `this.execGit(['fetch', '--prune'])` with `GIT_FETCH_TIMEOUT_MS`. Unlocked.
  - `addWorktree` / `removeWorktree`: Uses plain `this.execGit(['worktree', ...])` with `WORKTREE_GIT_TIMEOUT_MS`. Unlocked.
- **No nested locked calls**: Internal helpers (`applyWrite`, `writeIndexTree`, `restoreIndexTree`, `discardClassified`, `classifyForDiscard`) call `writeLock.execWrite` directly without re-invoking `writeLock.run()`. Reentrance is avoided.
- **MOD-1 (await all started work)**: In `applyHunksLocked`, every branch (`isGitRepo`, `diffFile`, `exists`, `readFileBytes`, `writeIndexTree`, `check`, `restoreAfterFailedApply`, `applyWrite`) is strictly awaited sequentially. There are no unawaited promises, floating timers, or asynchronous callbacks.
- **Batch 4 carry-over (discardChanges scope)**: `discardChanges` wraps `discardClassified` in a single `writeLock.run()` call. `classifyForDiscard` and both status reads run inside the lock before any checkout/restore/clean steps occur, completely closing the race between classification and discard.

### 2. index.lock Recovery (V7 / R5)

- **Bigint fingerprinting**: `IndexLockFingerprint` uses `bigint` for `mtimeMs`, `size`, and `ino`. `fs.statSync(lockPath, { bigint: true })` avoids 32-bit truncation on Windows.
- **`isSameIndexLock`**: Compares `mtimeMs` and `size`, and checks `ino` only when non-zero (`a.ino === 0n || b.ino === 0n || a.ino === b.ino`), properly handling Windows filesystems where `ino` is 0.
- **Five removal conditions in `GitCommitKillGuard.recoverIndexLock`**:
  1. Commit was killed by Ptah (`TIMEOUT` or `CANCELLED`) and lock was fingerprinted before kill.
  2. First attempt (`exitsBefore === 0`), verifying the commit did not retry against an already-existing foreign lock.
  3. `mtimeMs + MTIME_GRANULARITY_MS >= startedAtMs`, verifying the lock does not predate this commit.
  4. Process tree was seen to exit (`waitForExit(exitsBefore)`).
  5. Fingerprint matches current on-disk fingerprint (`isSameIndexLock`).
- **Protection against foreign locks**: Conditions 2, 3, and 5 prevent deleting a lock owned by another process.
- **Real-git behavior**: Plain `git commit -m` releases `index.lock` before executing hooks, whereas `commit -a` and pathspec commits hold `index.lock` throughout hook execution.

### 3. Windows Kill Order in `exec-git.ts`

- **Defect details**: In [`exec-git.ts:762-772`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L762-L772):
  ```ts
  const terminate = (): void => {
    child.kill('SIGTERM');
    void child.whenSpawned.then((pid) => {
      if (!exited && pid !== undefined) void killProcessTree(pid);
    });
    armReleaseGrace(() => {
      if (!child.isKilled()) child.kill('SIGKILL');
    });
  };
  ```
  On Windows, `child.kill('SIGTERM')` calls `TerminateProcess` immediately. By the time `whenSpawned` runs in a microtask, `git.exe` is already dead. `taskkill /pid <pid> /T /F` cannot find `<pid>` and therefore cannot traverse its process tree.
- **Impact on Requirement 1.3**: Orphaned child processes (`sh.exe`, `sleep.exe`) continue running in the background. The lock recovery logic waits for `onExit`, but `child.on('close')` is blocked because the orphaned processes hold stdio pipes open. When the 2 s `FORCED_KILL_GRACE_MS` expires, `release()` runs without `onExit`. `recoverIndexLock` times out after 5 s with `"the killed git process was not seen to exit"`, and the lock file is left behind.
- **Severity**: **BLOCKING**. The author flagged this as "out of scope", but RC2 explicitly requires that timeouts/cancels during hooks leave no running hooks and no `.git/index.lock`. This must be fixed in Batch 5.

### 4. `onExit` Option in `exec-git.ts`

- **Correctness**: `onExit` is called upon child `close` event inside `runGitChild` and is wrapped in a `try/catch` block.
- **Defect**: It is not called if `FORCED_KILL_GRACE_MS` expires without a close.
- **Missing Spec**: No unit test exists in `exec-git.spec.ts` covering `onExit`.

### 5. Line Budget for `git-info.service.ts`

- **Growth**: Net **+102 lines** (+299 / -197).
- **Plan Requirement**: Net line delta $\le 0$.
- **Finding**: The growth is not justified. Helper functions (`writeOutcome`, `thrownOutcome`, `MutationOutcome`, `IndexLockedError`, `remoteOutcome`, `remoteThrew`) can be moved into `git-write-lock.ts` or `git-commit-runner.ts` to keep `git-info.service.ts` within budget.

### 6. Result Codes & Pass-Through

- `HOOK_FAILED`: Returns `hookOutput` (stdout + stderr), `exitCode`, and `error`.
- `GIT_ERROR`: Used when git exits non-zero and no commit hook is present.
- `TIMEOUT` / `CANCELLED`: Correctly mapped in `GitCommitRunner` and `thrownOutcome`.
- Root and detached commits: Correctly query `rev-parse --short HEAD` and `log -1 --format=%s`.
- Handler pass-through: `git-rpc.handlers.spec.ts` verifies that `HOOK_FAILED`, `hookOutput`, `exitCode`, and error codes pass through `git:commit` and `git:stage` untouched.

### 7. R6 Start Delay & MOD-2 Cancel Bound

- **R6 start delay**: Measured at **198 ms** and **204 ms** in local test runs (well within the $\le 1000\text{ ms}$ threshold; no background gate lane needed).
- **MOD-2 cancel bound**: Max backoff step is 1,600 ms, bounding cancel latency during retries to $\le 1.6\text{ s}$.

### 8. Real-Git Specs Soundness & CI Filter

- **Test failure on Windows**: `git-info.service.hooks.real-git.spec.ts` fails on Windows:
  1. `GitCommitKillGuard › a kill of commit -a mid-hook ends with no index.lock (recovered by Ptah on Windows)`: `expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('left by a commit Ptah stopped (CANCELLED)'))` fails because `logger.warn` received 0 calls. (Git on Windows cleaned up its own lock on termination or lock was null, but the test hardcoded the expectation of Ptah's warning).
  2. `afterAll` failed with `EPERM` trying to clean up temp directories because orphaned hook processes were still running.
- **CI filter**: The `[slow]` naming matches `.github/workflows/ci.yml:342-358` (`--testNamePattern='^(?!.*\[slow\]).*$'`).

---

## Blocking Issues

### BLK-1: Inverted Process Kill Order in `exec-git.ts` Breaks Hook Cancellation on Windows (RC2 / Req 1.3)

- **File**: [`libs/backend/vscode-core/src/utils/exec-git.ts:762-772`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L762-L772)
- **Scenario**: When a commit times out or is cancelled during a hook execution on Windows.
- **Impact**: `child.kill('SIGTERM')` kills `git.exe` immediately. When `killProcessTree` runs asynchronously, `taskkill` fails because the root PID no longer exists. Descendant processes (`sh.exe`, `sleep.exe`) keep running in the background. If the hook hangs, `index.lock` is not removed, and temporary repository directories cannot be deleted (`EPERM`).
- **Fix**: In `terminate()`, invoke `killProcessTree(pid)` first on Windows before calling `child.kill()`, or ensure `killProcessTree` runs synchronously with known PID before terminating the parent.

### BLK-2: Real-Git Hook Spec Fails on Windows

- **File**: [`libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts:346`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts#L346)
- **Scenario**: Running `npx nx test vscode-core --testFile=git-info.service.hooks.real-git.spec.ts`.
- **Impact**:
  1. `logger.warn` assertion fails with 0 calls in test `a kill of commit -a mid-hook ends with no index.lock (recovered by Ptah on Windows)`.
  2. `afterAll` teardown throws `EPERM: operation not permitted` on temp directory deletion due to orphaned hook processes.
- **Fix**: Resolve BLK-1 to ensure hooks are killed; adjust the test expectation to allow for git cleaning its own lock when applicable or ensure Ptah's recovery branch is deterministically tested.

---

## Serious Issues

### SER-1: Net Line Growth in `git-info.service.ts` Exceeds Plan Line Budget (+102 lines)

- **File**: [`libs/backend/vscode-core/src/services/git-info.service.ts:108-145`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.ts#L108-L145)
- **Scenario**: `git-info.service.ts` grew net +102 lines (+299 / -197).
- **Impact**: Violates the plan ceiling requirement ($\le 0$ net lines) in a 3,259-line file.
- **Fix**: Move `writeOutcome`, `thrownOutcome`, `MutationOutcome`, `IndexLockedError`, and remote outcome helpers into `git-write-lock.ts` or `git-commit-runner.ts`.

### SER-2: Missing Unit Test Coverage for `onExit` in `exec-git.spec.ts`

- **File**: [`libs/backend/vscode-core/src/utils/exec-git.spec.ts`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.spec.ts)
- **Scenario**: `onExit` callback added to `ExecGitOptions`.
- **Impact**: Zero unit tests verify that `onExit` is called upon child close, called when killed after timeout/abort, and resilient to thrown errors.
- **Fix**: Add unit tests in `exec-git.spec.ts` asserting `onExit` invocation across standard, timeout, and abort execution paths.

---

## Moderate and Minor Issues

### MOD-1: Non-Executable Hook File Misclassification on POSIX

- **File**: [`libs/backend/vscode-core/src/services/git/git-commit-runner.ts:310`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-commit-runner.ts#L310)
- **Detail**: `hasCommitHook` tests `stats.isFile()`, ignoring whether the file is executable. On POSIX, a non-executable hook script will cause unrelated commit errors to be classified as `HOOK_FAILED`. Check `(stats.mode & 0o111) !== 0` on POSIX platforms.

### MOD-2: E2E Spec `commit-hook-failure.spec.ts` Fails in Electron Runtime

- **File**: [`apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts:112`](file:///D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts#L112)
- **Detail**: E2E test times out after 60s waiting for `getByRole('log', { name: 'Commit hook output' })`. Evidence indicates the commit button became disabled and message cleared without feedback rendered. Per `batches.md:428`, evidence points at the panel's `workspaceRoot` map key handling (`SourceControlPanelComponent`), which belongs to frontend Task 7.1.

---

## Failure Modes

### FM-1: Windows Kill Inversion Leaves Orphaned Hook Processes & Leaked index.lock

- **Trigger**: Timeout or abort during hook execution on Windows.
- **Symptom**: `sh.exe`/`sleep.exe` remain running; subsequent file/git operations fail with `EPERM` or `LOCKED`.
- **Evidence**: [`exec-git.ts:763-767`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L763-L767).
- **Current handling**: Calls `child.kill('SIGTERM')` before `killProcessTree`.
- **Recommendation**: Tree-kill before signaling the parent on Windows.

### FM-2: Test Suite Failure in `git-info.service.hooks.real-git.spec.ts`

- **Trigger**: Running real-git hook test suite on Windows.
- **Symptom**: Test fails on `logger.warn` assertion (0 calls), followed by `afterAll` `EPERM` crash.
- **Evidence**: [`git-info.service.hooks.real-git.spec.ts:346`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts#L346).
- **Current handling**: Hardcoded assertion that Ptah removed the lock on Windows.
- **Recommendation**: Fix process tree reaping and align test assertions with real git cleanup behavior.

### FM-3: Missing `onExit` Unit Spec in `exec-git.spec.ts`

- **Trigger**: Changes or regressions to `onExit` lifecycle.
- **Symptom**: Untested callback behavior across process exit states.
- **Evidence**: [`exec-git.spec.ts`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.spec.ts).
- **Recommendation**: Add unit test cases for `onExit`.

### FM-4: Non-Executable Hook Misclassification on POSIX

- **Trigger**: Non-executable hook file in `.git/hooks/`.
- **Symptom**: Unrelated git errors reported as `HOOK_FAILED`.
- **Evidence**: [`git-commit-runner.ts:310`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-commit-runner.ts#L310).
- **Recommendation**: Validate file execution permission on non-Windows systems.

---

## Data Flow

1. **RPC Entry (`git:commit`)**: Client invokes `git:commit` with `message` and optional `workspaceRoot`. -> **OK**
2. **Root Resolution**: `resolveRoot` checks if requested workspace is registered. -> **OK**
3. **Service Call**: `gitInfo.commit(wsRoot, message)` acquires `writeLock.run(workspacePath)`. -> **OK**
4. **Commit Execution**: `commitRunner.run(...)` initializes `GitCommitKillGuard`, executes `writeLock.execWrite(['commit', '-m', message])`. -> **OK**
5. **Hook Failure Path**: On non-zero exit, `hasCommitHook` queries `rev-parse --git-path hooks`. -> **GAP (MOD-1)** (does not check executable bit on POSIX).
6. **Cancellation / Timeout Path**: Guard triggers abort. `exec-git` calls `terminate()`. -> **GAP (BLK-1)** (parent killed before tree on Windows).
7. **Lock Recovery**: Guard awaits `onExit` and removes unchanged lock file matching fingerprint. -> **OK (logic sound, but blocked by BLK-1 on Windows)**.
8. **RPC Response**: `git:commit` handler passes through `code`, `hookOutput`, `exitCode`, and `error` unchanged. -> **OK**

---

## Requirements Fulfilment

| Requirement                                                                           | Status   | Gap                                                                                   |
| ------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| **RC1 / Req 1.2** (Hook failure returns hook output, exit code, message preserved)    | COMPLETE | Verified in `git-rpc.handlers.spec.ts` and `git-info.service.hooks.real-git.spec.ts`  |
| **RC2 / Req 1.3** (60s hook completes; cancel/timeout leaves no lock or running hook) | PARTIAL  | Broken on Windows due to kill order inversion in `exec-git.ts` (BLK-1)                |
| **RC6 / Req 1.8** (Serialized mutations via write lock, bounded index.lock retry)     | COMPLETE | Verified in `git-info.service.write-lock.real-git.spec.ts` (3/3 pass)                 |
| **V7** (Bigint fingerprint, non-zero ino comparison)                                  | COMPLETE | Implemented in `git-commit-runner.ts` (`readIndexLockFingerprint`, `isSameIndexLock`) |
| **R6** (Start delay measured)                                                         | COMPLETE | Measured at 198 ms and 204 ms (well below 1,000 ms threshold)                         |
| **MOD-1** (Await all started work in locked body)                                     | COMPLETE | Verified in `applyHunksLocked` and `discardClassified`                                |
| **Batch 4 Carry-Over** (discardChanges single lock scope)                             | COMPLETE | `discardChanges` wraps classification and all steps in one `writeLock.run()`          |
| **Dependency Validation** (`node:async_hooks`)                                        | COMPLETE | Verified `ptah-electron:validate-deps` passes                                         |
| **Line Budget** (`git-info.service.ts` net delta $\le 0$)                             | FAILED   | Net growth of +102 lines (SER-1)                                                      |

---

## Verified

- [x] `GitRepoWriteLock` integrates cleanly into `git-info.service.ts`: stage, unstage, discard, commit, checkout, applyHunks, stash mutations, and pull are each wrapped in a single `writeLock.run()` body.
- [x] Push, fetch, and worktree operations (`addWorktree`, `removeWorktree`) remain properly unlocked.
- [x] `applyHunks` ladder is fully awaited sequentially; `IndexLockedError` is caught and mapped to `APPLY_FAILED` with `GIT_LOCKED_MESSAGE`.
- [x] `discardChanges` wraps `classifyForDiscard` and subsequent writes inside one `writeLock.run()` body.
- [x] `npx nx run ptah-electron:validate-deps` passes cleanly with `'node:async_hooks'`.
- [x] `git-info.service.write-lock.real-git.spec.ts` passes 3/3 on real git on Windows (parallel applyHunks, parallel stage, held index.lock retry + recovery).
- [x] `git-rpc.handlers.spec.ts` passes 116/116 (all pass-through assertions for `HOOK_FAILED`, `hookOutput`, `exitCode`, `TIMEOUT`, `CANCELLED`, `LOCKED` verified).
- [x] `git-info.service.spec.ts` passes 154/154.
- [x] `git-write-lock.spec.ts` passes 13/13.
- [x] `exec-git.spec.ts` passes 69/69.
- [x] Root commit and detached HEAD commits read back hash and subject from git directly.
- [x] R6 hook start delay measured at ~200 ms (no separate background gate lane needed).

---

## Verdict

- **Recommendation**: CHANGES_REQUIRED
- **Confidence**: HIGH
- **Top risk**: On Windows, cancelling or timing out a commit during hook execution leaves orphaned hook processes running in the background and can leave `.git/index.lock` permanently stuck, breaking Requirement 1.3 (RC2).
- **What a robust implementation must add**:
  1. Fix the Windows kill order in `exec-git.ts:terminate()` to tree-kill descendants before terminating the parent `git.exe`.
  2. Fix `git-info.service.hooks.real-git.spec.ts` so the suite passes cleanly on Windows without assertion failures or `afterAll` `EPERM` errors.
  3. Extract helper functions from `git-info.service.ts` into collaborators (`git-write-lock.ts` / `git-commit-runner.ts`) to honor the net $\le 0$ line ceiling.
  4. Add unit test coverage for `onExit` in `exec-git.spec.ts`.
  5. Check execution permissions (`0o111`) in `hasCommitHook` on POSIX.

---

## Round 1 recheck

### Summary of Round 0 Findings

| Finding ID | Title                                                                          | Status       | Evidence (file:line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BLK-1**  | Windows kill order in `exec-git.ts` breaks `killProcessTree` and hook reaping  | **RESOLVED** | [`libs/backend/vscode-core/src/utils/exec-git.ts:771-787`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L771-L787): on `win32`, `terminate()` awaits `killProcessTree(pid)` first, before `child.kill('SIGTERM')`, guaranteeing `taskkill /T` traverses the live process tree. `notifyExit` fires immediately on `child.onExit` ([`exec-git.ts:859-869`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L859-L869)) and on fallback `close`. Verified by 6 new unit tests in `exec-git.spec.ts:1365-1440` and real-git hook termination tests.                                                                                                             |
| **BLK-2**  | Real-git test suite failures and temp cleanup crashes on Windows               | **RESOLVED** | [`libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts:172-181`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts#L172-L181) adds `maxRetries: 10` and `retryDelay: 1000` to `fs.rmSync` in `afterAll`. Windows-specific assertions at [`lines 395-402`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.hooks.real-git.spec.ts#L395-L402) correctly verify Ptah's recovery log when git tree is killed. Suite passes 14/14 tests cleanly on Windows (2 skipped: 1 POSIX-only mode check, 1 `[slow]` CI case).                                                                                  |
| **SER-1**  | Line budget breach in `git-info.service.ts` (+102 net lines vs budget $\le 0$) | **RESOLVED** | `git-info.service.ts` delta is now **+221 / -293 (net -72 lines)**, satisfying the line ceiling. Logic cleanly extracted into injected collaborators: [`git-mutation-outcome.ts:1-42`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-mutation-outcome.ts#L1-L42) (`writeOutcome`, `thrownOutcome`, `MutationOutcome`), [`git-remote-sync.ts:1-186`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-remote-sync.ts#L1-L186) (`push`, `pull`, `fetch`, auth check), and [`git-commit-runner.ts:1-343`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-commit-runner.ts#L1-L343).                                              |
| **SER-2**  | `onExit` callback untested in `exec-git.spec.ts`                               | **RESOLVED** | [`libs/backend/vscode-core/src/utils/exec-git.spec.ts:1365-1440`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.spec.ts#L1365-L1440): `describe('onExit')` adds 6 targeted unit tests covering normal exit ordering, killed child exit, timeout exit, survivor-holding-pipes exit, exception isolation, and double-call prevention. All 75 tests pass.                                                                                                                                                                                                                                                                                                                                            |
| **MOD-1**  | `hasCommitHook` misclassifies non-executable POSIX hooks                       | **RESOLVED** | [`libs/backend/vscode-core/src/services/git/git-commit-runner.ts:311-316`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git/git-commit-runner.ts#L311-L316): `hasCommitHook` verifies `(process.platform === 'win32' \|\| (stats.mode & 0o111) !== 0)`, ensuring non-executable POSIX hook files are not classified as active hooks.                                                                                                                                                                                                                                                                                                                                                                   |
| **MOD-2**  | E2E test timeout and git rail unmounting on status refresh                     | **RESOLVED** | [`libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts:81`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.ts#L81) removed `!gitStatus.isLoading()` from dock rail mounting gate, preserving panel instance and commit message/feedback across mutation refreshes (covered by unit tests in [`git-dock.component.spec.ts:372-399`](file:///D:/projects/ptah-extension/libs/frontend/git-ui/src/lib/git-dock/git-dock.component.spec.ts#L372-L399)). [`commit-hook-failure.spec.ts:92-94`](file:///D:/projects/ptah-extension/apps/ptah-electron-e2e/src/specs/git/commit-hook-failure.spec.ts#L92-L94) configured repo-local `user.name` and `user.email` in the scratch repo. |
| **Extra**  | `git-info.service.review.spec.ts` timeout under suite concurrency              | **RESOLVED** | [`libs/backend/vscode-core/src/services/git-info.service.review.spec.ts:15`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/services/git-info.service.review.spec.ts#L15) raised timeout to `jest.setTimeout(30_000)` to prevent false flakes under parallel machine load.                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### Verification Evidence Gathered in Round 1

1. **Unit & Integration Specs**:
   - `exec-git.spec.ts`: 75 passed / 75 total (including 6 new `onExit` tests).
   - `git-info.service.hooks.real-git.spec.ts`: 14 passed / 2 skipped / 0 failed (no EPERM, no assertion failures, R6 start delay ~206 ms).
   - `git-rpc.handlers.spec.ts`: 116 passed / 116 total (mutation pass-through assertions verified).
   - `git-dock.component.spec.ts`: 17 passed / 17 total (dock rail persistence across `isLoading` verified).
   - `git-write-lock.spec.ts`: 13 passed / 13 total.
   - `git-info.service.spec.ts`: 154 passed / 154 total.
2. **Diagnostics**:
   - `ptah_get_diagnostics` on all modified files (`exec-git.ts`, `git-info.service.ts`, `git-commit-runner.ts`, `git-remote-sync.ts`, `git-mutation-outcome.ts`, `git-dock.component.ts`): **0 errors, 0 warnings**.
3. **E2E & Dependencies**:
   - `ptah-electron:validate-deps`: passed (`node:async_hooks`).
   - `commit-hook-failure.spec.ts`: passed (1 passed in 2.5m).

### New Defects

**None.** The implementation cleanly honours the facade pattern, line budget, type-safety standards, and cross-platform process lifecycle invariants.

---

### Score: 9/10

Verdict: APPROVED

---

## Round 2 recheck (post-approval hunk: exec-git.ts terminate() win32)

### Bounded Hunk Evaluation

- **Target**: [`libs/backend/vscode-core/src/utils/exec-git.ts:782-797`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.ts#L782-L797)
- **Change**: Replaced `.catch(() => undefined)` on the Windows `terminate()` chain with a `try ... finally` block ensuring fallback `child.kill('SIGTERM')` executes even if `killProcessTree` throws or rejects, paired with a documented `degradation-audit: reported` suppression comment in `.catch()`.

### Analysis & Judgments

1. **Fallback kill reliability**:
   Wrapping `await killProcessTree(pid)` inside `try { ... } finally { if (!exitNotified) child.kill('SIGTERM'); }` guarantees that a failure or rejection in `killProcessTree` will not skip terminating `git.exe`. The fallback kill is reliably dispatched.
2. **Double kill protection**:
   `exitNotified` is checked both before `killProcessTree` and in the `finally` block before `child.kill('SIGTERM')`. Once `git.exe` exits, `child.onExit` fires and sets `exitNotified = true`, avoiding redundant kill calls. Even if reached on an exited process, `child.kill('SIGTERM')` on Windows is an idempotent process handle termination without throw.
3. **Audit marker veracity**:
   The suppression marker `// degradation-audit: reported - ...` at lines 792-797 is strictly true: a failed tree kill falls through to `child.kill('SIGTERM')` via `finally`, stubborn survivors are terminated via `armReleaseGrace` escalation to SIGKILL, and the caller already holds the timeout or cancellation error that initiated `terminate()`.
4. **Test proof**:
   [`libs/backend/vscode-core/src/utils/exec-git.spec.ts:1327-1347`](file:///D:/projects/ptah-extension/libs/backend/vscode-core/src/utils/exec-git.spec.ts#L1327-L1347) (`still sends SIGTERM on Windows when the tree kill rejects`) mocks `killProcessTree` rejection on `win32` and asserts that `held[0].kill('SIGTERM')` is called. The test suite passes completely (76/76).
5. **Degradation audit verification**:
   `npx nx run degradation-audit:lint --skip-nx-cache` completed with 0 errors in `vscode-core`.

### Findings

**None.** (0 blocking, 0 serious, 0 moderate, 0 minor).

---

### Score: 10/10

Verdict: APPROVED
