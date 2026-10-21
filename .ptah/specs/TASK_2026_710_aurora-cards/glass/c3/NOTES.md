# Ptah Glass v3 (lead designer, round C3)

C2 approved as the base with three changes: (1) a clearly stronger dark backdrop, (2) a primary-accent setting
(`data-accent="gold|violet|teal"`), (3) stock-theme glass stays ON only for dark, nord, cupcake, dracula (black, lofi, wireframe,
cyberpunk opt out; every other stock theme is untested and opts out). Light direction unchanged. Backdrop stays a static SVG.
`glass/c2` is untouched.

Files: `index.html` (prototype; navbar now has Theme select, **Accent swatches**, Glass toggle; `?theme=&accent=&glass=off&modal=1`),
`theme.config.js` (the two Ptah themes, unchanged from C2), `accents.cjs` (accent data, hex), `accent-css.cjs` (turns it into section 8 of the
layer), `_glass-layer.src.css` (hand-edited layer), `registry.cjs`, `build.cjs`, `glass-layer.css` + `theme.css` (GENERATED),
`measure.cjs` (real-pixel contrast, see section 6), `contrast.cjs` + `backdrop-max.cjs` (token-math tables, section 6b), `shoot.cjs`, `shots\`.
Rebuild: `node build.cjs && node backdrop-max.cjs && node contrast.cjs && node shoot.cjs`; real-pixel check: `node measure.cjs` (about 6 min for all six
theme/accent combos; `MODAL=1 node measure.cjs ptah-glass:gold` for the overlay).

## 1. What changed from C2

| Area | C2 | C3 |
| --- | --- | --- |
| Dark glows | opacity .20 to .34, muted hues | opacity .38 to .95, saturated hues (table below). Glass now reads across panels, not only at edges |
| Dark panel under-scrim | `--b1 / .26` | `--b1 / .66` (the stable text plane; needed to hold 4.5:1 under the stronger glows) |
| Dark chrome veil | `--bc / .13` | `--bc / .07` (less white haze so the colour that does come through stays clean) |
| Accent | gold only | `data-accent` gold (default) / violet / teal, both modes, section 8 of the layer |
| btn-primary glow / hover | hard-coded gold | `--g-btn-glow`, `--g-hov-a/b` variables (gold values are the defaults) |
| Focus on filled primary | gold ring + glow behind it | glow dropped while focused, ring offset 3px; ring inside a `.join` is the button's own ink (both were 1.2 to 1.6:1 in the real-pixel check) |
| Measurement | token math at one sampled worst pixel | real rendered pixels, every text run, plus UI parts (section 6) |

### Dark scene (`ptah-glass`), final values

Sky gradient unchanged (`#2b2e34 -> #17191d -> #26292f`), 7% smoke, 3 ridge silhouettes unchanged, glow blur stdDeviation 70.

| Glow | Position (1600x1000 scene) | Colour | Opacity | C2 opacity |
| --- | --- | --- | --- | --- |
| plum, behind sidebar | 150,600 r 320x340 | `#b43fc4` | .85 | .30 (`#9a3f9a`) |
| slate-blue, behind chat | 560,320 r 430x280 | `#8a9bd0` | .38 | .20 (`#9aa6b8`) |
| amber, behind chat/composer | 1000,610 r 380x170 | `#f07a1a` | .70 | .30 (`#d2691e`) |
| teal, behind right pane | 1400,220 r 300x250 | `#14b2d8` | .95 | .34 (`#2b9bb0`) |
| amber, behind right pane lower | 1430,650 r 300x190 | `#f07a1a` | .85 | .32 (`#d2691e`) |

Dark glass tokens that changed: `--glass-under: oklch(var(--b1) / .66)`, `--glass-fill: oklch(var(--bc) / .07)`. All other dark tokens as in C2
(raised `.20`, tile `.045`, selected `.12`, content `--b1 .78`, code `--b1 .90`, overlay `--b2 .88`, blur 16px / overlay 22px, saturate 1.16,
brightness 1.06). These tokens are shared by every dark glass theme, so stock `dark` and `dracula` also get the stronger under-scrim; they re-pass
(section 6b) and their screenshots show no regression.
Light (`ptah-glass-light`) values are unchanged from C2.

## 2. Palette (unchanged from C2; gold = default accent)

