# Theme picker — tabbed popover (proposal)

Proposal only. Parent review and Gate 1.7 are still open. This file does not approve implementation. No component, CSS, or service edit belongs to this note. No Electron window was opened and no screenshot was taken. The HTML sibling is a static illustration, not rendered-app proof.

Revision after `theme-picker-design-review.md` (REVISE). This pass fixes that review's six items only. It does not reset the CI revision budget. Contrast ratios below are still this author's measurements, not independent acceptance evidence.

Design system used: the approved C4 glass layer already in this branch (`apps/ptah-extension-webview/src/styles.css` glass tokens, `apps/ptah-extension-webview/tailwind.config.js` `ptah-glass` / `ptah-glass-light`). No new brand, type, or accent.

`ptah_*` tools were not advertised. `search_tool` for `ptah` returned no tools (`tasks` server only). Inventory below is from native reads of the files named here.

## Parity inventory

Every row is an existing capability. Nothing in this list is removed. "Move" means the same capability changes container inside `ptah-theme-toggle` only.

| Capability | Source | Disposition | Evidence when someone implements |
| --- | --- | --- | --- |
| All 36 themes, labels, `isDark`, optional `glass` | `libs/frontend/core/src/lib/services/theme.service.ts` `DAISYUI_THEMES` lines 92–129 (type `ThemeName` 18–54, `ThemeInfo` 59–64) | Keep all 36. Move them out of the two stacked groups (`theme-toggle.component.ts` 59–142, buckets 179–180) into Light / Dark / Glass. One tab per theme is [designer-proposed], so a theme is not listed twice | Count of `button[data-theme]` is 36. Union of the three tabs equals `DAISYUI_THEMES`. Intersection is empty |
| Dark-then-light grouping | Component template 59–142. Spec still expects both buckets (`theme-toggle.component.spec.ts` 41–51) | Replace the two always-visible headings with tabs. Metadata flags stay the source. Keeping `DAISYUI_THEMES` order, rather than sorting names, is [designer-proposed] | Spec that asserted only two buckets must be updated to the three partitions below. Not done in this lane |
| Four color dots (`--p` `--s` `--a` `--n`) on each theme | Component 73–90 and 116–133, via `[attr.data-theme]` 70 and 113 | Keep the four channels. Move them into one compact tile. Production keeps `data-theme` on the control so live CSS variables paint the dots. Do not hard-code swatch hex in the component | Tile still exposes those four channels. Spot-check Ptah Glass `#e4b94a` / `#efd48c` / `#45d0be` / `#30343a` from `tailwind.config.js` 227–236 |
| Selection marker | `bg-base-300` plus Lucide `Check` when `currentTheme()` matches (component 69, 92–97, 135–140) | Keep the check. Move the row fill to a 2px `currentColor` ring on the tile (`outline`, not a new color). Add `aria-pressed` because the visible name is leaving the tile | Selected theme is the only `aria-pressed="true"`. Check is present only there |
| Persisted selection | `ThemeService.setTheme` 425–439 writes `vscode` state key `theme` (144) and `localStorage` `ptah-theme` (164, 344–349). `setAccent` 314–318 writes `ptah-accent` (82–83). Component only delegates (185–189) | Keep both calls and both keys. Picker stores nothing | Spec still asserts `setTheme(name)` and `setAccent('rose')` (`theme-toggle.component.spec.ts` 54–63, 110–124) |
| Gold means absent `data-accent` | Service effect 233–235. `DEFAULT_ACCENT` is `gold` (68). Component still passes `'gold'` into `setAccent` (174–177) | Keep. The Gold control still calls `setAccent('gold')`. The picker does not remove the attribute itself | No new accent value. Gold radio remains |
| Accents gold, rose, moonstone only for `ptah-glass` and `ptah-glass-light` | Render condition component 144. Fills and labels 174–178. Hex table `ACCENT_COLORS` 70–81. CSS overrides `styles.css` 3143–3171 | Keep the three radios, labels `Gold`, `Rose quartz`, `Moonstone`, and the same eligibility. Move the fieldset from the bottom of the long list to a footer under the tab panel, still inside the popover, so it stays available on every tab while a Ptah theme is current | Radios absent for every other theme, including glass opt-ins `dark`, `cupcake`, `dracula`, `nord`. Present for both Ptah themes. `aria-label` list unchanged (`theme-toggle.component.spec.ts` 118–122) |
| Click and key open | `button type="button"` with `popovertarget` (41–48). Enter and Space are the button's native activation plus the popover invoker. Accessible name `Change theme` (44) | Keep the button, the name, `popovertarget`, `aria-controls`, `aria-expanded`, `aria-haspopup="true"` | Existing top-layer spec (`theme-toggle.component.spec.ts` 66–107) still finds that button and `popover="auto"` |
| Outside click and Escape dismiss | `popover="auto"` (55). Theme choice does not close: `selectTheme` only calls `setTheme` (185–186) | Keep `popover="auto"`. Keep the panel open after a theme or accent choice | Escape and an outside pointer close it. Activating a tile does not |
| Focus return | Not implemented in the component. `popover="auto"` (55) closes on Escape and on an outside pointer. That platform close does not by itself mean every dismiss moves focus to the trigger. A pointer that lands on another focusable control focuses that control | Escape, and only when focus is inside the panel, moves focus to the trigger. An outside pointer closes the panel and leaves focus on the clicked control. Do not call `focus()` on the trigger after an outside pointer | Escape from a tile or tab: `document.activeElement` is the trigger. Outside click on another button: that button keeps focus. jsdom will not prove the top layer |
| Open placement | `onBeforeToggle` sets `top` to trigger bottom + 4px and `right` to the distance from the trigger's right edge to the viewport (192–206). Spec expects `44px` and that right value when the viewport has room (`theme-toggle.component.spec.ts` 86–105) | Keep the 4px gap and the right-edge anchor when they fit. Apply the viewport clamp in the layout section on open and on every window `resize` while the panel is open | Roomy fixture still gets `top: 44px`. A short viewport keeps the panel inside an 8px inset. Resizing the window updates `top` and `max-height` |
| Scroll | `w-64 max-h-[28rem] overflow-y-auto` (56) | Keep the 16rem width cap, the 28rem cap, and vertical scroll. The used `max-height` is the smaller of that cap and the clamped side computed below | Tiles scroll inside the panel. The panel box itself stays inside the viewport |
| `menuOpen` from `beforetoggle` | Component 192–196 | Keep, so `aria-expanded` and `dropdown-open` still track the UA | Existing assertion `aria-expanded="true"` |
| Glass eligibility and eager/deferred loading | Service effect 225–232. `EAGER_THEMES` 151. `setTheme` sheet wait 429–439 | Unchanged. The picker must not set `data-glass`, `data-theme`, or `data-accent` except by calling the service | No diff in `theme.service.ts` for this redesign |
| Trigger icon and the word Theme | Lucide `Palette`, classes `btn btn-ghost btn-xs`, label `icon-btn-label text-xs` (43–46, 181) | Keep | Electron spec that clicks `Change theme` keeps working (`theme-dropdown-fix.md` preserve note) |

