# TASK_2026_710 — Aurora + glass redesign prototypes (Tribunal Forge, prototype-only)

## ROUND 2 — read this first; it overrides the round-1 text below

The user REJECTED round 1 (`prototype/a`, `prototype/b`): both kept the card design the user does not
want. Keep the same **content** (labels, copy, actions, states), but you are NOT bound to the current
**layout or card structure** — redesign it.

### Banned (this is the rejected card design)

- A bordered dark panel holding a stack of full-width rows "icon · title/subtitle · outline button on
  the right" (the current setup card and welcome feature list).
- Plain rectangular prompt cards stacked in a list or simple grid (title + subtitle, thin border).
- Plain bordered category tiles that differ only by a border color when selected.
- Outline pill buttons as the main action style inside cards.
- A home-made blurred-blob background in place of the real aurora (below).
- Prototype-only chrome in the page body (breadcrumbs, side menus, explainer copy). Put state
  switchers in a small floating dev toolbar only.

### Required

1. **Use the app's real aurora effect.** Copy the CSS of
   `D:\projects\ptah-extension\libs\frontend\ui\src\lib\native\aurora\aurora-effect.component.ts`
   (gold repeating-stripe aurora, `aurora-shift` keyframes, radial mask; variants `board` and `brand`)
   into your prototype and use it as the backdrop of every surface. Map its OKLCH DaisyUI tokens to
   literal anubis colors. You may ALSO bring the aurora INTO cards (e.g. a clipped aurora layer inside
   a hero card, or an aurora-tinted animated border).
2. **Cards are the design statement**, in a current 2025–2026 style. Pick from: bento grid with mixed
   tile sizes; true glass (translucent, `backdrop-filter: blur(16–24px) saturate(140%)`, aurora visibly
   showing through); animated conic-gradient or "border beam" edges; cursor-follow spotlight / glow on
   hover (vanilla JS sets `--x/--y`); large gradient-glow icon medallions; depth with layered shadows
   and inner highlights; progress rings / step tracks instead of text status.
3. Setup card: a readiness hero (ring or track showing 0/1/2 of 2) + the three items as distinct glass
   tiles (bento), where the action is a clear filled or ghost-glow button, not an outline pill.
4. Empty state: category tiles as glowing icon medallions or segmented glass control; prompt cards as
   rich glass tiles (icon, title, subtitle, hover spotlight, arrow reveal), bento layout. Must fit a
   600–760px chat column (wrap correctly at 600px).
5. Welcome: hero + feature tiles as a bento of glass cards, not a row list.
6. Boot: a branded aurora loading moment (logo medallion, ring/beam progress, stage track).
7. **Two directions per surface** (`-v1` and `-v2`) that differ in card structure, not just color.


## Objective

The user finds the card design on four Ptah Electron surfaces "very basic, not shiny or stunning".
Produce **static HTML prototypes** that redesign them with current design trends:

- an **aurora effect** (soft, slow, animated color-field gradients behind content),
- **glassmorphism** cards (translucent fill, `backdrop-filter: blur`, thin luminous border,
  inner highlight, subtle noise/grain optional),
- **modern line icons** (inline SVG, Lucide-style 1.5px stroke; no emoji, no icon fonts, no CDN),
- refined type hierarchy, spacing, hover/focus/press micro-interactions.

This is design exploration only. Do NOT change any Angular source.

## The four surfaces (read these to keep content and states 1:1)

1. **Setup card "Before you begin / Get ready"** —
   `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-plugins\project-setup-card.component.ts`
   Content: eyebrow "BEFORE YOU BEGIN", badge "0 of 2 ready", title "Get ready", subtitle, three rows
   (Skills / Agents / Project scan, each with icon, status line, action button), footer
   "Setup tools: Generate agents · Project guidance". Show also a partly-ready state (1 of 2) and an
   all-ready state. A "+ New session" primary button sits above the card.
2. **Electron welcome page "Welcome to Ptah Desktop"** (no folder open) —
   `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\templates\electron-welcome.component.ts`
   Logo, title, description, "Open Folder" primary CTA, three feature rows
   (Workspace Intelligence, AI Agent Orchestra, Context-Aware Chat).
3. **Chat empty state "Get started"** —
   `D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\setup-plugins\chat-empty-state.component.ts`
   Logo, "Ptah" wordmark, tagline "Ancient Wisdom • Master Craftsman", "GET STARTED" header,
   six category tiles (Build, Fix, Review, Agents, Explore, Creative — one selected), a list of
   prompt cards (title + subtitle). Today the tile icons are broken glyphs; replace with real SVG.
4. **Initial loading / boot screen** —
   `D:\projects\ptah-extension\libs\frontend\chat-ui\src\lib\molecules\boot-progress\boot-progress.component.ts`
   (rendered from `D:\projects\ptah-extension\apps\ptah-extension-webview\src\app\app.html`).
   Keep its stages and copy; make it a branded aurora loading moment.

Logo image: `D:\projects\ptah-extension\apps\ptah-landing-page\public\assets\icons\ptah-icon.png`
(reference it by relative path from your prototype file, or copy it next to it).

## Constraints

- Brand: Egyptian "Ptah" identity — gold/amber, lapis blue, deep teal/emerald accents on a near-black
  base. The current app theme is DaisyUI theme `anubis` (see
  `D:\projects\ptah-extension\apps\ptah-extension-webview\tailwind.config.js`); reuse its palette.
- Must work in **dark and light** themes: a toggle in each page (`data-theme` on `<html>`).
- Must respect `prefers-reduced-motion` (aurora stops animating).
- Text contrast WCAG AA on the glass surfaces. Visible keyboard focus rings.
- Electron app window: design at 1280×800 and check at 900px width; the setup card and empty
  state live inside a chat column ~600–760px wide.
- Self-contained: plain HTML + CSS (+ minimal vanilla JS for the theme toggle / tile selection).
  No external network requests, no frameworks, no CDN fonts (use system font stack, or Inter if
  local is not available — fall back cleanly).
- Prefer CSS that maps to Tailwind/DaisyUI later: CSS custom properties for every color, radius,
  blur and glow value, declared once in `:root` / `[data-theme]`.

## Deliverables (in YOUR folder only — see the lane task for the folder)

- `index.html` — gallery page linking the four prototypes, with a one-paragraph design rationale.
- `setup-card.html`, `welcome.html`, `empty-state.html`, `boot.html`.
- `tokens.css` — the shared design tokens (aurora colors, glass fill/border/blur, glow, radii).
- `NOTES.md` — design rationale, token list, how each piece maps to the Angular component and to
  Tailwind/DaisyUI classes, and `## Decisions`.
