# Design

Live token source for the marketing site: `apps/ptah-landing-page/tailwind.config.js` (daisyUI theme `operator`, set through `data-theme="operator"` in `apps/ptah-landing-page/src/index.html`). If this file and the config disagree, the config wins.

## Theme

Dark, single amber accent. Near-black ink backgrounds, amber for the primary action and glow, emerald for secondary and success.

## Color

- Backgrounds: `base-100` `#08090c`, `base-200` `#0e1015`, `base-300` `#171a21`. The `ink` scale (`ink-950` to `ink-100`) is also available.
- Text: `base-content` `#e9ebef`. The muted tier is `base-content-muted` (measured at 5.46:1; checked by `apps/ptah-landing-page/src/app/base-content-muted.spec.ts`). Do not use `text-base-content/NN` for muted text: `no-alpha-base-content.spec.ts` guards it.
- Accent: `primary` `#f5a524` (amber; `amber-400/500/600` are `#ffbb4d`, `#f5a524`, `#c97e0e`), `accent` `#ffbb4d`.
- Semantic: `secondary` and `success` `#34d399`, `info` `#38bdf8`, `warning` `#eab308`, `error` `#fb7185`.

## Typography

- Sans: Inter (`font-sans`). Mono: JetBrains Mono (`font-mono`). Both load from Google Fonts in `index.html`.
- There is no display face. The config notes that Cinzel was removed.
- Extra sizes: `text-8xl` and `text-9xl` with tight line height and negative tracking.

## Shape

`--rounded-box` 0.75rem, `--rounded-btn` 0.5rem, badges fully rounded.

## Motion

GSAP (`gsap`, `ScrollTrigger`, `MotionPathPlugin`) drives the hero, the final CTA and the always-on loop diagram. Tailwind animations in the config: `glow-pulse`, `pulse-ring`, `divider-draw`, `status-blink`. Section CSS carries `prefers-reduced-motion` overrides where it animates.

## Assets

`apps/ptah-landing-page/public/assets/`: `live-demo/` (clip posters and videos), `og/`, `showcase/` screenshots under `images/`, `textures/`, `backgrounds/`, `icons/` (including `glyphs/`).

Icons come from `lucide-angular` (`libs/web/ui/src/lib/navigation.component.ts` uses it).
