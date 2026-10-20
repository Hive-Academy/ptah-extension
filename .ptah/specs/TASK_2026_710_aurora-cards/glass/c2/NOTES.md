# Ptah Glass v2 (panelist P3, round C2)

One glass layer for DaisyUI v4 plus two curated Ptah themes. `glass\c` is untouched for comparison.

Files: `theme.config.js` (the two Ptah themes), `glass-layer.css` (shared layer, override map, fallbacks; GENERATED),
`theme.css` (compiled channel vars, GENERATED), `index.html` (prototype), `shots\` (Playwright renders of all 7 themes).
Sources/tools: `_glass-layer.src.css` (hand-edited layer; `build.cjs` injects the generated scenes), `registry.cjs`
(= what `DAISYUI_THEMES` would carry: glass opt-in, mode, scene, ink override), `contrast.cjs`, `backdrop-max.cjs`, `shoot.cjs`.
Rebuild: `node build.cjs && node backdrop-max.cjs && node contrast.cjs && node shoot.cjs`.
Open `index.html`; `?theme=<name>` and `?glass=off` preselect; the navbar has a theme select (7 themes) and a Glass toggle.

## 1. The dark recipe I settled on (`ptah-glass`)

| Property | Value | Why |
| --- | --- | --- |
| Base (DaisyUI) | base-100 `#17191d`, 200 `#202329`, 300 `#2a2e35`, neutral `#30343a`, base-content `#f2f2f1` | neutral charcoal, no navy anywhere |
| Chrome fill | `oklch(var(--bc) / .13)` (= white-gray veil, adds light) over a stable under-scrim `oklch(var(--b1) / .26)` | gray glass that lifts the scene; scrim is the "stable text plane" |
| Raised / tile / hover / selected | `.20` / `.045` / `.10` / `.12` of `--bc`; assistant bubble & content `--b1 .78`; code `--b1 .90`; overlay `--b2 .88` | content and code stay near-solid |
| Filter (chrome) | `blur(16px) saturate(1.16) brightness(1.06)`; overlay `blur(22px) saturate(1.16)` | research 16/1.16/1.08; brightness trimmed to pass AA at the brightest pixel |
| Edge | masked 1px rim, `linear-gradient(145deg, white .38, white .06 70%)`, plus `inset 0 1px white .24` glint | directional, top-left key light |
| Shadow | `0 18px 46px -20px rgb(5 8 14 / .38), 0 2px 8px rgb(5 8 14 / .18)`; overlay `.5` | soft, not near-black |
| Grain | 160px fractal-noise tile, monochrome, 5% (3.5% light) | micro-texture under 12px text stays legible |
| Backdrop | generated SVG (data URI, ~3KB): charcoal gradient `#2b2e34 -> #17191d -> #26292f`, five blurred fields placed behind the panes: plum `#9a3f9a` (.30) behind the sidebar, silver (.20) and amber `#d2691e` (.30) behind the chat, steel-teal `#2b9bb0` (.34) and amber (.32) behind the right pane, 3 blurred ridge silhouettes, 7% smoke noise | light crosses every pane edge so blur has something to transmit; hue is in the scene, panels stay neutral |
| Gold | primary action (gradient button, progress, checked controls, focus ring) and one 3px selection indicator | selected items are neutral glass, not gold paint |

Light (`ptah-glass-light`) keeps the approved direction with research values: fill `--b1 .58`, raised `.72`, content `.80`,
overlay `.90`, edge `white .8 -> .18`, glint `white .8`, lavender shadow `rgb(86 68 132 / .24)`, `saturate(1.15)`,
backdrop = lavender/peach/sky glows now placed behind each pane; primary text-gold stays the deep `#7c5700`/`#7a5300` ink.

## 2. Palette (hex + OKLCH)

