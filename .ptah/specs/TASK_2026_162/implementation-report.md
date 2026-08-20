# TASK_2026_162 — Implementation Report (frontend-developer)

Landing-page repositioning to the production-SaaS wedge. Copy-only per spec, plus one new section component. Angular 21, OnPush, standalone, no `[innerHTML]`. No git operations performed.

## Verification

- `npx nx build ptah-landing-page --configuration=production`: **GREEN**. Initial total **851.89 kB** raw / 222.40 kB transfer — under the 1 MB warn budget (no budget warnings emitted). 6 static routes prerendered successfully with the new copy. The Angular application builder performs full TS + template type-checking; there is no separate `typecheck` target on this project (`nx typecheck ptah-landing-page` errors "Cannot find configuration"), so the production build is the type gate. It passed clean.
- Trial-language grep after edits: **zero** `100 days` / `100-day` / `free trial` strings remain in the marketing sections. All remaining hits are in files outside the copy-swap scope — see "Leftovers flagged" below.

## Files changed (all absolute)

### Hero + SEO/meta (§2)

- `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/sections/hero/hero-content-overlay.component.ts` — eyebrow, `aria-label`, `data-plain` markup (Headline A, glow span now "It Ships the SaaS."), subheadline, CTA helper text. Decrypt/engrave animation code untouched.
- `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/sections/hero/hero-device-showcase.component.ts` — stat entry `100-day / free trial` → `Free / and open source`.
- `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/sections/cta/cta-section.component.ts` — subheadline + `trustSignals` array.
- `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/landing-page.component.ts` — SeoService `title`, `description`, `ogTitle`, `ogDescription`; wired in the new Builders section (import + template `<ptah-builders-section />` after Comparison, before Also Available).
- `D:/projects/ptah-extension/apps/ptah-landing-page/src/index.html` — `<title>`, meta `description`, `og:title`, `twitter:title`, `og:description`, `twitter:description`, and the SoftwareApplication JSON-LD `offers.description` (trial/pricing string removed).

### Feature sections (§3a–3f)

- `.../sections/problem/problem-section.component.ts` — eyebrow, H2, both body paragraphs (§3a).
- `.../sections/pillar-memory/pillar-memory.component.ts` — eyebrow, H2, sub, card 1 & card 2 bodies (§3b).
- `.../sections/pillar-skills-orchestration/pillar-skills-orchestration.component.ts` — eyebrow, H2, sub, all four card bodies, stat callout (§3c).
- `.../sections/provider-strip/provider-strip.component.ts` — eyebrow, H2, sub, trust line (§3d).
- `.../sections/pillar-always-on/pillar-always-on.component.ts` — eyebrow, H2, sub, card 1 & card 3 bodies, stat callout (§3e).
- `.../sections/comparison/comparison-split-scroll.component.ts` — eyebrow, H2 (Headline B verbatim), sub, left-column header, closing paragraph; **`cursorRows` renamed to `vibeCodingRows`** with the four production-SaaS axes; `ptahRows` re-axed. Template loop + comment updated to match (§3f).

### New Builders section (§4)

- `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/sections/builders/builders-section.component.ts` — NEW. Selector `ptah-builders-section`, section `id="builders"`, standalone, OnPush. Mirrors the pillar visual pattern: `ConsoleGridBackgroundComponent [glow]`, font-mono amber eyebrow, `text-3xl sm:text-4xl lg:text-5xl` H2, `text-lg sm:text-xl text-ink-400` sub, `rounded-xl border border-ink-700 bg-ink-850` cards, `ViewportAnimationDirective` fadeIn/slideUp entrances. Four value cards (lucide `GraduationCap`, `BookOpen`, `Package`, `LifeBuoy`), price rendered as the `$29 to $49` range exactly, amber CTA `Join the Waitlist` → `href="#waitlist"`, microcopy under CTA.

### Pricing page (§5, visible strings only)

