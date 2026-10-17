# Implementation Plan Review - TASK_2026_690_a5c0

- Plan reviewed: `implementation-plan.md` (codex CLI lane), 108 lines
- Reviewer: Claude (in-process, independent)
- Inputs read: `context.md`, `task.md`, `implementation-plan.md`, and the source files cited below
- No build, serve, e2e or test runs were made.

## Verdict

**REVISE**. Score **7/10**.

The evidence is unusually accurate: 15 of the 16 citations I checked are correct, and the one miss is minor. The parity table and the Proposed Removals are honest. The plan has five gaps that would cost the implementer a cycle:

1. `DisplayDockState` also stores the VS Code Agents panel state. The plan does not say so.
2. The Electron eager-closure gate pins the dock file paths.
3. A Canvas overlay selector names `ptah-display-dock`.
4. The ownership of interactive state between the inline renderer and the sheet renderer is left undecided.
5. Nothing stops `chat-view.component.ts` (2080 lines) from growing.

## 1. Citation spot-check (16 checked)

| # | Plan claim | Cited location | Result |
| --- | --- | --- | --- |
| 1 | Electron root `h-screen w-screen`; content row and app host `flex-1 min-h-0 overflow-hidden` | `electron-shell.component.ts:107,289,321-324` | Verified (107, 289, 321, 323). |
| 2 | App main column `flex-1 flex flex-col min-w-0` without `min-h-0`; content `flex-1 overflow-hidden`; chat wrapper `h-full` | `app-shell.component.html:558-560,800-841` | Verified (559, 804, 834-840). The comment at 55-67 forbids outer `overflow-y-auto`. Verified. |
| 3 | Chat main column without `min-h-0`; transcript wrapper `flex-1 min-h-0`; composer `flex-shrink-0` | `chat-view.component.html:2-7,101-126,268-271` | Verified (5, 101, 268-270). |
| 4 | Transcript host `flex-1 flex flex-col min-h-0` | `chat-transcript.component.ts:278` | Verified. |
| 5 | Scroller is the first child, carrying the 683 class and the prepend-anchor directives | `chat-transcript.component.html:1-13` | Verified. |
| 6 | Scroller CSS `height:100%`, `overflow-y:auto`. The plan says "give it `min-h-0`" | `chat-transcript.component.css:36-43` | **Partly wrong**: `min-height: 0` is already at line 39. Only the `height:100%` change is real. |
| 7 | Duplicate `.chat-scroll-container` in the chat-view CSS | `chat-view.component.css:75-81` | Verified. Under emulated encapsulation it probably does not reach the transcript's element, so it is dead code rather than a competing rule. The plan's "after confirming encapsulation" is correct. |
| 8 | 683 keyframes animate only opacity and transform; reduced-motion override present | `chat-transcript.component.css:1-14` | Verified. |
| 9 | Canvas tile `overflow-y-auto`, `min-h-[400px]` in split; pane container `overflow-x-auto` | `canvas-rail-board.component.ts:166-176` | Verified (166, 169). |
| 10 | Lane host `block h-full min-h-0 overflow-auto`; orchestrator wrapper `h-full` | `canvas-lane-view.component.ts:50,63-67` | Verified. Lines 68ff also render `laneBlocks()` as siblings. The plan's "no extra block in flow" covers this only indirectly. |
| 11 | Dock: right sibling, toggle, separator, `@defer` with an error block | `chat-view.component.html:311-369` | Verified. The VS Code Agents rail is at 370-406. Verified. |
| 12 | Display state exists only in Electron; it resolves to null in VS Code | `chat-view.component.ts:235-245` | Verified. **Incomplete**: see F1. |
| 13 | Auto-open, user-close suppression in the same turn, `newCount` | `display-dock.state.ts:343-369` | Verified (`requestAutoOpen` at 350-370). |
| 14 | `setSurfaces` view-state retention; `forgetTab` | `display-dock.state.ts:288-325,143-148` | Verified. |
| 15 | Message text routes `target === 'display'` to the chip under the `ui:<ordinal>` key | `ptah-ui-message-text.component.ts:46-49,77-84,116-125` | Verified. |
| 16 | Composer `max-w-[758px] mx-auto`; answer `max-w-[600px]`; content `width:100%` | `chat-input.component.ts:846-848`, `message-bubble.component.html:70,92`, `chat-transcript.component.css:45-50` | Verified. |