## Tab classification

Derive only from `ThemeInfo`. Do not maintain a second list.

```
category(theme) = theme.glass ? 'glass' : theme.isDark ? 'dark' : 'light'
```

`glass: true` is set on exactly six entries: `ptah-glass` (93), `ptah-glass-light` (94), `dark` (98), `cupcake` (99), `dracula` (117), `nord` (127). That matches the handoff opt-in (dark, nord, cupcake, dracula) plus the two Ptah themes. Each theme is in one tab.

Order inside a tab is `DAISYUI_THEMES` order. Tab header order is Light, Dark, Glass.

Light (18), not glass and `isDark === false`: anubis-light, light, bumblebee, emerald, corporate, retro, cyberpunk, valentine, garden, lofi, pastel, fantasy, wireframe, cmyk, autumn, acid, lemonade, winter.

Dark (12), not glass and `isDark === true`: anubis, synthwave, halloween, forest, aqua, black, luxury, business, night, coffee, dim, sunset.

Glass (6): ptah-glass, ptah-glass-light, dark, cupcake, dracula, nord.

Footgun, called out so it is not "fixed" later: the theme named `dark` is on the Glass tab, not the Dark tab. `nord` and `cupcake` and `ptah-glass-light` are on the Glass tab, not the Light tab. `nord` is `isDark: false` in the service (127). This design does not change that flag.

