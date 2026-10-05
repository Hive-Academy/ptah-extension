# Visual Review - TASK_2026_594_31ff

Verdict: **ISSUES** (no layout breakage; 4 Serious, 3 Moderate). Score 6/10.

## Environment

- Harness: Playwright (Chromium) spec `visual/status-kinds.e2e.spec.ts` + `visual/playwright.config.ts` (task folder only; adapted from TASK_2026_494_ca38 Apps harness). It boots the REAL built webview `dist/apps/ptah-extension-webview/browser` (Electron-host shim), opens the Apps page and pushes a `dashboard-spec/2` + `dashboard-catalog/3` snapshot through `surface:updated`, so it renders through the real `SurfaceRendererComponent` / `surface-node.component.ts` with the real Tailwind/daisyUI CSS. `forceTheme` sets `data-theme` to `anubis` / `anubis-light`.
- Build confirmation: dist was built after the last code commit per the brief (dist index.html 02:32 today; bundle contains the new `radial-progress` code). Not rebuilt by me.
- Fonts: external Google font requests were blocked (offline) so system fallback fonts render; this does not affect colour or layout conclusions but text metrics may differ slightly.
- Viewports (audit selection, not a support contract): 1440x2300 and 400x3400 (tall to avoid scroll clipping), both themes. Four configurations total.
- Raw measurements: `visual/measurements.json` (computed colours converted via canvas, WCAG contrast ratios, bounding boxes).
- Screenshots: `visual/screenshots/` - `status-kinds-{anubis,anubis-light}-{1440,400}.png` (surface body), `page-*.png` (full app page), `badge-focus-{anubis,anubis-light}-1440.png`. 10 PNGs.

## Summary of checks requested

| Check | Dark (anubis) | Light (anubis-light) |
| --- | --- | --- |
| 4 alert tones distinguishable | yes (blue/green/orange/red) | yes |
| Alert text contrast >= 4.5 | FAIL info 2.95, success 2.64, error 3.87; warning 6.61 ok | FAIL error 4.12; info 5.09, success 6.01, warning 5.66 ok |
| Alert without title compact, no empty gap | PASS: 1 child, 37px high, same height as titled; no title element rendered | PASS (same) |
| 6 badge tones distinguishable | yes; neutral is near page colour (bg vs page 1.12:1) but has text | yes |
| Badge text contrast | FAIL info 2.95, success 2.64, error 3.87 (10px font) | primary/info/success/warning/error pass (4.12 error fails) |
| Progress fill/percent | PASS: 0/42.5/100 fill correct, `42.5%` shown unrounded | PASS |
| Radial fill/percent | PASS fill proportional, text shown. Neutral at 0 is invisible (ring 1.12:1) | PASS; ring 1.4-2.6:1 for primary/info/success/warning |
| Vertical divider | FAIL: rule not drawn (see S1) | FAIL |
| Overflow | PASS: surface body scrollWidth == clientWidth at 1440 and 400 | PASS |
| Selectable badge focus ring | PASS: 2px solid, 2px offset, `:focus-visible` true | PASS but weak (see M2) |
| Stat (regression) | renders normally, no regression | renders normally |

## Findings by severity

### Serious

**S1. Vertical divider draws no rule (both themes, 1440 and 400).**
- Screenshots: `status-kinds-anubis-1440.png`, `status-kinds-anubis-light-1440.png`, `status-kinds-anubis-light-400.png` ("Vertical divider" row: "Left side | Right side or Third" shows no vertical line).
- Evidence: class mapping is correct (`vertical` -> `divider divider-horizontal`, `aria-orientation="vertical"`, flex-direction column, `::before` width 2px), so the daisyUI inversion is handled. But the measured height of the untitled vertical divider is 0px and `::before` height is 0px; with text ("or") the element is 53px high but `::before` is still 0px, so only the word shows.
- Probable cause (`dashboard-divider.component.ts` / `surface-layout.component.ts:128`): `ptah-dashboard-divider` is a custom element with default display; in the horizontal stack (`flex flex-row flex-wrap`) the host stretches but the inner `<div class="divider divider-horizontal">` has no height to fill. Not verified by experiment (no product edits allowed).
- Impact: the vertical divider kind is effectively invisible.
- Fix: give the host `display: contents` or `display: flex; align-self: stretch` (and `:host > .divider { height: 100% }`), then re-verify.

**S2. Tone text contrast below 4.5:1 for alert and badge text.**
- Dark: info 2.95, success 2.64, error 3.87 (white-ish text on blue/green/red). Light: error 4.12. Badges use 10px text, so the large-text 3:1 allowance does not apply. Screenshots: `status-kinds-anubis-1440.png`, `status-kinds-anubis-light-1440.png`. Source of the colours is the daisyUI theme tokens (`*-content` vs `*`), i.e. a theme-token problem, not a component bug; still a defect for these kinds' readability.
- Fix: adjust `anubis`/`anubis-light` info/success/error + `-content` token pairs to reach 4.5:1, or darken alert/badge text.

