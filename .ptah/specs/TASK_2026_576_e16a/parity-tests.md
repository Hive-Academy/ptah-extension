# Parity Tests - TASK_2026_576_e16a (Batch 62, Task 62.1)

Maps every row of `parity-inventory.md` (section order, rows numbered in table order) to its successor and the
passing test that proves it. Line numbers are the `it(...)` line in the worktree
`.claude-worktrees/task-576-cutover` at the time of writing. Paths are relative to
`libs/frontend/git-ui/src/lib/` unless a prefix says otherwise (`chat/` = `libs/frontend/chat/src/lib/`,
`webview/` = `apps/ptah-extension-webview/src/app/`, `e2e/` = `apps/ptah-electron-e2e/src/specs/git/`,
`vscode-core/` = `libs/backend/vscode-core/src/services/`, `skill/` = `libs/frontend/skill-synthesis-ui/src/lib/`).

## Blockers (rows with no green successor test)

**1 blocker.** It blocks Batches 63-66 until decided.

| Row | Capability | Why blocked |
| --- | --- | --- |
| S7 r135 | Added and deleted files in branch review are forced to inline layout (`keep`) | The successor does not do it. `review-canvas/file-diff-section.component.ts:447` passes the canvas-wide `diffStyle()` to Pierre for every file; no code path or test forces `unified` for an added/deleted file. The only related test (`file-diff-section.component.spec.ts:278`) checks a null old side and the "new" chip, not the layout. Decision needed: (a) force `unified` for `A`/`D` files in `file-diff-section` (product change plus a test), or (b) record an explicit waiver (Pierre renders a one-sided patch without a useless empty split pane). I changed no product code. |

Non-blocking findings:

- **Stale e2e, red today:** `e2e/row-stage-failure.spec.ts` still drives the OLD source-control panel through
  `support/source-control.ts` (`sourceControlFileButton`). I ran it: 1 failed (timeout waiting for the old "Toggle src
  folder" control). The RC1 behaviour it pinned is proven on the successor by unit tests (S3 r70, r71, r76 below), but the
  e2e needs retargeting to the canvas tree (or deleting) before or in Batch 64. `support/source-control.ts` goes with it.
  `docs-screenshots/editor-git.shot.ts` also imports it.
- **Gutter rows (S7 r142, r143) are mapped to the hunk rows, not to a gutter.** Pierre has no glyph margin. Batch 59's
  outcome records "Monaco glyph margin and floating widget have successors in the hunk rows". "A click on a non-hunk
  line does nothing" is true by construction (no gutter handler exists). Treated as proven by the hunk-row tests;
  say so if the reviewer wants it treated as a waiver.
- Row r39's multi-file-view-tab half is removal 1 below.

## Counts

| Status | Rows |
| --- | --- |
| keep | 64 |
| move | 51 |
| removed-approved | 3 table rows (S12) plus the tab half of S1 r39 = the 4 approved removals |
| Total inventory rows | 118 |
| keep/move rows with a green test | 114 |
| keep/move rows without one (blocker) | 1 (S7 r135) |

## The 4 approved removals (Gate 1)

Approved at Gate 1 (`context.md` "Gate 1 - APPROVED" 2026-09-29; recorded in `prototype/README.md`, Parity Mapping,
"the four Gate-1-approved `remove-proposed` rows ... as approved"; implementation-plan.md section 29 "approved removals
... deleted with no successor test `[user-requested: Gate 1 default 1]`"). They need no test.

1. Several file views open at once as tabs (S1 r39, file-view-tab half; `git-dock/git-dock.component.ts:127-191`). Successor: one-file spot editor (Requirement 7.4). Diff switching moved to the canvas tree and list (S1 r39 diff half is `move`, proven below).
2. `SourceControlService.getOriginalContent` (S12 r1; `services/source-control.service.ts:100-111`). No TypeScript caller; backend `git:showFile` stays.
3. `GitBranchesService.refreshTags` (S12 r2; `services/git-branches.service.ts:424-430`). No call site; backend `git:tags` stays.
4. `MonacoLoaderService` and `monaco-theme.ts` (S12 r3), with `services/monaco-theme.spec.ts`. Follows Requirement 8.

## Test runs

All run scoped, one project at a time, `NX_DAEMON=false npx nx run <proj>:test --maxWorkers=2 --skip-nx-cache`.

| Project | test | lint | typecheck |
| --- | --- | --- | --- |
| `@ptah-extension/git-ui` | 1155 passed / 53 suites (rerun after my 4 added tests; first run 1151) | pass | pass |
| `@ptah-extension/chat` | 1737 passed, 2 skipped (pre-existing) / 115 suites | pass | pass |
| `@ptah-extension/chat-ui` | 433 passed / 41 suites | pass | pass |
| `@ptah-extension/skill-synthesis-ui` | 428 passed / 28 suites | pass | pass |
| `ptah-extension-webview` | 313 passed / 14 suites | pass | pass |
| `@ptah-extension/vscode-core` (`--testPathPattern git-info.service`, cited backend specs) | 900 passed / 45 suites (pattern also matched other suites) | not run | not run |
| `@ptah-extension/ui` (`--testPathPattern file-status-badge`, cited for RC12 badges) | 575 passed / 30 suites (pattern also matched other suites) | not run | not run |

e2e: not re-run, except `row-stage-failure.spec.ts` (failed, see above). e2e citations rely on the Batch 59-61 and
verification-run results (all git specs passed after the renderer rebuild at `d2d1928f5`, except the out-of-scope C#
AST test in `e2e/hunk-apply-real-rpc.spec.ts:266`). e2e lines cited are the `test(...)` line.

## Tests added in this batch (4, specs only, no product code)

| Test | File:line | Row |
| --- | --- | --- |
| a tree row's Open-in launches the external editor at that file in the active workspace | `review-canvas/review-canvas.component.spec.ts:651` | S1 r41 (and S3 r79, S9 r186) |
| never selects an untracked directory row, and offers it no Open-in | `review-canvas/changed-file-tree.component.spec.ts:226` | S3 r81 |
| announces the current branch through a screen-reader status region | `git-dock/git-dock-header.component.spec.ts:119` | S2 r53 |
| keeps the file header pinned to the top of the list while the file's diff scrolls (class assertion: `sticky top-0`) | `review-canvas/file-diff-section.component.spec.ts:269` | S9 r182 |

## 1. Dock shell

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 31 | Lazy mount, retry on chunk failure | keep | `chat/components/templates/electron-shell.component.ts` loads `ReviewShellComponent` | `chat/components/templates/electron-shell.review-dock.spec.ts:157` loads nothing until the dock opens, then mounts ReviewShell; `:167` shows Retry when the chunk fails; `review-shell/review-shell.mount.spec.ts:217`; e2e `git-dock.spec.ts:194` |
| 32 | Arms status/branch listening on mount, disarms on unmount | keep | `review-shell/review-shell.component.ts` | `review-shell/review-shell.component.spec.ts:278` arms status and branches...; `:287` disarms; `:297` re-arms idempotently; `webview/git-dock-arming-identity.spec.ts:128,147,163,198` |
| 33 | Editor targets detected on mount | keep | `review-shell.component.ts` + `EditorLauncherService` | `review-shell.component.spec.ts:278` (`launchers.detect` once); `services/editor-launcher.service.spec.ts:20` |
| 34 | "Loading repository..." | keep | review shell | `review-shell.component.spec.ts:319` |
| 35 | "Not a Git repository" state; RC3: a transient failure must not show it | keep | review shell | `review-shell.component.spec.ts:333` never calls a failed first read "not a Git repository"; `:351` says it only for a readable result without a repo; `services/git-status.service.spec.ts:506,553,565` |
| 36 | Collapsed-rail empty state | move | `review-canvas/changed-file-tree.component.ts` (collapsed renders nothing; header toggle brings it back) | `review-canvas/changed-file-tree.component.spec.ts:664`; `review-shell/review-shell.mount.spec.ts:300`; e2e `git-rail-collapse.spec.ts:79` |
| 37 | Rail collapse/expand toggle, persisted | move | `git-dock/git-dock-header.component.ts` (re-hosted in the shell) | `git-dock/git-dock-header.component.spec.ts:102`; `review-shell.mount.spec.ts:300`; e2e `git-rail-collapse.spec.ts:79` |
| 38 | Rail resize (drag, keys, Escape, persist) | move | `git-dock/rail-resize-handle.component.ts` (re-hosted by the tree) | `git-dock/rail-resize-handle.component.spec.ts:31,40,111,143`; `changed-file-tree.component.spec.ts:639`; e2e `git-rail-collapse.spec.ts:79` |
| 39 | Tab strip of open diffs, switching files (diff half) | move | review canvas file tree plus continuous list | `review-canvas/review-canvas.component.spec.ts:369`; `changed-file-tree.component.spec.ts:218`; e2e `git-dock.spec.ts:251` every changed file gets its own independent diff section; `diff-view-state.spec.ts:165` (file-view half: removal 1) |
| 40 | Tab keyboard (prev/next file) | move | tree and canvas keyboard | `changed-file-tree.component.spec.ts:466,553`; `review-canvas.component.spec.ts:613` Alt+ArrowDown |
| 41 | Row Open-in launches the editor at the file | keep | tree row, `ReviewCanvasComponent.openInEditor` | `review-canvas.component.spec.ts:651` (added); `open-in/open-in-button.component.spec.ts:163`; `changed-file-tree.component.spec.ts:529` |

## 2. Header

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 51 | Branch button opens the picker | keep | `GitDockHeaderComponent` in the shell | `git-dock-header.component.spec.ts:138` |
| 52 | Branch details popover | move | `task/task-worktree-view.component.ts` branch panel; popover also kept | `task/task-worktree-view.component.spec.ts:638`, `:366`; `branch-picker/branch-details-popover.component.spec.ts:6` |
| 53 | Screen-reader live branch status | keep | header | `git-dock-header.component.spec.ts:119` (added) |
| 54 | Stash button with count, popover | keep | header, history timeline | `git-dock-header.component.spec.ts:279`; `stash/stash-popover.component.spec.ts:58`; `history/history-timeline.component.spec.ts:480` |
| 55 | Open-in for the workspace root | keep | header, task view | `git-dock-header.component.spec.ts:160`; `task-worktree-view.component.spec.ts:684` |
| 56 | Fetch with spinner (RC8 timeout) | keep | header | `git-dock-header.component.spec.ts:253`; `services/git-branches.service.spec.ts:371,420`; e2e `git-dock.spec.ts:91` |
| 57 | Pull, "behind N" (RC8) | keep | header | `git-dock-header.component.spec.ts:194,233`; `git-branches.service.spec.ts:420` |
| 58 | Push, "ahead N" (RC8) | keep | header | `git-dock-header.component.spec.ts:171,194`; e2e `git-dock.spec.ts:145` |
| 59 | Sync buttons disabled together, status line, stale-workspace discard | keep | header | `git-dock-header.component.spec.ts:233,261` |
| 60 | Editor-launch status line | keep | review shell | `services/editor-launcher.service.spec.ts:20,80` |

## 3. Source-control panel

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 66 | Commit message textarea | move | `commit/commit-composer.component.ts` | `commit/commit-composer.component.spec.ts:184,811` |
| 67 | Commit button (count, disabled, "Committing...", RC1 success check) | move | commit composer | `commit-composer.component.spec.ts:176,362,375,439`; `vscode-core/git-info.service.hooks.real-git.spec.ts:188,251` (real hook); e2e `commit-composer.spec.ts:127,190,225,278` |
| 68 | "Staged Changes (N)" with collapse | move | tree Staged section | `changed-file-tree.component.spec.ts:176,483` |
| 69 | "Changes (N)" with collapse | move | tree Changes section | `changed-file-tree.component.spec.ts:176,483` |
| 70 | Stage all (RC1 result shown) | move | tree section header action | `changed-file-tree.component.spec.ts:424`; `:271` (it.each, RC1 failure sentences) |
| 71 | Unstage all (RC1) | move | tree section header action | `changed-file-tree.component.spec.ts:424` |
| 72 | Empty states | move | tree | `changed-file-tree.component.spec.ts:454,628`; `review-canvas.component.spec.ts:491` |
| 73 | "Git status unavailable" notice (RC3: reasons, last good list) | keep | shell and canvas notice, change-set card | `review-canvas.component.spec.ts:499`; `review-shell.component.spec.ts:364`; `services/git-status.service.spec.ts:506,528,680,693` |
| 74 | Grouped folders | move | tree + `source-control/changed-file-tree.ts` (kept) | `changed-file-tree.component.spec.ts:194`; `source-control/changed-file-tree.spec.ts:4,54` |
| 75 | Row click opens that comparison's diff, `origPath` on renames | move | tree `fileSelected` to canvas | `changed-file-tree.component.spec.ts:218,593`; `review-canvas.component.spec.ts:602` |
| 76 | Per-row Stage/Unstage (RC1) | move | tree row | `changed-file-tree.component.spec.ts:245,260,271,317,335` (stale e2e `row-stage-failure.spec.ts`, see findings) |
| 77 | Per-row Discard (RC1, RC4) | move | tree row with confirm dialog | `changed-file-tree.component.spec.ts:355,388,405`; `vscode-core/git-info.service.paths.real-git.spec.ts:171,189` (real git) |
| 78 | +N/-N counts, "?" unknown (RC4 quoted paths) | move | tree row, change-set card | `changed-file-tree.component.spec.ts:194`; `vscode-core/git-info.service.paths.real-git.spec.ts:121` |
| 79 | Per-row Open-in | move | tree row | `changed-file-tree.component.spec.ts:529`; `review-canvas.component.spec.ts:651` (added) |
| 80 | Status icon/badge, a11y label, folder icon; RC12 states | move | `ptah-file-status-badge` in the tree | `changed-file-tree.component.spec.ts:194`; `libs/frontend/ui/src/lib/native/file-status-badge/file-status-badge.component.spec.ts:20,58`; `source-control/changed-file-tree.spec.ts:4`; `file-diff-section.component.spec.ts:292` |
| 81 | `isDirectory` rows never open a diff | move | tree | `changed-file-tree.component.spec.ts:226` (added) |

## 4. Worktree section

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 87 | Collapsible "Worktrees (N)" | move | `task/task-worktree-view.component.ts` | `task-worktree-view.component.spec.ts:302` |
| 88 | Refresh the list | move | task view | `task-worktree-view.component.spec.ts:366` |
| 89 | Add form (RC10 scoped) | move | task view | `task-worktree-view.component.spec.ts:409,444,464,478,489`; `services/worktree.service.spec.ts:490` |
| 90 | Row labels incl. locked/prunable | move | task view | `task-worktree-view.component.spec.ts:310` |
| 91 | Row click switches workspace | move | task view | `task-worktree-view.component.spec.ts:290`; e2e `task-worktree-view.spec.ts:56` |
| 92 | Remove with Remove/Force/Cancel, errors, locked | move | task view | `task-worktree-view.component.spec.ts:543,557,572,585,597,607,622`; e2e `task-worktree-view.spec.ts:222` |
| 93 | Empty state and spinner | move | task view | `task-worktree-view.component.spec.ts:333,350` |
| 94 | Auto-reload on `git:worktreeChanged`, unregister removed | keep | `services/worktree.service.ts` | `services/worktree.service.spec.ts:98,123,148,397,443` |

## 5. Stash

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 105 | List on open | keep | `stash/stash-popover.component.ts` (header), `history/history-stash-section.component.ts` | `stash/stash-popover.component.spec.ts:58`; `services/git-stash.service.spec.ts:82`; `history-timeline.component.spec.ts:480` |
| 106 | Select entry, list files | keep | same | `stash-popover.component.spec.ts:72`; `git-stash.service.spec.ts:130`; `history-timeline.component.spec.ts:607` |
| 107 | Apply (RC2 timeout) | keep | same | `stash-popover.component.spec.ts:86`; `history-timeline.component.spec.ts:506`; `vscode-core/git-info.service.remote-stash.real-git.spec.ts` (suite passed); `git-branches.service.spec.ts:420` |
| 108 | Pop (RC2) | keep | same | same as 107 |
| 109 | Drop with confirmation | keep | same | `stash-popover.component.spec.ts:97`; `history-timeline.component.spec.ts:514,531` |
| 110 | Stash file opens parent-vs-stash historical diff | move | `ReviewNavigationService.openStashFile` (canvas) | `services/review-navigation.service.spec.ts:169,201,233`; `git-stash.service.spec.ts:317` |
| 111 | Error banner, loading, empty, busy-disabled | keep | same | `stash-popover.component.spec.ts:66,118`; `history-timeline.component.spec.ts:598,625` |
| 112 | Close on outside click/Escape, focus returns | keep | same | `stash-popover.component.spec.ts:170`; `git-dock-header.component.spec.ts:279` |
| 113 | Pending drop resets | keep | same | `stash-popover.component.spec.ts:128,141,159` |

## 6. Branch picker

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 119 | Search | keep | `branch-picker/branch-picker-dropdown.component.ts` (unchanged location) | `branch-picker/branch-picker-dropdown.component.spec.ts:393` |
| 120 | Recent branches persisted | keep | picker, `GitBranchesService` | `services/git-branches.service.spec.ts:306,342` |
| 121 | Local branches, counts, 10 most recent | keep | picker | `branch-picker-dropdown.component.spec.ts:393` |
| 122 | Remote branch checkout (RC9: create/track) | keep | picker | `branch-picker-dropdown.component.spec.ts:346` |
| 123 | Local checkout (RC2, RC9) | keep | picker | `branch-picker-dropdown.component.spec.ts:61,73`; `git-branches.service.spec.ts:360,371` |
| 124 | Dirty guard: Stash & switch primary, Discard secondary | keep | picker | `branch-picker-dropdown.component.spec.ts:111,148,193,300` |
| 125 | Create branch (RC9 with dirty tree) | keep | picker | `vscode-core/git-info.service.switch.real-git.spec.ts:147,161`; `branch-picker-dropdown.component.spec.ts:367` |
| 126 | Error banner with the reason (RC9) | keep | picker | `branch-picker-dropdown.component.spec.ts:249,324,367` |
| 127 | Close on outside click/Escape | keep | picker | `git-dock-header.component.spec.ts:138` |

## 7. Diff view and hunk apply

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 133 | Side-by-side and inline diff | move | `renderer/pierre-diff-host.component.ts`, `review-canvas/file-diff-section.component.ts` | `renderer/pierre-diff-host.component.spec.ts:325,339`; `renderer/text-diff-view.component.spec.ts:171`; `file-diff-section.component.spec.ts:226`; `review-canvas.component.spec.ts:508` |
| 134 | Layout toggle, persisted | keep | `review-canvas/comparison-bar.component.ts` | `review-canvas/comparison-bar.component.spec.ts:171,196,219,234` |
| 135 | Added/deleted forced to inline | keep | none | **BLOCKER** (see top) |
| 136 | File header: path, rename, comparison, chip | move | section header | `file-diff-section.component.spec.ts:278,292,307`; `changed-file-tree.component.spec.ts:593` |
| 137 | Freshness chip (RC11) | keep | section header and body | `file-diff-section.component.spec.ts:527,541`; `services/review-diff.service.spec.ts:349,396`; e2e `diff-view-state.spec.ts:165` |
| 138 | Prev/Next hunk, position | move | `review-canvas/hunk-toolbar.component.ts` | `review-canvas/hunk-toolbar.component.spec.ts:120,301,310`; `file-diff-section.component.spec.ts:575` |
| 139 | Per-hunk actions by comparison | move | hunk toolbar | `hunk-toolbar.component.spec.ts:128,136,161,171`; `review-diff.service.spec.ts:849,915,967`; `vscode-core/git-info.service.apply-hunks.real-git.spec.ts:247,278,307`; e2e `hunk-apply-real-rpc.spec.ts:92` |
| 140 | Keyboard path to every hunk action | keep | hunk toolbar | `hunk-toolbar.component.spec.ts:335,356,459` |
| 141 | Mouse hunk cluster beside the hunk | move | Pierre hunk host plus toolbar | `pierre-diff-host.component.spec.ts:396,423`; `renderer/pierre-hunk-mapping.real-git.spec.ts:230`; e2e `hunk-widget-mouse.spec.ts:85` |
| 142 | Gutter click selects a hunk (non-hunk click no-op) | move | hunk rows | e2e `glyph-margin-visual.spec.ts:165`; `pierre-diff-host.component.spec.ts:396` (see findings) |
| 143 | One marker per hunk | move | hunk rows | e2e `glyph-margin-visual.spec.ts:165`; `pierre-diff-host.component.spec.ts:396,435`; `pierre-hunk-mapping.real-git.spec.ts:250` |
| 144 | Revert confirmation modal | keep | hunk toolbar plus `shared/git-confirm-dialog.component.ts` | `hunk-toolbar.component.spec.ts:209,221`; `shared/git-confirm-dialog.a11y.spec.ts:271,324,352,367`; e2e `hunk-revert-top-layer.spec.ts:174,238` |
| 145 | Stale-snapshot protection | keep | `ReviewDiffService.applyHunks` | `review-diff.service.spec.ts:358,934`; `hunk-toolbar.component.spec.ts:161`; `vscode-core/git-info.service.apply-hunks.real-git.spec.ts` (STALE_SNAPSHOT case at :610); e2e `hunk-apply-real-rpc.spec.ts:193` |
| 146 | Apply-error banner (sanitized) | keep | hunk toolbar | `hunk-toolbar.component.spec.ts:249,278,287`; `review-diff.service.spec.ts:1005` |
| 147 | Retry and error overlay | keep | section error row | `file-diff-section.component.spec.ts:488,507`; `review-diff.service.spec.ts:205,215` |
| 148 | Binary overlay | keep | section label row | `file-diff-section.component.spec.ts:292,307` |
| 149 | Loading and failed-to-load states | move | renderer lazy chunk and parse errors | `file-diff-section.component.spec.ts:217`; `renderer/text-diff-view.component.spec.ts:299`; `pierre-diff-host.component.spec.ts:485,501,529` |
| 150 | Per-file view state kept across switches | move | canvas anchor restore | `review-canvas.component.spec.ts:837,871,902`; e2e `diff-view-state.spec.ts:165,254`; `perf-m1-diff-redisplay.spec.ts:62` |
| 151 | Revalidation on pushes (RC11 scope, queue) | keep | `services/review-diff.service.ts` | `review-diff.service.spec.ts:396,450,498,567,639,652` |

## 8. File view

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 157 | One-file view at line/column | move | `spot-editor/spot-editor.component.ts` | `spot-editor/spot-editor.component.spec.ts:302`; `services/file-view-reader.service.spec.ts:42`; e2e `file-view-tab.spec.ts:28` |
| 158 | Read-only badge / state | move | spot editor | `spot-editor.component.spec.ts:267,311` |
| 159 | Markdown Preview/Source, 512 KB cap | keep | spot editor | `spot-editor.component.spec.ts:885,907` |
| 160 | Preview links resolve against document and root | keep | `chat/services/file-link-router.service.ts` | `chat/services/file-link-router.service.spec.ts:182,165` |
| 161 | Loading and error with Retry | keep | spot editor | `spot-editor.component.spec.ts:962` |
| 162 | Blocked state with reason, Open-in | keep | spot editor | `spot-editor.component.spec.ts:925` |
| 163 | "Open outside the workspace?" confirmation | keep | spot editor | `spot-editor.component.spec.ts:925`; e2e `agent-file-links.spec.ts:297` |
| 164 | Refresh on disk change (plus conflict choice) | keep | spot editor, `services/file-content-changes.service.ts` | `spot-editor.component.spec.ts:792,801,463`; `review-shell.component.spec.ts:850`; `file-content-changes.service.spec.ts:26` |

## 9. Branch review

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 175 | Working tree / Branch review toggle | move | `review-canvas/comparison-bar.component.ts` | `comparison-bar.component.spec.ts:111,128`; `review-canvas.component.spec.ts:415`; `review-shell.mount.spec.ts:314`; e2e `git-review-controls.spec.ts:14` |
| 176 | Base and head selects | move | comparison bar | `comparison-bar.component.spec.ts:128` |
| 177 | Totals | move | comparison bar | `comparison-bar.component.spec.ts:250,255` |
| 178 | Loading, error, empty states | move | canvas | `review-canvas.component.spec.ts:437,491,499`; `changed-file-tree.component.spec.ts:628` |
| 179 | Filter files (list and tree) | move | comparison bar filter, canvas, tree | `comparison-bar.component.spec.ts:152`; `review-canvas.component.spec.ts:472`; `changed-file-tree.component.spec.ts:613` |
| 180 | Tree with folders, click scrolls to diff | move | tree, canvas | `changed-file-tree.component.spec.ts:194,573`; `review-canvas.component.spec.ts:602` |
| 181 | Responsive: stacks below 520 px | keep | shell and tree | `review-shell.component.spec.ts:879`; `changed-file-tree.component.spec.ts:654` |
| 182 | Inline diff with sticky header | move | `file-diff-section` | `file-diff-section.component.spec.ts:269` (added, class assertion), `:226`; `review-canvas.component.spec.ts:415` (read-only branch review) |
| 183 | Status badge, rename display | move | section header, tree | `file-diff-section.component.spec.ts:278,292`; `changed-file-tree.component.spec.ts:194,593` |
| 184 | Binary badge and message | move | section label | `file-diff-section.component.spec.ts:292,307` |
| 185 | "Viewed" persisted per repository | keep | tree plus `services/git-review.service.ts` | `changed-file-tree.component.spec.ts:573`; `services/git-review.service.spec.ts:22` |
| 186 | Per-row Open-in | keep | tree and section header | `changed-file-tree.component.spec.ts:529`; `file-diff-section.component.spec.ts:317`; `review-canvas.component.spec.ts:651` (added) |
| 187 | Review state resets on workspace switch | keep | `GitReviewService`, `ReviewDiffService` | `chat/services/workspace-coordinator.service.spec.ts:946,958,586`; `services/review-diff.service.spec.ts:1052,1059` |

## 10. Open-in

All five rows are `keep`, location unchanged (`open-in/open-in-button.component.ts`).

| # | Capability | Proving test |
| --- | --- | --- |
| 193 | Primary button, brand icon, full/icon-only | `open-in/open-in-button.component.spec.ts:61,76` |
| 194 | Caret menu, terminal hidden with a file path | `open-in-button.component.spec.ts:99,111,149` |
| 195 | Remembers last editor | `open-in-button.component.spec.ts:163,184,202` |
| 196 | Disabled state title | `open-in-button.component.spec.ts:49` |
| 197 | Close on outside click/Escape, focus to caret | `open-in-button.component.spec.ts:125,234,249` |

## 11. Routing, push handling, consumers

| # | Capability | Status | Successor | Proving test |
| --- | --- | --- | --- | --- |
| 203 | Electron file link reveals the dock and opens the file | move | `FileLinkRouterService.openInDock` to `ReviewNavigationService.openFile` | `chat/services/file-link-router.service.spec.ts:222,238,259,275`; e2e `agent-file-links.spec.ts:134,359` |
| 204 | VS Code link opens natively | keep | unchanged | `file-link-router.service.spec.ts:297,321,340,362` |
| 205 | Link context resolution | keep | unchanged | `file-link-router.service.spec.ts:130,150,165,182,200,210` |
| 206 | Workspace switch fan-out, stale-switch guard | keep | unchanged | `chat/services/workspace-coordinator.service.spec.ts:946,958,586` |
| 207 | Push routing without eager UI load | keep | webview composition root | `webview/git-status-message-routing.spec.ts:144`; `webview/git-dock-arming-identity.spec.ts:163`; `webview/review-shell-message-handlers.spec.ts:69,130,146`; `services/git-status.service.spec.ts:872`; `services/git-branches.service.spec.ts:631`; `services/worktree.service.spec.ts:98`; `services/review-diff.service.spec.ts:824` |
| 208 | Per-workspace status cache, 5 s background freshness | keep | `services/git-status.service.ts` | `services/git-status.service.spec.ts:87,96,123` |
| 209 | Skills clone-diff drawer renders lazily, no git header | move | `skill/components/clones/lazy-diff-view.component.ts` renders `TextDiffViewComponent` (Pierre) | `skill/components/clones/lazy-diff-view.component.spec.ts:68` (no static git-ui import), `:87` loading until chunk, `:101` passes texts/name/theme, `:115`, `:150` error and retry. The spec now exists (the inventory said none). |

## 12. Non-UI API surface

All three are approved removals (see list above): `getOriginalContent`, `refreshTags`, `MonacoLoaderService` and
`monaco-theme.ts`. They are still present on disk today (`services/source-control.service.ts`,
`services/monaco-loader.service.ts`, `services/monaco-theme.*`); Batch 64/65 delete them.

## Notes for the reviewer

- Several kept components (`GitDockHeaderComponent`, `RailResizeHandleComponent`, branch picker, stash popover,
  open-in, the services) keep their existing specs as the proof, because they are re-hosted, not replaced. Their
  specs survive Batch 64 (the plan deletes only `git-dock/git-dock.component.*`, `git-dock.mount.spec`,
  `source-control` components, `diff-view`, `file-view`, `review/git-review-*`, `worktree-section`,
  `diff-tabs.service`, Monaco). No row above cites a spec that Batch 64 deletes.
- Backend specs cited under `vscode-core/` were run as a group (`--testPathPattern git-info.service`, 900 passed).
- Not proven by me, outside the five required projects: backend `git-rpc.handlers` (not cited as a proof).
