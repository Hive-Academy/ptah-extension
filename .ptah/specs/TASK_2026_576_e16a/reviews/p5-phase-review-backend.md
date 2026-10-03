# P5 phase review (backend) - TASK_2026_576_e16a

- Reviewer: code-logic-reviewer subagent on Sonnet, acting as fallback for an unavailable CLI lane. Weaker evidence than an independent model-family lane: static reading plus one scoped test run, no real `gh`, real SDK or real VS Code run.
- Scope: P5 non-merge commits since `origin/feat/task-2026-576-p4` (batches 45-47, 49, 51-53, 55, 57), backend, shared and CI files. Read in full: `sdk-query-runner.service.ts` diff, `commit-message-generator.service.ts`, `commit-message-prompt.ts`, `git-operation-actions.ts`, `git-operation.registry.ts`, `git-commit-runner.ts`, `git-staged-patch.reader.ts`, `git-history.reader.ts`, `github-pr-status.reader.ts`, `git-operation-output.throttle.ts`, `git-workflow-rpc.handlers.ts` and its schema, `editor-rpc.handlers.ts` and its schema, the launcher, `git-workspace-root.ts`, the manifest and DI diffs, the `git-info.service.ts` diff.
- Evidence run: `nx run @ptah-extension/vscode-core:test --testPathPatterns='operation-actions|git-history|github-pr-status|staged'` gave 1 suite and 24 tests passing. The real-git suites did not match under that config, so I did not exercise them.
- Score: 7/10 (sound; one wrong-answer risk and several edge gaps, none a blocking or security defect).
- Verdict: REVISE (one serious finding, a small fix; the rest are moderate or minor).
- Counts: 1 serious, 5 moderate, 5 minor.

## Priority checks, answered

- `toolAccess: 'none'` (`sdk-query-runner.service.ts:178-212`, `:497-527`): no tool route is left open. `tools: []`, `mcpServers: {}` (the builder is not even called), `strictMcpConfig`, `skills: []`, `dontAsk` with no `allowedTools`, and a deny-all `canUseTool` all apply. `toolAccessOptions` is spread after `capabilityIsolationOptions`, so it cannot be loosened by it. The default branch reproduces the old `tools`, `bypassPermissions` and `allowDangerouslySkipPermissions` values, so existing callers are unchanged. The generator passes `'none'` and also runs in `os.tmpdir()`. Unverified: I did not run the real SDK with a string prompt plus `canUseTool` (see MIN-1).
- Throttle (`git-operation-output.throttle.ts`): `flush()` runs in `finally` and awaits all in-flight pushes before the commit result returns. It is also reached when the commit throws or is cancelled. UTF-8 safety holds: `exec-git.ts:835-863` uses streaming `TextDecoder`s and the throttle cuts on code points. Memory is capped at 256 KiB queued, plus the 256 KiB tail. Send failures are swallowed. No finding, except the memory note in MOD-4.
- Operation actions: kind is re-detected under the write lock and the schema is `.strict()`, so the client cannot name it. Editor env is neutralised (`GIT_EDITOR=true` and the rest). Stage files are cleaned on abort, continue and a no-operation status read. `isInsideWorkTree` rejects `..`, absolute and NUL paths. `GIT_LITERAL_PATHSPECS=1` is set. Object ids are hex-validated before `cat-file`. Extension is allow-listed. `index.lock` recovery is delegated to the existing guard and stays conservative. See MOD-1 for a subdirectory gap.
- `gh` reader: argv is `pr view --json ... -- <branch>` with `assertSafeRef`, `env` is deterministic and non-interactive, timeout kills the process tree with a 1 s force-settle, only `ok` and `no-pr` are cached, and URLs are `https:` only. See SER-1 and MOD-2.
- `editor:openMerge`: `declaresMergeArgs` plus `launcher.openMergeTool` are checked before any stage write, so unsupported targets write nothing. Results carry fixed copy only and no absolute path. No shell is used; `.cmd` goes through cross-spawn argv escaping (real spec on all 3 OSes in CI).
- History reader: ref safety is good (`--end-of-options`, `assertSafeRef`, `^{commit}`); NUL-delimited parsing is robust and fails closed on a bad field count. See MOD-3 and MIN-4.

