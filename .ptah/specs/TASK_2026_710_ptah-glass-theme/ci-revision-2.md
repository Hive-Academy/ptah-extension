# CI revision 2 — TASK_2026_710 PR #805

Revision round 2 of 2. HEAD at start `cbadcf164`. Three remaining CI failures only. No local test, typecheck, lint, build, serve, or e2e was run (lane has no check authorization). No git. `.gitignore` was not touched. Revision 1 (accent boot write, electron dock shrink) was left as-is.

`ptah_*` tools were not listed on this client (`search_tool` for `ptah_agent_report` returned no schema; the only connected server is `tasks`). The spawn report could not be delivered. The same summary is in the lane's final message.

## Files changed

1. `apps/ptah-extension-webview/src/styles.css` — contrast twins, blur moved to `::after`, content-host popover lift, late fills kept off the filtered element.
2. `apps/ptah-electron-e2e/src/support/axe.ts` — `setTheme` clears `data-glass` for anubis / anubis-light.
3. `libs/frontend/chat/src/lib/settings/license/license-status-card.component.ts` — host `class: 'block'`.
4. `libs/frontend/webview-e2e-harness/src/lib/scenarios/marketplace/marketplace-visual.e2e.spec.ts` — `fitShellWidth` clamps an illegal viewport.
5. `libs/frontend/marketplace/src/lib/shell/marketplace-shell.component.ts` — host `max-w-[100vw]`.
6. `apps/ptah-extension-webview/src/app/glass-roles.spec.ts` — one regression that the pane rule has no `backdrop-filter`.
7. This file.

## 1. Glyph revert label 3.872:1 (Electron shard 2, run 39806685299 job 119921667033)

### Root cause

`glyph-margin-visual.spec.ts` calls `setTheme(page, 'dark')`. `axe.ts` maps that to `data-theme="anubis"` and, when `window.ng` exists, `ThemeService.setTheme('anubis')`, which removes `data-glass` because anubis is not a glass theme. Electron CI bundles do not expose `window.ng`, so the attribute path used to leave the ptah-glass boot's `data-glass="on"` in place.

Anubis tokens: `error` `#dc2626`, `error-content` `#e8e6e1` (the CI pair, ratio 3.872). `styles.css:2205` paints `.err-solid-text` `#ffffff` at specificity (0,2,0). `styles.css:3003` `:root[data-glass='on'] .btn-error { color: oklch(var(--erc)) }` is (0,3,0) and wins on the hunk Reject control (`btn btn-error btn-xs err-solid-text`). `#ffffff` on `#dc2626` is about 4.83:1. The light twin is `#131317` (`styles.css:2208`), which the unit contrast spec already requires.

### Change

- `styles.css:2215-2219` repeats those two inks at (0,4,0): `:root[data-glass='on'][data-theme='anubis'] .err-solid-text` and the anubis-light twin. The original single-selector rules stay, so `status-badge-contrast.spec.ts` still matches them.
- `axe.ts:77-78` always `removeAttribute('data-glass')` and `removeAttribute('data-glass-mode')` before the optional `window.ng` walk. Comment at `axe.ts:71-76`.

`.btn-error` itself is unchanged. `.ok-solid-text` is unchanged. Non-glass themes never match the new selectors.

## 2. Settings reachability (webview run 39806685294 job 119921668497)

### Root cause

Two cooperating causes. Raising the existing surface `z-index` does not fix either.

1. **Fixed containing block.** `backdrop-filter` on an element makes that element the containing block for `position: fixed` descendants. Electron's configuration host is glass chrome with `overflow: hidden`. The settings scroller is `overflow-y: auto`. A native popover does not portal: its backdrop is `fixed inset-0 z-40` and `.popover-panel` is `fixed` via floating-ui. Coordinates are then relative to the filtered pane, and overflow clips the panel. The same filter was on bar, overlay, `.modal-box`, and `.dropdown-content`.

