# Code Logic Review (Backend) — `TASK_2026_469_3e56`

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 2              |
| Minor issues        | 4              |
| Failure modes found | 7              |

Scope: the uncommitted backend diff (`git diff -- libs/backend libs/shared`), all changed files read in full plus the new `terminal-launch.ts`, `terminal-launch.spec.ts`, `git-info.service.remote-stash.spec.ts`. `libs/frontend/**` was excluded; it is covered by the existing `code-logic-review.md` in this folder. Evidence for the git behaviour comes from the real-git spec files, not from mocked spies.

What holds: argv hygiene is sound (no `shell:true` anywhere, every path stays one argv element, `wt`/`cmd` receive no path at all, `start` gets an explicit empty title); the Zod schemas are strict and the stash index is a validated integer; the workspace root goes through `resolveRoot`/`isRegisteredFolder` and `isPathWithinRoots`; cache invalidation is inherited by construction through `isMutatingGitCommand`; the hexagonal rule holds (`terminal-launch.ts` lives in `platform-core` behind `IProcessSpawner`, no backend lib imports an adapter); the new RPC methods are dual-registered in both `RpcMethodRegistry` and `RPC_HANDLER_MANIFEST` via `GitRpcHandlers.METHODS`; the real-git tests assert the behaviour, not the mock (conflicted pop keeps the entry, wrong-remote push refuses, prune actually prunes).

## Defects

### 1. A stale stash list can drop the wrong entry, and the wire cannot prevent it

- Severity: **serious**
- Files: `libs/backend/vscode-core/src/services/git-info.service.ts:2478` (`runStashMutation`), `libs/shared/src/lib/types/rpc/rpc-git.types.ts:589` (`StashEntry`), `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.schema.ts:102` (`GitStashRefParamsSchema`)
- Failure scenario: `stash@{N}` is an ordinal, not an identity. The dock renders the list from `git:stashList`; every new stash shifts all ordinals up by one. If anything creates a stash between that read and the user's click, `git:stashDrop` at index 1 destroys the entry the user saw at index 2 and keeps the one they meant to delete. The concurrent writer is realistic in this product: an agent session can run `git stash` through the terminal tool while the dock is open, and a human can do the same in their own terminal. `drop` is the destructive verb — the loss is irreversible for a user who does not know the reflog. The wire makes a guard impossible today: `StashEntry` carries only `index`/`message`/`time`, and `GitStashRefParams` carries only `index`, so the caller has no identity to assert and the service has nothing to compare against. The frontend review in this folder already found response-ordering bugs that serve an older stash list; this backend gap removes the last line of defence.
- Suggested fix: add `%H` to the `git stash list` format and a `commitHash` field to `StashEntry`; accept an optional `expectedHash` in `GitStashRefParams`; in `runStashMutation`, run `git rev-parse stash@{N}` first and refuse with a distinct error ("The stash list changed. Refresh and try again.") on mismatch. Apply and pop get the same guard; a wrong apply is recoverable but still wrong.

### 2. An external `git stash drop` never invalidates the cached stash list

- Severity: **moderate**
- Files: `libs/backend/vscode-core/src/services/git-info.service.ts:2407` (`stashList` is a `cachedRead` with no TTL), `git-info.service.ts:422` (`invalidateReadCache`)
- Failure scenario: cache entries drop only when a mutating argv runs through this service (`isMutatingGitCommand`, `git-info.service.ts:2820`) or when the watcher calls `refreshGitInfo`. The workspace watcher never watches `.git`. So `git stash drop` typed in a terminal changes only `.git`, fires no watcher event, triggers no service mutation, and the dock keeps serving the stale list until some unrelated mutation or tree change happens. `stash pop` from a terminal does change tracked files and is picked up; `drop` is not. This compounds defect 1 by widening the staleness window from seconds to unbounded.
- Suggested fix: do not cache `stashList` (the `git stash list` spawn is cheap), or give it a short TTL (a few seconds), or invalidate the stash key inside `stashShow` before answering so the file list and the list the UI holds cannot diverge for long.

