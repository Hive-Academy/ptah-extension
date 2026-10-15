Verdict: REVISE 7/10

Gate 2 re-review (cross-side, lane-review mode) of `implementation-plan-rail-r9-split.md` after "Revision 1". Line numbers are file lines of the addendum (Data flow 20-32, Item 10 34-38, Failure cases 40-47, Decisions 49-57, Deltas 59-63, Parity 65-76, Batches 78-89, Electron re-check 91-97, Revision 1 99-111). Read in full: the addendum, the first review, `batches-rail-r9.md` (R9b, R9c, R9t, R9h, R9f, R9l, waves, dependencies), decisions 77, 80, 81. Spot-checked in W: `canvas-rail-board.component.ts` (focusedId fallback, `close()`, geometry effect), `canvas.store.ts` (`focusTile`, `removeTile`, `clearFocusIf`, `reorderTiles`), `canvas-rail-geometry.ts`, `canvas-detail-transcript.component.ts`, `canvas-focus-area.component.ts`, `canvas-rail-card.component.ts`, `chat-view.component.ts` (`isOverlay`, `ptah-chat-view` selector), `session-context.token.ts`. No tests or builds were run (review only).

All nine first-review findings are resolved. The remaining defects are new ones: one wiring/ownership gap that leaves the header actions dead, one unspecified Swap mechanism, and a few smaller contract gaps.

## Status of first-review findings

| # | First-review finding | Status | Evidence in the addendum |
| --- | --- | --- | --- |
| 1 | Pane state contradicted itself | RESOLVED | Line 22 and decision S1 (line 53): the active pane's tab is always `focusedTabIdFor(path)`. The board stores only `activeSide` and `otherTabId`. A single reconcile rule swaps sides when the new focus equals `otherTabId`. Close, `jumpTo`, `newSession`, `CanvasDetailService.open`, main-panel switch and focusin all route through that rule. R9w names the specs (line 86). Caveat: see new items 4 and 8. |
| 2 | One tab could own two transcript trees | RESOLVED | Line 36: the coordinator owns each tab id at most once, A disposes its frozen X before B acquires X, the count is distinct tab trees, and the cache is released at the last owner. Named cases are in R9u (line 84); the Electron re-check reports subtrees per tab id (line 96). Caveat: Swap panes is not covered (new item 2). |
| 3 | No batch owned the pane-focused path | RESOLVED | Line 24 specifies a reactive `paneFocused` input (focus area -> lane view -> transcript). R9w owns `canvas-focus-area`, `canvas-lane-view`, `canvas-detail-transcript` and their specs (line 86). `SESSION_VISIBLE` and `SESSION_FOCUSED` are split (delta 1, line 61). The transcript today binds both to one signal (`canvas-detail-transcript.component.ts:49-50`), and R9w follows R9f on those files. |
| 4 | Delta 3 conflicted with the batch table | RESOLVED | Line 63 and line 80 state one rule: R9f/R9h run unchanged, and only R9u-R9x carry the deltas. The rework is accepted openly. This matches decision 81. |
| 5 | Dock at 1600 unresolved | RESOLVED, with a caveat | Line 30 sets a measurable rule (transcript/composer >= 360 px) and forces overlay. Re-check 1 checks 1920 and 1600 (line 92). The caveat is the blanket choice (new item 9). The mechanism is also unnamed (new item 5). |
| 6 | Screen-reader and keyboard pane rules | RESOLVED | Line 24: labels `Left session: {title}` / `Right session: {title}`, with `, active` on the active one only. `focusin` as well as click activates the pane. R9w specs name "focusin activation and unique pane labels"; re-check 3 covers it. |
| 7 | Geometry reset skipped the height check | RESOLVED | Line 32 sets the baseline to `{ key, order: expectedIds }`. In `checkRailGeometry` (`canvas-rail-geometry.ts:26-39`) a matching key keeps the baseline and still counts heights != expected. The sample runs in `afterRenderEffect` (`canvas-rail-board.component.ts:~268`), after the DOM update, so there is no false shift. |
| 8 | `writeFailed` belonged to the wrong owner | RESOLVED | Line 46 and the verified-contracts line (18) name `CanvasLayoutPersistenceService.writeFailed`. R9w specs "persistence write failure via service". |
| 9 | "Live ChatViews" had no selector | RESOLVED | Line 38 and re-check 4 use `ptah-canvas-rail-board ptah-chat-view`, which excludes the main-panel ChatView. The selector is `ptah-chat-view` (`chat-view.component.ts:199`) and the board is `ptah-canvas-rail-board`. |