## Serious

### SER-1 PR status can describe a different PR than the current branch
- File: `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:~232` (args), `:~375` (parse); handler `libs/backend/rpc-handlers/src/lib/handlers/git-workflow-rpc.handlers.ts:156-162`.
- Scenario: `gh pr view -- <branch>` resolves its argument as a PR number, URL or branch. A local branch named `123` shows PR #123. A branch such as `main` can resolve to a PR whose head is a fork's `main`. `headRefName` is requested and parsed but never compared with the branch.
- Impact: the review shell shows another PR's state, checks and review decision as "this branch's", which is a wrong answer rather than an error.
- Fix: after a successful parse, require `raw.headRefName === branch`, else return `{ status: 'unavailable', reason: 'no-pr' }`. Optionally add `headRepositoryOwner` to the JSON fields and compare it with the remote owner. Add a spec for a numeric branch name.

## Moderate

### MOD-1 Conflict stages assume the workspace is the repository root
- File: `libs/backend/vscode-core/src/services/git/git-operation-actions.ts:~232-255` (`readStageIds`, `result: path.resolve(workspacePath, relativePath)`) and `:~335-345` (`isInsideWorkTree`).
- Scenario: the workspace folder is a subdirectory of the repo. Status paths are repository-root-relative (see the `git-info.service.ts` comment about untracked reads). `ls-files -u -- <path>` runs with `cwd=workspacePath` and treats the pathspec as cwd-relative, and `result` is joined onto `workspacePath`.
- Impact: lookup finds no stages, so the user gets "not-mergeable... open the folder instead", which is misleading. Where it did match, `result` would point at a wrong path. It fails safe but openMerge never works in that layout.
- Fix: resolve the top level with `rev-parse --show-toplevel` and run `ls-files` from there, and build `result` from it. Alternatively use `--full-name` plus a root-relative pathspec. Add a real-git case for a subdirectory workspace.

### MOD-2 In-flight `gh` read can re-cache a pre-push result after invalidation
- File: `github-pr-status.reader.ts:~134-150` (`read`), `:~153-165` (`invalidate`); `git-info.service.ts` `push()`.
- Scenario: a `git:prStatus` read starts, `git:push` completes and calls `invalidate`, then the older read finishes and `cache.set(...)` stores pre-push checks for 60 s.
- Impact: stale checks right after a push, which is the situation the invalidation was added for. There is also no de-duplication of concurrent reads, so a burst of panel refreshes spawns several `gh` processes.
- Fix: keep a per-root generation counter bumped by `invalidate`; only cache when the generation at start still matches. Share in-flight promises per cache key.

### MOD-3 History base prefers a possibly stale local `main` over `origin/main`
- File: `git-history.reader.ts:~145-160` (`resolveBase`).
- Scenario: `origin/HEAD` is unset (common after `git remote add`, worktrees or some clones) while `origin/main` exists and local `main` lags. The base becomes local `main`.
- Impact: the "task history" lists every commit that landed on `origin/main` since local `main` last moved, up to 200, presented as the task's own commits.
- Fix: try `refs/remotes/origin/main` and `refs/remotes/origin/master` before the local candidates when `origin/HEAD` is absent. Use full refs (`refs/remotes/...`, `refs/heads/...`) in the `<base>..HEAD` range so a same-named tag or branch cannot shadow it (also covers MIN-4).

### MOD-4 Commit output is still buffered whole by `execGit`
- File: `git-commit-runner.ts:~320-335` with `utils/exec-git.ts:857-864`.
- Scenario: `GitOutputTail` bounds only the kept tail. `execGit` still holds all stdout and stderr up to 64 MiB, and past that it aborts the commit with `GitOutputLimitError`.
- Impact: a very chatty hook costs up to 64 MiB of memory, and beyond that the commit is killed and reported through `thrownOutcome` rather than as a hook failure with a tail.
- Fix: for commit, pass a small `maxOutputBytes` plus an option that discards chunks once an observer is present, or stream without accumulating. At minimum, map `GitOutputLimitError` to a `HOOK_FAILED` result with the tail.

