# P2 Phase-End Logic Review — TASK_2026_576_e16a (RC9–RC14)

Reviewer scope: `git diff origin/main...HEAD`, the 18 listed non-spec source files. Batches 9–18 of `batches.md`, plan lines 497–680. Read-only review; no source edits.

Method: every changed hunk was read; the switch/stash/discard paths and the porcelain-v2 unmerged parsing were additionally exercised against a real git in a throwaway directory (two repro scripts: `git switch` refusal shapes, `switch --discard-changes` with an untracked blocker, `checkout --force` on the same state, and a symlink-vs-file merge conflict). Known items (schema comment, over-max-lines, Batch 16 status-driven markers, Batch 14 throttle placement, harness-skill-selection spec) were not re-reported.

## Verdict: APPROVED WITH FIXES

**Score: 7/10**

0 blockers, 1 major, 5 minor. The phase is behaviourally sound on the paths the plan called out as safety-critical — stash recovery, HEAD never detached, prune containment, ref guarding, size/LFS outcomes — with one confirmed regression on the confirmed-discard action and several edge gaps.

## Findings

### 1. MAJOR — "Discard & switch" cannot clear untracked blockers; confirmed-discard regressed from `checkout --force`

- File: `libs/backend/vscode-core/src/services/git-info.service.ts:2524-2527` (force branch of `checkout`); symptom surfaces in `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:287-288`.
- Failure scenario (verified against real git): local branch `main`, target branch `other` that contains `untracked.txt`, working tree has an untracked `untracked.txt` plus a modified tracked file. User picks "Discard & switch…" → confirms → backend runs `git switch --discard-changes other`. Git exits 128 with the single-line error `error: Untracked working tree file 'untracked.txt' would be overwritten by merge.` — `--discard-changes` discards tracked changes but still refuses untracked files in the way. `parseOverwrittenPaths` (`git-info.service.ts:270`) matches only the "would be overwritten by <op>:" header-plus-tab-list shape, so it returns `[]`: the result has `dirty: undefined`, and the frontend's `result.dirty && !mode.force` test fails — it clears the blocked-switch panel and shows git's raw one-liner. The old implementation ran `git checkout --force`, which succeeds on exactly this state (verified: it removed the untracked file and switched). So the secondary confirmed action now fails, with a raw error and no paths, on the very case the blocked-switch flow is built for.
- Suggested fix: in `runSwitch`, also recognise the untracked-refusal (exit 128, `Untracked working tree file '<path>' would be overwritten by merge.`) and return it as `{ dirty: true, conflictingPaths: [path] }` so the picker can re-prompt; or keep `checkout --force` semantics for the force path and document the untracked-file deletion risk in the confirmation text. Either way, add a real-git spec for force-discard with an untracked blocker.

### 2. MINOR — symlink mode in stage 3 (and the worktree stage) is never compared; conflict kind mislabelled

- File: `libs/backend/vscode-core/src/services/git/git-status-parser.ts:241` (`.split(' ', 6).slice(3)`), consumed at `:268` (`stageModes.includes(SYMLINK_MODE)`).
- Failure scenario (verified with a real merge): a symlink-vs-file conflict where only stage 3 is a symlink produces the record `u UA N... 000000 000000 120000 120000 <h1> <h2> <h3> s`. `substring(0, start).split(' ', 6)` yields `["u","XY","sub","m1","m2","m3 mW h1 h2 h3"]`; the 6-element split cap merges m3, mW and the hashes into one element that can never equal `'120000'`. So the check sees only m1 and m2 and the entry is classified `'content'` instead of `'symlink'` — the plan's criterion "mode `120000` in m1, m2 or m3" is only two-thirds implemented. The mislabelled kind reaches the P3/P5 consumers that use it to decide whether the entry can be shown as text.
- Suggested fix: drop the split cap and slice the mode fields only — `record.substring(0, start).trim().split(' ').slice(3, 6)` (m1–m3; include index 6 for mW if the worktree stage should count) — and add a spec with a stage-3-only symlink.