## New or remaining items (what blocks APPROVE)

| # | Severity | Addendum section | Item |
| --- | --- | --- | --- |
| 1 | Serious | Batches R9w/R9x (lines 86-87); Data flow (line 26) | The header actions have no consumer. R9x adds Close split / Close pane / Swap panes to `canvas-focus-header.component.ts`, but R9x owns neither the focus area nor the board. R9w, which does own them, runs before R9x, and its contract (line 86) never mentions Close split, Close pane, Swap, Open beside, Move up/down handling, announcements or focus return. R9w cannot bind outputs that do not exist yet, and nothing after R9x wires them. Result: the actions render and do nothing. R9w is also at the eight-file cap, so it cannot absorb the header. |
| 2 | Serious | Item 10 (line 36); Data flow (line 26) | Swap panes has no mechanism. Hosts are keyed by physical side (`rail-left-*`, `rail-right-*`, line 24). A swap therefore moves tab X from host A to host B and Y the other way. Both are live, and the coordinator forbids two live subtrees of one tab with no intermediate state. A live-to-live exchange cannot satisfy that rule, and it would cost two cold transcript mounts against the <= 50 ms warm budget. The measurement already includes "active-pane swaps" (line 94), so the budget is checked but not designed for. |
| 3 | Moderate | Batches R9v/R9w (lines 85-86) | The R9v -> R9w interface is unnamed. R9v adds card menu outputs and inputs (open beside, move up/down, can-move-up/down, split-disabled reason) and forwards them through `canvas-rail.component.ts`. The board in R9w consumes them. Output names, payloads and the split-availability input are not stated. Without them, the two batches can disagree. |
| 4 | Moderate | Failure cases (line 40); Verified contracts (line 9) | `CanvasRailBoardComponent.close()` today calls `focusTile(neighbour)` unconditionally, even when the closed tile was not focused (`canvas-rail-board.component.ts:~337-340`). The board's `focusedId()` falls back to `tiles[0]` when store focus is null, and `removeTile` clears focus to null on closing the focused tab (`canvas.store.ts:708-714`). Under split, closing the inactive pane's tab would replace the active pane with the neighbour. That contradicts "retain the surviving tab" (line 40) and "leave global focus untouched" (line 22). Transiently, the null-focus fallback can also equal `otherTabId`. R9w must (a) refocus only when the closed id was the store-focused one, (b) perform the pane-state transition inside `close()` rather than through an effect, and (c) add a spec case: close the active tab while the other pane's tab is `tiles[0]`. |
| 5 | Moderate | Batch R9u (line 84); Contract delta 1 (line 61) | The forced-overlay mechanism is unnamed. `isOverlay` is purely a host-width breakpoint (`chat-view.component.ts:422-426`). Forcing overlay needs a new ChatView input or token, but R9u does not say which. R9u lists "dock overlay in split" as a named case, yet it does not own `chat-view.dock.spec.ts`, and it already lists eight files, so the spec cannot be added. Name the mechanism and move the dock case to an owned spec (or drop one R9u file). |
| 6 | Moderate | Batch R9v (line 85); Reorder paragraph (line 32) | The card menu trigger placement is unspecified. The card is a fixed 176/96/56 px `li` that hosts `ptah-compact-session-card` (`canvas-rail-card.component.ts:~86-118`). R9v owns only the canvas card, rail and keyboard files. Say where the trigger sits, that it does not collide with `rc-lane-overflow` or the select button, that `isIgnoredCardClick` ignores it, and what its tab order is in the collapsed 56 px state (roving `tabIndex`). |
| 7 | Minor | Batches R9x (line 87) | R9x lists "R9f (header)" as an owner. R9f does not own `canvas-focus-header.component.ts`. No earlier batch owns it, so there is no conflict, but the dependency column is wrong. |
| 8 | Minor | Data flow (line 22); Transcript | Two implementation notes for R9w. First, the previous focused id cannot be "sampled before applying the new value" inside an effect. The board must keep a `lastFocusedId`. Second, `registerVisibleTab` in the transcript is keyed to `active` (`canvas-detail-transcript.component.ts:58-69`), so it must follow the visible signal, not the new focused signal, or the inactive pane stops counting as visible. |
| 9 | Moderate (user decision) | Decisions S2 (line 53); Contract delta 1 | Forcing dock overlay in split at every width, including 1920 where a pane is ~804 px and a 400 px side dock would still leave ~404 px (>= the lane's own 360 px rule), is a lane-chosen layout degradation of the protected display dock (decision 77). A width-based rule would keep the side dock where it fits. See "Proposed removals". |
| 10 | Minor | `batches-rail-r9.md` lines 88, 93, 324-362 | The batches file still shows R9h/R9f/R9l as HELD with a "Depends: addendum gate". Decision 81 lifts that hold, and the addendum assumes it. The team-leader must update it at decomposition. This is not a plan defect. |

The rest of the checks, no new defect found:

- Contract gaps beyond items 3-6: none. The R9u -> R9w chat API boundary is explicit (line 89).
- Wrong file owners: only item 7. R9u and R9w file sets are disjoint from R9b, R9c, R9t, R9l, R9f and R9h writers and run strictly after them.
- Parity coverage: rows 117-124 each have a named test, and the owning batch matches the file. Row 123's "reload order" runs through the persistence service in the board spec, which is acceptable.
- BL budget: "one live ChatView in single focus; exactly two while split is on" (line 36) matches decision 80. "Never create a third host" (line 41) plus the row 117 spec cover it. Add an explicit "<= 2" assertion in R9w.
- Dock protection (decision 77): per-pane dock, `ptah-ui display [id]` update-in-place and re-check items stay. No batch sets `HIDE_AGENT_SIDEBAR: true`, and R9f removes it. Item 9 is the only tension.
- Reorder keyboard accessibility (decision 80): Alt+Shift+Arrow while the card or select button is focused, a keyboard-reachable menu in expanded and collapsed Rail, boundary items disabled, focus restored to the moved card (needed because `@for` moves the DOM node), and a polite announcement. This meets the decision. Open: item 6 for the collapsed trigger.

## Lane-introduced constraints

Tags: user = user-requested, project = project rule, lane = lane-proposed. Only the lane-proposed ones are listed here.

- Split threshold of 1440 px container width; Open beside disabled with a reason below it; widening never reopens a split (line 28). Lane-proposed.
- Split state is ephemeral per workspace visit and not persisted in v3 (S4, line 28). Lane-proposed.
- Details becomes an overlay while split is on (line 30). Lane-proposed.
- Both docks forced to overlay in split at all widths, plus a >= 360 px transcript/composer minimum (lines 30, 92). Lane-proposed (see item 9).
- Action names Open beside, Close split, Close pane, Swap panes, and Escape closes an open menu before it can close a pane (line 26). Lane-proposed. Swap panes is the least justified of these by any user request.
- Move controls: card menu plus `Alt+Shift+ArrowUp/Down`, boundary items disabled, no pointer drag (line 32). Lane-proposed. Move up/down and keyboard accessibility themselves are user-approved (decision 80).
- Lane id prefixes `rail-left-*` / `rail-right-*` and the region labels with `, active` (line 24). Lane-proposed, from the first review.
- A new chat-side `rail-transcript-retention-coordinator.service.ts` and one shared cap of four per Rail board, with both visible tabs pinned (lines 36, 61). Lane-proposed. The cap itself comes from the approved R9 plan (project).
- Executor assignment: R9u and R9w codex only, R9v Claude frontend-developer, R9x either (lines 84-87). Lane-proposed.
- Geometry baseline reset to the expected order after a Move (line 32). Lane-proposed (a fix to the first review's finding 7).

Not lane-introduced: the <= 1 / <= 2 live ChatView rule, the two-session focus area and the reorder item (user, decision 80); the display dock protection (user, decision 77); R9f/R9h unchanged (decision 81); the 180 ms fade, zero detached nodes and per-batch cross-family review (project, base R9 plan and decision 79).

## Proposed removals (for the user)

These are not approved here. They are lane-proposed behaviours that take something away, for the user to confirm or reject:

1. The side-by-side display dock layout inside split panes, at every width including 1920 (item 9).
2. The Details column while split is on (it becomes an overlay).
3. Split itself below 1440 px container width (collapses to one pane).
4. Restoring a split after a workspace switch or reload (S4: split state is not persisted).

## Verdict

REVISE, 7/10. All nine first-review findings are resolved, and the plan is much closer to buildable. The score is held at 7 because batch R9w/R9x leave the header actions with no consumer (item 1), and Swap panes conflicts with the coordinator's no-duplicate rule (item 2). Items 3-6 are single-sentence contract fixes and can go into the same round. Confidence: HIGH on the findings above (each checked against source); MEDIUM on whether the Swap mechanism can be solved by a DOM-order swap instead of a host exchange, since that depends on how R9f's host is keyed.
