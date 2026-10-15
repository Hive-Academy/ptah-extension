# Lane R9v report: Rail card Session actions menu, Move up/down, Open beside outputs

Writer: Claude frontend-developer (Wave H5). Worktree W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`.
Paths below are relative to `W\libs\frontend\canvas\src\lib\canvas-rail\`. No git was run apart from read-only `git diff --stat`/`status`.

Result: all contract points implemented, and all three owned specs pass (43 tests). The changes stay inside the 6 owned files.

## Contract points

| # | Contract point | Change | file:line | Spec case | Result |
|---|---|---|---|---|---|
| 1 | Card outputs `openBesideRequested`/`moveUpRequested`/`moveDownRequested` = `output<string>()` carrying the tab id | New outputs; menu items and Alt+Shift emit `tabId()` | `canvas-rail-card.component.ts:257-259`, `:317-332` | card "emits the tab id from Open beside, Move up and Move down (payload forwarding, card side)" | PASS |
| 2 | Card inputs `canMoveUp`, `canMoveDown` (boolean), `splitDisabledReason` (`string \| null`) | New inputs (default false/false/null) | `canvas-rail-card.component.ts:249-252` | used by every new card case | PASS |
| 3 | Rail input `splitDisabledReason: string \| null`; forwards the three outputs unchanged | Input plus three `output<string>()`; template forwards `$event` as is | `canvas-rail.component.ts:241`, `:251-253`, `:196-198` | Rail "forwards openBeside, moveUp and moveDown payloads from the card unchanged (payload forwarding, Rail side)" | PASS |
| 4 | Rail computes per-card canMoveUp/canMoveDown from the sorted ids (N5) | `@for` over `orderedTiles()` (sorted by order) binds `[canMoveUp]="!first"`, `[canMoveDown]="!last"` | `canvas-rail.component.ts:176-191` | Rail "computes Move up/down from the sorted ids: first card no Move up, last no Move down" | PASS |
| 5 | Labelled `Session actions` trigger, sibling of `ptah-compact-session-card` in the fixed-height `li`, outside `rc-lane-overflow` and `.rc-select` | `[data-rail-actions]` cell after the card holds the trigger (`aria-label`/`title` "Session actions") | `canvas-rail-card.component.ts:139-176` | card "does not select the session from a trigger, menu or backdrop click" (asserts it is not inside the card, `.rc-select` or `.rc-lane-overflow`) | PASS |
| 6 | Expanded 176/96 px: trailing action gutter, trigger at its top | Host is now `flex`; card `min-w-0 flex-1`; gutter `w-7 shrink-0 items-start pt-1`; trigger `h-6 w-6` | `canvas-rail-card.component.ts:60`, `:127`, `:143-150`, `:166-167` | card "keeps 176/96/56 px heights with the action gutter and +N more still fitting (N6b)" | PASS |
| 7 | Collapsed 56 px: list drops its 8 px horizontal padding; 32/24 px two-cell row (select first, trigger second, no overlap); host heights unchanged | List `p-2` becomes `py-2` when collapsed; select `w-8 shrink-0 h-14`; actions cell `w-6 shrink-0`, trigger `h-14`; host height binding unchanged | `canvas-rail.component.ts:171-172`, `canvas-rail-card.component.ts:112`, `:148-150`, `:57` | Rail "drops the horizontal list padding and the scrollbar gutter only in the collapsed 56 px rail"; card N6b case (collapsed half) | PASS |
| 8 | `isIgnoredCardClick` ignores trigger and menu | Trigger and menu items are `<button>`, so the existing interactive-target rule covers them. The menu panel padding and backdrop are not buttons, so `onClick` also returns when the target is inside `[data-rail-actions]` (Decision D3) | `canvas-rail-card.component.ts:286-292` | card "does not select the session from a trigger, menu or backdrop click" | PASS |
| 9 | Collapsed roving Tab: select `[tabIndex]="focused() ? 0 : -1"`, trigger 0 only on the roving current card | Select binding kept; trigger `[tabIndex]="focused() ? 0 : -1"`; trigger follows select in the DOM | `canvas-rail-card.component.ts:116`, `:172` | card "puts the collapsed select first and the trigger second in Tab order, only on the roving card" | PASS |
| 10 | Menu items Open beside / Move up / Move down; impossible moves disabled | `role="menu"` with three `role="menuitem"` buttons; `aria-disabled="true"` when `!canMoveUp`/`!canMoveDown`; a click on a disabled item does nothing | `canvas-rail-card.component.ts:177-228`, `:322-332` | card payload case; card "forwards Alt+Shift... stops at the first and last card" | PASS |
| 11 | Escape closes the menu and returns focus to the trigger | `NativePopoverComponent` emits `closed` on Escape (preventDefault + stopPropagation); `closeMenu()` sets `menuOpen` false and focuses the trigger. Arrow/Home/End move between items | `canvas-rail-card.component.ts:152-161`, `:333-352` | card "closes the menu on Escape and returns focus to the trigger" | PASS |
| 12 | `Alt+Shift+ArrowUp/Down` on a card or its select button emits moveUp/moveDown; unmodified arrows stay with `handleCanvasRailKeydown` | New `railMoveKey()` (Alt+Shift only, no Ctrl/Meta). Card `onKeydown` emits only when the target is the host, `.rc-select` or `.rail-collapsed`, and only when the move is possible. `handleCanvasRailKeydown` is unchanged: it already returns on any modifier | `canvas-rail-keyboard.ts:16-23`, `canvas-rail-card.component.ts:294-315` | keyboard "reads %s %o as a move of %s" (8 rows); keyboard "leaves Alt+Shift arrows to the card and keeps plain arrows moving focus"; card "forwards Alt+Shift+ArrowUp/Down..."; card "leaves plain arrows alone"; Rail "keeps plain arrows with handleCanvasRailKeydown and leaves Alt+Shift arrows to the card" | PASS |
| 13 | B6 exact strings as constants in the card file | `SPLIT_NEEDS_TWO_SESSIONS_REASON = 'Open another session first to split'`, `SPLIT_ALREADY_FOCUSED_REASON = 'This session is already in the focused pane'` (exported) | `canvas-rail-card.component.ts:31-36` | card it.each "shows the disabled reason \"%s\"..." asserts both literals | PASS |
| 14 | Board reason passed through the Rail to every card; focused-pane reason for the card whose id equals `focusedTabId` when the board reason is null | `cardSplitReason(tabId)` returns the board reason first, then the focused reason for the focused card only | `canvas-rail.component.ts:272-278`, `:191` | Rail "passes the board reason to every card, else the focused-pane reason to the focused card only (B6)" | PASS |
| 15 | Disabled Open beside shows the reason and emits nothing | Item `aria-disabled="true"`, `aria-describedby` points to the reason span, the reason is visible text plus `title`, and `openBeside()` returns early | `canvas-rail-card.component.ts:184-204`, `:317-321` | card it.each "shows the disabled reason \"%s\" and does not emit Open beside" (both strings) | PASS |
| 16 | A stale or cross-workspace id is never a disabled reason | The Rail derives reasons only from the board input and `focusedTabId`. A focused id that is not on the board matches no card. A stale card (no tab) renders no trigger at all | `canvas-rail.component.ts:273-278`, `canvas-rail-card.component.ts:98` | Rail B6 case (last block, `focusedTabId: 'gone'`); card "enables Open beside without a reason (a stale id is never a disabled reason)" | PASS |
| 17 | N6(b): expanded action gutter keeps `+N more` fitting at 176/96 px | The gutter is a flex sibling, not an overlay. `+N more` stays inside the card. Width budget at the narrowest 272 px rail: 193 px Lanes line ≥ "Lanes" + `+99 more` | `canvas-rail-card.component.ts:127`, `:143-150` | card "keeps 176/96/56 px heights with the action gutter and +N more still fitting (N6b)" | PASS (structural plus budget; jsdom has no layout, so the pixel fit belongs to the Electron re-check) |
| 18 | Accessibility: keyboard reachable, visible focus, aria-haspopup/aria-expanded, role menu/menuitem, aria-disabled plus reason for screen readers | Trigger has `aria-haspopup="menu"` and `[attr.aria-expanded]`. Focus moves to the first item on open. Inset focus rings for the collapsed select and the trigger, because the full-width 56 px li would clip an outset ring | `canvas-rail-card.component.ts:80-90`, `:168-172`, `:155-156` | Escape, Tab-order and disabled-reason cases | PASS |
| 19 | OnPush, signals, `inject()`, standalone, Tailwind/DaisyUI | Kept. The menu reuses the repo primitive `NativePopoverComponent` (`@ptah-extension/ui`, already used by `canvas-needs-you-queue.component.ts:35`) | `canvas-rail-card.component.ts:26`, `:44` | n/a | PASS |

## Named cases

| Named case | Spec / `it` name | Result |
|---|---|---|
| payload forwarding card -> Rail, all three outputs | card "emits the tab id from Open beside, Move up and Move down (payload forwarding, card side)"; Rail "forwards openBeside, moveUp and moveDown payloads from the card unchanged (payload forwarding, Rail side)" | PASS |
| disabled reason (both strings) shown, Open beside not emitted | card it.each "shows the disabled reason \"Open another session first to split\" / \"This session is already in the focused pane\" and does not emit Open beside"; Rail "passes the board reason to every card, else the focused-pane reason..." | PASS |
| trigger click does not select | card "does not select the session from a trigger, menu or backdrop click" | PASS |
| collapsed Tab order select then trigger | card "puts the collapsed select first and the trigger second in Tab order, only on the roving card" | PASS |
| Alt+Shift forwarding and boundary | card "forwards Alt+Shift+ArrowUp/Down from the select button and stops at the first and last card"; Rail "computes Move up/down from the sorted ids: first card no Move up, last no Move down"; keyboard "reads %s %o as a move of %s" | PASS |
| plain arrows unchanged | keyboard "leaves Alt+Shift arrows to the card and keeps plain arrows moving focus"; card "leaves plain arrows alone (no move, not prevented)"; Rail "keeps plain arrows with handleCanvasRailKeydown and leaves Alt+Shift arrows to the card"; the existing Rail "moves DOM focus through collapsed cards..." still passes | PASS |
| Escape focus return | card "closes the menu on Escape and returns focus to the trigger" | PASS |
| 176/96/56 px heights with action gutter and `+N more` fitting | card "keeps 176/96/56 px heights with the action gutter and +N more still fitting (N6b)" | PASS |

## Spec commands (from W, through the machine-wide lock, one at a time)

```
node .ptah/tmp/check-run.mjs r9v-1 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-keyboard.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
  Test Suites: 1 passed, 1 total
  Tests:       15 passed, 15 total