| Role | ptah-glass | OKLCH | ptah-glass-light | OKLCH |
| --- | --- | --- | --- | --- |
| primary | #e4b94a | 80.4% 0.136 87.5 | #7c5700 | 48.4% 0.100 80.0 |
| primary-content | #1b1403 | 19.5% 0.033 88.8 | #fff8e6 | 98.0% 0.025 89.2 |
| secondary | #efd48c | 87.6% 0.096 89.7 | #9a6b12 | 56.3% 0.112 76.7 |
| accent | #45d0be | 77.9% 0.121 182.8 | #0b7f77 | 53.8% 0.092 187.0 |
| neutral | #30343a | 32.4% 0.012 258.4 | #2b2650 | 29.7% 0.074 286.4 |
| base-100 / 200 / 300 | #17191d / #202329 / #2a2e35 | 21.3% 0.008 264.4 / 25.6% 0.012 264.3 / 30.0% 0.014 261.7 | #f7f3fd / #eee8f8 / #e2daf1 | 97.0% 0.014 304.1 / 94.0% 0.022 302.9 / 90.2% 0.032 301.6 |
| base-content | #f2f2f1 | 96.1% 0.001 106.4 | #1e1936 | 23.6% 0.055 289.5 |
| `--bcm` | #dcdee3 | 90.1% 0.007 268.5 | #5b5379 | 46.6% 0.061 293.5 |
| state-ink run/need/err/done/idle | #93bdff #ffb066 #ff9696 #5fe0a0 #dcdee3 | | #2449b0 #8f5200 #a31f26 #0f6434 #5f5878 | |