**S3. Tone is not perceivable without colour (except alert via sr-only).**
- Alert: the word (info/success/warning/error) is only in an `sr-only` span, plus role `alert`/`status`. Sighted colour-blind users get no visible cue; there is no icon.
- Badge, progress, radial-progress: no non-colour cue at all, not even sr-only; tone can be seen only by hue. (Badge text is author supplied, so an author can encode it, but the renderer does not.)
- Fix: add a visible icon or text prefix for alerts, and tone text/aria-description for badge/progress/radial.

**S4. Neutral radial-progress is invisible in the dark theme; weak ring contrast in light.**
- Dark `text-neutral` ring vs page 1.12:1: the 0% neutral radial shows as a faint dot and its "0%" label is barely readable (`status-kinds-anubis-1440.png`, Radial row, "Zero"). Light: primary 1.40:1, info 2.59, success 2.37, warning 2.46 vs page (below 3:1 non-text criterion; the "42.5%" label inside the primary ring is also pale). Progress bars are fine (fill measured 14.9:1 dark / 15.9:1 light for neutral).
- Fix: use a base-content-derived colour for neutral, and darker ring colours/ text for light theme.

### Moderate and minor

- M1. Narrow width (400px): daisyUI stacks and centres alert content (`status-kinds-anubis-light-400.png`); titled alerts become centred title-over-body blocks (72px). Untitled alerts remain compact (37px). Acceptable but alignment differs from desktop.
- M2. Focus ring colour is a pale yellow (`rgb(245,217,125)` in light, 2px, offset 2px). Visible and fully rendered, but ~1.3:1 against the light page background (`badge-focus-anubis-light-1440.png`); strong enough in dark (`badge-focus-anubis-1440.png`). Borderline for 2.4.7/1.4.11.
- M3. Progress layout: label, bar and percentage stack on three lines (about 62px per item); the percentage sits below the bar rather than beside it (`status-kinds-anubis-1440.png`). Functional, a bit tall. Badge text is 10px with 16px height (target for the selectable badge is below 24x24 CSS px; WCAG 2.2 AA 2.5.8 target-size exception for spacing may apply but unverified).
- Note: at 400px the document scrolls horizontally (docScrollW 593 vs 400), but the surface body does not (400/400), so it originates from app shell chrome outside this task; baseline not compared.

## Prototype fidelity

- Approved prototype: not applicable to this review (no prototype supplied in the brief). Before/after not performed; the existing stat kind renders correctly in both themes (`status-kinds-*-1440.png`, bottom).

## Per-kind result

| Kind | Dark | Light | Notes |
| --- | --- | --- | --- |
| alert | ISSUES (S2, S3) | ISSUES (error, S3) | titleless note compact: PASS |
| badge | ISSUES (S2, S3, M3) | OK except error | selectable focus ring present |
| progress | PASS (S3 only) | PASS | values 0/42.5/100 correct |
| radial-progress | ISSUES (S4) | ISSUES (S4) | fill correct |
| divider horizontal (with/without text) | PASS | PASS | |
| divider vertical | FAIL (S1) | FAIL (S1) | |
| text-block heading (h3 18px/600) / body (p 16px) | PASS | PASS | contrast 14.9 / 15.9 |
| stat (regression) | PASS | PASS | |

## Verdict

- Recommendation: REVISE (ISSUES).
- Confidence: HIGH for measured values; MEDIUM for the S1 root-cause hypothesis.
- Key concern: the vertical divider renders no visible rule; second is sub-4.5:1 tone contrast and colour-only tone signalling.

## Round 2 re-check (after fix round)

Harness: `visual/status-kinds.e2e.spec.ts` (screenshot suffix `-r2`, raw data in `visual/measurements-r2.json`, Playwright output dir `visual/pw-out`). Rebuilt dist (index.html 02:41, bundle CSS contains `h-full`). Themes anubis / anubis-light at 1440 and 400. Round-1 screenshots kept unchanged as "before". Screenshots: `visual/screenshots/status-kinds-{anubis,anubis-light}-{1440,400}-r2.png`, `page-*-r2.png`, `badge-focus-*-1440-r2.png`.

