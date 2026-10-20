# Ptah glass — DaisyUI 4 theme pair (prototype A)

Files: `theme.config.js` (paste into `daisyui.themes`), `glass-layer.css` (moves into `styles.css` unchanged), `theme.css` (compiled-equivalent vars so the prototype renders without Tailwind), `index.html` (open it; toggle Dark/Light, or `index.html#light`).

## Palette (hex → OKLCH `L% C H`)

| Role | `ptah-glass` (dark) | `ptah-glass-light` |
|---|---|---|
| primary (gold) | `#e8be4f` 81.8% .136 88 | `#e3a92a` 77.0% .148 82 |
| secondary (teal) | `#2dc4b2` 74.1% .123 183 | `#0b6b63` 47.6% .081 186 |
| accent (lapis) | `#8fb0ff` 76.4% .120 266 | `#3f52c9` 49.6% .185 271 |
| neutral | `#1a2340` 26.4% .056 269 | `#2a2540` 28.3% .049 291 |
| base-100 / 200 / 300 | `#0a1024` / `#111a36` / `#1a2549` | `#fcfaff` / `#f4effc` / `#e8e0f5` |
| base-content | `#eef1fa` 95.8% .013 271 | `#1f1a30` 23.5% .042 293 |
| `--bcm` (muted text) | `#c4c8d4` 83.4% .017 271 | `#595569` 46.1% .031 293 |
| info / success / warning / error | `#5aa9ff` / `#34d399` / `#fb923c` / `#f87171` | `#2670c4` / `#15803d` / `#b84d06` / `#c7273a` |

All `-content` and `-focus` values are in `theme.config.js`. Every custom key of `anubis` / `anubis-light` is kept: `--bcm`, `--state-ink-run|need|err|done|idle`, `--ptah-check-edge`, `--rounded-box|btn|badge`, `--animation-btn|input`, `--btn-focus-scale`, `--border-btn`, `--tab-border`, `--tab-radius`. Values changed for glass: radii (24px box, pill btn/badge/tab), 1px borders, brighter `--state-ink-*` on dark.

Backdrop stops (the worst case for contrast): dark `#17707c` teal, `#2a4fb0` lapis, `#8f6d1c` gold over `#070c1d→#0b1026`; light `#b9a9ee` lavender, `#a9c3f2` blue, `#f2b896` peach over `#d9d0f7→#f7d4bd`.

## Contrast (WCAG 2.x, computed with culori)

Text is composited over the **worst** of the three backdrop peaks (min of the three shown), including the card sheen. Card = dark `rgb(11 19 48/.66)` + 6% white sheen; light `rgb(255 255 255/.70)`. Menu/modal/dropdown = dark `.86`, light `.88`.

| Pair | Surface | Ratio | Need |
|---|---|---|---|
| dark body text `#eef1fa` | card | 9.33 | 4.5 |
| dark muted `#c4c8d4` | card | 6.30 | 4.5 |
| dark gold text `#e8be4f` | card | 5.97 | 4.5 |
| dark teal text `#2dc4b2` | card | 4.84 | 4.5 |
| dark lapis text `#8fb0ff` | card | 4.93 | 4.5 |
| dark text / muted / gold / teal / lapis | menu, modal | 12.44 / 8.40 / 7.96 / 6.45 / 6.57 | 4.5 |
| light body `#1f1a30` | card | 13.70 | 4.5 |
| light muted `#595569` | card | 5.84 | 4.5 |
| light teal `#0b6b63` / lapis `#3f52c9` / dark-gold `#7a5200` | card | 5.19 / 5.25 / 5.64 | 4.5 |
| light text / muted / teal / lapis / gold | menu, modal | 15.52 / 6.62 / 5.88 / 5.94 / 6.39 | 4.5 |
| solid buttons, dark: p / s / a / error / success / warning / info | content on fill | 10.35 / 7.86 / 7.36 / 6.74 / 8.68 / 7.87 / 7.50 | 4.5 |
| solid buttons, light: p / s / a / error / success / warning / info | content on fill | 7.80 / 5.34 / 6.44 / 5.56 / 5.02 / 5.12 / 5.00 | 4.5 |

UI edges: decorative card hairlines are ~2.7:1 (not required). Inputs / selects / outline buttons / toggles use `--g-edge-strong` (dark white 46%, light ink 55%). Measured 2.74:1 at 38% white and 2.68:1 at 45% ink, so these stronger alphas are chosen to clear 3:1 but **were not re-measured** — verify with axe before shipping. Focus ring: 2px, gold (dark) / lapis (light), offset 2px, both ≥ 3:1 on their glass.
Known gap: nested glass (`.card .card`) adds ~5% white on dark, costing ≈0.3 ratio on muted text (≈6.0, still passes). Daisy utilities like `text-base-content/60` are not remapped; use `--bcm` / `.text-base-content-muted`.

