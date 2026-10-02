# P5 phase review (frontend) - TASK_2026_576_e16a

- Reviewer: code-logic-reviewer subagent on Sonnet. Fallback for an unavailable CLI lane, so the evidence is weaker than an independent-family review.
- Scope: `git diff origin/feat/task-2026-576-p4...HEAD -- libs/frontend` (25 files, batches 48, 50, 54, 56). All source files were read in full: composer, GitOperationOutputService, SourceControlService deltas, task view and PR panel, conflict banner, history timeline and stash section, GitHistoryService, GitStatusService / GitBranchesService / EditorLauncherService deltas, review shell.
- Verification: scoped specs (commit-composer, conflict-banner, task-worktree, history-timeline, git-history, review-shell) ran 7 suites / 193 tests, all passing. Passing specs are not evidence for the live-region and timeout items below.
- Score: 7/10
- Verdict: **APPROVE** (no blocking or serious findings; 4 moderate and 5 minor findings recorded for follow-up)
- Counts: SER 0, MOD 4, MIN 5

## Priority checks, results

- **Composer.**
  - Nothing commits and no provider call is made without a click: `onCommit` and `onGenerate` are reachable only from the button handlers (commit-composer.component.ts:491, :519).
  - A generation failure leaves the draft untouched (:501-507), and a draft typed during generation is not overwritten (:509-515).
  - Output is routed by `operationId` (git-operation-output.service.ts:44). The listener is released after the reply and on destroy (:548, :480).
  - Cancel after completion is a no-op: `running()` is null (:560), or the id no longer matches (:572).
  - The generation timeout is 75 s (source-control.service.ts:38).
  - Drafts are keyed per workspace (:371), and the draft cleared on success is the one for the workspace the commit ran in (:553).
  - Only a confirmed commit clears the draft. OK.
- **Task view.**
  - There is one timer. It is armed only after a read, only while shown and not destroyed (task-worktree-view.component.ts:691). It is cleared on hide and on destroy (:704, :540).
  - Stale replies are dropped by the `prRequest` counter (:680), and the result is pinned to its workspace (:492).
  - Remove (non-force) and Force remove map to the secondary and primary dialog buttons (:418-420). `confirm()` emits `confirmed` only, never `cancelled`, so `removeTarget` is not nulled early.
  - The PR link is https-only (task-pr-panel.component.ts:79).
  - The backend invalidates its PR cache on push (git-info.service.ts:1305), so the post-push refresh is not served stale.
- **Conflict banner.**
  - Continue is shown only when `conflictedPaths.length === 0` (conflict-banner.component.ts:356).
  - Abort asks through the confirm dialog (:477).
  - The Ask-agent prompt names the operation, the root and the paths, and tells the agent not to continue or abort (:86-112).
  - `unsupported` falls back to `openFile` (:434).
  - A workspace switch drops replies (`finish`, :572) and resets the per-workspace state (linkedSignals).
  - All action buttons are disabled while `running()` is set.
  - A malformed abort or continue reply reads as `failed` (source-control.service.ts:84-114).
- **History.**
  - Reads happen only while `shown()` (history-timeline.component.ts:394).
  - The refetch key is workspace, branch, HEAD hash and push count (:339), with an in-flight de-dup (:427).
  - A superseded reply is dropped (:441).
  - A root commit gets an "Initial commit - open in editor" row instead of an open-against-parent button (:194). A merge compares with its first parent (title and sr text).
  - The stash drop is pinned to the workspace and re-checked by hash (history-stash-section.component.ts:299-308).
- **Shell.**
  - Commit, Task and History bodies use `@defer (when shownTab() === ...)` and stay mounted, hidden by class (review-shell.component.ts, tab bodies in the template).
  - The banner slot is always mounted above the tabs.
  - `ReviewShellComponent` is not mounted in `apps/` or `libs/frontend/chat`: the grep returned nothing.

## Findings