- `.../pages/pricing/pricing-page.component.ts` — SeoService title/description/ogTitle/ogDescription (§5a).
- `.../pages/pricing/components/pricing-hero.component.ts` — H1 (+ amber span) and subhead (§5b).
- `.../pages/pricing/components/pricing-grid.component.ts` — `communityPlan` → "Ptah" (name, priceSubtext, idealFor, standoutFeatures, ctaText "Download Free"); `proMonthlyPlan`/`proYearlyPlan` → "Ptah Builders" (name, idealFor, standoutFeatures; monthly price `$29-49` + founding-member subtext) (§5c).
- `.../pages/pricing/components/pro-plan-card.component.ts` — features header "Everything free, plus:", default badge "Founding Member", `proFeatures` list → Builders features (§5c).
- `community-plan-card.component.ts` required no edits — it renders `plan().*`, all driven by the updated `communityPlan` data.

### Scope-adjacent trial-language reconciliation

- `.../pages/download/download-page.component.ts` — SEO `description` + `ogDescription` had "100-day free trial, no credit card". Not a pricing file, so it would fail the verify gate; swapped to "Free and open source, no credit card" (pure SEO copy, no logic). Flagged here as a fix just outside the enumerated file list.

## Spec deviations / decisions

1. **`index.html` scope widened beyond the two lines the spec named.** Spec §2 listed only `og:title` (l.19) and `twitter:title` (l.33). I also updated `<title>`, meta `description`, `og:description`, `twitter:description`, and the JSON-LD `offers.description` — because (a) the meta `description` and JSON-LD carried "Free trial" / "100-day free trial" which the verify gate requires be zero outside pricing files, and (b) leaving the paired social `description`s on the old "persistent, multi-agent" positioning while flipping their titles would be incoherent. All are pure meta copy.
2. **`landing-page.component.ts` `title` swap.** Spec said line 90 (title) gets the same "It Ships" swap; the actual `title` was the older "Persistent, Multi-Agent…" string (not the "It Remembers…" string the spec quoted). I set it to the approved headline `Ptah — It Knows Your Architecture. It Ships the SaaS.` to carry the equity token, matching the ogTitle.
3. **Builders component uses the sibling pillar pattern (plain `readonly` fields), not literal `signals + inject()`.** The section is fully static (no state, no injected service). The existing pillar sections it must visually match use plain `readonly` properties with OnPush + standalone and neither signals nor `inject()`. Per "follow the visual pattern of existing pillar sections" and "match surrounding code style" (and CODEBASE-OVER-PLAN), I matched the siblings rather than introducing a contrived signal/injection. OnPush + standalone are honored.
4. **BLOCKED-ON-TASK_2026_163 — Ptah Builders (Pro) card CTA.** The Pro-card CTA text is data-driven: `pro-plan-card` renders `computeCtaText(ctaVariant())` from `plan-card-state.utils.ts` (returns "Start 100-Day Free Trial" for the `start-trial` variant), and the click fires Paddle checkout via `ctaClick → handleCtaClick → proceedWithCheckout`. Per task instruction, I did **not** rewire this to "Join the Waitlist" (that would need `ctaAction`/util/logic changes = business logic). The OLD ctaText/behavior is kept intact. So the pricing page's Builders button still reads "Start 100-Day Free Trial" and opens Paddle until 163 replaces the flow. `plan().ctaText` ("Start 100-Day Free Trial") on `proMonthlyPlan`/`proYearlyPlan` is likewise left — it is unused by the pro card display but is business-logic-tagged; left per copy-only boundary.
5. **BLOCKED-ON-TASK_2026_163 — yearly SKU / billing toggle.** Spec §5c says "drop the separate yearly SKU … keep monthly only." Removing `proYearlyPlan` and the monthly/yearly toggle is structural billing-logic (touches `priceId`, `setBillingPeriod`, the toggle template, the `-17%` savings badge) — explicitly out of the "visible strings only, do not touch Paddle wiring" boundary. I kept the yearly SKU + toggle intact and updated its visible strings (name/idealFor/features) for consistency. **Consequence to fix in 163:** with the toggle still present, monthly now shows `$29-49` while the yearly toggle still shows the stale `$50 / per year`; drop the yearly SKU/toggle in 163 to resolve the contradiction.

