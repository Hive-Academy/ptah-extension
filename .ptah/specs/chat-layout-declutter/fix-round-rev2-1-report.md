# Fix round 1 — Revision 2 review (`code-logic-review-rev2.md`)

Worktree: `.claude-worktrees/chat-layout-declutter` (branch `feat/chat-layout-declutter`). Not committed.
Paths are relative to `libs/frontend/`.

## Per defect

All 10 defects are confirmed. None are disputed.

1. **Rail `⋯` menu clipped by the rail's scroll box: confirmed.**
   - Fix: in rail mode the menu is now `position: fixed`. `FloatingUIService` places it with `placement: 'left-start'`, which is the same approach the hover card uses (`canvas/.../canvas-focus-header.component.ts:105-118, 268-286`, provider at `:46`). It starts hidden and becomes visible once positioned. The expanded and floating variants keep `absolute`.
   - Keyboard: Escape and `choose()` close the menu through `closeMenu()`, which also cleans up FloatingUI and returns focus to the trigger. A new document `pointerdown` handler closes the menu when the press lands outside the controls (`:47, :290-295`).
   - Tests:
     - header spec "opens the rail menu as a fixed layer and closes it on an outside press"
     - dock spec "shows Hand off once in the expanded sidebar and keeps it in the rail menu, which escapes the scrolling rail"
     - jsdom has no layout, so the real geometry still needs an Electron screenshot.
2. **Split: an expanded sidebar collapsed on a focused-pane switch: confirmed.**
   - Fix: `dockOpen` now uses the `linkedSignal` form `computation(source, previous)`. The source is `{ split, open }`. While split stays on, the computation keeps `previous.value`. Entering split gives `false`, and leaving split gives the persisted single-view value (`canvas/.../canvas-inspector-dock.component.ts:84-101`).
   - In split, the source reads only `splitDisplayed()`. It never reads the left-rail width or `overlay()`, so no dock/rail cycle can form.
   - `setDockExpanded` no longer writes `InspectorOpenStateService` while split is shown (`:441-446`), so the transient split overlay cannot overwrite the single-view state.
   - Tests:
     - board spec "split: an expanded sidebar persists across focused-pane switches and leaving split restores the single-view state". It also checks that the inspector's `tabId` follows the focused pane.
     - "split and the compact sheet start from the rail with no separator" still passes.
3. **Rail avatar strip keyboard: confirmed.**
   - Fix: in rail mode, Arrow, Home and End keys only move focus and update a roving `railFocusKey`. They no longer emit `laneSelected`, so nothing expands (`canvas/.../canvas-lane-tabs.component.ts:434-439, 460`).
   - Roving tabindex is restored. `railTabStop` picks the focused chip, else the selected chip, else the first chip (`:352-362, :195`).
   - Enter, Space or a click still select and expand, through native button activation and `onTabClick`.
   - The `+N` control moved out of the `role="tablist"` (`:237-242`). The host becomes a centred flex column in rail mode (`:88-93`).
   - Test: lane-tabs spec "rail arrow keys move focus only, keep one tab stop, and leave selection to Enter or a click".
4. **Resize grip unmounted mid-drag: confirmed.**
   - Fix: the grip's `[max]` is now `dockedMaxWidth()`, which is `max(min, min(dock.maxWidth(), floor(availableWidth − 560)))`. A drag can no longer flip `overlay()`. The 560 value is the named constant `CHAT_MIN_BESIDE_DOCK`, which `overlay()` also uses (`canvas-inspector-dock.component.ts:21, 179, 307-319`).
   - A host resize can still flip the overlay. For that case, an effect cancels the controller draft when `overlay()` turns true (`:337-341`). This is canvas-local: I read `InspectorDockController` and left the shared width policy in the chat lib unchanged.
   - Tests:
     - dock spec "caps the grip so a drag keeps 560 px of chat and never flips to the overlay mid-drag"
     - dock spec "drops an uncommitted drag draft when a host resize flips the dock into the overlay"
     - the board spec max-width expectations are updated: 1400 px → 536, 1200 px → 352.
5. **Hand off duplicated in the expanded sidebar: confirmed.**
   - Fix: the focus header has a new input, `embedded` (`canvas-focus-header.component.ts:177-178`). The dock passes `[embedded]="!(rail ?? false)"` (`canvas-inspector-dock.component.ts:125`).
   - `sendToInMenu = !floating && !embedded`. The `⋯` trigger renders only when the menu has an action (`hasMenu`, `:229-232, :87, :105`). The rail menu and the split floating menu are unchanged.
   - Tests:
     - dock spec: one `ptah-send-to-messaging` in the expanded dock and no `⋯` there
     - header spec "embedded in the expanded inspector, leaves Hand off to the title row and drops an empty menu"
