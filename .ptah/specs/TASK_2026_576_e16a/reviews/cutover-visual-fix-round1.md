# Cutover visual fix, round 1 (TASK_2026_576_e16a)

Source findings: `reviews/cutover-visual-review.md` (V-1 to V-9). Worktree `.claude-worktrees/task-576-cutover`, branch `feat/task-2026-576-cutover`. Nothing is committed: every change is in the working tree. I did not rebuild Electron and did not run e2e.

**Ownership note.** Partway through, the coordinator gave `review-canvas.component.ts`, `file-diff-section.component.ts`, `review-canvas-position.ts` and `review-navigation.service.ts` (each with its spec) to a second writer. I had already edited two of them, so I took my hunks back out with `git apply -R` of my own patch. The second writer's changes were not touched. Those hunks are listed under "Handoff patch" below, waiting for the coordinator to apply them.

## Findings

| Finding | Status | file:line | Test |
| --- | --- | --- | --- |
| V-1 header and tab strip clip at 300-340 px | FIXED | `git-dock/git-dock-header.component.ts:60` (row is now `flex-wrap min-h-8`); branch group `flex-[1_1_10rem] min-w-0`; sync group `ml-auto flex-shrink-0`, which keeps Open in, Fetch, Pull and Push together and moves them to a second row when they do not fit; `:158` makes Open in icon-only when the dock is compact, with an unchanged aria-label. `review-shell/review-shell.component.ts:38` adds `COMPACT_BELOW_PX = 400`, driven by the shell's existing ResizeObserver (no new observer). `:126` adds a compact tab strip (tighter padding, 12 px text, `overflow-x:auto` as a last resort, no -1px overlap), so no tab label clips. | `git-dock-header.component.spec.ts` "wraps the sync group…", "shows Open in icon-only when compact…"; `review-shell.component.spec.ts` "turns the header and tab strip compact below 400 px from the same observer" |
| V-2 long branch name overlaps controls | FIXED | `git-dock/git-dock-header.component.ts:98`: trigger is `min-w-0 max-w-[14rem] shrink flex-nowrap`; label `<span class="min-w-0 truncate">` (testid `current-branch-label`); full name in `title` (`branchLabel` computed). The controls keep their width (`flex-shrink-0` group). | `git-dock-header.component.spec.ts` "truncates a long branch name and keeps the full name in the title (V-2)" |
| V-3 Open-in caret focus outline is transparent | FIXED | `open-in/open-in-button.component.ts:44`. Cause: daisyUI `.dropdown > *:not(summary):focus { outline: 2px solid transparent }` has specificity (0,2,1), which beats both the global `button:focus-visible` ring and any `focus-visible:outline-*` utility. Fix: a component rule `.open-in-caret:focus-visible { outline: 2px solid oklch(var(--s)); outline-offset:-2px }`, plus an anubis-light override to `--ptah-gold-strong`. This is the same token pairing as the global focus rule in `styles.css`. | `open-in-button.component.spec.ts` "gives the dropdown caret the same visible focus ring as its siblings (V-3)" |
| V-4 filter input and commit textarea have a 20%-alpha ring | FIXED (handoff for comment-composer inputs) | `review-canvas/comparison-bar.component.ts:191` and `commit/commit-composer.component.ts:274`. Both get `focus-visible:outline-[oklch(var(--s))]`, the button token. The utility layer (0,2,0, emitted later) beats daisyUI `.input:focus`. anubis-light already maps that exact class to `--ptah-gold-strong` (`styles.css:591-596`). The same class was also applied to the other git-ui text fields: the branch-picker filter and new-branch inputs, and the Task add-worktree inputs. The comment-composer inputs in `file-diff-section.component.ts` need the same class and are in the handoff patch. | Not unit-tested. It is a class token whose effect depends on cascade order, which jsdom does not compute. Verify with the focus pass in `visual-review.spec.ts`. |
| V-5 split diff in a narrow canvas, hunk toolbar stacks | PARTIAL (needs `review-canvas.component.ts`) | Done in my files: `review-canvas/hunk-toolbar.component.ts:139`. The `@@` header is `w-0 min-w-0 flex-1 truncate`, so it adds no intrinsic width. The toolbar is `flex-shrink-0 flex-nowrap`, so the row wraps only when "Hunk i of n" and the buttons cannot share a line, and the buttons never stack among themselves. `review-canvas/comparison-bar.component.ts:266` adds input `autoUnified` (pressed state follows the layout on screen, and a title explains the narrow default) and output `layoutPicked`. Every press is reported, so pressing Split overrides the default without writing the stored preference again. Still needed: the canvas wiring (`narrowList` from the list's existing ResizeObserver, unified below `SPLIT_MIN_WIDTH_PX = 600` unless Split was pressed this session). It is in the handoff patch. Until the patch is applied, the narrow default is not active. | `hunk-toolbar.component.spec.ts` "keeps the toolbar on one row…"; `comparison-bar.component.spec.ts` "reads as Unified while the canvas is auto-unified, and reports a Split press without re-persisting (V-5)". The canvas test is in the handoff patch; it passed (956/956) before I took it back out. |
| V-6 file-section header wraps to 2-3 rows | FIXED | `review-canvas/file-section-header.component.ts:85`: host is `flex-nowrap`. Path at `:143` is left-truncated (`dir="rtl"` around `<bdi dir="ltr">`, the change-set card pattern), with `title` holding the full path. Badges, chips and actions are `shrink-0`; "renamed from" is capped at 40% and has a title. CSS container query on the host (no observer): below 480 px Comment and Edit go icon-only (their aria-labels already name them) and the gap tightens; below 360 px the per-file totals hide (the comparison bar keeps the sums). | New `review-canvas/file-section-header.component.spec.ts` (3 tests) |
| V-7 loud stale bar, no dirty marker | FIXED | `spot-editor/spot-editor.component.ts:220`: the stale bar is now the shell's quiet strip (`border-l-2 border-l-warning bg-base-200 text-base-content`) instead of `alert alert-warning`. `:140` shows an "Unsaved" label (with a decorative warning dot) while `modified()`. | `spot-editor.component.spec.ts` "marks a dirty buffer "Unsaved" until it is saved (V-7)"; the stale-banner test now also checks `border-l-warning` and the absence of `alert-warning`/`bg-warning` |
| V-8 truncation priority | FIXED | History: `history/history-timeline.component.ts:104` uses a container query on the timeline root, so below 400 px the author is visually hidden but still read by screen readers. sha, author and time are `flex-shrink-0`, and the subject has a `title`. `history/history-stash-section.component.ts:65` does the same for "on <branch>" (capped at 40%). Task: `task/task-worktree-view.component.ts:411`. The branch keeps its natural width (`min-w-0 truncate`, `title`); the path is `flex-1` (basis 0), takes only the leftover space and truncates from the left (`dir="rtl"` plus an ltr `bdi`). Its new testid is `task-worktree-row-path`, because `task-worktree-path` already names the add-form input. | `history-timeline.component.spec.ts` "lets the subject win the row…"; `task-worktree-view.component.spec.ts` "lets the branch win the row and truncates the path from the left…" |
| V-9 "PR status could not be read." with no GitHub remote | FIXED (with a small backend classifier change) | Frontend `task/task-pr-panel.component.ts:26`: `not-github` now reads "No GitHub remote — PR status hidden." Backend: the frontend cannot tell this case apart, because a repo with no remote arrived as `failed`. With gh 2.96, `gh pr list` in a repo with no remote prints `no git remotes found`, which `classifyGhFailure` did not recognise. `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts:341-353` now maps that to the existing `not-github` reason. No new contract value was added. While checking, I found a second bug in the same classifier: gh's real non-GitHub message ends with "please use `gh auth login`", so a GitLab-only repo was classified `not-authenticated` ("GitHub CLI is not signed in"). The not-github check now runs first. Both stderr strings were captured from a real gh 2.96 run. | `github-pr-status.reader.spec.ts` "maps a repository with no remote to not-github", "maps the full non-GitHub remote message (with its gh auth login hint) to not-github"; `task-worktree-view.component.spec.ts` reason table updated |

## Handoff patch (coordinator to apply; files owned by the second writer)

Apply this patch to `libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts` and its spec (completes V-5), and to `file-diff-section.component.ts` (the V-4 comment-composer inputs). The V-6 assertion I had added to `file-diff-section.component.spec.ts` now lives in the new `file-section-header.component.spec.ts`, so that spec needs no change. Line numbers come from my pre-handoff base; adjust the context if the second writer moved it.

```diff
--- a/libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts
+++ b/libs/frontend/git-ui/src/lib/review-canvas/review-canvas.component.ts
@@ const UNKNOWN_SIZE_PX = 240;
+/**
+ * Below this diff-list width split has under 300 px a side and its hunk
+ * toolbar stacks, so the list shows unified unless the user picks Split.
+ */
+export const SPLIT_MIN_WIDTH_PX = 600;
@@ <ptah-comparison-bar
       [(sideBySide)]="sideBySide"
+      [autoUnified]="autoUnified()"
+      (layoutPicked)="splitPicked.set($event)"
       (filterChange)="filter.set($event)"
@@ class ReviewCanvasComponent
+  /** The stored Split / Unified preference (`diff.renderSideBySide`). */
   protected readonly sideBySide = signal(true);
+  /**
+   * The diff list is narrower than {@link SPLIT_MIN_WIDTH_PX}, measured by the
+   * list's existing `ResizeObserver`; a hidden list keeps the last value.
+   */
+  private readonly narrowList = signal(false);
+  /** The user pressed Split this session: it wins over the narrow default. */
+  protected readonly splitPicked = signal(false);
+  /**
+   * Split preferred, but the list is too narrow for two columns and the user
+   * has not pressed Split: show unified (V-5).
+   */
+  protected readonly autoUnified = computed(
+    () => this.sideBySide() && this.narrowList() && !this.splitPicked(),
+  );
@@ diffStyle
-    this.sideBySide() ? 'split' : 'unified',
+    this.sideBySide() && !this.autoUnified() ? 'split' : 'unified',
@@ private onResize(entries: readonly ResizeObserverEntry[]): void {
     if (!box) return;
+    if (box.width > 0) this.narrowList.set(box.width < SPLIT_MIN_WIDTH_PX);
     const shown = box.width > 0 || box.height > 0;
```

Spec (`review-canvas.component.spec.ts`, inside the describe that holds "passes the layout from Split / Unified to every section"):

```ts
    it('shows unified while the list is under 600 px, and keeps Split once the user presses it (V-5)', async () => {
      FakeResizeObserver.instances = [];
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
        FakeResizeObserver;
      try {
        await create();
        const observerOfList = FakeResizeObserver.instances.at(-1);
        const list = byTestId('review-canvas-list');
        if (!observerOfList || !list) throw new Error('list not observed');
        const reportWidth = async (width: number): Promise<void> => {
          observerOfList.callback(
            [{ target: list, contentRect: { width, height: 400 } }] as never,
            observerOfList as unknown as ResizeObserver,
          );
          await settle();
        };
        const layouts = (): string[] =>
          sectionInstances().map((section) => section.diffStyle());
        const pressed = (id: string): string | null | undefined =>
          byTestId(id)?.getAttribute('aria-pressed');

        await reportWidth(420);
        expect(new Set(layouts())).toEqual(new Set(['unified']));
        expect(pressed('layout-unified')).toBe('true');
        expect(pressed('layout-split')).toBe('false');

        await reportWidth(800);
        expect(new Set(layouts())).toEqual(new Set(['split']));

        // Hidden (0 wide) keeps the last real layout.
        await reportWidth(420);
        await reportWidth(0);
        expect(new Set(layouts())).toEqual(new Set(['unified']));

        byTestId<HTMLButtonElement>('layout-split')?.click();
        await settle();
        expect(new Set(layouts())).toEqual(new Set(['split']));
        expect(pressed('layout-split')).toBe('true');
      } finally {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      }
    });
```

`file-diff-section.component.ts` (V-4): append ` focus-visible:outline-[oklch(var(--s))]` to the class of the `comment-from` and `comment-to` inputs (`input input-bordered input-xs w-20`) and of the `comment-body` textarea (`textarea textarea-bordered textarea-xs`).

The existing canvas spec's `FakeResizeObserver.emit` reports width 600, which is not narrow, so the window and anchor tests are unaffected.

## Files changed

- MODIFIED `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.ts`: V-1 wrap groups, `compact` input, V-2 truncating branch label
- MODIFIED `libs/frontend/git-ui/src/lib/git-dock/git-dock-header.component.spec.ts`: 3 tests
- MODIFIED `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.ts`: `compact` from the existing observer, compact tab strip styles
- MODIFIED `libs/frontend/git-ui/src/lib/review-shell/review-shell.component.spec.ts`: mock header `compact` input, 1 test
- MODIFIED `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.ts`: V-3 caret ring
- MODIFIED `libs/frontend/git-ui/src/lib/open-in/open-in-button.component.spec.ts`: 1 test
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.ts`: V-4 ring; V-5 `autoUnified` / `layoutPicked`
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.spec.ts`: 1 test
- MODIFIED `libs/frontend/git-ui/src/lib/commit/commit-composer.component.ts`: V-4 ring
- MODIFIED `libs/frontend/git-ui/src/lib/branch-picker/branch-picker-dropdown.component.ts`: V-4 ring (consistency)
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/hunk-toolbar.component.ts`: V-5 single-row toolbar
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/hunk-toolbar.component.spec.ts`: 1 test
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts`: V-6
- CREATED `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.spec.ts`: 3 tests
- MODIFIED `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.ts`: V-7
- MODIFIED `libs/frontend/git-ui/src/lib/spot-editor/spot-editor.component.spec.ts`: 1 new test, 1 strengthened
- MODIFIED `libs/frontend/git-ui/src/lib/history/history-timeline.component.ts`: V-8
- MODIFIED `libs/frontend/git-ui/src/lib/history/history-timeline.component.spec.ts`: 1 test
- MODIFIED `libs/frontend/git-ui/src/lib/history/history-stash-section.component.ts`: V-8
- MODIFIED `libs/frontend/git-ui/src/lib/task/task-worktree-view.component.ts`: V-8 row priority, V-4 ring on the add-form inputs
- MODIFIED `libs/frontend/git-ui/src/lib/task/task-worktree-view.component.spec.ts`: 1 test, V-9 wording row
- MODIFIED `libs/frontend/git-ui/src/lib/task/task-pr-panel.component.ts`: V-9 wording
- MODIFIED `libs/backend/vscode-core/src/services/git/github-pr-status.reader.ts`: V-9 classifier (no-remote case and check order)
- MODIFIED `libs/backend/vscode-core/src/services/git/github-pr-status.reader.spec.ts`: 2 tests
- Not changed (ownership handoff): `review-canvas.component.ts` (+spec), `file-diff-section.component.ts` (+spec)

E2E selectors: no selector in `apps/ptah-electron-e2e/src/specs/git/*.spec.ts` broke. `file-section-path` text still trims to the path (it is wrapped in a `bdi`). `current-branch-button`, `spot-editor-stale` and `task-pr-unavailable` are unchanged. No e2e asserts the old not-github wording. The real-repo Task e2e (`task-worktree-view.spec.ts:337`) checks only for quiet styling; it will now read the not-github line instead of "could not be read".

## Verification

All commands were run with `NX_DAEMON=false NODE_OPTIONS=--no-experimental-require-module`, after the ownership handoff, and include the second writer's work in progress in the shared tree.

- git-ui test (`npx nx run git-ui:test --maxWorkers=2`): 43 suites, 969 tests passed
- git-ui typecheck: passed
- git-ui lint: 0 errors, 1 warning. The warning is `max-lines` on `spot-editor.component.ts`, which was already over the limit (897 lines before this round, 921 now).
- vscode-core test (`npx nx run vscode-core:test --maxWorkers=2`): 45 suites, 902 tests passed (`github-pr-status` alone: 41 passed)
- vscode-core typecheck: passed
- vscode-core lint: 0 errors, 15 warnings, none in the changed files
- prettier `--list-different` on every changed file: clean
- Electron rebuild and e2e: not run (coordinator owns them). V-3 and V-4 are pure cascade fixes and need the focus pass in `visual-review.spec.ts` to confirm the rendered ring colour.

## Out of scope / notes

- V-5 is only half active until the handoff patch lands. Without it, `autoUnified` stays false, so the canvas behaves as before apart from the single-row toolbar.
- A container query in an ancestor of the header popovers (on the shell or the header row) was considered and rejected. `container-type` adds layout containment, which would trap the fixed-position popover backdrop and the branch-picker z-order below the sticky file headers. Compact mode therefore comes from the shell's existing ResizeObserver.

## Fix round 2

Source: `reviews/cutover-visual-fix-code-review.md` ("New findings"), review of commit 2c7a95130. Changes are in the working tree only. The other writer's commit 68251d0e4 is untouched.

| Finding | Status | file:line | Test |
| --- | --- | --- | --- |
| MOD 1: a late `settings:get` can undo a Split press made while auto-unified | FIXED | `review-canvas/comparison-bar.component.ts:348`: every press now sets `layoutChangedByUser` before the same-value return. `:383` (`loadLayoutPreference`): when the user chose before the read landed, the choice wins; it is written only if the stored value differs and was not already written (`persistedLayout`, set at `:395`). With no prior choice, the stored value still applies as before. | `comparison-bar.component.spec.ts`: "keeps a Split press made before a late read of a stored Unified, and stores it once" (deferred read, auto-unified, stored false; result: stays split, exactly one `settings:set` true). "writes nothing more when the late read already agrees with the press" (one write). The existing "does not let a late settings read override…" still passes. |
| MOD 2: nowrap header overflows at 300-319 px with chips | FIXED | `review-canvas/file-section-header.component.ts:106`: below 480 px the individual chips (`.fsh-chip`) hide and one `+N` summary badge (`:193`, `chipSummary` at `:287`) shows instead. Its `title` and `aria-label` read "File details: 3 hunks, new, comment in progress", so any number of chips costs one ~24 px badge. Below 360 px the row gap tightens to 0.25rem, totals hide, and the side badge is capped at 4.5rem with an ellipsis and a `title`. Budget at 300 px: toggle, status, capped side badge, `+N`, Comment/Edit icon-only and the open-in icon leave the path about 50 px or more; nothing else is unbounded. Above 480 px the chips render as before. | `file-section-header.component.spec.ts`: "folds a populated chip list into one bounded summary chip at narrow widths" (collapsed, status A, worktree, chips `3 hunks`/`new`/`comment in progress`; checks the summary text, title, aria, side title and the CSS tiers) and "renders no summary chip without chips". `file-diff-section.component.spec.ts`: the real collapsed in-progress-comment flow now checks that the summary chip counts the chips and names "comment in progress". |
| MOD 3: long author outranks the subject above 400 px | FIXED | `history/history-timeline.component.ts:239` (root commit) and `:295` (commit button). The author is now `max-w-[30%] flex-shrink-0 truncate` with the full name in `title`; the full text stays in the DOM, so the accessible name is unchanged. The below-400 px visually-hidden rule is kept. | `history-timeline.component.spec.ts` "lets the subject win the row…" now also checks `max-w-[30%]`, `truncate`, no `whitespace-nowrap`, and the title and text equal to the full name |

Files changed in round 2:

- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.ts`
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/comparison-bar.component.spec.ts`
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.ts`
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/file-section-header.component.spec.ts`
- MODIFIED `libs/frontend/git-ui/src/lib/review-canvas/file-diff-section.component.spec.ts` (spec only; `file-diff-section.component.ts` unchanged)
- MODIFIED `libs/frontend/git-ui/src/lib/history/history-timeline.component.ts`
- MODIFIED `libs/frontend/git-ui/src/lib/history/history-timeline.component.spec.ts`

Verification for round 2 (`NX_DAEMON=false NODE_OPTIONS=--no-experimental-require-module`):

- git-ui test (`npx nx run git-ui:test --maxWorkers=2`): 43 suites, 974 tests passed
- git-ui typecheck: passed
- git-ui lint: 0 errors, 2 `max-lines` warnings
  - `spot-editor.component.ts`: already over the limit before round 1
  - `review-canvas.component.ts`: 708 of 700, crossed by the V-5 handoff patch committed in 2c7a95130; not touched this round
- prettier `--list-different` on the round 2 files: clean
- Electron rebuild and e2e: not run (a visual-reviewer is capturing against dist). `apps/ptah-electron-e2e/**` is untouched.