The following were also checked and found accurate:
- `display-surfaces.ts:240-263`
- `display-panel.component.ts:207-220,265-268`
- `display-dock.component.ts:65-88,92-108,116-174,205-229`
- `ptah-ui-display-chip.component.ts:116-130,306-364`
- the chip's `unavailable` state in VS Code at 309-316

### Screenshot diagnosis

The inference is sound but rests on an unstated premise. It blames the far-right scrollbar on the Canvas tile (`overflow-y-auto`) plus the lane host (`overflow-auto`). That holds only if the screenshot was taken in Canvas mode. `context.md` does not say which mode it was. Canvas mode is the likely one: `app-shell.component.html:813-815` calls the canvas "the Electron launch surface". The plan should cite that line and state the premise.

In single-chat mode the chain is already clipped at the app shell (`app-shell.component.html:804` has `overflow-hidden`, so its automatic min-height resolves to 0), and the "missing `min-h-0`" at 559 does not matter in a flex row. The plan's insistence on measuring `clientHeight`, `scrollHeight` and `overflowY` before fixing is the right safeguard. Add three surfaces to the measurement list:
- `document.scrollingElement` / `body`
- the display dock host
- the lane view's `laneBlocks` siblings

## 2. Findings

| ID | Severity | Plan section / line | Finding | Required change |
| --- | --- | --- | --- | --- |
| F1 | **High** | Parity row "Electron-only display state" (l.47); Component 4 Files (l.76); Proposed Removals (l.52) | `DisplayDockState` is not Electron-only. In VS Code, `panelState = this.displayDock ?? new DisplayDockState()` (`chat-view.component.ts:433-437`) stores the Agents panel's open state, `agentsUserClosed`, `requestAgentsOpen` and `releaseAgentsUserClose` (`chat-view.component.ts:1463-1477,1501-1515`; `display-dock.state.ts:270-286`). `toggleAgentPanel`/`closeAgentPanel` (561-574) and `isOverlay`, which is computed from `dockWidth()` (420-425,453-474), drive the VS Code monitor too. The VS Code resize handle uses the same `onResizeStart`/`onResizeReset` (666-697). "MODIFY/RENAME display-dock.state.ts" and "remove width persistence" can therefore break the VS Code Agents rail, which the plan promises to keep. | Split the store explicitly: (a) the right-panel open/agents/width state that the VS Code monitor keeps, and (b) the display surfaces, statuses, view state and presentation state that move to the sheet. Name which fields and methods go where. Keep `PanelResizeService` and the overlay breakpoint for the VS Code path. Add a VS Code agent-panel regression to the verification. |
| F2 | **High** | Component 4 (l.76, "DELETE display-dock.component.ts"); handoff (l.94) | `apps/ptah-electron/src/config/eager-closure-gate.spec.ts:89-91,131-133` lists `display-dock.component.ts`, `display-dock.state.ts` and the lazy `display-panel` entry by path. The plan's own Component 4 relies on decision D14: the panel stays out of the eager chunk (`display-dock.component.ts:15-18`). The pre-push hook runs the Electron `validate-deps` gate. Renaming or deleting these files, or importing `DisplayPanelComponent` eagerly from the new sheet, fails the gate. | State that the sheet loads `DisplayPanelComponent` through `@defer`, and that the peek bar itself stays eager and light. Add the gate spec and its config to the Files list and the verification (`ptah-electron` project spec on `eager-closure-gate.spec.ts`). |
| F3 | **Medium** | Component 2 Files (l.64) | `canvas-rail-board.component.ts:40` defines `PANE_OVERLAYS = '[role="dialog"], [role="menu"], ptah-display-dock.absolute'`. It is used at 47 and 934 for pane activation and focus. Deleting the dock leaves a stale selector. If the full-height sheet ever covers the pane, it must match this selector or its clicks will re-activate panes. | Add this selector change to the Canvas component and decide whether the sheet matches it. |
| F4 | **Medium** | Architecture decision (l.33); Component 3 Failure (l.70) | The plan admits the problem — "inline and sheet instances must share resolved data and define which interactions are read-only" — and leaves it open. Today only the dock renders a surface, and its view state lives in `viewStates` (`display-dock.state.ts:224-237`). With two live renderers of the same surface, interactive edits (tabs, filters, expanded rows) either diverge or need a shared store. | Make it a Decision. Recommended: the sheet is the interactive instance and owns `viewStates`. Inline display-target blocks render through the existing `ptah-ui-block` pipeline with its own local state, so a historical block is a snapshot of its own fence. Then record that inline edits do not propagate. |
| F5 | **Medium** | Inputs (l.6); Component 1 (l.58, "optionally CREATE chat-session-layout"); Component 4 (l.76) | The task rule is that the plan must not grow `chat-view.component.ts` (2080 lines) or `chat-transcript.component.ts` (1376 lines). The plan says "extract rather than grow" but makes the extraction optional and gives no measurable limit. Component 4 adds sheet wiring to `chat-view.component.ts`. | Add a measurable criterion: the net line count of both files must not increase, checked with `wc -l` before and after each batch. Put the sheet's open, peek, full and pulse state and its auto-open effect in the sheet component or its store, not in ChatView. Removing the dock width, separator and `syncDockWidthPerTab` code (Electron branch only, see F1) is the budget that pays for the wiring. |
| F6 | **Medium** | Component 4 Contract (l.77); quality requirements (l.83) | Auto-opening the sheet to about 40% cuts the transcript scroller's height mid-stream. The scroller has `[pinnedToBottom]` and a prepend anchor (`chat-transcript.component.html:7,12`). Neither the contract nor the tests say that a pinned-to-bottom transcript stays pinned when the sheet opens, expands or collapses, or on a tab switch whose tabs have different sheet states. A tab switch is the 683 motion moment: the sheet sits outside the animated scroller node, so its height change is visible during the fade and lift. | Add these contract points: the sheet size changes keep bottom pin and reading position; the sheet state per tab is applied before the entering transcript paints; the sheet does not animate height on a tab switch. Add one regression spec. |
| F7 | **Medium** | Component 3 (l.68-70); parity row (l.47) | VS Code behaviour for display fences is left as "need a safe render path". Today VS Code shows the chip's `unavailable` state (`ptah-ui-display-chip.component.ts:309-316`). Rendering every display-target fence inline through `ptah-ui-block` changes VS Code behaviour too. That is probably what the user wants, but it is a decision, not an implementation detail. | Decide it. Recommended: VS Code renders display fences inline like Electron and has no sheet. Record the decision under Decisions. |
| F8 | Low | Batches (l.93-96) | Batches 1 and 4 both modify `chat-view.component.html` (and possibly `.css`), so they are not file-disjoint. The plan only orders them ("sequentially after batches 1 and 3"). Batch 3 deletes the chip while Batch 4 removes the dock providers. That works only if Batch 3 leaves the `PTAH_UI_DISPLAY_DOCK` port and its exports in `chat-ui/src/ptah-ui.ts` intact. | State that Batches 1 and 4 share files and must run in sequence. State that Batch 3 keeps the chat-ui display-dock ports. Name the scoped checks per batch: `npx nx test chat --parallel=1`, `chat-ui`, `canvas`, and `ptah-electron` for F2. |
| F9 | Low | Height audit row 4 (l.18) | "give it `min-h-0`": the scroller already has `min-height: 0` (`chat-transcript.component.css:39`). | Correct the row. The only change is to replace `height:100%` with flex sizing. |
| F10 | Low | Component 4 Contract (l.77) | "Display · N items" does not define N: surfaces only, or surfaces plus the turn summary. The dock heading counts surfaces only (`display-dock.component.ts:63`). | Define N as the number of surfaces, matching the existing heading. |
| F11 | Info | Clarifications Needed (l.104-107) | The plan is provisional on Clarification 1 and asks for confirmation before implementation. That is correct, because the two user answers conflict (`context.md:30-34`). The orchestrator must get the answer before the team-leader decomposes. | None. |

