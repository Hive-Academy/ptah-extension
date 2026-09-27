# Design Spec Review - TASK_2026_575_fee7 (Gate 1.7)

| Field | Value |
| --- | --- |
| Artifacts reviewed | `design-spec.md`, `prototype/README.md`, `prototype/index.html`, `prototype/tokens.css`, `prototype/screenshots/*.png` (8) |
| Author | ui-ux-designer (subagent) |
| Reviewer | independent document reviewer (subagent) |
| Execution sides | author: subagent; reviewer: subagent. Same-side review: no CLI lanes (ptah_agent_* tools) available in this cloud session |
| Reviewed revision | 0 |
| Rounds completed | 0 |
| Verdict | **REVISE**: 6 blocking, 15 non-blocking |
| Unresolved items | B1-B6, N1-N15 (all open) |

Baseline: `task-description.md` rev 1 (Gate 1 approved) and `context.md` Gate 0 decisions. Parity inventory not required (additive switcher). Code was checked read-only against `apps/ptah-landing-page/tailwind.config.js`, `apps/ptah-landing-page/src/index.html`, `libs/web/ui/src/lib/navigation.component.ts`, `libs/web/panel-ui/src/lib/panel-layout/panel-layout.html`, `libs/web/members/src/lib/member-layout/{member-layout.html,member-theme-toggle.ts}`, `libs/web/admin/src/lib/admin-layout/admin-layout.html`, and every non-spec `.ts` under `libs/web/landing/src/lib`.

## 1. Requirement traceability

| Req | Spec section | Status |
| --- | --- | --- |
| 3.1 switch in place, URL unchanged | 2.2-2.4 (`setLanguage()`, no navigation) | Met in intent. Not stated explicitly (N14) |
| 3.3 first-visit detection | none | Not a visual decision, but the spec should say detection is silent, with no banner or prompt (N14) |
| 3.6 pre-paint `lang`/`dir` and font start | 3.6 "Loading constraint" (pre-paint script injects the Plex stylesheet when resolved lang is `ar`) | Met. The stack order conflicts with 4.6 (B6) |
| 3.8 switcher a11y | 2.5, 2.6 | **Not met**: panel options are labelled EN/AR (B2); keyboard/ARIA contract is not implementable as written (B3); light-theme focus ring fails contrast (B4) |
| 4.1 physical to logical conversion | 3.1 policy | Met as policy. The spec's own snippet uses physical `left-0` (N1) |
| 4.2 icon mirroring | 3.2 | Partly met. List incomplete, and one rotated chevron is misclassified (N8) |
| 4.3 LTR islands | 3.3 `.ltr-island` | Met |
| 4.4 UGC direction | 3.4 `dir="auto"` | Met |
| 4.5 animated/3D/GSAP sections | 3.5 table | **Not met**: `problem-section` has direction-encoded animations the table says do not exist (B5) |
| 4.6 Arabic font, Latin keeps Inter | 3.6 | **Not met**: the stated stack puts Plex first and omits Inter (B6) |
| 5.2 numbering system | 3.7 `[DECISION]` | Met and clearly flagged as the user's decision. Locale-tag detail and prototype digits need fixing (N10) |
| 6.1 do-not-translate | incidental (prototype keeps "Ptah Builders", "SaaS", "PRD" in Latin) | Implicit only (N14) |
| 8.4 legal notice | 3.8 `[DECISION]`, section 4 item 2 | Met and clearly presented as the user's decision. Styling tokens do not exist in the public theme (N9) |
| Open questions | section 4 (numbering, legal, admin review depth) | Met. Both user decisions are clearly marked and not pre-decided |

Checks that passed:
- Tokens `hairline`, `surface-high` and `base-content-muted` exist in the tailwind config. `btn-primary` is `#f5a524` on `#08090c`, about 9.8:1, in all panel themes.
- The panel header markup quoted in 1 and 2.4 matches `panel-layout.html:17-49` exactly. `member-layout.html:13-35` and `admin-layout.html:11-24` both project through it, so placing the switcher once in `panel-layout` is feasible and satisfies "reachable from all three".
- `openMenu` is a single signal (`navigation.component.ts:167`), and `closeMenuAndRefocus()` finds the trigger by `#${menu}-menu-trigger` (`:926-928`), so `lang-menu-trigger` works.
- Tailwind is `^3.4.18`. `start-*`/`end-*`, `ms/me/ps/pe`, `text-start/end`, `rounded-s/e`, `border-s/e` and the `ltr:`/`rtl:` variants all exist from 3.3 on.
- Measured contrast that passes:
  - Panel inactive `--bcm` on `base-200` is about 4.7:1 dark and about 5.3:1 light.
  - Hover `base-content` on `surface-high` is above 10:1 in both themes.
  - Header `text-white/70` and `text-amber-500` on `slate-950/95` are both above 9:1.