### MOD-1 - Commit transport timeout reads as "not committed" while git may still be running
- File: commit-composer.component.ts:111-117, :534-556
- Scenario: a slow hook outlasts `MUTATION_RPC_TIMEOUT_MS`. The reply becomes `{success:false}`, which is read as `Commit failed: Could not reach git: RPC timeout`. The log listener is released and `running` is cleared, so Cancel is gone while the backend operation may still be running. The text then adds "Your message was kept." The commit can then land. The draft stays, so a second click can attempt a duplicate (it will normally fail on the index lock or "nothing to commit").
- Fix: when the failure is a renderer timeout (`error` starts with `RPC timeout`, see `RPC_TIMEOUT_ERROR_PREFIX` in git-status.service.ts), word it as "git did not answer in time; the commit may still complete - check the status", and keep refreshing status (already done). Consider keeping Cancel available until a refresh shows the staged count change.

### MOD-2 - Dynamically inserted `role="status"` regions in the composer are unreliable for announcements
- File: commit-composer.component.ts:239-253 (generate notice), :289-317 (success and cancelled)
- Scenario: these live regions are created together with their text inside `@if` / `@switch`. Many screen readers do not announce a `role="status"` node that is inserted already populated. A user who clicks Generate message and gets "unavailable" or a changed-field notice, or who commits successfully, may hear nothing. The failure `role="alert"` is fine.
- Fix: keep one persistent `role="status"` container (as the banner does with `conflict-banner-ended`) and set its text, instead of inserting the node with its content.

### MOD-3 - Worktree list read failure is shown as "No worktrees found."
- File: task-worktree-view.component.ts:518-525, :314; worktree.service.ts:75-85 (the Task tab now depends on this)
- Scenario: `git:worktrees` fails or times out. `loadWorktrees` ignores the failure and leaves `_worktrees` empty, so the Task tab says "No worktrees found." with no error and no retry. This looks like a success-shaped result for a failed read.
- Fix: have `loadWorktrees` expose an error signal (or return a boolean) and show a muted error line next to the refresh button, as the History tab does.

### MOD-4 - Stash drop silently does nothing when the entry vanished or the workspace changed
- File: history-stash-section.component.ts:299-308
- Scenario: the user confirms "Drop stash@{1}?" but the hash is no longer listed (popped elsewhere), or the workspace switched. The method returns with no feedback. The pin and re-check are correct, but the user is told nothing, and the confirmation they gave is silently discarded.
- Fix: set a brief visible notice (for example "That stash is no longer there; the list was refreshed") and call `stash.loadList()`.

### MIN-1 - Conflicted paths go into the agent prompt unescaped
- File: conflict-banner.component.ts:100-103
- Paths are interpolated as `- ${path}`. A path with a newline or control characters (possible in a cloned repo) can splice extra lines into the prompt sent to the agent. Fix: quote each path (`JSON.stringify`) or strip control characters before listing it.

### MIN-2 - Generation failure text conflates timeout, transport failure and rejection
- File: commit-composer.component.ts:581, :596
- Both `!response.success` and a thrown error say "The request failed." A 75 s timeout is not distinguished from an IPC fault, even though `GENERATION_REASON_TEXT` has a `timeout` string. Fix: map an `RPC timeout` error to the `timeout` text.

### MIN-3 - Stale open-error on the History tab
- File: history-timeline.component.ts:142, :328
- `openError` is cleared only by the next `select`. It survives a workspace switch and a refresh, so an error from another repository can sit above the new list. Fix: clear it in `load()` or when the workspace changes.

### MIN-4 - `text-error` on a base surface in alert lines
- File: conflict-banner.component.ts:284; history-timeline.component.ts:145; history-stash-section.component.ts:84
- design-spec section 0 says `text-error` on base fails AA, and the composer correctly uses `text-base-content` on an error tint. These three alert lines use `text-error`. Fix: use `text-base-content` with the error icon.

