# Prototype — EN/AR language switcher & RTL treatment

TASK_2026_575_fee7 · Gate 1.7 · ui-ux-designer

Static HTML prototype (Tailwind via CDN + this folder's `tokens.css`, which
copies the exact color values out of
`apps/ptah-landing-page/tailwind.config.js`'s `operator` / `operator-admin` /
`operator-member` / `operator-member-light` DaisyUI themes). It is a visual
mock, not the Angular implementation — the architect and developer build the
real components; this demonstrates the decisions in
`../design-spec.md` at real pixel sizes so the user can confirm them before
that build starts.

## How to view

Open `index.html` directly in a browser (`file://…/prototype/index.html`, no
server needed — same load model the Electron webview uses, which this
prototype's LTR-island/RTL approach is meant to generalize to later). The
control bar pinned to the top (language EN/AR, mode Dark/Light) drives every
section on the page at once, the same way the real `LanguageSwitch` and
`MemberThemeService` would. The control bar itself is prototype-only chrome
and is hidden before every captured screenshot.

## What each section shows

| Section | Demonstrates |
| --- | --- |
| A · Public header — desktop | Header language switcher (disclosure-menu skin, §2.2 of the spec), anchored `left`/`right` per direction, `role="menu"`/`role="menuitemradio"`, checkmark on the current option, each option's own `lang`/`dir`. |
| A2 · Mobile menu — language row | Segmented two-button toggle for the mobile overlay (§2.3). |
| B · Member/admin shell — shared panel-layout header | The panel-skin segmented switcher (§2.4) placed once in the shared `panel-layout.html` header — same markup renders for both the member shell and the admin shell. Shown alongside the existing (unchanged) `MemberThemeToggle` dark/light control, to scale the two "preference" controls against each other. Use the Dark/Light prototype control to see `operator-member` vs. `operator-member-light`. |
| C · Landing hero | A representative animated/CTA section: `ArrowRight`/`ArrowLeft`-style icons flip via `rtl:scale-x-[-1]` (§3.2); the centred decorative blur (`left-1/2 -translate-x-1/2`) does **not** move — an `rtl-exempt` centring pair (§3.1). |
| D · Pricing card | USD amount and the year/month numeral stay Western-numeral and LTR (`.ltr-island`) in both languages; only the surrounding words translate (§5.3 of the requirements, §3.7 of the spec). |
| E · CLI block | `.ltr-island` on a `font-mono` code block inside an RTL page (§3.3) — stays left-aligned and LTR while the paragraph above it flows RTL. |

## Directions and modes captured

`screenshots/full-<lang>-<mode>-<width>.png`:

- `lang`: `en` (LTR) / `ar` (RTL, draft Arabic copy — see note below)
- `mode`: `dark` (`operator` / `operator-admin` / `operator-member`) /
  `light` (member shell only switches to `operator-member-light`; the public
  marketing and admin shells are dark-only today, unchanged by this task)
- `width`: `375` (mobile) / `1440` (desktop)

All 8 combinations are included (2 × 2 × 2).

Screenshots were rendered with Playwright (Chromium,
`/opt/pw-browsers/chromium-1194`), full-page, viewport widths 375 and 1440,
via a one-off script that loads `index.html`, calls the page's own
`window.__proto.applyLang()` / `applyMode()` (the same functions the control
bar's buttons call) for each of the 4 language×mode combinations, and
captures a full-page PNG at each of the 2 widths.

## Arabic copy status

Every Arabic string in this prototype (nav labels, hero copy, pricing card,
CLI intro sentence, legal-notice draft in the design spec) is an
**agent-drafted placeholder**, written to demonstrate layout, line length and
RTL flow — not final copy. Per the task's Scope ("agents draft Arabic copy,
user reviews before merge") and Requirement 8, none of it ships without the
user's review and sign-off; the real per-lib `ar.json` translation files and
the side-by-side review table are the architect/developer/QA phases' output,
not this prototype's.

## Lane-introduced constraints

`none`. No `ptah_agent_*` CLI lanes were spawned for this task (Gate 0.1:
none exist in this cloud session — recorded in `context.md`), so there are no
lane-proposed rules to list or flag for Gate 1.7 approval. Every rule in
`../design-spec.md` traces to either an existing project pattern/token (cited
inline, `[project-rule]` in spirit) or an explicit new decision this spec
states and justifies itself — see `../design-spec.md` §5 "Traceability
summary".

## Cross-reference

- `../design-spec.md` — the full specification (switcher markup, states,
  keyboard behavior, RTL rules, font, numbering-system recommendation, legal
  notice draft, per-section landing-animation calls).
- `parity-inventory.md` — not applicable to this task (`context.md`: "Parity:
  not required (no existing surface is replaced; the switcher is
  additive)"); not present in the task folder.

## Known prototype limitations (not implementation gaps)

- Uses Tailwind's CDN runtime build + a small inline CSS safety net for icon
  sizing (`index.html`'s `<style>` block) rather than the project's compiled
  Tailwind/DaisyUI build, because this is a standalone static file with no
  Nx/Angular build step. Colors, spacing and radii are taken from the real
  theme tokens (`tokens.css`); a few DaisyUI component classes (`btn`,
  `badge`) are approximated with plain Tailwind utilities instead of
  DaisyUI's compiled output.
- The public header's `Product`/`Community` disclosure menus and the mobile
  hamburger are static (non-interactive) in this prototype — only the
  language switcher and the member-theme toggle are wired up, since those are
  the controls this task is about.
- Icons are inline SVG paths approximating the real `lucide-angular` icon set
  (`Globe`, `ChevronDown`, `Check`, `ArrowRight`, `Download`, `Sun`/`Moon`,
  `Menu`), not the library itself.

## Gate 1.7

This prototype and `../design-spec.md` are submitted for the user's
APPROVED / iterate response before the software-architect phase begins,
per the task's stated workflow. Open items requiring the user's decision
(not the designer's) are listed in `../design-spec.md` §4 "Open questions".