### MOD-5 Folder match is case-insensitive but returns the caller's string
- File: `libs/backend/rpc-handlers/src/lib/handlers/git-workspace-root.ts:~14-25`, used by `git-workflow-rpc.handlers.ts:~296-306`, `editor-rpc.handlers.ts:~262-272`, `git-rpc.handlers.ts`.
- Scenario: on a case-sensitive filesystem, `/work/Repo` and `/work/repo` are distinct. A request naming `/work/repo` matches a registered `/work/Repo`, then git runs on the requested path, which may be a different repository.
- Impact: mutating RPCs (abort, continue, commit) could hit an unregistered repository. Low likelihood, but the file's own comment promises a hostile request cannot reach another repo.
- Fix: return the registered folder string, not the requested one, and compare case-insensitively only on win32 and darwin.

## Minor

- MIN-1 `sdk-query-runner.service.ts:~197-210`: the `'none'` options are covered only by tests with a mocked `queryFn`. No test runs the real SDK with a string prompt plus `canUseTool` and `dontAsk`. Add a smoke test or note it as manual evidence.
- MIN-2 `commit-message-prompt.ts:~18-21`: the closing-tag neutralisation is exact-case and exact-spacing (`</STAGED_DIFF>`, `</staged_diff >` pass). With tools disabled the worst case is a steered message, but lowercase-compare or escape every `<` in the diff. Also, staged secrets (for example `.env`) go to the provider without a filter; consider skipping obviously secret paths.
- MIN-3 `github-pr-status.reader.ts:~260-265` and `~365-372`: `gh` stdout and stderr are collected without a cap, and the debug log prints the full stdout on malformed JSON. Cap both.
- MIN-4 `git-history.reader.ts:~110`: `${base.name}..HEAD` uses a short name (`origin/main`, `main`). A tag or branch with the same name shadows it; use `refs/...` (see MOD-3).
- MIN-5 `git-operation-output.throttle.ts:~99-107` with `git-rpc.handlers.ts:~616-624`: when the webview is gone, every push logs an error (up to 10 per second). Log once per operation. Also `flush` sends all remaining segments back-to-back (at most about 32 pushes), which is acceptable but unthrottled.

## Five logic questions

1. Silent failure: PR reader quiet reasons are intentional (`failed`, `timeout`, `gh-missing`). The wrong-PR case is the one silent wrong answer (SER-1). Generator and history failures map to named reasons, not empty success. Stage-file cleanup failures are debug-logged and retried later (acceptable).
2. Unexpected user action: cancel while queued behind the write lock aborts before spawn and the guard refuses to touch a foreign `index.lock` (waits 5 s, then leaves it). Double-submit with the same `operationId` is refused. A second Continue after completion returns `no-operation`.
3. Wrong answer from data: numeric or fork-colliding branch names (SER-1), stale local base (MOD-3), subdirectory workspaces (MOD-1).
4. Dependency failure: `gh` absent, unauthenticated, hung (killed by tree) and malformed JSON are handled. git failures during abort/continue return sanitized errors with the workspace path replaced. Provider quota, auth and network errors in the generator are classified. Not covered: output-limit abort of a chatty hook (MOD-4).
5. Missing and unstated: no negative caching of `gh-missing` / `not-authenticated` means every panel refresh respawns `gh`; this is per spec ("`ok`/`no-pr` only"), but the frontend should not poll aggressively. No lock-free guard against two editor merge launches for one file (harmless, same files are rewritten).

## Verdict

REVISE, mainly for SER-1 (a few lines plus a spec). MOD-1 to MOD-3 are worth fixing in the same pass; MOD-4 and MOD-5 can be tracked. Confidence MEDIUM: static reading, one scoped test run, no real `gh` or SDK execution.

## Fix round 1 (orchestrator-run, backend-developer)

All paths are relative to the worktree root. The changes are not committed.

### Review findings