| Role | ptah-glass | OKLCH | ptah-glass-light | OKLCH |
| --- | --- | --- | --- | --- |
| primary (gold) | #e4b94a | 80.4% 0.136 87.5 | #7c5700 | 48.4% 0.100 80.0 |
| primary-content | #1b1403 | 19.5% 0.033 88.8 | #fff8e6 | 98.0% 0.025 89.2 |
| secondary | #efd48c | 87.6% 0.096 89.7 | #9a6b12 | 56.3% 0.112 76.7 |
| accent (role) | #45d0be | 77.9% 0.121 182.8 | #0b7f77 | 53.8% 0.092 187.0 |
| neutral | #30343a | 32.4% 0.012 258.4 | #2b2650 | 29.7% 0.074 286.4 |
| base-100 / 200 / 300 | #17191d / #202329 / #2a2e35 | | #f7f3fd / #eee8f8 / #e2daf1 | |
| base-content / `--bcm` | #f2f2f1 / #dcdee3 | | #1e1936 / #5b5379 | |

Every anubis custom key is present in both themes (`--bcm`, `--state-ink-*`, `--ptah-check-edge`, `--rounded-*`, `--animation-*`,
`--btn-focus-scale`, `--border-btn`, `--tab-border`, `--tab-radius`).

## 3. Primary accent tokens

Mechanism: `<html data-theme="ptah-glass" data-accent="violet">`. No attribute (or `gold`) = the gold already in `theme.config.js`. The selectors are
`:root[data-theme='ptah-glass'][data-accent='violet']` etc. (specificity 0,3,0 for the channels, 0,4,0 for the glass variables), so they only exist for the
two Ptah themes: stock themes, even with `data-accent` set, are untouched (checked in the dracula, nord, cupcake, lofi shots, all rendered with `accent=violet`).
Section 8 of `glass-layer.css` is generated from `accents.cjs`; the channel variables are OKLCH (`--p: L% C H`), the format DaisyUI 4.12 uses.

Per accent and mode, what is overridden: `--p`, `--pf`, `--pc` (DaisyUI primary / primary-focus / primary-content, so `btn-primary` outline, `toggle/checkbox/radio` checked,
`progress-primary`, `badge/alert-primary`, `::selection`, input focus halo, `--glass-accent`), plus the layer variables `--g-ptah-focus` (focus ring),
`--g-ptah-link` (links, brand heading), `--g-ptah-gold` (the `--ptah-gold` chip), `--g-gold-a/b/ink` (filled button + progress gradient and its label ink),
`--g-hov-a/b` (hover gradient), `--g-btn-glow` (button drop-glow colour). Secondary (champagne) and accent (Nile teal) roles are NOT changed, see open issue 2.

| Mode | Accent | `--p` hex | `--p` OKLCH | `--pc` | focus | link | button gradient a / b | ink |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dark | gold (default) | #e4b94a | 80.4% 0.136 87.5 | #1b1403 | #f2cd6b | #f0cf7a | #f6d675 / #d9a928 | #1b1403 |
| dark | violet | #b9a2ff | 76.8% 0.132 294.5 | #150c33 | #e0d5ff | #d9ccff | #cdbcff / #a68aff | #150c33 |
| dark | teal | #35c8d0 | 76.2% 0.119 200.5 | #031a1f | #9aeaf0 | #7fe3ea | #6fdde6 / #2fb9c6 | #031a1f |
| light | gold (default) | #7c5700 | 48.4% 0.100 80.0 | #fff8e6 | #7a5300 | #7a5300 | #f6d675 / #dfac33 | #241a02 |
| light | violet | #5b3fc4 | 48.0% 0.196 286.1 | #f6f2ff | #4a31a6 | #4a31a6 | #c9b8ff / #a88cf7 | #1a0f45 |
| light | teal | #0a6b73 | 48.2% 0.080 204.1 | #effeff | #07545b | #07545b | #7fe0e6 / #35bfcb | #02262b |

Hue rationale: violet sits at hue 294 and teal at 200 (the Nile-teal accent role is 183, so teal primary stays separable); neither is blue-lapis, so the charcoal-smoke
dark does not drift toward the rejected navy. Light keeps the "deep ink for text, bright gradient for the button" split that gold already uses.

### Accent contrast (WCAG 2.2 AA; real rendered pixels, worst case in the whole prototype page, all scroll positions)

