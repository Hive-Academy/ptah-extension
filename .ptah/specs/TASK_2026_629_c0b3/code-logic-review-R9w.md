# Code Logic Review - TASK_2026_629_c0b3 batch R9w (Split focus board, panes, Details overlay, reorder consumer)

Review family: Claude; implementer family: codex

All paths are relative to `libs/frontend/canvas/src/lib/` unless prefixed. Source read in full: `canvas-rail/canvas-rail-board.component.ts` (646 lines), `canvas-rail/canvas-focus-area.component.ts`, `canvas-rail/canvas-focus-header.component.ts`, `canvas-detail/canvas-detail-transcript.component.ts`, the R9w diff of `canvas-detail/canvas-lane-view.component.ts`, plus the upstream `chat/.../rail-transcript-retention-coordinator.service.ts`, `transcript-retention.service.ts`, the ChatView retention/`RAIL_MIN_CONTENT_WIDTH` sites, `canvas.store.ts` focus/remove/reorder, `canvas-layout-persistence.service.ts` (`writeFailed`), `orchestra-canvas.component.ts` (board hosting and tile pruning), and the diffs of all four specs. One check run: `r9w-rev-1` (`canvas-rail-board.component.spec.ts`): 1 suite, 40 tests passed. `ptah_get_diagnostics` and typecheck were not run (Mode 2).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Verdict | REVISE |
| Blocking | 2 |
| Serious | 2 |
| Moderate | 4 |
| Minor | 6 |

Why 5 and not 7: the pane state machine is mostly well built. `lastFocusedId` is updated synchronously in every board-initiated transition, `close()` captures before `removeTile`, the external-focus rule is right on the main path, and there is one stable host per side, so no remount on swap or on the 1440 crossing. But two Blocking defects sit on likely paths. One reverses an approved R9f-fix (S1) and rewrites its guard test. The other renders a ghost or duplicate second pane in single focus. Neither is covered by a spec. Why not 3: the coordinator wiring, Open beside, the active/inactive close, the Details overlay and the reorder consumer are sound on the paths the specs drive, and no data is lost.

## Findings

### B1 (Blocking) - Visible-set registration regressed to `active()`: a lane open on a streaming tab stops that tab flushing; the approved R9f-fix guard test was inverted

- Files: `canvas-detail/canvas-detail-transcript.component.ts:83` (`if (!this.active()) return;`, HEAD had `parentActive()`); `canvas-detail/canvas-detail-transcript.component.spec.ts:323,345,349` (title changed to "registers only while its pane is visible", expectation flipped from `true` to `false`).
- Scenario: the user opens a `sub:` or `bg:` lane on a streaming session in a pane. `lane-view` passes `visible=false` to the transcript (`canvas-lane-view.component.ts:68`), so `active()` is false, the effect cleanup runs `unregisterVisibleTab(tabId)`, and the visible set can drop to empty. `BatchedUpdateService.canFlush` (`chat-streaming/.../batched-update.service.ts:176-181`) only flushes tabs in the visible set. `StreamViewportController.tierFor` returns `'hidden'` for a tab absent from the set. The streaming state that the subagent lane builds its tree from (`canvas-lane-view.component.ts:249-252`, `tab.streamingState`) is deferred, so the lane view goes stale.
- This is exactly R9f review S1 (`code-logic-review-R9f.md:76-78`), fixed in R9f-fix (`code-logic-review-R9f-fix.md:24`: "Reverting to `active()` for registration fails line 341"). R9w reintroduced it and changed the spec that guarded it, so nothing fails. The contract line "visibility registration follows `SESSION_VISIBLE`" does not authorise this. The same contract says `SESSION_VISIBLE` = pane displayed, and a pane whose transcript is covered by a lane is still a displayed pane that needs flushing. The writer report (Decisions row 3) records the opposite as a choice.
- Fix (same file): register on `parentActive()` only. This is correct for split because both panes are displayed and each registers its own id. Keep `active` (`parentActive && visible`) for `SESSION_VISIBLE`, `SURFACE_ACTIVE` and the freeze, and `focused` for `SESSION_FOCUSED`. Restore the spec title and the `true` expectation at `:345`, and keep the three tokens asserting `false`. Add one case where two transcripts (left and right tab ids) are both registered while one is covered by a lane.

### B2 (Blocking) - `paneTab()` returns `lastFocusedId` for the inactive side in single focus when store focus is null: ghost pane or the same tab twice