- SER-1: FIXED. `github-pr-status.reader.ts:532` (`fetchStatus`) now runs `gh pr list --head <branch> --state all --limit 10 --json …,headRepositoryOwner`. `gh pr view <arg>` reads an all-digit argument as a PR number. `--head` only takes a branch name. Locally, `gh pr list --help` documents `-H, --head string  Filter by head branch`. `selectBranchPr` (`:310`) and `isPrForBranch` (`:277`) accept a PR only when its `headRefName` equals the branch and its head repository owner equals the owner of the branch's push remote. The push remote is `<branch>@{push}`, falling back to `origin`; `resolveHeadOwner` (`:575`) reads it with `rev-parse --symbolic-full-name` and `remote -v`. Both are read-only verbs under `isMutatingGitCommand`, so the read cache is not invalidated. When there is no match the result is `no-pr`. An open PR is preferred over a newer closed one. The `GitPrStatusResult` contract is unchanged. Tests are in `github-pr-status.reader.spec.ts`, under `branch match (SER-1)`:
  - "treats an all-digit branch as a branch and rejects a PR from another head"
  - "accepts the PR whose head is the all-digit branch itself"
  - "rejects a fork's PR from a branch of the same name (origin owner)"
  - "picks the PR from the branch's push remote among same-named heads"
  - "prefers the open PR over a newer closed one"
  - "matches on the branch name alone when git cannot name an owner"
- MOD-1: FIXED. `git-operation-actions.ts:264` resolves the repository top level through the new `resolveRepositoryRoot` dependency, which `git-info.service.ts` wires to the service's existing `resolveRepositoryRoot`. `ls-files -u` now runs from the top level, and `result` is `path.resolve(topLevel, relativePath)` (`:300`). The client still sends a repository-relative status path. `rev-parse --git-path` is cwd-relative and was already resolved against the cwd, so the stage directory is unchanged. Test: `git-info.service.operation-actions.real-git.spec.ts`, "writes the stages when the workspace folder is a repository subdirectory".
- MOD-2: FIXED. The PR reader keeps a generation counter: a global one plus one per root (`generationOf`). `invalidate` (`:503`) bumps it and drops in-flight entries, and a read stores its result only if the generation it started under still holds (`startRead`, `:478`). Concurrent reads of the same root and branch share one `gh` run. Tests in `in-flight reads (MOD-2)`:
  - "does not cache a read that was running when invalidate was called"
  - "starts a fresh gh run for a read after invalidate instead of joining the old one"
  - "shares one gh run between concurrent reads of a branch"
- MOD-3: FIXED. In `git-history.reader.ts:146` (`resolveBase`), when `origin/HEAD` is unset the reader tries `refs/remotes/origin/main` and `refs/remotes/origin/master` before local `main` and `master`. The plan (`implementation-plan.md:1353`) gives the order `origin/HEAD`, then `main`, then `master`. This keeps the remote default first and puts the remote-tracking candidates ahead of the local ones, as the review asked. Test: `git-history.reader.real-git.spec.ts`, "prefers origin/main over a stale local main when origin/HEAD is unset".
- MOD-4: FIXED.
  - Commit: a new `ExecGitOptions.keepOutputTailBytes` (`exec-git.ts:492`, applied at `:859`) keeps only about the last N bytes of each stream (whole chunks) and does not enforce the 64 MiB cap, since memory is bounded. `git-commit-runner.ts:329` passes `HOOK_OUTPUT_TAIL_BYTES`. A chatty hook therefore costs about 256 KiB per stream, and its output can no longer trip `GitOutputLimitError`. The kept stderr tail still serves the `index.lock` retry check and the `GIT_ERROR` message. Test: `exec-git.spec.ts`, "keeps only the tail of each stream and ignores the cap with keepOutputTailBytes". Hook behaviour is re-verified by `git-info.service.hooks.real-git.spec.ts`.
  - `git log` (history): capped with `maxOutputBytes: HISTORY_LOG_MAX_OUTPUT_BYTES` (4 MiB) at `git-history.reader.ts:244`. Past the cap the read fails as `git-failed` through the existing catch.