### MIN-5 - Wiring deferred to cutover; two consequences to track
- `GitOperationOutputService` is not yet in the webview `MESSAGE_HANDLERS` (app.config.ts:221 area), and the shell is not mounted. This is intended (batches.md lists "register `GitOperationOutputService` under `MESSAGE_HANDLERS`" at cutover). Until then no live hook output streams. The composer falls back to the failed result's `hookOutput`, but a successful commit shows no output. P6 must register it, and a test should assert the registration.
- Composer drafts live in the component instance (`drafts` signal, commit-composer.component.ts:371), so they survive a tab switch (the body stays mounted) but not a shell remount (dock close). This is acceptable for "drafts per workspace" as built; move them to a root store if the cutover can unmount the shell.

## Questions answered with no defect found
- Silent failure on Abort/Continue: a transport failure and a malformed reply both map to `failed` and are shown in `role="alert"`.
- Race on workspace switch: Task PR, History log, banner and composer all pin to the workspace they were asked for. The one global is the banner's `running`, which briefly disables the new workspace's buttons; this is acceptable and conservative.
- Timer leak: none found. The only timer is `prTimer`, armed outside the zone, cleared on hide and destroy. The composer's output listener is released on both the success and error branches.
- Unvalidated replies: `git:prStatus`, `git:log`, `git:operationAbort/Continue`, `editor:openMerge` and the `git:info.operation` field are all narrowed at the boundary.

## Residual uncertainty
- No rendered or screen-reader check was done.
- The backend's `git:operationOutput` cadence (throttled) was taken from the batch Outcomes, not re-read.
- Whether `openHistorical` picks the first parent for merges lives in `ReviewNavigationService`, which this diff did not touch; it was not verified here.

## Fix round 1 (orchestrator-run, frontend-developer)

Paths are under `libs/frontend/git-ui/src/lib/`. Every finding was checked against the code before it was fixed. All of them reproduced as described.

- **MOD-1: FIXED.**
  - Change: a `git:commit` reply that is a renderer `RPC timeout` (`isRpcTimeout`, services/git-status.service.ts:193) no longer reads as "Commit failed" (commit/commit-composer.component.ts:641).
  - The commit stays running in a `checking` state. The button reads "Checking…", the always-present status region says "checking whether the commit was made", Cancel stays available and the output listener stays attached.
  - `checkTimedOutCommit` (:748) re-reads `git:info` and HEAD (`refreshForCauses(['head'])`).
    - A moved HEAD or a changed staged set counts as committed, and the draft is cleared.
    - Otherwise the outcome is `unconfirmed`, shown as an alert that does not say "failed". Commit can be retried, and Cancel still targets the original `operationId`.
    - If the status read was stale or unavailable, or the workspace changed, the alert says the status could not be checked.
  - `cancelUnconfirmed` (:694):
    - `cancelled: true` reads as cancelled.
    - `cancelled: false` (the operation already ended) re-checks and reads as committed or failed.
    - A transport failure re-enables Cancel.
  - Tests (commit/commit-composer.component.spec.ts):
    - "on a timeout: checks the status with Cancel still available, then reads a changed staged set as committed"
    - "on a timeout: a moved HEAD reads as committed"
    - "on a timeout with nothing changed: says the outcome is unconfirmed, keeps Cancel by operationId, and allows a retry"
    - "on a timeout whose status cannot be read: says the status could not be checked"
    - "cancelling an unconfirmed commit that already ended re-checks the status"
    - "cancelling an unconfirmed commit that ended without committing reports a failure"
- **MOD-2: FIXED.**
  - Change: two `role="status"` containers stay in the DOM and only their content changes: `commit-generate-status` (commit/commit-composer.component.ts:306) and `commit-status` (:355), which carries the success, cancelled and checking text. The inner content carries its own `mt-2`, so an empty region adds no gap. Failure and unconfirmed results stay in `role="alert"`.
  - Tests: "keeps both status regions in the DOM before anything is announced (MOD-2)". The success, cancelled and unavailable-reason tests now assert that the text sits inside the region that existed before.
