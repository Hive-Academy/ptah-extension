# Ptah glass theme pair

Open `index.html` directly in a browser with the repository's `node_modules` present. The prototype loads only the local DaisyUI 4 `full.css`, `theme.css`, and `glass-layer.css`; the theme switch changes the root `data-theme` attribute. `theme.css` is a static stand-in for DaisyUI's generated channel variables. The two theme objects in `theme.config.js` are the source values to integrate.

## Palette

Hex colors are the theme object's solid colors. OKLCH values are the channels used by the prototype and rounded to four chroma decimals; DaisyUI can regenerate them from the hex values.

| Token | `ptah-glass` hex / OKLCH | `ptah-glass-light` hex / OKLCH |
| --- | --- | --- |
| Primary | `#45C8C1` / `76.069% 0.1126 189.96` | `#51449A` / `44.638% 0.1350 286.50` |
| Secondary | `#D8B65B` / `78.800% 0.1169 89.06` | `#79501B` / `46.679% 0.0868 69.18` |
| Accent | `#F2CE78` / `86.432% 0.1128 87.31` | `#65449B` / `46.662% 0.1371 298.44` |
| Base 100 | `#182536` / `26.117% 0.0369 255.45` | `#FCFAFF` / `98.804% 0.0069 304.24` |
| Base 200 | `#1D2B3D` / `28.527% 0.0384 255.06` | `#F1ECF9` / `95.073% 0.0181 303.41` |
| Base 300 | `#29394B` / `33.873% 0.0382 251.87` | `#E7DFF0` / `91.496% 0.0244 306.95` |
| Base content | `#F5F6F3` / `97.155% 0.0041 121.56` | `#28243B` / `27.589% 0.0422 291.36` |
| Muted content | `--bcm: 81% 0.015 215` | `--bcm: 43% 0.035 290` |

## Contrast

WCAG 2.2 relative-luminance ratios were computed in sRGB after alpha compositing. For a conservative light-area sample, the dark palette uses the bright teal aurora stop `#256e6b`; the light palette uses pale lavender `#e5e6fa`. The large glass fill is `91%` dark / `90%` light; the small surface fill is `86%` dark / `85%` light. These samples produce large surfaces `#152735` / `#fcfaff` and row surfaces `#1d3443` / `#f9f6fe`. The line ratios include its actual alpha (`45%` dark / `62%` light), rather than comparing the opaque line token.

| Pair | Dark | Light | Requirement |
| --- | ---: | ---: | ---: |
| Body text on large glass | 14.09:1 | 14.40:1 | 4.5:1 |
| Muted text on large glass | 8.51:1 | 7.89:1 | 4.5:1 |
| Body text on row fill | 11.85:1 | 13.98:1 | 4.5:1 |
| Muted text on row fill | 7.16:1 | 7.66:1 | 4.5:1 |
| Control border on large glass | 4.04:1 | 3.18:1 | 3:1 |
| Control border on row fill | 3.73:1 | 3.13:1 | 3:1 |
| Focus ring on large glass | 10.10:1 | 7.66:1 | 3:1 |
| Primary button text on fill | 7.33:1 | 7.94:1 | 4.5:1 |
| Secondary button text on fill | 8.33:1 | 7.06:1 | 4.5:1 |
| Accent button text on fill | 10.68:1 | 7.36:1 | 4.5:1 |

The solid semantic pairs are also dark-on-light in the dark palette, and dark-on-pale or white-on-deep in the light palette. A final integration pass should measure browser-rendered controls and hover states in the actual host, where existing app-specific selectors can affect the result.

## Blur budget

The aurora is four **static CSS gradients** on the root, with no animation, image download, or backdrop bitmap. A large shell receives translucent pigment but no blur. Bounded cards, sidebar, navbar, menus, dropdowns, modal boxes, alerts, and tool-call collapse use a single `8px` backdrop blur. Tables, rows, badges, inputs, and chat bubbles get pigment with **zero per-item blur**. This keeps scroll-heavy lists from allocating one filter surface per item. `prefers-reduced-transparency: reduce` swaps in opaque fills and disables filters; `prefers-reduced-motion: reduce` removes transitions and animation.

## Integration steps

1. In `apps/ptah-extension-webview/tailwind.config.js`, copy both entries from `theme.config.js` into the existing object inside `daisyui.themes`. Keep `anubis` and `anubis-light` available for existing user selections. Set `darkTheme: 'ptah-glass'` and `themeRoot: '[data-theme=ptah-glass]'`. Do not add the 32 built-in theme names to this eager array.
2. In `libs/frontend/core/src/lib/services/theme.service.ts`, extend `ThemeName` and `DAISYUI_THEMES` with both names and their dark/light flags. Add both to `EAGER_THEMES`. Change the initial `_currentTheme` and no-persisted-theme fallback to `ptah-glass`; map light VS Code theme fallback to `ptah-glass-light`. Preserve persisted `anubis` choices.
3. Append `glass-layer.css` unchanged to `apps/ptah-extension-webview/src/styles.css`, after existing theme styling. It is scoped to the two new names. Use the compiled DaisyUI themes in the app; **do not** also include prototype `theme.css` there. Check any existing surface utility declarations for overrides and keep the scoped layer last.
4. Update `apps/ptah-extension-webview/src/index.html` pre-paint `<html data-theme="ptah-glass">` and any literal fallback names in its pre-paint script so the new default appears before Angular starts. Verify the persisted-theme path continues to select its saved theme without a flash.

## Decisions

- Dark uses lapis depth, teal aurora, and gold accents. Light keeps the same radii and depth but shifts to lavender and peach with deep lavender actions.
- Theme colors stay solid because DaisyUI 4 emits OKLCH channel variables without alpha. All transparency and blur belong to the scoped CSS layer.
- The light palette uses a deeper primary and secondary than the backdrop so action labels, outlines, and text retain contrast.
- The shell layout shows all common controls in use, plus an open dropdown and a visually open modal preview. The modal preview is contained in the gallery so it does not cover the rest of the system review.
- The setup and empty-state examples copy the wording and controls of the existing `setup-plugins` components; they are static design specimens rather than live Angular components.
- No build, test, lint, or app source edit was run or made for this design-only lane.