### 3. `git:pull` / `git:fetch` / `git:push` can block for up to 300 s on a credential prompt the UI has already stopped waiting for

- Severity: **moderate**
- Files: `libs/backend/vscode-core/src/services/git-info.service.ts:1063` (`runRemoteSync`, `WORKTREE_GIT_TIMEOUT_MS`), `libs/backend/vscode-core/src/utils/exec-git.ts:397` (`GIT_DETERMINISTIC_ENV` sets no `GIT_TERMINAL_PROMPT`)
- Failure scenario: on a repo whose credential helper opens a GUI (Git Credential Manager on Windows is the default for HTTPS), the first `git:pull` from the dock can block on a modal OS dialog nobody notices. The renderer's RPC timeout fires first, the user sees "pull failed", and the pull then completes in the background with no result delivered anywhere. The user retries and may race the first one. The git gate slot (background lane) is held the whole time. The 300 s bound keeps this from hanging forever, and stdin is closed so a terminal prompt fails fast — the gap is only the helper-GUI case plus the result being dropped.
- Suggested fix: pass `env: { GIT_TERMINAL_PROMPT: '0' }` on the three network verbs so the terminal-prompt path is dead by construction (GUI helpers are unaffected and stay the intended first-auth flow), and return a distinct "authentication required" error when git's stderr matches the credential-failure pattern, so the UI can say what actually happened.

### 4. `stashShow` verifies the ref and then reads it in a second process

- Severity: **minor**
- File: `libs/backend/vscode-core/src/services/git-info.service.ts:2530` (verify) and `:2538` (diff)
- Failure scenario: between `rev-parse --verify stash@{N}` and `git diff stash@{N}^1 stash@{N}`, the entry can be dropped. The diff then fails or shows the entry that now occupies the ordinal. Read-only, self-correcting on the next list refresh, and the error copy ("The stash contents could not be read") is honest.
- Suggested fix: none required; the single-argv pair cannot be made atomic without `cat-file`. If defect 1's `expectedHash` guard is added, reuse it here.

### 5. The push upstream probe and the push itself are not one observation

- Severity: **minor**
- File: `libs/backend/vscode-core/src/services/git-info.service.ts:979` (probe) to `:991` (push)
- Failure scenario: between `rev-parse @{u}` answering "no upstream" and `git push -u <remote> HEAD` running, the user can check out a different branch; `-u` then sets upstream tracking on the branch the user did not intend. The window is one user action wide and the command is a plain `git` sequence, so the CLI has the same gap.
- Suggested fix: none urgent. If wanted, resolve HEAD's branch name in the same probe and pass `refs/heads/<name>` instead of `HEAD`.

### 6. A Windows Terminal app-alias stub can win detection and then fail to launch, with no fallback

- Severity: **minor**
- Files: `libs/backend/platform-core/src/utils/terminal-launch.ts:68` (`wt.exe` candidate), `terminal-launch.ts:179` (failure throws), `libs/backend/rpc-handlers/src/lib/handlers/editor-rpc.handlers.ts:174` (`openDetected` reports one generic error)
- Failure scenario: candidate order is git-bash, Program Files, LocalAppData, `wt.exe`, `cmd.exe`. Detection picks the first that stats. On a machine where the `WindowsApps\wt.exe` alias exists but the app is broken or uninstalled for the current user, detection reports the terminal present, the launch fails, and the never-tried `cmd.exe` fallback sits one candidate lower. The user sees "Could not launch the requested editor."
- Suggested fix: on a launch failure for the terminal target, retry the next available detection candidate before giving up (the candidate list is already ordered by preference).

### 7. Untracked files inside a `-u` stash are invisible to `stashShow`

