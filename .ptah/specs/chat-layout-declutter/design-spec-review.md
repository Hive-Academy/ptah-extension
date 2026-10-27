# Design spec review: chat-layout-declutter (re-review of Revision 1)

Verdict: APPROVED

This is a re-review of `design-spec.md` (Revision 1, with its `## Revision log`) and `parity-inventory.md`
against the checkout at `b72dd7a54`. All 11 earlier findings are resolved. The revision introduced
one new defect, finding R1 below, which batch E must carry. It is a one-line wording fix, so the
spec does not need another review round.

## Earlier findings: spot-check results

| # | Status | Evidence checked |
| --- | --- | --- |
| 1 | Resolved | "Current state" bullet 3 and inventory rows 24-29 now name `execution-header.component.ts:36,63,71`, `agent-card.component.ts:85`, `subagent-lane.component.ts:64`, `canvas-lane-view.component.ts:182,232`. Resume at `agent-card.component.ts:112-129` is preserved. |
| 2 | Resolved | `canvas-lane-view` is assigned to A, `execution-header` to D, `lane-column.ts` to E and `plan-limit-tiles.ts` to C. The `showStats = input(true)` contract is named. The other consumers (`agent-monitor-panel`, `single-chat-subagent-view`) keep the default. |
| 3 | Resolved | The prototype gate is removed. "Visual acceptance" lists Electron before/after screenshots for dark/light, compact/expanded, split, CLI Resume, ~400px and ≥1600px panes, and unknown usage. |
| 4 | Resolved | Two states with one boolean. 56px replaces the 32px tab (`inspector-dock-width.ts:32`). The width-accounting reference `canvas-rail-board.component.ts:480-482` is correct (`- INSPECTOR_TAB_WIDTH`). |
| 5 | Resolved | B owns `presentation="rail"` and `expandRequested`. The input exists at `session-inspector.component.ts:67`. A mounts the rail at `canvas-rail-board.component.ts:274-282` (the `ptah-sidebar-tab`). The order C → B → A ∥ D, with E alongside, is workable. |
| 6 | Resolved, with R1 | 1100px is set on the focus-area ancestor (`canvas-focus-area.component.ts:39-78` contains both the header strip and `ptah-canvas-lane-view`). All four consumers are listed. The breakpoint table is gone. |
| 7 | Resolved | The roster rule is now mutually exclusive `@if` branches. Selection stays in the detail store (`canvas-focus-area.component.ts:70-71`, `detail.laneKeyFor` / `selectLaneFor`). |
| 8 | Resolved | The header Details condition is unchanged (`canvas-focus-header.component.ts:190`). |
| 9 | Resolved | The copy table is cut to fields that change. `lane-tiles.ts:115,124,171,715-718` and `plan-limit-tiles.ts:74,237-238` own the strings, and their specs are updated with them. |
| 10 | Resolved | The padding redesign, request-focus behaviour and live-region rules are removed. The token section is trimmed. The Run tile badge reuses `statsTabBadge` (`canvas-rail-board.component.ts:485-489`). |
| 11 | Resolved | Batch E no longer has the screenshot-reconciliation note. |

Batch file-disjointness holds: no file appears in two batches in the "Implementation batches" table. Dependency direction is still canvas → chat → chat-ui, and no step asks chat to import canvas.

## Remaining findings

R1. **[major, new in Revision 1] Removing the 758px declaration leaves the controls wrapper without a fallback.**
   - Evidence: change 6 and "Responsive rules" say "Remove the layout's overriding 758px declaration (`chat-session-layout.component.ts:16`); retain fallback values for non-canvas consumers."
   - Three consumers already have a 758px fallback: `chat-input.component.ts:591`, `chat-transcript.component.css:67` and `lane-column.ts:10`.
   - `chat-view.component.html:83` does not: `style="width: calc(100% - 1.5rem); max-width: var(--chat-content-max-width)"`.
   - `ChatViewComponent` is also mounted outside canvas through `session-embed.component.ts:34,73`. Outside the canvas focus area the variable would be unset there, so the session-controls row would lose its cap while the transcript and composer stay at 758px, and the rows would no longer line up.
   - Exact fix (batch E, wording in change 6): change `chat-view.component.html:83` to `max-width: var(--chat-content-max-width, 758px)`. Add a regression assertion to the existing `chat-session-layout.component.spec.ts` (or the chat-view spec) that a host without the ancestor variable still caps the controls row.

R2. **[minor] One sentence in "Responsive rules" paragraph 2 is ambiguous.**
   - The sentence: "Below room for 360px plus the rail, the compact presentation uses the existing overlay shell rather than consuming main width."
   - Today the Stats tab renders only when `dockShown()` is true (`canvas-rail-board.component.ts:272`, single focus). Narrow and compact layouts use the existing sheet (`presentation="sheet"`, `:333`).
   - Fix: replace the sentence with: "The 56px rail renders under the same `dockShown()` condition as today's Stats tab. Where that condition is false, the existing header Details → sheet path is the entry point. No new overlay rail."

R3. **[minor] The A/E coordination needs one explicit sentence.**
   - A sets the 1100px ancestor value. E removes the `:host` value at `chat-session-layout.component.ts:16`.
   - If only A lands, the `:host` declaration still overrides the inherited value and nothing widens. If only E lands, canvas falls back to 758px, which is harmless.
   - Fix: add "E's removal at `:16` and A's ancestor declaration are verified together in one integration pass before the visual screenshots" to the dependency-order paragraph. It is mostly said already ("A+E integrated for width verification"), so this is optional.

## Nothing to escalate to the user

All decisions can be settled from the code. The 1100px cap is reversible and should be checked on the ≥1600px screenshot.
