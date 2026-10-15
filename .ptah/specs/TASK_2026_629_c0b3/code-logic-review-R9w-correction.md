# Code Logic Review - TASK_2026_629_c0b3 batch R9w post-cap correction (decision row 105)

Review family: Claude; implementer family: codex

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Verdict | APPROVE-WITH-FIXES (post-cap: findings are recorded, not fixed) |
| NEW-1 (blank pane, Serious) | FIXED on both paths and for visible external removal |
| NEW-2 (pane/Rail/Details name different ids) | FIXED |
| NEW-4 (stale `reorderPending`) | FIXED for the stale flag; the specific "Session order could not be saved." message is now unreachable in production (finding C3) |
| New findings | 1 Serious (C1), 2 Moderate (C2, C3), 2 Minor (C4, C5) |
| Check run | `r9w-corr-rev`, waited 0 s for the lock: Test Suites 1 passed, Tests 51 passed (the writer's 51/51 reproduced) |

Scope read in full: `canvas-rail-board.component.ts` (all 693 lines), the focus effect, `activeId`, `paneTab`, `move`, `close`, the reorder-failure effect, and the store paths it calls (`canvas.store.ts` `focusTile`, `hydrateWorkspace`, `removeTileFromAnyWorkspace`, `clearFocusIf`, `ensureActivePath`), `canvas-layout-persistence.service.ts` (`schedule`/`flush`/`write`), `orchestra-canvas.component.ts` (board mount, prune effects), `tab-manager.service.ts` `switchTab`. Spec: setup (`mount`), `:307`, `:325`, `:336`, `:355`, `:371`, `:874`, `:910`, `:917`.

## Judgement per question

### 1. NEW-1 / NEW-2: fixed on every path?

Yes. Traced:

- Visible external removal (A, B, C; B focused; B deleted): store focus becomes `null` and tile B is dropped (`canvas.store.ts:477-479` / `:614-619`). Effect `canvas-rail-board.component.ts:310-348`: `activeId()` is `null` (`:448-453`: focus null, `lastFocusedId` B not in ids), so `:314-321` derives the neighbour from `lastOrderedIds` (`[C, A]`, so `C`) into `lastFocusedId`. `:327-331` runs `activeId()` = C and `focusTile(C)`. The store now holds C, so pane (`paneTab` -> `activeId()`, `:455-467`), Rail `focusedTabId` and both Details columns (`focusedId()`, `:246-252`) all name C. Rerun: `focused === lastFocusedId`, exits at `:341`.
- Background removal then return: hidden run keeps `lastFocusedId` (`:323-326` no longer nulls it) and the neighbour is computed at `:314-321` before the hidden early return. Return runs `:327-331` once. Spec `:336-353` pins `focusTile` not called while hidden, called once on return, `focused()` = `c`, pane = `c`.
- Hydration with null focus (`canvas.store.ts:444-446`): first visible run has `lastFocusedId` null, `removedAt = -1`, so `id = [...ids][0]` (first in order), one `focusTile`, Rail and pane agree. Spec `:325-334`.
- Details at sm and the wide column read `focusedId()`; after the store write it equals the pane id, so NEW-2 is closed with it (spec `:355-369` asserts all three).

### 2. S1 not reopened; wrong-workspace write?

S1 holds: the hidden branch at `:323-326` returns before any `focusTile` or `announce`. For the visible branch, the board is mounted as `[visible]="path === canvasStore.activeWorkspacePath()"` (`orchestra-canvas.component.ts:237-240`), and `focusTile` writes to `ensureActivePath()` (`canvas.store.ts:373-377`), so under the normal "parent inputs update before the child's view effect" ordering the target workspace is the board's own. I found no path where a visible-branch write targets another workspace. There is no defensive check (`store.activeWorkspacePath() === workspacePath()`) and the spec's fake `focusedTabIdFor`/`focusTile` ignore the path (`spec :243-257`), so a wrong-workspace write could not be caught by any test. Recorded as C5 (Minor). The real problem with the write is not the workspace but the surface, see C1.

### 3. Feedback loop, repeated writes, interference

Settles after one write: after `focusTile(id)` the rerun has `focused === id === lastFocusedId`, so `:327` is false and `:341` returns. No write when the store already holds a valid focus (`:327` requires `!focused || !ids.has(focused)`), and none while `other` is set (`!other`). The `focusedTabIdFor` read is one shared map signal, so other boards' effects rerun on every write, but hidden boards return and the visible one is idempotent. Split: `:327` is skipped when `other` is set; the existing split branch `:333-340` is unchanged. `close()` (`:391-413`) writes the same neighbour the effect would pick (next, else previous nearest), so an interleaved effect and `close()` agree; Open beside / `activatePane` set `lastFocusedId` before the store write; collapse is unchanged. No interference found. One behaviour change to note (C1): the single-pane write calls `tabManager.switchTab` (`canvas.store.ts:376`, `tab-manager.service.ts:1304-1313`), which is a global side effect.

### 4. NEW-4

Stale flag: fixed. `move()` clears `reorderPending` on the next microtask when `writeFailed()` is false (`:562-566`), and the effect clears it on success (`:364`). A later, unrelated failure now announces the neutral "Layout changes could not be saved." Spec `:917-924` awaits one microtask then fails the write and expects the neutral text exactly; reverting the microtask makes it fail (the old flag would produce "Session order could not be saved."), so it is non-vacuous.

Real reorder failure still announced: yes, but only with the neutral message in production. See C3.

### 5. Are the new specs non-vacuous?

- `:325` hydrated null focus: reverting the store write leaves `focused()` null and `focusTile` uncalled; fails. Non-vacuous.
- `:336` hidden neighbour: reverting to nulling `lastFocusedId` makes the return pick `a`, not `c`; fails on `focused()` `'c'`. Non-vacuous, and it pins the single write (`toHaveBeenCalledTimes(1)`) and no write while hidden.
- `:355` external removal: reverting leaves `focused()` null (the mock does not repair it); fails. Non-vacuous. It does not distinguish pane-fallback from store-write alone beyond `focused()`.
- `:917` stale flag: non-vacuous (above).
- Weak: `:874` still ends with `toContain('could not be saved')` (`:907`), which matches both the specific and the neutral message, and flips `writeFailed` synchronously, so it neither pins the specific message nor models the 250 ms debounce (C3).
- Gaps: no test with the canvas surface inactive (C1), no test of the wrong-workspace guard (C5), no test of hidden split removal followed by return (C4).

### 6. New defects in the changed lines

C1 to C5 below.

## New findings

### C1 (Serious) - The repair write switches the global active chat tab while the canvas surface is hidden

- File: `canvas-rail-board.component.ts:327-331` (the new store write), reaching `canvas.store.ts:376` -> `tab-manager.service.ts:1311` (`_activeTabId.set` + `saveTabState`).
- The effect is gated only on `visible()` (`:323`). `visible` means "this is the active workspace's board" (`orchestra-canvas.component.ts:240`), not "the canvas surface is on screen". The canvas component is retained and hidden with CSS in single-chat mode (`app-shell.component.html:797-801`: `ptahSurfaceActive="canvas"`, `[class.hidden]="layoutMode() !== 'grid'"`; the comments at `:84-85` say the canvas is never destroyed). The board does not read `SURFACE_ACTIVE`.
- Scenario: the user toggles to single chat and works in tab X. The canvas focus is stale and still names tab B (nothing updates canvas focus from `switchTab`). The user closes tab B from the tab bar or the sidebar. `onTabClosed` -> `removeTileFromAnyWorkspace` (`orchestra-canvas.component.ts:487-491`) or the prune effect (`:470-478`) drops tile B and nulls the focus. The board effect sees `visible() === true`, derives neighbour C and calls `focusTile(C)`, which runs `tabManager.switchTab(C)`. The user's active chat tab silently changes to C (or overrides the tab TabManager itself chose after closing the active one).
- Before the correction this branch only set `lastFocusedId` and did not write; the pre-existing split-survivor write (`:336`) is rarer. Hydration with null focus hits the same write at startup or workspace switch if `tabManager.activeTabId()` is not among the new tiles (`canvas.store.ts:443-446`), so it can also override the restored active tab while the canvas is hidden. I did not run the app, so the single-chat trace is by reading.
- Impact: silent wrong-session in the chat pane (messages route to the active tab) in a mode the user believes the canvas is not involved in. This is the S1 class of bug ("hidden board writes elsewhere") reached through a different gate.
- Fix to record: treat the surface as hidden too (gate the write on `SURFACE_ACTIVE` like `canvas-detail-transcript.component.ts:54`, keep `lastFocusedId`, repair when the surface becomes active), or repair via the store focus only (`store.setFocus` without `switchTab`) when the surface is not active. Add a spec with `SURFACE_ACTIVE` false and a removed focused tile expecting no `focusTile`.

### C2 (Moderate) - After removal while hidden with a split, the survivor pane is lost and the first tile is chosen

- File: `canvas-rail-board.component.ts:314-326`.
- Scenario: split with focused B and other O; board hidden (workspace switch); B is deleted. The first hidden run skips the neighbour block (`other` set), overwrites `lastOrderedIds` without B (`:322`), then `collapseSplit()` (`:324`). The effect reruns because `otherTabId` changed; now `removedAt = -1`, so `lastFocusedId` becomes `null`. On return `:328` picks `[...ids][0]`, not O, which the visible path (`:334-336`) would have kept. Pane, Rail and Details still agree (they all name the first tile), so this is a choice-quality defect, not an inconsistency. Spec `:371-381` stops at "no write while hidden" and never returns.
- Fix: when collapsing while hidden, set `lastFocusedId` to the surviving `other` if the focused id is gone, before returning.

### C3 (Moderate) - "Session order could not be saved." is now effectively unreachable; the reorder-specific message is dead code

- File: `canvas-rail-board.component.ts:562-566`, `:360-362`; `canvas-layout-persistence.service.ts:267-275,324-333`.
- `reorderTiles` only schedules a write; `writeFailed` is set at flush, 250 ms later (`CANVAS_LAYOUT_SAVE_DEBOUNCE_MS = 250`) or on `pagehide`. `reorderPending` is cleared on the next microtask, always before that. So the branch `failed && reorderPending` can only fire if a failure is published inside the same microtask turn, which production never does. Every real reorder failure now reads "Layout changes could not be saved." The correction report states this trade-off ("later or uncertain failures use the neutral message"), so it is deliberate and the user-visible text is still truthful; but the earlier M1(b) behaviour (distinguish a reorder failure) is lost, and the code path plus its spec (`:874-908`, which uses a synchronous `writeFailed.set(true)` and a message matcher that accepts both texts) now document behaviour that cannot occur.
- Impact: no wrong message to the user; maintainability and false coverage. Correct fix needs the persistence service to expose a write-completion signal or revision (outside R9w files), or the dead branch and flag should be deleted and the spec renamed.

### C4 (Minor) - Repeat failures stay silent

- `:357-365`: while `writeFailed` stays `true`, further failed writes do not change the signal, so a second reorder or layout change after the first failure announces nothing. Carried from the earlier review as "needs a service counter", still open.

### C5 (Minor) - No defensive workspace check on the new write, and the specs cannot detect one

- `:330` calls `focusTile(id)`, which resolves the workspace from the store's active path, not from `workspacePath()`. Safe under today's `visible` wiring (Judgement 2), but a one-line guard (`this.store.activeWorkspacePath() === this.workspacePath()`) would make the S1 invariant local to the component. The spec store fake ignores the path (`spec :243-257`).

## Five logic questions

1. Silent failure: C3 (a real reorder failure is reported, but under the wrong text, and the specific branch never runs); C4 (repeat failures silent); C1 (a silent active-tab change).
2. User action with unexpected result: close a tab that is the stale canvas focus while in single-chat mode, or switch workspaces in single-chat mode with null hydrated focus (C1); delete the focused session while another workspace is shown with a split open (C2).
3. Wrong answer from data: a store focus that is non-null but not on this board is treated like null and repaired (`:327`), which is right. Hydration where `tabManager.activeTabId()` is outside the tiles yields the first tile and now also activates that tab (C1).
4. Dependency failure: `tabManager.switchTab` of a tab that is not found only warns (`tab-manager.service.ts:1305-1309`) while the store focus is already written; harmless here because ids come from the board's own tiles. Persistence failure: C3, C4.
5. Missing: a surface-active gate for global side effects (C1); a test where the canvas surface is inactive; a return-from-hidden test with a split (C2).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Visible external removal of the focused tile | YES | neighbour `:314-321`, store write `:327-331` | none |
| Hidden removal, then return | YES | neighbour kept, one write on return | split variant loses survivor (C2) |
| Hydration with null focus | YES | first ordered tile, one write | writes `switchTab` (C1) |
| All tiles removed, then one added | YES | stale `lastFocusedId` ignored, first tile focused | none |
| Reorder then later unrelated write failure | YES | flag cleared on microtask | message is neutral (C3) |
| Reorder failure with `writeFailed` already true | YES | no announce, flag cleared on later success | repeat failures silent (C4) |
| Canvas surface hidden (single-chat mode) | NO | gate is `visible()` only | C1 |

## Verdict

- Recommendation: APPROVE-WITH-FIXES. The three targeted findings are corrected where they were observed and the specs would fail without the fix. The correction introduces one Serious problem, a global active-tab write that is not gated on the canvas surface (C1), which should be recorded for the user's manual single-chat test and the PR body.
- Confidence: MEDIUM-HIGH for the traced logic and the spec judgement (51/51 reproduced); MEDIUM for C1, which is by code reading and not run in the Electron app.
- Top risk: with the canvas retained but hidden, a tab close or a null hydrated focus makes the board call `switchTab` and change the user's active chat tab.
- What a robust implementation would add: a `SURFACE_ACTIVE` gate (or a store-only repair) on the new write plus its spec; the survivor choice for hidden split collapse; a local workspace guard; delete or truly drive the reorder-specific message from a persistence write signal.

Score reasoning: 6/10. The fix targets are met with sound traces and non-vacuous specs (above 5), but a new Serious behavioural regression on a plausible path and a dead reorder branch keep it below the 7-8 band.
