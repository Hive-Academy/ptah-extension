# Code Logic Review - TASK_2026_629_c0b3 batch R9w fix round (scoped re-review)

Review family: Claude; implementer family: codex

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Verdict | APPROVE-WITH-FIXES |
| Original findings closed | B1, B2, S1, S2 (header), M2, M3 (collapse), Minor 2 |
| Original findings partial | M1, M4 |
| New findings | 1 Serious, 3 Moderate, 3 Minor |

Scope: the uncommitted R9w change in the 8 files (writer plus fix, read through `git diff HEAD` and whole files for the board, transcript and focus-area). I read the original review, decisions row 104, the fix report and the R9w contract. I ran two of the four allowed spec files, one at a time through the lock: `canvas-rail-board.component.spec.ts` (47/47 passed, label `r9w-rerev-1`) and `canvas-detail-transcript.component.spec.ts` (10/10 passed, label `r9w-rerev-2`). I did not re-run the focus-area and lane-view specs; their diffs are 20 and 9 added lines of input plumbing, which I read. No typecheck, lint or full suite was run (Mode 2). Reverts were judged by tracing the code against the assertion, not by editing source.

## Status of the nine items

| Item | Status | Evidence | Would the spec fail on revert? |
| --- | --- | --- | --- |
| B1 visible-set registration | FIXED | `canvas-detail-transcript.component.ts:83` gates on `parentActive()`; `active` still drives `SESSION_VISIBLE`, `SURFACE_ACTIVE`, freeze; `focused` drives `SESSION_FOCUSED`. The R9f-fix guard spec at `canvas-detail-transcript.component.spec.ts:323-358` is byte-identical to HEAD again (diff touches only the import line) and expects registration `true` with `visible=false`. | Yes. Reverting to `active()` fails `:345`, and the new two-transcript case (`:360`, left registered with `visible=false`) fails too. |
| B2 ghost or duplicate pane | FIXED for the reported triggers | `canvas-rail-board.component.ts:453` `if (!other) return null;` is the first check of the inactive branch. The effect (`:311-321`) picks a prior-order neighbour when the active id vanished. | Yes. Spec `:306` (both null-focus cases) expects one focus area and one lane view. Without the guard, `focused === other` is `null === null` and the inactive side renders `activeId()`, so two areas. The fix introduces NEW-1 and NEW-2 below. |
| S1 hidden board writes to another workspace | FIXED | Effect `:323-326`: when not visible it only collapses split state and nulls `lastFocusedId`, then returns before any `focusTile` or `announce`. | Yes. Spec `:324` removes the tile while hidden and asserts `focusTile` not called. Without the hidden branch, `other='a'`, focused `'b'` is gone, so the old path calls `focusTile('a')`. |
| S2 absolute buttons over header controls | FIXED for the header, moved overlap remains (NEW-3) | `:126,128` use `top-[52px]`, clear of the 48 px `h-12` header (`canvas-focus-header.component.ts:19`). The Stop, Compact, overflow and Close controls are reachable again. | Yes. Spec `:734-736` asserts the `top-[52px]` class on both buttons at 1280 and 920. This is a class assertion only; there was no browser measurement. |
| M1 `writeFailed` announcement | PARTIAL | `:228,355-358,556`. Fixed: no announcement without a reorder, a pre-existing failure is not attributed, a hidden board stays silent. Not fixed: `reorderPending` is cleared only when the effect re-runs, which needs a `writeFailed` change. After a successful reorder (`false` to `false`) it stays `true`. See NEW-4. The repeat failure while `writeFailed` stays `true` needs a service counter outside the files (recorded, not demanded). | Partly. `:863` fails if the gate is removed. `:827` fails if the announcement is removed. Nothing pins the stale flag. |
| M2 null focus in actions | FIXED | `activeId()` at `:442-447` is used by `activatePane` (`:481`), `openBeside` (`:488`), `close` and the split branch of the effect. | Yes. Spec `:757` sets `focused.set(null)` before `activatePane`; with raw `focusedTabIdFor()` the other pane is set to `null` and the `otherTabId` assertions fail. Spec `:900` covers `close`. |
| M3 collapse remount and focus return | FIXED at collapse; the remount is deferred to the next split (NEW-5) | `collapseSplit` (`:508-512`) no longer resets `activeSide`. `closeSplitDetails` (`:526-540`) returns focus to the active card select or the active lane tab. | Yes. Spec `:757` asserts the surviving `ptah-canvas-focus-area` is the same node after Close split with right active. If collapse reset to left, the right host is destroyed and a new left node appears. Spec `:800+` (1440 and 1600) asserts focus on the `b` card select. |
| M4 vacuous and missing tests | PARTIAL | The vacuous forwarding test is replaced by `canvas-detail-transcript.component.spec.ts:468-494`, with the coordinator provided on a host component. `RailTranscriptRetentionCoordinator` is a bare `@Injectable()` (`chat/.../rail-transcript-retention-coordinator.service.ts:5`), so deleting the forwarding line at `canvas-detail-transcript.component.ts:70` makes `childInjector.get` throw: non-vacuous. Added: reorder focus, scroll anchor and `railShifts`, the 1440 layout announcement, Details at 1440 and 1600 with focus return, single-focus null focus, the hidden board, and a pre-existing `writeFailed` case. Still absent: dock positions at 1920/1600/1280/920, "both docks and `ptah-ui display [id]`" with two panes, "independent lanes and drafts per pane", a hidden-board `writeFailed` case, and the real retained A to live B case. | n/a |
| Minor 2 360/400 px minimums | FIXED | `:123` binds `min-w-[360px]` and `min-h-[400px]` to `splitDisplayed()`; the transcript token is `null` in single focus (`canvas-detail-transcript.component.ts:56`). | Yes. Spec `:757` asserts `min-w-[360px]` is absent after collapse. |