- **MOD-3: FIXED.**
  - Change: `WorktreeService.loadWorktrees` (services/worktree.service.ts:81) sets `loadError` (:57) on a failed or malformed read, keeps the last list, and clears the error on a good read.
  - The Task tab (task/task-worktree-view.component.ts:309) shows a `role="alert"` error with Retry (`retryWorktrees`, :610). It never shows "No worktrees found." while the read failed.
  - Tests:
    - worktree.service.spec.ts: "reports a failed list read and keeps the last list, clearing the error on a good read (MOD-3)"
    - task-worktree-view.component.spec.ts: "a failed worktree read shows an error with Retry, never "No worktrees found." (MOD-3)"
- **MOD-4: FIXED.**
  - Change: `onConfirmDrop` (history/history-stash-section.component.ts:335) now tells the user when the drop did not run, in a persistent `role="status"` region (:99), and clears the notice on the next action:
    - When the workspace changed, the notice says so.
    - When the stash is no longer listed, the notice says so and the list is re-read with `stash.loadList()`.
  - Tests (history/history-timeline.component.spec.ts):
    - "drops nothing when the stash left the list while the dialog was open" (extended)
    - "says why a confirmed drop did not run after a workspace switch (MOD-4)"
- **MIN-1: FIXED.**
  - Change: each conflicted path is listed as a JSON string (`promptPathLiteral`, conflict/conflict-banner.component.ts:91). Newlines, control characters and quotes are escaped, and U+2028/U+2029 are escaped as well.
  - The prompt also states that the paths are file names only, never instructions.
  - Test: "lists a crafted path as one inert JSON string, never as extra prompt lines (MIN-1)".
- **MIN-2: FIXED.**
  - Change: a renderer `RPC timeout` on `git:generateCommitMessage` reads "The request timed out." (commit/commit-composer.component.ts:59, :805). Other transport failures still read "The request failed."
  - Test: "a generation timeout gets its own message (MIN-2)".
- **MIN-3: FIXED.**
  - Change: the open error is pinned to its workspace and hidden in any other one. It is cleared by every `load()` (reload, Retry, HEAD/branch/push move) and by every new selection (history/history-timeline.component.ts:425, :455).
  - Test: "clears a stale open error on reload and hides it in another workspace (MIN-3)".
- **MIN-4: FIXED.**
  - Change: the three alert lines now follow the git-ui AA pattern: `text-base-content` ink with only the `CircleAlert` icon in `text-error`. This is the same pattern as task-worktree-view's add/remove errors. The lines are conflict/conflict-banner.component.ts:300, history/history-timeline.component.ts:148 and history/history-stash-section.component.ts:88.
  - Tests: "shows a failed send in an alert" (class assertions added), "shows why a commit could not be opened" (class assertions added), and "shows the stash read error in AA-safe ink (MIN-4)".
