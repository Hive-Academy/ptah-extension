# Code Logic Review — `TASK_2026_576_e16a` (P4 Phase, Round 2)

Final round (round 2) logic review of P4 (`git diff origin/feat/task-2026-576-p3...HEAD`), focusing on commit `2790cf374` which addresses round 1 Part B findings `SER-B1`, `SER-B2`, `MOD-B1`, `MOD-B2`, `MOD-B3`, and `MIN-B1`.

Read-only review: no source files were edited, and no state-changing git commands were executed.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 9/10                                 |
| Assessment          | APPROVED (verdict: APPROVE)          |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 0                                    |
| Minor issues        | 0                                    |
| Failure modes found | 0                                    |

---

## Round 1 Part B Findings Re-check Table

Re-verification of Findings from `.ptah/specs/TASK_2026_576_e16a/reviews/p4-phase-review-antigravity-round1.md` against commit `2790cf374`:

| # | Round 1 Severity | Finding Description | Status | Evidence & Verification |
| - | ---------------- | ------------------- | ------ | ----------------------- |
| **SER-B1** | Serious | Concurrency conflict dialog mapped Cancel to "Reload" and focused Cancel, so Escape destroyed user edits and undo history without recourse | **FIXED** | [spot-editor.component.ts:454-462, 576-582, 649-655](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts#L454-L462) & [git-confirm-dialog.component.ts:60-98, 140-149](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/shared/git-confirm-dialog.component.ts#L60-L98). For concurrency conflicts, `confirmLabel` is `'Overwrite'`, `secondaryLabel` is `'Reload'`, and `cancelLabel` is `'Keep editing'`. Cancel/Escape triggers `onDialogCancelled()`, which now cleanly dismisses the dialog with `this.dialogKind.set(null)` without touching the buffer or undo history. Clicking "Reload" triggers `onSecondaryClicked()`, which reloads content from disk only upon deliberate selection. Tests in `spot-editor.component.spec.ts:384-406` and `git-confirm-dialog.a11y.spec.ts:85-110` pass cleanly. |
| **SER-B2** | Serious | External navigation away from spot editor (e.g. clicking Review on a change set card or opening stash) silently unmounted `<ptah-spot-editor>` and dropped unsaved user modifications | **FIXED** | [review-navigation.service.ts:133-144, 348-392](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/services/review-navigation.service.ts#L133-L144), [spot-editor.component.ts:717-765](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts#L717-L765), and [review-shell.component.ts:275-295](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts#L275-L295). `ReviewNavigationService` introduces a formal `ReviewLeaveGuard` port (`registerLeaveGuard()`). `ReviewShellComponent` registers `() => this.spotEditor()?.confirmLeave() ?? true` and releases it on destroy. In `ReviewNavigationService.navigate()`, if a navigation would replace or unmount an active editor (`replacesEditor = true`), it awaits the leave guard. If the guard refuses (returns `false` or throws/rejects), the navigation aborts and editor state remains intact. Concurrency between successive navigation attempts is resolved via monotonic tickets (`leaveTicket`). Tests in `review-navigation.service.spec.ts:145-180` and `spot-editor.component.spec.ts:420-455` pass cleanly. |
| **MOD-B1** | Moderate | Clicking Reload on stale disk change warning banner immediately reloaded and discarded modifications without confirmation | **FIXED** | [spot-editor.component.ts:192-203, 463-470, 587-594](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts#L192-L203). Banner Reload button now calls `reloadFromBanner()`. If `this.isModified()` is false, it reloads immediately. If modified, it prompts via `askDialog('reload')` with confirmLabel `'Discard and reload'` and cancelLabel `'Keep editing'`. User modifications are protected against accidental clicks. Tested in `spot-editor.component.spec.ts:408-418`. |
| **MOD-B2** | Moderate | Untracked files or files where git numstat yielded `null` additions/deletions bypassed the 3,000 changed-line cap, mounting massive files directly in Pierre | **FIXED** | [file-diff-section.component.ts:510-532, 543-570](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts#L510-L532). `FileDiffSectionComponent` now accounts for `loadedLines`. When numstat metadata is absent (`changedLines === null`), the component reads the diff text and measures actual line counts across both sides (`diff.original` and `diff.modified`). If the combined lines exceed `MAX_RENDERABLE_CHANGED_LINES` (3,000), `labelKind` is set to `'too-large'`, mounting is bypassed, and the user receives the large file banner with an explicit override button. Crucially, `readOverLineCap()` is kept outside `mountRequest` to prevent re-read cycles. Tested in `file-diff-section.component.spec.ts:210-238`. |
| **MOD-B3** | Moderate | File open requests arriving while a confirmation dialog was already open were silently dropped | **FIXED** | [spot-editor.component.ts:768-805](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts#L768-L805). `requestOpen()` now records `this.pendingRequest = request` when another dialog is active. When the active dialog closes (`onDialogConfirmed`, `onDialogCancelled`, or `onSecondaryClicked`), `resumeWaiting()` re-dispatches the pending request, ensuring user navigations are never dropped. Tested in `spot-editor.component.spec.ts:457-480`. |
| **MIN-B1** | Minor | Screen reader live announcement after draft comments send reports pre-send draft count if subsequent drafts are queued during RPC | **REJECTION ACCEPTED AS SOUND** | Verified in [draft-comments-bar.component.ts:170-195](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/review-canvas/draft-comments-bar.component.ts#L170-L195) and [draft-comments-bar.component.spec.ts:175-195](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/review-canvas/draft-comments-bar.component.spec.ts#L175-L195). The "Send" button is disabled throughout `isSending()` (`[disabled]="!hasDrafts() || isSending()"`), and the store's `send()` takes a snapshot of drafts at the moment transmission begins. Any draft created during transmission is not part of that transmission, so announcing the count of drafts that were actually sent is factually correct. Author's rejection is accepted. |

---

## In-depth Audit of Fixes and Regressions

### 1. `GitConfirmDialogComponent` Third-Button Contract & Focus Order
- **DOM & Tab Order**: In [git-confirm-dialog.component.ts:80-98](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/shared/git-confirm-dialog.component.ts#L80-L98), `#cancelButton` comes first, `#secondaryButton` comes second (when `secondaryLabel()` is present), and `#confirmButton` comes last.
- **Initial Focus**: On opening, `ngAfterViewInit` continues to focus `#cancelButton` (`cancelButton().nativeElement.focus()`).
- **Escape Key Contract**: `onKeydown` binds `Escape` directly to `this.cancel()` — it never triggers secondary or confirm actions.
- **Keyboard Tab Wrapping**: `trapFocus()` correctly handles 2-button and 3-button modals. `Tab` from `#confirmButton` wraps back to `#cancelButton`; `Shift+Tab` from `#cancelButton` wraps back to `#confirmButton`.
- **Verdict**: No regressions. Full WCAG 2.1 AA keyboard accessibility and focus trapping preserved.

### 2. `ReviewNavigationService` Leave Guard & Concurrency Contract
- **Guard Registration & Lifecycle**: [review-shell.component.ts:280-295](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts#L280-L295) registers the guard during initialization and unregisters it inside `destroyRef.onDestroy()`.
- **Concurrency & Stale Navigation Prevention**:
  - `navigate()` generates a monotonic `leaveTicket = ++this.leaveTicketCounter` before awaiting `leaveGuard()`.
  - If a newer navigation is requested while a leave dialog is pending, `this.leaveTicket !== leaveTicket` detects the stale request and discards it without corrupting state.
- **Fail-Closed on Throw or Rejection**:
  - If the leave guard throws an error or rejects, the catch block catches `error: unknown`, logs via `console.error`, and treats the outcome as `refuse()` (`return false`), leaving the editor safely intact.
- **Exemption for `backToReview()`**:
  - When returning from file editing back to the comparison list, `backToReview()` delegates to `this.navigate(...)`, which properly triggers the leave guard if modified.
- **Verdict**: Robust, non-racy implementation with complete defensive error handling.

### 3. `FileDiffSectionComponent` Post-Read 3,000-Line Cap
- **Dynamic Sizing**: In [file-diff-section.component.ts:510-532](file:///D:/projects/ptah-extension/.claude-worktrees/task-576-p4/libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.ts#L510-L532), when `changedLines()` is null, the loaded diff text line count is computed after the read completes. If the combined lines exceed 3,000, `this.labelKind.set('too-large')`.
- **Prevention of Re-read Loops**: The author deliberately excluded `readOverLineCap()` from `mountRequest` and only triggers the line count evaluation when `mountRequest` resolves. Once marked `'too-large'`, the diff view unmounts and the Pierre host is never instantiated unless the user explicitly clicks the override button.
- **Verdict**: Conforms strictly to the A9 performance gate without introducing async cycles.

### 4. `SpotEditorComponent` Concurrency & Pending Requests
- **Queued Requests**: If an external file open request arrives while a dialog is displayed, `this.pendingRequest` stores the target.
- **Resume Mechanism**: `resumeWaiting()` is invoked on all dialog exit paths (`confirm`, `secondary`, `cancel`), executing the queued navigation seamlessly.
- **Verdict**: Eliminates swallowed navigations completely.

---

## Five Logic Questions (Round 2 Assessment)

### 1. How does this fail silently?
**Resolved**:
- External navigation from `SpotEditorComponent` now invokes `ReviewLeaveGuard`. If unsaved modifications exist, the user is presented with a leave dialog. Navigations are blocked unless explicitly approved.
- File navigation requests arriving during open dialogs are stored in `pendingRequest` and resumed when the dialog closes. No requests are silently swallowed.

### 2. What user action produces unexpected behaviour?
**Resolved**:
- Pressing `Escape` on a save concurrency conflict dismisses the dialog with "Keep editing" (`this.dialogKind.set(null)`). The user's buffer and undo stack are completely preserved.
- Clicking "Reload" on the stale banner displays a confirmation dialog if modified, preventing inadvertent data loss.

### 3. What input data produces a wrong answer?
**Resolved**:
- Untracked files and files with `null` numstat line counts have their diff lines counted after reading. Files exceeding 3,000 lines display the large-file warning row rather than freezing the UI thread.

### 4. What happens when a dependency fails?
**Resolved & Verified**:
- If `leaveGuard()` throws or rejects, `ReviewNavigationService` catches the failure, logs the error, and aborts the navigation (`return false`), keeping the user safely in the editor.

### 5. What is missing that the requirements never mentioned?
**Addressed**:
- Three-way action support (`Overwrite`, `Reload`, `Keep editing`) in `GitConfirmDialogComponent`.
- Clean teardown of the leave guard on review shell unmount.
- Concurrency tickets preventing race conditions between rapid navigation clicks while leave dialogs are open.

---

## Failure Modes

All failure modes identified in Round 1 (`FM-B1`, `FM-B2`) are **RESOLVED**. No new failure modes were introduced in commit `2790cf374`.

---

## Requirements Fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Batch 37: Changed-file tree + comparison bar + stash routing gate | COMPLETE | Stash file routing properly gated; mutation actions and discard confirmed. |
| Batch 38: File diff section + review canvas | COMPLETE | 3,000 line cap enforced for both numstat-provided and `null`-numstat/untracked files. |
| Batch 41: `file:saveContent` registration + capability | COMPLETE | Atomic write, conflict detection, and capability registration verified. |
| Batch 42: CodeMirror spot editor | COMPLETE | Neutral dismiss on conflict dialog; protected reload from banner; queued open requests. |
| Batch 43: Review shell + FileContentChangesService | COMPLETE | Leave guard prevents unsaved edit destruction; monotonic leave tickets resolve navigation races. |
| Batch A9: Pierre worker pool + huge file cap | COMPLETE | Web Worker pool with main-thread fallback; CSP `worker-src blob:` configured. |

---

## Verification Evidence

All relevant unit, component, and accessibility test suites were executed and passed cleanly:

```bash
npx nx test @ptah-extension/git-ui --testFile="git-confirm-dialog.a11y.spec.ts|spot-editor.component.spec.ts|review-navigation.service.spec.ts|review-shell.component.spec.ts|file-diff-section.component.spec.ts"
```

**Results**:
- `git-confirm-dialog.a11y.spec.ts`: **Passed** (Keyboard trapping, 3-button focus order, Escape handling)
- `spot-editor.component.spec.ts`: **Passed** (Save conflict dialog neutral dismiss, banner reload guard, leave guard, pending request queue)
- `review-navigation.service.spec.ts`: **Passed** (Leave guard registration, navigation abort, leave ticket concurrency)
- `review-shell.component.spec.ts`: **Passed** (Leave guard registration and teardown on destroy)
- `file-diff-section.component.spec.ts`: **Passed** (Post-read line cap calculation for untracked/null numstat files)

Total: **5 test suites passed, 154 tests passed, 0 failed**.

---

## Verdict

- **Recommendation**: **APPROVE**
- **Confidence**: **HIGH**
- **Assessment**: All serious and moderate issues from Round 1 Part B have been rigorously resolved with clean, idiomatic Angular/TypeScript patterns, complete keyboard accessibility, and comprehensive test coverage. Rejection of `MIN-B1` was validated as technically correct. P4 logic is sound and ready for phase sign-off.
