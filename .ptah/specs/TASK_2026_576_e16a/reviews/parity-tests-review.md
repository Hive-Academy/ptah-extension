# Parity Tests Review - TASK_2026_576_e16a (Batch 62, Task 62.1)

- Reviewer: code-logic-reviewer subagent on Sonnet (independent stand-in for the planned reviewer; matrix author was an Opus senior-tester subagent; weaker-evidence label per the 2026-10-02 lane-availability note in context.md)
- Date: 2026-10-02
- Subject: `parity-tests.md` against `parity-inventory.md`, worktree `.claude-worktrees/task-576-cutover`, OLD surface `722d921ab`
- Verdict: **REVISE**
- Method: read-only. No git state changes, no code edits.

## 1. Structure check (inventory vs matrix)

- Row count: 118 in the inventory (S1 11, S2 10, S3 16, S4 8, S5 9, S6 9, S7 19, S8 8, S9 13, S10 5, S11 7, S12 3). Matrix has the same 118 ids (inventory table line numbers), same section order. PASS.
- Statuses: I recomputed keep = 64 (S1 6, S2 9, S3 1, S4 1, S5 8, S6 9, S7 10, S8 6, S9 4, S10 5, S11 5) and move = 51. They match the matrix counts. No `keep`/`move` row became a removal. PASS.
- Removals: exactly the 4 approved (S1 r39 file-view-tab half, S12 r215/216/217 incl. monaco-theme.spec). Gate 1 approval is recorded in context.md line 61. PASS. Caveat: see P-1, which is a behaviour loss that is not among the 4.
- Citation hygiene: I resolved all 374 `spec:line` citations mechanically. 359 land on an `it/test` line. The other 15 are 2 e2e wrappers (`mockedTest`/`realTest`, fine) and 13 in `review-canvas/file-diff-section.component.spec.ts`, which moved while I was reviewing because the row 135 fix inserted a `describe('layout in branch review')` block at line 291 (see P-14). No citation points at a spec Batch 64 deletes (checked rows against the deletion list in "Notes for the reviewer"); but see P-2 for one proof that exists only in a spec that will be deleted.

## 2. Rows sampled (47)

Mutating git state: r67, r70, r71, r76, r77, r89, r92, r107, r108, r109, r123, r124, r125, r139, r144, r145, r146.
Keyboard/a11y: r38, r40, r112, r127, r140, r144, r175-r181 (partly), r197.
Error paths: r35, r56-r59, r60, r73, r111, r126, r147, r161, r162.
Other: r31, r32, r33, r36, r41, r53, r72, r75, r78, r79, r80, r81, r90, r94, r110, r134, r135 (known), r136, r137, r138, r141-r143 (known), r150, r157-r160, r163, r164, r182, r183, r185, r187, r203-r209.

Tests opened and read (bodies, not just titles): changed-file-tree spec 170-570 (r41, r70, r71, r75, r76, r77, r79, r81), git-dock-header spec 100-297 (r53-r59, r112), hunk-toolbar spec 170-300 (r139, r144, r145, r146), spot-editor spec 266-325 and 884-986 (r157-r163), comparison-bar spec 165-245 (r134), history-timeline spec 495-640 (r105-r113), branch-picker spec 346-end (r119-r126), git-confirm-dialog a11y spec titles (r144), lazy-diff-view spec (r209), review-canvas spec 640-690 (r41), file-diff-section spec (r135-r138, r147, r148), task-worktree-view spec titles and 285-335 (r87-r93), commit-composer spec titles (r66, r67), review-shell spec titles (r32-r35).
Successor code confirmed: changed-file-tree `runMutation`/`confirmDiscard`/`onStageAll` (changed-file-tree.component.ts:1000-1100), hunk-toolbar outcome logic (hunk-toolbar.component.ts:296-330), `ReviewDiffService.applyHunks` (review-diff.service.ts:638-703), section header and chips (file-diff-section.component.ts:222-330, 610-632), worktree active-highlight (task-worktree-view.component.ts:600-603), header status line (git-dock-header.component.ts:208-222), spot editor link markers (spot-editor.component.ts:228-234).

