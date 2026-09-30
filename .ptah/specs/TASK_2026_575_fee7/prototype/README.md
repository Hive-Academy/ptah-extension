# Prototype — EN/AR language switcher & RTL treatment

TASK_2026_575_fee7 · Gate 1.7 · ui-ux-designer

Revision 2, final round under the revise cap (see `../design-spec.md` §6
"Review responses (revision 1)" for B1-B6/N1-N15, and §7 "Review responses
(revision 2)" for B7/N16-N21). Round 1's headline fix: this prototype is
fully self-contained — no CDN dependency at all. Round 2's headline fix: the
member/admin panel header's 375px wrap fix is now normative in
`../design-spec.md` §2.4 itself (round 1 had fixed it only here, in the
prototype), and both the spec's markup and this prototype now wrap the
*outer* header, not just its control cluster, plus a longer-title
admin-shell header is included and captured — the case most likely to
re-break the fix.

Static HTML prototype: `tailwind-build.css` is a real, offline-compiled
Tailwind 3.4.18 + DaisyUI 4.12.24 stylesheet built from the exact color
values in `apps/ptah-landing-page/tailwind.config.js`'s `operator` /
`operator-admin` / `operator-member` / `operator-member-light` themes (see
that file's own header comment for the exact, reproducible build command),
and `fonts/fonts.css` self-hosts the real Inter, JetBrains Mono and IBM Plex
Sans Arabic `.woff2` files. It is a visual mock, not the Angular
implementation — the architect and developer build the real components;
this demonstrates the decisions in `../design-spec.md` at real pixel sizes
so the user can confirm them before that build starts.

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
| A · Public header — desktop | Header language switcher (disclosure-menu skin, §2.2 of the spec), anchored with the logical `start-0` (so it flips sides automatically, fix for N1), `role="menu"`/`role="menuitemradio"`, checkmark on the current option, each option's own `lang`/`dir`. Use the "Open header language menu" prototype control (or click the trigger) to see it open. |
| A2 · Mobile menu — language row | `role="group"`/`role="menuitemradio"` segmented two-button toggle for the mobile overlay (§2.3, fix for B3's ARIA structure). |
| B · Member/admin shell — shared panel-layout header | The panel-skin segmented switcher (§2.4) placed once in the shared `panel-layout.html` header, now projected *after* the shell's own topbar content so it sits directly next to `MemberThemeToggle` (fix for N3). Visible check icon on the selected segment (fix for N12), the literal `focus-visible:outline-base-content` utility as the focus ring (fix for B4/N17), `EN`/`AR` visible with a native-language `aria-label` (fix for B2/N11). At 375px the whole `<header>` wraps onto two clean rows — title/badge on row one, controls on row two, no clipping, no mid-word title wrap — and this is now a normative rule in the spec itself (fix for B7), not only a prototype-only patch. Use the Dark/Light prototype control to see `operator-member` vs. `operator-member-light`. |
| B2 · Admin shell — longer title, no theme toggle | A second representative header directly below B, same shared markup, `operator-admin` theme: "Admin Dashboard" (longer than "Ptah Builders") + a `Restricted` warning badge + no theme toggle. Added for B7 — the review asked specifically for this case, since a longer title is the one most likely to re-break the wrap fix. Captured separately at 375px in both languages (`admin-header-375-en.png`, `admin-header-375-ar.png`). |
| C · Landing hero | A representative animated/CTA section: `ArrowRight`/`ArrowLeft`-style icons flip via `rtl:scale-x-[-1]` (§3.2); the centred decorative blur (`left-1/2 -translate-x-1/2`) does **not** move — an `rtl-exempt` centring pair (§3.1). |
| D · Pricing card | USD amount and the year/month numeral stay Western-numeral and LTR (`.ltr-island`) in both languages; only the surrounding words translate (§5.3 of the requirements, §3.7 of the spec). The Arabic "Cohort 4" badge in section B and this card's digits now use Western numerals throughout, consistent with §3.7's recommendation (fix for N10 — the previous revision's Arabic-Indic badge digit contradicted its own recommendation). |
| E · CLI block | `.ltr-island` on a `font-mono` code block inside an RTL page (§3.3) — stays left-aligned and LTR while the paragraph above it flows RTL. |

## Directions and modes captured

`screenshots/full-<lang>-<mode>-<width>.png` (the closed-menu, default
state — every one of these already IS the "closed menu" shot B1 asked for):

- `lang`: `en` (LTR) / `ar` (RTL, draft Arabic copy — see note below)
- `mode`: `dark` (`operator` / `operator-admin` / `operator-member`) /
  `light` (member shell only switches to `operator-member-light`; the public
  marketing and admin shells are dark-only today, unchanged by this task)
- `width`: `375` (mobile) / `1440` (desktop)

All 8 combinations are included (2 × 2 × 2), plus two more (fix for B1's
"add ... one shot with the header menu open, per direction"):

- `screenshots/header-menu-open-en-1440.png`
- `screenshots/header-menu-open-ar-1440.png`

— both cropped to the header region, header language menu open, showing the
`start-0` anchoring flip (left-anchored in EN, right-anchored in AR) and the
checkmark on the current option. Section A (the public header these crop)
is unchanged in revision 2, so these two were not regenerated this round —
they still accurately depict it.

Plus, new in revision 2 (fix for B7's "add a 375px shot of the admin
shell"):

- `screenshots/admin-header-375-en.png`
- `screenshots/admin-header-375-ar.png`

— both cropped to the admin-shell demo header (section B2), 375px, showing
the longer "Admin Dashboard" title + `Restricted` badge fitting on one line
and the controls row wrapping cleanly beneath it, in both directions.

Screenshots were rendered with Playwright (Chromium,
`/opt/pw-browsers/chromium-1194`, launched with no proxy/network flags —
none are needed any more). Revision 2 regenerated only the screenshots whose
content actually changed: all 8 `full-*.png` (section B's markup changed,
and section B2 is new, so every full-page shot at every width/language/mode
combination includes it) plus the 2 new `admin-header-375-*.png` crops;
`header-menu-open-*-1440.png` was left as-is since section A did not change.
Every regenerated PNG was re-opened and visually confirmed by eye — real
fonts, real Tailwind/DaisyUI layout, correct mirroring, no clipping or
wrapping at 375px in either shell — not just regenerated and assumed
correct.

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

- `tailwind-build.css` is compiled from a **standalone** `tailwind.config.js`
  (built at `/tmp/twbuild` per that file's own header comment) that copies
  the real project's theme values, not from the actual
  `apps/ptah-landing-page/tailwind.config.js` in place via its own Nx build
  — there is no Nx/Angular build step available to a standalone static
  file. If the real config's theme values ever change, this copy needs a
  manual re-sync (the same caveat `tokens.css`'s original comment already
  carried for its own hand-copied values, now narrowed since most of that
  hand-copying was replaced by the real compiled output — see B1/N15 in
  `../design-spec.md` §6).
- The public header's `Product`/`Community` disclosure menus and the mobile
  hamburger are static (non-interactive) in this prototype — only the
  language switcher and the member-theme toggle are wired up, since those are
  the controls this task is about.
- Icons are inline SVG paths approximating the real `lucide-angular` icon set
  (`Globe`, `ChevronDown`, `Check`, `ArrowRight`, `Download`, `Sun`/`Moon`,
  `Menu`), not the library itself.
- The panel skin's focus ring is now the literal `focus-visible:outline-base-content`
  Tailwind utility (fix for N17, revision 2) — matching `design-spec.md`'s
  normative markup exactly, with no custom class left in `tokens.css` for it.

## Rebuilding after an HTML change

`tailwind-build.css` is generated, not hand-written — after editing
`index.html`'s classes, regenerate it (see `tailwind-build.css`'s own header
comment for the full command) rather than hand-editing the compiled file.

## Gate 1.7

This prototype and `../design-spec.md` are submitted for the user's
APPROVED / iterate response before the software-architect phase begins,
per the task's stated workflow. Open items requiring the user's decision
(not the designer's) are listed in `../design-spec.md` §4 "Open questions".