Every anubis custom key is present (`--bcm`, `--state-ink-*`, `--ptah-check-edge` 70% dark / 55% light,
`--rounded-*`, `--animation-*`, `--btn-focus-scale`, `--border-btn`, `--tab-border`, `--tab-radius`). Full OKLCH for all channels: `theme.css`.
Stock themes shown (dark, nord, cupcake, dracula, lofi) use their own `full.css` channels; `theme.css` adds only their `--bcm`
(the app's `styles.css` already carries a measured `--bcm` for all 32).

## 3. Theme-agnostic layer: contract and override map

```
<html data-theme="nord" data-glass="on" data-glass-mode="light">
```
- Base/ink/accent derive from `--b1 --b2 --b3 --bc --p` (+ `--n --nc --in --su --wa --er` for tones). v4 channel vars only.
- Opt-out = omit `data-glass` (shown with `lofi`; the page returns to plain DaisyUI with zero leftovers).
- Surface roles are attributes: `chrome` (blur, floating), `overlay` (blur, near-opaque), `content` (stable fill), `tile` (fill + hairline).
  `.modal-box` and `.dropdown-content` are overlays by class (they always are), so no template edits are needed for them.
  The old blanket `.card` and `.surface-3` rules are gone.
- Per-theme data = `--glass-scene` only (section 3 of the CSS, generated), plus an optional ink override (only `dark` needs one:
  its stock `--bc` is 74.6% lightness, too dim for glass, so `--bc: 95% 0.012 250`).
- Token-only escape hatches: `prefers-reduced-transparency` and `prefers-contrast: more` swap every fill to solid `oklch(var(--b1|b2|b3))`,
  drop blur, grain, scene and rim and add a 1px ink border (contrast: 3px focus ring); `forced-colors: active` uses `Canvas/CanvasText/Highlight`;
  `@supports not (backdrop-filter)` raises fills to 92-98%; `prefers-reduced-motion` zeroes transitions (the backdrop is static anyway).

## 4. Surface-role mapping for the real app

| Role | Angular component / element | Notes |
| --- | --- | --- |
| chrome | `ptah-electron-shell` sidebar column (`ptah-sidebar-tab` host / session list pane), shell header / `ptah-command-center-header`, `ptah-chat-view` pane, right docked pane (`ptah-docked-inspector`), `ptah-chat-input` outer composer bar | 2-4 visible at once; one per major pane |
| overlay | `.modal-box` (`ptah-confirmation-modal`, `ptah-dialog-host`, `ptah-add-cli-instance-modal`, ...), `.dropdown-content` (`ptah-dropdown`, branch picker, model/effort popovers) | automatic by class; one open at a time |
| content | settings and marketplace cards, `ptah-command-center-start` panels, Components-style cards, `ptah-message-bubble` (assistant) body | no blur; stable reading plane |
| tile | `ptah-project-setup-card` (`<section>` replaces `.surface-3`), `ptah-prompt-suggestions` list, stat tiles (`ptah-command-session-stats`, `ptah-inspector-session-stats`), `ptah-tool-call-item`, `ptah-execution-node`, nested composer field | fill + hairline only |
| none (component rules) | `.chat-bubble`, `.mockup-code` / code blocks, `.table`, `.alert`, `.collapse`, `.stats`, `.badge`, `.btn`, `.menu` rows | near-solid or fill-only; never blurred |

## 5. Integration edits

1. `tailwind.config.js`: add `{ 'ptah-glass': {...} }` and `{ 'ptah-glass-light': {...} }` from `theme.config.js` to `daisyui.themes`
   (after `anubis-light`); to make glass the default also set `darkTheme: 'ptah-glass'` and `themeRoot: '[data-theme=ptah-glass]'`.
2. `theme.service.ts`: add the two names to `ThemeName`; extend `ThemeInfo` with `glass?: boolean` (default `false`) and
   `scene`-free `mode` is already `isDark`; prepend `{ name: 'ptah-glass', label: 'Ptah Glass', isDark: true, glass: true }`,
   `{ name: 'ptah-glass-light', ..., isDark: false, glass: true }`; set `glass: true` for the stock themes that pass review
   (this prototype: `dark`, `nord`, `cupcake`, `dracula`; recommended next: `dim night winter pastel valentine coffee retro sunset`,
   keep `black lofi wireframe cyberpunk` off). In the existing `effect()` that writes `data-theme`/`data-theme-mode`, also write
   `data-glass="on"` + `data-glass-mode` when `info.glass`, else remove both. `EAGER_THEMES` gains the two Ptah themes; stock glass themes
   still come from `theme-extra.css`, so the glass layer (in `styles.css`) must load for them - it does, it is eager.
   Default theme `ptah-glass`; `index.html` hardcoded `<html data-theme="ptah-glass" data-theme-mode="dark" data-glass="on" data-glass-mode="dark">`
   to avoid a first-paint flash.
3. `styles.css`: paste `glass-layer.css` inside one `@layer components { ... }` block after the semantic-surface block (the scene data-URIs
   are ~3KB each x 6 here; the app would ship only the scenes of themes it opts in). Remove nothing else; anubis keeps working.
   `.surface-3` etc. keep their current definitions; glass themes get glass via the roles, not via those classes.
4. Templates: add `data-glass-surface="chrome|content|tile"` to the elements listed in section 4 (attribute only, no class churn).
   Make `ptah-aurora-effect` and any opaque shell `bg-base-*` wrapper conditional (`:root[data-glass='on'] .bg-base-100` is already transparent).

## 6. Blur budget

Visible at once in the shell: 4 static `chrome` planes (sidebar, header, chat pane, right pane) at 16px, plus at most one `overlay` (22px);
the composer, tool calls, bubbles, code, tables, menu rows, tooltips, badges and buttons never blur. The backdrop is one static fixed
pseudo-element (SVG rasterised once, no animation, no `will-change`). Nested blur is impossible by construction (roles are not nested
chrome-in-chrome). Reduced-transparency removes all of it. Not profiled on hardware: validate with DevTools Performance during transcript scroll.

## 7. Contrast (WCAG 2.2 AA, measured at the worst backdrop pixel for every theme shown)

Method: each theme's backdrop is rendered with the page hidden and every ~7th pixel sampled; dark-mode themes use the BRIGHTEST pixel
(x the 1.06 brightness filter), light-mode themes the DARKEST. The real stack is composited in order (backdrop -> under-scrim -> fill -> tile ->
tint); saturation is ignored (it moves chroma, not luminance, to first order). Blur averages colours, so one worst pixel is a conservative bound.
Criteria: 4.5:1 text (all text is treated as normal size), 3:1 UI boundaries/focus. Tone text = tone mixed toward ink (`--glass-tint-mix`:
0% dark, 28% light). Disabled controls exempt. Result: **23 pass / 0 fail for each of ptah-glass, ptah-glass-light, dark, nord, cupcake, dracula**.
`lofi` skips glass and is stock DaisyUI. Note the two rows that carry the cost of the dark recipe: the worst pixel forces muted ink to ~90% of full ink.

| Theme | Pair | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| ptah-glass | worst backdrop pixel #694530 (brightest); panel #6c5447, tile #725b4e, content #2a2626 |  |  |  |
| ptah-glass | text on chrome panel | 6.26 | 4.5:1 | pass |
| ptah-glass | text on tile | 5.64 | 4.5:1 | pass |
| ptah-glass | text on content / assistant bubble | 13.36 | 4.5:1 | pass |
| ptah-glass | text on user bubble | 11.62 | 4.5:1 | pass |
| ptah-glass | text on overlay (menu / modal) | 13.22 | 4.5:1 | pass |
| ptah-glass | text on selected item | 4.75 | 4.5:1 | pass |
| ptah-glass | code ink on code block | 14.65 | 4.5:1 | pass |
| ptah-glass | muted (--bcm) on chrome panel | 5.21 | 4.5:1 | pass |
| ptah-glass | muted (--bcm) on tile | 4.70 | 4.5:1 | pass |
| ptah-glass | muted (--bcm) on content | 11.11 | 4.5:1 | pass |
| ptah-glass | placeholder (--bcm) on input | 4.63 | 4.5:1 | pass |
| ptah-glass | btn-primary label (pc on p) [gold gradient ink, worst end] | 8.41 | 4.5:1 | pass |
| ptah-glass | btn-neutral label (nc on n) | 9.69 | 4.5:1 | pass |
| ptah-glass | badge-info text on its tint | 4.94 | 4.5:1 | pass |
| ptah-glass | badge-success text on its tint | 4.80 | 4.5:1 | pass |
| ptah-glass | badge-warning text on its tint | 4.71 | 4.5:1 | pass |
| ptah-glass | badge-error text on its tint | 5.02 | 4.5:1 | pass |
| ptah-glass | badge-primary text on its tint | 4.64 | 4.5:1 | pass |
| ptah-glass | btn-secondary / accent text on tint (accent) | 5.21 | 4.5:1 | pass |
| ptah-glass | UI: input / checkbox border vs panel | 3.51 | 3:1 | pass |
| ptah-glass | UI: focus ring vs chrome panel | 4.58 | 3:1 | pass |
| ptah-glass | UI: focus ring vs overlay | 9.68 | 3:1 | pass |
| ptah-glass | UI: --ptah-check-edge (bc @70%) vs tile | 3.71 | 3:1 | pass |
| ptah-glass-light | worst backdrop pixel #c9b7f6 (darkest); panel #e4dafa, tile #ede6fc, content #f3eefc |  |  |  |
| ptah-glass-light | text on chrome panel | 12.59 | 4.5:1 | pass |
| ptah-glass-light | text on tile | 13.89 | 4.5:1 | pass |
| ptah-glass-light | text on content / assistant bubble | 14.79 | 4.5:1 | pass |
| ptah-glass-light | text on user bubble | 15.26 | 4.5:1 | pass |
| ptah-glass-light | text on overlay (menu / modal) | 14.66 | 4.5:1 | pass |
| ptah-glass-light | text on selected item | 15.17 | 4.5:1 | pass |
| ptah-glass-light | code ink on code block | 9.90 | 4.5:1 | pass |
| ptah-glass-light | muted (--bcm) on chrome panel | 5.31 | 4.5:1 | pass |
| ptah-glass-light | muted (--bcm) on tile | 5.86 | 4.5:1 | pass |
| ptah-glass-light | muted (--bcm) on content | 6.24 | 4.5:1 | pass |
| ptah-glass-light | placeholder (--bcm) on input | 6.04 | 4.5:1 | pass |
| ptah-glass-light | btn-primary label (pc on p) [gold gradient ink, worst end] | 7.89 | 4.5:1 | pass |
| ptah-glass-light | btn-neutral label (nc on n) | 9.49 | 4.5:1 | pass |
| ptah-glass-light | badge-info text on its tint | 9.07 | 4.5:1 | pass |
| ptah-glass-light | badge-success text on its tint | 8.99 | 4.5:1 | pass |
| ptah-glass-light | badge-warning text on its tint | 7.82 | 4.5:1 | pass |
| ptah-glass-light | badge-error text on its tint | 8.72 | 4.5:1 | pass |
| ptah-glass-light | badge-primary text on its tint | 9.41 | 4.5:1 | pass |
| ptah-glass-light | btn-secondary / accent text on tint (accent) | 8.25 | 4.5:1 | pass |
| ptah-glass-light | UI: input / checkbox border vs panel | 4.55 | 3:1 | pass |
| ptah-glass-light | UI: focus ring vs chrome panel | 5.13 | 3:1 | pass |
| ptah-glass-light | UI: focus ring vs overlay | 5.97 | 3:1 | pass |
| ptah-glass-light | UI: --ptah-check-edge (bc @55%) vs tile | 3.62 | 3:1 | pass |
| dark | worst backdrop pixel #3c454d (brightest); panel #4e565e, tile #555d65, content #282e35 |  |  |  |
| dark | text on chrome panel | 6.44 | 4.5:1 | pass |
| dark | text on tile | 5.78 | 4.5:1 | pass |
| dark | text on content / assistant bubble | 11.84 | 4.5:1 | pass |
| dark | text on user bubble | 14.47 | 4.5:1 | pass |
| dark | text on overlay (menu / modal) | 13.70 | 4.5:1 | pass |
| dark | text on selected item | 4.89 | 4.5:1 | pass |
| dark | code ink on code block | 12.84 | 4.5:1 | pass |
| dark | muted (--bcm) on chrome panel | 6.05 | 4.5:1 | pass |
| dark | muted (--bcm) on tile | 5.43 | 4.5:1 | pass |
| dark | muted (--bcm) on content | 11.12 | 4.5:1 | pass |
| dark | placeholder (--bcm) on input | 5.36 | 4.5:1 | pass |
| dark | btn-primary label (pc on p) | 6.00 | 4.5:1 | pass |
| dark | btn-neutral label (nc on n) | 5.43 | 4.5:1 | pass |
| dark | badge-info text on its tint | 5.05 | 4.5:1 | pass |
| dark | badge-success text on its tint | 5.25 | 4.5:1 | pass |
| dark | badge-warning text on its tint | 4.66 | 4.5:1 | pass |
| dark | badge-error text on its tint | 5.39 | 4.5:1 | pass |
| dark | badge-primary text on its tint | 5.25 | 4.5:1 | pass |
| dark | btn-secondary / accent text on tint (accent) | 5.33 | 4.5:1 | pass |
| dark | UI: input / checkbox border vs panel | 3.60 | 3:1 | pass |
| dark | UI: focus ring vs chrome panel | 6.44 | 3:1 | pass |
| dark | UI: focus ring vs overlay | 13.70 | 3:1 | pass |
| dark | UI: --ptah-check-edge (bc @70%) vs tile | 3.76 | 3:1 | pass |
| nord | worst backdrop pixel #8fa2b9 (darkest); panel #c5cfdb, tile #d8dfe8, content #e4e9ef |  |  |  |
| nord | text on chrome panel | 7.92 | 4.5:1 | pass |
| nord | text on tile | 9.30 | 4.5:1 | pass |
| nord | text on content / assistant bubble | 10.23 | 4.5:1 | pass |
| nord | text on user bubble | 10.65 | 4.5:1 | pass |
| nord | text on overlay (menu / modal) | 10.07 | 4.5:1 | pass |
| nord | text on selected item | 10.65 | 4.5:1 | pass |
| nord | code ink on code block | 4.62 | 4.5:1 | pass |
| nord | muted (--bcm) on chrome panel | 5.83 | 4.5:1 | pass |
| nord | muted (--bcm) on tile | 6.85 | 4.5:1 | pass |
| nord | muted (--bcm) on content | 7.53 | 4.5:1 | pass |
| nord | placeholder (--bcm) on input | 7.20 | 4.5:1 | pass |
| nord | btn-primary label (pc on p) | 5.04 | 4.5:1 | pass |
| nord | btn-neutral label (nc on n) | 4.55 | 4.5:1 | pass |
| nord | badge-info text on its tint | 5.60 | 4.5:1 | pass |
| nord | badge-success text on its tint | 5.23 | 4.5:1 | pass |
| nord | badge-warning text on its tint | 4.99 | 4.5:1 | pass |
| nord | badge-error text on its tint | 5.97 | 4.5:1 | pass |
| nord | badge-primary text on its tint | 6.02 | 4.5:1 | pass |
| nord | btn-secondary / accent text on tint (accent) | 5.10 | 4.5:1 | pass |
| nord | UI: input / checkbox border vs panel | 3.37 | 3:1 | pass |
| nord | UI: focus ring vs chrome panel | 7.92 | 3:1 | pass |
| nord | UI: focus ring vs overlay | 10.07 | 3:1 | pass |
| nord | UI: --ptah-check-edge (bc @70%) vs tile | 4.24 | 3:1 | pass |
| cupcake | worst backdrop pixel #eec9cd (darkest); panel #f5e4e4, tile #f7eded, content #f9f3f2 |  |  |  |
| cupcake | text on chrome panel | 13.82 | 4.5:1 | pass |
| cupcake | text on tile | 14.79 | 4.5:1 | pass |
| cupcake | text on content / assistant bubble | 15.46 | 4.5:1 | pass |
| cupcake | text on user bubble | 15.81 | 4.5:1 | pass |
| cupcake | text on overlay (menu / modal) | 15.36 | 4.5:1 | pass |
| cupcake | text on selected item | 15.81 | 4.5:1 | pass |
| cupcake | code ink on code block | 8.64 | 4.5:1 | pass |
| cupcake | muted (--bcm) on chrome panel | 8.78 | 4.5:1 | pass |
| cupcake | muted (--bcm) on tile | 9.39 | 4.5:1 | pass |
| cupcake | muted (--bcm) on content | 9.82 | 4.5:1 | pass |
| cupcake | placeholder (--bcm) on input | 9.60 | 4.5:1 | pass |
| cupcake | btn-primary label (pc on p) | 9.49 | 4.5:1 | pass |
| cupcake | btn-neutral label (nc on n) | 8.22 | 4.5:1 | pass |
| cupcake | badge-info text on its tint | 8.39 | 4.5:1 | pass |
| cupcake | badge-success text on its tint | 8.73 | 4.5:1 | pass |
| cupcake | badge-warning text on its tint | 7.82 | 4.5:1 | pass |
| cupcake | badge-error text on its tint | 8.32 | 4.5:1 | pass |
| cupcake | badge-primary text on its tint | 8.06 | 4.5:1 | pass |
| cupcake | btn-secondary / accent text on tint (accent) | 7.84 | 4.5:1 | pass |
| cupcake | UI: input / checkbox border vs panel | 4.80 | 3:1 | pass |
| cupcake | UI: focus ring vs chrome panel | 13.82 | 3:1 | pass |
| cupcake | UI: focus ring vs overlay | 15.36 | 3:1 | pass |
| cupcake | UI: --ptah-check-edge (bc @70%) vs tile | 5.92 | 3:1 | pass |
| dracula | worst backdrop pixel #423b59 (brightest); panel #565268, tile #5e596f, content #323341 |  |  |  |
| dracula | text on chrome panel | 7.03 | 4.5:1 | pass |
| dracula | text on tile | 6.29 | 4.5:1 | pass |
| dracula | text on content / assistant bubble | 11.69 | 4.5:1 | pass |
| dracula | text on user bubble | 14.43 | 4.5:1 | pass |
| dracula | text on overlay (menu / modal) | 13.67 | 4.5:1 | pass |
| dracula | text on selected item | 5.20 | 4.5:1 | pass |
| dracula | code ink on code block | 12.58 | 4.5:1 | pass |
| dracula | muted (--bcm) on chrome panel | 6.61 | 4.5:1 | pass |
| dracula | muted (--bcm) on tile | 5.91 | 4.5:1 | pass |
| dracula | muted (--bcm) on content | 10.99 | 4.5:1 | pass |
| dracula | placeholder (--bcm) on input | 5.85 | 4.5:1 | pass |
| dracula | btn-primary label (pc on p) | 8.29 | 4.5:1 | pass |
| dracula | btn-neutral label (nc on n) | 6.45 | 4.5:1 | pass |
| dracula | badge-info text on its tint | 4.81 | 4.5:1 | pass |
| dracula | badge-success text on its tint | 4.92 | 4.5:1 | pass |
| dracula | badge-warning text on its tint | 4.60 | 4.5:1 | pass |
| dracula | badge-error text on its tint | 5.82 | 4.5:1 | pass |
| dracula | badge-primary text on its tint | 5.43 | 4.5:1 | pass |
| dracula | btn-secondary / accent text on tint (accent) | 5.63 | 4.5:1 | pass |
| dracula | UI: input / checkbox border vs panel | 3.85 | 3:1 | pass |
| dracula | UI: focus ring vs chrome panel | 7.03 | 3:1 | pass |
| dracula | UI: focus ring vs overlay | 13.67 | 3:1 | pass |
| dracula | UI: --ptah-check-edge (bc @70%) vs tile | 4.03 | 3:1 | pass |

## 8. Decisions

- **Gold is action-only in dark.** Options: keep gold selected fills/borders (C), or neutral selected glass with a 3px indicator. Evidence: research 7/10 and the
  user's "old-fashioned" verdict. Chosen: neutral `--bc` selected tint + `oklch(var(--p))` indicator bar. Reversible: one rule (`.menu ... .active`).
- **Scene is generated SVG, not a photo.** No licence, no network, deterministic, ~3KB, and it gives silhouettes (ridges) that stay recognisable after blur.
  Reversible: swap `--glass-scene` for a licensed image.
- **Chat pane = chrome, bubbles/code = near-solid.** The big pane stays glass (it is a persistent static plane; cost is area, not scroll) while text sits on
  stable planes, which is the research rule 5/6 compromise.
- **Under-scrim in dark chrome.** Needed to hold AA with real glow behind the pane; it is a fixed 26% base layer, not a darkened scene.
- **Tone text is mostly ink** (0% tone in dark, 28% in light). Colour is carried by the tinted fill, the 55% border and icons, not by coloured small text,
  because DaisyUI tone colours cannot be guaranteed 4.5:1 on arbitrary glass across 32 themes.
- **Focus ring = `--bc` ink** (gold on the two Ptah themes) with a 28% `--p` halo; works on any theme.
- **Stock `dark` gets an ink override.** Its `--bc` (74.6%) fails on glass; override map is the documented escape.
- **Prototype-only code**: the `--tw-*` transform defaults in `index.html` (full.css has no Tailwind base) and the theme select/glass toggle script.

## 9. Deviations from research

- Dark fill `bc/.13` (not `.16`), brightness `1.06` (not `1.08`), plus a 26% under-scrim: the research numbers assume a dimmer scene than mine; at my brightest pixel they miss 4.5:1.
- Glows are higher chroma but lower luma than the research's gray/amber suggestion (plum, steel-teal, burnt amber at 30-34% opacity) so colour is visible while worst-case luminance stays AA.
- Muted ink in dark is `#dcdee3` (about 90% of ink). A lower muted tier cannot pass at the worst pixel; hierarchy comes from size/weight.
- Radius 22/14/10 px (research) instead of C's 24px; `--rounded-box` remains the theme's own value on the two Ptah themes (1.5rem).
- Selected state uses a 3px `--p` bar rather than a separate gold border; kept as an indicator the research permits ("small gold indicator").
- The masked rim is also applied to `content` surfaces (opacity .8), not only chrome/overlay.
- `mask-composite` was verified only in Playwright's Chromium; the plain glint remains as the fallback if Electron's pinned version lacks it.

## 10. Known limits

- Worst-pixel AA is strict, so the dark scene is calm; showpiece drama would need a text scrim over more of each pane.
- Stock light themes with saturated `--b1` (e.g. `valentine`, `pastel`) were not rendered; theme-by-theme visual review is still required before adding to the glass list.
- `dark` and `dracula` scenes are plain tinted variants of the Ptah smoke recipe, not hand-art.
