# Worktree creation fix report

Date: 2026-09-10

## Outcome

Fixed background Agent worktree creation from linked worktrees.

`WorktreeHookHandler` now asks `GitInfoService.getWorktrees()` for the repository's main worktree and resolves the child target beneath that root. It selects `path.win32` for drive/UNC roots and `path.posix` for `/home/...` and `/Users/...` roots, so returned paths retain the absolute syntax supplied by Git on Windows, Ubuntu/Linux, and macOS. The `git worktree add -b` operation still runs with the parent session's `cwd`, preserving the existing rule that the child branch starts from the parent's current `HEAD`.

The hook now rejects invalid input, Git failures, missing worktree paths, and exceptions. It no longer returns `{ continue: true }` without `hookSpecificOutput.worktreePath`. Successful creation still returns the required `WorktreeCreate` output and still invokes the existing UI notification callback; no frontend/background-mode behavior changed.

The target path uses the established `worktreeDirectoryName()` and `resolveWorktreePath()` helpers. This keeps the generated directory name bounded and contained under `<main-worktree>/.claude-worktrees`. A non-absolute main-worktree path is rejected before `git worktree add`. Existing relative custom-path escape rejection and explicit absolute custom-path behavior were not changed.

The portability review found that ordinary `git worktree list --porcelain` may C-quote non-ASCII paths and cannot represent embedded newlines losslessly. All three production parser callers now request `--porcelain -z`. `parseWorktreeList()` detects and parses NUL-delimited fields without trimming or unescaping path text, while retaining its existing line-mode API for compatibility. The `GitInfoService` result used by the hook therefore carries the exact absolute path Git emitted.

## Modified files

- `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts`
  - Resolve the primary repository worktree through `GitInfoService`.
  - Create sibling child worktrees under the primary root.
  - Preserve Windows and POSIX absolute-path syntax independently of the test host.
  - Preserve the linked parent cwd for branch-base semantics.
  - Propagate real hook/Git failures.
- `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.spec.ts`
  - Cover primary-root success output.
  - Cover linked/nested Windows, Ubuntu/Linux, and macOS paths and parent-cwd preservation.
  - Cover returned absolute path semantics.
  - Cover Git failure, thrown exception, unresolved/non-absolute main worktree, and unexpected input.
  - Cover real parser output flowing into sibling resolution for non-ASCII, newline-containing POSIX and Windows paths.
- `libs/shared/src/lib/utils/git.utils.ts`
  - Parse preferred NUL-delimited porcelain output losslessly.
  - Keep legacy line-delimited input compatible without trimming path characters.
- `libs/shared/src/lib/utils/git.utils.spec.ts`
  - Cover NUL-delimited non-ASCII and embedded-newline POSIX and Windows paths.
  - Cover trailing path-character preservation in legacy line mode.
- `libs/backend/vscode-core/src/services/git-info.service.ts`
  - Request `git worktree list --porcelain -z` for the hook's Git service boundary.
