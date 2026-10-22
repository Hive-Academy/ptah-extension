# Theme dropdown visibility — TASK_2026_710 / PR 805

Source diagnosis only. No browser, Electron, Jest, typecheck, lint, or build was run. Do not treat this as rendered proof.

## Source cause

Clicking the theme control showed nothing because DaisyUI keeps the panel hidden unless the wrapper is focused, and the panel is absolutely positioned inside a 40px bar that the glass shell clips and stacks over.

1. Closed state is invisible by design. `node_modules/daisyui/dist/unstyled.css:559-562` sets `.dropdown:is(:not(details)) .dropdown-content` to `visibility: hidden` and `opacity: 0`. It becomes visible only for `.dropdown-open`, `.dropdown:focus`, or `.dropdown:focus-within` (`unstyled.css:592-597`). The styled sheet also scales it to 0.95 until that same focus (`styled.css:2717-2745`). The old trigger was a `div[tabindex=0]`, not a button (`theme-toggle.component.ts` before this change, trigger at the old lines 17-25). A click that does not leave focus inside `.dropdown` never lifts `opacity: 0`.

2. The panel does not leave the bar. DaisyUI only sets `position: absolute` (`unstyled.css:556-557`). `top: 100%` exists solely on `.dropdown-bottom` (`unstyled.css:576-578`), which this component never applied. `dropdown-end` only sets `inset-inline-end: 0` (`unstyled.css:563-564`). The menu therefore hangs out of the title-bar box.

3. That box is clipped. Electron's bar is `h-10` inside `div.electron-shell-root.flex.flex-col.h-screen` (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:174-181`). Glass adds 8px padding and gap on that column (`electron-shell.component.ts:106-109`). `body` is `overflow: hidden` (`apps/ptah-extension-webview/src/styles.css:698-709`) and the app root is `main.h-screen.overflow-hidden` (`apps/ptah-extension-webview/src/app/app.html:12`). An absolute panel taller than the 40px bar is clipped when any of those boxes is the clip edge. `z-index` cannot paint clipped pixels.

4. Stacking hides whatever still overflows. Every glass surface is `position: relative; isolation: isolate` (`styles.css:2807`), including the bar and the panes under it. The bar is lifted to `z-index: 30` only while glass is on (`styles.css:2918-2919`), and that value lives in `@layer components`. The theme panel is a descendant of the bar, so it cannot escape that context. The Electron theme spec already records the failure mode: Playwright's hit test finds the canvas empty state at the menu's coordinates (`apps/ptah-electron-e2e/src/specs/theme/theme.spec.ts:157-166`). Later isolating panes paint the region where the menu should appear.

5. Glass paint on `.dropdown-content` is not the hide. Fill and blur sit on `::after` (`styles.css:2828-2851` and the bar override `styles.css:3241-3247`). The rim is a masked `::before` at `z-index: 1` (`styles.css:2891-2906`). Those rules do not set `display`, `visibility`, or `opacity` on the panel. The same rim is on chrome that is otherwise visible, so it is not a sufficient explanation for a missing menu. They were left unchanged.

`ptah_*` AST tools were not available: `search_tool` for `ptah` returned no tools (`total_hidden_tools: 10` on the tasks server). Diagnosis used native search and the files above.

## Fix

Local to `ThemeToggleComponent`. The same list is now a `popover="auto"` top-layer panel, anchored under the trigger on `beforetoggle`.

- The trigger is `button type="button"` with `popovertarget`, `aria-controls`, and `aria-expanded`. The accessible name stays `Change theme`, which the Electron spec clicks.
- The panel keeps `dropdown-content`, `w-64`, `max-h-[28rem]`, `overflow-y-auto`, the Dark/Light groups, per-theme `data-theme` buttons, the selected `bg-base-300` row, and the check icon.
- Component CSS sets `position: fixed; inset: auto` and, only while `:popover-open`, `visibility: visible; opacity: 1; transform: none`, so DaisyUI's closed opacity cannot win. `dropdown-open` is also bound while the signal says open.
- `onBeforeToggle` writes inline `top` / `right` from the trigger's `getBoundingClientRect` before the top layer shows the panel (4px under the button, right edges aligned, same `dropdown-end` intent).
- `selectTheme` / `setTheme` and `selectAccent` / `setAccent` are unchanged. Gold, Rose quartz, and Moonstone still render only for `ptah-glass` and `ptah-glass-light`.

The top layer is outside ancestor overflow and outside the bar's `z-index: 30` context. That is why `styles.css` and `electron-shell.component.ts` were not edited.

## Preserve checklist

- One scrolling list, not tabs. Dark group then Light group. No new surface.
- All 36 `DAISYUI_THEMES` entries (`theme.service.ts:93-128`): 36 `button[data-theme]` nodes.
- Selected row still uses `bg-base-300` plus the check icon.
- Persistence is still `ThemeService.setTheme` / `setAccent`. Gold stays the absent-`data-accent` value inside the service; this component still passes `'gold'`.
- Accent controls remain the three radios (Gold, Rose quartz, Moonstone) on both glass themes only.

## Decisions

- Use the Popover top layer instead of editing `styles.css` or the shell. Options were: raise the bar's z-index / overflow in global CSS (forbidden by this task, and z-index cannot undo clip), or move the panel to `position: fixed` only (still trapped in the bar's stacking context). Evidence: `styles.css:2807`, `styles.css:2918-2919`, `electron-shell.component.ts:174-181`, `unstyled.css:556-597`. Reversible: the markup is still `.dropdown` > trigger + `.dropdown-content`.
- Keep light-dismiss (`popover="auto"`) so outside click and Escape close the menu the way a DaisyUI dropdown did. Choosing a theme does not force-close, matching the old focus-within behavior.
- Did not add `dropdown-bottom` or a portal service. The inline coordinates replace the missing `top: 100%`.

## Files changed

- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts`
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts`
- `.ptah/specs/TASK_2026_710_ptah-glass-theme/theme-dropdown-fix.md` (this note)

Not modified: `styles.css`, `.gitignore`, `HANDOFF.md`, shell, e2e, CI revision files.

## Verification not run

Temporary policy forbids local checks. The new specs were not executed:

- `opens the same 36-theme list in the top layer under the trigger`
- `keeps accent choices on the glass themes and delegates them`
- existing create / bucket / `setTheme` cases in the same file

When a run is authorized, only this spec, from the worktree:

```sh
npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts --coverage=false --maxWorkers=2
```

Use Nx `--parallel=1` if invoking Nx. One heavy check. No workspace-wide test, lint, typecheck, build, or e2e. Visual evidence, when authorized, is Electron only.

## Limits of source evidence

- No computed style, hit test, or screenshot shows the closed menu's used `overflow`, `opacity`, or paint order. Clipping versus stacking versus lost focus are all consistent with the reported click; the patch covers all three without claiming which one the running Electron window hit.
- `beforetoggle` and `popover="auto"` are relied on as Electron 44 / Chromium behavior. jsdom will not open a real top layer; the spec only checks attributes, theme count, accent delegation, and the placement writes.
- Glass `::before` / `::after` on `.dropdown-content` still apply in the top layer. They were not re-measured. A blank glass card, if one remains, is that inherited paint, not this open/close path, and would still require a `styles.css` change that this task forbids.
- The VS Code header uses the same component. It was kept compatible, and it was not visually checked.