On open, the selected tab is `category(currentTheme)`. `ptah-glass` opens Glass. `anubis` opens Dark. `lofi` opens Light. `nord` opens Glass.

## Layout

Popover stays `popover="auto"` on `.dropdown-content`, top layer, so the bar's overflow and `z-index: 30` do not clip it (`theme-dropdown-fix.md`). The panel stays a DOM descendant of the themed tree (the component host, which is inside the stage). Top-layer promotion does not cut custom-property inheritance, so `--glass-ink`, daisy channels, and the prototype's stage tokens still apply. Do not reparent the panel to `document.body`. Another lane owns glass pseudo-element repair. This design does not change `styles.css`.

| Piece | Value | Source | Tag |
| --- | --- | --- | --- |
| Panel width | `min(16rem, calc(100vw - 16px))` | 16rem is `w-64` (component 56). The viewport cap is new | 16rem keep. Cap [designer-proposed] |
| Panel max height | Preferred cap `min(28rem, 100dvh - 16px)`. Used height is that cap only when the chosen side can hold it. Otherwise the used height is the algorithm below | 28rem is `max-h-[28rem]` (component 56) | 28rem keep. Clamp [designer-proposed] |
| Overflow | `overflow-y: auto` | component 56 | [project] keep |
| Anchor | See the placement algorithm under this table. 4px gap when that side can hold the gap. 8px viewport inset. Right edges align until the left edge would pass 8px, then `left: 8px`. Re-run on open and on window `resize` | `onBeforeToggle` 201–205 for the roomy case | 4px below keep. Clamp and resize [designer-proposed] |
| Radius | `var(--glass-radius-inner)` (14px) when glass is on. Flat themes keep `rounded-box` | `styles.css` 2617 and the dropdown override 2852 | [project] |
| Glass fill | overlay recipe already on `.dropdown-content`: transparent element, `::after` uses `--glass-fill-overlay` and `--glass-filter-overlay` | `styles.css` 2817–2851 | [project] keep. Do not paint a second fill on the element |
| Glass ink | `var(--glass-ink)` which is `oklch(var(--bc))` | `styles.css` 2607, 2823 | [project] |
| Flat fill | existing `bg-base-200` when `data-glass` is absent | component 56 | [project] keep |
| Padding | glass: `0.375rem` from the dropdown rule. Flat: `0.5rem` (`p-2`) | `styles.css` 2852; component 56 | [project] |
| Tab labels | `0.75rem`, weight 600, full ink. Not the current `text-[10px] opacity-50` heading (component 61) | size matches `text-xs` on the accent legend (146). Weight matches `font-semibold` there | full ink [designer-proposed]. See contrast |
| Tab chrome | padding `0.25rem 0.5rem`, gap `0.25rem`, radius `var(--glass-radius-sm)` (10px, `styles.css` 2618). Selected tab fill `--glass-sel` when glass is on, else `bg-base-300` | `--glass-sel` dark is `oklch(var(--bc) / 0.12)` (2669); light is `oklch(var(--b1) / 0.94)` (2631) | [designer-proposed] using existing tokens |
| Light chip | 0.75rem square, radius 2px, fill `#ffffff`, 1px solid `--glass-line-strong` | User asked for a white Light header. Border token `styles.css` 2639 | chip [user-requested] as "Light (white)". Border token [project] |
| Dark chip | same box, fill `#17191d` | `ptah-glass` `base-100`, `tailwind.config.js` 239 | [designer-proposed] so the Dark header is distinguishable. Label text stays "Dark" |
| Glass chip | same box, `linear-gradient(135deg, #2b2e34, #17191d 62%, #26292f)` on a dark glass surface and `linear-gradient(135deg, #e9e1fb, #f6edf8 62%, #fde9df)` on a light glass surface | Scene stops in `styles.css` 2793 and 2794. Reduced stand-in of `--glass-scene`, not the full SVG | [designer-proposed] |
| Tile | 2.25rem square, radius `var(--rounded-btn)` when that token is the pill (`9999px` on Ptah themes, `tailwind.config.js` 259) else 0.5rem. Gap `0.375rem`. Grid `repeat(auto-fill, 2.25rem)`. At 16rem outer width and 0.375rem padding the content box is 244px (16px per rem). `floor((244 + 6) / (36 + 6))` is 5, not 6. Flat `p-2` (8px padding) is `floor((240 + 6) / 42)` and is also 5. Do not hard-code a column count | compact tile [user-requested]. Measurements [designer-proposed] | |
| Dots | four circles in a 2×2, colors `oklch(var(--p))`, `oklch(var(--s))`, `oklch(var(--a))`, `oklch(var(--n))` from the tile's `data-theme` | component 76–88 | [project] keep |
| Name | not painted in the grid. `title` and `aria-label` are both `theme.label` | tooltip [user-requested]. `aria-label` [designer-proposed] because `title` is not the accessible name | |
| Check | Lucide `Check`, 0.75rem, full ink, bottom-end of the tile, on a 0.875rem plate of `--glass-plate` or `base-100` | icon keep (component 93–96). Plate so the icon is not drawn on an arbitrary swatch [designer-proposed] | |
| Selected ring | `outline: 2px solid currentColor; outline-offset: 2px` | replaces `bg-base-300` row. Color is the ink already measured | [designer-proposed] |
| Accent footer | top border `1px solid var(--glass-divider)` (glass, `styles.css` 2644) or `border-base-content/20` (component 145). Legend unchanged. Chips 22×22, same gradients as 175–177. Checked ring and focus outline unchanged from 153 | eligibility keep. Footer placement [designer-proposed] | |
| Trigger | unchanged classes and copy | component 41–51 | [project] |
| Type | `Inter, system-ui, sans-serif` on the panel | `tailwind.config.js` 44 | [project] |
| Motion | no new animation. Existing `--animation-btn` is 0.18s on Ptah themes (`tailwind.config.js` 261). Honor `prefers-reduced-motion` by skipping any non-zero transform. The panel already sets `transform: none` while open (component 33–36) | [project] | |