- File: `canvas-rail/canvas-rail-board.component.ts:424-426`.
- Code: `if (side !== activeSide) { if (focused === other) return lastFocusedId !== other ? lastFocusedId : null; ... }`. In single focus `other` is `null`. When `focusedTabIdFor()` is also `null`, `null === null` is true and the right pane returns `lastFocusedId`.
- Trigger: a likely path. `OrchestraCanvas` prunes through `removeTileFromAnyWorkspace`/`removeTileOnly` (`orchestra-canvas.component.ts:476,490`; `canvas.store.ts:340-343,523-535`) when the focused session is deleted from the sidebar or closed elsewhere. Those set the workspace focus to `null` and nothing refocuses. The external-focus effect returns early at `:320` (`!focused`), so `lastFocusedId` stays the removed id. The left pane then shows `focusedId()`, which is `tiles[0]` (`:430`), and the right pane renders a second `ptah-canvas-focus-area` and ChatView for the removed id. The same fault shows the same live tab in both panes if `lastFocusedId` is still a valid tile.
- Impact: a half-width ghost pane in single focus. Two ChatViews (violates "one live ChatView" and the B decision "never the same tab twice"), a `registerVisibleTab` for a dead id, and `data-canvas-live-views=2`. The dev assert at `:416` does not cover it because `otherTabId` is null.
- Fix (same file): guard the inactive branch with `if (!other) return null;` first. Validate any `lastFocusedId` fallback against `orderedTiles()` as the active branch does at `:429`. Better: when the effect sees `focused === null` and `other === null`, leave panes alone and let `paneTab(active)` use `focusedId()`. Add specs for single focus with `focused.set(null)` (a) after `tiles` drops the focused tile and (b) with a valid `lastFocusedId`, expecting exactly one `ptah-canvas-focus-area` and one lane view.

### S1 (Serious) - A hidden workspace's board reconciles with `store.focusTile()`, which writes to the ACTIVE workspace