- Severity: **minor**
- File: `libs/backend/vscode-core/src/services/git-info.service.ts:2521` (`stashShow` diffs `stash@{N}^1` against `stash@{N}` only)
- Failure scenario: `git stash -u` stores untracked files in a third parent commit. The `^1..N` diff never lists them, so the dock shows fewer files than the stash contains and the user can pop a stash expecting a file the preview never mentioned. The doc comment declares this trade-off; the wire type has no way to signal it.
- Suggested fix: also diff `stash@{N}^3` when `git rev-parse stash@{N}^3` succeeds, reporting those paths as additions, or surface a `hasUntracked` flag so the UI can say so.

## Five logic questions

### 1. How does this fail silently?

The credential-prompt block (defect 3) is the one silent failure: the UI reports failure, the operation later succeeds, and no result is delivered. The cache staleness of defect 2 is silent by design — `stashList` serves the cached list as truth. The rest of the new paths report failures: conflicted pop returns `success:false` and keeps the entry (verified by the real-git test at `git-info.service.remote-stash.spec.ts:318`), and `stashShow` distinguishes "not found" from "could not be read".

### 2. What user action produces unexpected behaviour?

Running `git stash` in any terminal or agent session while the dock shows a stash list (defects 1 and 2) shifts every ordinal and turns the next apply/pop/drop into an operation on the wrong entry. Clicking Drop while a fetch/pull credential dialog is open also produces a second queued network operation the UI has stopped tracking.

### 3. What input data produces a wrong answer?

A stash list that changed after it was read — the input is not a payload value but time. Inside the schema, hostile values are handled: `index` must be a validated non-negative integer (`git-rpc.schema.ts:102`), so `stash@{-1}`, `stash@{0;evil}` or an option-shaped ref cannot be minted; the remote name in `push -u <remote> HEAD` comes from `git remote` output filtered for a leading `-` (`git-info.service.ts:1027`), and `HEAD` rather than a branch name keeps user-controlled strings out of the argv (`git-info.service.ts:991`).

### 4. What happens when a dependency fails?

A missing git binary or a spawn error rejects through `execGit` and each wrapper catches, logs via `instanceof Error` narrowing, and returns `success:false` (`git-info.service.ts:1063-1086`, `:2478-2516`). A terminal spawn that never started throws `Failed to launch Terminal` and the handler converts it to a generic result without leaking the executable path (`editor-rpc.handlers.ts:186-188`). The git gate slot is held until the child is gone, so a timeout does not leak a slot (`exec-git.ts:644-667`).

### 5. What is missing that the requirements never mentioned?

An identity for a stash entry (defect 1) — the requirement named `stash@{N}` but nothing pinned N to the entry the user saw. A refresh contract for the stash list after external mutations (defect 2). An explicit decision on credential prompts for the new network verbs (defect 3). None of the three is in `task.md`; the first two are consequences of the chosen ordinal API surface.

## Data flow

1. Renderer → `git:stashDrop` → strict Zod parse (`git-rpc.schema.ts:102`) — OK.
2. `resolveRoot` checks the registered-folder list (`git-rpc.handlers.ts:287`) — OK.
3. `stashDrop` → `runStashMutation` → `execGit(['stash','drop','stash@{N}'])` — argv is injection-safe (index is a number); the ordinal can name the wrong entry (defect 1).
4. `execGit` → `isMutatingGitCommand` → `invalidateReadCache` drops the stash list (`git-info.service.ts:2820`) — OK for mutations made through Ptah; external `drop` bypasses it (defect 2).
5. Watcher → `refreshGitInfo` → invalidate + fresh `git status` — OK; fires only on tracked-tree changes.
6. `editor:openWorkspace('terminal')` → strict parse → `isPathWithinRoots` (`editor-rpc.handlers.ts:163`) → `detect()` → `prepareTerminalLaunch` (argv-only, no shell, no path to `wt`/`cmd`) → spawner — OK; single-candidate failure has no fallback (defect 6).
7. `editor:openFile('terminal')` → refused before any resolution or spawn (`editor-rpc.handlers.ts:106`), and `prepareEditorFileLaunch` throws the same refusal at the port layer (`editor-launcher-detection.ts:523`) — double-guarded, OK.

