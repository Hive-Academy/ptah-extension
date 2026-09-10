# Worktree hook patch review

Date: 2026-09-10

Verdict: **changes requested**. One portability defect is confirmed. The core sibling-placement logic, parent-`HEAD` base, and explicit failure behavior are otherwise consistent with the current Git and SDK contracts.

## Confirmed defect

### P1 — Git-quoted main paths are rejected instead of decoded

- Evidence: `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts:181-190` now obtains the destination root from `GitInfoService.getWorktrees()` and passes its parsed `path` to `resolveSiblingWorktreePath()`. `libs/shared/src/lib/utils/git.utils.ts:25-38` parses non-`-z` `git worktree list --porcelain` output by copying the text after `worktree ` verbatim; it does not unquote Git's C-style path representation. `libs/backend/vscode-core/src/services/git-info.service.ts:410-420` invokes `git worktree list --porcelain` without `-z`.
- Scenario: with default `core.quotePath=true`, a repository whose absolute path contains non-ASCII bytes or other characters Git quotes can be emitted as a quoted/escaped value such as `"D:/Users/.../\NNN.../repo"`. The parser retains the quotes and escapes. Neither `path.posix.isAbsolute()` nor `path.win32.isAbsolute()` recognizes that string, so `worktree-hook-handler.ts:72-78` throws `Main repository worktree path must be absolute` and every SDK worktree creation fails. Newline-containing paths are also not safely representable without `-z`.
- Why the tests miss it: `worktree-hook-handler.spec.ts:126-141` bypasses the real parser with already-decoded mock objects. `git.utils.spec.ts:101-117` covers only an ASCII Windows path and CRLF normalization, not quoted or non-ASCII paths. The three simulated OS cases therefore do not exercise the newly introduced parser-to-path integration.
- Required direction: make the `GitInfoService` boundary return lossless paths, preferably using `git worktree list --porcelain -z` with a NUL-aware parser, and add an integration-level regression that feeds the real parser output into the handler path decision. Hand-decoding only this call is less robust because Git quoting rules and embedded newlines must both be handled.

## Verified behavior

- `git worktree list --porcelain` run from the existing linked TASK_2026_410 worktree returned the primary worktree first. This matches the parser's `isMain: worktrees.length === 0` assumption for the normal non-bare repository case.
- `resolveSiblingWorktreePath()` recognizes current Windows Git output (`D:/...`) through `path.win32.isAbsolute`, uses `worktreeDirectoryName()` for a single bounded segment, and constructs the child beneath the primary root's `.claude-worktrees` directory.
- Passing `input.cwd` to `GitInfoService.addWorktree()` preserves the linked parent's implicit `HEAD` as the start point for `git worktree add -b`; only the destination path is rooted at the primary worktree.
- `GitInfoService.addWorktree()` treats the constructed absolute path as an explicit absolute target. Consequently, `resolveWorktreePath()` does not perform its relative-path containment branch. This is not a traversal defect here because the only appended segment comes from `worktreeDirectoryName()`, but the helper call itself is not an additional containment check.
- Rejecting the hook promise is an explicit SDK failure: the installed SDK awaits the callback and serializes rejection as an error control response. The patch no longer reports pathless success when Git fails or omits `worktreePath`.

## Test evidence and gaps

Fresh focused runs with `--skip-nx-cache` where needed passed:

- `@ptah-extension/agent-sdk`: 1 suite, 9 tests.
- `@ptah-extension/vscode-core`: 1 suite, 7 tests.
- `@ptah-extension/shared`: 1 suite, 12 tests.
- Total: 3 suites, 28 tests.
- `git diff --check` for the two reviewed files passed.

The tests substantiate callback success, sibling target calculation for supplied Windows/POSIX strings, forwarding the linked parent cwd, and rejection on the modeled failure paths. They do **not** substantiate an end-to-end `GitInfoService.getWorktrees()` parse into the handler, a real `git worktree add -b` parent-`HEAD` result, or SDK/CLI presentation of a rejected create hook.

Native platform coverage remains missing: execution occurred on Windows. Linux and macOS cases use `path.posix` fixtures on Windows; no native Linux or macOS Git/filesystem behavior was exercised.

No source files, proxy-schema work, builds, commits, worktrees, or existing worktree artifacts were modified.