- File: `canvas-rail/canvas-rail-board.component.ts:308-327`, specifically `:315`.
- `OrchestraCanvas` instantiates one board per workspace (`orchestra-canvas.component.ts:238-242`) and only toggles `visible`. The effect is not gated on `visible()`, and `otherTabId` persists while hidden. `CanvasStore.focusTile` ignores the board's `workspacePath` and uses `ensureActivePath()` (`canvas.store.ts:424-428`).
- Scenario: workspace A is split (X active, Y other), the user switches to workspace B, and a tab of A closes in the background (`removeTileFromAnyWorkspace` nulls A's focus and drops the tile, `canvas.store.ts:523-534`). A's hidden board effect collapses the split and calls `focusTile(survivor)`. That writes A's tab id into B's focus map and calls `tabManager.switchTab(A-tab)`. B now has a focused id that is not one of its tiles, and the app's active tab jumps to another workspace's session.
- Fix (same file): in the effect, when `!this.visible()` only do the pane-state reset (`collapseSplit`, `lastFocusedId`), with no `focusTile` and no `announce`. Better, reset the split when the board becomes hidden, since it is per visible workspace. Add a spec with `visible=false` plus a removal that expects `focusTile` not to be called.

### S2 (Serious) - Absolute "Close split" and "Details" buttons sit on top of the pane header's own controls

- File: `canvas-rail/canvas-rail-board.component.ts:126-128`: `absolute right-20 top-2 z-10` and `absolute right-2 top-2 z-10` over a `section` whose first child is `ptah-canvas-focus-header` (`canvas-focus-header.component.ts:19-37`, `h-12`, right-aligned Stop, Compact, `...`, and `x Close`, `px-3`).
- By geometry (not measured in a browser; jsdom cannot), the Details button covers "Close session" and "More session actions", and "Close split" covers "Compact". Pointer access to Close and the overflow menu (Send to messaging) is lost in split, and only keyboard reaches them.
- Fix (same file): move the two controls out of the header band (for example `top-[52px]` below the 48 px header, or a slim strip that takes height rather than width), or defer them to R9x's header split actions and drop them here. Keep Details reachable only through a control that does not overlap. Add a layout assertion on the offset class.

### M1 (Moderate) - `writeFailed` announcement is unconditional, mis-attributed and not repeatable

- File: `canvas-rail/canvas-rail-board.component.ts:336-338`. `canvas-layout-persistence.service.ts:157,329-331`: `writeFailed` stays `true` until the next successful write.
- Effects: (a) a board created while `writeFailed()` is already true announces "Session order could not be saved." with no reorder; (b) any failing layout write (collapse, density, scroll, tile add) is announced as an order failure; (c) a second failed reorder while the flag is still true changes no signal, so there is no announcement, and an identical string would not re-announce in a live region anyway; (d) hidden boards also run the effect.
- Fix (same file, no service change): set `reorderPending = true` in `move()`. In the effect, announce only when `writeFailed()` is true and `reorderPending`, then clear it; clear it on a `false` read. Use a message that does not claim a cause beyond "Layout changes could not be saved" for non-reorder writes. For the repeat case, a counter on the service is needed (outside the 8 files); say so in the lane report rather than claim it.

### M2 (Moderate) - Transient null store focus is handled in the effect but not in the actions that read focus

- `activatePane` (`:444`): `current = focusedTabIdFor()` can be `null`. `otherTabId.set(null)` then silently collapses the split (`splitDisplayed` is `!!otherTabId`) without `collapseSplit()`, leaving `activeSide`, `visualOrder` and Details state stale.
- `openBeside` (`:454-458`): with null focus it announces "no longer on this board" although the active pane shows `lastFocusedId`.
- `close` (`:587-589`): `wasFocused` and `survivor` use the raw store focus, so with null focus the active pane's tab is treated as inactive, `survivor` is null, and the real survivor is dropped for `tiles[0]` (the fallback the contract forbids).
- The effect branch at `:313` has the same gap: when the other pane is removed and store focus is null, `survivor` is null although `lastFocusedId` is valid.
- Fix (same file): compute one `activeId = focused ?? (lastFocusedId valid in tiles ? lastFocusedId : null)` helper and use it in `activatePane`, `openBeside`, `close` and `:313`. Keep `focusedId()` out of every pane decision. Add specs that set `focused.set(null)` before each action.

### M3 (Moderate) - Collapse always resets `activeSide` to left: the survivor's host is destroyed and rebuilt, and focus returns to the wrong target

- Files: `:475-480` (`collapseSplit`), `:496-507` (`closeSplitDetails`).
- When the surviving session is in the right pane (the common case after closing the active left session, or Close split with right active), the right host is destroyed and the left host re-targets to it. The 5k-17k element transcript is rebuilt and its scroll position lost. The coordinator's `releaseHost` also clears that tab's execution-tree cache (last owner) before the left host re-acquires it. `close()` can also mount the neighbour in the left host first, because `removeTileFromAnyWorkspace` nulls focus and the tab manager switches. Visible cost: flash, lost scroll, a wasted mount of an unrelated tab.
- If Details was open, the third focus fallback (`:505`) focuses the first `.rc-select` in the Rail, not the focused card, and the effect-driven collapse (`:317`) can steal focus from a composer.
- Fix (same file): on collapse keep `activeSide` as is (single focus renders the active side only; `paneTab` already returns null for the other), and reset to the base side only when the next split begins (`openBeside` from single focus normalises the pair, ideally by choosing `visualOrder` so the current tab stays first). Return focus to the focused card's select button or the active lane tab. Add a spec asserting the surviving `ptah-canvas-focus-area` element is the same node before and after Close split with right active.

### M4 (Moderate) - Tests do not pin several contract behaviours and some are vacuous

- Forwarding assertion cannot fail: `canvas-detail-transcript.component.spec.ts:442-465` provides `RailTranscriptRetentionCoordinator` at TestBed root, so `childInjector.get(...)` returns the same instance even if the forwarding line (`canvas-detail-transcript.component.ts:70`) is deleted. Provide it on a wrapper host component (as the board does) so only the forwarding path can supply it.
- The board coordinator test (`canvas-rail-board.component.spec.ts`, "board provides one RailTranscriptRetentionCoordinator...") drives the coordinator with hand-written fake hosts. It proves R9u logic, not that two real `TranscriptRetentionService` instances reach it, so the named case "retained A to live B gives one subtree" is MISSING from R9w.
- Reorder test: no assertion on focus restoration to the moved card's select button, anchoring, or `railShifts === 0` after the move. Deleting the `geometryBaseline` line (`:519`), the focus restore (`:523-524`) or `anchor(id)` fails nothing.
- No test for the layout-name announcement on crossing 1440 ("announced once", contract B2); `:328-335` is unexercised.
- Details overlay is only driven at 920 (named case: all bands) and collapse-with-Details-open focus return is untested.
- Named cases not present in the canvas specs: dock positions at 1920 (side) / 1600 (overlay) / 1280 / 920, "both docks and `ptah-ui display [id]`" with two panes, "independent lanes and drafts per pane" (existing lane/draft cases are single-pane). The writer report defers them to R9u specs; the R9u cases cover the 360 px rule, not the R9w pane combination.
- No single-focus null-focus test (B2), no hidden-board test (S1), no `visible=false` writeFailed test (M1).
- Fix: add the specs above in the existing four spec files.

### Minor

1. `canvas-rail-board.component.ts:123` and `canvas-focus-area.component.ts:31`: the board `section` and the focus area's inner `section` both carry the same `aria-label` (nested duplicate landmark, double announcement). Label one of them.
2. `:123`: `min-w-[360px] min-h-[400px]` also apply in single focus. At narrow bands plus the Details column this forces horizontal scroll that did not exist before R9w. Apply them only while `splitDisplayed()`.
3. `:120`: contract says the column is `overflow-y-auto`; only `overflow-x-auto` is set (computes to auto, so it works). Make it explicit and assert it.
4. `:535-536`: `focus()` sets `lastFocusedId = id` before `store.focusTile(id)`; if the store rejects or ignores the id, `lastFocusedId` is wrong and the effect's early return at `:320` hides the later change.
5. `:416-418`: the dev assert only checks `otherTabId` against store focus; it does not assert at most two hosts. It throws inside an effect and event handlers in dev, which is acceptable per decision 100 (no console), but there is no production guard beyond `paneTab` (see B2).
6. When the active pane changes while Details is open, the overlay is destroyed in the old pane and recreated in the new one (`:141`), so focus inside it drops to `body`. Move focus to the new overlay's Close button.

## Five logic questions

1. Silent failure: B1 (lane view stales without any signal), B2 (a dead tab renders as a normal pane), S1 (focus written to the wrong workspace), M1 (a wrong or missing save-failure message).
2. Unexpected user action: deleting the focused session from the sidebar in single focus (B2); clicking Details/Close split over the pane header (S2); Close split with the right pane active (M3).
3. Wrong answer rather than error: `paneTab` with null focus and a stale `lastFocusedId` (B2); `close()` choosing `tiles[0]` as survivor with null focus (M2).
4. Dependency failure: `closeTab` awaiting a confirm leaves the board effect free to reconcile before `close()` resumes. The ordering is safe in the traced paths (collapse is idempotent, survivor focus is checked), but the neighbour mount in M3 results. Persistence failure is announced inaccurately (M1).
5. Missing: pane-state reset on board hide (S1), a layout assertion that header controls remain reachable (S2), focus return target on collapse (M3).

## Focus and pane transition audit

| Item | Result |
| --- | --- |
| `lastFocusedId` synchronous, no boolean suppression | PASS in `openBeside`, `activatePane`, `focus`, `close`, `closeSplit`; the effect reads it before replacing it (`:320-325`) |
| External focus equal to other -> swap sides; else replace the active pane's tab | PASS (`:321-324`); spec "external main-panel focus and sessionCreated replace only the active pane" fails if the rule is removed |
| No derivation from `tiles[0]` during transient null | PARTIAL: effect and active branch OK; `activatePane`/`openBeside`/`close`/`:313` and the single-focus inactive branch are not (M2, B2) |
| `close()` captures before `removeTile` | PASS (`:587-589`), with the M2 caveat |
| Ghost-pane reconcile after ANY removal | PASS in split (`:308-319`, spec "external removal drops a ghost pane...", announces once); UNSAFE for hidden boards (S1) |
| Never a third host / never the same tab twice | PASS in split; FAILS in single focus with null focus (B2) |
| Reorder: one `reorderTiles`, baseline before move, announce, stale/no-op no write | PASS in code (`:509-527`); the focus-restore and baseline parts are unasserted (M4); `writeFailed` see M1 |
| Memory/leaks | No new DOM listeners; effects have no leaked subscriptions; `afterNextRender` uses the injector. No per-tab-id subtree duplication in split (keyed by side) |

## Named-case audit

| Named case | Status | Evidence / gap |
| --- | --- | --- |
| external removal drops ghost pane, no duplicate, announces once | COVERED | board spec "external removal drops a ghost pane..." (split only; single focus is B2) |
| split Details overlay at all bands, follows active tab, Escape/collapse focus return; single focus keeps column | PARTIAL | only 920 driven; collapse-with-Details-open focus untested (M4) |
| 920 split: Details does not collapse Rail | COVERED | `effectiveCollapsed()` false at 920 |
| 1280 and 920 stacked keep two live hosts | COVERED | `it.each([1280, 920])` (classes and host count only) |
| default dock width 1280 side / 920 overlay; 1920 side / 1600 overlay | MISSING in canvas specs | deferred to R9u by the writer (M4) |
| 400 px wrapper and `overflow-y-auto` bindings | COVERED | asserted on panes; column class see Minor 3 |
| 1439 stacked vs 1440 side by side | COVERED | |
| crossing 1440 without host remount | COVERED | node identity checked |
| close inactive keeps active focus with a neighbour present | COVERED | spec asserts `focusTile` not called |
| close active while the other tab is `tiles[0]`, transient null focus | PARTIAL | focus nulled after `removeTile` resolves; no render between, so the live window is not exercised (M2/M4) |
| jumpTo/newSession/Rail arrows/detail open/main-panel switch | COVERED | `sessionCreated`, `focus`, `jumpTo`, external `focused.set` |
| same-id suppression | COVERED | |
| independent lanes and drafts per pane | PARTIAL | per-tab lane memory and single-pane draft only (M4) |
| both docks and `ptah-ui display [id]` | MISSING for two panes | existing single-transcript display case only |
| focusin activation and unique labels | COVERED | board and focus-area specs |
| exactly two and <= 2 live ChatViews in split | COVERED | stubs (lane-view count) |
| expected reorder permutation with 176/96/56 heights | COVERED | permutation and heights; baseline, focus restore, `railShifts` unasserted |
| persistence write failure via the service | COVERED but see M1 | |
| retained A to live B gives one subtree | MISSING | fake hosts only (M4) |
| token is 360 when splitDisplayed, null in single focus | COVERED | transcript and lane-view specs |
| canvas detail transcript does not provide HIDE_AGENT_SIDEBAR | COVERED | `injector.get(HIDE_AGENT_SIDEBAR, null)` is null |

## Contract audit, orchestrator additions A-D

| Item | Verdict | Evidence |
| --- | --- | --- |
| A: one coordinator per visible board, shared by both panes, same instance reaches both `TranscriptRetentionService`s, released on destroy | MET in code | `canvas-rail-board.component.ts:44` (component `providers`); transcript injects it (`canvas-detail-transcript.component.ts:44`) and forwards it (`:70`); ChatView's node-injector chain also reaches the board provider, so it is the same instance; `RAIL_TRANSCRIPT_RETENTION` is provided at `:69` so `_railRetention` registers (`transcript-retention.service.ts:41-45,77-79`); `DestroyRef.onDestroy` releases hosts (coordinator `:16-18`). Hidden boards keep an idle coordinator, drained when their ChatViews are destroyed. Test evidence is weak (M4) |
| B: always `SESSION_CONTEXT`; at most two hosts; never the same tab twice; dev assert, no console | PARTIAL | `SESSION_CONTEXT` always provided; two-host cap and distinctness hold in split; broken in single focus (B2); assert is dev-only and weak (Minor 5) |
| C: three R9v outputs wired, board computes `splitDisabledReason` | MET | `:68,80-82,225`; reason string matches the contract; stale/foreign/same ids announced (`:452-473`, `move`) |
| D: dock kept, decision 77; width dock 360 only in split; stack under 1440; Details overlay in split; split not persisted | MET with S2/B1 caveats | no `HIDE_AGENT_SIDEBAR`; `minContentWidth` 360 / null; `splitStacked` `< 1440`; overlay at all bands in code; no persistence write; `visualOrder` reset on collapse. Capability removed without listing: none found except the B1 registration change |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Open beside current / foreign / other tab | YES | refused / rejected / activates pane | |
| Cancelled close | YES | early return before pane mutation | focusin may already have activated the pane |
| Close inactive pane via its own button | PARTIAL | focusin activates it first, so it behaves as close-active | contract's "inactive close" is reachable only programmatically |
| External removal of active/inactive in split | YES | effect collapse and survivor focus | hidden boards (S1) |
| External removal of focused tile in single focus | NO | | B2 |
| Null store focus in split | PARTIAL | effect and pane render fall back | actions do not (M2) |
| Reorder at boundary / stale id | YES | no write, announce | |
| Reorder save failure | PARTIAL | announced | M1 |
| Window crossing 1440 | YES | classes only, no remount | announcement untested |
| Workspace switch with split | NO | | S1 |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on B1, B2, S1 (traced to source); MEDIUM on S2 (by geometry, no browser measurement)
- Top risk: B1 silently re-breaks live lanes on streaming sessions (an approved fix reversed with its guard test), and B2 shows a ghost second pane in ordinary single focus.
- What a robust implementation would add: registration on `parentActive()` only with the original spec restored; an `!other` guard in `paneTab` plus single-focus null-focus specs; a hidden-board guard around `focusTile` in the reconcile effect; header-safe placement of Close split and Details; one `activeId` helper used by every action; collapse that keeps the survivor's host; a reorder-pending flag for the save-failure message; specs that actually fail when forwarding, baseline, focus restore or the announcement are removed.

Fixes land in the 8 batch files only, except the optional repeat-failure counter in M1, which needs `canvas-layout-persistence.service.ts`.
