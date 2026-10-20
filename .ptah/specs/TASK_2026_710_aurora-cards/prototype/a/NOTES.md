# Prototype A — Aurora + Glass

## Design rationale
Four slowly drifting, heavily blurred colour blobs (lapis `#2563eb`, teal `#14b8a6`, gold `#d4af37`, violet accent) sit behind frosted-glass cards (translucent fill, `backdrop-filter: blur(22px) saturate`, gradient hairline border gold→lapis, inner top highlight, SVG-noise grain over the aurora). Gold remains the brand anchor on a near-black base; light theme swaps to parchment with `multiply` blending and darker gold ink. Icons are inline 1.5px-stroke Lucide-style SVG sprites.

## Token list (`tokens.css`, declared in `:root,[data-theme='anubis']` and `[data-theme='anubis-light']`)
- Base/ink: `--bg --bg-2 --ink --ink-muted --ink-faint`
- Brand: `--gold --gold-hi --gold-ink --lapis --lapis-hi --teal --teal-hi --success --warning --error`
- Aurora: `--aurora-1..4 --aurora-opacity --aurora-blend --aurora-vignette --grain-opacity`
- Glass: `--glass-fill --glass-fill-strong --glass-border --glass-border-hi --glass-highlight --glass-blur --glass-sat --row-fill --row-fill-hover --divider --shadow`
- Glow: `--glow-gold --glow-lapis`
- Buttons/focus: `--btn-primary-bg --btn-primary-ink --btn-ghost-fill --btn-ghost-hover --focus-ring`
- Shape/type: `--r-sm/md/lg/xl --font-sans --font-display --ease`

## Mapping to Angular / Tailwind-DaisyUI
| Prototype | Angular source | Later mapping |
|---|---|---|
| `setup-card.html` | `project-setup-card.component.ts` | replace `surface-3 rounded-lg border` with `.glass` utility; rows `bg-base-200` chip → `.icon-chip`; `btn btn-xs btn-outline` → `.btn` pill (`btn btn-xs btn-outline rounded-full`); badge → `badge` + meter segments |
| `welcome.html` | `electron-welcome.component.ts` | `btn-primary btn-lg` → `.btn-primary.btn-lg`; feature rows in one `.glass` panel; Sparkles icon replaced per-feature (radar / network / chat) |
| `empty-state.html` | `chat-empty-state` + `prompt-suggestions` | existing `ptah-aurora-effect` → `.aurora` blobs; hieroglyph tiles → SVG `.tile` using Lucide `Hammer, Wrench, ShieldCheck, Users, Compass, Palette` |
| `boot.html` | `boot-progress.component.ts` | same 5 stages/copy, `data-testid`s kept; `Check`/`Loader` icons; added ring + progress bar |
- Colours map to DaisyUI vars (`--p` lapis, `--s` gold, `--a` gold-hi); `.glass`, `.aurora` become `@layer components` utilities; `backdrop-blur-[22px]`.

## Decisions
- Single shared `tokens.css` holds tokens AND primitives (aurora, glass, buttons, toggle) so pages stay small; page CSS is layout only.
- Theme via `data-theme` (`anubis` / `anubis-light`), persisted in localStorage to carry across pages.
- Light theme uses `mix-blend-mode: multiply` and opaque-ish white glass so text stays AA; gold text uses darker `--gold-ink` (#7a5600).
- Primary gold button uses dark ink (#1a1300) for AA; gold sheen sweep on hover.
- Aurora is pure CSS transforms on 4 elements (GPU-friendly); `prefers-reduced-motion` stops it plus halos, spinners and transitions.
- Setup card all-ready state mirrors source (compact "Ready" header + three buttons); added a 2-segment meter in the badge.
- Boot screen has a prototype-only control bar (auto-advance, degraded, unknown phase) mirroring source behaviours; it is not part of the real UI.
- Prompt lists for Build match source; other categories' prompt copy is placeholder (only the first 5 Build prompts and Fix's first were read). Hieroglyph footer replaced by a simple ornament (✦) since glyphs rendered broken.
- Fonts: system stack with Inter first, Cinzel for wordmark falling back to serif; no network.
- Not verified in a browser (no tooling run per rules); contrast ratios estimated from token values.
