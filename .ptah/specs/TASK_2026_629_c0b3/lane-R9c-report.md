# Lane R9c report: Rail card hover, role, pointer and keyboard (item 5)

Writer: Claude frontend-developer. No git run. Only the four R9c files were edited.

## Files changed

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-card.component.ts`: the host `li` now has
  `role: 'listitem'` and `cursor-pointer`. The collapsed button gets the `rail-collapsed` class and
  the `.rail-collapsed:hover { border-color: var(--rail-state-ink) }` rule. The host focus ring
  `:has(...)` now also covers `.rail-collapsed:focus-visible`.
- `libs/frontend/chat-ui/src/lib/molecules/compact-session/compact-rail-card.component.ts`: adds three
  paint-only hover rules. `:host(:hover)` sets `border-color: var(--rail-state-ink)`.
  `.rc-action:hover` sets `box-shadow: inset 0 0 0 1px currentColor`, which also covers
  `+N more`/`+N`. `.rc-lane-row:hover` sets `background-color: oklch(var(--bc) / 0.1)`. Lane row
  buttons get `rc-lane-row rounded-sm` and a `:focus-visible` inset outline in the state ink.
- Both `.spec.ts` files: new cases below. jest-preset-angular strips component styles, so the
  hover cases read the inline CSS from the component source. The repo already does this with
  `readFileSync` in `turn-summary-chip.component.spec.ts` and `web-search-config.component.spec.ts`.

## Named cases (all pass)

- chat-ui `shows paint-only hover on the card, lane rows and actions without a geometry shift`: the
  hover selectors are exactly `:host(:hover)`, `.rc-action:hover` and `.rc-lane-row:hover`. Every
  declaration is one of background-color, border-color, box-shadow or color. Rows stay `h-[18px]`
  and the card stays 176 px.
- chat-ui `keeps rc-lane-overflow as a 16px action that shares the action hover`: the N2 class is
  intact and the `.rc-action.rc-lane-overflow` rule still sets height and line-height to 16px.
- canvas `makes the host a pointer listitem whose keyboard equivalent is a button`.
- canvas `gives the collapsed button a paint-only hover and keeps its 56px height`: a click selects
  the session exactly once.
- canvas `keeps focusRailSelectButton reaching the select and collapsed buttons` (N1 helper unchanged).
- Existing cases still cover 176/96 px and the 70 px lane block (`16 + 3*18`).

Results, each run through `.ptah/tmp/check-run.mjs`:
- R9c-3, `nx test @ptah-extension/chat-ui --testFile=compact-rail-card.component.spec.ts`:
  `Tests: 18 passed, 18 total`.
- R9c-4, `nx test @ptah-extension/canvas --testFile=canvas-rail-card.component.spec.ts`:
  `Tests: 8 passed, 8 total`.
- R9c-1 and R9c-2 were the first attempt and a probe. They showed that the jest CSSOM is empty.
- `ptah_get_diagnostics` on the four files: no errors.

## Decisions

- The host stays a `listitem` and does not become `role=button`. A button would break the
  `ul[role=list]` children rule and would nest the card's buttons inside a button. The host click is
  a pointer shortcut. Its keyboard equivalent is `.rc-select`, or the collapsed button, both with
  roving tabindex.
- Lane rows use `bg-base-content/10` instead of Grid's `hover:bg-base-300/40`. The focused card
  surface is already base-300, so a base-300 tint would not show on the focused card. A 10% bc tint
  shows on base-200 and base-300 in both themes.
- Card hover and collapsed hover change only the border colour, to `--rail-state-ink`.
  `state-ink-contrast.spec.ts` asserts that every state ink clears 3:1 on base-100/200/300 in both
  themes. Text contrast is unaffected: the borders carry no text, the action ring is the text's own
  colour, and a 10% bc tint keeps bc text far above 4.5:1 (about 9:1 dark and about 10:1 light,
  hand-calculated). No new hex values or tokens.

## Not done / for others

- Hover was checked by CSS-rule assertions only. Visual and contrast measurement in Electron (re-check
  list items 6 and 11) remains with visual review.
- Sibling spec type errors, such as `orchestra-canvas.component.spec.ts:678`, are outside R9c and
  were not touched.
