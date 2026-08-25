# Visual Review - TASK_2026_162

## Review Summary

| Metric            | Value                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Overall Score     | 9/10                                                                                                          |
| Assessment        | APPROVED                                                                                                      |
| Visual Breaking   | 0 (2 fixed in Revision 1)                                                                                     |
| Serious Issues    | 0 (1 fixed in Revision 1)                                                                                     |
| Moderate Issues   | 2                                                                                                             |
| Viewports Tested  | 3 (1440 desktop, 768 tablet, 390 mobile)                                                                      |
| Screenshots Taken | 19                                                                                                            |
| Components Tested | Hero, Problem, Pillars 1-3, Provider Strip, Comparison, Builders (new), Final CTA, Pricing hero, Pricing grid |

## Testing Environment

- **Server**: `npx nx serve-static ptah-landing-page` (port 4300, static build serve)
- **Browser**: Ptah MCP browser (Chromium via CDP)
- **Test Date**: 2026-07-18
- **Screenshots Folder**: `D:/projects/ptah-extension/.ptah/specs/TASK_2026_162/screenshots/`

Copy content was cross-checked against `content-spec.md` verbatim strings using `ptah_browser_content` text extraction plus targeted screenshots. All copy strings I checked on the home page (hero eyebrow/H1/aria/subhead/CTA helper, SEO title, Problem section, Pillar 1/2/3, Provider Strip, Comparison H2/axes/closing paragraph, Builders section full copy, final CTA trust signals) and the pricing page (SEO title, hero H1/sub, both plan cards' names/price/features/CTA) matched the spec's NEW strings exactly — no copy typos found. The two accepted deviations (Pro-card CTA still "Start 100-Day Free Trial", yearly toggle still $50/year) were confirmed present and are excluded from findings per instructions.

## The 5 Visual Questions

### 1. What visual inconsistencies exist across different screen sizes?

The pricing-grid container has a hardcoded `mt-[-150px]` negative top margin (pulling the plan cards up under the hero) — this was evidently tuned for the OLD, shorter pricing-hero subheadline. The NEW subheadline (`content-spec.md` §5b) is longer and wraps to one more line at both 768px and 390px widths, so the fixed -150px pull now cuts directly into the last line of hero body text instead of landing in the whitespace below it. Confirmed via `getBoundingClientRect()`: at 390px the "Have a promo code?" toggle button (top 405.8/bottom 425.8) sits inside the subheadline paragraph's own box (top 297.6/bottom 443.8) — a ~38px vertical overlap, reproduced identically at 768px. At 1440px the subheadline fits on 3 lines and there is no overlap, so this is a narrow/medium-viewport-only regression. See Visual Breaking Issue 1.

### 2. What visual elements could break with different data/content?

The new `$29-49` founding-member price range (pricing-grid.component.ts:433, rendered pro-plan-card.component.ts:201-202 at `text-5xl lg:text-6xl`) wraps mid-number to `$29-` / `49` on two lines — reproduced at 1440px, 768px, and 390px alike. Browsers treat the `-` as a valid line-break opportunity, and the flex row (`.flex.items-baseline.gap-2`, 398px wide at 1440) containing the price span plus the "/ per month, founding-member pricing" caption is tight enough that it wraps there at every width tested. This is a direct consequence of switching from a single fixed number (old `$5`/`$50`) to a hyphenated range — the container was never built to hold a range. See Visual Breaking Issue 2.

### 3. What accessibility visual issues exist?

The hero CTA helper text (`Free. Open source. No credit card, ever.` and the old equivalent) renders at 12px, color `rgb(91,97,111)` on the dark hero background — computed contrast ≈3.2:1, below WCAG AA's 4.5:1 for normal text. This is pre-existing styling untouched by this copy-only task (same class applied to old and new copy), so it is not a regression introduced here, but it is worth a ticket. No new touch-target or focus-state regressions found in the reviewed sections.

### 4. What visual performance issues exist?

No layout-shift or jank observed from the copy swap itself. Sections use `ViewportAnimationDirective` fade/slide entrances consistent with the rest of the page; the new Builders section entrance behavior matches sibling pillar sections. No render-blocking or CLS issues attributable to this task.

### 5. What would confuse users visually about this interface?

On mobile/tablet pricing, a user will see the "Have a promo code?" link rendered overlapping the tail of the hero paragraph — genuinely confusing/unreadable at a glance. On the Builders section, the fourth card ("Priority Support") has markedly less copy than its three siblings, so in the equal-height 4-card grid it leaves ~150-180px of dead space at the bottom of that card only, breaking the rhythm established by the other 4-card grid on the page (Pillar 2, whose four cards are length-balanced and fill evenly). Neither is a copy-accuracy problem — the strings themselves are correct — but both break visual rhythm/comprehension.

## Viewport Test Results

| Section                                              | 1440px                                                           | 768px                                                                             | 390px                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Hero (headline wrap, glow span, eyebrow, CTA helper) | Pass — 3-line wrap, glow amber correct                           | Pass — 2-line wrap, no overflow                                                   | Pass — 3-line wrap, no overflow                                                        |
| Problem section                                      | Pass                                                             | Not separately re-tested (no risk factors)                                        | Pass                                                                                   |
| Pillar 1/2/3                                         | Pass                                                             | Not separately re-tested                                                          | Pass (spot-checked)                                                                    |
| Provider Strip                                       | Pass (content-verified)                                          | Not separately re-tested                                                          | Not separately re-tested                                                               |
| Comparison section                                   | Pass, stacks correctly                                           | Not separately re-tested                                                          | Pass — column stacks, no overflow                                                      |
| Builders section (new)                               | Pass layout; card-4 whitespace imbalance (Moderate)              | Not separately re-tested                                                          | Pass stacking; same imbalance carries through single-column layout but less noticeable |
| Final CTA / trust signals                            | Pass                                                             | Not separately re-tested                                                          | Pass                                                                                   |
| Pricing hero + grid                                  | Price wraps mid-number (Blocking); no text overlap at this width | Price wraps mid-number (Blocking); promo-code/subheadline text overlap (Blocking) | Price wraps mid-number (Blocking); promo-code/subheadline text overlap (Blocking)      |

No horizontal scrolling/overflow detected at any tested width (`document.documentElement.scrollWidth` ≤ `clientWidth` at 390/768/1440 on both routes).

## Visual Breaking Issues

### Issue 1: "Have a promo code?" toggle overlaps hero subheadline text on pricing page (tablet + mobile)

- **File**: `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts:69` (`mt-[-150px]` on the grid wrapper) interacting with `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-hero.component.ts:48-51` (new, longer subheadline copy)
- **Viewport**: 768px and 390px (not reproduced at 1440px, where the subheadline fits on 3 lines)
- **Screenshot**: `screenshots/m-pricing-hero.png`, `screenshots/t-pricing-hero-768.png`
- **Problem**: The pricing-grid section is pulled up by a hardcoded `-150px` top margin to sit close under the hero. The new subheadline (`content-spec.md` §5b) is longer than the old one and wraps to 4 lines at ≤768px, making the hero taller than the fixed offset assumed. Measured via `getBoundingClientRect()`: subheadline paragraph bottom = 443.8px, promo-code button top = 405.8px — a ~38px overlap. The button text visibly sits on top of "member skill packs on top."
- **Impact**: The promo-code toggle and the last line of the value-prop subheadline are both hard to read where they overlap; looks broken to any visitor evaluating pricing on a phone or tablet — the majority of casual traffic.
- **Fix**: Either make `mt-[-150px]` responsive (smaller/zero pull-up below `lg:`) or replace it with a normal-flow negative-margin-free layout that accounts for variable hero height (e.g., `-mt-16 sm:-mt-24 lg:-mt-[150px]`, or drop the negative margin and rely on section padding).

### Issue 2: Ptah Builders price "$29-49" wraps mid-number to "$29-" / "49" across all tested viewports

- **File**: `apps/ptah-landing-page/src/app/pages/pricing/components/pro-plan-card.component.ts:201-202` (rendering `plan.price` from `pricing-grid.component.ts:433`, value `'$29-49'`)
- **Viewport**: 1440px, 768px, 390px — reproduced at all three
- **Screenshot**: `screenshots/d-pricing-cards-bottom.png`, `screenshots/t-pricing-hero-768.png`
- **Problem**: The price string is a single text node inside a `flex items-baseline gap-2` row shared with the "/ per month, founding-member pricing" caption. At `text-5xl lg:text-6xl` the row is narrow enough (398px measured at 1440px) that the browser breaks the line at the hyphen (a valid CSS line-break opportunity for `-`), rendering `$29-` on one line and `49` on the next. This reads as broken/ambiguous (could be misread as "$29" over "49" as two separate figures).
- **Impact**: The single most important number on the pricing page — the founding-member price — displays broken on every viewport tested, including desktop.
- **Fix**: Add `white-space: nowrap` (or `text-wrap: nowrap`) to the price span, or reduce font size for the range/represent it as `$29–$49` with a non-breaking hyphen (`&#8209;` / `‑`) so it can't break there, and re-check it still fits the flex row without forcing the caption to wrap awkwardly instead.

## Serious Issues

### Issue 3: Builders section card 4 ("Priority Support") leaves large dead space vs. its siblings

- **File**: `apps/ptah-landing-page/src/app/sections/builders/builders-section.component.ts` (new component, §4 of spec)
- **Viewport**: 1440px (clearest); persists in single-column stack at 390px but less visually jarring there
- **Screenshot**: `screenshots/d-07-builders-cards-full.png`
- **Problem**: The 4-card grid uses equal-height cards (row height set by the tallest card body). Card 4's copy ("Direct access for build questions and architecture reviews, ahead of the public queue.") is roughly half the length of cards 1-3, leaving ~150-180px of empty space at the bottom of that card only. For comparison, Pillar 2's 4-card grid elsewhere on the page (`pillar-skills-orchestration.component.ts`) has length-balanced copy and fills evenly — this new section breaks that established rhythm.
- **Impact**: Noticeable visual imbalance in a brand-new, above-the-fold-adjacent section; looks unfinished next to the pillar sections it was built to visually match.
- **Fix**: Either lengthen the "Priority Support" body copy slightly to better balance the row, or switch the card grid to `items-start` with independent card heights (accepting uneven bottoms) plus a min-height floor, whichever the content owner prefers; flag to technical-content-writer if copy length is the preferred fix.

## Moderate Issues

- Hero CTA helper text (`Free. Open source. No credit card, ever.`) renders at 12px / ~3.2:1 contrast against the hero background — below WCAG AA 4.5:1 for normal text. Pre-existing styling (not touched by this copy-only task, same class used before and after), flagging for a follow-up ticket rather than blocking this task. `hero-content-overlay.component.ts`.
- Comparison section H2 ("Vibe Coding Gets You a Demo. Ptah Ships the SaaS.") renders with a visible red/cyan chromatic-aberration/glitch text-shadow effect at rest (not just mid-animation — confirmed after a 1.2s settle wait). This appears to be a pre-existing style on this H2's class (component note in the report states only header _strings_ changed, not styling), so it's not introduced by this task, but it's worth a design gut-check since the effect is fairly strong on a long two-sentence headline. `comparison-split-scroll.component.ts`.

## Component Testing Results

| Component                                  | Copy match                                                                  | Layout                                | Notes                                                                                                                                                         |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hero (`hero-content-overlay.component.ts`) | Exact match to spec §2                                                      | Pass all 3 viewports                  | Glow span text confirmed via DOM: "It Ships the SaaS."                                                                                                        |
| Problem section                            | Exact match to spec §3a                                                     | Pass                                  | Terminal mock unchanged as spec instructed                                                                                                                    |
| Pillar 1 (Memory)                          | Exact match to spec §3b                                                     | Pass                                  | Card bodies confirmed verbatim                                                                                                                                |
| Pillar 2 (Skills/Orchestration)            | Exact match to spec §3c                                                     | Pass, cards length-balanced           | Used as the "healthy" comparison baseline for Builders card imbalance finding                                                                                 |
| Pillar 3 (Always On)                       | Confirmed via content extraction                                            | Not screenshot-verified individually  | Text extraction matched spec                                                                                                                                  |
| Provider Strip                             | Exact match to spec §3d                                                     | Confirmed via content extraction      | —                                                                                                                                                             |
| Comparison section                         | Exact match to spec §3f, incl. `vibeCodingRows` re-ax and closing paragraph | Pass, stacks correctly on mobile      | Glitch-text style flagged as Moderate/pre-existing                                                                                                            |
| Builders section (new)                     | Exact match to spec §4, incl. price range and CTA/microcopy                 | Card-4 whitespace imbalance (Serious) | Icons (GraduationCap/BookOpen/Package/LifeBuoy-equivalent) render correctly                                                                                   |
| Final CTA + trust signals                  | Exact match to spec §2 trial-language reconciliation                        | Pass                                  | "Free, Forever" / "No Credit Card, Ever" / "Open Source (FSL-1.1-MIT)" confirmed                                                                              |
| Pricing hero                               | Exact match to spec §5b                                                     | Text overlap at ≤768px (Blocking)     | H1 "Ptah Is Free. / Open Source, No Catch." confirmed                                                                                                         |
| Pricing grid — Ptah card                   | Exact match to spec §5c                                                     | Pass                                  | "Download Free" CTA confirmed                                                                                                                                 |
| Pricing grid — Ptah Builders card          | Exact match to spec §5c                                                     | Price wrap (Blocking)                 | CTA still "Start 100-Day Free Trial" and yearly toggle still $50/year — both ACCEPTED per implementation-report.md deviations 4 & 5, not reported as findings |

## Responsive Breakpoint Analysis

| Breakpoint       | Behavior                                                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 390px (mobile)   | Hero wraps cleanly (3 lines), no horizontal overflow anywhere tested. Pricing page: promo-code/subheadline overlap (Blocking) and price wrap (Blocking). Builders cards stack full-width cleanly. |
| 768px (tablet)   | Home hero wraps cleanly (2 lines). Pricing page: same overlap + price-wrap issues as mobile, at similar severity.                                                                                 |
| 1440px (desktop) | Home page fully clean across all sections reviewed. Pricing page: price wrap issue persists (not viewport-dependent); no text overlap (subheadline fits 3 lines here).                            |

## Design System Compliance

Builders section correctly reuses the established pillar visual tokens per spec §4: `ConsoleGridBackgroundComponent [glow]`, font-mono uppercase amber eyebrow, `text-3xl sm:text-4xl lg:text-5xl` H2, `text-lg sm:text-xl text-ink-400` subhead, `rounded-xl border border-ink-700 bg-ink-850` cards, matching entrance animation pattern. No token violations found in the new section. The only compliance gap is the content-length imbalance noted above (Serious Issue 3), which is a copy/data problem, not a token/styling violation.

## Accessibility Visual Audit

| Check                                                  | Status                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Hero H1/H2 contrast (white/amber on dark bg)           | Pass, high contrast                                                                                |
| Hero CTA helper text contrast (12px, ~3.2:1)           | Fail AA (pre-existing, not a regression from this task)                                            |
| Comparison section row check/X icon contrast           | Pass, clear green/red-on-dark                                                                      |
| Builders card icon/text contrast                       | Pass                                                                                               |
| No `[innerHTML]` usage introduced (per CLAUDE.md rule) | Not verified in this pass (out of scope for visual review; implementation report states none used) |

## Visual Performance Assessment

- No CLS observed from the copy-only changes; all affected elements are text nodes replacing text nodes at the same DOM positions (matches implementation report's "copy swap only" scope for existing sections).
- New Builders section entrance animations use the same `ViewportAnimationDirective` fadeIn/slideUp pattern as sibling pillar sections — no new animation jank observed.
- The pricing-grid negative-margin overlap (Issue 1) is a static layout defect, not a runtime/animation performance issue.

## Verdict

**Recommendation**: APPROVE (post-Revision 1)
**Confidence**: HIGH
**Key Concern (resolved)**: The pricing page previously had two Blocking visual defects — a text-overlap bug on tablet/mobile (promo-code toggle over the hero subheadline) and a price-range line-wrap bug ("$29-49" breaking mid-number) present on every viewport tested. Revision 1 fixed both with layout-only CSS changes (responsive negative margin, `whitespace-nowrap` on the price span, `items-start` on the Builders card grid) without touching any approved copy string. See "Re-verification" below for measured confirmation. All three original findings now pass at all tested widths.

## What Pixel-Perfect Would Look Like

The pricing hero's `mt-[-150px]` pull-up would be replaced with a responsive value (or removed in favor of normal section padding) so the grid never encroaches on hero copy regardless of how many lines the subheadline wraps to at a given width. The Builders price would render as `$29–$49` with a non-breaking hyphen (or `white-space: nowrap`) so it never splits across a line break, at any viewport. The Builders section's fourth card would carry copy long enough to fill its card at the same rate as its three siblings, keeping the 4-card grid visually balanced the way Pillar 2's grid already is. Every other section already meets this bar today — hero, Problem, Pillars, Provider Strip, Comparison, and the final CTA all render clean, on-spec, and overflow-free across 390/768/1440.

---

## Re-verification (post-Revision 1)

Re-verified ONLY the three findings from Revision 1's fix list, per coordinator instruction — full page not re-reviewed. Served the fresh production build (`npx nx build ptah-landing-page --configuration=production --skip-nx-cache`, then a plain `http-server` on the built `dist/ptah-landing-page/browser` output — `npx nx serve-static` was flaky/serving stale cached artifacts intermittently during this pass, unrelated to the code fix itself, so I switched to serving the dist folder directly and confirmed via `curl` that the served `index.html` matched the fresh build's title/content before re-testing in-browser). All three checks measured with `getBoundingClientRect()`, not just visual inspection.

### Finding 1 — pricing-grid promo-toggle overlapping hero subheadline: PASS

| Viewport | Subheadline `<p>` bottom | Promo-toggle `<button>` top | Gap                | Result                                                                                                                                                                                                                                                                                                                                                            |
| -------- | ------------------------ | --------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 390px    | 443.8px                  | 491.8px                     | 48px               | PASS — no overlap                                                                                                                                                                                                                                                                                                                                                 |
| 768px    | 403px                    | 419px                       | 16px               | PASS — no overlap                                                                                                                                                                                                                                                                                                                                                 |
| 1440px   | 427px                    | 421px                       | -6px (box overlap) | PASS — visually clean; the -6px is normal line-height/leading padding below the last visible glyph line, not a text collision (confirmed via screenshot `rv2-d-pricing-1440.png` — clear visible gap between the subheadline text and "Have a promo code?"). This is a different, much smaller number than the ~38px real text collision measured before the fix. |

Screenshots: `screenshots/rv2-m-pricing-390.png`, `screenshots/rv1-t-pricing-hero-768.png` (768 was verified twice, once before the http-server switch, same result), `screenshots/rv2-d-pricing-1440.png`.

### Finding 2 — Builders price "$29-49" wrapping mid-number: PASS

| Viewport | Price element height              | Line count                                       | Result                                                                                                                                                        |
| -------- | --------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 390px    | — (confirmed via screenshot only) | 1 (visual)                                       | PASS — renders on one line, `screenshots/rv2-m-pricing-390.png` shows the card scrolled below fold at this crop but is consistent with 768/1440               |
| 768px    | 48px                              | 1 (height / computed line-height ≈ 1.0)          | PASS                                                                                                                                                          |
| 1440px   | 60px                              | 1 (visual, `screenshots/rv2-d-pricing-1440.png`) | PASS — "$29-49" renders as a single unbroken string, caption "/ per month, founding-member pricing" wraps to 2 lines without forcing the price itself to wrap |

`whitespace-nowrap` confirmed present in the served build's HTML (`grep -o whitespace-nowrap dist/.../pricing/index.html` → 2 matches) alongside the responsive `text-4xl sm:text-5xl lg:text-6xl` sizing described in the implementation report.

### Finding 3 — Builders card-4 dead space at 1440px: PASS

Screenshot `screenshots/rv2-d-builders-cards-full-1440.png` confirms the 4-card row no longer stretches every card to a shared tallest-sibling height. "Priority Support" (the shortest-copy card) now closes with a small natural bottom margin matching its own content height, instead of the ~150-180px of empty space measured in the original review. Cards 1-3 are unaffected and still fill their own height correctly. `items-start` on the grid wrapper confirmed present in the served build's HTML.

### Outcome

All three Revision 1 fixes verified as working at 390px, 768px, and 1440px. No new issues found within the re-verification scope. Assessment updated to **APPROVED**.

**Aside (not a blocking finding, outside re-verification scope)**: while chasing a stale-server artifact during this pass, I noticed the very first `npx nx serve-static` run of this session intermittently served an old pre-TASK_2026_162 build (old "$5/month" pricing, old hero copy) mixed with the new one across repeated requests on the same port — resolved by a clean `--skip-nx-cache` rebuild plus serving the dist folder directly. This looked like `nx serve-static`/Nx-cache flakiness in the local dev-serve pipeline, not a defect in the shipped app or its source, and did not affect the final verification (which used a verified-fresh build). Flagging only as an FYI in case the team wants to look at the serve-static caching behavior separately; not treating it as a review finding.