## Leftovers flagged (trial-language outside the copy-swap scope — intentionally not touched)

Business-logic / pricing files I was told to leave:

- `.../pages/pricing/utils/plan-card-state.utils.ts:141,159` — `computeCtaText` "Start 100-Day Free Trial" (subscription-state driven; see deviation 4).
- `.../pages/pricing/components/pricing-grid.component.ts:447,473` — `ctaText` fields (unused for display, business-logic-tagged; see deviation 4). Also a stale docblock comment at l.49.
- `.../pages/pricing/components/plan-card.component.ts:61` — `{{ plan().trialDays }}-Day Free Trial` badge. This component is **not** used by the pricing grid (grid uses community-/pro-plan-card), appears to be legacy/unused, so it does not render on the pricing page.
- `.../pages/pricing/models/pricing-plan.interface.ts:8,209` — comments.

Out-of-scope pages / config (not marketing sections, higher risk to reword):

- `.../pages/legal/terms-page.component.ts` and `.../pages/legal/refund-page.component.ts` — "100-day free trial" appears in legal contract text. These are legal statements tied to the still-live Paddle terms; a frontend copy pass should not silently reword them. Recommend legal/business owner handles alongside 163.
- `.../environments/environment.ts` and `environment.production.ts` — `$5/month, $50/year (100-day trial)` in config comments next to live Paddle price IDs. Left until 163 changes the actual pricing wiring.
- `.../pages/profile/models/license-data.interface.ts:52` — comment describing the `trial_pro` status.

## Notes

- All source files listed in the spec were readable this session (no permission declines); the spec's "not readable" caveats (landing-page/pricing files) did not apply here — I verified surrounding line numbers directly before editing.
- The `65%` security statistic was not introduced anywhere (per §1 / context.md).

## Revision 1 — visual-review NEEDS_REVISION fixes (layout-only, no copy strings changed)

Addressed the three findings in `visual-review.md`. All fixes are Tailwind class changes only; no approved copy string was altered.

1. **BLOCKING — pricing-grid promo-toggle overlaps hero subheadline at ≤768px.**
   `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts` (grid wrapper, was line 69). Replaced the fixed `mt-[-150px]` pull-up with a responsive value: `-mt-16 sm:-mt-24 lg:-mt-[150px]`. The full -150px pull is now applied only at `lg`+ (where the review confirmed the hero subheadline fits 3 lines and there is no overlap); at mobile/tablet — where the longer §5b subheadline wraps to 4 lines — the pull-up shrinks to 64px/96px, clearing the measured ~38px encroachment on the subheadline box. The `lg` desktop layout (which the review passed) is unchanged.

2. **BLOCKING — Ptah Builders price `$29-49` wraps mid-number.**
   `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/pages/pricing/components/pro-plan-card.component.ts` (price span, ~line 201). Added `whitespace-nowrap` so the browser can no longer break at the hyphen, and stepped the font down at small widths (`text-4xl sm:text-5xl lg:text-6xl`, was `text-5xl lg:text-6xl`) so the now-unbreakable range plus the `/ per month, founding-member pricing` caption still fit the `flex items-baseline` row at 390px without forcing an awkward caption wrap. `lg`+ desktop size (`text-6xl`) is preserved. Only the pro card was touched; the community card price ("Free") never wraps.

3. **SERIOUS — Builders card 4 (Priority Support) dead space at 1440px.**
   `D:/projects/ptah-extension/apps/ptah-landing-page/src/app/sections/builders/builders-section.component.ts` (card grid). Added `items-start` to the `grid sm:grid-cols-2 lg:grid-cols-4` wrapper so each card takes its natural content height instead of stretching to the tallest sibling — the shorter Priority Support card no longer carries ~150–180px of empty space. Fixed via layout only; the approved §4 card copy is unchanged. (Single-column mobile stacking is unaffected since each card is already full-width there.)

**Rebuild**: `npx nx build ptah-landing-page --configuration=production --skip-nx-cache` — **GREEN**, 6 static routes prerendered, no budget warnings (changes are class-string-only; initial bundle unchanged at ~852 kB, under the 1 MB budget).