Rows that held up well (test asserts the behaviour and the successor implements it): r67 (commit composer: timeout, hook failure, real-hook spec), r77 (discard confirm, untracked wording, workspace-change drop), r76 (row error, lock sentence, transport failure, busy), r89/r90/r91/r92/r93 (task view ported the old worktree spec 1:1 including the separator/trailing-slash active match), r134 (persist, late-read race, persist failure), r144 (dialog contract incl. top layer, Cancel focus, Escape, Tab cycle, no backdrop; reject token captured at open matches old `confirmRevert` semantics), r139, r140, r209, r105-r109 and r113 via history-timeline.

## 3. Findings

Severity follows the review brief: only the 4 Gate-1 removals may lose behaviour, so a behaviour loss without waiver is Serious.

### P-1 (Serious) - rows 39 and 40: close-tab and Delete key, and Left/Right wrap, have no successor and no waiver

- Inventory: r39 "Each tab has a close button"; r40 "Delete closes the focused tab"; old code `git-dock/git-dock.component.ts` `onDiffTabKeydown`: Delete calls `diffTabs.closeDiff`, Left/Right wrap with `(i + offset + n) % n` (read via `git show 722d921ab:.../git-dock.component.ts`).
- Matrix: r39 and r40 map only to "switching files" and "prev/next file". Neither mentions closing a diff, and the removal list covers only the multi-file-view-tab half of r39.
- Evidence: `changed-file-tree.component.spec.ts:553` shows `selectAdjacentFile(-1)` on the first file does nothing (no wrap). The continuous list has no per-file dismiss (grep of `review-canvas/*.component.ts` finds no close action).
- Missing: either a successor (per-file collapse/hide in the list, or a documented equivalent) with a test, or an explicit waiver recorded against Gate 1 note 1 saying "tab close and wrap are dropped because the canvas is a continuous list". Without that this is a fifth silent removal.

### P-2 (Serious) - row 160: the link-context markers on the successor are asserted nowhere that survives Batch 64

- Matrix cites only `chat/services/file-link-router.service.spec.ts:182,165`. Those tests build a synthetic DOM (`file-link-router.service.spec.ts:169,185-186`). They prove the consumer, not that the spot editor produces `data-ptah-link-document` / `data-ptah-link-root`.
- The producer exists (`spot-editor.component.ts:228-234`), but no spot-editor spec asserts it (grep `data-ptah-link` in `git-ui/src` hits only `file-view.component.spec.ts:144-145`, the OLD spec Batch 64 deletes).
- Impact: after deletion a refactor can drop the markers and every test stays green; links in a previewed markdown document would then resolve against the active root instead of the document (the original TASK behaviour at inventory r160).
- Missing: a spot-editor spec asserting both attributes on the preview container for a markdown file with a non-active workspace root.

### P-3 (Moderate) - rows 136 and 183: header content the old diff header carried is gone or unasserted

- Old header (`diff-view.component.ts:200-227` at 722d921ab) showed a comparison label (Staged / Working tree) and a "no changes" chrome chip. New section header (`file-diff-section.component.ts:222-262`, chips at 610-620) shows status badge, path, "renamed from", hunk count, new/deleted chips. No comparison label, no "no changes" chip.
- Effect: a file with both staged and unstaged changes appears as two sections (`review-canvas.component.ts:371-378`) whose headers are identical; only the hunk buttons (Unstage vs Accept) differ.
- Tests: no spec asserts "renamed from" rendering (grep `renamed from` in `file-diff-section.component.spec.ts` finds nothing); r136 cites `:278` (null old side, "new" chip) and `:292/:307` (binary label), none of which is the rename display or a comparison label. r183's tree citation (`changed-file-tree.component.spec.ts:593`) asserts the selection payload carries `originalPath`, not a rename display.
- Missing: a header test for rename display, a decision on the comparison label for the duplicate-path case (add a "Staged" chip or waive), and a decision on "no changes".

### P-4 (Moderate) - row 146: the apply-error banner no longer persists until dismissed