| Finding | Result | Measurement | Screenshot |
| --- | --- | --- | --- |
| S1 vertical divider draws a rule | FAIL | Untitled vertical divider still h=0px, `::before` height 0px (all 4 configs). Titled ("or") h=53px, `::before` 0px. Horizontal dividers unchanged (752x16 / 368x16, `::before` 2px thick). Host classes `self-stretch flex` ARE applied (host display flex, align-self stretch) but host height is 0 (untitled) because the host is not a direct child of the flex row: there is an unclassed wrapper element between the host and the `flex flex-row flex-wrap` stack container (`rowCls ''`, 53px), so `self-stretch` stretches within that wrapper rather than the row. `h-full` on the inner then resolves against a 0px (auto) parent. Still no visible rule. | `status-kinds-anubis-1440-r2.png`, `status-kinds-anubis-light-400-r2.png` ("Vertical divider" row) |
| S2 alert text contrast >= 4.5 (all 4 tones) | PASS | Alert text vs bg-base-200 surface: 13.89:1 dark, 14.21:1 light, identical for info/success/warning/error, 1440 and 400. Tone border vs page 5.04-6.70 dark; light 2.59 / 2.37 / 2.46 / 6.94 (border is decoration, tone is also carried by label and icon). | `status-kinds-anubis-1440-r2.png`, `status-kinds-anubis-light-1440-r2.png` |
| S3 visible tone label + icon; untitled compact; order | PASS (1440) | All 8 alerts have an svg icon and a visible `alert-tone` label (Info/Success/Warning/Error, non-zero size, not sr-only). Untitled: 2 children (svg, label), no title element, 37px, same height as titled (37px). Titled: order svg > tone label > title > text ("Info info title Body text ..."). Icon vs surface: dark 4.71-6.26; light 2.12-2.32 for info/success/warning (below 3:1 non-text, but the visible label carries the tone), error 6.2. At 400px daisyUI stacks and centres alerts (104px untitled, 140px titled): this is the deferred narrow-layout item, unchanged in kind from M1. | `status-kinds-anubis-1440-r2.png`, `status-kinds-anubis-light-400-r2.png` |
| S4 neutral radial ring visible | PASS | Neutral ring class now `text-base-content`; ring vs page 14.86:1 dark (was 1.12), 15.92:1 light (was neutral not flagged, now strong). Zero ring renders as a visible dot with readable "0%". Note: non-neutral light rings unchanged at 1.40 primary / 2.37 success / 2.46 warning / 2.59 info (out of this round's scope). | `status-kinds-anubis-1440-r2.png`, `status-kinds-anubis-light-400-r2.png` |
| Regression: other kinds and stat | PASS | text-block h3 18px/600 and p 16px, contrast 14.86 / 15.92; progress values 0 / 42.5 / 100 / 60 / 30 / 50 and percent text unchanged, fill 14.86 / 15.92; radial fills and percent text unchanged; badge set unchanged; surface body scrollWidth == clientWidth at 1440 (784) and 400 (400); stat renders normally. | r2 screenshots |

Unchanged / deferred to later tasks (not failures of this round): badge text contrast (info 2.95, success 2.64, error 3.87 dark; error 4.12 light), badge and progress colour-only tone, selectable-badge focus ring (pale, ~1.3:1 on light), narrow (400px) layout, document-level horizontal scroll at 400px (docScrollW 593, outside the surface body).

Round 2 verdict: ISSUES
(S2, S3, S4 fixed. S1 vertical divider still draws no rule: the `self-stretch`/`h-full` fix does not reach the flex row because an unclassed wrapper sits between the divider host and the stack container; the fix must go on that wrapper or use `align-self`/height on the element that is the actual flex item, then re-verify.)

## Round 3 re-check (S1 correction)

Harness: `visual/status-kinds-r3.e2e.spec.ts` (copy of the R2 spec, adds ::before rule colour and row overflow probes). Themes anubis and anubis-light, 1440 and 400. Raw data: `visual/measurements-r3.json`. Screenshots in `visual/screenshots/`: `status-kinds-{anubis,anubis-light}-{1440,400}-r3.png`, `page-*-r3.png`, `badge-focus-*-1440-r3.png`.

| Check | Result | Measurement (identical in all 4 theme/width combos) | Screenshot |
| --- | --- | --- | --- |
| Vertical divider, no text: element and ::before height > 0 | PASS | element 16x48, ::before 2x24 (two rule halves = 48px), visible rule between "Left side" and "Right side" | status-kinds-anubis-1440-r3.png, status-kinds-anubis-light-400-r3.png |
| Vertical divider, with text ("or"): element and ::before height > 0 | FAIL | element 16x53, ::before 2x**0px**; no rule drawn around "or". Text (about 21px) plus two 16px gaps equals 53px, which leaves no free height for the pseudo-elements to grow. min-h-12 (48px) is smaller than text plus gaps, so it does not help | status-kinds-anubis-1440-r3.png (the "or" cell has no rule) |
| Rule contrast vs background >= 3:1 | N/A (parity) | The rule is a 10% alpha fill of the content colour. This is the same token as the horizontal dividers, so the rule is a subtle decorative line by design. The raw ratio from the harness ignores alpha, so it is not a valid measure (14.57 dark, 16 light) | n/a |
| Horizontal dividers unchanged | PASS | 7 dividers, each 16px high with ::before 2px high, the same as R2 | same |
| Row layout / overflow | PASS | Vertical row is 53px high with no clipping. Surface body scrollW equals clientW (784 at 1440, 400 at 400). The document scrollW of 593 at 400px is the same as R2 and comes from the harness shell, not the surface | page-*-400-r3.png |
| No regression in other kinds | PASS | alerts 8, badges 7, progress 7, radial 6, the same counts as R2. Alert and badge contrast values are identical to R2 | status-kinds-*-r3.png |

Round 3 verdict: ISSUES

Remaining defect: a vertical divider with text still draws no rule, because its ::before height is 0. Suggested fix (frontend-developer to apply): give the text variant a taller definite height, for example min-h-24 or more when text is present, or drop the daisyUI text slot for the vertical orientation. The textless variant is fixed.
