# Cutover phase logic review — TASK_2026_576_e16a

- Reviewer: code-logic-reviewer subagent on Sonnet (fallback for a CLI lane of another family; none available). Weaker evidence: static reading plus one run of the classifier against the local `dist/apps/ptah-extension-webview/stats.json`; no tests, builds, or live app were run.
- Branch: `feat/task-2026-576-cutover`, diff `origin/main...HEAD` (131 files in scope).
- Score: 7/10
- Verdict: REVISE (one serious, a few moderate; nothing blocking, VS Code isolation holds)
- Counts: SER 1, MOD 4, MIN 3

## Priority checks, result

1. **VS Code never reaches Electron-only chunks: HOLDS.**
   - Every `import('@ptah-extension/git-ui')` is Electron-gated:
     - `electron-shell.component.ts:377` (Electron shell only).
     - `change-set-actions.service.ts:141` and `file-link-router.service.ts:123` sit behind `this.vscode.isElectron` (`:100`, `:96`).
   - The coordinator uses the services-only entry (`workspace-coordinator.service.ts:126`), and `app.config.ts:74` is the only static import, also of `/services`.
   - Skill-synthesis imports only `git-ui/diff-renderer`. Its closure (`renderer/**`) has no runtime import of a non-shared git-ui dir (type-only import at `editor-launcher.service.ts:10`).
   - I ran `classify()` on the local stats.json: 126 dropped, 466 kept. Three kept chunks dynamically import dropped ones (`chunk-C2ReQF_a` = git-ui `index.ts` and the review shell, `chunk-Bz1L8Sk02` = spot editor). All are reachable only through the gated Electron imports, so this is dead weight in the VSIX, not a runtime hazard.
2. **MESSAGE_HANDLERS cover every push type `DiffTabsService` handled.** It handled `git:status-update` and `file:content-changed`. `ReviewDiffService` handles both (`review-diff.service.ts:269`), and `GitStatusService`, `GitBranchesService`, `WorktreeService`, `FileContentChangesService` and `GitOperationOutputService` are registered (`app.config.ts:237-253`). `git:turnChangeSet` stays with `change-set.store.ts`. `GitReviewService` has no push types and needs no entry.
3. **Dock Retry on chunk failure: OK.** `dockLoadFailed` flips, the template renders Retry (`electron-shell.component.ts:278`), and `retryDockLoad` re-triggers the effect because the signal is tracked.
4. **Anchor restore vs user:** mostly safe, see MOD-3.
5. **Deleted-file references:** no live import of `source-control.ts`, `monaco-*`, `DiffTabsService` or the deleted panels. Remaining hits are comments and CI cache notes only.

## Findings

### SER-1 Review navigation state survives a workspace switch

- File: `libs/frontend/git-ui/src/lib/services/review-navigation.service.ts:146-163` (root singleton, never reset). `workspace-coordinator.service.ts:126-133` resets `ReviewDiffService` and `GitReviewService` but not navigation.
- Scenario: the user opens a commit (`openHistorical`) or a stash file in workspace A. The scope is `historical{base,head SHAs,files}` and the target may be `file`. They then switch to workspace B.
- Evidence: `ReviewDiffService` reads with `activeWorkspacePath()` (`review-diff.service.ts:667-682`), not the scope's workspace. The canvas keeps rendering A's file list and SHAs, and each section issues `git:reviewFile` against B's repo with A's SHAs.
- Impact: the comparison bar and file list show the wrong repository, and every section fails with "Git could not read this file" (a misleading error, not data loss). A spot editor opened in A also stays pointed at A's path.
- Fix: reset the navigation to `INITIAL` on workspace change. Either call `reset()` from `WorkspaceCoordinatorService.switchWorkspace` (add `ReviewNavigationService` to the list), or have the shell `effect` on `activeWorkspacePath` and, if it changed and the scope or target is `historical`, `change-set` or `file`, commit the initial state. Honour the leave guard so unsaved edits are not dropped silently.

### MOD-1 In-flight navigations are not ordered, so a slower earlier click wins