- Inventory r146: "kept until dismissed or superseded". Successor: the refusal chip is keyed to the diff object (`hunk-toolbar.component.ts:303-316`), and `ReviewDiffService.applyHunks` forces a re-read on every outcome (`review-diff.service.ts:690-693`). Any re-read yields a new diff object, so the sanitized sentence disappears as soon as the re-read lands, typically milliseconds later. There is no dismiss control.
- Test `hunk-toolbar.component.spec.ts:249` asserts exactly this clearing, so the test locks in a behaviour that differs from the inventory row without saying so.
- Missing: either keep the message until dismissed/superseded (it is the only feedback for a refused hunk apply) or record the change as a deliberate design decision. Row is marked `keep`, so as written it is a silent regression.

### P-5 (Moderate) - rows 70 and 71: stage-all / unstage-all failure display is not asserted

- r70/r71 say "RC1 result shown". The cited `changed-file-tree.component.spec.ts:424` only checks `stageAll`/`unstageAll` were called once; the failure sentences are proven for per-row stage (`:271`, `:317`) only. `onStageAll` runs through the same `runMutation` (changed-file-tree.component.ts:1043-1055) and stores the error under the section key, so the code probably works, but no test shows a section-level alert.
- Missing: one it.each for a section header failure (refusal, LOCKED, transport).

### P-6 (Moderate) - rows 119-127 (branch picker): the proof column is thinner than the matrix implies

- `branch-picker-dropdown.component.spec.ts` asserts: clean checkout, one-at-a-time, stash and switch, discard confirm, remote track, create-failure reason, "ten most recent" and search. It does not assert: current branch disabled, ahead/behind counts (r121), the Recent section UI (r120 cites only the service), Enter submits create (r125; the handler is `keydown.enter` at branch-picker-dropdown.component.ts:294), or close on outside click (r127; only the header spec covers Escape, `git-dock-header.component.spec.ts:138`).
- Note the OLD spec had only 2 tests (`git show 722d921ab:.../branch-picker-dropdown.component.spec.ts`), so the inventory overstated its own "test that proves it". The matrix inherited that without re-checking.

### P-7 (Moderate) - row 187: the cited ReviewDiffService proof does not show the coordinator reaches it

- `WorkspaceCoordinatorService.resolveGitServices` notifies only `GitStatusService`, `GitBranchesService`, `GitReviewService` (`workspace-coordinator.service.ts:124-128`); its spec (`:946`) asserts those three. `ReviewDiffService` implements `switchWorkspace` but is never called by the coordinator. Its real mechanism is the self-sync `syncWorkspace()` on mount/refresh (`review-diff.service.ts:743-746`), proven by `review-diff.service.spec.ts:1092`, which the matrix does not cite. The cited `:1052` and `:1059` test the unused public methods.
- A canvas that stays mounted across a switch keeps showing A's entries until the next mount or refresh; the matrix does not show a test for that window. Cite `:1092` and add or point to a test for a mounted canvas during a switch.

### P-8 (Moderate) - row 80: untracked-directory folder icon has no successor

- Inventory r80: "Untracked directories get a folder icon". Old row used a per-status icon plus folder icon. New tree has no folder-icon path for `isDirectory` rows (grep `Folder`/`isDirectory` in `changed-file-tree.component.ts` shows only the selection guards at 878/884). Badge states themselves are well covered (`file-status-badge.component.spec.ts:20`).
- Missing: the icon, or a waiver.

### P-9 (Moderate) - inventory omissions found in the OLD surface (neither inventoried nor matrixed)

1. Re-click revalidation (old `diff-tabs.service.ts:239-252`, A1 AC4): re-opening a row activated the tab and refreshed it. New row click only scrolls (`review-canvas.component.ts:546-559`); freshness now depends on pushes (RC11). Probably acceptable in Electron but not recorded.
2. Host theme detection (old `monaco-theme.ts:6-30`): read `data-vscode-theme-kind` (light and high-contrast) before `data-theme-mode`. New `pierre-config.ts:104-107` reads only `data-theme-mode`. The Skills clone-diff drawer runs in the VS Code webview, so verify `ThemeService` writes `data-theme-mode` in that host, or record the loss. `monaco-theme` removal is approved; its behaviour is not an approved loss.
3. Tab wrap-around (see P-1).