## 3. Requirement trace

| User point (`context.md`) | Component / batch | Status |
| --- | --- | --- |
| One scroller, responsive heights, no gap under the composer (1) | C1 / B1, C2 / B2 | Covered. Diagnosis premise: see section 1. |
| Chat centered (2) | C1 shared max-width / B1; dock removal / B4 | Covered. |
| Inline blocks, no "open in display" (3, answer 2) | C3 / B3 | Covered. Inline/sheet state ownership is undecided (F4); VS Code behaviour is undecided (F7). |
| Peek-bar sheet: about 40% on update, full height, collapse, pulse, transcript keeps its own scroll (answer 1) | C4 / B4 | Covered. The pinned-bottom interaction is missing (F6). |
| Remove the right DISPLAY rail (3) | Proposed Removals, C4 / B4 | Covered. The shared VS Code coupling is missing (F1); the gate (F2) and Canvas selector (F3) are missing. |
| Keep the 683 pane switch motion working (out of scope, must keep working) | Height audit row 9, C1 seam, quality requirements | Covered for the scroller node. Sheet behaviour on tab switch is missing (F6). |

## 4. Parity

The kept or moved items are complete:
- inline rendering
- ID resolution, supersession and eviction
- chip statuses
- per-tab state and cleanup
- auto-open and suppression
- pin
- strip selection and unread dot
- the turn summary and its file/review actions
- the summary chip