| Mode | Accent | btn-primary label (worst end of gradient) | links on the glass (`Manage providers`, `Read the docs`) | brand heading `Ptah` | focus ring vs surround | checked control vs surround | `pc` on `p` (`.btn-primary.btn-outline` etc.) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dark | gold | 8.41 (grad. end), real pixels 9.37 to 9.73 | 9.68 to 10.05 | 7.09 | 5.43 | 3.55 (sm checkbox on the teal-lit right pane) | 8.41 |
| dark | violet | 6.80 (grad. end), real pixels 7.62 to 7.93 | 8.57 to 10.13 | 7.09 | 5.43 | 3.03 (sm checkbox, same spot); other controls 3.56 to 6.99 | 8.54 |
| dark | teal | 7.58 (grad. end), real pixels 8.38 to 8.66 | 9.79 to 10.17 | 7.09 | 5.45 | 3.24 (sm checkbox); other controls 3.80 to 7.46 | 8.81 |
| light | gold | 8.24 (grad. end), real pixels 9.05 to 9.39 | 5.89 to 5.94 | 4.80 | 4.33 | 5.36 | 6.16 |
| light | violet | 6.48 (grad. end), real pixels 7.20 to 7.43 | 7.98 | 5.73 | 5.67 | 5.84 | 6.46 |
| light | teal | 7.20 (grad. end), real pixels 7.27 to 8.16 | 7.50 | 5.73 | 5.13 | 5.13 | 6.03 |

