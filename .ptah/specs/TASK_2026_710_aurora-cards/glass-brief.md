# TASK_2026_710 — Phase 1: Ptah glassmorphism DaisyUI theme pair (prototype)

## Direction change (user decision, overrides the earlier card briefs)

The user does not want per-screen card redesigns. The user wants a **glassmorphism theme for the whole
application**, built as DaisyUI themes, as a **dark + light pair**, that will become the **new default**.

References the user gave:
- Article: https://uxpilot.ai/blogs/glassmorphism-ui
- DaisyUI v4 custom themes: https://v4.daisyui.com/docs/themes/
- Reference 1: dark smoky frosted glass dashboard over a blurred photo backdrop; large radii (~24px);
  glass panels nested in a larger glass panel; pill segmented control; translucent tiles; soft
  white text; one blue accent.
- Reference 2: light milky glass cards over a soft lavender/blue/peach gradient; white translucent
  sidebar; purple accent; crisp dark text.
- Reference 3: light warm-gray frosted glass over a peach/orange gradient; one dark glass card for
  contrast; orange-to-mauve gradient bars.

The pair: **`ptah-glass`** (dark — Ptah brand: lapis/teal/gold aurora backdrop, smoky glass, gold
accent) and **`ptah-glass-light`** (light — pastel milky glass, warm lavender→peach backdrop, keep a
Ptah-compatible accent). Both must feel like one family.

## Repository facts (verified)

- DaisyUI `4.12.24`, Tailwind `3.4`. Themes live in
  `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js` (`daisyui.themes`; read
  the `anubis` and `anubis-light` objects — every custom key they define, e.g. `--bcm`,
  `--state-ink-*`, `--ptah-check-edge`, `--rounded-*`, `--border-btn`, must also exist in the new
  themes).
- Picker list: `D:\projects\ptah-extension\libs\frontend\core\src\lib\services\theme.service.ts`
  (`DAISYUI_THEMES`, `EAGER_THEMES`, default `anubis`).
- Global styles: `D:\projects\ptah-extension\apps\ptah-extension-webview\src\styles.css`.
- Existing aurora: `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\aurora\aurora-effect.component.ts`.
- **A DaisyUI 4 theme cannot express glass by itself.** Theme colors compile to OKLCH channel vars
  (`--p`, `--b1`, `--bc`, …) with no alpha, used as `oklch(var(--b1) / <alpha>)`. So the theme needs:
  1. theme objects (colors + radius/border vars) for `tailwind.config.js`;
  2. a **glass layer** CSS scoped to `[data-theme=ptah-glass]` / `[data-theme=ptah-glass-light]`
     that makes DaisyUI surfaces translucent with `backdrop-filter` — at least: `.card`,
     `.modal-box`, `.dropdown-content`, `.menu`, `.navbar`, `.drawer-side`, `.collapse`, `.alert`,
     `.tabs-boxed`, `.join`, `.input`, `.textarea`, `.select`, `.btn` (ghost/outline/neutral),
     `.badge`, `.tooltip`, `.chat-bubble`, `.table`, and `bg-base-100/200/300` fills;
  3. an **app backdrop** on the root (aurora / gradient wallpaper) so the glass has something to blur.
- Local DaisyUI CSS for the prototype: `D:\projects\ptah-extension\node_modules\daisyui\dist\full.css`
  (link it as `file:///D:/projects/ptah-extension/node_modules/daisyui/dist/full.css`; the worktree
  may have no `node_modules`). `culori` is installed (`node_modules/culori`) if you need hex→OKLCH;
  a one-off `node -e` conversion is allowed.

## Constraints

- Performance (Electron): blur is GPU-costly. Blur large static panels (sidebar, header, cards,
  modals, menus); do NOT blur every row of a long scrolling list (chat messages, tables) — use a
  translucent fill without blur there. State the blur budget in NOTES.md. Provide a
  `prefers-reduced-transparency` fallback (more opaque fills) and `prefers-reduced-motion`.
- Contrast: WCAG AA for body text and 3:1 for UI on the glass surfaces, over the brightest part of
  the backdrop. Compute it for the main text/surface pairs and list the numbers.
- Visible focus rings. No external network requests, no CDN, no frameworks in the prototype.

## Deliverables (in YOUR folder only — see the lane task)

1. `theme.config.js` — `module.exports = { 'ptah-glass': {…}, 'ptah-glass-light': {…} }`, ready to
   paste into `daisyui.themes`, with every custom key the anubis themes define.
2. `glass-layer.css` — the scoped glass layer + backdrop + fallbacks, written so it can move into
   `styles.css` unchanged.
3. `theme.css` — the compiled-equivalent `[data-theme=…]` blocks (OKLCH channel vars, as DaisyUI
   would emit) so the static prototype renders without a Tailwind build.
4. `index.html` — ONE prototype page: links `full.css` + `theme.css` + `glass-layer.css`, has a
   theme toggle (ptah-glass / ptah-glass-light), and shows an app shell: left sidebar (session
   list), top navbar with icon buttons, a chat column (user + assistant bubbles, a code block, a
   tool-call collapse), a composer (textarea + buttons), a right panel with stat cards, plus a
   components strip: buttons (all variants), inputs, select, toggle, tabs, badges, alert, dropdown
   open, modal open, table, progress, tooltip. Also show the "Get ready" setup card and the "Get
   started" empty state from
   `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-plugins\` in
   the new theme. Use only DaisyUI classes + a small layout CSS (flex/grid) of your own.
5. `NOTES.md` — palette with hex + OKLCH, contrast table, blur budget, how to integrate (exact
   edits to `tailwind.config.js`, `theme.service.ts`, `styles.css`), and `## Decisions`.
