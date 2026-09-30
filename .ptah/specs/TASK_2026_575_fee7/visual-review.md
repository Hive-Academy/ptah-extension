# Visual Review - TASK_2026_575_fee7

## Batch 11

### Summary

| Metric            | Value                                                                                |
| ----------------- | ------------------------------------------------------------------------------------ |
| Overall score     | 5/10                                                                                 |
| Assessment        | REJECTED (visual-breaking finding present)                                           |
| Visual breaking   | 1                                                                                    |
| Serious           | 1                                                                                    |
| Moderate          | 1                                                                                    |
| Viewports tested  | 6 (320, 375, 768, 1024, 1366, 1920)                                                  |
| Screenshots taken | 44                                                                                   |
| Components tested | Public header language switcher (desktop menu + mobile row), footer, countdown timer |

### Environment

- Build verified: `node_modules/.bin/nx build ptah-landing-page` (production config) run fresh in this session, succeeded (`Prerendered 6 static routes`, output at `dist/ptah-landing-page/browser`, build timestamp 2026-09-27T17:56:11.881Z). Not a stale bundle — the build was run against the current uncommitted working tree (`git status` confirmed `navigation.component.ts`, `footer.component.ts`, `countdown-timer.component.ts`, `console-grid-background.component.ts`, `session-calendar/*` all modified and included).
- Served via `npx http-server dist/ptah-landing-page/browser -p 4300 -s -c-1` (static, no SPA rewrite needed — all testing was on `/` and prerendered `/pricing`, `/terms-and-conditions`).
- Browser: Chromium (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`) driven via Playwright (`node_modules/playwright` in-repo). No `ptah_browser_*` tools were available in this session (not listed as callable tools); Playwright scripts were used instead, matching the task's fallback instruction.
- Language forced via `page.addInitScript` setting `localStorage['ptah.lang']` before navigation, confirmed by reading `document.documentElement`'s `lang`/`dir` after load (`en`/`ltr` and `ar`/`rtl` respectively, at every tested width).
- Theme: the public marketing header/footer/countdown run on the dark-only `operator` theme, as documented in `design-spec.md` §1 ("Public header … on `ink-900/950`") and confirmed visually (no light variant exists or was tested — this is expected, not a gap).
- Viewports covered: 320, 375, 768, 1024, 1366, 1920 (audit selection around Tailwind's `sm`/`md`/`lg` breakpoints and the widths the design spec's own screenshot gate names — 375/1440 — not a documented support matrix; the repo does not publish one for the landing page).

### Findings by severity

#### Visual breaking

##### 1. Desktop nav collapses at 768–800px: home logo disappears (0 px wide) and the primary CTA text is clipped, in both languages

- File: `libs/web/ui/src/lib/navigation.component.ts:87-101` (logo `<a>`, `flex items-center gap-3`, no `shrink-0`) and `:430-443` (Download CTA, fixed padding, no `shrink-0`/`whitespace-nowrap`); root nav row `:77-86` (`flex items-center justify-between`, no `flex-wrap`).
- Viewports affected: 768px and 800px, confirmed in **both** `en` and `ar`. Programmatic sweep (320/375/600/700/760/767/768/769/800/900/1024/…) shows the logo `<img>` bounding box goes from `44px` wide at 767px to **`0px`** wide at 768px and 769px in both languages, then partially recovers at 800–1024px (9.8–43px) before returning to the full 44px at ≥1200px.
- Screenshots: `BUG-logo-collapse-ar-768.png` (logo is entirely absent from the row), `BUG-logo-collapse-en-768.png` and `BUG-logo-collapse-en-768-tall.png` (the amber "Download Ptah" CTA is visually clipped by the viewport edge — only "Do" is legible before the button is cut, "Ptah" wraps below still clipped; "Sign Up" also wraps to two lines).
- Problem: at exactly the `md` breakpoint (768px) — the breakpoint `design-spec.md` §2.2 names explicitly as where the desktop nav row (including the new language switcher) turns on (`hidden md:flex`) — the flex row's total content (Product, Pricing, Docs, Community, **the new language switcher**, Login, Sign Up, Download CTA) exceeds the available width. Neither the logo `<a>` nor the Download CTA carries `shrink-0`, so the browser's default flex-shrink algorithm shrinks every item, including the logo, down toward zero before the row's inline content overflows the viewport's own edge (no horizontal scrollbar appears — `document.documentElement.scrollWidth === clientWidth === 768` at every width tested — because the overflowing content is simply clipped at the fixed-width nav's edge, the exact silent-clipping risk `design-spec.md` §3.5 itself warns about for `overflow-x: hidden`).
- This reproduces identically in English, so the underlying missing `shrink-0`/wrapping is not new RTL-specific code from this batch — but the **new language-switcher menu item this batch adds** (`navigation.component.ts:337-408`) is exactly the extra content that pushes the row's total width into the failing band at this specific, spec-named breakpoint, and neither the design spec's normative markup (§2.2) nor the executor's own capture set (`screenshots/batch-11/`, which only shot 375 and 1440) exercised 768px, so this went undetected before this review.
- Impact: at 768px (a legitimate tablet/split-screen desktop width, and the exact width the design spec names as "desktop"), a visitor cannot see the brand mark or click home via the logo, and cannot read or reliably hit the primary "Download Ptah" conversion CTA, in either language — this is the single most important defect in the build under review.
- Fix: add `shrink-0` to the logo `<a>` (`:88`) and to the Download CTA `<a>` (`:431`), and/or add `flex-wrap` to the nav's own `justify-between` row (the same fix pattern `design-spec.md` §2.4/B7 already prescribes for the panel-shell header at 375px) so the desktop item cluster wraps to a second row instead of squeezing the logo and CTA to invisibility. Re-verify at 768, 800 and 900px in both languages once fixed.

#### Serious

##### 2. Countdown timer reads smallest-to-largest (seconds→days) left-to-right in Arabic, reversing the universal D:H:M:S convention

- File: `libs/web/ui/src/lib/countdown-timer.component.ts:37-38` (outer `<div class="flex items-start justify-center gap-2 sm:gap-3" role="timer">`, no `dir`/`.ltr-island` on the row itself) versus `:46` (`.ltr-island` is applied only to each digit's own `<span>`, not to the row that orders the four cells).
- Viewports affected: reproduced at both 375 and 1366 (RTL only; English is correct at both widths).
- Screenshots: `countdown-pricing-en-1366.png` (English, correct order left→right: `DAYS(03) : HRS(06) : MIN(00) : SEC(32)`) vs. `countdown-pricing-ar-1366.png` (Arabic, same instant class, order left→right: `17(ثواني/seconds) : 00(دقائق/minutes) : 06(ساعات/hours) : 03(أيام/days)` — exactly reversed); confirmed again at 375px on the home page's Builders section countdown: `countdown-home-ar-375.png` shows `14 : 00 : 06 : 03` under `ثواني : دقائق : ساعات : أيام` (seconds-first), while `countdown-home-en-375.png`/`countdown-pricing-en-375.png` read days-first.
- Problem: `cells()` (`countdown-timer.component.ts:103-123`) always builds the array in fixed `[days, hours, minutes, seconds]` document order. Because the surrounding flex row is not itself direction-locked (only each individual digit box is, via `.ltr-island` on the number span, which isolates bidi _text_ but does nothing to the flex _item order_ of its siblings), the browser's native RTL flexbox reverses the visual position of the four cells, so the physical reading order becomes seconds→minutes→hours→days. Each cell's own label still correctly matches its own value (the bug is not a label/value mismatch), but the compound widget as a whole now reads backwards relative to the universal countdown convention — the same "data convention, not reading direction" class of problem `design-spec.md` §3.5 already identifies and fixes for the `problem-section` SVG chart's x-axis and the `comparison-tug-meter`'s whole-widget LTR island, just not extended to this component.
- Impact: an Arabic-reading user scanning left-to-right for "how much time is left" sees `17` first and, following normal digit-clock convention, is likely to misread it as the largest unit (parsing it as "17 days" when it is actually 17 seconds), materially misleading a time-sensitive early-adopter-offer countdown. This is not layout breakage (no clipping/overflow — `scrollWidth === clientWidth` in every capture) so it is filed as Serious rather than Visual breaking, but it is a real, repeatable correctness defect in the exact file this batch modifies.
- Fix: wrap the outer cell row (`countdown-timer.component.ts:37`) in the same `.ltr-island` treatment already used per-digit, or add `dir="ltr"` directly on that `<div>`, so the four cells keep their D→H→M→S document order under RTL exactly as they do under LTR. The `aria-label` (`ariaParams()`, unaffected by DOM/visual order) already announces the correct day/hour/minute/second values, so no accessibility-tree change is needed — this is a sighted-user visual/reading-order fix only.

#### Moderate and minor

- **Moderate** — Desktop nav is visually cramped at 1024px in Arabic: the language-switcher trigger area and the "المنتج" (Product) link sit almost flush against the round logo with near-zero gap, and the primary "Ptah" CTA wraps its label onto two lines ("تنزيل" / "Ptah"). `top-ar-1024.png`. Not a breaking overlap, but reads visually tighter than the equivalent English row at 1024px and than either language at ≥1200px; likely the same missing `shrink-0`/`flex-wrap` root cause as finding 1, at a lower intensity. `navigation.component.ts:77-86, 337-408`.
- **Minor** — none observed beyond the above within this batch's scope (icon alignment, elevation/radius variance): the check icon, hover, and focus-ring treatments in the language menu all matched the design spec's pixel-level intent in every capture reviewed.

### Prototype fidelity

- Approved prototype: `/home/user/ptah-extension/.ptah/specs/TASK_2026_575_fee7/prototype/index.html` and `prototype/screenshots/` (esp. `header-menu-open-{en,ar}-1440.png`).
- Fidelity assessment: **MATCHES** (language switcher only — the prototype's hero/footer copy shown in its screenshots reflects a later batch's content and is not compared here).
- Deviations observed: none in the switcher itself. Side-by-side comparison of `prototype/screenshots/header-menu-open-ar-1440.png` against this build's `kb-menu-open-ar.png`/`hover-english-option-ar.png` confirms: same trigger shape (globe icon, `AR`/`EN` code, chevron), same `start-0`-anchored panel position (right-anchored under RTL, matching the prototype exactly), same check-icon-marks-selection pattern, same "English" (unchecked, top) / "العربية" (checked, bottom) option order and per-option `lang`/`dir`. Logo/brand mark is not mirrored in either build, matching §3.1's explicit exemption. No unapproved component substitution (no badge/tooltip/text-button swap) was found.
- Before/after comparison (no prototype): not applicable — a Gate 1.7 prototype exists and was used for the above comparison instead.

### Viewport results

| Screen / state                                   | Widths checked             | Status                                                                         | Screenshot(s)                                     |
| ------------------------------------------------ | -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Home page top (header + hero), EN                | 320,375,768,1024,1366,1920 | FAIL at 768 (finding 1); PASS elsewhere                                        | `top-en-*.png`                                    |
| Home page top (header + hero), AR                | 320,375,768,1024,1366,1920 | FAIL at 768 (finding 1); cramped at 1024 (moderate); PASS at 320/375/1366/1920 | `top-ar-*.png`, `BUG-logo-collapse-ar-768.png`    |
| Mobile hamburger menu (language row), EN/AR      | 375                        | PASS — no overflow, correct mirroring, touch targets 150.5×40.5px              | `mobile-menu-open-{en,ar}-375.png`                |
| Desktop language menu open, EN/AR                | 1366                       | PASS — matches prototype                                                       | `kb-menu-open-ar.png`, `top-en-1366.png` (closed) |
| Footer, EN/AR                                    | 375,1366                   | PASS — correct mirroring of brand block/columns/legal row, no overflow         | `footer2-{en,ar}-{375,1366}.png`                  |
| Countdown timer (pricing + home/builders), EN/AR | 375,1366                   | FAIL — reversed cell order in AR (finding 2); PASS in EN                       | `countdown-*-{en,ar}-{375,1366}.png`              |

### Component and interaction results

| Component                                 | States tested                                                                                                                                                                                        | Status                                                                                                                                                                                                                                                                                                                                 | Screenshot(s)                                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop language-menu trigger             | default, hover(implicit via color class), focus-visible (Tab), open/closed (chevron rotation), active-language color                                                                                 | PASS                                                                                                                                                                                                                                                                                                                                   | `top-ar-1366.png`, `kb-trigger-focus-ar.png`                                                                                                                                |
| Desktop language-menu options             | default, hover, focus-visible (Tab, document order per spec), checked (check icon + `aria-checked`), keyboard select (Enter/Space via click, refocus trigger)                                        | PASS                                                                                                                                                                                                                                                                                                                                   | `hover-english-option-ar.png`, `kb-item1-focus-ar.png`, `kb-item2-focus-ar.png`                                                                                             |
| Escape key                                | opens via Enter on trigger, closes via Escape, refocuses trigger, selection unchanged                                                                                                                | PASS (verified programmatically: `triggerFocused=true`, `menuOpen=false` after Escape)                                                                                                                                                                                                                                                 | n/a (state assertion)                                                                                                                                                       |
| Mobile language row (segmented)           | default, checked/unchecked colors, touch target size                                                                                                                                                 | PASS (150.5×40.5px, exceeds 24×24 AA and 44×44 AAA guidance)                                                                                                                                                                                                                                                                           | `mobile-menu-open-{en,ar}-375.png`                                                                                                                                          |
| Footer social icons / columns / legal row | default, RTL mirror                                                                                                                                                                                  | PASS                                                                                                                                                                                                                                                                                                                                   | `footer2-{en,ar}-1366.png`                                                                                                                                                  |
| Countdown timer digit cells               | live-tick (not screenshotted mid-tick), expired state (not reached — target date in the future), pulsing seconds cell (reduced-motion respected via media query, not independently re-verified live) | FAIL (cell order, finding 2); digit rendering/contrast itself PASS                                                                                                                                                                                                                                                                     | `countdown-pricing-{en,ar}-1366.png`                                                                                                                                        |
| `console-grid-background`                 | decorative, `aria-hidden`, `rtl-exempt` per spec                                                                                                                                                     | PASS (code matches spec verbatim)                                                                                                                                                                                                                                                                                                      | n/a (code inspection; component is a full-bleed decorative layer with no visually distinct RTL-sensitive content to screenshot separately from the sections it sits behind) |
| `session-calendar`                        | FullCalendar `locale`/`direction` wiring                                                                                                                                                             | PASS (code inspection: `locale: this.i18n.intlLocale()`, `direction: this.i18n.direction()`, `arLocale` imported) — not independently screenshotted; this surface is member/admin-only, outside the public-header/footer/countdown scope this review targets, and requires an authenticated session this static build does not provide | n/a                                                                                                                                                                         |

### Design system compliance

- Focus-visible outline (header skin): `focus-visible:outline-amber-400`, measured `outlineColor: rgb(255, 187, 77)` (amber-400), `outlineWidth: 2px`, `outlineStyle: solid` — matches `design-spec.md` §2.5/§2.5a's header-skin exception (amber-400 is only used on the dark-only public header, not on the panel shells where it would fail contrast).
- Selected-option color: computed `color: rgb(8, 9, 12)` on `background-color: rgb(245, 165, 36)` for the mobile row's checked "العربية" button — matches the spec's documented `primary-content` (`#08090c`) on `primary` (`#f5a524`) pair, ≈9.76:1, §2.5a.
- Hover state: computed `color: rgb(255,255,255)` on the menu panel's `background-color: rgba(2,6,23,0.95)` for the hovered "English" option — ≈19:1, comfortably exceeds the header skin's own documented ≈9.9:1 figure.
- `aria-label` label-in-name: trigger `aria-label` read back as `"AR — اللغة: العربية"` (Arabic active) and `"EN — Language: English"` (English active) — exact match to §2.2's worked examples.
- Option `lang`/`dir`: "English" button carries `lang="en" dir="ltr"`; "العربية" button carries `lang="ar" dir="rtl"` — matches §2.6.
- Translation key: both skins consume the single `common.language` key (`ui.common.language` in this codebase's actual `libs/web/ui/src/lib/i18n/{en,ar}.json`, resolving to "Language"/"اللغة") — matches §2.7's key-unification fix.
- `LogOut` icon mirror: `rtl:scale-x-[-1]` present on both desktop (`navigation.component.ts:536`) and mobile (`:687`) instances — matches §3.2.
- `console-grid-background.component.ts:48-55`: `.glow` carries the code comment `/* rtl-exempt: decorative geometry, not content flow */` and is untouched by any `rtl:` variant — matches §3.1/§3.5's named exemption verbatim.
- **Deviation**: `countdown-timer.component.ts` applies `.ltr-island` per-digit-cell only, not to the row — see Serious finding 2. This is a gap against the _spirit_ of §3.3/§3.5's LTR-island pattern (not explicitly named for this component in the design spec, but the same reasoning the spec applies elsewhere).
- **Deviation**: `navigation.component.ts`'s logo/CTA lack `shrink-0` at the 768px breakpoint the design spec's own §2.2 names as the switcher's activation point — see Visual-breaking finding 1.

### Accessibility audit

- Standard applied: WCAG 2.2 AA, per `design-spec.md`'s own stated baseline (4.5:1 text, 3:1 non-text/UI components, 24×24px minimum target size for pointer input). 44×44px figures below are cited as AAA/platform guidance only, not AA minimums.
- Contrast pairs measured (see Design system compliance above for the raw computed values): all pairs actually exercised in this session (focus outline, selected-fill, hover, default) meet or exceed 4.5:1/3:1.
- Touch/pointer target sizes: mobile language-row buttons 150.5×40.5px (exceeds both 24×24 AA and 44×44 AAA guidance); mobile hamburger 44×44px; desktop trigger 79.3×28px (exceeds the 24×24 AA floor for pointer-operated UI components; this is a desktop-pointer target, so the 44×44 AAA figure does not apply).
- Focus order: `Tab` on the desktop menu reaches the trigger, then (once open) "English" then "العربية" in document order regardless of `dir` — matches the spec's explicit "Tab-order only, no arrow-key roving" scope boundary for this skin (§2.6), confirmed programmatically (`Tab1: English`, `Tab2: العربية`).
- Semantic structure: menu panel is `role="menu"` with `role="menuitemradio"` children and `aria-checked`; mobile row is `role="group"` with `role="menuitemradio"` children (valid `menu`-owned roles per §2.3's B3 fix) — confirmed via DOM read, not just visually.
- No NG05xx (or any `NG0\d{3,4}`) console warnings were observed on `/`, `/pricing`, or `/terms-and-conditions` in Arabic across a full page-load + settle cycle — no hydration mismatch evidence found for this batch's changes.
- Console errors present in every capture (`ERR_CERT_AUTHORITY_INVALID`, `ERR_TUNNEL_CONNECTION_FAILED`) were isolated and confirmed to be the sandboxed environment's outbound-proxy blocking `fonts.gstatic.com`/`fonts.googleapis.com`/`i.ytimg.com`, not application errors — the Arabic-only IBM Plex Sans Arabic `<link>` request was itself observed firing only when `ptah.lang=ar` (confirming the §3.6 "only load when Arabic is active" requirement is implemented), it simply cannot resolve inside this network sandbox.

### Visual performance

- No layout-shift source specific to this batch was observed beyond finding 1 (which is a static breakpoint failure, not a shift).
- The footer's GSAP `viewportAnimation` fade/scale-in was captured mid-transition on first attempt (screenshot taken too soon after `scrollIntoView`), correctly re-captured after an explicit settle wait; this is a capture-timing artifact of this review's tooling, not a product defect — no un-intentional jank was observed once settled.
- Countdown timer's `sec-pulse` animation is gated behind `prefers-reduced-motion: no-preference` per `countdown-timer.component.ts:72`; not independently re-verified with `prefers-reduced-motion: reduce` forced, since Playwright's `reducedMotion: 'reduce'` context option was only applied to the footer capture pass, not the countdown pass — flagged as residual uncertainty, not a finding.

### Verdict

- Recommendation: **REJECT**
- Confidence: HIGH
- Key concern: the desktop nav (logo + primary Download CTA) breaks at 768px — a documented breakpoint the design spec itself names as the switcher's activation point — in both languages, which must be fixed before merge regardless of the RTL work's own correctness. The countdown-timer's reversed cell order in Arabic is a second, independently real defect that should also be fixed in this batch since `countdown-timer.component.ts` is directly in scope.

## Batch 11 — round 2

### Summary

| Metric            | Value                                                                                                                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overall score     | 9/10                                                                                                                                                                                                        |
| Assessment        | APPROVED                                                                                                                                                                                                    |
| Visual breaking   | 0                                                                                                                                                                                                           |
| Serious           | 0                                                                                                                                                                                                           |
| Moderate          | 0                                                                                                                                                                                                           |
| Viewports tested  | round-1 set (320, 375, 768, 1024, 1366, 1920) plus a fine 16px sweep, 768–1100, in both languages (22 widths × 2 langs = 44 additional data points), plus 767/800/900/1024/1100/1280 screenshot spot-checks |
| Screenshots taken | 33 (this round; 44 from round 1 remain valid and referenced)                                                                                                                                                |
| Components tested | Public header (logo, desktop nav row, language switcher, mobile menu), countdown timer                                                                                                                      |

### Environment

- Rebuilt fresh in this session: `node_modules/.bin/nx build ptah-landing-page` (production config), succeeded, `Prerendered 6 static routes` (build finished 2026-09-27T18:22:34.533Z), matching the coordinator's note that `prerender-check` still passes. `git status` reconfirmed `navigation.component.ts`, `countdown-timer.component.ts`, `footer.component.ts`, `session-calendar/*`, `console-grid-background.component.ts` all modified in the working tree — the build is against the reworked code, not a stale bundle.
- Served via `npx http-server dist/ptah-landing-page/browser -p 4300 -s -c-1` (restarted against the fresh `dist/`, old server process killed first).
- Browser: same Chromium/Playwright setup as round 1 (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
- Read the actual diffs before testing (not just the coordinator's summary): confirmed `navigation.component.ts` now carries `shrink-0` on the logo `<a>` (`:90`), the Download CTA (`:433`) and the user-avatar trigger (`:452`); `whitespace-nowrap` on Product/Pricing/Docs/Community/lang-trigger/Login/Sign Up/CTA labels; the link row is `hidden md:flex min-w-0 items-center gap-1 lg:gap-6` (`:120`); per-link `px-1 lg:px-2`; Sign Up `px-2.5 lg:px-4`; CTA `px-2.5 lg:px-5`; nav side padding `px-4 sm:px-6 md:px-4 lg:px-8 xl:px-16` (`:78`). Confirmed `countdown-timer.component.ts:38-40` now carries `dir="ltr"` directly on the four-cell row with a new code comment (`<!-- A clock reads days to seconds left to right in both languages -->`), and the per-digit `.ltr-island` class was removed from the digit span (`:48`) since the row-level `dir` now makes it redundant.

### Re-verification of round-1 findings

#### V1 (was Visual breaking — nav collapse at 768–800px): RESOLVED

- Fine sweep, every 16px from 768 to 1100, both languages (`en`: 768,784,800,816,832,848,864,880,896,912,928,944,960,976,992,1008,1024,1040,1056,1072,1088,1100; `ar`: identical set) — programmatic assertions at every single width:
  - `logoWidth = 44` (full size, never collapses) at every width in both languages.
  - `ctaHeight = 36` (constant) at every width in both languages — the Download CTA never wraps to a second line (a wrap would change its height).
  - `ctaWithinViewport = true` at every width in both languages — the CTA is never clipped by the viewport edge.
  - `pageScrollWidth === pageClientWidth` at every width in both languages — no page-level horizontal overflow.
  - `linkRowOverflowsNav = false` at every width in both languages — the desktop link row never exceeds its own parent `<nav>`'s box (the specific "own box" check the coordinator asked for, distinct from page-level overflow).
  - Raw data retained in this session's scratch output; representative screenshots: `nav-en-768.png`, `nav-ar-768.png`, `nav-ar-1024.png`, `nav-en-1024.png` (not reproduced inline here — see the round-1-style per-width captures in `screenshots/visual-batch-11-r2/`), all show the logo intact, the CTA on one line, and comfortable spacing.
  - Logo-to-first-link gap measured at every screenshot width (767/768/800/900/1024/1100/1280, both languages): ranges from ~22px (tightest, at 768px in `en`/1024px in `en`) up to ~244px (widest, 1280px `ar`) — always a visible, non-touching gap; the round-1 "cramped, near-zero gap" observation at 1024px `ar` (moderate finding 3) no longer reproduces (gap now 52px at 1024 `ar`).
- Root cause confirmed fixed: `shrink-0` now protects the logo, CTA and avatar from the flex-shrink algorithm that previously collapsed them, `whitespace-nowrap` stops label text from wrapping mid-word, and the widened `lg:`/`xl:` padding steps (moving the 64px side padding from `lg` to `xl`) give the row enough room before the desktop cluster turns on at `md`. This resolves both the blocking 768–800px collapse and the moderate 1024px `ar` cramping from round 1 in one set of changes.
- Screenshots: `nav-{en,ar}-{767,768,800,900,1024,1100,1280}.png`.

#### V2 (was Serious — countdown timer reversed cell order in Arabic): RESOLVED

- `countdown-timer.component.ts:38-40`'s row now carries `dir="ltr"` directly (the fix this review recommended in round 1), and DOM-order assertions confirm the fix holds:
  - `ar`, 375px and 1366px, on `/pricing`: cell labels read `["أيام", "ساعات", "دقائق", "ثوانٍ"]` (days, hours, minutes, seconds) in that left-to-right order — correct.
  - `en`, 375px and 1366px: cell labels read `["Days", "Hrs", "Min", "Sec"]`, unaffected, as expected.
  - Visual confirmation: `countdown-pricing-ar-1366.png` shows `03(أيام) : 05(ساعات) : 33(دقائق) : 55(ثواني)` left-to-right — days-largest-to-seconds-smallest, matching the English `countdown-pricing-en-1366.png` (`03:05:34:00`, `DAYS:HRS:MIN:SEC`) semantically. Same result at 375px (`countdown-pricing-ar-375.png`, `countdown-pricing-en-1366.png` for the en control).
  - The per-digit `.ltr-island` span class was removed from the digit `<span>` since it is now redundant under the row-level `dir="ltr"` — confirmed by reading the template; no double-application or conflicting bidi rule remains.
  - Labels are now translated (`أيام`/`ساعات`/`دقائق`/`ثوانٍ` vs. the untranslated raw label keys implied by the coordinator's note) — spot-checked and read as correct, fluent Arabic unit abbreviations, matching the English `Days`/`Hrs`/`Min`/`Sec` abbreviation style.
- Screenshots: `countdown-pricing-{en,ar}-{375,1366}.png`.

#### V3 (was Moderate — cramped nav at 1024px in Arabic): RESOLVED

- Covered by the V1 re-verification above (gap measurements and screenshots) — folded in since it shared the same root cause and the same fix.

### Spot-checks for new regressions

- **Switcher vs. prototype, desktop**: `switcher-desktop-open-ar-1440.png` re-compared against `prototype/screenshots/header-menu-open-ar-1440.png` — trigger shape, `start-0` panel anchoring, check-icon-on-selected, English/العربية order and per-option `lang`/`dir` all still match; the layout-only CSS changes in this round did not touch the switcher's own markup and no drift was found.
- **Mobile menu, 375 and 320, both languages**: `mobile-menu-open-{en,ar}-{320,375}.png` — language row still renders correctly (checked option amber-filled, unchecked outlined, correct RTL mirroring at 320px too, which round 1 had only checked at 375px), no horizontal overflow (`scrollWidth === clientWidth` at all four combinations), no clipped items.
- **Header closed state, 320px**: `header-closed-{en,ar}-320.png` — logo and hamburger both visible and correctly positioned at the narrowest tested width, no regression from the nav-row padding/whitespace changes.
- **Footer and console-grid-background**: not re-tested this round — the coordinator's message states these files were not touched in the rework (`navigation.component.ts` and `countdown-timer.component.ts` only, plus `session-calendar` lazy-loading the `ar` locale), and round 1 already found them fully compliant; no code diff in `footer.component.ts` or `console-grid-background.component.ts` was present in this session's `git status` beyond what round 1 already reviewed.
- **`session-calendar` ar-locale lazy load**: confirmed via `git diff`-adjacent read that the `arLocale` import in `session-calendar.ts` is now dynamic (`import('fullcalendar/locales/ar')`-style) rather than static — this is a bundle-size/perf change with no visual surface on the public marketing pages this review can reach without an authenticated session; noted as verified-by-code-reading only, consistent with round 1's same caveat for this component.

### Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Key concern: none blocking. All three round-1 findings (1 visual-breaking, 1 serious, 1 moderate) are resolved and verified with fresh evidence — a fine-grained 16px-step sweep across the entire previously-failing 768–1100px range in both languages, not just spot checks at the original failure points. No new regressions were found in the switcher, mobile menu, or narrow-viewport header states.

---

## Batch 12

Scope: `libs/web/panel-ui/src/lib/{language-switch,panel-layout,empty-state,detail-drawer,selection-toolbar,thread-row,stat-tile}` (uncommitted). Design source: `design-spec.md` §2.4–§2.6, §3.1–§3.2; prototype `prototype/index.html` sections B/B2 and `prototype/screenshots/admin-header-375-{en,ar}.png`, `full-*-{375,1440}.png`.

### Summary

| Metric            | Value                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Overall score     | 6/10                                                                                         |
| Assessment        | NEEDS_REVISION                                                                               |
| Visual breaking   | 1                                                                                            |
| Serious           | 1                                                                                            |
| Moderate          | 1                                                                                            |
| Viewports tested  | 320, 375, 768, 1024, 1440, 1920 (member + admin shells)                                      |
| Screenshots taken | 68 (in `screenshots/batch-12/`)                                                              |
| Components tested | LanguageSwitch, PanelLayout header + sidebar nav, StatTile (rendered live via AdminOverview) |

### Environment

- Build verified: `node_modules/.bin/nx build ptah-landing-page` run fresh at the start of this review (22.3s, "Application bundle generation complete", 6 prerendered routes); `dist/ptah-landing-page/browser` timestamps confirmed newer than every edited source file before any screenshot was taken.
- Serving: no live dev server. Reused/adapted the executor's Playwright harness (`shots.js`) that serves `dist/ptah-landing-page/browser/index.csr.html` via `page.route`, with `/api/*` mocked (`auth/me`, `members/entitlement`, `admin/records/users`) and the `ptah_auth_hint` localStorage flag set, plus `localStorage['ptah.lang']`/`ptah.members.theme` for language/theme. Extended the harness myself (own scratch scripts, same route-mocking pattern) to also mock `GET /api/v1/admin/stats` so `AdminOverview` — the one route in this app that actually renders `StatTile` live — could render instead of its mocked-404 error card, and to test a realistic long-email content-stress case.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, global `playwright`, no `playwright install` run.
- Base URL: `http://panel.test` (mocked origin), routes `/members`, `/admin`, `/admin/overview`.
- Viewports covered: 320, 375, 768, 1024, 1440, 1920 (this is an audit selection around the design-spec's own named gate width, 375px, and the surrounding breakpoints observed in `panel-layout.html`'s `lg:`/`sm:` classes — the repo names no formal viewport support matrix for the panel shells).
- Themes covered: `operator-member` (dark), `operator-member-light` (light), `operator-admin` (dark). Languages: `en`, `ar` (`dir="rtl"`).
- Note per brief: page bodies show red mocked-error cards on most routes because unrelated APIs 404 — not a finding. Member/admin `title()` and nav labels are still English text even in `ar` — not a finding (later batches translate these).

### Findings by severity

#### Visual breaking

##### 1. Email span in `member-layout.html` / `admin-layout.html` has no bounded/truncating width, so a realistic email overflows the header horizontally at 320–375px — the exact regression design-spec §2.4 (B7) named these two files to prevent

- File: `libs/web/members/src/lib/member-layout/member-layout.html:22`, `libs/web/admin/src/lib/admin-layout/admin-layout.html:21` — both currently `<span class="font-mono text-xs sm:text-sm">{{ email }}</span>`, missing the exact normative fix design-spec.md:326-333 (§2.4) requires: `class="font-mono text-xs ltr-island truncate max-w-[7rem] sm:max-w-none"`.
- Viewports affected: 320px, 375px (any width below the `sm` breakpoint, 640px).
- Screenshot: `longemail-admin-header-en-375.png` (also `longemail-admin-header-en-320.png`) — reproduced with a realistic long work email (`abdallah.longername.staffing@miramarstaffingcompany.com`, 57 chars) in place of the mocked `member@example.com` (19 chars).
- Problem: measured `document.documentElement.scrollWidth (413px) > window.innerWidth (375px or 320px)` — `docOverflowX: true` at both widths. The email span itself measures 397px wide, uncapped, forcing the header's right-hand control cluster wider than the viewport. The screenshot shows the email text running off the right edge and the `EN`/`AR` language switch pushed off-screen/clipped.
- Impact: any user whose email is longer than the ~19-character mock (a large share of real work emails, including subdomained or longer personal-name addresses) gets a horizontally-scrolling panel shell on a phone, and the language switcher — the control this whole batch exists to ship — becomes unreachable without scrolling sideways in the affected direction. This is the identical failure mode (badge/email overflow) design-spec §2.4's B7 fix was written to close for the _title_ and _badge_; the _email_ half of that same fix was never applied to its two named files.
- Fix: add `truncate max-w-[7rem] sm:max-w-none` (and `ltr-island` per the spec's exact class list) to the email `<span>` in both `member-layout.html:22` and `admin-layout.html:21`, matching design-spec.md's literal snippet.
- Scope note: neither file is in Batch 12's own file list (`libs/web/panel-ui/**` only — confirmed via `git diff --stat`, both files are untouched). `panel-layout.html`'s own half of the B7 fix (outer `flex-wrap`, `min-w-0`/`truncate` on the title, `shrink-0 whitespace-nowrap` on the badge) _is_ correctly implemented and verified working (finding below). This is a cross-batch gap: the design-spec ties both halves together as one fix for one regression, but only the panel-ui half shipped. It should be fixed before either shell is exposed to users with real (non-mock) email lengths, whichever batch owns `member-layout.html`/`admin-layout.html`.

#### Serious

##### 2. `StatTile`'s RTL chevron mirror (`rtl:scale-x-[-1]`) has no visible effect — `lucide-angular` copies the host's class list onto its internal `<svg>`, so the flip is applied twice and cancels out

- File: `libs/web/panel-ui/src/lib/stat-tile/stat-tile.html:23` (`class="... rtl:scale-x-[-1] rtl:group-hover:-translate-x-0.5"` on `<lucide-angular [img]="ChevronRightIcon">`).
- Viewports affected: all (this is a rendering-logic bug, not a layout-width bug); reproduced at 1440px on `/admin/overview` (own extended mock of `GET /api/v1/admin/stats`, since the mocked-404 error card hides `StatTile` on every route the executor's harness reaches).
- Screenshots: `chevron-solo-en-big.png` vs. `chevron-solo-ar-big.png` (8× nearest-neighbor zoom of the same live-rendered icon element via `locator.screenshot()`) — both show the chevron pointing right (`>`); `chevron-toggle-before-big.png`/`chevron-toggle-after-big.png` is the stronger proof — the _same DOM node_, in the _same page_, screenshotted before and after `document.documentElement.setAttribute('dir','rtl')`, renders pixel-identical in both states.
- Problem: `getComputedStyle` on the `<lucide-angular>` host reports `transform: matrix(-1, 0, 0, 1, 0, 0)` in `dir="rtl"` (correct, scaleX(-1)) — but so does the internal `<svg>` it renders (`svgClass` was read directly: `"lucide h-4 w-4 shrink-0 text-base-content-muted transition-transform group-hover:translate-x-0.5 rtl:scale-x-[-1] rtl:group-hover:-translate-x-0.5"`, identical to the host's own class list). `lucide-angular` forwards the host's static `class` attribute onto its child `<svg>` as well, so the `rtl:scale-x-[-1]` utility fires on _both_ elements independently. Two nested `scaleX(-1)` transforms compose to `scaleX(1)` (identity) — the icon renders unmirrored despite every individual computed-style check reporting the "correct" value. (Cross-checked: `panel-layout.html`'s collapsed-group chevron does _not_ hit this bug, because its rotation classes are Angular `[class.x]` host bindings rather than part of the static `class="..."` string — `svgClass` there is `"lucide h-3.5 w-3.5 shrink-0 text-base-content-muted transition-transform"`, without the rotation classes, so only the host rotates and the single 90° mirror renders correctly, confirmed visually in `crop-growth-chevron.png`.)
- Impact: in Arabic, the affordance chevron on every linked `StatTile` (Builders count, Cohort tiles on `/admin/overview` — confirmed live) still points toward LTR "forward" (right) instead of RTL "forward" (left), the opposite of what design-spec §3.2 requires ("Yes — swap meaning... Implement as `rtl:scale-x-[-1]` on the rendered `<lucide-angular>`"). This is a small but real and systemic directional-affordance defect: the _same_ `rtl:scale-x-[-1]`-on-`<lucide-angular>` pattern is design-spec's prescribed fix for all 38 `ArrowRight`/`ArrowLeft`/`ChevronRight`/`ChevronLeft` instances across `libs/web` (§3.2), so any other component using this exact pattern (static class, not a `[class.x]` binding) is at risk of the same silent cancellation — worth a project-wide grep-and-fix, not just a `stat-tile.html` patch.
- Fix: apply the mirror to only one of the two elements. Either (a) wrap the icon in a plain `<span class="rtl:scale-x-[-1] ...">` and drop the mirror classes from `<lucide-angular>` itself, or (b) if `lucide-angular` exposes a way to stop it from forwarding host classes to the inner `<svg>`, use that; verify with the same before/after `dir` toggle test used here (a single DOM-node, same-page screenshot compare) rather than trusting `getComputedStyle` on the host alone, since that individually-correct-looking check is exactly what missed this bug in review.

#### Moderate

- **`needs-attention-queue.html:55,120`** (`libs/web/admin`, not in Batch 12's file list): `ChevronRightIcon` here has no `rtl:` mirror class at all, and is visibly still pointing right in `ar` (`overview-ar-1440.png`). Design-spec §3.2 lists this same icon-mirroring mechanical pass as required across `libs/web`; this file is simply a later, not-yet-converted instance and is flagged for awareness only — out of scope for a Batch 12 pass/fail since it is a different library.
- **`overview.html`'s "Needs Attention" row**, `ar` (`overview-ar-1440.png`): the numeric count column (`42`, `3`, `1`, `5`) sits at the far right of the reversed row while the icon+label sits center-left and the chevron is leftmost — readable and correctly mirrored as a block (confirmed via the RTL layout-order rule, §3.1), but the visual rhythm is slightly less scannable than the LTR version, where label-then-count-then-chevron reads left-to-right in one direction; a minor polish item for whichever batch owns this file, not a panel-ui defect.

### Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_575_fee7/prototype/index.html`, sections B/B2; `prototype/screenshots/admin-header-375-{en,ar}.png`.
- Fidelity assessment: **MATCHES** for the panel-ui component work under review (`LanguageSwitch`, `PanelLayout` header/nav), with the one cross-batch email-truncation gap noted above as Visual Breaking.
- Deviations observed:
  - Segmented switcher markup, states, `EN`/`AR` caption + native-language `aria-label`, check-icon-on-selected, `btn-sm` sizing: matches the prototype's `full-{en,ar}-{dark,light}-375.png` and `admin-header-375-{en,ar}.png` exactly — visible caption, focus-ring color, amber fill, badge placement all consistent (`header-member-operator-member-{en,ar}-375.png`, `header-admin-operator-admin-{en,ar}-375.png`).
  - Header wrap-at-375px behavior (title truncates to ellipsis, badge never breaks, two-row layout) matches the prototype's own `admin-header-375-{en,ar}.png` two-row structure. The prototype's "Admin Dashboard" happens to render on one line without ellipsis while the real build's Chromium renders it with a 5px-short ellipsis truncation (`Admin Dashbo…`) — verified this is **not** a font-loading artifact of the test harness (re-tested with real Inter font loaded over the network instead of the harness's offline 204 stub; truncation reproduced identically, `fontcheck-admin-header-en-375.png`) and is in fact the exact behavior design-spec.md:296-299 explicitly names as intended ("a long title (e.g. admin's 'Admin Dashboard,' longer than member's 'Ptah Builders') shrinks to an ellipsis on one line instead of wrapping") — not a deviation, a by-design near-miss that the spec anticipated by name.
  - Collapsed-group sidebar chevron in `ar`: confirmed via keyboard-driven language switch (EN→AR while a group is collapsed) that the chevron rotates from `-90deg` (LTR, points right-ish toward content) to a net `+90deg` (RTL, points left, `matrix(0,1,-1,0,0,0)`) and back, matching the prototype's intent and design-spec §3.2's explicit rule; screenshot `admin-collapsed-group-after-switch-ar-1440.png` / crop `crop-growth-chevron.png` confirms a clean left-pointing chevron with no stray rotation artifacts on re-expand.
- Before/after comparison (no prototype): N/A — a prototype exists and was used.

### Viewport results

| Screen                                           | Widths checked                  | Elements checked                                                        | Status                                                                                                        | Screenshot(s)                                                                                                                                    |
| ------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Member shell header, `operator-member` (dark)    | 375, 1440                       | title, badge, email, theme toggle, language switch                      | Pass                                                                                                          | `header-member-operator-member-{en,ar}-{375,1440}.png`                                                                                           |
| Member shell header, `operator-member-light`     | 375, 1440                       | same                                                                    | Pass                                                                                                          | `header-member-operator-member-light-{en,ar}-{375,1440}.png`                                                                                     |
| Admin shell header, `operator-admin`             | 320, 375, 768, 1024, 1440, 1920 | title (truncates by design), badge, email, language switch              | **Fail at 320/375 with realistic email length** (finding 1); pass at all widths with the mocked 19-char email | `header-admin-operator-admin-{en,ar}-{375,1440}.png`, `sweep-header-admin-en-{320,768,1024,1920}.png`, `longemail-admin-header-en-{320,375}.png` |
| Admin overview (`StatTile` live)                 | 375, 1440                       | stat tiles, chevron mirror, needs-attention rows                        | **Fail** — chevron mirror inert (finding 2)                                                                   | `overview-{en,ar}-{375,1440}.png`, `chevron-solo-*`, `chevron-toggle-*`                                                                          |
| Admin sidebar nav, collapsed group + RTL chevron | 1440                            | collapse/expand, chevron rotation, focus after keyboard language switch | Pass                                                                                                          | `admin-collapsed-group-after-switch-ar-1440.png`, `crop-growth-chevron.png`                                                                      |

### Component and interaction results

| Component                                                  | States tested                                                                                                                                                                                                                     | Status                                                                    | Screenshot(s)                                                                                                                                |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `LanguageSwitch` (segmented radiogroup)                    | default, selected (amber + check), inactive (ghost), focus-visible (Tab lands on checked option), hover, touch-target size, `aria-checked`/`aria-label`/roving `tabIndex`                                                         | Pass                                                                      | `switch-focus-*.png`, `switch-hover-member-en-1440.png`; measured targets 59×32 / 43×32 (both ≥ WCAG 2.5.8's 24×24 floor)                    |
| `LanguageSwitch` keyboard                                  | `ArrowRight`/`ArrowLeft` direction-aware inversion (verified both ways: AR-active `ArrowRight`→EN, then EN-active `ArrowLeft`→AR), `ArrowUp`/`ArrowDown` direction-independent (`Down` always moves forward regardless of `dir`)  | Pass                                                                      | console-logged DOM state transitions (see contrast/keyboard scratch scripts); matches design-spec.md:513-524's `onGroupKeydown` spec exactly |
| `PanelLayout` header (B7 wrap fix)                         | title truncation + ellipsis, badge never breaks, outer `flex-wrap` giving each cluster its own row at 375px, collapse-survives-language-switch                                                                                    | Pass (with mocked/short email); **Fail with realistic email** (finding 1) | see viewport table above                                                                                                                     |
| `PanelLayout` sidebar chevron (collapsed-group RTL mirror) | LTR `-rotate-90`, RTL net `+90deg`, round-trip back to LTR                                                                                                                                                                        | Pass                                                                      | `admin-collapsed-group-after-switch-ar-1440.png`                                                                                             |
| `StatTile` (link chevron)                                  | rendered live via `/admin/overview`; EN unmirrored (correct), AR "mirrored" (class computed correctly, renders unmirrored)                                                                                                        | **Fail** (finding 2)                                                      | `chevron-solo-*.png`, `chevron-toggle-*.png`                                                                                                 |
| `DetailDrawer`                                             | markup only — `end-0`/`border-s` anchoring + paired `translate-x-full`/`rtl:-translate-x-full` transform read directly from source; no live route reachable through the mocked harness to trigger it open in this session         | Not rendered live (source-verified only)                                  | —                                                                                                                                            |
| `SelectionToolbar`, `ThreadRow`, `EmptyState`              | i18n key wiring read directly from `git diff` (pluralization keys, `i18n-keys:` markers, `aria-label`s all correctly switched to `transloco`); no live route reachable through the mocked harness with real selection/thread data | Not rendered live (source-verified only)                                  | —                                                                                                                                            |

### Design system compliance

| Token / rule                                                       | Expected (design-spec)                | Observed                                                                                            | Status               |
| ------------------------------------------------------------------ | ------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------- |
| Focus ring, `operator-member`/`operator-admin`                     | `base-content` on `base-200`, 13.21:1 | Measured (canvas-based sRGB extraction from live `getComputedStyle`, WCAG 2.x formula): **13.21:1** | Pass — exact match   |
| Focus ring, `operator-member-light`                                | 17.03:1                               | Measured: **17.03:1**                                                                               | Pass — exact match   |
| Inactive option text on `base-200` (dark)                          | 4.7:1                                 | Measured: **4.75:1**                                                                                | Pass                 |
| Inactive option text on white (light)                              | 5.3:1                                 | Measured: **5.31:1**                                                                                | Pass                 |
| `btn-sm` sizing (not `btn-xs`, N11 fix)                            | `btn-sm`                              | Confirmed in `language-switch.ts:73` and rendered target sizes (59×32/43×32)                        | Pass                 |
| `ChevronRightIcon` RTL mirror, `stat-tile.html`                    | Visually mirrors under `dir=rtl`      | Computed style says yes; rendered pixels say no (finding 2)                                         | **Fail**             |
| Email span bounded width, `member-layout.html`/`admin-layout.html` | `truncate max-w-[7rem] sm:max-w-none` | Absent in both files                                                                                | **Fail** (finding 1) |

### Accessibility audit

- Standard applied: WCAG 2.2 AA (repository's own `base-content-muted.spec.ts` and this task's design-spec both gate at AA; no stricter policy documented in the repo for this surface).
- Contrast pairs measured live (not estimated): see Design system compliance table above — focus ring and default-state text both pass 3:1 (non-text) / 4.5:1 (text) with wide margins in all three panel themes.
- Touch targets: `LanguageSwitch` options measured 59×32 (`EN`) and 43×32 (`AR`) — both exceed the 24×24 CSS px WCAG 2.5.8 floor.
- Semantic structure: `role="radiogroup"` with `aria-label` (`common.language`/`اللغة`, confirmed switching correctly), two `role="radio"` children with `aria-checked`, roving `tabIndex` (`0` on checked, `-1` on other) confirmed via direct DOM read at every one of the 12 header screenshot cases.
- Focus order: `Tab` into the group lands on the checked option in every one of the 12 cases tested (`switch-focus-*.png`, cross-checked against the `ring` metric in each case).
- State-not-color-only: confirmed — the selected option carries a `CheckIcon` in addition to the `btn-primary` fill, visible in every header screenshot.

### Visual performance

- No animated/GSAP surface in this batch's scope; `PanelLayout`'s header/sidebar transitions are simple CSS `transition-transform`/`transition-colors`, not observed to jank in any capture.
- Layout shift: none observed from the language-switch or theme toggle interactions themselves (both are synchronous DOM/class changes, no async content reflow); the one horizontal-overflow case (finding 1) is a static layout defect, not a shift.
- Loading state: not applicable to this batch's components (no async-loading UI in `language-switch`, `panel-layout`, `stat-tile`, etc. themselves).

## Verdict

- Recommendation: **REVISE**
- Confidence: HIGH
- Key concern: finding 1 (missing email-truncation fix in `member-layout.html`/`admin-layout.html`) reproduces a real, user-facing horizontal-overflow bug with any realistically-long email at 320–375px, directly contradicting the exact fix design-spec §2.4 (B7) specifies for those two files by name and line number — even though the files themselves sit outside Batch 12's own file list, this is the same regression class the batch's own panel-layout.html changes were written to prevent, and it ships broken in the other half of the same fix. Finding 2 (StatTile's RTL chevron mirror silently canceling itself via a lucide-angular host/svg class-duplication quirk) is a smaller but systemic defect worth a project-wide check before the §3.2 icon-mirroring pass is declared done elsewhere in the app.

---

## Batch 12 — round 2

Re-verification of the two round-1 findings (visual-breaking: missing email truncation; serious: `stat-tile` RTL chevron mirror canceling itself), plus the executor's own reported font-shaping concern, against the executor's claimed fixes.

### Summary

| Metric            | Value                                                                                                                                    |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Overall score     | 9/10                                                                                                                                     |
| Assessment        | APPROVED                                                                                                                                 |
| Visual breaking   | 0 (was 1 — resolved)                                                                                                                     |
| Serious           | 0 (was 1 — resolved)                                                                                                                     |
| Moderate          | 1 (carried over, out of Batch 12 scope)                                                                                                  |
| Viewports tested  | 320, 375, 768, 1440 (targeted re-test of prior findings), plus the round-1 320/768/1024/1920 sweep already on file                       |
| Screenshots taken | 27 (in `screenshots/visual-batch-12-r2/`)                                                                                                |
| Components tested | `PanelLayout` header email span, `StatTile` chevron, `NavigationComponent` desktop + mobile `LogOut` icon, `LanguageSwitch` (spot-check) |

### Environment

- Build verified: `node_modules/.bin/nx build ptah-landing-page` run fresh at the start of this re-review (22.4s, "Application bundle generation complete"); confirmed `dist/ptah-landing-page/browser/index.csr.html` (19:17:23) is newer than every edited source file (`stat-tile.html`, `navigation.component.ts`, `member-layout.html`, `admin-layout.html`, all ≤19:12:34).
- Serving: same pattern as round 1 — no live dev server; own scratch Playwright harness (`scratchpad/b12/r2/harness.js`, adapted from round 1's own pattern, not the executor's `scratchpad/b12/r2.js`, which I did not read — built independently to avoid trusting the executor's own test as the verification) serves `dist/ptah-landing-page/browser` via `page.route`, mocks `/api/v1/auth/me`, `/api/v1/members/entitlement`, `/api/v1/admin/records/users`, `/api/v1/admin/stats`, and sets `ptah_auth_hint`/`ptah.lang`/`ptah.members.theme` in `localStorage`.
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, global `playwright`, no `playwright install` run.
- Base URL: `http://panel.test`, routes `/members`, `/admin`, `/admin/overview`, `/` (public header, for the `LogOut` icons).
- Long-email fixture used for V1: `abdallah.longername.staffing@miramarstaffingcompany.com` (57 chars) — same fixture as round 1's finding, so the fix is checked against the exact string that broke it.

### V1 re-check — email truncation (was Visual breaking)

- Files changed: `libs/web/members/src/lib/member-layout/member-layout.html:22`, `libs/web/admin/src/lib/admin-layout/admin-layout.html:21`, both now `class="font-mono text-xs ltr-island truncate max-w-[7rem] sm:max-w-none"` — confirmed by reading the files directly (not just the executor's claim).
- Tested 18 combinations: {320, 375, 768} × {en, ar} × {member dark, member light, admin} — all with the 57-char long email, not the original 19-char mock.
- Result: **RESOLVED**, no exceptions.
  - `docOverflowX: false` in all 18 cases (`v1-metrics.json`).
  - Email `clientWidth` capped at 112px at 320/375 (`emailScrollW: 397` vs `emailClientW: 112` — truncated, ellipsis applied), uncapped to the full 397px at 768 (`sm:max-w-none` correctly lifts the cap once there's room) — and even at 768 the wider header still absorbs it with `docOverflowX: false`.
  - `emailDir: "ltr"` in every case, including all `dir="rtl"` (Arabic) cases — the `ltr-island` class holds the email's own text direction fixed regardless of page direction, so the truncating ellipsis lands on the correct (right) side of the email and it never re-shapes as RTL content.
  - `switcherInViewport: true` in all 18 cases — the language switch (the control this whole batch exists to ship) is never pushed off-screen, unlike the round-1 reproduction.
  - Visual confirmation: `v1-header-admin-operator-admin-ar-375.png`, `v1-header-member-operator-member-en-320.png`, `v1-header-member-operator-member-light-ar-375.png` all show a clean `abdallah.longe…` truncation with the switcher fully visible and no overflow.
- New observation, not a defect: the fix drops the old `sm:text-sm`, so at ≥640px the email now renders at 12px (`text-xs`) instead of the previous 14px (`text-sm`) it had at that breakpoint. Design-spec §2.4's snippet (`design-spec.md:333`) literally specifies `class="font-mono text-xs ltr-island truncate max-w-[7rem] sm:max-w-none"` — i.e., the spec's own prescribed fix is `text-xs` at every width, not `text-xs sm:text-sm`. The executor implemented the spec exactly as written; the 12px-at-desktop change is the spec's own choice, not a deviation from it. 12px is below the 16px-minimum-body-text _guidance_ some platform style guides use, but that figure is AAA/platform guidance, not a WCAG AA requirement (no WCAG success criterion sets a minimum font size), and this is metadata text ("signed in as," a mono email), not primary content — noted as a **Minor** style observation for whoever owns `design-spec.md`, not a finding against this fix, since the executor correctly matched the approved spec text.

### V2 re-check — RTL icon mirror (was Serious)

Same-DOM-node, same-page, before/after `dir` toggle test (the exact method that caught the round-1 bug), on all three affected icons:

| Icon                        | File                                                       | Before (`dir=ltr`)                               | After (`dir=rtl`)                              | Host/svg transform (after)                             | Status   |
| --------------------------- | ---------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------ | -------- |
| `StatTile` link chevron     | `libs/web/panel-ui/src/lib/stat-tile/stat-tile.html:31-38` | `v2-stattile-chevron-before-big.png` (`>`)       | `v2-stattile-chevron-after-big.png` (`<`)      | wrapper `matrix(-1,0,0,1,0,0)`; host + svg both `none` | **Pass** |
| `LogOut`, desktop user menu | `libs/web/ui/src/lib/navigation.component.ts:534-544`      | `v2-desktop-logout-before-big.png` (arrow right) | `v2-desktop-logout-after-big.png` (arrow left) | wrapper `matrix(-1,0,0,1,0,0)`; host + svg both `none` | **Pass** |
| `LogOut`, mobile menu       | `libs/web/ui/src/lib/navigation.component.ts:692-701`      | `v2-mobile-logout-before-big.png` (arrow right)  | `v2-mobile-logout-after-big.png` (arrow left)  | wrapper `matrix(-1,0,0,1,0,0)`; host + svg both `none` | **Pass** |

- Root-cause confirmation: for all three icons, `svg.getAttribute('class')` no longer includes `rtl:scale-x-[-1]` (it now reads e.g. `"lucide w-4 h-4"` / `"lucide h-4 w-4 shrink-0 text-base-content-muted transition-transform group-hover:translate-x-0.5"`, with no `rtl:` token) — the mirror class lives only on the new wrapper `<span>`, so `lucide-angular`'s host→svg class-forwarding no longer duplicates it. This is the fix the round-1 finding recommended and it eliminates the cancellation at its source rather than working around the symptom.
- `stat-tile.html`'s dropped `rtl:group-hover:-translate-x-0.5` (replaced with an `rtl-exempt:` code comment reasoning that the wrapper's `scaleX(-1)` already re-points the existing `group-hover:translate-x-0.5` toward reading-end under RTL): verified by reasoning through the transform math — a positive-X hover nudge, once the icon's own coordinate space is mirrored by the parent wrapper, renders as a nudge toward the icon's _visual_ left in RTL, which is reading-end there (RTL reads right-to-left, so "forward"/end is left) — consistent with the "nudge toward affordance direction" intent in both directions. Not re-verified with a live hover capture in this round (the round-1 hover screenshot predates this change) — a direct `:hover` pseudo-class screenshot of the mirrored+nudged state was not retaken; flagged as a residual gap, not a defect — the CSS logic checks out but wasn't pixel-confirmed live.
- No other `rtl:scale-x-[-1]`-on-`<lucide-angular>` instances were found still failing within `libs/web/panel-ui` or the two retrofitted `navigation.component.ts` spots (the round-1 finding's stated scope). `needs-attention-queue.html`'s unmirrored `ChevronRight` (round-1 Moderate, `libs/web/admin`, out of Batch 12's file list) was not touched by this fix and still doesn't mirror — carried forward below, unchanged, still out of scope.

### Arabic font-shaping check (executor's reported concern)

- Executor's claim: "Logout" (`تسجيل الخروج`) render reversed/unjoined, attributed to the harness blocking the Arabic web font.
- Re-tested with two conditions, same page, same viewport, same route (`/`, desktop user menu open, `ar`):
  1. **Fonts allowed** (`fonts.googleapis.com`/`fonts.gstatic.com` requests passed through via `route.continue()` instead of stubbed): `document.fonts.status: "loaded"`, `#ptah-font-ar` link element present (confirms the app's own dynamic Arabic-font-loading code, `index.csr.html:17-23`, ran), text renders as `تسجيل الخروج`. Screenshot: `v2-fontcheck-user-menu-ar.png`.
  2. **Fonts blocked** (matching the executor's harness pattern — non-origin requests, including the font hosts, fulfilled with an empty 204): text still renders as `تسجيل الخروج`, correctly joined and right-to-left, computed `font-family` still lists `Inter, "IBM Plex Sans Arabic", "Noto Sans Arabic", system-ui, -apple-system, sans-serif` (the `sans-serif`/`system-ui` fallback chain resolving to a system font that evidently does carry Arabic glyphs and correct shaping in this container). Screenshot: `v2-fontcheck-user-menu-ar-blocked.png`.
  - The two screenshots are visually indistinguishable — no reversed or unjoined glyphs in either.
- Conclusion: **could not reproduce** the reversed/unjoined rendering in this environment, in either font condition. `fonts.googleapis.com`/`fonts.gstatic.com` are reachable from this session (confirmed live via `route.continue()` succeeding and the stylesheet-injected `@font-face` link element appearing), so this environment is not blocking the font host as the executor's harness apparently was; but even with fonts fully blocked to reproduce the executor's harness conditions, Chromium's own text-shaping engine (not the specific font family) correctly joins Arabic glyphs using the `system-ui`/`sans-serif` fallback. If the executor's own container lacks any system font with Arabic glyph coverage (rather than merely blocking the two named hosts), that is a difference in that specific container's installed fonts, not a defect in the app's CSS/markup — nothing in `navigation.component.ts` or `index.csr.html`'s font-loading code is doing anything that would itself cause glyph reversal (that class of bug is normally caused by CSS forcing `unicode-bidi`/`direction` overrides on a run of Arabic text, or by a font subset stripped of Arabic presentation forms — neither reproduces here). Recommend the executor re-run their own harness's font check once more before relying on the "font-blocked" explanation, since this independent run contradicts it.

### Spot-check — no regressions

- `LanguageSwitch`, member shell, light theme, `en`, 768px: `Tab` still lands on the checked radio (`{"lang":"en","ariaChecked":"true","tabIndex":0,"outline":"solid 2px"}`), focus ring still renders. Screenshots: `spotcheck-switch-focus-member-light-en-768.png`, `spotcheck-panel-header-member-light-en-768.png`. No changes to `language-switch.ts`/`.html` were made in this round, and none were found.
- Panel header layout (title truncation, badge, wrap behavior) unchanged and still correct across all 18 V1 re-check screenshots — the email-span fix did not disturb the title/badge half of the B7 fix verified in round 1.

### Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Key concern: none blocking or serious remains from round 1. Both findings are fixed and independently re-verified with the same reproduction method that originally caught them (a realistic long email at the exact viewports that broke, and a same-DOM-node before/after `dir` toggle for the icon mirrors). One pre-existing Moderate carries forward unchanged and out of scope (`needs-attention-queue.html`, `libs/web/admin`, not part of Batch 12's file list). One new Minor observation: the email span's font size is now `text-xs` at all widths (was `text-xs sm:text-sm`) — this matches design-spec.md's own literal snippet exactly, so it's a spec-conformant outcome, not a regression, but worth a design-spec author's sign-off if the smaller desktop size wasn't intentional. The executor's reported Arabic font-shaping problem did not reproduce in this session under either font-allowed or font-blocked conditions.

## Batch 13

### Summary

| Metric            | Value                                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overall score     | 6/10                                                                                                                                                                                                                     |
| Assessment        | NEEDS_REVISION                                                                                                                                                                                                           |
| Visual breaking   | 0                                                                                                                                                                                                                        |
| Serious           | 2                                                                                                                                                                                                                        |
| Moderate          | 0                                                                                                                                                                                                                        |
| Minor             | 0                                                                                                                                                                                                                        |
| Viewports tested  | 6 (320, 375, 768, 1024, 1366, 1920) × 2 languages = 12 sweeps                                                                                                                                                            |
| Screenshots taken | 26 (in `screenshots/visual-batch-13/`) + 3 debug captures (`/tmp`, not deliverable)                                                                                                                                      |
| Components tested | Hero header, release-version toggle rows (2 releases), platform grid (macOS/Windows/Linux), download links, empty-platform states, "View release notes" link, VS Code callout/CTA, error state, focus ring, hover states |

### Environment

- Build verified: fresh `node_modules/.bin/nx build ptah-landing-page` run this session (completed 2026-09-27T19:37:47Z, "Prerendered 6 static routes", no build errors — only a pre-existing initial-bundle-size budget warning, unrelated to this batch), output at `dist/ptah-landing-page/browser`.
- Served with the global `serve -s -l 4173` (SPA fallback) from that fresh output — not a stale bundle.
- Base URL: `http://localhost:4173/download`.
- GitHub releases API (`api.github.com/repos/Hive-Academy/ptah-extension/releases`) mocked via Playwright `context.route`, per the executor's fixture: `electron-v1.4.0` (4 assets: dmg/exe/AppImage/deb) and `electron-v1.3.2` (2 assets: dmg/exe, no Linux build, to exercise the `@empty` platform state).
- Arabic forced via `localStorage['ptah.lang']='ar'` in an `addInitScript` init script, confirmed applied each run via `document.documentElement.{lang,dir}` (`en`/`ltr` and `ar`/`rtl` respectively — correct in every run).
- Browser: Chromium 1194 (`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`), driven with the globally installed Playwright 1.56.1 (`npm root -g`) directly via Node scripts (no `ptah_browser_*` tools were present in this session's tool list — none were probed).
- Public pages are dark-only (operator theme, per `[dir]`/`--gradient-cta` etc. in `apps/ptah-landing-page/src/styles.css`); no light variant exists or was expected. Not treated as a gap.
- Design reference: `.ptah/specs/TASK_2026_575_fee7/design-spec.md` §3.1–3.3 (RTL mirroring rules, icon-mirroring table, LTR islands).

### Findings by severity

#### Visual breaking

None found.

#### Serious

##### 1. `text-neutral-content/40` fails WCAG 2.2 AA contrast (4.5:1) for normal text — asset sizes, empty-platform copy, and the release-notes link

- File: `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts:194`, `:200`, `:239`, `:245`, `:286`, `:292`, `:307`
- Viewports affected: all six (320–1920), both languages — this is a persistent utility class, not viewport- or locale-dependent.
- Screenshot: `download-en-1366-expanded-both.png`, `download-ar-1366-expanded-both.png` (the "94 MB" / "83 MB" / "98 MB" size lines under each platform, and the "View release notes" link, all visibly dim next to the filename/heading text above them).
- Problem: measured via `canvas.fillStyle` sRGB-conversion + WCAG relative-luminance math on the live page (script composited the 40%-alpha text color over its actual card background, `rgb(10,11,14)`): asset-size text and "View release notes" render at **≈2.6:1** contrast against their background — text color `rgb(182,190,200)` at 40% opacity over `rgb(10,11,14)` composites to `rgb(≈79,83,88)`, well short of the 4.5:1 AA minimum for normal-size text (WCAG 2.2 SC 1.4.3; both are 12px regular — the size label is `text-xs`, the "no builds" empty-state copy at `:200/:245/:292` is `text-sm text-neutral-content/40 italic`, also under threshold). By contrast, the same base color at full/60% opacity elsewhere on the page (e.g. filenames, hero subtitle) measured 6.4–10.5:1 and passed comfortably.
- Impact: a user with low vision reading the download page cannot reliably read which file size they are about to download, whether a platform has no build available, or find the "View release notes" outbound link — the exact information this page exists to convey.
- Fix: raise the opacity modifier on these seven usages (e.g. `/40` → `/70` or higher) until the composited ratio clears 4.5:1 against the card background, or switch to a token with a guaranteed-AA value; re-measure after the change rather than eyeballing it, since opacity-based dimming against a near-black background degrades non-linearly.

##### 2. "View release notes" link's touch target is 16px tall — below the 24×24 CSS px WCAG 2.2 AA minimum

- File: `apps/ptah-landing-page/src/app/pages/download/download-page.component.ts:303-317` (the `<a>` wraps the `app.download.release.notes` key plus an `ExternalLink` icon; no vertical padding is applied to the anchor itself — only its containing `div` at line 301 carries `py-3`, which does not enlarge the link's own hit area)
- Viewports affected: all six — the link's rendered height does not change with viewport width (measured 16×131 CSS px at 375px width via `boundingBox()`; same 16px height at 1366px).
- Screenshot: `download-en-1366-expanded-both.png` (bottom-right of each expanded release card) — the link is the outbound "View release notes" affordance at the base of every release card, present twice per page (once per mocked release).
- Problem: WCAG 2.2 SC 2.5.8 (Target Size, Minimum, AA) requires interactive targets to be at least 24×24 CSS px unless an exception applies (inline text-flow link, essential, or an equivalent same-size alternative exists nearby). This link is not inline within a sentence of surrounding body text — it sits alone in its own row as the sole affordance in that row — so the inline exception does not plausibly apply, and no larger equivalent link exists elsewhere on the card.
- Impact: on a touch device the link is hard to hit precisely, especially adjacent to the empty vertical space directly above and below it in the same row, increasing mis-taps or missed taps for the one way to reach the full GitHub release notes.
- Fix: add vertical padding to the `<a>` itself (e.g. `py-1.5` or an increased line-height) so its own box, not just its container, reaches ≥24px tall; re-measure with `boundingBox()` after the change.

#### Moderate and minor

None found and evidenced beyond the two Serious items above. Spacing, alignment, hover states, and component treatments were consistent with the rest of the page and with `apps/ptah-landing-page/src/styles.css`'s tokens in every viewport captured.

### Prototype fidelity

- Approved prototype: `.ptah/specs/TASK_2026_575_fee7/prototype/index.html` does not include a dedicated `/download` screen capture in `prototype/screenshots/` (the prototype set at Gate 1.7 covered the marketing/legal/auth flows named in `context.md`'s scope, not this page's specific layout). Fidelity assessed instead against `design-spec.md` §3.1–3.3 (the RTL/LTR-island rules this batch's checklist calls out), which do apply to every page including this one.
- Fidelity assessment: MATCHES (against §3.1–3.3; not applicable as a prototype-screenshot diff, since no download-page screenshot exists in the approved set).
- Deviations observed: none. Specifically checked and confirmed against the spec's own tables:
  - §3.1 mirrored gradient: `bg-gradient-to-r rtl:bg-gradient-to-l` on the VS Code CTA (`download-page.component.ts:354`) — pixel-cropped both language variants (`cta-en`/`cta-ar`, not saved to the deliverable folder, inspected inline) and confirmed the 135° amber→teal gradient visually reverses to teal→amber under `dir="rtl"`, matching the "mirrors" rule for `bg-gradient-to-l/r`.
  - §3.1 mirrored divider: `md:divide-x md:rtl:divide-x-reverse` on the platform grid (`:159`) — confirmed visually (`download-ar-1366-expanded-both.png`): column order flips (Linux, Windows, macOS left-to-right in RTL vs. macOS, Windows, Linux in LTR) and the divider renders on the correct side of each mirrored column.
  - §3.2 icon-mirroring table: this page uses only `Download`, `ChevronDown`/`ChevronUp` (general use), and `ExternalLink` — all three are listed as **"No — do not mirror"** in the spec's table (non-directional pictograms). Confirmed no `rtl:scale-x-[-1]` or similar mirror class is applied to any `<lucide-angular>` instance in this file — correct per spec, and consistent with the executor's stated claim that this page's icons are non-directional.
  - §3.3 LTR islands: version numbers (`release.version`, e.g. "1.4.0"), asset labels ("macOS Apple Silicon (.dmg)"), and asset sizes ("94 MB") all carry `.ltr-island` (`:127`, `:194`-adjacent, `:239`-adjacent, `:286`-adjacent) and rendered left-aligned/LTR inside the RTL row in every AR screenshot — confirmed visually in `download-ar-1366-expanded-both.png` and `download-ar-320.png`. Dates (`formatDate()`, using `Intl.DateTimeFormat(this.i18n.intlLocale(), …)`) rendered in Arabic month names with Western digits ("15 سبتمبر 2026") — consistent with the Gate 1.7 "Western 0-9 everywhere" decision recorded in `context.md`.
- Before/after comparison: not applicable — a prototype (or its absence, addressed above) is the comparison basis per the task's own instructions; no separate base-commit capture was supplied or requested for this batch.

### Viewport results

| Width | Screen state captured               | EN  | AR  | Status                                                                                                                                          | Screenshots                                                                |
| ----- | ----------------------------------- | --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 320   | Default (1st release auto-expanded) | ✓   | ✓   | Pass — no horizontal scroll, no clipping                                                                                                        | `download-en-320.png`, `download-ar-320.png`                               |
| 375   | Default                             | ✓   | ✓   | Pass                                                                                                                                            | `download-en-375.png`, `download-ar-375.png`                               |
| 375   | Both releases expanded              | ✓   | ✓   | Pass — verified fixed-nav "duplicate" artifact at mid-scroll is a Playwright full-page-stitch artifact, not a real bug (see Visual performance) | `download-en-375-expanded.png`, `download-ar-375-expanded.png`             |
| 768   | Default                             | ✓   | ✓   | Pass                                                                                                                                            | `download-en-768.png`, `download-ar-768.png`                               |
| 1024  | Default                             | ✓   | ✓   | Pass                                                                                                                                            | `download-en-1024.png`, `download-ar-1024.png`                             |
| 1366  | Default                             | ✓   | ✓   | Pass                                                                                                                                            | `download-en-1366.png`, `download-ar-1366.png`                             |
| 1366  | Both releases expanded              | ✓   | ✓   | Pass — platform grid/divider mirroring, LTR islands confirmed                                                                                   | `download-en-1366-expanded-both.png`, `download-ar-1366-expanded-both.png` |
| 1920  | Default                             | ✓   | ✓   | Pass                                                                                                                                            | `download-en-1920.png`, `download-ar-1920.png`                             |

Horizontal-scroll check (`document.documentElement.scrollWidth > clientWidth`) ran programmatically at every width/language combination above; none flagged an overflow.

This is an audit selection (the repository documents no explicit supported-viewport list for the landing app), chosen at common device breakpoints plus the values the checklist named; every size opened is listed above, none skipped.

### Component and interaction results

| Component                                                      | States tested                                                       | Status                                                                                                                                                                         | Screenshot(s)                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Release toggle button (chevron)                                | default, expanded (both releases), focus                            | Pass — chevron flips up/down per state (no RTL mirror, correct per §3.2)                                                                                                       | `download-en-1366-expanded-both.png`, `download-en-1366-focus-toggle.png`                                                                  |
| Download link (per asset)                                      | default, hover, focus                                               | Pass — hover background + amber text color change confirmed in both languages; focus ring visible (see Accessibility audit)                                                    | `download-en-1366-hover-link.png`, `download-ar-1366-hover-link.png`, `download-en-1366-focus-downloadlink.png`                            |
| Empty-platform state ("No Linux builds" / "No Windows builds") | rendered (v1.3.2 has no Linux assets; synthetic no-Windows check)   | Pass visually, contrast issue flagged above (Serious #1)                                                                                                                       | `download-en-1366-expanded-both.png`                                                                                                       |
| VS Code callout + CTA                                          | scrolled into view (fade-in), default, hover                        | Pass — callout fades in correctly once scrolled into view (per component's `viewportAnimation`); CTA gradient mirrors (Prototype fidelity); hover state renders (scale/shadow) | `download-en-1366-callout.png`, `download-ar-1366-callout.png`, `download-en-1366-callout-hover.png`, `download-ar-1366-callout-hover.png` |
| Error state (GitHub API 403)                                   | rendered                                                            | Pass — "GitHub API rate limited" message and retry button render correctly in both languages, Arabic RTL sentence flows correctly around the LTR-island "GitHub API" term      | `download-en-1366-error-state.png`, `download-ar-1366-error-state.png`                                                                     |
| Focus (Tab order)                                              | nav "Sign Up"/"إنشاء حساب" (7th stop), toggle button, download link | Pass — visible ring on all three (see Accessibility audit for why computed-style color reading was misleading)                                                                 | `download-en-1366-focus.png`, `download-ar-1366-focus.png`, `download-en-1366-focus-toggle.png`, `download-en-1366-focus-downloadlink.png` |
| "View release notes" link                                      | default                                                             | Fails touch-target minimum (Serious #2); contrast fails (Serious #1)                                                                                                           | `download-en-1366-expanded-both.png`                                                                                                       |

### Design system compliance

| Token/rule                                                    | Expected                                                                                                                     | Observed                                                                                                                                           | Status            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `--gradient-cta` (`styles.css:12`)                            | `linear-gradient(135deg, #f5a524, #ffbb4d)`, mirrored under RTL per `rtl:bg-gradient-to-l`                                   | Confirmed both stops present, direction reversed correctly under `dir="rtl"`                                                                       | Pass              |
| `.ltr-island` (`styles.css:71-78`)                            | `direction: ltr; unicode-bidi: isolate; text-align: left`                                                                    | Applied to version numbers, asset labels, asset sizes; rendered LTR/left-aligned inside RTL rows                                                   | Pass              |
| `text-neutral-content/40`                                     | (no explicit token minimum documented in `styles.css`, but must clear WCAG AA per this repo's stated accessibility standard) | ≈2.6:1 measured, below 4.5:1                                                                                                                       | Fail — Serious #1 |
| `[lang='ar']` line-height/tracking rules (`styles.css:82-99`) | 1.75 line-height, no tracking, no uppercase-transform on Arabic text                                                         | Not directly exercised by this page (no `tracking-*`/`uppercase` utility classes present on Arabic-rendered text here) — not applicable, not a gap | N/A               |

### Accessibility audit

- Standard applied: repository declares no explicit accessibility standard in `context.md`/`design-spec.md`'s reviewed sections for this task, so WCAG 2.2 AA was applied per this review's own default, citing SC 1.4.3 (contrast, 4.5:1 normal text) and SC 2.5.8 (target size, 24×24 CSS px minimum).
- Contrast pairs measured (via `canvas.fillStyle` sRGB conversion + relative-luminance compositing, run against the live page, not against static token values):
  - `text-neutral-content` (filename lines, hero subtitle, callout body): 6.4–10.5:1 — Pass.
  - `text-neutral-content/40` (asset size, empty-platform text, release-notes link): ≈2.6:1 — **Fail**, Serious #1.
  - VS Code CTA text (`rgb(8,9,12)`) against its gradient background (`#f5a524`/`#ffbb4d` from `styles.css:12`, computed analytically since `getComputedStyle().backgroundColor` cannot read a `background-image` gradient): ≈9.6:1 at the amber stop, ≈11.5:1 at the lighter stop — Pass, both comfortably above 4.5:1 (and 3:1 for UI components).
  - "LATEST" badge (`bg-secondary/15` + green text): composited badge background ≈`rgb(20,45,41)` against text `rgb(52,211,153)` ≈7.7:1 — Pass.
- Touch targets measured via `boundingBox()` at 375px width:
  - Release toggle button: 327×70 — Pass (well above 24×24).
  - Download link row: ~293×60 (1366px), scales with content — Pass.
  - VS Code CTA: ~135-199×48 depending on language — Pass.
  - "View release notes" link: 131×16 — **Fail**, Serious #2 (height only, width is fine).
- Focus order: Tab sweep confirmed a visible focus ring on nav, release-toggle, and download-link elements. Note: `getComputedStyle().outlineColor` read back as `rgb(16,16,16)` (near-black) for `outline: auto`, which would suggest an invisible ring against the dark theme — but the actual rendered screenshots (`download-en-1366-focus-toggle.png`, `download-en-1366-focus-downloadlink.png`) show a clearly visible light outline. This is `outline-color: auto`'s browser-native invert-against-background behavior, which `getComputedStyle` does not serialize accurately — the screenshot, not the computed-style read, is the reliable signal here, and it shows the ring works. No finding.
- Semantic structure: single `<h1>` ("Downloads"/"التنزيلات"), release rows are `<button aria-expanded="...">`, download rows are real `<a href>` elements — all reachable via Tab, none found keyboard-inaccessible.
- Hydration: no `NG05xx`-prefixed console messages, no console errors beyond outbound Google Fonts requests failing at the network layer (`ERR_TUNNEL_CONNECTION_FAILED`/`ERR_CERT_AUTHORITY_INVALID`) — an artifact of this sandboxed environment's outbound proxy blocking `fonts.googleapis.com`/`fonts.gstatic.com` (confirmed by tracing the URLs against `apps/ptah-landing-page/src/index.html:23`/`:108-111`), not an application defect; text still rendered fully and legibly via the system-font fallback in every screenshot. Checked in both languages.

### Visual performance

- The VS Code callout and the release-card `viewportAnimation` directive both fade/slide in only once scrolled into view — confirmed by capturing the page before scroll (elements present but at reduced opacity in the full-page screenshot, e.g. faint in `download-en-1366-focus.png`) versus after `scrollIntoViewIfNeeded()` + a settle delay (fully opaque in `download-en-1366-callout.png`). This is the component's intended behavior (`ViewportAnimationConfig`), not a defect, and the checklist's instruction to "scroll into view before capturing" was followed for the callout-specific captures.
- One capture artifact worth recording so it isn't mistaken for a bug: `download-en-375-expanded.png` and `download-ar-375-expanded.png` (full-page screenshots) show the `position: fixed` top nav bar appearing a second time partway down the image. Verified this is a Playwright full-page-screenshot stitching artifact — the nav (`nav.fixed.top-0.inset-x-0.z-50`, `libs/web/ui`) is genuinely `position: fixed`, and a direct scroll-and-capture at the same scroll offset (`debug-scrolled-850.png`, not saved to the deliverable folder) shows it correctly pinned to the viewport top with page content flowing normally beneath — no real duplicate element, no real overlap. No finding.
- No layout-shift sources beyond the above intentional scroll-triggered animation were observed across the 12 viewport/language sweeps.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: two AA accessibility failures — asset-size/empty-state/release-notes text failing contrast (≈2.6:1 vs. the 4.5:1 minimum) and the "View release notes" link's touch target (16px vs. 24px minimum) — both isolated to the `text-neutral-content/40` utility and the un-padded release-notes anchor, both mechanical, low-risk fixes; no visual-breaking, RTL-mirroring, or prototype-fidelity issues were found anywhere in the 12-viewport/language sweep.