## Blur budget (Electron)

| Tier | Elements | Filter | Concurrent on a typical screen |
|---|---|---|---|
| A: big static | sidebar, navbar, `.card` (top-level only) | `blur(16px) saturate(1.3)` dark / `blur(18px) saturate(1.5)` light | ≤ 5 (sidebar, navbar, ≤ 3 cards) |
| B: transient | `.modal-box`, `.dropdown-content` | same | 1–2 |
| C: small | tooltip | `blur(10px)` | 1 |
| none | chat bubbles, tables, collapse, alert, inputs, buttons, badges, menu rows, tabs, nested cards, modal overlay, `bg-base-*` fills | fill + edge only | unbounded |

Total ≤ ~7 simultaneous backdrop-filters; none inside scrolling message lists. The backdrop is one static `position:fixed` pseudo-element of gradients (no animated blur, no images, no filters). Nested glass never re-blurs. `.glass-flat` opts any element out, `.glass-blur` opts one in. Fallbacks: `prefers-reduced-transparency` (opaque fills, `--g-bf:none`, flat backdrop), `@supports not (backdrop-filter)` (fills .9+), `prefers-reduced-motion` (transitions/animations off).

## Integration steps

1. `apps/ptah-extension-webview/tailwind.config.js`: add the two objects from `glass/a/theme.config.js` to `daisyui.themes` (`...require('./path/theme.config.js')` or paste). Reorder so `ptah-glass` is first if it should be the DaisyUI default for `prefersdark`/default; keep `anubis`/`anubis-light`.
2. `apps/ptah-extension-webview/src/styles.css`: append the contents of `glass-layer.css` (plain CSS, no nesting). Remove/neutralise opaque `bg-base-100` on the app root and body (the layer clears `body.bg-base-100`; an `app-root` wrapper needs the same).
3. `libs/frontend/core/src/lib/services/theme.service.ts`: add `'ptah-glass'`, `'ptah-glass-light'` to `DAISYUI_THEMES` and `EAGER_THEMES`; change the default from `anubis` to `ptah-glass`; map light/dark pairing if the service has one (`ptah-glass` ↔ `ptah-glass-light`). Make sure it sets `data-theme` on `<html>`.
4. Update the pre-paint theme script in `apps/ptah-extension-webview/src/index.html` so a persisted `ptah-glass*` theme is not treated as a deferred stock theme.
5. Replace per-component `:host-context([data-theme='anubis-light'])` hacks for glass (e.g. `project-setup-card`) by the shared `.card` rules; `surface-3`/`--elev-shadow` utilities should fall back to `--g-card`.
6. VS Code webview note: backdrop-filter works, but the VS Code workbench behind it is opaque, so the backdrop is the page's own gradient — nothing extra needed.

## Decisions

- **Glass cannot live in a theme**: theme = colours + radii; translucency/blur = scoped CSS using theme channel vars with explicit alpha.
- **Roles remapped**: gold = `primary` (the brand accent the user asked for), teal = `secondary`, lapis = `accent`. Anubis used blue primary + gold secondary; app code keyed on `text-secondary` for gold will turn teal — audit those (`text-secondary-focus` in the setup card renders teal here).
- **Dark fills darker, not lighter**: dark glass is `#0b1330` at .66 (smoky) instead of white-tint, to keep ≥ 4.8:1 for every text colour over the brightest aurora.
- **Light accent = lapis, not purple**: Ptah-compatible and 5+:1; light text colours are deepened (teal `#0b6b63`, warning `#b84d06`) because pastel backdrops dim contrast.
- **Warning is true orange in both themes** (as anubis) so it never reads as brand gold.
- **No blur on lists**: bubbles/tables/collapse use `--g-flat` fill; only large static chrome blurs.
- **Modal overlay is a dim, not a blur**.
- **Static backdrop** via `html::before` (z-index -1) rather than a body background, so it survives `bg-base-100` removal and costs one layer.
- Prototype is hand-compiled: `theme.css` was generated from the same hex values by culori, so it equals what DaisyUI would emit (minor: DaisyUI adds `--tw-*`/`--pf` derivations identical in intent).
- Not done: no Tailwind build was run, nothing screenshotted, edge-alpha 3:1 not re-measured.
