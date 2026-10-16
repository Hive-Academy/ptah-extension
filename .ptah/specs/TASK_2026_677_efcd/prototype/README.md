# Prototype: Clean session view and "This session" inspector (TASK_2026_677_efcd)

Companion to `../design-spec.md`. Static HTML/CSS/vanilla JS, no build, no network needed (fonts fall back to system fonts offline).

## Open

Open `index.html` directly in a browser (file://) or serve this folder (`node` static server, any port) and visit `/index.html`.
All state is in the query string, so every screenshot is a URL:

`index.html?theme=dark|light &t1=collapsed|expanded &t2=ref|streaming|answered|done &insp=open|closed &body=full|empty|loading|error &width=wide|sidebar &bare=1 &sel=1 &reduce=1 &replay=0`

The dark bar at the top ("Prototype", not product, hidden with `bare=1`) has the same switches as buttons, plus "Replay session switch" and "Reduced motion".

## Files

| File | Purpose |
| --- | --- |
| `index.html` | the whole screen: header, thread (2 user turns, 2 assistant turns), composer, inspector |
| `assets/tokens.css` | the app's real DaisyUI theme variables for `anubis` and `anubis-light`, surfaces, elevation, gold, easing tokens (copied from `tailwind.config.js`, `styles.css`, `chat-view.component.css`) |
| `assets/app.css` | component CSS (hand-written; values equal the Tailwind utilities listed in `design-spec.md`) |
| `assets/app.js` | disclosure toggles, live timer, state switches, theme switch, stagger replay, inspector toggle, empty/loading/error content |
| `assets/sprite.js` | inline SVG sprite: 40 lucide-angular 1.0.0 icons and 7 vendor marks from `PROVIDER_BRAND_ART` (claude, codex, antigravity, opencode, grok, copilot, cursor) |
| `assets/contrast-check.mjs` | re-runnable contrast audit (`node contrast-check.mjs`) behind the tables in `design-spec.md` section 8.2 |
| `screenshots/*.png` | captures listed below |

## States

| State | URL params | Screenshot |
| --- | --- | --- |
| Reference one-to-one, dark (collapsed "Worked for", chips, live line) | defaults | `dark-collapsed-wide.png` |
| Same, light | `theme=light` | `light-collapsed-wide.png` |
| Turn 1 expanded + turn 2 answered, agents running (log collapsed, "Working" row), dark | `t1=expanded&t2=answered` | `dark-expanded-and-answered-wide.png` |
| Turn 2 streaming (work log visible, tool rows, agent activity, "Orchestrating" line), dark / light | `t2=streaming` | `dark-live-streaming-wide.png`, `light-live-streaming-wide.png` |
| Turn done (all statuses done, idle orchestrator, actions), dark / light | `t2=done` | `dark-turn-done-wide.png`, `light-turn-done-wide.png` |
| Inspector empty / loading / error (git), dark | `body=empty|loading|error` | `dark-inspector-empty.png`, `dark-inspector-loading.png`, `dark-inspector-error.png` |
| Inspector closed, needs-you dot on the toggle, light | `insp=closed&theme=light` | `light-inspector-closed-wide.png` |
| Embedded 400 px container (sidebar) | `width=sidebar&insp=closed` | `dark-sidebar-400-container.png` |
| Real 400 px viewport: inspector as full-width sheet, dark | viewport 400x900 | `dark-narrow-400-inspector-sheet.png` |
| Real 400 px viewport: streaming turn, light | viewport 400x900 | `light-narrow-400-streaming.png` |

Selected agent row (`aria-current`, gold bar): `sel=1`. Hover and focus are live in the browser. Stagger: press "Replay session switch" (entrance classes are verified
numerically: delays 45/90/135... ms, 260 ms, translateY 6 px). Reduced motion: toggle the bar button or set `prefers-reduced-motion`; with it, 0 animations run.

Interactive: click a "Worked for" row to expand its log; click an agent row to select; toggle the inspector with the header button, its close button, the scrim (overlay
mode) or Esc; the live timer ticks every second; switching `t2` runs the streaming -> answered -> done transitions (log collapse 260 ms, answer fade 240 ms).

## Deviations

- CSS is hand-written, not a Tailwind/daisyUI build: the task forbids builds and installs and the worktree has no `node_modules`. Tokens are the app's real theme
  variables (`tokens.css`), and `design-spec.md` gives the Tailwind/daisyUI utility strings developers use. The class names in `app.css` are prototype-only.
- Fonts: Inter and JetBrains Mono load from Google Fonts like the app (`styles.css` line 7). Offline they fall back to system-ui / Consolas; widths differ by a few px.
- Icons: lucide-angular icon definitions and `PROVIDER_BRAND_ART` paths copied into an inline sprite; the app renders them through `lucide-angular` and `ptah-provider-mark`.
- Responsive rules use native `@container` queries on the shell (the app has no Tailwind container-query plugin).
- Example data only (no network, no stores). Gemini has no vendored mark, so it shows the lucide `terminal` fallback exactly as `ptah-provider-mark` would.
- Browser capture used a local static server on 127.0.0.1 (headless Chromium); the server was stopped afterwards.

## Project rules applied

- `[project-rule]` Use the app's design tokens (`--b1/--b2/--b3/--bc`, `--bcm`, `text-state-*`, surfaces): `apps/ptah-extension-webview/tailwind.config.js`, `styles.css`.
- `[project-rule]` Muted text through `--bcm` (`base-content-muted`), never an alpha ladder: `styles.css` comment block "--bcm / base-content-muted", `base-content-muted.spec.ts`.
- `[project-rule]` Brand gold through `--ptah-gold*`, never hex: `styles.css` lines 31-34.
- `[project-rule]` Reduced motion collapses animation durations: `styles.css` lines 672-681 (the stagger additionally zeroes delays; see spec 7.3).
- `[project-rule]` Global focus ring `outline: 2px solid oklch(var(--s))`, light theme uses `--ptah-gold-strong`: `styles.css` lines 683-710.
- `[project-rule]` Motion easing tokens `--ptah-ease-soft` / `--ptah-ease-gentle-in`: `chat-view.component.css`.
- `[project-rule]` Provider marks only through the vendored `PROVIDER_BRAND_SLUGS` table, lucide fallback `Terminal`: `provider-mark.component.ts`, `brand-slugs.ts`.
- `[project-rule]` Status is a hint, not a button; one prominent action per surface; no component banned (skill rules).

## Lane-introduced constraints

- `[lane-proposed]` token `--ptah-link` (gold text, light uses gold-strong).
- `[lane-proposed]` optional Tailwind colour `surface-border-strong`.
- `[lane-proposed]` rule R1: status words never sit on `surface-3`; rule R2: no tinted fills behind status words (both measured, spec 8.2).
- `[lane-proposed]` stagger caps: 8 turn items, 6 inspector rows (spec 7.1).

## Parity

`parity-inventory.md` was not present when this prototype was built. Replaced surfaces and the data each keeps are listed in `design-spec.md` section 12.
Carry-over items covered visually: T1-01 to T1-06 (T1-02 and T1-07 need backend wiring, spec section 9).
