---
title: >-
  Batch 3.3 report — git spec migration cleanup (resumed after stall)
---

# Batch 3.3 — git spec migration cleanup

Picked up from a stalled predecessor run. Everything listed under "already
complete" in the handoff was re-verified true and untouched. This session's
scope was exactly one thing: get `src/specs/git` from 5 failed / 9 passed to
the smallest honest failure set, and write this report (which the predecessor
never did).

## Files changed

- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\git\hunk-revert-top-layer.spec.ts`
  — added a `widenWindow(electronApp)` helper and called it from
  `openRevertDialog` (both tests route through it).
- MODIFIED `D:\projects\ptah-extension\apps\ptah-electron-e2e\src\specs\git\hunk-widget-mouse.spec.ts`
  — added the same `widenWindow(electronApp)` helper and called it right
  after `ui.goto('git')` in both tests that reach the hunk-action widget.
- No changes to `libs/frontend/git-ui/src/lib/git-dock/**` — not needed (see
  below).
- `diff-view-state.spec.ts` and `perf-m1-diff-redisplay.spec.ts` — read only,
  not changed further. Their KNOWN GAP comments (already present from the
  predecessor) are correct and are left as the record of the decision; see
  "Left failing" below.

## The real cause of the 3 non-editor failures (not what the handoff assumed)

The handoff explicitly warned not to assume `hunk-revert-top-layer` and
`hunk-widget-mouse` failed for the same "drives the deleted editor panel"
reason as the other two specs, and that was correct — they failed for a
completely different, layout-only reason.

Baseline run (`/tmp/e2e-git-baseline.log`) showed all 3 tests timing out on
the exact same step:

```
- waiting for locator('[data-testid="hunk-widget-revert"]')
- locator resolved to <button ... data-testid="hunk-widget-revert" ...>Discard...</button>
- <div class="slider"></div> from <div ... class="visible scrollbar vertical">…</div>
  subtree intercepts pointer events
```

`hunk-widget-revert` is the floating content-widget cluster's Discard button
(`diff-view.component.ts:605`, `[attr.data-testid]="'hunk-widget-' + action"`),
anchored at the selected hunk inside Monaco's modified pane
(`syncHunkWidget`, `diff-view.component.ts:1567`). The cluster's CSS is
`white-space: nowrap` (`diff-view.component.ts:683`, comment: "stops the
buttons wrapping when the modified pane is narrow") — i.e. the component
already knew this could happen in a narrow pane.

At the e2e launcher's default Electron window (1200x800,
`apps/ptah-electron/src/windows/main-window.ts:120-121`), the git dock's
default width is `ElectronLayoutService`'s `DEFAULT_EDITOR_WIDTH = 700`
(`electron-layout.service.ts:34`) minus the 256px `w-64` source-control
sidebar in `git-dock.component.ts:52` — a ~444px diff pane. That is narrow
enough that the 3-button, `nowrap` cluster (Stage / Unstage / Discard, with
labels) runs its rightmost button past the pane's visible width and under
Monaco's own vertical scrollbar, which paints on top and eats the click.
`hunk-widget-stage` (the leftmost button) was never in the failing set for
exactly this reason — only the buttons further right collide.

This is a pane-width regression from hosting the diff in the docked sidebar
instead of the old `ptah-editor-panel`'s much wider main-content tab area. It
is real, but it is not something these three specs need `git-dock.component.ts`
changed to fix — the same dock ships in production with the same 700px
default and the same collision would occur for any real user who hasn't
dragged the divider. That is arguably a `TASK_2026_386` design-handoff-scope
issue (should the default dock width be wider, or should the widget cluster
wrap instead of overflowing) rather than something this batch's remit covers
(migrate specs off the deleted editor panel). It's flagged here rather than
silently patched in `diff-view.component.ts`, which is out of this batch's
touch scope (`apps/ptah-electron-e2e/src/specs/git/**` and
`libs/frontend/git-ui/src/lib/git-dock/**` only).

### Fix applied (test-side, in scope)

Widened the real Electron OS window before interacting with the widget:

```ts
async function widenWindow(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.setSize(2200, 1000);
  });
}
```

Tried first: dragging `ptah-electron-resize-handle` wider (the same
mechanism `docs-screenshots/editor-git.shot.ts`'s `widenEditorPanel` uses).
That did **not** fix it — confirmed by rerunning with the drag in place and
seeing the identical `hunk-widget-revert` intercept failure
(`/tmp/e2e-git2.log`). Root cause: `ElectronLayoutService.setEditorPanelWidth`
clamps the dock to `window.innerWidth * MAX_EDITOR_WIDTH_RATIO` (0.5,
`electron-layout.service.ts:39,157-159`) — at a 1200px window that clamp is
600px, still short of what the cluster needs, so dragging the divider
couldn't reach a wide-enough dock. Growing the window itself (2200x1000)
raises that ceiling to 1100px and gives the whole flex layout (workspace
rail + main content + dock) enough total room that the default dock width no
longer collides with anything. Confirmed working: `hunk-revert-top-layer`'s
two tests and `hunk-widget-mouse`'s "Discard stops at confirmation" test all
pass with this in place (`/tmp/e2e-git3.log`).

## Left failing — genuine premise mismatch, not patched

`diff-view-state.spec.ts` ("survives a tab round trip...") and
`perf-m1-diff-redisplay.spec.ts` ("10 round trips...") both measure a
FILE-tab ↔ DIFF-tab round trip inside `ptah-editor-panel`'s tab strip. The
git dock (`git-dock.component.ts:60-70`) has **no file tree, no
plain-file-open affordance, and no tab strip at all** — it shows only the
active diff (via `diffTabs.activeDiffTab()`) or nothing. There is no dock
equivalent of "switch to the plain file tab" for these specs to drive.

The predecessor already recognized this and left KNOWN GAP comments in both
files (`diff-view-state.spec.ts:138-149`, `perf-m1-diff-redisplay.spec.ts:141-151`)
rather than force a fake pass or silently delete the coverage. I read both
specs end to end and agree with that call:

- `diff-view-state.spec.ts` proves three real claims (B1 AC1/AC3/AC4:
  diff-editor instance survival, scroll-position restore, folding support) —
  all of which depend on there being a SECOND surface to switch away to and
  back from. The dock has none.
- `perf-m1-diff-redisplay.spec.ts` measures re-display LATENCY of that same
  round trip. With no round trip mechanism, there is nothing to time.

I did not force either into passing by inventing a selector that doesn't
exist (the refusal this role is explicitly bound by), and I did not delete
them — the underlying claims (editor survives detach/reattach, scroll state
persists, diff re-render latency) are still real product behaviour worth
proving, they just need a **different** "away and back" mechanism under the
dock model, e.g.:

- Toggling the dock closed/open via the "GIT" sidebar tab
  (`layout.toggleEditorPanel()`, `electron-shell.component.ts:296`) instead
  of switching to a sibling file tab, since `DiffViewComponent` detaches
  models rather than unmounting (per N1, referenced in both files' comments).
- Or selecting a second file's diff and back, if `DiffTabsService` keeps the
  first diff's models cached rather than disposing them.

Either reshape requires a design decision (which mechanism counts as "away
and back" for these ACs) that this batch's remit doesn't cover — it's a
methodology question for whoever owns B1 AC1/AC3/AC4 and the M1 baseline
next, not a locator swap. **Recommend deferring both specs' rewrite to
TASK_2026_386** (the same task the design-handoff already routes the dock's
remaining UI work to), rather than reshaping them here under time pressure.

## Verification

Command run exactly as specified, foreground, no piping into `tail`/`grep`:

```
cd "D:/projects/ptah-extension" && npx nx run ptah-electron-e2e:e2e --args="src/specs/git" > /tmp/e2e-git3.log 2>&1; echo "REAL_EXIT_CODE=$?"; tail -60 /tmp/e2e-git3.log
```

Result:

```
REAL_EXIT_CODE=1
  2 failed
    src\specs\git\diff-view-state.spec.ts:106:7 › diff editor lifecycle (B1 AC1/AC3/AC4) › survives a tab round trip, restores scroll, and reports folding support
    src\specs\git\perf-m1-diff-redisplay.spec.ts:111:7 › perf M1 — diff-tab re-display latency (post-Batch-2, M1 baseline) › 10 round trips against the git:diffFile mechanism (Task 2.14 baseline)
  5 skipped
  12 passed (4.0m)
```

Before this session's fix (baseline, same command): `5 failed, 9 passed, 5 skipped`,
real exit code 1 (`/tmp/e2e-git-baseline.log`).

After the window-resize fix: `2 failed, 12 passed, 5 skipped`, real exit code 1
(`/tmp/e2e-git3.log`). The 3 newly-passing tests are exactly the 3 the
scrollbar-intercept was causing:
`hunk-revert-top-layer.spec.ts` "paints above the canvas and gives Cancel the
mouse, writing nothing", `hunk-revert-top-layer.spec.ts` "gives Discard the
mouse, and discards exactly the hunk it was opened for", and
`hunk-widget-mouse.spec.ts` "the widget Discard stops at the confirmation
dialog and writes nothing".

Also ran `npx nx run ptah-electron-e2e:typecheck` after the edits — GREEN
(no new type errors from the `ElectronApplication` import or the fixture
signature changes).

**Real exit code is 1.** Batch 3.3 is not fully green. The 2 remaining
failures are the ones this report recommends deferring to TASK_2026_386 as a
methodology rewrite, not a defect in this batch's migration work.

## Plan deviations

- Did not touch `libs/frontend/git-ui/src/lib/git-dock/**` — no `data-testid`
  additions were needed. The scrollbar-intercept fix lives entirely in the
  test harness (window size), and the two premise-mismatch specs need a
  design decision before any dock code or locator changes make sense.
- The predecessor's `widenGitDock` (drag-based) approach named in the git
  history/comments before this session started was superseded — it does not
  fix the failure because of the `MAX_EDITOR_WIDTH_RATIO` clamp explained
  above. Replaced with `widenWindow` (OS-window resize via
  `electronApp.evaluate`) in both files.

## Out-of-scope observations

- The hunk-action widget cluster's `white-space: nowrap` combined with the
  dock's default 700px width is a real, shippable narrow-pane collision for
  any user who hasn't widened the dock — not just a test artifact. Worth a
  ticket against `diff-view.component.ts` (wrap the cluster, or shrink it on
  narrow panes) independent of this task.
- `MAX_EDITOR_WIDTH_RATIO` (0.5) means the dock can never exceed half the
  window width no matter how far the divider is dragged. That's presumably
  intentional (keeps the main chat/canvas usable) but it does mean the git
  dock has a hard ceiling that the diff view's own minimum usable width
  should probably be checked against at some point.

## Quarantine

Per the coordinator's follow-up: a red suite is not committable and the two
deferred specs carry real coverage, so they are quarantined rather than left
failing.

**Construct used**: `test.fixme(true, reason)`, called as the first
statement inside each test body — not a `describe`-level annotation. Both
files' `describe` blocks hold exactly one test each, so a per-test call was
the more precise fit (it marks only the specific test, not a whole suite that
happens to have one member today). `test.fixme(condition, description)`
called inline stops the test immediately once the condition is truthy,
matching `test.skip`'s runtime behaviour but reporting distinctly as "this is
expected to fail and needs work" rather than "not applicable" — the
correct signal here.

**Annotated**:

- `apps/ptah-electron-e2e/src/specs/git/diff-view-state.spec.ts:106-121` —
  `test.fixme(true, ...)` added as the first line of "survives a tab round
  trip, restores scroll, and reports folding support", before the existing
  `ui.mockRpc(...)` call.
- `apps/ptah-electron-e2e/src/specs/git/perf-m1-diff-redisplay.spec.ts:111-125`
  — `test.fixme(true, ...)` added as the first line of "10 round trips
  against the git:diffFile mechanism (Task 2.14 baseline)", before the
  existing `ui.mockRpc(...)` call.

Both reasons state, verbatim in substance: the dock has no tab strip, no file
tree and no second surface, so the file-tab ↔ diff-tab round trip these specs
measure has no dock equivalent; the underlying claims (diff-editor instance
survival, scroll-position restore and folding support for
`diff-view-state.spec.ts`; re-display latency for
`perf-m1-diff-redisplay.spec.ts`) are still real product behaviour worth
proving; and the rewrite is deferred to TASK_2026_386, which owns the dock's
remaining UI work and must first decide which mechanism counts as "away and
back" — toggling the dock closed and open, or selecting a second file's diff
and back. Both point back to this report for the decision record.

The existing KNOWN GAP comments in both files (`diff-view-state.spec.ts:138-149`,
`perf-m1-diff-redisplay.spec.ts:141-151`) were left in place unchanged — the
`test.fixme` call is additive, not a replacement, per the coordinator's
instruction.

Neither spec was deleted and no assertion in any of the twelve passing tests
was touched or weakened.

### Verification

```
cd "D:/projects/ptah-extension" && npx nx run ptah-electron-e2e:e2e --args="src/specs/git" > /tmp/e2e-git4.log 2>&1; echo "REAL_EXIT_CODE=$?"; tail -30 /tmp/e2e-git4.log
```

```
REAL_EXIT_CODE=0
...
  -   1 src\specs\git\diff-view-state.spec.ts:106:7 › diff editor lifecycle (B1 AC1/AC3/AC4) › survives a tab round trip, restores scroll, and reports folding support
...
  -  14 src\specs\git\perf-m1-diff-redisplay.spec.ts:111:7 › perf M1 — diff-tab re-display latency (post-Batch-2, M1 baseline) › 10 round trips against the git:diffFile mechanism (Task 2.14 baseline)
...
  7 skipped
  12 passed (2.8m)

NX   Successfully ran target e2e for project ptah-electron-e2e and 2 tasks it depends on
```

`REAL_EXIT_CODE=0`, `12 passed`, and both target specs appear in the skipped
list (Playwright's CLI list-reporter shows `fixme` outcomes under the same
"-" marker as `skip`; both are non-failing, non-executed outcomes). The other
5 entries in the 7-skipped total are the pre-existing skips already present
in the baseline run (`git-dock.spec.ts` real-RPC-only tests skipped under the
mocked-RPC config, per the original 5-skipped baseline) — no new skips beyond
the two just added.

Also reran `npx nx run ptah-electron-e2e:typecheck` after adding the
`test.fixme` calls — GREEN, no new type errors.

No stray `playwright` or `electron` processes were found before this run
(`Get-CimInstance Win32_Process` filtered for both, empty result each time
checked). Run executed in the foreground to completion, no detached
background run left behind.