node .ptah/tmp/check-run.mjs r9v-2 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
  Test Suites: 1 failed, 1 total
  Tests:       1 failed, 17 passed, 18 total
  (spec-helper bug: in collapsed mode the helper picked the hidden card's .rc-select; fixed the helper to skip aria-hidden)

node .ptah/tmp/check-run.mjs r9v-3 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail-card.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
  Test Suites: 1 passed, 1 total
  Tests:       18 passed, 18 total

node .ptah/tmp/check-run.mjs r9v-4 -- npx nx test @ptah-extension/canvas --testFile=canvas-rail.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache
  Test Suites: 1 passed, 1 total
  Tests:       10 passed, 10 total
```

Logs are in `%TEMP%\629-check-r9v-<n>.log`. I did not run the full suite, typecheck or lint (the team-leader runs them in Mode 2). A scoped `ptah_get_diagnostics` on the 3 source files reported 0 errors in them. It also reported 7 errors in other files I did not touch (`orchestra-canvas.rail.spec.ts:274`, `core/src/testing/mock-rpc-service.ts:53-68`, `shared/.../capability-id-codec.ts:262-263`). Those diagnostics come from the plain TS compiler, not the Nx typecheck.

## Decisions

| # | Decision | Options considered | Evidence | Reversible |
|---|---|---|---|---|
| D1 | The menu uses the repo's `NativePopoverComponent` (Floating UI, `position: fixed`, transparent backdrop) instead of the focus header's absolute `div` | (a) absolute menu like `canvas-focus-header.component.ts:38-43`; (b) NativePopover | The Rail list scroller is `overflow-y-auto`, which also clips x, so an absolute menu would be cut off in the 56 px collapsed rail and at the right edge of expanded cards. NativePopover is already used in canvas (`canvas-needs-you-queue.component.ts:35`). It has Escape handling (`native-popover.component.ts:228-234`). It runs Floating UI `autoUpdate` only while open (`floating-ui.service.ts:146`) and cleans up on close, so a closed card adds no observers. The focus-header pattern is still followed: Escape closes and the trigger gets focus back | yes |
| D2 | Escape focus return is explicit in `closeMenu()`, which focuses the trigger, and does not rely only on the popover's `previousActiveElement` | rely on the popover / explicit | The popover restores whatever was focused when it opened. That may not be the trigger after a pointer open, and jsdom does not focus on `click()`. The contract requires focus on the trigger | yes |
| D3 | `onClick` also ignores clicks inside `[data-rail-actions]` (gutter, panel padding, backdrop), on top of `isIgnoredCardClick` | rely on the interactive-target rule only / add a wrapper guard / edit `canvas-card-click.ts` | Trigger and items are buttons, so the existing rule (`canvas-card-click.ts`, `closest('button, ...')`) covers them. The panel padding and backdrop `div` are not buttons, and a click there would select the session. `canvas-card-click.ts` is outside the 6 owned files, so the guard lives in the card | yes |
| D4 | Collapsed scroller hides its scrollbar and gutter (`scrollbar-width: none`, `scrollbar-gutter: auto`, `overflow-x: hidden`) through a component class `rail-scroll-collapsed` | keep `[scrollbar-gutter:stable]` / hide in collapsed only | The global webview scrollbar is 8 px (`apps/ptah-extension-webview/src/styles.css:646-649`), and the aside has a 1 px `border-r`. With the stable gutter the li would be 47 px wide and the 32/24 row could not fit. Without it the inner width is 55 px, so the row overflows by 1 px, which `overflow-x: hidden` clips. Wheel and keyboard scrolling still work. The expanded rail is unchanged | yes |
| D5 | Collapsed select-button focus ring moved from the host `:has()` outset outline to an inset outline on the button. The trigger also gets an inset ring | keep outset / inset | With no horizontal list padding, an outset ring on the full-width li is clipped by the scroller. The expanded `.rc-select` ring is unchanged (`:host(:has(.rc-select:focus-visible))`) | yes |
| D6 | The trigger is tabbable only on the focused card in both expanded and collapsed (`focused() ? 0 : -1`) | collapsed-only roving / both | Matches the compact card's `innerTabbable = focused()` (`compact-session-card.component.ts:132`). Arrow keys move the roving card, after which its trigger is in Tab order | yes |
| D7 | Alt+Shift reorder fires only from the host, `.rc-select` or `.rail-collapsed`, not from the trigger or inner buttons. At a boundary it is not `preventDefault`ed | wider target set / contract set | The contract says "a card or its select button". The Rail handler already ignores modified keys, so an unhandled Alt+Shift has no side effect | yes |
| D8 | Disabled Move up/down use `aria-disabled` without a visible reason. Disabled Open beside shows its B6 reason as visible text, `title` and `aria-describedby` | add first/last reasons / none | B6 defines reasons only for Open beside. `aria-disabled` keeps the items focusable so screen readers announce them | yes |
| D9 | Menu items also support ArrowUp/ArrowDown/Home/End, and the first item is focused on open | Tab only / menu arrows | ARIA menu pattern. Tab still works. The Rail handler already ignores `[role="menu"]` targets (`canvas-rail-keyboard.ts:25`) | yes |
| D10 | The N6(b) "+N more fits" check is structural plus a width budget, not a pixel measurement | pixel measurement / structural | jsdom has no layout. The real pixel check is the Electron re-check (phase visual review) | n/a |

## Clarifications Needed

None.

## Proposed Removals

None. No capability was removed:
- The display dock (row 77) and the Rail split-focus files (rows 80, 82, 83, 85, 86) are untouched.
- The expanded rail keeps its stable scrollbar gutter.
- The collapsed rail still scrolls; only its visible scrollbar is hidden (D4).

## Out-of-scope observations

- `canvas-rail-board.component.ts` does not yet bind `splitDisabledReason` or the three new Rail outputs. This is expected: R9w is their single consumer. Until then Open beside and Move emit into an unbound output. The focused card still shows "This session is already in the focused pane" because the Rail computes that reason itself.
- R9w imports `SPLIT_NEEDS_TWO_SESSIONS_REASON` from `canvas-rail-card.component.ts`. The Rail already imports `SPLIT_ALREADY_FOCUSED_REASON` from there.
- After a menu Move, the card returns focus to its trigger. R9w's reorder restores focus to the moved card's select button after render (plan line 32), which supersedes this.
- Mode 2 risk to watch: other canvas specs that mount the real `CanvasRailCardComponent` now also instantiate `NativePopoverComponent`. It is inert while closed (no Floating UI call until opened).

## Changed files

- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.ts`: B6 constants, new inputs and outputs, Session actions trigger plus menu, action gutter and collapsed two-cell row, Alt+Shift handling, click guard, inset focus rings.
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.spec.ts`: Floating UI mock, stub `+N more`, 9 new cases (10 tests with the it.each).
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail.component.ts`: `splitDisabledReason` input, three forwarded outputs, per-card move bounds and reasons, collapsed padding and scrollbar.
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail.component.spec.ts`: stub API extended, 5 new cases.
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-keyboard.ts`: `railMoveKey()`.
- MODIFIED `W\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-keyboard.spec.ts`: `railMoveKey` table (8 rows) and the Alt+Shift vs plain-arrow case.
- CREATED this report.