2. **Inline host paint order.** `:where([data-glass-surface]) { isolation: isolate }` traps z-index inside the surface. The earlier rule `[data-glass-surface]:has(.popover-panel) { z-index: 30 }` (`styles.css:2931`) does not escape an inline custom element. `ptah-license-status-card` had no host class, so it stayed `display: inline`. The next sibling, `ptah-agent-behaviour-section` (`class: block`, text "Chat reasoning effort"), painted over `#membership-key-activate`. The click throws, so Escape never runs, the backdrop stays, and later Advanced clicks hit `fixed inset-0 z-40`. The Search & Voice intercept is the web-search key popover: that section is `data-glass-surface="content"`, host already `class: block`, and its popover uses the default dark backdrop (`bg-black/50`). Voice config has no glass content surface and uses `backdropClass="transparent"`. VS Code settings render in the outlet, not inside Electron chrome, so the inline-host order fails both host modes. The webview log showed ADV-4 blocked first, then the backdrop cascade.

### Change

Blur and grain move onto `::after` (`content: ''`, `position: absolute`, `inset: 0`, `z-index: -1`, `pointer-events: none`). The element is `background: transparent` and `isolation: isolate`, with no `backdrop-filter`. The pseudo is not an ancestor, so fixed panels stay viewport-fixed. A transparent element background is what lets the pseudo sample the scene.

- Element rule: `styles.css:2817-2825`. Pseudo: `styles.css:2826-2851`. Bar under-scrim: `styles.css:2855-2861`.
- Forced colors clears the pseudo filter and background: `styles.css:2755-2760`.
- Late utility rules that used to paint a solid fill on the filtered element now paint the element transparent and the fill on `::after`: `styles.css:3224-3247`. A solid `background-color` on the element would be the layer `::after` blurs. Content, tile, and plate still fill the element (`styles.css:3237-3239`); those roles have no blur.
- License host: `license-status-card.component.ts:68` `host: { class: 'block' }`.
- Host lift, not a higher number on the old rule: `styles.css:2932-2935`

```css
:root[data-glass='on'] :has(> [data-glass-surface='content']:has(.popover-panel)) {
  position: relative;
  z-index: 30;
}
```

The old surface lift at `styles.css:2931` stays at 30. The selector is narrowed to a direct child with role `content`, so Electron's chrome body is not lifted when a pane inside it opens a popover. `display` is not set, so a flex host keeps its display. The lift exists only while `.popover-panel` is in the DOM.

`.glass-panel` at `styles.css:482` was not changed.

## 3. Marketplace six discovery views (same webview job)

### Root cause

