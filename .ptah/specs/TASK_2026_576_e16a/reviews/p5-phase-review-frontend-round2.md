# P5 phase review (frontend), round 2 re-review - TASK_2026_576_e16a

- Reviewer: code-logic-reviewer subagent on Sonnet (fallback for an unavailable CLI lane, so weaker evidence than an independent-family review).
- Scope: `git show be92f6f46` (7 files: commit-composer.component.ts, new commit-timeout-check.ts, history-stash-section.component.ts, git-branches.service.ts and specs). Read-only; specs not re-run (the fix round reports 53 suites / 1126 tests, typecheck and lint passing).
- Score: 8/10
- Verdict: **APPROVE**
- Counts: SER 0, MOD 0, MIN 2 (both fail conservatively, no false success)

## Disposition of the round-1 findings

| Finding | Status | Evidence |
| --- | --- | --- |
| SER-1 false "committed" after a timeout | FIXED | The staged set is gone from the baseline. `judgeHead` (commit-timeout-check.ts:55-62) returns `landed` only when the baseline HEAD was known, HEAD moved, and the new HEAD's subject equals the submitted first line. A staged-only change reads `not-found`, another subject reads `other-commit`, and no baseline reads `unknown`; all three keep the draft and Cancel (commit-composer.component.ts:741-752, :701-711). |
| MOD-5 Cancel during "checking" | FIXED | `cancelRunning` (commit-composer.component.ts:658-672) sets `cancelAccepted` only for `success && data.cancelled === true`; any other reply re-enables Cancel. `checkTimedOutCommit` (:738-743) returns `cancelled` only when `cancelAccepted` is set, and a `landed` check wins over it. An unreadable status is no longer reported as cancelled. |
| MIN-6a HEAD read failure and workspace | FIXED | `checkCommit` (:760-780) captures `lastCommit()` before the refresh and returns `unknown` when the object is unchanged (the branch service keeps the old object on a failed or workspace-stale read, git-branches.service.ts:436-445), is null, or when `gitStatus` or `gitBranches.workspaceRoot()` is not the commit's workspace. `readBaseline` (:783) likewise reads HEAD only for the matching workspace. |
| MIN-6b stash notice on switch | FIXED | `dropNotice` is a `linkedSignal` on the active workspace (history-stash-section.component.ts:272). The "workspace changed" text is set after the switch, so it is shown once in the new workspace and cleared on the next switch or action. |

## Checks on the new code

- **Identity check on `lastCommit`:** a failed or workspace-stale `git:lastCommit` leaves the object untouched, so it reads as `unknown`, never "HEAD did not move". A successful read of an unchanged HEAD still yields a new object and correctly reads `not-found`. A status push that refreshes `lastCommit` while the check runs only makes the value fresher.
- **A stale baseline** (HEAD moved just before the click, refresh not landed) can only turn `not-found` into `landed` if the new HEAD also carries the submitted subject, so it cannot create a false success.
- **Cancel race:** if a cancel is in flight when the check ends, the outcome is `unconfirmed` with Cancel available. A second cancel gets `cancelled: false`, re-checks, and reports through `ENDED_TEXT`. Nothing reads as success or cancelled without evidence.
- **Success shown after a verified HEAD** carries the real short hash and subject (`landedOutcome`, :794).

## New findings

### MIN-7 - Subject comparison can leave a landed commit "unconfirmed"
- File: commit-timeout-check.ts:51-53 and :61.
- `subjectOf` takes only the first line. Git's subject (`%s`) joins the first paragraph's lines, so a message such as `line1\nline2\n\nbody` becomes "line1 line2" and never matches. A `prepare-commit-msg` or `commit-msg` hook that rewrites the subject (for example adding a ticket prefix) has the same effect. Result: a commit that really landed reads as unconfirmed, the draft is kept, and a retry can produce a duplicate commit.
- Direction of the error is safe (never a false success), and the text tells the user to check the history. Optional fix: compare against the first paragraph joined with spaces as well, and say in the `other-commit` text that a hook may have rewritten the subject.

### MIN-8 - First commit in an empty repository can never be confirmed
- File: commit-composer.component.ts:783-787. With no previous HEAD, `lastCommit()` is null, so the baseline is `headHash: null` and `judgeHead` returns `unknown` for any outcome. Same safe direction. Optional fix: a null baseline could treat a non-null new HEAD with the matching subject as `landed`.

## Residual uncertainty
- Specs were not re-run; the new tests were read by name only.
- `GitBranchesService.workspaceRoot()` is a plain method over non-reactive state. That is fine for the imperative use here, but it must not be used inside a computed.
