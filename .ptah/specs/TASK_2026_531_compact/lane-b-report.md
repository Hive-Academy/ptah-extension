# Lane B — G4 streamlined layout menu (TASK_2026_531, goal G4)

## Changes made

### `libs/frontend/canvas/src/lib/canvas-tile.component.ts`

- Replaced the flat nine-button menu with three labelled sections inside the
  same `ptah-native-popover` content (`role="menu"`, `w-56` ≈ 224px, `gap-1.5`):
  - **Width** — `role="group" aria-label="Tile width"` with a daisyUI `join`
    row of 4 equal buttons (`join-item btn btn-ghost btn-xs flex-1`), visible
    text `⅓`, `½`, `⅔`, `Full`. The active span gets `btn-active` AND keeps
    `aria-checked="true"`, `data-span`, the existing aria-labels
    ('Set tile width to one third', etc.) and `[disabled]="layoutLocked()"`.
  - **Height** — `role="group" aria-label="Tile height"` with a `join` row of 3
    buttons, visible text `Full`, `Compact`, `Tall`. Active mode gets
    `btn-active` + `aria-checked="true"`; `data-view-mode` kept; aria-labels
    keep the full wording ('Set tile height to Compact tall', etc.). Height
    buttons stay enabled under layout lock (view mode is TabManagerService's,
    not layout intent — unchanged).
  - **Arrange** — `role="group" aria-label="Arrange"` with Focus / Exit focus
    and Start new row / Join previous row as compact menu items, each with a
    leading lucide icon. `btn-active` styling on the focus item while
    `layoutFocused()` is on, and its leading icon switches to `Check` in that
    state.
- Section captions: `<span class="text-[10px] uppercase tracking-wide
  text-base-content-muted px-1">` — not focusable, no tabindex.
- Layout-locked state: the Width section shows a muted hint line
  `data-testid="layout-locked-hint"` with the text "Layout locked" while the
  width/action buttons stay disabled (they were silently disabled before).
- Constants: `SPAN_OPTIONS` gained `short` (`⅓/½/⅔/Full`) and lost the now
  unused `text`; `VIEW_MODE_OPTIONS` gained `short` (`Full/Compact/Tall`)
  while `label` keeps the full aria-label wording.
- Keyboard: `onLayoutMenuKeydown` now first delegates `ArrowLeft`/`ArrowRight`
  to a new private `moveWithinSegmentedGroup()` — it finds the focused item's
  `[data-layout-group]` ancestor (set on the width and height `join`
  containers), moves among that group's enabled `button[data-layout-item]`
  with wrap-around, and prevents default only inside a group (Arrange items
  ignore horizontal arrows). Up/Down/Home/End over all enabled items in DOM
  order, open-focuses-checked-item, and Escape/close behaviour are unchanged.
- Outputs and pointer-event isolation untouched: `requestSpan`,
  `requestLayoutFocus`, `requestRowBreak`, `requestViewMode`, all
  `(click)/(mousedown)/(pointerdown)/(touchstart)` stopPropagation bindings.
- OnPush retained; daisyUI/Tailwind tokens only, no hex colours.

### `libs/frontend/canvas/src/lib/canvas-tile.component.spec.ts`

- Adapted the one label-text assertion that changed: height choice visible
  text is now `['Full', 'Compact', 'Tall']`; added an assertion that the
  aria-labels still carry the full wording ('Set tile height to Full/Compact/
  Compact tall').
- Added tests:
  - visible active state (`btn-active`) present on exactly the checked span
    (`half`) and the checked view mode (`full`);
  - Left/Right navigation inside the width group: right from half → ⅔, left
    back, wrap from Full → ⅓ on ArrowRight and ⅓ → Full on ArrowLeft;
  - "Layout locked" hint: absent when unlocked (menu open while asserting, so
    the check is not vacuous), present with text 'Layout locked' when locked,
    width buttons still disabled, hint line is not a `[data-layout-item]`.
- All pre-existing layout-menu tests pass unchanged in their selectors.

## Icons chosen

- Focus → `Scan` (lucide `Scan`, imported like `Ellipsis`).
- Focus active state → `Check` (leading icon swaps Scan → Check plus
  `btn-active`).
- Start new row → `CornerDownLeft`.
- New readonly component properties `ScanIcon`, `CornerDownLeftIcon`,
  `CheckIcon` follow the existing `EllipsisIcon` pattern.

## Keyboard model

- Up/Down: cycle over every enabled `[data-layout-item]` in DOM order
  (unchanged).
- Home/End: first/last enabled item (unchanged).
- Left/Right: move within the focused item's segmented group (`width` or
  `height`), wrapping inside the group; Arrange items ignore them.
- Open: focus goes to the first checked (aria-checked) item — the checked
  width; under lock the widths are disabled so the checked height item gets
  focus. Escape and popover close/restore behaviour unchanged.

## Verification

- `npx nx test canvas --testPathPattern=canvas-tile` — 9 suites / 175 tests,
  all passed, 0 failed.
- `npx nx lint canvas` — all files pass.
- `npx tsc -p libs/frontend/canvas/tsconfig.lib.json --noEmit` — no output,
  no errors.

## Not done

Nothing outstanding. No visual/browser verification was run (no design
handoff or running app in this lane's scope).