- Dark and light screenshot coverage is correct in scope: only the member shell has a light theme, and public and admin are dark-only in the config.

## 2. Blocking findings

**B1. The screenshots do not render the design, so RTL, the font, 375px clipping and contrast cannot be verified from them.**
- Files: `prototype/screenshots/*.png` (all 8), `prototype/index.html:7,10-13`, `prototype/README.md:5-12,86-92`.
- The Tailwind CDN runtime and Google Fonts did not load at capture time. What the PNGs show:
  - No flex layout in the nav or the panel header; items stack vertically.
  - `hidden` is ignored: the language menu is permanently open, and both check marks show at once (`full-*-1440.png` top band).
  - Native grey button chrome and default blue underlined links.
  - Hero `h2`, `$29` and the CLI block render near-black on near-black. `text-white` never applied, and `body` inherits undefined `--base-content` because `<body>` has no `data-theme`.
  - Latin text is in a DejaVu-like fallback, not Inter or JetBrains Mono. Arabic is in a system face, so nothing shows IBM Plex Sans Arabic.
  - With no `px-*` padding, AR content is cut at the inline-start edge. Examples: "Ptah Builders" and "الدفعة ٤" in `full-ar-*-1440/375.png`, "لوحة التحكم", and the hero `h2` in `full-ar-dark-375.png`.
- The README's "icon sizing safety net" (`index.html:21-26`) suggests the author saw the CDN failure but did not disclose it. The README still says the mock shows the decisions "at real pixel sizes".
- Fix:
  - Make the prototype self-contained: compile the CSS with the project's Tailwind 3.4 and DaisyUI config, or inline it, and self-host or vendor the fonts.
  - Recapture all 8 shots and confirm by eye: mirrored layout, LTR islands, Plex Arabic glyphs, no clipping at 375.
  - Add a closed-menu state and one shot with the header menu open, per direction.

**B2. The panel-skin options are labelled "EN"/"AR", which violates 3.8.**
- `design-spec.md:232-239` renders the panel radios with text `EN`/`AR` and no `aria-label`, so their accessible names are "EN"/"AR".
- 3.8 requires each option to be "labelled in its own language ('English', 'العربية')". The spec's own rule at `:272-274` says the same, so the spec contradicts itself.
- Fix: either show `English`/`العربية` visibly, or keep `EN`/`AR` visible with `aria-label="English"`/`"العربية"` plus the `lang` attribute. Then reconcile with 2.5.3 (see N11).

**B3. The keyboard and ARIA contract cannot be built as written.**
- Panel skin (`design-spec.md:283-292`):
  - `<button role="radio">` gets no native arrow-key handling and no single tab stop. That needs roving `tabindex` plus key handlers.
  - The claim that `←`/`→` "swap meaning automatically … browser-native … no bespoke key-remapping code" is false for ARIA radios. The code must read the computed direction.
- Header skin:
  - `:275-282` requires focus to move into the menu on open, plus `↑`/`↓` roving. None of the existing menus has this (`navigation.component.ts:259-305` has only toggle, Escape and outside-click), which contradicts "zero new wiring" at `:128-130`.
  - Item selection is specified to refocus the trigger through `closeMenuAndRefocus` (`:279-280`), but the snippet calls `closeMenu()` (`:145,153`), which does not refocus (`navigation.component.ts:272-274`).
- Mobile (`:175-185`): a `role="radiogroup"` with `role="radio"` children inside `#mobile-menu`, which is `role="menu"` (`navigation.component.ts:466-469`). That is invalid required-owned-element structure, and axe flags it (`aria-required-children`).
- Fix:
  - Specify the roving `tabindex` and key handling, including the RTL arrow inversion, as an explicit part of the component.
  - Make the snippets match the text: select → set language → refocus the trigger.
  - Use `role="group"` with `menuitemradio` inside the mobile `role="menu"`, or move the row outside the menu element.