Proposed Removals lists the chip's "Open in display" / "Open latest" action, the right toggle, width persistence, the separator, the overlay and its focus handling, and pin if the sheet does not keep it.

Two parity gaps:
- **Gap (F1):** the shared right-panel state and resize code that the VS Code Agents rail depends on. It is not listed as kept. It sits in the same symbols the plan proposes to rename or remove.
- **Gap (minor):** the dock's `newCount` badge on the right toggle (`chat-view.component.html:319`) moves to the peek bar implicitly but is not named. Name it in the C4 contract.

## 5. Feasibility and risk

- **Canvas/Rail split:** the selected-lane chain and the 400px tile minimum are correctly identified. `RAIL_MIN_CONTENT_WIDTH` (`chat-view.component.ts:119`, provided by `session-embed.component.ts:87`) feeds the dock's overlay rule. Once the Electron dock is gone, its only remaining consumer is the VS Code monitor path. The plan should say whether the token stays.
- **VS Code webview:** F1 and F7.
- **File size:** F5.
- **Angular rules:** standalone, OnPush, signals, `input()`/`output()` and `@defer` are stated. Lazy loading is not tied to the eager gate (F2).
- **Sheet accessibility:** good. Covered: button with `aria-expanded`/`aria-controls`, a region rather than a dialog unless the sheet traps focus, a keyboard alternative to drag, Escape, focus return, no focus steal on agent updates, and announcing new items once.
- **Reduced motion:** covered for the pulse and the 683 switch. The sheet's open/close height transition needs the same rule. If it animates height, it breaks the repository rule "compositor properties only". Specify a transform-based reveal or no height animation.
- **Batches and scoped checks:** F8.

## Lane-introduced constraints