- MOD-5: FIXED. `git-workspace-root.ts:16` is now `findRegisteredWorkspaceFolder` and returns the registered folder's own string. It ignores case only on win32 and darwin. All three callers use it: `git-rpc.handlers.ts`, `git-workflow-rpc.handlers.ts` and `editor-rpc.handlers.ts`. Tests:
  - new `git-workspace-root.spec.ts` (4 tests, including "keeps case on linux, where /work/Repo and /work/repo differ")
  - updated handler specs that now expect the registered spelling (`git-rpc.handlers.spec.ts`, "…and runs on the registered one"; `git-workflow-rpc.handlers.spec.ts`; `editor-rpc.handlers.spec.ts`). Their inputs differ only by separators, so they hold on every OS.
- MIN-1: DEFERRED. Covering this needs a real Claude SDK run with credentials (string prompt plus `canUseTool` and `dontAsk`), which cannot run in this environment. Record it as manual evidence at cutover.
- MIN-2: FIXED (closing-tag part). `commit-message-prompt.ts:18`: every `staged_diff` in the diff, in any case, becomes `staged\_diff`, so no opening or closing tag of any case or spacing survives inside the fence. The regex is a plain literal, so it cannot backtrack. Test: `commit-message-generator.service.spec.ts`, "neutralises the tag name in any case and spacing". The suggested secret-path filter is DEFERRED: which paths to skip is a product decision and is not small.
- MIN-3: FIXED. `gh` stdout is capped at 8 MiB (`GH_STDOUT_MAX_BYTES`, `:45`); past the cap the process is killed and the result is `failed`. stderr is kept up to 64 KiB (`BoundedOutput`, `:412`). The malformed-JSON debug line logs only `stdoutBytes`. Test: "returns unavailable with reason failed on malformed JSON without throwing" now asserts the log meta is `{ stdoutBytes: 15 }`.
- MIN-4: FIXED. The range uses the full ref (`${base.ref}..HEAD`, `git-history.reader.ts:108`). Test: "is not shadowed by a tag named like the base branch".
- MIN-5: FIXED (logging). `git-rpc.handlers.ts:603` logs a broadcast failure once per operation. Test: `git-rpc.handlers.spec.ts`, "logs a failing broadcast once per operation, not once per push". The back-to-back `flush` sends are unchanged; the reviewer judged them acceptable (at most about 32).

### SonarCloud (PR #629)

- `editor-rpc.handlers.ts:267`, destructured `.filter()`: FIXED. Both occurrences (`:229` and `:267`) now use `.find()`.
- `github-pr-status.reader.ts:54`, backtracking regex: FIXED. `repoKey` (`:104`) trims trailing slashes in a loop, with no regex. `classifyGhFailure` (`:339`) uses `includes` on lower-cased stderr, with no regex.
- `github-pr-status.reader.ts:181`, spread before iterating: FIXED. `invalidate` iterates `this.cache.keys()` directly (`:516`). Deleting during iteration is safe for a `Map`.
- `github-pr-status.reader.ts:264`, nested promises: FIXED. These are now `async` `killTree`/`processId` (`:400`), and `stopGh` (`:366`) calls `void killTree(handle)`.
- `github-pr-status.reader.ts:313`, cognitive complexity 21: FIXED by splitting the code:
  - `trySpawnGh` (`:610`)
  - `runGh` (`:638`), whose callbacks hold one condition each and use a settle-once function
  - `classifyGhFailure`, `selectBranchPr`, `toPrInfo` (`:288`), `stopGh`, `spawnFailureReason` and `BoundedOutput`
