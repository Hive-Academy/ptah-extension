# Code Logic Review — TASK_2026_699_833e

Review family: codex (implementer: claude)  
Scope: `17b523b2e..2ac83d78e`

## Summary

| Metric | Value |
| --- | --- |
| Score | 6/10 |
| Verdict | REVISE |
| Blocking | 0 |
| Serious | 1 |
| Moderate | 0 |
| Failure modes | 1 |

The width policy, dock drag path, and md/sm state reset follow the rev 4 contract. One responsive transition loses an open inspector. That explicit behavior gap separates this score from 7–8; the otherwise bounded and tested width path separates it from 3–4.

## Findings

| Severity | Location | Finding and impact | Required change |
| --- | --- | --- | --- |
| Serious | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:310-312,378-387,907-910` | The compact sheet reads `detailsOpen`, while the single-focus dock reads `dockOpen`. Opening Stats at 760 px then narrowing below 400 px removes the open dock without opening the sheet. Opening the compact sheet below 400 px then widening to 400–1119 px removes the sheet and leaves the dock closed. The open inspector disappears; the focused sheet control can also be removed with no focus handoff. This violates task-description AC 5.4's sheet-to-dock continuity. | On crossing the 400 px compact boundary, hand the current open choice to the destination state, close the old presentation, and explicitly move focus. Add a board spec that crosses 400 px in both directions while the inspector is open. |

## Five logic questions

1. **Silent failure:** The transition above removes the visible inspector without an announcement or state handoff (`canvas-rail-board.component.ts:311-312,379-387,268-270`). Storage write failure also leaves the in-memory width looking committed while logging the failure (`inspector-dock-width.store.ts:65-70`); that is the existing documented fallback, not a finding in this range.
2. **Unexpected user action:** Resize the board from 760 to 390 px after opening Stats, or from 390 to 400 px after opening the sheet. The presentation disappears (`canvas-rail-board.component.ts:311-312,379-387,907-910`).
3. **Wrong-answer input:** No wrong width result was found for finite preferences or the reviewed width bands. The max floors fractional space and clamps to 300–560 (`inspector-dock-width.ts:41-51,76-86`); stored values are parsed and clamped (`inspector-dock-width.store.ts:19-30`). Below 660 px shared width, the 300 px dock minimum takes precedence over the tile floor as decision 18 specifies.
4. **Dependency failure:** A `localStorage` read/write/remove exception is caught, logged once per operation kind, and leaves a session-only preference (`inspector-dock-width.store.ts:61-93,122-129`). The resize handle cancels on pointer loss, blur and Escape, and removes listeners on destruction (`split-handle.component.ts:192-207,283-322`).
5. **Missing case:** The new board specs cover width bands and separate split/compact rendering, but do not cross the 400 px boundary with either presentation open (`canvas-rail-board.component.spec.ts:841-912,1674-1749`).

## Failure mode

### Open inspector disappears at the compact boundary

- Trigger: Cross 400 px while the dock or compact sheet is open.
- Symptom: Inspector vanishes; a focused control in the removed sheet has no programmed focus destination.
- Evidence: `canvas-rail-board.component.ts:268-270,310-312,378-387,907-910`.
- Current handling: The computed presentation changes, but neither state is transferred.
- Recommendation: Add a compact-boundary transition that preserves an open inspector in the destination presentation and restores focus.

## Data flow

1. The host measures the board content width with `ResizeObserver` and stores a floored pixel value (`canvas-layout.service.ts:48-64`).
2. The board derives rail band, effective rail collapse and shared width after the 32 px Stats tab (`canvas-rail-board.component.ts:373-395,407-414`).
3. The dock controller selects draft or stored preference, then clamps the rendered width and max (`inspector-dock.controller.ts:44-59`; `inspector-dock-width.ts:41-51,76-86`).
4. The separator previews on drag/key and commits on release; the store clamps and persists (`canvas-rail-board.component.ts:229-246`; `inspector-dock.controller.ts:70-100`; `inspector-dock-width.store.ts:61-80`).
5. At the compact boundary, the renderer switches between `dockOpen` and `detailsOpen` without transferring the open choice (**gap**, `canvas-rail-board.component.ts:268-270,310-312,378-387`).

## Requirements and edge cases

| Check | Result | Evidence |
| --- | --- | --- |
| 300–560 px dock, 360 px tile floor when space allows | Met; 300 px dock takes precedence below 660 px shared width per decision 18 | `inspector-dock-width.ts:7-15,41-51`; `canvas-rail-board.component.ts:388-395` |
| 336/400/448 defaults and persisted preference restored after clamping | Met | `inspector-dock-width.ts:17-25,58-86`; `inspector-dock-width.store.ts:19-30,83-93` |
| Dock state separate from split/compact state; sm↔md reset only | Met for band transitions | `canvas-rail-board.component.ts:310-312,373-387,775-831` |
| Rail auto-collapses with open sm dock | Met | `canvas-rail-board.component.ts:407-414` |
| Split/compact focus and Escape | Existing paths retained | `canvas-rail-board.component.ts:775-854` |
| Pointer capture, destruction cleanup, keyboard resize and separator ARIA | Met in shared handle | `split-handle.component.ts:48-61,185-207,210-260,294-326` |
| Open inspector survives compact↔dock resize | **Missing** | `canvas-rail-board.component.ts:310-312,378-387` |
| Chat view and shell controller equal `main` | Verified by empty `git diff main --` for all four `chat-view.component.*` paths and `inspector-shell.controller.ts` | Exact paths listed in review scope |

## Decisions

- Treat the 360 px tile floor's exception below 660 px shared width as intentional: decision 18 explicitly gives the 300 px dock minimum precedence. Options were enforcing 360 by reducing the dock below 300 or retaining the specified 300 minimum. Evidence: `inspector-dock-width.ts:10-15,45-51`. Reversible: yes.

## Verification and uncertainty

Read the complete changed implementation files, relevant changed spec sections, and the shared resize handle. The orchestrator reported scoped typecheck, test and lint passing for chat-ui, chat and canvas. No new test was run. `ptah_get_diagnostics` was attempted twice for the canvas board and dock controller; both calls timed out with the two files unchecked. The `ptah_code_search_symbols` index had zero symbols, so one native `rg` search checked width-symbol use. `git diff --check 17b523b2e..2ac83d78e` passed. Visual behavior at the compact boundary remains unverified in a browser.

## Verdict

**REVISE.** Preserve the open inspector and focus across the compact boundary, then cover both resize directions in a board test.

