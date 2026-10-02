# P5 phase review (backend), round 1 re-review - TASK_2026_576_e16a

- Reviewer: code-logic-reviewer subagent on Sonnet, fallback for an unavailable CLI lane. Weaker evidence: static reading of `git show db258914e`, no real `gh`, no test re-run this round (the fixer's runs were not repeated).
- Scope: `db258914e` (22 files) read in full for the reader, exec-git, operation-actions, history reader, workspace-root, commit-runner and handler changes; spec files skimmed by name only.
- Score: 8/10. Verdict: APPROVE.
- Counts: 0 serious, 0 moderate, 4 new minor (none blocking).

## Status of round 0 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| SER-1 wrong PR for branch | FIXED | `github-pr-status.reader.ts` `fetchStatus` uses `gh pr list --head <branch> --state all --limit 10`; `isPrForBranch` requires `headRefName === branch` and (when an owner is known) the head owner of the push remote; open PR preferred. `--head` is a branch-name filter only, so a numeric branch is no longer read as a PR number. Push remote is read through the injected `exec` (wired in `git-info.service.ts` diff, `exec: deps.exec`). |
| MOD-1 subdirectory stages | FIXED | `git-operation-actions.ts` `writeStages` resolves the top level via `resolveRepositoryRoot`, runs `ls-files -u` from it and builds `result` from it. `isInsideWorkTree` still checks against the workspace folder; it is lexical and only rejects `..`/absolute, so a root-relative path outside the subfolder still passes and stays inside the repository (acceptable). |
| MOD-2 stale re-cache | FIXED | Generation counters (`generationOf`, global plus per root) are compared when a read settles; `invalidate` bumps and clears `inFlight`; the stale run no longer caches, and a post-invalidate read starts a fresh run. Concurrent reads share one run. |
| MOD-3 stale local base | FIXED | `resolveBase` tries `origin/HEAD`, then `refs/remotes/origin/main` or `refs/remotes/origin/master`, then local; range uses the full ref (also closes MIN-4). |
| MOD-4 commit buffering | FIXED | `exec-git.ts` `keepOutputTailBytes` drops whole leading chunks per stream and skips the 64 MiB cap; `git-commit-runner.ts` passes `HOOK_OUTPUT_TAIL_BYTES`. `git log` gets a 4 MiB cap. |
| MOD-5 case rules | FIXED | `findRegisteredWorkspaceFolder` ignores case on win32/darwin only, returns the registered string; all three callers (`git-rpc`, `git-workflow-rpc`, `editor-rpc`) return `registered`. No remaining use of the old function. |
| MIN-1 real-SDK test | REJECTION ACCEPTED | Needs credentials and a real SDK; record as manual cutover evidence. |
| MIN-2 closing tag | FIXED (secret-path filter: REJECTION ACCEPTED, product decision) | Prompt neutralises the tag name in any case. |
| MIN-3 gh output caps | FIXED | stdout 8 MiB (kill, `failed`), stderr 64 KiB, log carries byte count only. |
| MIN-4 short refs | FIXED | see MOD-3. |
| MIN-5 log flood | FIXED (logging); flush bursts unchanged, accepted | `git-rpc.handlers.ts` logs the first broadcast failure per operation. |

## New defects introduced or left by the fixes

### MIN-6 `--limit 10` can hide the branch's own PR for common head names
- File: `github-pr-status.reader.ts:42` (`GH_PR_LIST_LIMIT`), `fetchStatus` args.
- Scenario: `--head main`, `master`, `patch-1` or `develop` also matches fork PRs with the same head name. The list is newest first and the owner filter runs after the limit, so ten newer fork PRs push the real one out.
- Impact: false `no-pr` (quiet, cached 60 s). Only for repositories that receive many fork PRs from default-named branches.
- Fix: raise the limit (for example 50), or when an owner is known pass `--head <owner>:<branch>` if gh accepts it, and keep the post-filter.

### MIN-7 Owner match gives a false `no-pr` in two realistic setups
- File: `github-pr-status.reader.ts` `resolveHeadOwner` and `isPrForBranch`.
- Scenario: (a) the branch was pushed to a fork with no `branch.<n>.pushRemote` or `remote.pushDefault`: `@{push}` falls back to `origin` (the upstream), so the owner is the upstream's and the user's own fork PR is rejected; (b) the PR's head repository was deleted, so `headRepositoryOwner` is null and an owner mismatch is reported.
- Impact: PR panel says no PR when one exists. Fails towards "no PR", never towards a wrong PR, so it is acceptable for now.
- Fix: when no PR matches both name and owner but exactly one open PR matches by name and its owner is not the `origin` owner, consider it a candidate; or document the limitation.

### MIN-8 In-flight map entry is not cleaned if the run ever rejects
- File: `github-pr-status.reader.ts` `startRead` (`.then` without `.finally`).
- Scenario: today `fetchStatus` cannot reject (spawn, exec and parse paths all catch). If a later edit lets it reject, the rejected promise stays in `inFlight` and every later read of that branch joins it until `invalidate`.
- Fix: use `.finally` to delete the entry (guarded by identity) and cache only on success.

### MIN-9 `keepOutputTailBytes` returns tails that can start mid-character
- File: `exec-git.ts` `keepTail` and the final `Buffer.concat(...).toString('utf8')`.
- Scenario: dropping whole chunks keeps at most one extra chunk, but the first kept chunk can begin inside a multi-byte character or line. The kept stderr feeds the `GIT_ERROR` text and the lock-retry check.
- Impact: at worst one garbled leading character in an error message. The user-visible `hookOutput` comes from `GitOutputTail`, which already trims continuation bytes.
- Fix: none required; optionally skip leading continuation bytes as `GitOutputTail.text()` does.

## Verdict

APPROVE. All round 0 serious and moderate findings are fixed with matching tests named by the fixer; the only new defects are minor edge cases of the owner-matching and limit choices. Confidence MEDIUM (static review only; tests not re-run this round).