The plan adds these rules; the user did not ask for them. Tag each one as lane-proposed and confirm or drop it when the plan is approved.

1. Fix the Canvas split height chain as its own component (C2). The user described scrollbars and heights in the chat; Canvas is the plan's inference about where the screenshot came from.
2. Verify at 1440px and 760px, both themes, normal and split, with short and long transcripts and a multiline composer.
3. One shared `max-width` token and equal inline padding for transcript content, banners and composer.
4. Keep inline historical display blocks visible after a later block supersedes them.
5. Keep the sheet and display migration Electron-only; VS Code keeps the Agents monitor and gets no sheet.
6. Keep pin, as "hold selection", in the sheet if the control is retained.
7. Collapsing the sheet during the active turn suppresses auto-reopen and increments the count. This carries over existing dock rule R1.8; the user did not restate it.
8. Keyboard alternative to drag (buttons or Up/Down/Home/End), Escape to collapse, focus returns to the bar.
9. Use the `region` role for the expanded sheet; use `dialog`/`aria-modal` only if full height traps focus.
10. Announce new items to assistive technology once.
11. Remove the duplicate `.chat-scroll-container` rule in `chat-view.component.css`.
12. The summary chip opens the sheet on that turn's summary.
13. A local, retryable error when the sheet's lazy load fails.

## Re-review (round 1)

- Plan reviewed: revised `implementation-plan.md` (138 lines), including its "Revision log (round 1)"
- Binding input: `context.md:36-44` (user answers to the plan clarifications)
- No build, serve, e2e or test runs were made.

### Verdict

**APPROVED**. Score **8.5/10**.

All of F1-F11 are resolved, each with evidence I checked against the source. The plan follows the binding answers exactly. The only removal is the Electron right DISPLAY rail and its toggle, width persistence, resize separator and overlay mode (plan l.50-52). Both items the user kept are still there: the Open in display equivalent (l.33, l.70) and the sheet pin (l.44, l.77). Nothing else is removed. Four new low-to-medium gaps remain (N1-N4). None blocks; the team-leader should close each one when it writes `batches.md`.

### Finding-by-finding check

| ID | Status | Evidence |
| --- | --- | --- |
| F1 | Resolved | New parity row and Component 4 "State boundary" (l.78). Both keep right-panel `open`, `activeTab`, `agentsUserClosed`, `widthPx`, the agent methods, `PanelResizeService`, the overlay breakpoint and `RAIL_MIN_CONTENT_WIDTH` for VS Code. Checked: `RAIL_MIN_CONTENT_WIDTH` keeps a non-canvas consumer, because `session-embed` is also used by `harness-builder-view.component.ts`. The width-sync removal is conditional on checking VS Code use. That condition is correct: `storeDockWidth` is called from the shared resize paths (`chat-view.component.ts:611,640,696,721`), where it is a no-op without a dock. |
| F2 | Resolved | Component 4 Files names `@defer`, an eager and light peek bar, `apps/ptah-electron/src/config/eager-closure-gate.spec.ts` and `scripts/eager-closure-gate.js` (exists, verified), plus a `ptah-electron` scoped test (Batch 4). |
| F3 | Resolved | Component 2 updates `PANE_OVERLAYS` (`canvas-rail-board.component.ts:40,47,934`) and states when the sheet counts as an overlay. See N2 for the batch order. |
| F4 | Resolved | Architecture decision (l.33) and a Decisions row: the sheet owns persisted `viewStates`; an inline fence keeps only local, non-propagating state; an evicted or invalid ID reports unavailable locally. |
| F5 | Resolved | `chat-session-layout.component.ts` is now a required extraction. A zero-net-growth line-count gate on ChatView and ChatTranscript is set in Component 1 and Batches 1 and 4. Sheet state and effects go to `DisplaySheetState`. |
| F6 | Resolved | "Scroll and switch seam" (l.79) covers bottom pin, reading position, per-tab sheet state applied before paint, no height animation during a switch, and a regression spec. |
| F7 | Resolved | Component 3 and Decisions: VS Code renders display fences inline, keeps its Agents rail, gets no sheet, and its action reports the collection unavailable. |
| F8 | Resolved | Batch 4 states that it shares `chat-view.component.html`/`.css` with Batch 1 and the chip action with Batch 3, and must run after both. Batches name the scoped checks: `chat`, `canvas`, `chat-ui`, `ptah-electron`, `ptah-extension-webview`. |
| F9 | Resolved | Height audit row acknowledges the existing `min-height:0`. |
| F10 | Resolved | N = current surfaces (`display-dock.component.ts:63`); `newCount` moves to the peek bar. |
| F11 | Resolved | Clarifications set to "None", citing the binding answers. |
| Diagnosis premise | Resolved | The Canvas-mode assumption is stated and cites `app-shell.component.html:813-815`. The measurement list now includes body, dock host and `laneBlocks` siblings. |
| Lane-introduced constraints | Resolved | Tagged "lane-proposed" in Components 1-3, the quality requirements and the "Constraint provenance" paragraph (l.103). The paragraph says they do not authorize any removal. |