Placement, in order. `margin` is 8px. `gap` is 4px. `cap` is `min(28rem, viewport height - 16px)`. `needed` is `min(scrollHeight, cap)` after the width is known. `spaceBelow` is `viewport height - trigger.bottom - margin`. `spaceAbove` is `trigger.top - margin`.

1. If `spaceBelow >= needed + gap`, put the top at `trigger.bottom + gap` and set `max-height` to `needed`.
2. Else if `spaceAbove >= needed + gap`, put the panel above the trigger with the same 4px gap and `max-height: needed`.
3. Else neither side holds the capped panel. Use the larger side. If that side is greater than `gap`, keep the 4px gap and set `max-height` to `side - gap`. If that side is not greater than `gap`, drop the gap, set `top` to `margin`, and set `max-height` to `viewport height - 16px`.
4. Clamp `top` so the box stays inside `[margin, viewport height - margin]`. Clamp `left` the same way. The roomy header case still lands 4px under the trigger (`theme-toggle.component.spec.ts` 86–105).
5. Run this on open and again on each window `resize` while the popover is open.

Hover on a tile uses `--glass-hover` when glass is on (`styles.css` 2668 dark, 2630 light), else `bg-base-300` (component 68).

Accent fills, copied from the component so the prototype matches production:

- Gold: `linear-gradient(#f6d675, #d9a928)`, title `Gold`
- Rose quartz: `linear-gradient(#f9c6d4, #e98fab)`
- Moonstone: `linear-gradient(#eef1f8, #bcc4d6)`