**B4. The light-theme focus indicator fails non-text contrast, and the contrast claims are not measured.**
- `design-spec.md:258` applies `focus-visible:outline-amber-400` ("same utility") to the panel radios.
- In `operator-member-light`, the outline `#ffbb4d` sits against the `base-200` header `#ffffff` at **1.68:1**, below the 3:1 of WCAG 1.4.11.
- It also departs from the panel's own convention: `MemberThemeToggle` relies on DaisyUI's `btn` focus ring in `base-content` (`member-theme-toggle.ts:37-38,54`).
- `:243-248` asserts "≥ 4.5:1 in all three" without figures and repeats "amber-on-near-black" three times.
- Fix:
  - In the panel skin, use the DaisyUI `btn` focus ring, or a `base-content` outline.
  - Add a measured contrast table covering default, hover, focus and selected in `operator`, `operator-admin`, `operator-member` and `operator-member-light`.

**B5. The animated-section inventory misses direction-encoded animation in `problem-section`.**
- `design-spec.md:378` classes `problem-section.component.ts` as "Mirror. No horizontal-scroll or direction-encoded animation logic found (grep found none)". The code shows otherwise:
  - The narrative uses `animation: 'slideRight'`, commented "slide in from the left" (`problem-section.component.ts:199-205`).
  - The chart uses `slideLeft`, "slide in from the right" (`:207-213`).
  - An SVG chart has a physical x-axis f1→f13 (`:86-163`, data `:190-197`).
- Under RTL the columns swap, so the entrance directions point the wrong way unless mirrored. The chart axis needs an explicit keep-LTR decision.
- This is the risk the requirements assign to the designer (Risks row "GSAP, 3D and horizontal-scroll…").
- Fix: add a row for `problem-section` covering slide directions (mirror) and the chart (keep-LTR, `dir="ltr"` island). Re-run the grep for `slideLeft|slideRight|x:|xPercent|scaleX|transformOrigin` over `libs/web/landing` and record the result. Lower-risk omissions are in N-list item N5a.

