# Lane report: Rail actions inside the card (decision row 110) + focused card highlight (row 111)

Writer: Claude (frontend-developer). Worktree W = `D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5`, base HEAD 1548dde46. No git writes.

## Requirement -> file:line -> spec case -> result

Abbreviations: CRC = `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`, CRC.spec = its spec; RC = `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`, RC.spec = its spec; CSC = `libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts`.

| Requirement | File:line | Spec case | Result |
| --- | --- | --- | --- |
| R110 No gutter: the expanded card is the only in-flow child and takes the full li width | CRC:127 (`min-w-0 flex-1`), CRC:150 (actions cell is `absolute`, so it takes no row width) | CRC.spec:585 "keeps 176/96/56 px heights with a full-width card, the trigger in its corner and +N more still fitting (N6b)": the li's only non-absolute, non-sr-only child is the card; the cell has no `w-7`/`w-6`/`shrink-0`/`pt-1` | PASS |
| R110 Trigger inside the card frame, top-right corner | CRC:146-150 (`absolute right-1.5 top-1.5 z-10 flex`; the li host is already `flex relative`, CRC:60) | CRC.spec:585: cell classes `absolute right-1.5 top-1.5 z-10`, `cell.parentElement === li`, the li is `relative`, the trigger is `h-6 w-6` inside the cell | PASS |
| R110 Trigger never nested in `.rc-select` or any interactive element | CRC:143-150 (the cell is a sibling of `ptah-compact-session-card`) | CRC.spec:585 (`card.contains(trigger) === false`; `trigger.parentElement.closest('button, a, [role="button"]') === null`); CRC.spec:453 (`trigger.closest('.rc-select, .rc-lane-overflow') === null`, not in `ptah-compact-session-card`) | PASS |
| R110 Title row reserves the button width (title and state pill truncate before it) | RC:46 (host class `rc-corner-reserved` from input), RC:98 (`:host(.rc-corner-reserved) .rc-title { padding-right: 22px }`), RC:209 (`rc-title` on the title line), RC:394 (input), CSC:134 + CSC:194 (passthrough), CRC:133 (`[reserveActionCorner]="true"` on the expanded card only) | RC.spec:219 "reserves the top-right corner on the title line only when asked, at both densities"; CRC.spec:585 (real rail card carries `rc-corner-reserved`; the title line holds the state pill) | PASS |
| R110 Ghost button, visible hover and focus in both themes | CRC:167 (`text-base-content/70 hover:bg-base-content/10 hover:text-base-content`; was `hover:bg-base-300`, invisible on the focused card's surface); focus ring unchanged at CRC:86-90 (2 px, offset -2 px, inside the 24 px button) | Covered structurally by CRC.spec:585; colours are a visual check | PASS (visual re-check pending) |
| R110 Focus ring not clipped | CRC:146-150: the cell sits outside the card's `overflow-hidden` hosts (CSC:112 and RC:43), and its outline offset is inside the button | CRC.spec:585 (`card.contains(trigger) === false`) | PASS |
| R110 isIgnoredCardClick ignores trigger, menu and backdrop | CRC onClick unchanged (`actions().contains(target)`), comment updated | CRC.spec:453 "does not select the session from a trigger, menu or backdrop click" | PASS |
| R110 Escape closes the menu and returns focus to the trigger | unchanged | CRC.spec:475 | PASS |
| R110 Collapsed roving Tab: select first, trigger second, only on the roving card; collapsed layout unchanged | CRC:148-149 (collapsed branch keeps `flex w-6 shrink-0 items-center justify-center`) | CRC.spec:504; CRC.spec:585 collapsed tail (`w-6 shrink-0`, not `absolute`/`z-10`/`w-7`, `h-14` trigger, 56 px) | PASS |
| R110 Alt+Shift+Arrow moves; plain arrows ignored | unchanged | CRC.spec:526 and "leaves plain arrows alone" | PASS |
| R110 B6 disabled reasons | unchanged | R9v Open beside cases in CRC.spec (all green) | PASS |
| R110 Host heights 176 / 96 / 56 px unchanged | unchanged | CRC.spec:585; RC.spec "uses the shared height for both densities"; RC.spec:219 per density | PASS |
| R110 N6(b) `+N more` still present and last in its lane line, not under the corner | RC lane markup unchanged | CRC.spec:585 (`+2 more` / `+5`, `rc-action`, last child of its `rc-line`, not inside the title line, not in the cell) | PASS |
| R110 No layout shift when the menu opens | the cell is absolute and the popover panel is Floating-UI positioned; nothing in flow changes size | CRC.spec:585 asserts the absolute cell and full-width card; no pixel measurement in jsdom | PASS (visual re-check pending) |
| R111 Focused card clearly distinct in light and dark | RC:47 (`[class.rc-focused]` replaces `[class.bg-base-300]`), RC:160-164 (`border-color: oklch(var(--p))`, `box-shadow: inset 0 0 0 1px oklch(var(--p))`, `background-color: color-mix(in oklch, oklch(var(--p)) 14%, oklch(var(--b2)))`), placed after `:host(:hover)` so hover never repaints the active frame | RC.spec:185 "marks only the focused card with a primary frame and tint that cannot shift layout" (class on focused only; paint-only props; theme tokens, no hex; inset ring; ordered after hover; height unchanged); CRC.spec:585 (focused real card has `rc-focused`, unfocused does not) | PASS (visual re-check pending) |
| R111 Left state stripe kept; no layout shift | RC `::before` stripe unchanged and paints over the ring's left edge; border width stays 1 px; ring is inset, so the parent's `overflow-hidden` cannot clip it | RC.spec:185 (height), existing RC.spec hover case still lists exactly the three hover rules | PASS |

## Tests

Every run went through `node .ptah/tmp/check-run.mjs <label> -- npx nx test <project> --testFile=<spec> --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`, one at a time, from W.

Final runs (after both R110 and R111 changes):

- `rc-in-5` @ptah-extension/chat-ui `compact-rail-card.component.spec.ts`: `Test Suites: 1 passed, 1 total` / `Tests: 20 passed, 20 total`
- `rc-in-6` @ptah-extension/canvas `canvas-rail-card.component.spec.ts`: `Test Suites: 1 passed, 1 total` / `Tests: 19 passed, 19 total`
- `rc-in-7` @ptah-extension/canvas `canvas-rail.component.spec.ts`: `Test Suites: 1 passed, 1 total` / `Tests: 10 passed, 10 total`
- `rc-in-4` @ptah-extension/chat `compact-session-card.component.spec.ts` (after the CSC passthrough; CSC not changed since): `Test Suites: 1 passed, 1 total` / `Tests: 45 passed, 45 total`

No `●` failure lines in any log. `ptah_get_diagnostics` on the three changed sources was unavailable (TypeScript check still running after 45 s, twice); typecheck and lint were not run, per the lane rules.

## Decisions

- **Absolute corner cell on the li, not content projection into the card.** The trigger stays a sibling of `ptah-compact-session-card` and is positioned `absolute right-1.5 top-1.5 z-10` in the already `relative` li. Projecting it into `ptah-compact-rail-card` would need a two-level `ng-content` pass-through and would put the trigger and its Floating-UI menu inside two `overflow-hidden` hosts (CSC:112, RC:43), risking a clipped menu and focus ring. As a sibling it is never inside `.rc-select`, keeps the `actions().contains()` click guard and the menu-item query unchanged, and keeps the 24 px trigger at `z-10` above the card's `z-index: 1` content layer (neither the card host nor the li create a stacking context).
- **Geometry.** A 6 px inset (`top-1.5 right-1.5`) centres the 24 px button on the 26 px title line (border 1 + padding 4 + 1 = 6) and gives a symmetric corner inside the `rounded-lg` frame. Only the title line is under the button (button y 6-30 px; the title line is y 5-31 px).
- **Reserved title space via an explicit input.** `reserveActionCorner` on `CompactRailCardComponent` (chat-ui) sets the host class `rc-corner-reserved`, and the component's own CSS pads the title line by 22 px (6 + 24 + 3 gap, less border 1 and right padding 10), so the title ellipsis and state pill stop before the button. Pixel values stay inside the component that owns the padding; canvas has no CSS that reaches into another component. The smart wrapper `CompactSessionCardComponent` (chat) needed a one-line passthrough input because canvas renders that wrapper and not the chat-ui card directly. I chose this over `:host-context()` because an input is explicit and testable.
- **Ghost hover.** `hover:bg-base-content/10` replaces `hover:bg-base-300`, which matched the old focused surface and showed nothing there. It follows the repository's `hover:bg-base-content/N` pattern.
- **R111 focused style in the chat-ui card.** The card owns its frame, stripe and hover rules, so the focused style lives there as `rc-focused` with the daisyUI `--p` / `--b2` tokens: the 1 px border plus a 1 px inset ring in primary (a 2 px frame with no size change), over a 14 % primary tint of base-200. An outer ring would have been clipped by the wrapper's `overflow-hidden`. The rule comes after `:host(:hover)` so hovering the active card keeps the primary frame. Emulated `:host(.rc-focused)` (two classes) outranks the static Tailwind `bg-base-200`.

## Clarifications Needed

None.

## Notes for the reviewer / visual re-check

- Visual items for the Electron re-check (no layout in jsdom): the light and dark contrast of the primary frame and tint and of the ghost trigger hover; title truncation before the corner button at the narrowest rail; the menu opening `right-start` from the corner trigger.
- Minor: while the pointer is over the corner trigger, the card's own `:host(:hover)` border tint does not apply, because the trigger is a sibling and not a descendant. The focused card keeps its primary frame either way.
- `decisions.md` and `context.md` show as modified in `git status`. Those changes are the orchestrator's, not this lane's.

## Changed files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\canvas\src\lib\canvas-rail\canvas-rail-card.component.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-rail-card.component.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\molecules\compact-session\compact-session-card.component.ts (passthrough input only)
- CREATED D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\.ptah\specs\TASK_2026_629_c0b3\lane-rail-actions-inside-report.md