- File: `review-navigation.service.ts:236-278` (`openHistorical`), `:295-342` (`openStashFile`); caller `git-stash.service.ts:388`.
- Scenario: the user clicks stash file A then B quickly, or commit A then commit B. Each call captures `seq` before its RPC and checks it after. The seq changes only on a committed navigation, so both pass. Whichever RPC returns last lands. `GitStashService.fileDiffToken` (`:385`) guards only the pre-navigation await, not the one inside `openStashFile`, and the call is not awaited.
- Impact: the canvas shows the earlier click's diff although the user last chose another file.
- Fix: bump a `requestTicket` counter at the start of each async navigation and compare it, instead of `seq`, after the await. Return `{opened:false,error:null}` when superseded.

### MOD-2 Collapsing a file silently discards an in-progress comment draft

- File: `file-diff-section.component.ts:748-756` (`composer` cleared when `canComment()` goes false) together with `:664-668` (`mountRequest` is null when collapsed, so `diff()` is null).
- Scenario: the user types a comment, then presses Delete in the header (which does not require focus in the textarea) or collapses via the toggle or the tree's Delete. The composer text is dropped with no notice.
- Fix: keep `composer` while collapsed (skip the clear when `collapsed()`), or collapse only the diff body and keep the composer mounted.

### MOD-3 Anchor restore: smaller gaps

- File: `review-canvas.component.ts:790-830` (`startRestore`, `reanchor`).
- (a) The restore gives up after `RESTORE_MAX_FRAMES = 60` (about 1 s). On a slow first read where heights are still estimated, the position can land wrong and is then saved as the new anchor by `trackActiveFile` (`:737-741`).
- (b) The user-input listeners cover `wheel`, `touchstart`, `pointerdown` and `keydown` on the scroller. Keyboard scrolling from the tree (Alt+Down) goes through `scrollToFile`, which calls `stopRestore` (`:843`), so that case is covered. Dragging the scrollbar with a pen or touch is a `pointerdown`, also covered.
- (c) Restoring never runs when the saved anchor's file id vanished: it silently resets to `scrollTop = 0` (`:782-785`). An id includes the staged/worktree kind, so staging a file changes its id and invalidates the anchor and its collapsed state.
- Fix: for (c), key anchors and `collapsedIds` by `scope + path` rather than by `kind + path` for the two status scopes, or fall back to the nearest surviving neighbour. For (a), accept it, or extend the cap while measured heights keep changing.

### MOD-4 `shiki` imported without being a declared dependency