Thresholds: text 4.5:1, UI parts 3:1. Overlay (modal) re-measured with `MODAL=1`: dark gold 8.86 min, dark violet 7.64, light gold 5.26, light teal 5.26 (text 4.5:1), no failures.
The closest margin is the dark small checkbox filled violet on the teal-lit right pane (3.03:1 against its surround; its check mark inside is `--pc`, 8.5:1).
Token-math backup for the dark link on the brightest teal panel (#2a5b69): gold 4.97, violet 5.01 (after lifting the link to #d9ccff; the first pick #cdbdff gave 4.40), teal 5.03.

## 4. Theme-agnostic layer: contract and override map

```
<html data-theme="nord" data-glass="on" data-glass-mode="light">          stock theme, glass on
<html data-theme="ptah-glass" data-glass="on" data-glass-mode="dark" data-accent="violet">
```
- Base/ink/accent derive from `--b1 --b2 --b3 --bc --p` (+ `--n --nc --in --su --wa --er` for tones). v4 channel vars only.
- Opt-out = omit `data-glass` (`lofi` in the prototype: plain DaisyUI, zero leftovers). Opt-in stock themes: `dark nord cupcake dracula`. Opt-out: `black lofi wireframe cyberpunk`
  and every untested theme (in `DAISYUI_THEMES`: `glass` unset).
- Surface roles are attributes: `chrome` (blur, floating), `overlay` (blur, near-opaque), `content` (stable fill), `tile` (fill + hairline).
  `.modal-box` and `.dropdown-content` are overlays by class. The old blanket `.card` and `.surface-3` rules are gone.
- Per-theme data = `--glass-scene` only (generated), plus an optional ink override (only stock `dark`: `--bc: 95% 0.012 250`).
- Escape hatches: `prefers-reduced-transparency` / `prefers-contrast: more` (solid fills, no blur, 1px ink border, 3px focus ring), `forced-colors: active`
  (system colours), `@supports not (backdrop-filter)` (92 to 98% fills), `prefers-reduced-motion` (transitions zeroed; the backdrop is static).
  The accent works in all of them because it only changes `--p` and the `--g-*` colour variables.

## 5. Surface-role mapping for the real app (unchanged from C2)

| Role | Angular component / element | Notes |
| --- | --- | --- |
| chrome | `ptah-electron-shell` sidebar column (`ptah-sidebar-tab` host / session list pane), shell header / `ptah-command-center-header`, `ptah-chat-view` pane, right docked pane (`ptah-docked-inspector`), `ptah-chat-input` outer composer bar | 2 to 4 visible at once; one per major pane |
| overlay | `.modal-box` (`ptah-confirmation-modal`, `ptah-dialog-host`, `ptah-add-cli-instance-modal`, ...), `.dropdown-content` (`ptah-dropdown`, branch picker, model/effort popovers) | automatic by class; one open at a time |
| content | settings and marketplace cards, `ptah-command-center-start` panels, Components-style cards, `ptah-message-bubble` (assistant) body | no blur; stable reading plane |
| tile | `ptah-project-setup-card` (`<section>` replaces `.surface-3`), `ptah-prompt-suggestions` list, stat tiles (`ptah-command-session-stats`, `ptah-inspector-session-stats`), `ptah-tool-call-item`, `ptah-execution-node`, nested composer field | fill + hairline only |
| none (component rules) | `.chat-bubble`, `.mockup-code` / code blocks, `.table`, `.alert`, `.collapse`, `.stats`, `.badge`, `.btn`, `.menu` rows | near-solid or fill-only; never blurred |

## 6. Contrast, measured

### 6a. Real-pixel method (`measure.cjs`), the figure of record

For each theme and accent the prototype is rendered at 1440x900 and scrolled in 800px steps. For every text run the script reads the run's computed colour, then renders the
page again with all text made transparent and takes the WORST pixel under the glyph box (the badge/button's own border is excluded; disabled controls are exempt) against that colour,
so panel scrim, blur, tint, grain, button gradients and the live backdrop are all in the measurement. UI parts: checked toggles/checkboxes/radios against the pixels 3 to 6px
outside them, focus rings against the pixels 1 to 2px beyond the ring in a screenshot taken while focused (12th percentile of the surround so a neighbouring control does not
dominate; the inset ring inside a `.join` is measured on the button's own fill).

| Theme / accent | Text runs | Lowest text ratio | Fails | Lowest UI ratio | Where the minimum is |
| --- | --- | --- | --- | --- | --- |
| ptah-glass / gold | 289 | 4.60 | 0 | 3.55 | `+$0.06 last turn` (muted ink on the teal-lit right pane) |
| ptah-glass / violet | 289 | 4.60 | 0 | 3.03 | same text; sm checkbox |
| ptah-glass / teal | 289 | 4.60 | 0 | 3.24 | same text; sm checkbox |
| ptah-glass-light / gold | 289 | 4.51 | 0 | 4.33 | `// 401 contract unchanged` (code comment on the indigo code block) |
| ptah-glass-light / violet | 289 | 4.51 | 0 | 5.67 | same |
| ptah-glass-light / teal | 289 | 4.51 | 0 | 5.13 | same |

The dark minimum (4.60) is the muted `--bcm` ink in the right pane directly over the strongest teal glow: that pane is what sets the 0.66 under-scrim. With C2's `.26` under-scrim and the new glows the same run measured 2.1:1, so the raise in panel opacity is required, not decorative.

### 6b. Token-math tables (`contrast.cjs`, theme tokens at the brightest/darkest backdrop pixel; kept for the stock themes)

23 pass / 0 fail for each of ptah-glass, ptah-glass-light, dark, nord, cupcake, dracula.

| Theme | Pair | Ratio | Needs | Result |
| --- | --- | --- | --- | --- |
| ptah-glass | worst backdrop pixel #20aed1 (brightest); panel #2a5b69, tile #33616f, content #1b272e |  |  |  |
| ptah-glass | text on chrome panel | 6.70 | 4.5:1 | pass |
| ptah-glass | text on tile | 6.09 | 4.5:1 | pass |
| ptah-glass | text on content / assistant bubble | 13.62 | 4.5:1 | pass |
| ptah-glass | text on user bubble | 11.62 | 4.5:1 | pass |
| ptah-glass | text on overlay (menu / modal) | 11.57 | 4.5:1 | pass |
| ptah-glass | text on selected item | 5.07 | 4.5:1 | pass |
| ptah-glass | code ink on code block | 14.71 | 4.5:1 | pass |
| ptah-glass | muted (--bcm) on chrome panel | 5.57 | 4.5:1 | pass |
| ptah-glass | muted (--bcm) on tile | 5.06 | 4.5:1 | pass |
| ptah-glass | muted (--bcm) on content | 11.34 | 4.5:1 | pass |
| ptah-glass | placeholder (--bcm) on input | 4.99 | 4.5:1 | pass |
| ptah-glass | btn-primary label (pc on p) [gold gradient ink, worst end] | 8.41 | 4.5:1 | pass |
| ptah-glass | btn-neutral label (nc on n) | 9.74 | 4.5:1 | pass |
| ptah-glass | badge-info text on its tint | 5.18 | 4.5:1 | pass |
| ptah-glass | badge-success text on its tint | 4.98 | 4.5:1 | pass |
| ptah-glass | badge-warning text on its tint | 5.21 | 4.5:1 | pass |
| ptah-glass | badge-error text on its tint | 5.61 | 4.5:1 | pass |
| ptah-glass | badge-primary text on its tint | 5.00 | 4.5:1 | pass |
| ptah-glass | btn-secondary / accent text on tint (accent) | 5.48 | 4.5:1 | pass |
| ptah-glass | UI: input / checkbox border vs panel | 3.65 | 3:1 | pass |
| ptah-glass | UI: focus ring vs chrome panel | 4.90 | 3:1 | pass |
| ptah-glass | UI: focus ring vs overlay | 8.47 | 3:1 | pass |
| ptah-glass | UI: --ptah-check-edge (bc @70%) vs tile | 3.92 | 3:1 | pass |
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
| dark | worst backdrop pixel #3c454d (brightest); panel #363d45, tile #3e454d, content #232930 |  |  |  |
| dark | text on chrome panel | 9.50 | 4.5:1 | pass |
| dark | text on tile | 8.39 | 4.5:1 | pass |
| dark | text on content / assistant bubble | 12.68 | 4.5:1 | pass |
| dark | text on user bubble | 14.79 | 4.5:1 | pass |
| dark | text on overlay (menu / modal) | 13.70 | 4.5:1 | pass |
| dark | text on selected item | 6.74 | 4.5:1 | pass |
| dark | code ink on code block | 13.18 | 4.5:1 | pass |
| dark | muted (--bcm) on chrome panel | 8.92 | 4.5:1 | pass |
| dark | muted (--bcm) on tile | 7.87 | 4.5:1 | pass |
| dark | muted (--bcm) on content | 11.90 | 4.5:1 | pass |
| dark | placeholder (--bcm) on input | 7.75 | 4.5:1 | pass |
| dark | btn-primary label (pc on p) | 6.00 | 4.5:1 | pass |
| dark | btn-neutral label (nc on n) | 5.67 | 4.5:1 | pass |
| dark | badge-info text on its tint | 6.85 | 4.5:1 | pass |
| dark | badge-success text on its tint | 7.22 | 4.5:1 | pass |
| dark | badge-warning text on its tint | 6.40 | 4.5:1 | pass |
| dark | badge-error text on its tint | 7.35 | 4.5:1 | pass |
| dark | badge-primary text on its tint | 7.14 | 4.5:1 | pass |
| dark | btn-secondary / accent text on tint (accent) | 7.48 | 4.5:1 | pass |
| dark | UI: input / checkbox border vs panel | 4.79 | 3:1 | pass |
| dark | UI: focus ring vs chrome panel | 9.50 | 3:1 | pass |
| dark | UI: focus ring vs overlay | 13.70 | 3:1 | pass |
| dark | UI: --ptah-check-edge (bc @70%) vs tile | 5.08 | 3:1 | pass |
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
| dracula | worst backdrop pixel #423b59 (brightest); panel #403f50, tile #484757, content #2d2f3c |  |  |  |
| dracula | text on chrome panel | 9.63 | 4.5:1 | pass |
| dracula | text on tile | 8.51 | 4.5:1 | pass |
| dracula | text on content / assistant bubble | 12.44 | 4.5:1 | pass |
| dracula | text on user bubble | 14.67 | 4.5:1 | pass |
| dracula | text on overlay (menu / modal) | 13.67 | 4.5:1 | pass |
| dracula | text on selected item | 6.85 | 4.5:1 | pass |
| dracula | code ink on code block | 12.98 | 4.5:1 | pass |
| dracula | muted (--bcm) on chrome panel | 9.06 | 4.5:1 | pass |
| dracula | muted (--bcm) on tile | 8.00 | 4.5:1 | pass |
| dracula | muted (--bcm) on content | 11.70 | 4.5:1 | pass |
| dracula | placeholder (--bcm) on input | 7.88 | 4.5:1 | pass |
| dracula | btn-primary label (pc on p) | 8.29 | 4.5:1 | pass |
| dracula | btn-neutral label (nc on n) | 6.67 | 4.5:1 | pass |
| dracula | badge-info text on its tint | 6.19 | 4.5:1 | pass |
| dracula | badge-success text on its tint | 6.33 | 4.5:1 | pass |
| dracula | badge-warning text on its tint | 5.91 | 4.5:1 | pass |
| dracula | badge-error text on its tint | 7.55 | 4.5:1 | pass |
| dracula | badge-primary text on its tint | 7.02 | 4.5:1 | pass |
| dracula | btn-secondary / accent text on tint (accent) | 7.44 | 4.5:1 | pass |
| dracula | UI: input / checkbox border vs panel | 4.85 | 3:1 | pass |
| dracula | UI: focus ring vs chrome panel | 9.63 | 3:1 | pass |
| dracula | UI: focus ring vs overlay | 13.67 | 3:1 | pass |
| dracula | UI: --ptah-check-edge (bc @70%) vs tile | 5.15 | 3:1 | pass |

## 7. Blur budget (unchanged)

Visible at once in the shell: 4 static `chrome` planes at 16px, plus at most one `overlay` (22px); composer, tool calls, bubbles, code, tables, menu rows, tooltips, badges and
buttons never blur. The backdrop is one static fixed pseudo-element (SVG rasterised once; no animation, no `will-change`). The stronger glows add no cost (same SVG, same layers).
Not profiled on hardware: validate with DevTools Performance during transcript scroll.

## 8. Integration edits

1. `apps/ptah-extension-webview/tailwind.config.js`: add `{ 'ptah-glass': {...} }` and `{ 'ptah-glass-light': {...} }` from `theme.config.js` to `daisyui.themes` (after `anubis-light`);
   to make glass the default also set `darkTheme: 'ptah-glass'` and `themeRoot: '[data-theme=ptah-glass]'`. The accent needs no Tailwind change (it is plain CSS in `styles.css`; DaisyUI
   utilities such as `bg-primary` read `--p`, so they follow the accent automatically).
2. `libs/frontend/core/src/lib/services/theme.service.ts`:
   - Themes: add `ptah-glass`, `ptah-glass-light` to `ThemeName`; extend `ThemeInfo` with `glass?: boolean`; prepend `{ name: 'ptah-glass', label: 'Ptah Glass', isDark: true, glass: true }` and
     `{ name: 'ptah-glass-light', label: 'Ptah Glass Light', isDark: false, glass: true }`; `glass: true` also on `dark`, `nord`, `cupcake`, `dracula`; no flag on `black lofi wireframe cyberpunk`
     or any untested theme. `EAGER_THEMES` gains the two Ptah themes. Default theme `ptah-glass`.
   - Glass attributes: in the existing `effect()` that writes `data-theme` / `data-theme-mode`, also write `data-glass="on"` + `data-glass-mode` (`dark|light` from `isDark`) when `info.glass`, otherwise remove both.
   - **Accent**: `export type AccentName = 'gold' | 'violet' | 'teal'`, `const ACCENTS: readonly AccentName[]`, `const DEFAULT_ACCENT: AccentName = 'gold'`,
     `private readonly _accent = signal<AccentName>(DEFAULT_ACCENT)`, `readonly accent = this._accent.asReadonly()`, `setAccent(a: AccentName)`.
     Storage: authoritative `vscode.setState('ptah-accent', a)` (new `ACCENT_STATE_KEY = 'ptah-accent'`) with the same `localStorage` mirror pattern as the theme (`ACCENT_HINT_KEY = 'ptah-accent'`,
     `writeAccentHint`/`readAccentHint`, best effort). Restore in the same init path as the theme (state, then hint, else gold); reject unknown values (`isValidAccent`).
     DOM: in an `effect()` (or the same one) set `document.documentElement.setAttribute('data-accent', a)` for `violet|teal` and `removeAttribute('data-accent')` for `gold` (gold = no attribute = the theme file's own primary).
     The attribute may stay set while a stock theme is active: the CSS only matches the two Ptah themes, so there is no visible effect and the choice survives a switch back.
   - `index.html` pre-paint script: besides `localStorage['ptah-theme']` also read `localStorage['ptah-accent']` and, for `violet|teal`, set `data-accent` on `<html>` before first paint.
     Hardcode the default shell: `<html data-theme="ptah-glass" data-theme-mode="dark" data-glass="on" data-glass-mode="dark">`.
3. `apps/ptah-extension-webview/src/styles.css`: paste `glass-layer.css` inside one `@layer components { ... }` block after the semantic-surface block. It already contains section 8 (accents, about 3KB),
   so no separate accent file is needed; `accents.cjs`/`accent-css.cjs` are build-time helpers only. The app ships only the scenes of themes that opt in (the prototype generates six data-URIs of ~3KB).
   `.surface-3` etc. keep their definitions; anubis keeps working.
4. Templates: add `data-glass-surface="chrome|content|tile"` to the elements in section 5 (attribute only). Make `ptah-aurora-effect` and any opaque shell `bg-base-*` wrapper conditional
   (`:root[data-glass='on'] .bg-base-100` is already transparent).

## 9. Theme picker UI (accent swatches)

Where: wherever the app's existing theme select lives (settings / appearance). Show the accent control only when the active theme is `ptah-glass` or `ptah-glass-light`; for any other
theme either hide it or show it disabled with the title "Accent applies to the Ptah glass themes only" (the prototype does the latter).
Control: a `role="radiogroup"` (a `<fieldset>` with a `<legend>`, as in the prototype) of three 22px round swatches, native radios visually hidden over the swatch so keyboard (arrow keys, Tab into the group)
and screen readers work. Swatch fill is the button gradient from the table in section 3 (gold `#f6d675 -> #d9a928`, violet `#cdbcff -> #8f72f0`, teal `#6fdde6 -> #2fb9c6`); checked state is a 2px base-colour gap plus a
2px `--bc` ring (never colour alone); focus-visible uses `--glass-focus`. Each radio has an `aria-label` (Gold, Violet, Teal) and a `title`. Selecting writes through `ThemeService.setAccent` and applies at once with no reload.
Do not add accent previews of the whole UI; the swatches are the preview.

## 10. Guard specs the accent needs

1. `accent-contrast.spec.ts` (next to `state-ink-contrast.spec.ts`): for each (`ptah-glass`, `ptah-glass-light`) x (gold, violet, teal) read the accent hex values from one shared constant (the same object `accents.cjs` mirrors)
   and assert: `--pc` on `--p` >= 4.5; button ink on both gradient ends >= 4.5; link on the worst panel of that mode (`#2a5b69` dark / `#e4dafa` light, the worst rendered pixels measured here) >= 4.5; focus colour on the same panel >= 3.
2. `accent-css.spec.ts`: the generated/pasted accent section defines, for each of the six combinations, `--p --pf --pc` in OKLCH channel format (regex `^\d+(\.\d+)?% \d*\.?\d+ \d+(\.\d+)?$`) and every `--g-*` variable listed in section 3; no `data-accent` selector
   lacks a `data-theme='ptah-glass...'` qualifier (guards "accent leaks into stock themes").
3. `theme.service.spec.ts` additions: default accent is gold and removes the attribute; `setAccent('violet')` writes `data-accent`, `vscode.setState('ptah-accent', ...)` and the localStorage hint; invalid stored values fall back to gold;
   switching to a stock theme keeps the stored accent but the service still sets `data-glass` correctly.
4. `theme-boot-lists.spec.ts` (exists): extend with the accent list so the boot script's `violet|teal` set equals `ACCENTS` minus gold.
5. Extend `state-ink-contrast.spec.ts` to the two new Ptah themes (the `--state-ink-*` keys are present in both).
6. Optional visual guard (Playwright, Electron): the real-pixel `measure.cjs` logic ported to the Electron webview for `ptah-glass` x 3 accents, run on demand, not in CI by default.

## 11. Deviations and open points

- Deviation from the research recipe: dark under-scrim 0.66 instead of 0.26 and veil 0.07 instead of 0.13, forced by the user's decision for stronger glows plus 4.5:1; the visual cost is that the colour
  inside a panel is a tint of the glow, not the glow itself (it still shows strongly at pane edges and in the gaps between panes).
- Open 1: which accent ships as default. Gold stays (brand, no attribute).
- Open 2: secondary (champagne `#efd48c` / `#9a6b12`) and the accent role (Nile teal) are not accent-aware, so in violet mode the secondary-key chips (e.g. selected category pill) stay champagne
  and in teal mode primary and the accent role are both teal. Making them follow is a small addition (two more variables) but it changes more of the UI; not done without a decision.
- Open 3: prototype-only chrome (accent swatches, Theme select, Glass toggle) is not production UI; the real picker location is up to the settings screen owner.