6. **Dead split-Details path: confirmed.**
   - Nothing emitted `detailsRequested`, so I removed the whole path:
     - the header and focus-area outputs, and the board binding
     - `#splitInspector`, `splitTemplate`, `openSplitDetails` and `closeSplitDetails` from the dock, plus `detailsFocusReturn` and the unused `activeSide` input
     - the board's `openSplitDetails` and its `ngTemplateOutlet` for the split template
   - `collapseSplit` now resets `detailsOpen` directly (`canvas-rail-board.component.ts:925`). `handOffInspector` uses one rule for split and single view (`canvas-inspector-dock.component.ts`, `handOffInspector`).
   - The split pane still opens the sidebar through the rail's expand control and `toggleDetails`.
   - Specs:
     - Rewritten: the Details-overlay tests, now "split: Escape on the expanded overlay collapses it to the rail and focuses the expand control" and "split sidebar stays a fixed overlay outside the panes at %i and closing split docks it again".
     - Rewritten: the "focuses the split dialog before deferred content exists" test.
     - Updated: the focus-area spec, the board stub, and the header-outputs and stacked-Tab tests.
     - Compact-sheet tests now open through `openCompactSheet()`, which calls `toggleDetails`.
7. **Bare `aria-label` on the needs-you aggregate: confirmed.**
   - Fix: added `role="img"` (`chat/.../session-inspector.component.html:56`).
   - Test: an assertion added to the session-inspector spec "emits expansion targets and exposes the attention count".
8. **`inspectorActions` lost without an identity: confirmed.**
   - Fix: the actions slot now sits outside the identity condition (`session-inspector.component.html:122-149`). The heading and status render only when there is an identity. An empty actions row collapses through `empty:hidden`.
   - Test: session-inspector spec "keeps projected inspector actions when the identity block is empty".
9. **`stopSession` lacked error handling: confirmed.**
   - Fix: the call is wrapped in `try/catch` and logs through the injected `LoggingService` (`@ptah-extension/core`) (`canvas-inspector-dock.component.ts:350-358`).
   - The twin in `canvas-focus-area.component.ts` used `console.error`, not a Logger. I switched it to the same `LoggingService` (`:164`) so the two flows match and no `console.*` remains.
   - Test: dock spec "logs a failed stop instead of leaving the rejection unhandled".
10. **Test gaps: confirmed and covered.**
    - Rail arrow keys: lane-tabs spec (defect 3).
    - Projected rail controls wiring: dock spec "wires the projected rail controls: Stop aborts, the view toggle switches, Close emits the id". It uses the real `CanvasFocusHeaderComponent` inside the dock.
    - Split persistence: board spec (defect 2).
    - No duplicate Hand off: dock spec and header spec (defect 5).
    - Grip clamp: the two dock spec tests (defect 4).

**Remaining uncertainty: "Limit unavailable" repeated per subgroup — confirmed.**
- `LANE_STATE_CHIPS.unknown.text` is `LANE_EMPTY.limit`, which is "Limit unavailable". With several subgroups whose limit is unknown, every subgroup heading badge repeated it beside the summary.
- Fix: when the lane has no known limit chip, its summary already says "Limit unavailable", so the subgroup badge for the unknown state is hidden (`chat-ui/.../lane-usage-tile.component.ts:144`).
- Test: lane-usage-tile spec "states \"Limit unavailable\" once when no subgroup knows its limit".

## Decisions

