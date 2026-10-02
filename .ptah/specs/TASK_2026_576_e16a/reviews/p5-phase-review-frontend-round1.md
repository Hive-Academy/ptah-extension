# P5 phase review (frontend), round 1 re-review - TASK_2026_576_e16a

- Reviewer: code-logic-reviewer subagent on Sonnet (fallback for an unavailable CLI lane, so weaker evidence than an independent-family review).
- Scope: `git show ff6dbe7af` (12 files, git-ui only), plus the shared type change in db258914e (`GitPrState`, closed `reviewDecision`). Read-only; no specs re-run (the fix round reports 52 suites / 1116 tests passing; I did not re-run them this round).
- Score: 7/10
- Verdict: **REVISE** (one new serious finding in the MOD-1 reconciliation; the rest is fixed and sound)
- Counts: SER 1, MOD 1, MIN 2

## Disposition of the original findings

| Finding | Status | Evidence |
| --- | --- | --- |
| MOD-1 timeout reads as failed | FIXED in intent, but the reconciliation introduces SER-1 and MOD-5 below | commit-composer.component.ts:641-646, :748-787 |
| MOD-2 live regions | FIXED | `commit-generate-status` (:306) and `commit-status` (:355) are always in the DOM; content carries its own `mt-2`. Failure and unconfirmed stay in `role="alert"` (:396-413), which is reliable when inserted. |
| MOD-3 worktree read failure | FIXED | worktree.service.ts:87-95 sets `loadError` only when `worktrees` is not an array, keeps the last list, clears on a good read. task-worktree-view.component.ts:305-346 shows an alert with Retry and hides "No worktrees found." while the error is set. |
| MOD-4 silent stash drop | FIXED | history-stash-section.component.ts:335-358: both skipped paths now set a notice in an always-mounted `role="status"` div (:99), and the missing-hash path calls `stash.loadList()`. |
| MIN-1 path injection | FIXED | conflict-banner.component.ts:91-95 JSON-quotes each path (U+2028/2029 escaped) and :119 tells the agent the paths are names only. |
| MIN-2 timeout text | FIXED | commit-composer.component.ts:805 maps `RPC timeout` to "The request timed out." |
| MIN-3 stale open error | FIXED | history-timeline.component.ts:330-340 pins the error to its workspace; `load()` clears it (:455). |
| MIN-4 AA ink | FIXED | The three alert lines now use `text-base-content` with an error-coloured icon. |
| MIN-5 cutover items | DEFERRAL ACCEPTED | Registering `GitOperationOutputService` and any draft store belong to the P6 cutover; the shell is still unmounted. The P6 batch should carry a test that asserts the `MESSAGE_HANDLERS` registration. |
| Sonar items | FIXED | `replaceAll('\\','/')` (task-worktree-view.component.ts:49) and `toBeNull()`. |
| `GitPrState` change | OK | task-pr-panel.component.ts needs no change: `UNKNOWN` falls through `prBadge` to a ghost badge labelled "unknown", and `reviewDecisionText` handles `null`. |

## New findings

### SER-1 - A commit that timed out can be declared "committed" (draft cleared) when someone else changed HEAD or the staged set
- File: commit-composer.component.ts:211-217 (`commitLanded`), :756 (`checkTimedOutCommit`), :716-719 (`cancelUnconfirmed`), :661 (draft cleared), :789-798 (`readBaseline`).
- Scenario: the baseline is taken at click time. `commitLanded` returns true when HEAD moved or the staged path set differs in any way. The renderer timeout is `MUTATION_RPC_TIMEOUT_MS` (10 minutes plus margin), and nothing blocks staging or unstaging in the Changes tab, or another agent, terminal, pull or checkout moving HEAD, while the commit is pending. If the renderer then times out (backend not answering), the check sees a changed staged set or a moved HEAD and shows the green "committed" badge, clears the draft and drops Cancel. No commit by this composer was made. This is the success-looking-failure shape RC1 forbids, and it destroys the user's message.
- Fix: do not treat "the staged set changed" as proof. Require a moved HEAD and confirm that the new HEAD is this commit: compare `gitBranches.lastCommit()?.subject` with the first line of the submitted message (`lastCommit` carries `subject`, `hash` and `author`), and fall back to `unconfirmed` with the existing "no new commit shows yet" text when they differ. A staged-set change with an unmoved HEAD should read as `unknown`, not `landed`. If the baseline HEAD was never read (`headHash === null`), return `unknown` rather than relying on the staged set.

### MOD-5 - Cancel during the "checking" state can report "Commit cancelled" for a commit that merely ended, or whose outcome is unknown
- File: commit-composer.component.ts:676-687 (`cancelRunning`), :758 (`checkTimedOutCommit`).
- Scenario: during `checking`, `cancelRunning` marks `running.cancelling = true` as soon as the RPC succeeds and never reads `reply.data.cancelled`. If the reply was `cancelled: false` (the operation had already ended, for example with a hook failure or after landing), `checkTimedOutCommit` still returns `{kind: 'cancelled'}` whenever the check is not `landed`. That includes `unknown` (status unreadable). The user is told "Commit cancelled. Your message was kept." although git may have finished, failed or still be running.
- Fix: in `cancelRunning` record whether the reply said `cancelled: true` (for example `cancelAccepted` on `RunningCommit`), and in `checkTimedOutCommit` return `cancelled` only for that case. For `cancelled: false`, use the check result (`landed`, or `unconfirmed` / failure text from `UNCONFIRMED_TEXT`).

### MIN-6 - Smaller points on the new code
- commit-composer.component.ts:777-787: only the status read is validated for staleness; `refreshForCauses(['head'])` failure keeps the old `lastCommit`, so a failed HEAD read reads as "HEAD did not move". Also check that `gitBranches` is on the same workspace before trusting its hash.
- history-stash-section.component.ts:99-111: the drop notice stays until the next stash action. After a workspace switch it also shows in the new workspace ("the workspace changed before the drop could run"), which reads oddly. Clear it on the workspace change or on `loadList` completion.

## Specific checks you asked for

- **False "committed" from someone else changing HEAD or the staged set:** present, see SER-1. The existing tests cover "staged set changed" and "HEAD moved" as the positive cases, so they pin the over-eager behaviour rather than guard against it.
- **Cancel after timeout:**
  - After `unconfirmed`, the cancel path is correct. The pending outcome is replaced by `asking` and compared by identity (:697-702), so a newly started commit wins and a stale cancel reply is dropped. `cancelled: true` reads as cancelled (:708), `cancelled: false` re-checks (:714), and a transport failure restores the unconfirmed outcome (:703-705).
  - During `checking` the path is wrong in the two cases described in MOD-5.
- **Always-mounted status regions:**
  - Correct: the regions exist before any text, and `role="alert"` is used only for inserted failure content.
  - Clearing `lastOutcome` at the next click empties the region, so a repeated identical message announces again.
  - `aria-describedby` is attached only while the notice exists.
  - The stash drop-status div sits inside the `[hidden]` collapsible list, which is fine because Drop is only reachable while it is expanded.
- **Listener lifecycle in the new flow:** the output listener now stays attached through the check (released at :656 and on destroy), so late chunks still land in the log; after `unconfirmed` the listener is gone and later output of the still-running commit is dropped.

## Residual uncertainty
- I did not run the specs. The new MOD-1 tests were read by name only in the fix-round notes, not individually.
- The behaviour of `refreshForCauses` coalescing under a very slow `git:lastCommit` was not exercised.
