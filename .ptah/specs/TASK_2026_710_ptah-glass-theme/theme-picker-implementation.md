# Theme picker implementation

Source-only change in the TASK_2026_710 worktree. No Jest, typecheck, lint, build, serve, dev, e2e, package, or browser run. This is not rendered acceptance and not merge-ready. An independent parent review follows.

`search_tool` for `ptah_*` returned no Ptah tools (tasks server only). Inventory and edits used native reads of the files named below.

## Files

- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.ts` (replaced the two stacked lists)
- `libs/frontend/chat-ui/src/lib/atoms/theme-toggle.component.spec.ts` (replaced the bucket and "top layer" specs)
- This report

No service, global CSS, shared popover, or `.gitignore` edit. Working tree left dirty. No commit, push, stash, or reset.

## Mechanisms

| Behavior | Where |
| --- | --- |
| Category is `glass` then `isDark`. One theme, source order. Light 18, Dark 12, Glass 6 | `themeCategory` line 27; `LIGHT_THEMES` / `DARK_THEMES` / `GLASS_THEMES` lines 32–34; `visibleThemes` lines 313–316 |
| One `popover="auto"` dialog, trigger name `Change theme`, `popovertarget`, `aria-expanded`, `aria-haspopup="true"` | template lines 176–205 |
| Tablist `Theme categories`, stable ids `${menuId}-tab-*`, shared `aria-controls`, one tabpanel `aria-labelledby` the active tab | template lines 206–226 |
| Open sets the tab from `currentTheme` and does not focus inside `beforetoggle` | `onBeforeToggle` lines 372–387 |
| Focus and geometry run in `afterNextRender` `mixedReadWrite`, after Angular has rendered the selected tab | `scheduleFollowup` lines 445–461 |
| Close and destroy bump `focusGeneration` and destroy the render ref so a queued callback cannot focus | `cancelFollowup` lines 464–467; `ngOnDestroy` lines 324–327 |
| `scrollHeight <= 0` returns before any `top` / `max-height` / `width` write | `place` lines 501–508 |
| Right-aligned, 4px gap, 8px inset, width `min(16rem, viewport - 16px)`, height cap `min(28rem, viewport - 16px)`, smaller side when neither fits. Resize while `menuOpen` | `place` lines 496–548; `onWindowResize` lines 404–410 |
| Tiles: `title` and `aria-label` are `theme.label`. Four swatches `oklch(var(--p\|s\|a\|n))` on `data-theme` | template lines 230–250 |
| Check plate and selected/focus outline use `--picker-ink` / `--picker-plate`, concrete colors copied from the parent. `data-theme` on the tile replaces `--bc`, so the ring is not `currentColor` or `var(--bc)` | `captureParentInk` lines 478–492; styles on `.theme-tile` |
| Accents stay Gold / Rose quartz / Moonstone, delegated to `setAccent`, shown for `ptah-glass` and `ptah-glass-light` on every tab. Radio `name` is `${menuId}-accent` | template lines 255–270; `accentGroup` line 289 |
| Tile roving step is `grid-template-columns` track count, not a constant. `repeat(` falls back to the first row's `offsetTop` | `columnCount` lines 557–573 |
| Tabs: Left/Right wrap, Home Light, End Glass, automatic activation | `onTabKeydown` lines 414–423 |
| ArrowDown on the closed trigger calls `showPopover` | `onTriggerKeydown` lines 365–369 |
| Escape focuses the trigger and does not `preventDefault`. No outside-click listener | `onDialogKeydown` lines 390–393 |

## Decisions

1. **Parent ink is a copied used color, not `currentColor` on the tile.** Options were an inner `data-theme` swatch with the ring on an unthemed button, or `outline: currentColor` as the design text says. Evidence: this task says `data-theme` on the tile overrides `--bc`. `setProperty('--picker-ink', getComputedStyle(parent).color)` stores a concrete `rgb(...)`. Reversible.
2. **Only the active tab's tiles are in the DOM.** The design's "36 `button[data-theme]`" is the union across tabs, not one paint. One tabpanel cannot show 36 tiles and also be one category. Reversible.
3. **`lightThemes` / `darkThemes` no longer include `glass: true` entries.** Glass is `glassThemes`. Call sites were only this component and its spec. Reversible.
4. **Cross-category `selectTheme` switches tab and focuses after render.** A click can only hit a tile in the open tab, so that branch is for a selection whose category is not the open tab. Panel stays open because the handler never calls `hidePopover`. Reversible.
5. **Tile arrows do not wrap. Tab arrows do.** The design says tabs wrap and tiles step by one or by the live column count. Home/End cover the ends. Reversible.
6. **No `styles.css` or `ThemeService` edit.** Deferred sheets still load only inside `setTheme`. Reversible by a later lane.

## Parity

| Capability | Kept |
| --- | --- |
| All 36 `DAISYUI_THEMES`, labels, `isDark`, `glass` | Yes. No second name list |
| Four channels `--p` `--s` `--a` `--n` | Yes. No swatch hex |
| `setTheme` / `setAccent`, storage keys untouched | Yes. Component only delegates |
| Gold / rose / moonstone only for the two Ptah themes | Yes, on every tab |
| Trigger label, icon, `popover="auto"`, outside dismiss | Yes. Outside click does not call `focus()` |
| Escape returns focus to the trigger when the event is inside the dialog | Yes, without cancelling the UA close |
| Theme or accent choice does not close the popover | Yes |
| Roomy placement: trigger bottom 40 and right 800 still yields `top: 44px` and `right: innerWidth - 800` | Encoded in the spec. Not executed |
| Glass eligibility and eager/deferred CSS | Unchanged. `theme.service.ts` not edited |

## Specs

`theme-toggle.component.spec.ts` covers partition union and order, per-tab DOM counts, title/aria-label, channel vars, the single pressed tile and check plate, accent delegation and per-instance radio names, tab/tabpanel wiring, open-follows-`currentTheme`, tab and tile keys, invoker attributes, roomy and narrow placement, resize, empty `scrollHeight`, Escape versus outside click, ArrowDown `showPopover`, concrete `--picker-ink`, and close/destroy cancellation.

The old test name that claimed the list was in the top layer is gone. The file header says jsdom does not prove the top layer or paint.

## Unresolved limitations

- `afterNextRender` runs on browser platforms only. The spec calls `ApplicationRef.tick()` after `detectChanges`. If this Jest setup never flushes that hook, focus and placement assertions fail even though the synchronous `beforetoggle` ink copy still runs. Not executed, so this is unverified.
- A content box that is still 0 after the open render is left on the CSS cap (`min(16rem, 100vw - 16px)` by `min(28rem, 100dvh - 16px)`). The next resize while open measures again. There is no second animation frame.
- `columnCount` trusts resolved `grid-template-columns`. A `repeat(` value, or a hidden grid whose children share `offsetTop`, steps by the whole first row. A laid-out open popover should report pixel tracks.
- `--picker-plate` is the first opaque ancestor background. A fully transparent ancestor chain keeps the CSS fallback `color-mix` of the parent ink with `Canvas`, not the preview theme's `--b1`.
- Chip hex values are the design's header chips, not theme previews. Glass chip gradient follows `currentTheme.isDark`.
- No Electron screenshot, contrast measurement, or hit test. The design review's gate was source-only. Visual acceptance stays blocked.
- Public field meaning of `lightThemes` and `darkThemes` changed as in decision 3. No other repo call site reads them.

## Checks not run

Temporary policy forbids local checks. Not run: Jest, typecheck, lint, diagnostics, build, serve, e2e, package, browser.

When checks are allowed, one heavy run, changed project only:

`nx test @ptah-extension/chat-ui --parallel=1 -- --maxWorkers=2 --coverage=false`

Electron visual review is the first host to verify. No TUI or VS Code polish in this change.