- `libs/backend/vscode-core/src/services/git-info.service.spec.ts`
  - Pin the `-z` argv and exact lossless path result.
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts`
- `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.spec.ts`
  - Move the MCP worktree-list caller and fixture to NUL-delimited porcelain.
- `apps/ptah-extension-vscode/src/rpc-host-profile.ts`
  - Move the VS Code worktree lookup caller to NUL-delimited porcelain.
- `.ptah/specs/TASK_2026_410/worktree-fix-report.md`
- `.ptah/specs/TASK_2026_410/agent-output-root.md`

## Latest focused verification

- `npx nx test @ptah-extension/shared --skip-nx-cache --runInBand --testPathPatterns=git.utils.spec.ts`
  - PASS: 1 suite, 15 tests.
- `npx nx test @ptah-extension/vscode-core --skip-nx-cache --runInBand --testPathPatterns=git-info.service.spec.ts`
  - PASS: 1 suite, 122 tests.
- `npx nx test @ptah-extension/vscode-lm-tools --skip-nx-cache --runInBand --testPathPatterns=git-namespace.builder.spec.ts`
  - PASS: 1 suite, 19 tests.
- `npx nx test @ptah-extension/agent-sdk --skip-nx-cache --runInBand --testPathPatterns=worktree-hook-handler.spec.ts`
  - PASS: 1 suite, 11 tests.
- Changed-file ESLint over the nine source/spec files listed above
  - PASS: 0 errors. Two pre-existing warnings remain in `git-info.service.ts`: `max-lines` and a non-null assertion outside this change.
- `git diff --check`
  - PASS. Git printed line-ending notices for unrelated proxy-translator files and `git.utils.ts`; no whitespace error was reported.

Total latest focused coverage: 4 suites, 167 tests passed.

### Platform-test scope

- The commands above ran on the actual Windows host.
- The hook suite executes three host-portable, simulated Git path fixtures using the matching Node path implementation: `D:\projects\ptah-extension` with `path.win32`, `/home/dev/projects/ptah-extension` with `path.posix`, and `/Users/dev/projects/ptah-extension` with `path.posix`.
- Parser and parser-to-hook tests additionally use raw NUL-delimited non-ASCII paths containing embedded newlines for POSIX and Windows.
- The shared parser suite independently retains coverage for legacy POSIX line output and Windows CRLF/backslash output.
- No native Ubuntu/Linux or macOS runner was available, so those two operating systems were not executed directly; their path contracts are simulated on Windows.

Additional broad checks:

- Full `@ptah-extension/agent-sdk` test target did not complete successfully because an unrelated internal-query test hit `InternalQueryQueueTimeoutError: Internal query waited longer than 60000ms for a concurrency slot.` The focused worktree suite passed before and after this run.
- Project-wide `@ptah-extension/agent-sdk` lint remains blocked by the pre-existing `no-unexpected-multiline` error in `session-query-executor.service.spec.ts:433`, plus existing warnings. Neither file is part of this fix.

## Evidence and preserved behavior

- Application log line 3925 shows the failing hook ran from `D:\projects\ptah-extension\.claude-worktrees\task-410-background-agent-execution` and Git failed checkout with `Filename too long` before the old hook claimed the subagent could continue without isolation.
- Windows, Ubuntu/Linux, and macOS linked-worktree regressions assert the new target is directly under the main repository's `.claude-worktrees`, not under the parent's nested `.claude-worktrees` directory.
- The same three regressions assert `GitInfoService.addWorktree()` receives the linked parent as its `workspacePath`, preserving the current parent `HEAD` as the implicit branch start point.
- Every platform fixture asserts the returned `hookSpecificOutput.worktreePath` is absolute under its native path implementation.
- Parser-to-hook coverage proves Git's raw NUL-delimited path survives parsing unchanged and becomes the sibling target root.
- All three production `parseWorktreeList()` callers were inspected and now request `--porcelain -z`: `GitInfoService`, the MCP Git namespace, and the VS Code host worktree resolver.
- Existing callback behavior was retained, so the host continues to refresh the worktree UI only after successful creation.
- Concurrent proxy-translator changes in `libs/backend/auth-providers` were preserved and not edited.

## Remaining risks

- No live Agent spawn was performed, in accordance with the instruction not to spawn helpers. Validation is unit-level plus typecheck/lint.
- Ubuntu/Linux and macOS behavior is covered with simulated native path strings and `path.posix`, not real OS executions.
- Legacy non-`-z` callers still receive the compatible line parser, which deliberately does not attempt to decode Git C-quoted strings. Every production caller currently uses `-z`; an external future line-mode caller must opt into `-z` for lossless unusual paths.
- Historical failed branches and partially created nested worktree directories were not removed.
- If `git worktree list --porcelain` cannot identify a main worktree, the hook now fails explicitly with the cwd in its error. `GitInfoService.getWorktrees()` currently normalizes command failure to an empty list, so that particular resolution error cannot include raw Git stderr.
- No production build, install, app stop, commit, or push was performed. The local production build remains for Main after review.