## Requirements fulfilment

| Requirement                                                                                                                                                                    | Status   | Gap                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------- |
| `git:pull` runs `git pull --ff-only`                                                                                                                                           | COMPLETE | Credential block unbounded below 300 s (defect 3)                       |
| `git:fetch` runs `git fetch --prune`                                                                                                                                           | COMPLETE | Same as above                                                           |
| `git:push` keeps shape; `-u` without upstream, origin-else-single-remote, refuse detached/no-remote/multi-remote                                                               | COMPLETE | All five cases pinned by real-git tests; probe is non-atomic (defect 5) |
| Conflicted pop keeps entry, returns `success:false`                                                                                                                            | COMPLETE | Verified against real git                                               |
| `git:stashShow` file list `{path, status, oldPath?}`, "Stash entry not found"                                                                                                  | COMPLETE | `-u` untracked files invisible (defect 7)                               |
| Zod strict, non-negative integer index, `resolveRoot`                                                                                                                          | COMPLETE | —                                                                       |
| `EditorTargetId` gains `terminal`; Windows/macOS/Linux launchers; detection lists terminal only when a launcher exists; `openFile` refuses; root must pass `isPathWithinRoots` | COMPLETE | Alias-stub failure mode (defect 6)                                      |

Implicit requirements not addressed: a stable identity for the entry the user clicked (defect 1) and cache coherence with stash mutations that happen outside this service (defect 2).

## Edge cases

| Case                                          | Handled | How                                                           | Concern                            |
| --------------------------------------------- | ------- | ------------------------------------------------------------- | ---------------------------------- |
| Empty payload for `git:pull`/`fetch`          | YES     | `raw ?? {}` plus optional root (`git-rpc.schema.ts:93`)       | —                                  |
| Unregistered `workspaceRoot`                  | YES     | `resolveRoot` warns and refuses, git never runs               | —                                  |
| Root with spaces, `&`, `;` on Windows         | YES     | `wt`/`cmd` get no path at all; git-bash gets one argv element | —                                  |
| `index` 1e6 (valid, absurd)                   | YES     | Zod max; git then reports a bad ref                           | —                                  |
| Stash made on an unborn branch                | PARTIAL | `^1` diff fails → generic "could not be read"                 | Honest but unexplained to the user |
| Rename inside a stash (`R087`)                | YES     | `parseStashNameStatus` two-path record, pinned by test        | —                                  |
| Copy (`C`) / typechange (`T`)                 | YES     | Mapped to `A` / `M` per the documented wire union             | —                                  |
| Detached HEAD first push                      | YES     | `symbolic-ref --quiet --short HEAD` refusal, tested           | —                                  |
| Terminal launch on Linux without any emulator | YES     | Detection lists nothing; "Editor target is not installed"     | —                                  |

## Verdict

- Recommendation: **REVISE** — the stash ordinal race (defect 1) and its staleness amplifier (defect 2) sit on a destructive operation and should be fixed before merge; defects 3-7 can follow.
- Confidence: HIGH for defects 1, 2, 5, 7 (read from the code and pinned by the real-git tests); MEDIUM for 3 and 6 (platform behaviour reasoned from the spawner contract, not reproduced on this machine).
- Top risk: a user drops a stash entry that is not the one the dock showed them, and it is gone.
- What a robust implementation would add: a commit-hash identity on `StashEntry` plus an `expectedHash` precheck in every stash mutation; TTL or no-cache on `stashList`; `GIT_TERMINAL_PROMPT=0` and a credential-specific error on the network verbs; a next-candidate retry for terminal launches.