## Keyboard

| Key | Where | Result | Tag |
| --- | --- | --- | --- |
| Enter, Space, click | Trigger | UA opens `popover="auto"` | [project] existing |
| ArrowDown | Trigger, when closed | Open, then focus the selected tile | [designer-proposed] |
| Escape | Panel, focus inside it | Close and move focus to the trigger | [designer-proposed] restoration rule. Close itself is [project] via `popover="auto"` |
| Outside pointer | Panel | Close. Do not move focus. The clicked control keeps the focus the pointer gave it | [designer-proposed] correction. Close itself is [project] |
| Left, Right | Tab | Move the selected tab, wrap, show that category. Home selects Light. End selects Glass | [designer-proposed] roving and automatic activation. Not a verbatim user request |
| Tab | Tab list | Leaves the list. Next stop is the tile that has `tabindex="0"`, then the accent radios if they are shown, then out of the panel | [designer-proposed] so Tab does not walk every tile |
| Left, Right, Up, Down, Home, End | Tile grid | Rove. Horizontal step is 1. Vertical step is the used column count from the live grid (`grid-template-columns` track count), not a constant. At the default 16rem panel that count is 5. Only one tile has `tabindex="0"` | [designer-proposed] |
| Enter, Space | Tile | `setTheme(name)`. Panel stays open. If the new category differs, switch to that tab and keep focus on the tile | stay open [project]. Follow the selection to its tab [designer-proposed] |
| Arrows | Accent radios | Native radio group | [project] existing |

Roles: tab list `role="tablist"` with `aria-label="Theme categories"`. Each header is `role="tab"` with a stable id (`${menuId}-tab-light`, `${menuId}-tab-dark`, `${menuId}-tab-glass`), `aria-selected`, and `aria-controls="${menuId}-tabpanel"`. One `role="tabpanel"` carries that id and `aria-labelledby` set to the active tab's id. The tile buttons live in that tabpanel. They stay `button type="button"` with `title` and `aria-label` equal to `theme.label`. The accent footer stays outside the tabpanel. The popover element gains `role="dialog"` and `aria-label="Theme"`. `aria-haspopup` stays `true`.

On `beforetoggle` open: set the tab from `category(currentTheme)`, then focus the pressed tile. That initial focus move is [designer-proposed].

## Contrast

Criterion: WCAG 2.2 AA. Text is 1.4.3 at 4.5:1. Non-text UI boundaries are 1.4.11 at 3:1. The branch already treats 4.5:1 as the floor (`HANDOFF.md` line 143, and the `--bcm` notes in `tailwind.config.js` 15–24).

Measured with the WCAG relative-luminance ratio on sRGB hex. Overlay rows composite the fill at its alpha over the brightest glow in that scene (`styles.css` 2793 fills include `#f07a1a`; 2794 fills include `#ffb3d0`). Anubis Light used an OKLab-to-sRGB conversion of the oklch literals in `tailwind.config.js` 180–183. Swatch dots are previews of the theme, not text, so they are not contrast pairs.

