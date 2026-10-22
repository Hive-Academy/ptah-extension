# Picker fixes r2 — TASK_2026_710

## Cause

1. **E2E failures (theme.spec.ts :121, :146, :213).** `theme-toggle.component.ts` now renders
   Light / Dark / Glass tabs, and only the active tab's tiles exist in the DOM (`visibleThemes()`
   computed). The spec still expected all 36 `button[data-theme]` at once and clicked
   `dracula` / `synthwave` / `ptah-glass` directly. The picker opens on the Glass tab for the
   default `ptah-glass`. `synthwave` is in Dark, so it was never rendered. Note: `dracula` is
   flagged `glass: true` in `DAISYUI_THEMES`, so it is in the Glass tab, not Dark. The helper
   below finds each theme's tab at runtime, so the spec does not hard-code tab membership.
   The popover also stays open after a pick (no `hidePopover` in `selectTheme`). Clicking the
   trigger again would have toggled it closed.
2. **Selected tab contrast 1.02:1 (glass light).** The selected state was only a background
   fill (`--glass-sel` under glass, `bg-base-300` otherwise), and that fill is close to the
   panel colour.

## Changes

- `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts`
  - :1 adds a type-only `Locator, Page` import from `@playwright/test`.
  - :121-172 adds the `PICKER_TABS` constant and these helpers:
    - `openPicker` clicks the trigger only when the panel is not already `:popover-open`.
    - `showTab` clicks `getByRole('tab', { name, exact })` through `dispatchEvent` and waits for
      `aria-selected="true"`.
    - `pickTheme` goes through the tabs until the `data-theme` tile is there, then clicks it
      through `dispatchEvent`. The stacking-context comment moved into this helper.
  - :176 "all 36 themes are listed and selectable" now visits all 3 tabs and requires each
    to list at least one tile. Every tile must be visible and enabled. It collects the names and
    expects 36 entries, 36 distinct names and no empty names, and checks that
    `anubis` / `anubis-light` / `dracula` are among them.
  - :210 and :261: the deferred-switch and repaint tests use `pickTheme` in place of direct
    tile clicks. Their assertions are unchanged.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` :90-95 adds a rule for every
  theme: `.theme-tab[aria-selected='true']` gets `color: var(--picker-ink, currentColor)` and
  `box-shadow: inset 0 -2px 0 var(--picker-ink, currentColor)`. The glass fill and the
  `bg-base-300` fill stay. The file is now 643 lines.
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts` :432 adds a test that
  reads the component source and pins the selected-tab bar and ink. Inline styles never reach
  jsdom; the spec at :426 already does the same.

## Mapping old assertions to the new spec

| Old assertion | New assertion |
| --- | --- |
| `toHaveCount(36)` on all tiles | sum over the 3 tabs = 36, 36 distinct, each visible and enabled |
| `anubis`, `anubis-light`, `dracula` each have count 1 | `arrayContaining` on the collected names (distinctness gives a count of 1) |
| dracula click, then `theme-extra.css` requested and `data-theme` set | same, through `pickTheme` |
| synthwave reuses the sheet (no new request) | same, through `pickTheme` (synthwave is now in a different tab) |
| `--p` / `--b1` repaint, and back to ptah-glass restores them | same, through `pickTheme` |

## Contrast reasoning

`--picker-ink` is the concrete panel text colour, which the component copies from the parent on
open (`--picker-ink` spec at :415). The bar is drawn in that colour on the tab's own background.
The selected label uses the same colour, so the bar has the same contrast ratio as the panel's
body text against that background. Panel text is designed for at least 4.5:1, which is more than
the 3:1 needed for a non-text indicator. This holds in glass light, glass dark and non-glass
themes because no colour is hard-coded. Before `--picker-ink` is set, the fallback is
`currentColor` (the inherited panel text). These ratios have not been measured in Electron yet.

## Verification

- `ptah_get_diagnostics` on both changed spec files: no errors in the requested files. The 14
  errors it reports are in unrelated sibling files and were already there.
- No jest, nx, tsc, lint, e2e or Electron run, as the brief instructs. The orchestrator runs
  them: `npx jest -c libs/frontend/chat-ui/jest.config.ts
  libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts --coverage=false
  --maxWorkers=2`, then the Electron e2e theme spec.

## Decisions

- **Find each theme's tab at runtime instead of hard-coding membership.** The other option was
  a fixed theme-to-tab map. Evidence: `dracula` is `glass: true`, which a reader would not
  guess. A fixed map would break the next time the metadata changes. Reversible.
- **No new data attribute on the component.** The stable hooks already exist: `role="tab"`,
  `aria-selected` and `button[data-theme]`. Reversible.
- **The selected indicator is an inset bottom bar in panel ink, added to the existing fill.**
  The other options were a stronger fill colour, which needs a new token or a hard-coded colour,
  and an outline, which would look the same as `:focus-visible`. Reversible.
- **`openPicker` does not re-click the trigger when the panel is open.** The popover stays open
  after a pick, and `popovertarget` toggles it on every click. Reversible.

## Revision 1

Finding (code-logic-review-picker-fixes-r2.md, moderate): the "all 36 themes" test listed the
tiles but never selected them, so a click handler that did nothing, or applied the wrong theme,
would still pass.

Change: `apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts` (the loop body after the
`toBeEnabled` check, about :194-206). Every tile in every tab is now clicked through
`dispatchEvent`. The test then asserts:

- `html[data-theme]` equals that tile's name (5s budget, because the first deferred pick waits
  on the `theme-extra.css` load).
- The tile shows `aria-pressed="true"`.

A pick stays in the same tab (`selectTheme` changes the tab only when the category differs), so
the tab's tile order does not change during the loop.

Mapping: this goes beyond the HEAD test, which only counted tiles and never selected any. Now
"selectable" means each of the 36 themes applies when clicked.

Timing: 36 attribute waits, of which only the first deferred pick includes a sheet fetch from
local disk. This is expected to stay well under the config `timeout: 120_000`
(`apps/ptah-electron-e2e/playwright.config.ts:29`), so no `test.setTimeout` was added. The time
has not been measured; nothing heavy was run.

Decision: the test checks `aria-pressed` on the tile as well as `html[data-theme]`. Clicking
each tile and checking only the html attribute was the other option. Checking both proves that
the picker state agrees with the applied theme. Reversible.