**B6. The Arabic font stack violates 4.6 ("English, Latin and mono text shall keep Inter").**
- The spec's documented stack (`design-spec.md:415`) is `'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif`: Plex first, and Inter missing.
- The prototype applies Plex first on `html[lang="ar"]` (`index.html:17`, `tokens.css:89`). With that order, "Ptah", "SaaS", "Builders" and every Latin run in an Arabic page render with Plex's Latin glyphs, not Inter.
- `:440` ("`fontFamily.sans` gaining the Arabic family") does not fix the order.
- Fix: state the stack explicitly as `['Inter', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'system-ui', …]`. Inter has no Arabic glyphs, so Arabic falls through per glyph and Latin stays Inter in both languages. The `[lang="ar"]` rule is then needed only for metrics (line-height), not for the family.

## 3. Non-blocking findings

- **N1** `design-spec.md:132-140`: the header menu snippet uses physical `left-0`, and the prose says to "mirror left/right anchoring", which contradicts 4.1. Specify `start-0` (Tailwind ≥3.3). The prototype uses `ltr:left-0 rtl:right-0` (`index.html:85`); prefer the logical utility.
- **N2** `design-spec.md:89-92`: "between `Docs` and the `Login`/`Sign Up` (or `User` menu) cluster" is inaccurate. `Community` sits between Docs and Login (`navigation.component.ts:166-181,318-333`), and the authenticated `User` menu comes after `Download Ptah` (`:337-357`). Specify: after Community, before Login (signed out) or before Download (signed in).
- **N3** `design-spec.md:207-223`: inserting before `<ng-content>` gives the member order [Lang][Signed in as][email][ThemeToggle] (`member-layout.html:21-35`). That is not the "adjacent preferences cluster" claimed. The prototype shows a different order again (`index.html:139-153`). Either move `MemberThemeToggle` first in the member projection or drop the claim. Also say "start of", not "left of", and verify the admin header at 375 (title + `Restricted` badge + email + switcher).
- **N4** `design-spec.md:373`: the builders marquee row is self-contradictory. It says "Keep-LTR direction of travel" and also negate `from`/`to` under RTL. It also cites `buildMarqueeLoop`, but the function is `buildMarquee` (`builders-section.component.ts:486-507`). State one decision.
- **N5** `design-spec.md:375`: the tug-meter labels use `justify-between` (`comparison-tug-meter.component.ts:83,109,149`), which mirrors while the bars stay LTR, so labels land on the wrong segments. Wrap the whole meter in a `dir="ltr"` island. Also, `:175`'s `left-[38%] -translate-x-1/2` is a 38% marker, not a centring pair as `design-spec.md:314-315` states; correct the exemption reason.
- **N5a** `design-spec.md:369-387`: rows are missing for `terminal-mock` (`@keyframes` cursor, needs an explicit LTR island), `device-frame`, `waitlist-form`, `comparison-section` and `landing-page.component.ts:82` (`overflow-x: hidden`, which can mask the horizontal overflow that 4.5 must detect). Traceability `:543` says "15 components", but there are 19.
- **N6** `design-spec.md:443-453` and `tokens.css:90-92`: `[lang="ar"] { letter-spacing: normal }` on the root does not override descendants' own `tracking-*` or the `8xl`/`9xl` `letterSpacing`. Target descendants, for example `:lang(ar) :where([class*="tracking-"], .text-8xl, .text-9xl)`, and exclude `font-mono` and `[lang="en"]` islands.
- **N7** `design-spec.md:391-393,540`: Inter is loaded at 400-800 (`index.html:89`), not four weights, and the hero uses `font-extrabold`. Plex Arabic stops at 700. State that 800 maps to 700 for Arabic, to avoid synthetic bold.
- **N8** `design-spec.md:333-341`, the icon list, is incomplete:
  - `Send` (10 usages), `Reply` (6) and `LogOut` (4) are omitted or marked no-mirror. `LogOut` is conventionally mirrored.
  - `ExternalLink` (10) is not classified.
  - Text arrows `→`/`←` appear in admin templates, for example `needs-attention-queue.ts` and `data-table.ts`.
  - `panel-layout.html:95` rotates `ChevronDown` by `-90°` into a right-pointing chevron, which must mirror. That contradicts "never mirror ChevronDown".
  - The counts (66) do not reproduce; a grep of `libs/web` finds 38.
- **N9** `design-spec.md:494-498`: the legal notice uses `border-hairline`/`bg-base-200`, but the public `operator` theme defines no `--border-hairline`, and no public lib uses it. Use `operator`-native classes (the `ink-*`/`amber-*` vocabulary of the legal pages).
- **N10** `design-spec.md:476-477`: the numbering choice must also cover dates. Specify the locale tag `ar-u-nu-latn` (or `numberingSystem` on DateTimeFormat as well), not only `Intl.NumberFormat`. The prototype shows Arabic-Indic digits ("الدفعة ٤", "أ٢" at `index.html:109,135`), which contradicts the recommendation the user is asked to confirm.
- **N11** `design-spec.md:108,112`: the visible trigger text `EN`/`AR` is not contained in the accessible name "Language: English" (WCAG 2.5.3, which `member-theme-toggle.ts:32-34` explicitly honours). Also, the panel skin uses `btn-xs` (24px) while claiming to match `MemberThemeToggle`'s `btn-sm` (`:81,537`).
- **N12** `design-spec.md:260`: in the light theme, the selected fill (`#f5a524`) against the white header is 2.04:1. The state is also carried by text colour and `aria-checked`. A check mark or a `base-content` border on the selected segment would make it robust under 1.4.11.
- **N13** `design-spec.md:67,108,230`: pin the host lib per skin: header in `libs/web/ui`, panel in `libs/web/panel-ui`. Pin the owning scope for `nav.language` and `common.language` per 2.1, or merge them into one key.
- **N14** Add a requirement→section map for 3.1, 3.3 and 6.1. State that first-visit detection is silent, and how Latin do-not-translate terms and punctuation behave inside Arabic sentences.
- **N15** `tokens.css:30-31` adds `--surface-high`/`--border-hairline` to `operator`, which the real theme lacks. This contradicts "copied 1:1" (`tokens.css:1`, `README.md:5-8`).

## 4. Required for next round

Resolve B1-B6. Recapture the screenshots and confirm them by eye. Address or explicitly defer N1-N15. The two `[DECISION]` items (numbering, legal governing language) stay with the user at Gate 1.7 and are correctly not pre-decided.