### P-10 (Minor) - rows 107 and 108: wrong citation for the RC2 timeout

- Cites `git-branches.service.spec.ts:420`, which is push/pull/fetch. The stash apply/pop timeout proof is `git-stash.service.spec.ts:164` (615_000 at :181). Behaviour is proven; the citation is wrong.

### P-11 (Minor) - row 111 and row 112: stash popover states unasserted

- `stash-popover.component.spec.ts` never sets `stash.error` or the loading signals (line 18 declares them, no test uses them). Error banner is proven only for the history timeline (`history-timeline.component.spec.ts:598`). The popover is the kept header surface, so cite or add tests for its error/loading/"No file changes" states. Outside click is covered (`:170`), Escape via the header (`:279`).

### P-12 (Minor) - row 36: the collapsed-pane "Show changed files" affordance was dropped

- Old git-dock added it to fix L-13 ("easy to miss" header control; `git-dock.component.ts:112-122`). Test `changed-file-tree.component.spec.ts:664` asserts "renders nothing", and the canvas is not blank so the original problem is lessened, but the in-pane button is gone without a note.

### P-13 (Minor) - shallow assertions

- r56: fetch spinner not asserted (`git-dock-header.component.spec.ts:253` only checks the call).
- r60: launch-status line rendering in the header is untested (`git-dock-header.component.ts:216-222`); the cited spec covers the service signal only.
- r78: "?" for unknown counts is implemented (`changed-file-tree.component.ts:396,399`) but no test sets null counts.
- r41/r79/r186: the new test (`review-canvas.component.spec.ts:651`) emits the tree's `openFile` output directly; no test clicks a tree row's Open-in and observes the emission (the tree spec only checks presence, `:529`).
- r161: "Loading file..." not asserted (cited `:962` is the read error). r162: blocked case without `externalOpenAllowed` (no Open-in) not asserted.
- r182: sticky header proven by class names only (`file-diff-section.component.spec.ts:269`); no scroll/layout evidence.
- r72: the per-section "No staged changes" / "No changes" items are replaced by one whole-tree empty message (`changed-file-tree.component.ts:696-710`); behaviour change not noted, tests only cover the whole-tree message.

### P-14 (Process) - matrix bookkeeping after the row 135 fix

- The row 135 fix landed while I reviewed (`file-diff-section.component.ts:627-632`, tests in the new block at `file-diff-section.component.spec.ts:291` onward: added/deleted forced to unified in branch mode, modified follows the canvas, worktree/staged added unchanged). Looks correct and matches the old rule (`git-review-file-row.component.ts:138`). The blocker in the matrix header and the Counts table (114 of 115) must be updated, and every citation into `file-diff-section.component.spec.ts` from line 291 on (rows 80, 136, 137, 138, 147, 148, 183, 184) needs re-resolving because the lines shifted by the new block.

## 4. Checks that found nothing

- Inventory and matrix order, ids, counts and statuses agree; the 4 removals match Gate 1 and `prototype/README.md`.
- No cited spec is deleted by Batch 64 apart from the P-2 case (the proof is not cited, but the only existing assertion is in a deleted spec).
- Rows 135, 142, 143 handled as the brief states (135 now has tests; 142/143 by design, accepted as proven through the hunk-row hosts `pierre-diff-host.component.spec.ts:396,423,435`).
- e2e results were not re-run by me; matrix e2e citations were only checked for being real `test(` lines.

## 5. Recommendation

REVISE. Resolve P-1 and P-2 before Batch 64 deletes the old surface (P-1 needs a decision: successor or recorded waiver; P-2 needs one test). P-3 to P-9 should be fixed or recorded as explicit waivers in `parity-tests.md`; P-10 to P-14 are matrix clean-up.

## Counts

- Rows sampled: 47
- Findings: 14 (Serious 2: P-1, P-2; Moderate 7: P-3 to P-9; Minor 4: P-10 to P-13; Process 1: P-14)