### Retained A to live B with real TranscriptRetentionService instances

Acceptable to leave out of the canvas specs, with the gap recorded. `chat/.../rail-transcript-retention-coordinator.service.spec.ts:73` already builds two hosts with real `TranscriptRetentionService` instances against one coordinator and asserts exactly one subtree. `chat-view.keepalive.spec.ts:527,638` covers the ChatView side. The canvas contribution is only "the same coordinator instance reaches each pane's child injector", and that is now pinned by the non-vacuous forwarding test. The record to keep: no spec mounts board, then two real ChatViews, then real retention end to end, so a break in the order of provider resolution between the board and the child injector would only surface in the Electron check. Mode 2 cannot catch it either.

## New findings

### NEW-1 (Serious) - A board with tiles and no valid active id renders a blank pane

- File: `canvas-rail/canvas-rail-board.component.ts:311-327` (effect), `:449-458` (`paneTab`), `:122`.
- The B2 fix removed the `focusedId()` (`tiles[0]`) fallback from the pane decision, so a pane renders only when `activeId()` is non-null. `activeId()` needs store focus in `tiles`, or `lastFocusedId` in `tiles`. The effect repairs `lastFocusedId` only from `lastOrderedIds`, which finds a neighbour only when the previous `lastFocusedId` is still in that list. Two paths leave both empty:
  1. Background removal. The effect's hidden branch (`:323-326`) sets `lastFocusedId = null` on every run while the board is hidden. A focused tab of workspace A closes while the user is in workspace B: `removeTileFromAnyWorkspace` nulls A's focus (`canvas.store.ts:527-529`), and the neighbour search at `:311-321` is thrown away by `:325`. When the user returns to A, `lastFocusedId` is `null`, `removedAt` is `-1`, no neighbour is found, and `paneTab('left')` is `null`.
  2. Hydration with no focus. `hydrateWorkspace` sets focus to `null` when the active tab is not in the tiles (`canvas.store.ts:493-501`). Nothing in `OrchestraCanvas` refocuses; the effect's `!focused` early return follows.
- Result: the focus area is empty (no `ptah-canvas-focus-area`, no transcript), while the Rail highlights `tiles[0]` and the Details column shows `tiles[0]` (`:59,166,191` still use `focusedId()`). Before R9w this board showed `tiles[0]`. Recovery is one click on a card, but nothing tells the user why the area is empty. No spec starts with null focus and no `lastFocusedId`; the new `:306` case always has a prior valid focus.
- Impact: a visible regression on a plausible path (closing or deleting a session in another workspace, then switching back), not data loss. A user who did not click a card sees a half-empty app with nothing in the area.
- One bounded fix (same file): in the visible branch of the effect, when `!other && !activeId() && ids.size`, take the neighbour, else `[...ids][0]`, and make that the active id by calling `this.store.focusTile(id)` (safe: the branch is already gated on `visible()`, so S1 is not reopened). Do not null `lastFocusedId` in the hidden branch beyond what the reset needs, or run the neighbour search before returning. Add two specs: start with `focused=null` and three tiles (expect one focus area), and hidden removal of the focused tile followed by `visible=true`.

### NEW-2 (Moderate) - After external removal the pane, Rail and Details name different sessions

- File: `canvas-rail/canvas-rail-board.component.ts:59,166,191` (Rail `[focusedTabId]`, sm Details and the Details column all use `focusedId()`) against `:442-458` (pane uses `activeId()` and the prior-order neighbour).
- Scenario: tiles A, B, C with B focused; B is deleted from the sidebar; the store focus becomes `null` and stays so (nothing refocuses). The pane shows C (neighbour), the Rail highlights A and the Details column shows A, `jumpTo` also starts from A (`:437`). Before R9w all three used `tiles[0]`. B2 offered "let `paneTab(active)` use `focusedId()`" as the alternative; the writer chose the neighbour, which is a valid choice but leaves the other consumers on the old rule.
- Fix: the same one as NEW-1 (focus the chosen id in the store, so `focusedId()` equals it). That closes this finding and NEW-1 together.