### 3. MINOR — `git:worktrees` answers a malformed payload with an empty list, silently

- File: `libs/backend/rpc-handlers/src/lib/handlers/git-rpc.handlers.ts:322-327`.
- Failure scenario: any payload that fails the strict `parseGitWorkspaceScopedParams` schema (an extra key, a non-string `workspaceRoot`) makes `params` null, `wsRoot` undefined, and the handler returns `{ worktrees: [] }` — indistinguishable from "no worktrees". The UI silently shows an empty worktree list instead of an error. The unregistered-folder case at least logs via `resolveRoot`; the malformed-params case logs nothing.
- Suggested fix: mirror `resolveRoot`'s warning (`[GitRpc] git:worktrees called with invalid params`) so the failure is diagnosable, or return an error result. The documented empty-list contract can stay.

### 4. MINOR — exclude line turns into a gitignore negation when the workspace sits under a `!`-prefixed folder

- File: `libs/backend/vscode-core/src/services/git/agent-worktree-admin.ts:37-39` (`escapeIgnorePattern`), `:253` (line construction with `--show-prefix`).
- Failure scenario: the opened workspace is the repository subfolder `!x/`; `--show-prefix` returns `!x/`, and the appended exclude line is `/!x/.claude-worktrees/`. In a gitignore, a leading `!` negates, so the line does not exclude `.claude-worktrees/` — it re-includes it. `check-ignore` keeps answering "not ignored", and the agent worktree directory shows up as untracked noise in the status the phase was built to keep clean. (`escapeIgnorePattern` handles `*?[\` but not `!`.)
- Suggested fix: escape a leading `!` in the folded prefix (`\!`), or prefix the whole line with a backslash when it starts with `!`.

### 5. MINOR — "Stash & switch" success discards `stashRef`; the user is never told their changes were stashed

- File: `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts:276-279`.
- Failure scenario: user clicks "Stash & switch"; the backend stashes all local changes (untracked included), switches, and returns `stashRef` precisely so the caller can surface it. The picker's success path runs `completeSwitch(branch)` and drops `result.stashRef` — no toast, no notification, no ref shown. The user's working tree is suddenly clean and the only trace is a manually-named entry (`ptah: before switching to …`) in the Stashes panel. A user who misses it has effectively lost sight of their changes.
- Suggested fix: on success with `stashRef`, show a dismissible notice ("Changes stashed as …") or hand the ref to the stashes UI to highlight the new entry.

### 6. MINOR — `git switch` / `--end-of-options` are used with no git version gate

- File: `libs/backend/vscode-core/src/services/git-info.service.ts:2518` (and `2524`, `2533`); also `agent-worktree-admin.ts` `add`/`revParseLine`.
- Failure scenario: `git switch` exists only from git 2.23 and `--end-of-options` in parse-options commands from 2.24. The replaced `git checkout` call worked on every git version. On an older git, the branch RPC now fails with `git: 'switch' is not a git command` — a visible but unexplained error, and the repository states no minimum git version anywhere. The same applies to `worktree add --end-of-options`.
- Suggested fix: either state and check a minimum git (2.24) at service init / first failure with a clear message, or fall back to `checkout` argv when `switch` is unavailable.

## Verified clean (evidence for the score)

- **Stash recovery and HEAD safety** (`git-info.service.ts:2595-2686`): stash entry detected by `refs/stash` movement, not message parsing; pop located by SHA at pop time (stack shared with other clients); pop failure reports both errors and returns `stashRef`, and `git stash pop` keeps the entry on conflict — verified "stash kept on pop failure" holds. No `--detach` anywhere; repro runs kept `symbolic-ref HEAD` on a branch. `switch -c` carries untracked files (plan-specified).
- **Ref guard** (`git-ref-guard.ts`): `--output=/tmp/x` and `-b` as ref values are refused before any spawn; `stash@{N}` passes only the literal ordinal; `assertSafeRevision` peels `~N`/`^N`/`^{commit}` correctly and still forbids a leading `-`. `runSwitch` puts `--end-of-options` before the branch on every non-`-c` path; worktree remove uses `-- <path>`.
- **Prune safety**: all three removal entry points agree — the hook (`worktree-hook-handler.ts` removeAgentWorktree) requires the path to be listed by `git worktree list`, to be non-main, and to lie under `<main>/.claude-worktrees/`, and skips locked worktrees before `removeWorktree(..., true)`; `AgentWorktreeAdmin.remove` re-checks locked before a forced removal; the watcher (`git-watcher.service.ts` pruneVanishedAgentWorktrees) prunes only unlocked `prunable` entries under the agent dir and broadcasts `removed` only for paths that actually left the re-list. Path containment is lexical with case/separator folding appropriate per platform.
- **Watcher generations and races**: the audit rides existing listings; `claimWorktreeAudit` is a stamped timestamp cleared in `stop()`, so a non-git workspace never audits; stale-list audits are safe because prune is idempotent; broadcast is gated on `armGeneration` and `isDisposed`. The unthrottled admin re-list is the accepted deviation and was not re-reported.
- **Status union and parser**: `u` → one unstaged `'U'` with a conflict kind (finding 2 aside), `T` → `'T'`, `sub` field `S` → `submodule: true` on both staged and unstaged entries, rename `origPath` preserved; frontend switches over the status are exhaustiveness-checked.
- **Size limit and LFS**: `GIT_DIFF_MAX_SIDE_BYTES` (2 MiB) applied in `readBlob` (cap → `GitOutputLimitError` → `too-large` with `cat-file -s` size and the cap as honest lower bound), `readWorktreeBlob` (stat first, oversized file never read), and review reader; `patch` is null and `applyHunks` refuses both outcomes with `BINARY_UNSUPPORTED`; LFS pointer parse keeps the `sha256:` oid and requires a valid `oid`+`size` before claiming `lfs-pointer`.
- **Repo operation reader**: marker paths cached per workspace after one `rev-parse --git-path` spawn (worktree-aware), rebase > merge > cherry-pick, `git am` excluded via the `applying` marker, all failures degrade to `operation` omitted with the status still valid.
- **RPC scoping and DI**: `resolveRoot` refuses unregistered folders (no silent cross-repo action); `WorktreeService` and `GitBranchesService` both scope to the git views' active workspace; `instanceCachingFactory` gives one `GitInfoService` per host (the Electron host already registers a `useValue` singleton, so it was already correct).

Remaining uncertainty: the `--show-prefix` exclude line was reasoned about, not executed, for a linked-worktree-at-a-subfolder workspace (finding 4 covers the case I could prove from the pattern semantics); `instanceCachingFactory` identity was taken from the passing container smoke specs, not re-run here.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Ref guard + `--end-of-options` at call sites (RC14) | COMPLETE | — |
| `git switch` semantics: create/dirty/paths, stash with recovery, track, never detached (RC9) | PARTIAL | Force path cannot discard untracked blockers; no version gate (findings 1, 6) |
| Worktree admin: exclude-on-create, locked labels, prune, scoped RPCs (RC10) | PARTIAL | Exclude line negates on `!`-prefixed prefixes (finding 4); malformed `git:worktrees` payload silent (finding 3) |
| Removal detection: hook containment + watcher audit (RC10) | COMPLETE | — |
| Status union `U`/`T`/conflict/submodule, operation, size limit, LFS (RC12) | PARTIAL | Stage-3 symlink mode never matched (finding 2) |
| Review reader 2 MiB side limit (RC12) | COMPLETE | — |
| One `GitInfoService` per host (RC13) | COMPLETE | — |
| Picker UI: stash primary, discard behind confirmation, create-branch error reason (RC9) | PARTIAL | `stashRef` dropped on success (finding 5) |