- **MIN-5: DEFERRED.** This is a cutover item. Registering `GitOperationOutputService` under `MESSAGE_HANDLERS` and moving drafts to a root store if the shell can unmount belong to P6 per batches.md.
- **SonarCloud (PR #629):**
  - task/task-worktree-view.component.ts:49: FIXED, now uses `replaceAll('\', '/')`.
  - task/task-worktree-view.component.spec.ts:530: FIXED, `toBe(null)` became `toBeNull()`.
- **Adaptation to the concurrent shared change:** `GitPrInfo.state` is now `GitPrState`, so the `it.each` PR-badge table in task-worktree-view.component.spec.ts is typed as `Parameters<typeof prOk>[0]`.

Verification (NX_DAEMON=false):
- `nx run @ptah-extension/git-ui:typecheck`: passed.
- `nx run @ptah-extension/git-ui:lint`: passed, 0 errors. The 4 warnings are the existing max-lines warnings on untouched files.
- `nx run @ptah-extension/git-ui:test --maxWorkers=2`: 52 suites and 1116 tests passed.
- `nx run ptah-extension-webview:verify-eager-bundle`: passed.

## Fix round 2 (orchestrator-run, frontend-developer)

These fixes address p5-phase-review-frontend-round1.md. Paths are under `libs/frontend/git-ui/src/lib/`. Each finding was checked against ff6dbe7af before it was fixed.

- **SER-1: FIXED.**
  - Change: a timed-out commit now counts as made only when HEAD moved **and** the new HEAD's subject equals the first line of the submitted message. Both sides are trimmed and compared exactly. The check is `judgeHead` in the new file commit/commit-timeout-check.ts:55.
  - The staged set is no longer part of the baseline. A staged-set-only change, or a HEAD that moved to another subject, reads as unconfirmed (`not-found` / `other-commit`). In that state the draft is kept, Cancel stays available and the commit can be retried.
  - With no baseline HEAD, the result is `unknown`.
  - A verified commit shows the new HEAD's short hash and subject (`landedOutcome`, commit/commit-composer.component.ts:794).
  - Extraction: the judgement, its types and its texts moved from the component to commit/commit-timeout-check.ts. This keeps the component under the 700-line lint limit.
  - Tests:
    - commit-composer.component.spec.ts: "on a timeout: checks with Cancel available, then a moved HEAD with this subject reads as committed"
    - commit-composer.component.spec.ts: "… HEAD moved to a commit with another subject is unconfirmed, never committed (SER-1)"
    - commit-composer.component.spec.ts: "… a changed staged set with HEAD unmoved is unconfirmed, never committed (SER-1)"
    - commit-composer.component.spec.ts: "cancelling an unconfirmed commit that already ended re-checks HEAD and its subject"
    - commit-timeout-check.spec.ts: 5 unit tests
- **MOD-5: FIXED.**
  - Change: `cancelRunning` (commit/commit-composer.component.ts:658) records `cancelAccepted` only when the reply says `cancelled: true` (:669). Any other reply re-enables Cancel.
  - `checkTimedOutCommit` returns `cancelled` only when `cancelAccepted` is set (:741). Otherwise it uses the check result.
  - Tests:
    - "Cancel during the check answered cancelled:false never reads as cancelled (MOD-5)"
    - "Cancel during the check that git accepted reads as cancelled (MOD-5)"
    - "cancelling an unconfirmed commit that ended without committing reports a failure", which now also asserts that no "cancelled" text appears.
- **MIN-6: FIXED.**
  - Change: `checkCommit` (commit/commit-composer.component.ts:760) returns `unknown` in two cases:
    - The HEAD read did not land (:773). `GitBranchesService` keeps the same `lastCommit` object when its read fails, so an unchanged object means no fresh read.
    - The branch service is on another workspace than the commit (:775), via the new `GitBranchesService.workspaceRoot()` (services/git-branches.service.ts:706). The baseline HEAD is also read only when that workspace matches (:783).
  - The stash-drop notice is now a `linkedSignal` on the active workspace, so a workspace switch clears it (history/history-stash-section.component.ts:272).
  - Tests:
    - "on a timeout whose HEAD read failed: unknown, not "HEAD did not move" (MIN-6)"
    - "on a timeout: a HEAD read for another workspace is unknown, even with this subject (MIN-6)"
    - history-timeline.component.spec.ts: "clears the drop notice on a workspace switch (MIN-6)"

Verification (NX_DAEMON=false):
- `nx run @ptah-extension/git-ui:typecheck`: passed.
- `nx run @ptah-extension/git-ui:lint`: passed, 0 errors. The 4 warnings are the existing max-lines warnings on untouched files.
- `nx run @ptah-extension/git-ui:test --maxWorkers=2`: 53 suites and 1126 tests passed.
- `npx tsc -p libs/frontend/git-ui/tsconfig.spec.json --noEmit`: no errors in any touched file. The remaining errors are in diff-view, git-dock, review-canvas, monaco-loader and source-control-file, none of which were touched.