`marketplace-visual.e2e.spec.ts:125` (old line) called `page.setViewportSize` with a width Playwright rejects (must be finite, > 0, and ≤ 1e7). The electron branch seeded `viewport = target + 260` and then `viewport += target - measured` for up to six tries. The shell is `w-full min-w-0` inside the chat column of a flex row. Revision 1 made the git dock shrink, so the dock absorbs viewport delta until its floor. Shell width is not slope 1 with the viewport. One bad border box (a discovery view's min-content, or a box read before layout) walks the next width negative or above 1e7. Playwright then closes the page, and the retry times out clicking the nav (`:153`). The test is screenshot-only; it does not assert width. `WIDTHS` are 720 / 1100 / 1750. The Electron shard log was not downloaded. The webview log did not include the measured pixel, so a single discovery view was not proven as the min-content offender. The protocol error is the unbounded correction.

### Change

- `marketplace-visual.e2e.spec.ts:123-147`: electron loop clamps the width passed to `setViewportSize` to `[320, 8000]`, waits one `requestAnimationFrame`, reads `getBoundingClientRect().width`, and returns on a non-finite or non-positive measure or a non-finite next step. The next viewport is clamped into the same range. The VS Code branch still sets the target directly. The six-try loop, `WIDTHS`, and every assertion are unchanged. Timeouts are unchanged. No `force` clicks.
- `marketplace-shell.component.ts:126`: host class gains `max-w-[100vw]` so the shell border box cannot exceed the viewport. `overflow-hidden`, `min-w-0`, and `w-full` stay.

Returning early leaves the last legal viewport. Screenshots can land at a clamped width if the shell never tracks the target. That is the stabilization the slope-1 assumption required. It is not a loosened width assertion, because this spec has none.

## Decisions

### Contrast: dual fix (attribute clear and a higher-specificity ink)

- Options: retint `.btn-error` for every theme; only clear `data-glass` in the test helper; only add the (0,4,0) ink rules; both.
- Evidence: CI pair matches anubis `error` / `error-content` under leftover `data-glass`. Production bundles lack `window.ng`. The unit spec pins the single-selector rules and the two hex inks. White on `#dc2626` clears 4.5.
- Chose both. The CSS rule covers a hybrid attribute state if something else sets glass on anubis. The helper matches what `ThemeService.setTheme('anubis')` does when `ng` is present.
- Reversible: delete `styles.css:2211-2219` and the two `removeAttribute` lines.

### Settings: move the filter, then lift the host

- Options: raise `[data-glass-surface]:has(.popover-panel)` above 30; portal `NativePopoverComponent`; `backdrop-filter` on `::after` plus a block host and a content-parent lift.
- Evidence: the existing z-30 lift was already in the tree and CI still failed both hosts. The license host was inline. Electron chrome is `overflow: hidden` and filtered. A portal would change popover geometry for every caller.
- Chose the filter move plus the block host plus the content-parent lift at the same z-index 30. This is a new selector on the sibling the surface rule cannot reach. It is not a larger z-index on the rule CI already had.
- Reversible: restore element `backdrop-filter`, drop the `:has(> …)` rule, drop `host: { class: 'block' }`.

### Marketplace: clamp plus a viewport cap

- Options: drop the width loop; raise the test timeout; only clamp the helper; only `max-w-[100vw]`; both.
- Evidence: Playwright's own error is an illegal viewport size. The flex row plus a shrinking dock falsifies `viewport += target - measured` as a unit slope. No logged pixel named one discovery view.
- Chose both the clamp (so `setViewportSize` is never called with an illegal size) and `max-w-[100vw]` (so the shell border box cannot itself be larger than the viewport).
- Reversible: restore the old loop and the previous host class string.

## Parity preserved

- Approved glass C4 tokens, grain, rim `::before` (`z-index: 1`), inset glint, and overlay scrim are unchanged. Blur still uses `--glass-filter` and `--glass-filter-overlay`. Non-glass themes do not match `:root[data-glass='on']`.
- Content, tile, and plate still have no blur.
- Modal and dropdown geometry (radius, padding, shadow) is unchanged. Bar-nested menus stay nearly solid (`oklch(var(--b1) / 0.97)`) with blur off, now on `::after`.
- Popover z-index levels stay 30 / 40 / 50. The surface lift stays 30.
- Contrast floor stays 4.5. No assertion, timeout, `WIDTHS` entry, or click option was loosened. `.gitignore` and revision-1 files were not edited.

## Checks not run

No `nx test`, Jest, `tsc`, lint, build, serve, dev, Playwright, or Electron package. `glass-roles.spec.ts` was not executed. The new CSS regex was checked by reading `styles.css:2817-2838` and `styles.css:2932`: the first element block has `background: transparent` and no `backdrop-filter`; the `::after` block sets `backdrop-filter: var(--glass-filter)`; the content-host selector is present.

## Unknowns

- `::after` blur versus element blur was not rendered. Grain, rim, and inset shadow can read differently. Forced-colors was not rendered.
- Whether every settings popover that stays open lives under a `content` surface. Agent behaviour is itself the content surface, so its host matches the new `:has`. Voice config does not. A popover hosted only by chrome or bar still depends on the filter move plus the old surface lift.
- Which discovery view produced the illegal measure. The clamp prevents the protocol error either way. If the shell never reaches 720 / 1100 / 1750, the screenshots differ from the plan's B10 row and a later visual review can still fail them. This spec does not assert those widths.
- Electron shard 2 log was not fetched. The contrast pair is taken from the lane brief and from the anubis tokens.
- `ptah_agent_report` was not callable from this client.