- `github-pr-status.reader.ts:373`, `String(raw.reviewDecision)`: FIXED. `normalizeReviewDecision` (`:202`) accepts only a known string; anything else becomes `null`. Test: "normalizes missing and unknown fields of a matching PR" (an object decision gives `null`) and `normalizers`.
- `rpc-git.types.ts:952,955`, union collapsing to `string`: FIXED. There are now closed unions: `GitPrState = 'OPEN' | 'CLOSED' | 'MERGED' | 'UNKNOWN'` (`:949`) and `GitPrReviewDecision | null` (`:962`). The reader normalises any other value, through `normalizePrState` and `normalizeReviewDecision`. `@ptah-extension/git-ui:typecheck` passes with no frontend change. One behaviour change: a PR whose state is missing or unknown now arrives as `'UNKNOWN'` rather than the old default `'OPEN'`. `task-pr-panel.component.ts` `prBadge` already renders that as a ghost badge reading "unknown".
- `sdk-query-runner.service.ts:169`, async function with no await: FIXED. `denyEveryTool` returns `Promise.resolve(...)`, typed `CanUseTool`.
- `git-workflow-rpc.handlers.ts:117`, async function with no await: FIXED. The handler is not `async`; it returns `Promise.resolve(...)` and returns `Promise.reject(new RpcUserError(...))` for invalid params, so the rejection behaves as before.

### Verification (NX_DAEMON=false, one project at a time, --maxWorkers=2)

- `@ptah-extension/shared`: typecheck passed; test: 82 suites, 2257 tests passed.
- `@ptah-extension/vscode-core`:
  - typecheck: passed
  - lint: 0 errors, 15 warnings, all pre-existing (none in the changed files)
  - test: 45 suites, 897 tests passed
  - `test-real-git --testPathPatterns="operation-actions|git-history|remote-stash|hooks"`: 4 suites, 76 passed, 2 skipped
- `@ptah-extension/rpc-handlers`:
  - typecheck: passed
  - lint: 0 errors, 47 warnings, all pre-existing
  - test: 120 of 121 suites passed (3585 tests passed, 6 skipped). The one failure is the known environment failure in `harness-skill-selection-rpc.service.spec.ts`.
- `@ptah-extension/agent-sdk`: typecheck passed; test `--testPathPatterns="sdk-query-runner|commit-message"`: 2 suites, 68 tests passed.
- `@ptah-extension/git-ui`: typecheck passed.

## Fix round 2 (orchestrator-run, backend-developer)

This round covers the round-1 review (`p5-phase-review-backend-round1.md`). It builds on the round-1 commit `db258914e` and is not committed.

- MIN-6: FIXED. `GH_PR_LIST_LIMIT` is now 50 (`github-pr-status.reader.ts:42`), and filtering by `headRefName` plus owner is unchanged. I did not use `--head <owner>:<branch>` because `gh pr list --help` says that syntax is "not supported". Test: "finds its own PR behind more than ten newer fork PRs of the same head name (MIN-6)", which puts 12 fork PRs from `main` ahead of the branch's own PR.
- MIN-7: ACCEPTED, no code change. When the push remote cannot be resolved to the fork, or the head repository was deleted, the owner match fails and the reader answers `no-pr`. It never shows another branch's PR. A better heuristic (for example, a single open PR matched by name whose owner differs from `origin`) is left for a later change.
- MIN-8: FIXED. `startRead` now removes its in-flight entry in `.finally` (`github-pr-status.reader.ts:495`), only when the entry is still its own, so a rejected run is removed too. Caching still happens only on success. Test: "drops a rejected run from the in-flight map so the next read spawns again (MIN-8)". A throwing logger makes the read reject; two reads then give two `gh` spawns.
- MIN-9: FIXED. When `keepTail` drops leading chunks it marks the stream as cut (`exec-git.ts:889`). The returned tail of a cut stream starts at the next UTF-8 character boundary, skipping leading continuation bytes 0x80-0xBF (`fromCharBoundary`, `:718`, applied at `:949`). A stream that was not cut is returned unchanged. Test: `exec-git.spec.ts`, "starts a cut tail at a UTF-8 character boundary (MIN-9)".

Verification (NX_DAEMON=false, --maxWorkers=2), for `@ptah-extension/vscode-core`:
- typecheck: passed
- lint: 0 errors, 15 warnings, all pre-existing
- test: 45 suites, 900 tests passed
- `test-real-git --testPathPatterns="hooks"`: 1 suite, 18 passed, 2 skipped