| Pair | Ratio | Use |
| --- | --- | --- |
| `#f2f2f1` on `#202329` | 14.05:1 | Dark Ptah ink on `base-200`. Tab label, legend, tooltip text is not this pair (the tooltip is the UA title) |
| `#f2f2f1` on `#392d27` | 11.88:1 | Same ink on dark `--glass-fill-overlay` (`base-200` at 0.88) composited over glow `#f07a1a` |
| `#f2f2f1` on `#2a2e35` | 12.17:1 | Dark ink on `base-300` (selected flat row token, still the ring color's neighbor) |
| `#1e1936` on `#f7f3fd` | 15.39:1 | Light Ptah ink on `base-100` |
| `#1e1936` on `#eee8f8` | 14.05:1 | Light ink on `base-200` |
| `#1e1936` on `#f8edf9` | 14.81:1 | Light ink on light overlay (`base-100` at 0.9) over `#ffb3d0` |
| `#e8e6e1` on `#1a1a20` | 13.89:1 | Anubis ink on Anubis `base-200` (flat dark panel) |
| `#291334` on `#efeae6` | 14.21:1 | Anubis Light ink on Anubis Light `base-200` |
| `#f2f2f1` at 50% over `#202329`, read on `#202329` | 4.60:1 | Current heading treatment. Passes dark only |
| `#1e1936` at 50% over `#f7f3fd`, read on `#f7f3fd` | 3.21:1 | Same treatment on light Ptah. Fails 4.5:1 |
| Check at 70% ink on dark `base-300` (`#b6b7b9` on `#2a2e35`) | 6.79:1 | Current `opacity-70` check. Passes, but the spec uses full ink |
| `#f2f2f1` ring on `#202329` | 14.05:1 | Selected outline and accent `ring-base-content`, dark. Non-text |
| `#1e1936` ring on `#eee8f8` | 14.05:1 | Same ring, light |
| `#1b1403` on `#d9a928` | 8.41:1 | Gold chip edge against dark primary-content. The chip has no glyph; the accessible name is the radio's `aria-label` |
| `#1e1936` on `#d9a928` | 7.74:1 | Light ink against the gold chip's dark stop, if the ring overlaps the chip |
| `#17191d` chip next to `#f2f2f1` | 15.71:1 | Dark header chip against dark ink |
| `#ffffff` chip next to `#1e1936` | 16.83:1 | White Light chip against light ink |

Tab labels and the accent legend use full ink. They do not use `opacity-50`. Focus ring is `var(--glass-focus)` (`oklch(var(--bc))`, `styles.css` 2646 and 2685), the same ink, at least 3:1 on the overlay pairs above.

`prefers-reduced-transparency` and `prefers-contrast: more` already force solid fills (`styles.css` 2707–2732). The picker inherits that. No separate translucent text color is introduced.

## User-requested and designer-proposed

[user-requested]

- Popover, not a new page.
- Three headers: Light (white chip), Dark, Glass.
- Body is compact tiles, not the current text rows.
- Simple tooltip: the theme name in the `title` attribute. Production does not add a custom tooltip widget.
- All existing themes and the three accents stay.
- Native top layer stays (`popover="auto"`).

[designer-proposed]

- Partition rule `glass` first, then `isDark`, with each theme in one tab, and `DAISYUI_THEMES` order instead of an alphabetical sort. The three headers were requested. The once-only rule and the sort refusal were not separate user instructions.
- Roving tabindex on the tabs and on the tiles, including automatic tab activation and a vertical step equal to the live column count.
- `aria-label` equal to `theme.label` on each tile.
- `aria-pressed` on the selected tile.
- Accent fieldset in the footer, visible from any tab, same eligibility.
- Opening focuses the selected tile. ArrowDown on the trigger opens.
- Choosing a theme in another category switches the tab so the check stays on screen. The panel stays open.
- Placement algorithm above, including the neither-side clamp and a `resize` update. The 4px gap stays when the chosen side can hold it.
- Full-ink tab labels, because 50% opacity fails on light Ptah (3.21:1).
- Check plate and 2px ring, because a text row no longer carries `bg-base-300`.
- `role="dialog"` on the panel.
- Dark and Glass header chips. Only the white Light chip was requested.
- Prototype CSS tooltip that repeats `title` immediately. Review aid only. Implementation uses `title` plus `aria-label`.

## Decisions

1. Three tabs from `ThemeInfo.glass` then `isDark`, each theme once, source order kept. Options were a duplicated theme (glass themes also listed under Light or Dark) or a hand-maintained allow-list. Evidence: six `glass: true` flags at the lines cited, and the handoff opt-in list. The once-only partition is a design decision, not a separate user instruction. Reversible: the function is local to the component.
2. Names live in `title` and `aria-label`, not in the tile. Options were visible text under every tile (taller, closer to the rejected list) or `title` only. Evidence: user asked for compact tiles and a title tooltip; `title` alone fails the "accessible label" branch of the brief. Reversible.
3. Accent footer is shared. Options were accents only on the Glass tab. Evidence: today the radios render whenever the current theme is a Ptah theme (component 144), independent of scroll position. Hiding them on the Light tab would make the current accent unreachable without a tab change. Reversible.
4. Service file is out of scope. Category is derived in the component from fields the service already publishes. Evidence: brief says storage API and eligibility stay unchanged (`setTheme` / `setAccent`, lines cited). Reversible if a later lane wants a shared helper next to `DAISYUI_THEMES`.
5. No `styles.css` edit in the implementation this spec implies. The top-layer popover is the current structure. Glass paint stays the overlay role that `.dropdown-content` already has. Evidence: `theme-dropdown-fix.md`; user said another lane owns glass repair.

## Lane-introduced constraints

These are [lane-proposed]. They do not proceed to implementation until the parent review accepts them.

- Tab membership is the `category()` function above, not a visual guess.
- Tile names are `title` plus `aria-label`, not painted text.
- Tab label color is full ink, never `opacity-50`.
- Accent controls stay mounted for both Ptah themes on every tab.
- `ThemeService` persistence and glass eligibility are not edited.

[project-rule] sources used while drawing: C4 tokens in `styles.css` 2603–2690 and 2793–2852; Ptah color literals in `tailwind.config.js` 225–312; contrast floor 4.5:1 in `HANDOFF.md` 143.

## Unresolved

- Gate 1.7 is not approved. This lane cannot ask the user. The parent owns acceptance.
- ArrowDown-to-open, dialog role, accent footer, roving keys, and the neither-side clamp are designer-proposed. Rejecting any of them does not affect the 36 themes, the three accents, or the service contract. Escape-from-inside restores the trigger. An outside pointer does not.
- If the glass `::before` / `::after` still paints an empty card, that is the other lane's `styles.css` work. This spec does not claim the card is visible in Electron.
- No Jest, typecheck, lint, build, or browser run was executed. The prototype's on-load partition check is in-page script, not a project test.
- `ptah_agent_report` was not in the advertised tool list at search time.

## Prototype

`theme-picker-prototype.html` in this folder. Two C4 stages, dark gold and light rose, both able to stay open. Each panel is appended to its `.stage`, not to `document.body`, so `--ink`, `--overlay`, and the other stage tokens inherit through the top layer. It uses `popover="manual"` plus scripted Escape and outside-click so the two stages do not light-dismiss each other. Escape focuses the trigger. An outside pointer does not. Production stays `popover="auto"`. One tabpanel per popover is labelled by the active tab. `place()` uses the algorithm above and runs again on window `resize`. Vertical roving reads the live `grid-template-columns` count. Scene backgrounds are the gradient stops from `styles.css` 2793–2794, not the generated SVG. Swatches for the 32 prebuilt themes are the `--p` `--s` `--a` `--n` channels from `node_modules/daisyui/dist/themes.css`. Anubis and both Ptah themes use the `tailwind.config.js` literals. The page does not load the app stylesheet.