### NEW-3 (Moderate) - The moved split buttons now cover the right end of the lane tab strip

- File: `canvas-rail/canvas-rail-board.component.ts:126,128`; strip at `canvas-detail/canvas-lane-tabs.component.ts` (`h-9`, 36 px, `overflow-x-auto`, directly below the 48 px header).
- By geometry, not measured: at `top-[52px]` the 24 px buttons sit inside the 36 px lane-tab row. Details (`right-2`) and Close split (`right-20`) cover roughly the last 150 px of a 360 px minimum pane. With the Orchestrator tab plus a group label and two or three agent lanes the strip overflows, and the covered tabs cannot be clicked until the user scrolls the strip. Single-lane sessions are unaffected.
- Fix, or record for R9x which already moves Close split into the header menu: reserve the space (put the two controls in a slim row of their own under the header) or move Details into the header too. This needs the Electron visual re-check.

### NEW-4 (Moderate) - A stale `reorderPending` re-creates the M1(b) mis-attribution

- File: `canvas-rail/canvas-rail-board.component.ts:228,355-358,556`.
- Scenario: the user moves a card; the write succeeds. `writeFailed` is `false` before and after, so the effect never re-runs and `reorderPending` stays `true`. Later a collapse, density or tile-add write fails: `writeFailed` flips to `true`, the effect sees `failed && reorderPending` and announces "Session order could not be saved." for a write that was not a reorder.
- Fix: clear `reorderPending` on a timer or on the persistence service's next successful save, or announce "Layout changes could not be saved" for the not-certain case. No spec pins this.

### NEW-5 (Minor) - The survivor's remount is deferred to the next split, not removed

- File: `canvas-rail/canvas-rail-board.component.ts:497-501`. The M3 fix keeps `activeSide='right'` after collapse, so the survivor X stays mounted in the right host. The next `openBeside` runs `activeSide.set('left')` and then flips: X is then the other pane (left host, newly mounted) and the new tab takes the right host that held X. X is rebuilt there once. Dropping the `activeSide.set('left')` at `:499` keeps X in its host (Y mounts in the left host). Cost is one remount at the next split open; recorded, not demanded.

### NEW-6 (Minor) - Single focus can carry `data-pane-side="right"`

- File: `canvas-rail/canvas-rail-board.component.ts:123`. Selectors that assume `left` in single focus (R9x e2e and keyboard work, `onLanesRequested` already uses `activeSide()`) will miss. Note for the R9x brief.

### NEW-7 (Minor) - "Announced once" cannot be falsified by the test

- File: `canvas-rail-board.component.spec.ts:705-717`. The assertion compares the announcement string before and after another `detectChanges()`. A second `announce()` of the same string leaves the signal equal, so the case would pass if the effect announced twice. Count `announce` calls (spy) to pin it.

## Recorded, not demanded

- Repeat save failure while `writeFailed` is already `true` produces no new signal change (agreed with the writer; needs a service counter outside the 8 files).
- Dock positions at 1920/1600/1280/920, `ptah-ui display [id]` with two panes, independent lanes and drafts per pane, and a hidden-board `writeFailed` case stay unspecced in the canvas specs. They belong to the Electron visual re-check or R9x.
- Original Minors 1, 3-6 stay recorded per decisions row 104.

## Five logic questions (fix round only)

1. Silent failure: NEW-1 (blank area with no message), NEW-4 (wrong error text).
2. User action: switching back to a workspace whose focused session closed meanwhile (NEW-1); the next Open beside after a collapse with the right pane active (NEW-5).
3. Wrong answer: Rail and Details name `tiles[0]` while the pane shows the neighbour (NEW-2).
4. Dependency failure: a failed save after a successful reorder is attributed to ordering (NEW-4).
5. Missing: a store-focus repair for a visible board with no valid active id (NEW-1/NEW-2).

## Verdict

- Recommendation: APPROVE-WITH-FIXES. Both Blocking and both Serious original findings are closed with non-vacuous specs; M2, M3, Minor 2 are closed.
- Confidence: HIGH on the nine item statuses (code traced, 47/47 and 10/10 specs run); MEDIUM on NEW-1 (read from code, not reproduced because no new spec may be added); LOW on NEW-3 (geometry only).
- Impact of the open items: NEW-1/NEW-2 are one defect with one correction (a few lines in the board effect plus two specs). Without it, closing a session in a background workspace leaves an empty area on return. NEW-3 to NEW-7 are Moderate or Minor and can be recorded.
- Because the revise cap is used, the recommended path is one bounded correction for NEW-1 and NEW-2 (and NEW-4 if cheap), then Mode 2. NEW-3 and the remaining items go to the Electron visual re-check and the R9x brief.
