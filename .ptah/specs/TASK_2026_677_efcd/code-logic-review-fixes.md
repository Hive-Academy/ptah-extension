# Re-review - fix round (grok)

Score: 7/10
Verdict: APPROVED
Review family: reviewer grok; fixer codex (+ orchestrator stubs)
Scope: ccc43b737, 0cf3936f6, 6e96c36c3

The prior serious paths now fail visibly or behave as specified, which is what separates this from 5-6. It is not 8-9: the new rail cue still omits pending requests, and compact-sheet Tab still binds whatever dialog is first in the board. No source was edited. No build or test was run (forbidden this round). D-1 moderate 5, codex moderate 3 and 4, and the style item were not re-opened.

## Finding status

| Source | Finding | Status | Evidence |
| --- | --- | --- | --- |
| Codex serious 1 | Failed Steer closed the input | FIXED | `session-agent-tray.service.ts:83-88` returns the boolean and maps rejection to `false`. `inspector-agents-section.component.ts:384-393` closes only when `sent` is true; otherwise `steerErrorKey` stays on that row. `agent-steer-input.component.ts:99` clears the draft only when `clearOnSubmit()` is true, and the inspector sets it false (`inspector-agents-section.component.ts:221`). The alert is inside the open steer block (`:225-228`). |
| Codex serious 2 | `awaiting-background` with live agents showed idle | FIXED | `session-inspector.store.ts:98-99` returns `waiting` when status is `awaiting-background` and `liveAgents > 0`. `agent-status.ts:97` returns `waiting` for the same pair. `session-agent-roster.ts:188-199` passes that flag. The live set is `running`, `waiting`, or `queued` in both the roster (`:188-193`) and the store (`:235-239`). |
| Decisions row 81 | Approval chip `aria-haspopup="menu"` | FIXED | `autopilot-popover.component.ts:37-39` is `aria-haspopup="dialog"` and points `aria-controls` at `popoverId` while open. `:60` is `role="dialog"` with that id (`:200`). `panelRole` is null (`:23`), so the floating panel is not a listbox (`native-dropdown.component.ts:89`). |
| Decisions row 94 | Turn copy button stayed 24 px | FIXED | `message-bubble.component.html:124` sets `turnActionSize`. `copy-button.component.ts:30-32` then uses `h-7 w-7` (28 px). The input defaults false (`:53`); the only other `ptah-copy-button` host is this turn row. `clearOnSubmit` defaults true (`agent-steer-input.component.ts:70`), so the background strip still clears on submit. |
| B-5 serious 1 | Focus never entered the overlay, so Escape did nothing | FIXED | `canvas-rail-board.component.ts:681-695` focuses the split aside or `[data-compact-sheet]` on the next render. Both nodes are `tabindex="-1"` and listen for Escape (`:184`, `:249`). The close control is inside `@defer`, so a `MutationObserver` moves focus to `[data-inspector-close]` when that button appears, then disconnects (`:687-694`). `stopDetailsFocusObserver` runs on destroy (`:358`), on close (`:706`, `:724`), and before a new open (`:680`). |
| B-5 serious 2 | Tab trapped dead in the compact sheet | FIXED | `isTabbable` (`:43-47`) rejects a dialog or menu only when it is not the sheet dialog passed in. `onSheetKeydown` (`:734-749`) passes that dialog, so controls inside it stay tabbable and Tab wraps at the ends. The pane and rail are `inert` while the sheet is open (`:82`, `:154`); the sheet itself is outside those nodes (`:247-256`). |
| B-5 moderate 3 | Choosing a lane left the compact sheet up | FIXED | The sheet binds `openLaneFromCompactSheet` (`:251`, `:729-731`), which stores the lane and then calls `closeCompactSheet`. The split overlay still calls `selectLaneFor` only (`:186`), so the uncovered column stays open. |
| FIX-2 bundle | Inspector left the eager chat barrel | FIXED | `libs/frontend/chat/src/lib/components/index.ts` no longer exports `SessionInspectorComponent`. The new entry is `libs/frontend/chat/src/inspector.ts`, mapped in `tsconfig.base.json`. Production imports are the board (`canvas-rail-board.component.ts:18`) and `chat-view.component.ts:57` (relative, because that host renders it). `SessionTaskReader` is imported only by `inspector-task-section.component.ts:26`. |
| FIX-2 D3.7 | Closed-state limit cue on the rail toggle | PARTIAL | Ring, dot, text chip, and description are present for a near or at limit (`canvas-focus-header.component.ts:192-226`, `:323-329`). Context percent is null unless the window is known (`session-stats-view.ts:53`), and the description then includes the rounded percent (`session-limit-summary.ts:49-50`), so the ring is not colour alone. Pending requests are omitted; see new defect 1. |
| D-1 serious 1 | Context details control inside `role="progressbar"` | FIXED | The progressbar is the inner flex (`inspector-session-stats.component.ts:42-60`). The details outlet is the next sibling (`:61`), so the button (`:149-151`) is outside it. |
| D-1 serious 2 | LANES name was on a generic span | FIXED | `inspector-limits-lanes.component.ts:52` sets `role="img"` and `aria-label` from `lanesAriaLabelFor` (`session-stats-view.ts:122-124`). |
| D-1 serious 3 | Budget bar ignored `SessionBudgetStage` | FIXED | `budgetInk` maps `limit` to err and `tighten` or `handoff` to need (`inspector-session-stats.component.ts:213-214`). Fill and `aria-valuenow` use `clampPercent` (`:72-74`, `:92-94`, `:211`). `aria-valuetext` uses `Math.floor`, matching `budgetTooltip` (`session-budget-format.ts:86`). |
| D-1 moderate 4 | Known-subtotal caption under a lower-bound cost | FIXED | `inspector-session-stats.component.ts:87-88` skips the caption when `costBudgetText` is set. A `cost-lower-bound` budget takes that text (`session-budget-format.ts:54-56`) and has a null cost suffix (`:40-42`), so only the `≥` value remains. |
| D-1 moderate 6 | Escape on a details button also dismissed the overlay | FIXED | `closeOnEscape` (`inspector-session-stats.component.ts:206-209`) calls `preventDefault` and `stopPropagation` when that section is open, then closes it. A closed section still lets Escape bubble. Wired on the detail button (`:151`) and the models button (`:120`). |
| D-1 moderate 7 | Known context above 100% was an out-of-range progressbar | FIXED | `aria-valuenow` is `clampPercent` (`inspector-session-stats.component.ts:45`, `:211`). The visible label stays the raw percent (`session-stats-view.ts:54`) and `aria-valuetext` repeats that label (`inspector-session-stats.component.ts:47`). |
| FIX-3 e2e | Four locators still targeted `ptah-session-stats-summary` | FIXED | `compaction-duplicate-session.spec.ts:282-287` opens `[data-details]` when it is collapsed, then reads `[data-testid="inspector-session-stats"]`. The same test id is used at `canvas-orchestra.scene.ts:153-158`, `chat-code-edit.scene.ts:120-125`, and `plan-limits-visual.e2e.spec.ts:130-134`. No e2e file still selects `ptah-session-stats-summary`. The showcase scenes were not executed. |