- File: `pierre-config.ts:140` (`import('shiki/themes/github-light-high-contrast.mjs')`). `package.json` does not list `shiki`; it resolves only through hoisting of `@pierre/diffs`' transitive dependency.
- Impact: a dedupe or npm version change that no longer hoists `shiki` breaks the build, or with a nested copy bundles a second shiki. A failed theme load in light mode also has no visible fallback (highlighting disappears silently; no error surfaced).
- Fix: add `shiki` (a version matching `@pierre/diffs`' range) to `package.json`, and log or handle a rejected `registerCustomTheme` loader (fallback to `pierre-light`).

### MIN-1 Classifier robustness

- File: `scripts/electron-only-chunks.js:100-135`, `scripts/copy-webview.js:19-27`.
- Missing stats.json throws loudly, which is correct. A stale stats.json is harmless in practice because esbuild chunk names are content-hashed: a stale list names files that no longer exist, and new chunks are kept (safe direction).
- The remaining blind spot is a build with `statsJson` on but a classification built from a *different* configuration than the copied `browser/` dir; `copy-webview` does not check that every listed file exists. Add a warning when fewer than N listed files are found in `src`, and assert in `assert-eager-bundle.mjs` that `main.js` plus the lazy chunks reachable from VS Code entry points are not in the dropped set.
- Also note `path.resolve(...).toLowerCase()` makes the skip case-insensitive on Linux, where two chunk names differing only in case are possible (esbuild names are mixed case, e.g. `chunk-Bz1L8Sk02.js`). A collision would also skip the kept sibling. Use exact-case comparison off Windows.

### MIN-2 Hunk refusal chip

- File: `hunk-toolbar.component.ts:146-170`. If the forced re-read after a refusal errors (token never changes), `awaitingReread` stays true, so Accept/Reject never return, even after the chip is dismissed. The section's stale note has a Retry, so recovery exists, but the toolbar should return once the chip is dismissed.

### MIN-3 Tab stops per diff

- File: `pierre-config.ts` `labelPierreDiff` adds `tabindex="0"` to every `code[data-code]`. With split style that is two stops per file, per rendered file. Acceptable for axe, but it is a cost for keyboard users on large canvases; consider `tabindex` only on panes that actually overflow.

## Five logic questions

1. Silent failure: SER-1 (wrong-workspace reads surface as per-file generic errors), MOD-2 (comment drafts lost on collapse), MOD-4 (light theme load failure).
2. Unexpected user action: rapid clicks (MOD-1), switching workspaces with a commit open (SER-1), collapsing while commenting (MOD-2), staging a collapsed file (MOD-3c).
3. Wrong answer from input: historical SHAs applied to another repo (SER-1); the hunk context fix (`pierre-diff-host.component.ts:327`, `{ context: 3 }`) now matches git's `-U3` merging rule, so the earlier off-by-one hunk mapping is addressed.
4. Dependency failure: dock chunk failure is handled (Retry, reveal undone by routers); a stats.json absence fails the VSIX copy loudly; `git:reviewChanges` failure falls back to listing rows.
5. Missing: workspace-scoped navigation reset; a "workspace changed" invalidation test; an assertion that the VSIX contains no module reaching a dropped chunk statically (the fixpoint guarantees it today but nothing tests it at the VSIX layer).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Mount review shell with Retry | COMPLETE | none |
| `FileContentChangesService` and `GitOperationOutputService` registered | COMPLETE | spec asserts it |
| Links and card actions via `ReviewNavigationService` | COMPLETE | no ordering for in-flight navigations (MOD-1) |
| Coordinator resets new services | COMPLETE | navigation state not reset (SER-1) |
| Old surface deleted, no runtime references | COMPLETE | comments and CI notes still mention Monaco |
| Monaco removed and VSIX excludes Electron-only chunks | COMPLETE | MOD-4, MIN-1 |
| Axe fixes | COMPLETE | undeclared `shiki` dependency |
| Conflict disables primary actions | COMPLETE | `commit-composer.component.ts:488-499`, `task-worktree-view.component.ts:491-497` |

## Verdict

REVISE. Fix SER-1 before merge; MOD-1, MOD-2 and MOD-4 should land with it. Confidence: MEDIUM (static review, partial dist evidence).

## Fix round 1 (orchestrator-run, frontend-developer)

| Finding | Status | Where | Test |
| --- | --- | --- | --- |
| SER-1 | FIXED | `review-navigation.service.ts:358` `switchWorkspace`, `:367` `removeWorkspaceState`, `:379` `resetWorkspaceState`. The service records which workspace its scope or target was opened in (`commit`). When the active workspace changes, or that workspace is removed, it drops a historical scope, change set, diff target or file target. The tab and a generic comparison (worktree, staged or branch) stay. A spot-editor target still asks the leave guard. Its commit comparison is dropped at once, and the editor goes only when the user discards. Opens still in flight are superseded. Exported from `git-ui/src/services.ts:26`. `workspace-coordinator.service.ts:135` resolves it with the other git services through the dynamic `import('@ptah-extension/git-ui/services')`, listed last so it reads `GitStatusService`'s new path. | `review-navigation.service.spec.ts` "workspace switch and removal" (7 tests); `workspace-coordinator.service.spec.ts` real-singleton switch and removal assertions, plus "drops a spot-editor file opened in the workspace being left (SER-1)" |
| MOD-1 | FIXED | `review-navigation.service.ts:249`, `:307`: `openTicket` bumped per `openHistorical`/`openStashFile` and on workspace reset. `superseded()` (`:397`) compares ticket, seq and workspace after the await, so the latest click wins. | "in-flight opens (latest click wins)" (3 tests: commit vs commit, stash vs stash, stash vs commit) |
| MOD-2 | FIXED (kept, not blocked) | `file-diff-section.component.ts:671`: the composer is cleared only when the owner goes away, or when a landed read is an error or a label. An unmounted read (collapsed or scrolled out of the window) keeps the draft, its side and its line range. A collapsed header shows a "comment in progress" chip (`:603`), and expanding restores the composer. | "collapsing keeps an in-progress comment…", "scrolling out of the window keeps…", "drops the composer when the owner goes away" |
| MOD-3 (a) | FIXED | `review-canvas.component.ts:834` `hasPendingRead`. While a section in the window still holds its placeholder (its first read has not landed), the restore keeps going past 6 stable frames. The cap rises from 60 to 300 frames, about 5 s (`review-canvas-position.ts`). User input still stops it. | "keeps re-anchoring past the frame cap while a section in the window waits for its first read" |
| MOD-3 (c) | FIXED | Anchors also store `path`, and `anchorSection` (`review-canvas.component.ts:825`) falls back to the same path's section when staging changed the id. Collapsed state moves to the file's new id (`collapsedCarrier`, `review-canvas-position.ts:76`, wired at `review-canvas.component.ts:458`). The anchor/restore state moved to the new `review-canvas-position.ts` to keep the canvas under `max-lines`. | "restores to a file that was staged while the body was hidden", "keeps a collapsed file collapsed when staging changes its id" |
| MOD-4 | FIXED | Pierre re-exports no shiki theme or grammar module (exports: `. ./edit ./react ./ssr ./worker`), so the direct `shiki/themes/*` and `shiki/langs/*` imports are real. Root `shiki` is 4.4.3, hoisted from astro; Pierre has its own nested 4.5.0. Declared `"shiki": "4.4.3"` in `package.json:195` with `npm install shiki@4.4.3 --save-exact --package-lock-only --ignore-scripts`. The lock diff is the root entry only. The light theme loader now falls back to a plain readable theme and logs the failure (`pierre-config.ts:161` `loadPtahLightTheme`). | `pierre-config.spec.ts` "falls back to a plain readable light theme, logged…" |
| MIN-1 | FIXED | `electron-only-chunks.js:124` `assertStatsMatchBuild`: `generate` throws unless the top-level JS in `browser/` matches the stats.json JS outputs exactly, which catches a stale or foreign stats.json. `:152` `assertEagerClosureKept` throws if a dropped chunk is in `main.js`'s static closure. `copy-webview.js:22`: skip-path comparison is exact-case except on win32. | `packaged-deps.spec.ts` "stale or mismatched stats.json (MIN-1)" (5 tests) |
| MIN-2 | FIXED (narrowed) | A failed re-read does not strand the toolbar. `ReviewDiffService.readOnce` always replaces the diff object (status error or stale), and that ends `currentOutcome`. The remaining case is a re-read that never lands (parked at `refreshing`). Dismissing the chip now clears a refused outcome (`hunk-toolbar.component.ts:470`). That is safe: a refusal wrote nothing, and a stale token is refused again. | "brings the buttons back on dismiss when the forced re-read never lands" |
| MIN-3 | REJECTED (accepted as is) | Pierre styles every `[data-code]` pane `overflow: var(--diffs-overflow-override, scroll) clip` (`@pierre/diffs/dist/style.js`), so each split pane scrolls horizontally on its own. Its tab stop is the only keyboard route to that scroll (axe `scrollable-region-focusable`). Giving tabindex only to panes that overflow would need a resize observer per pane, one per rendered file. The repository's runtime rule forbids that. | n/a |

Verification (NX_DAEMON=false, NODE_OPTIONS=--no-experimental-require-module, `--maxWorkers=2`, one project at a time):

- git-ui: typecheck OK; lint 0 errors (1 warning: pre-existing `spot-editor.component.ts` max-lines); test 41 suites, 944 passed.
- chat: typecheck OK; lint 0 errors (pre-existing warnings); test 125 suites, 1893 passed, 2 skipped.
- ptah-extension-webview: typecheck OK; lint OK; test 14 suites, 386 passed.
- skill-synthesis-ui: typecheck OK; lint 0 errors (3 pre-existing warnings); test 31 suites, 507 passed.
- `npx nx run ptah-electron:test --maxWorkers=2 --testPathPatterns=packaged-deps`: 16 passed.
- `npx nx run ptah-extension-webview:verify-eager-bundle` (without NODE_OPTIONS): passed. No forbidden markers. Electron-only chunks: 126 of 591, and the new stats/browser match and eager-closure checks passed. This rebuilt `dist/apps/ptah-extension-webview` only; the Electron renderer copy under `dist/apps/ptah-electron` was not touched.