### New or residual findings (non-blocking)

| ID | Severity | Plan location | Finding | Recommendation for the team-leader |
| --- | --- | --- | --- | --- |
| N1 | Medium | Parity row "Shared right-panel..." vs Component 4 "State boundary" (l.78) | There may be two sources of truth for whether the sheet is open. `requestAutoOpen` is a sync-port method on `DisplayDockState` and writes `open` (`display-dock.state.ts:350-370`). The plan keeps `open` as a right-panel field for VS Code, yet gives collapsed/peek/full to `DisplaySheetState`. The parity row says auto-open and close suppression "move into sheet/data ownership"; Component 4 keeps them behind the `DisplayDockState` facade. Nothing says how Electron's `open` relates to the sheet mode. | Settle it in `batches.md`. Suggested rule: in Electron, `DisplayDockState.tab().open` is the single "sheet expanded" flag, written by auto-open, the user and close suppression. `DisplaySheetState` holds only peek vs full height and the pulse. Collapse calls `close()`, so R1.8 suppression keeps working unchanged. |
| N2 | Low | Batch 2 (l.97) vs Batch 4 | Batch 2 removes the stale `ptah-display-dock.absolute` term "after dock deletion", but the dock is deleted in Batch 4, and Batch 2 is not ordered after it. | Move the `PANE_OVERLAYS` edit into Batch 4, or order Batch 2 after Batch 4 for that line. |
| N3 | Low | Height audit row 2 vs Screenshot diagnosis and Component 1 Files | The audit row still says "Add `min-h-0` to the main column and active content" of `app-shell.component.html`. The diagnosis now says not to change the app shell without measured overflow. | Treat the app-shell edit as conditional on the measurement. |
| N4 | Low | Component 1 (l.58) | The new `chat-session-layout` component wraps the transcript, banners, sheet and composer. ChatView reads `chatInputRef` with `viewChild` and renders the transcript `@for`. A layout that renders those children in its own template rather than by projection would break those queries and grow coupling. | Specify that the layout component projects with `<ng-content>` slots. ChatView keeps ownership of the children and their queries. |

### Lane-introduced constraints (round 1)

The list in the first-pass review still stands. The revised plan now labels these items lane-proposed itself (l.103):
- the Canvas repair, until measured
- the viewport, theme and content test matrix
- keyboard control of the sheet
- region semantics
- a single announcement of new items
- the duplicate CSS cleanup
- the retryable lazy-load error

New lane-proposed items in round 1:
- a historical inline block's interactions stay local and do not propagate (Decisions)
- VS Code's inline action reports "collection unavailable" (Component 3)
- the sheet height does not animate during a tab switch (l.79)

None of these removes a capability.