## New defects

1. Moderate. The rail closed-state cue never reports pending requests. `canvas-rail-board.component.ts:338` always passes `0` as `needsYou`. `canvas-focus-header.component.ts:329` calls `limitAwareDot(null, ...)`, so a pending request cannot win the dot. Scenario: the focused session has `needsYouCount` 2, limit summary `none`, and a known context of 15%. The chat header says `Context 15%. 2 need you.` and draws a need dot (`chat-view.component.ts:1145-1168`). The rail toggle's description is only `Context 15%.` and it draws no dot. A person scanning closed rail headers cannot tell the session is waiting on them. Fix: pass that tab's `needsYouCount` into `inspectorToggleDescription`, and use `need` as the `limitAwareDot` base when the count is greater than 0.

2. Moderate. Compact-sheet Tab uses the first dialog in the board, not the sheet's dialog. `canvas-rail-board.component.ts:736-741` runs `querySelector('[role="dialog"]')` on the host. The sheet dialog is near the end of the template (`:249-251`). Scenario: width under 400 px, the approval popover is open (`autopilot-popover.component.ts:60`, inside the pane, which is earlier and `inert`), then Open details. The tabbable list is taken from the inert popover, so it is empty and every Tab is cancelled. Focus stays on the sheet shell; Close, SESSION, and lanes are not reached. Escape still closes, because that listener is on `[data-compact-sheet]` (`:249`). Fix: query `[data-compact-sheet] [role="dialog"]` and pass that node to `isTabbable`.

## Logic questions

1. Silent success on the reviewed paths is closed: a false or rejected Steer keeps the draft and shows the alert; a lane pick under the sheet closes it. The remaining quiet miss is the rail toggle while a session needs the user (defect 1).
2. Unexpected action: Tab in the compact sheet after another dialog is already open (defect 2). Escape on the sheet shell and on the split aside closes the overlay.
3. Wrong answer: `awaiting-background` with live agents is `waiting` in both the card and the avatar word. A context percent above 100 keeps its label and clamps `aria-valuenow`. A `tighten` or `limit` stage colours the budget bar from the stage, including when the percent is under 80 or over 100.
4. Dependency failure: `sendMessageToAgent` rejecting becomes `false` and the input stays. `@defer` delaying the close button no longer delays Escape, because the shell is focused first; the observer is disconnected on destroy and on close.
5. Still unspecified by these fixes, and left as accepted: expansion state for a null `sessionId` (D-1 moderate 5), a task read after a workspace change, and answer navigation to an unmounted card (codex moderate 3 and 4).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Needs-you on the rail cue is a new moderate, not an unfixed B-5 serious | Treat the whole cue as not fixed / accept the limit-only cue as the fix | Ring, limit chip, and description are implemented (`canvas-focus-header.component.ts:192-226`); `needsYou` is hardcoded `0` (`canvas-rail-board.component.ts:338`) while chat passes the real count (`chat-view.component.ts:1168`) | Yes |
| Sheet Tab is fixed on the path B-5 named, with a separate moderate for an earlier dialog | Re-open B-5 serious 2 | With no earlier dialog, `isTabbable` keeps the sheet dialog's controls (`canvas-rail-board.component.ts:43-47`, `:736-741`) | Yes |

## Checked and not filed

- No static `class` plus `[class]` on one element in these hunks. The copy button uses `[class]` and `[class.text-success]` (`copy-button.component.ts:30-33`). The limit chip uses `class` and `[class.text-state-need]` (`canvas-focus-header.component.ts:195-196`).
- The focus observer is not left connected after destroy or after close (`canvas-rail-board.component.ts:358`, `:699-701`).
- `SessionInspectorComponent` is not imported from the `@ptah-extension/chat` barrel. Whether the app bundler still places the inspector in an eager chunk through `ChatViewComponent` was not measured.