- **`⋯` hidden in the expanded sidebar.** Once the Hand off copy is removed there, the menu has no items (split actions live in the pane's floating menu). I hide the trigger instead of showing an empty menu.
  - Options: an empty menu, or keeping Hand off in the menu and dropping it from the title row. Item 8 aligns Hand off with the title.
  - Reversible.
- **The 560 px clamp is canvas-local.** It is `dockedMaxWidth` in the dock, not a change to `INSPECTOR_MAIN_MIN_WIDTH`, which would ripple into the chat lib's width-policy specs. Only canvas uses the controller.
  - Reversible.

## Final verification

Command (from the worktree root, run in the foreground):
`npm run verify -- -p @ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`

The header read "Running targets lint, test, typecheck for 3 projects".

| Project | Test | Typecheck | Lint |
|---|---|---|---|
| chat-ui | 87 suites passed, 1607 tests passed | pass | 0 errors, 12 warnings |
| chat | 274 suites passed, 4709 tests passed, 2 skipped | pass | **2 errors (expected, pre-existing)**: `attention-context.util.ts` 1:184 no-useless-escape and `chat-attention-source.service.ts` 27:30 no-control-regex. 104 warnings. |
| canvas | 23 suites passed, 475 tests passed | pass | 0 errors, 78 warnings |

The only failed task was `@ptah-extension/chat:lint`, with exactly the 2 known errors.

Warnings in the touched spec files are `no-non-null-assertion`, the existing spec style. The NG8102 warnings at `canvas-rail-board.component.ts:371-372` predate this change.

`canvas-rail-board.component.ts` is 1227 lines (the limit is 1241). Files are UTF-8 with LF line endings.

## Left open

- No Electron screenshot of the fixed rail menu (defect 1) or of the other Revision 2 surfaces yet. jsdom proves classes and behaviour, not geometry.
- `CanvasFocusHeaderComponent` still declares inputs and computeds that no template reads, for example `detailsOpen`, `inspectorExpanded`, `limitCue`, `shownLimit`, `detailsDot`, `compactDetails`, `narrow` and `quiet`. They are leftovers of the removed header row, outside this round's scope. A cleanup pass could remove them, together with the matching focus-area and board bindings.
- Mixed lanes, where some subgroups have a known limit and several do not, still show a "Limit unavailable" badge on each unknown subgroup. There it separates the unknown subgroups from the known ones.
- TUI and VS Code host typechecks were not run (outside this round's command).

## Dead-code cleanup

Pure removal of the members the removed header row left behind. No behaviour change.

- `canvas-focus-header.component.ts`: removed `tabs` (TabManagerService inject), `layout` (CanvasLayoutService inject), `workflow`, `title`, `branch`, `state`, `band`, `compactDetails`, `detailsOpen`, `inspectorExpanded`, `limitCue`, `contextRingPercent`, `toggleDescription`, `descriptionId` and `nextDetailsDescriptionId`, `shownLimit`, `shownRingPercent`, `shownDescription`, `detailsDot`, `paneFocused`, `paneNumber`, `panePlace`, `narrow`, `quiet`, `PanelRightIcon`, and the imports `TabManagerService`, `limitAwareDot`, `CompactRailState`, `SessionLimitSummary`, `PanelRight`, `CanvasLayoutService`.
- `canvas-focus-area.component.ts`: removed the header bindings `[title]`, `[state]`, `[branch]`, `[band]`, `[detailsOpen]`, `[inspectorExpanded]`, `[limitCue]`, `[contextRingPercent]`, `[toggleDescription]`, `[paneFocused]`, `[paneNumber]`, `[panePlace]`, then the now-unused inputs `paneNumber`, `panePlace`, `detailsOpen`, `inspectorExpanded`, `limitCue`, `contextRingPercent`, `toggleDescription`, `state`, `band` and the `CompactRailState`/`SessionLimitSummary` imports. Kept `paneFocused` (bound to `ptah-canvas-lane-view`) and `tab()` (viewMode, sessionId).
- `canvas-rail-board.component.ts`: removed the `<ptah-canvas-focus-area>` bindings `[inspectorExpanded]`, `[paneNumber]`, `[panePlace]`, `[detailsOpen]`, `[limitCue]`, `[contextRingPercent]`, `[toggleDescription]`, `[state]`, `[band]`, and the now-unused aliases `closedDetailsDescription` and `dockSlotShown`. Kept `paneNumber()`/`panePlace()` (divider, order, pane `aria-label`), `detailsOpen`, `compactSheet`, `stats`, `railStates`, `band` (all still read elsewhere in the board).
- Specs: header spec drops the `title`/`branch` inputs and the unused TabManagerService provider; focus-area `HeaderStub` and board `FocusStub` drop the removed inputs; the focus-area row-113 test now checks the split header is not remounted on a pane-activity change; the board `identity()` helper reads `paneNumber`/`panePlace` from the board itself; the single-focus test checks `splitDisplayed` and the pane label. Deleted one test that asserted the dead `toggleDescription` hand-off ("needs-you count in the closed details description").
- Line counts after: focus-header 260, focus-area 140, rail-board 1203.
- `npm run verify -- -p @ptah-extension/canvas -- --output-style=static`: lint, test, typecheck for 1 project, all succeeded; 23 suites, 474 tests passed (475 before minus the deleted dead-path test); lint 0 errors, 78 warnings.
- Follow-ups outside this pass: `injectCanvasInspectorDockState` in `canvas-inspector-dock.component.ts` still computes `closedDetailsDescription` (with its `SessionInspectorStore` and `inspectorToggleDescription` use) and `dockSlotShown`, which nothing reads now. `libs/frontend/webview-e2e-harness/.../plan-limits-visual.e2e.spec.ts:118` still targets `ptah-canvas-focus-header [data-details]`, which no longer renders.
