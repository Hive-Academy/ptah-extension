# Code Style Review — `TASK_2026_533` Batch 11

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------ |
| Overall score   | 8/10                                 |
| Assessment      | APPROVED                             |
| Blocking issues | 0                                    |
| Serious issues  | 1                                    |
| Minor issues    | 2                                    |
| Files reviewed  | 8 (4 components + 4 specs)           |

Scope verified: `git status --porcelain` in `task533-b11` shows exactly the 8
listed files as untracked, plus `batch-11-report.md`; no barrel/index.ts edit,
matching Batch 9's own no-export precedent and the report's claim.
`ptah_get_diagnostics` on the four `.ts` files returns only pre-existing
errors in unrelated files (`mock-rpc-service.ts`, `connected-surface.component.spec.ts`,
`harness-health.store.spec.ts`) — none in the reviewed files.

## Five style questions

### 1. What breaks in six months?

A content-level change to the storefront hero title or "Your stack" sub-heading
(`storefront-hero.component.ts:131-147`, `:170-182`) or to the source-band
heading (`source-band.component.ts:79-87`) has to be edited in two places (the
`@if`/`@else` branches) instead of one, because the branches duplicate the
full `[id]`, `class`, `data-testid` and interpolation rather than sharing a
template. The nearest sibling this batch's own task row cites as "Pattern to
follow" — `catalog-card.component.ts:123-139` — solved exactly this problem
with `@switch (headingLevel())` + `<ng-container [ngTemplateOutlet]="headingContent" />`,
so the body is written once. A future editor who copies Batch 11's shape
forward will re-introduce the drift risk `ngTemplateOutlet` was adopted to
avoid.

### 2. What would a new team member misread?

Nothing structural. The four files are internally consistent, well-commented
(each doc block states what plan requirement it satisfies and why a design
choice was made — e.g. `featured-connectors.component.ts:102-107` on why
`not-connected` has no pill), and every state (loading/ready/error/empty) is
explicit in both template and spec. A reader coming from `docked-inspector.component.ts`
or `removal-lock-badge.component.ts` (Batch 9, same directory) might initially
expect a component-specific counter name (`nextInspectorId`, `nextLockBadgeId`)
and a descriptive id prefix; Batch 11 instead uses the generic `instanceCounter`
name and two/three-letter prefixes (`psh-`, `pfc-`, `pcb-`). This is not a
Batch 11 invention, though — it is lifted verbatim from `storefront-panel.component.ts:49,139`
and `catalog-card.component.ts:100` in `@ptah-extension/ui`, the exact family
this batch extends. Two conventions for the same thing coexist in the
directory tree (marketplace/ui vs ui/native/catalog-card); Batch 11 picked the
one native to the components it is styled after, which is defensible, not
sloppy.

### 3. What does this cost to maintain?

The duplicated-heading-markup cost (Q1) is the main one: two literal template
regions per dynamic heading, three instances across the batch
(`source-band.component.ts:79-87`, `storefront-hero.component.ts:131-147`,
`storefront-hero.component.ts:170-182`). Secondary, smaller cost: the
storefront gradient utility string (`rounded-2xl border border-base-300
bg-gradient-to-br from-base-200 via-base-100 to-primary/10 p-6`) is repeated
near-verbatim in `source-band.component.ts:26` (`STOREFRONT_CLASS`) and
`storefront-hero.component.ts:111`, with no shared constant, unlike the
`CATALOG_CARD_SHELL_CLASS` precedent (`catalog-card-shell.styles.ts`) that
factors an identical shell string out for reuse across `CatalogCardComponent`
and its skeleton.

### 4. Where is this inconsistent with the rest of the repository?

The heading-duplication point (Q1) is the one real inconsistency: the batch's
own "Pattern to follow" reference (`ptah-catalog-grid` / `ptah-catalog-card`,
Batch 7d) already carries the DRYer `@switch` + `ngTemplateOutlet` idiom for
exactly this problem (dynamic heading level, fixed content), and
`storefront-panel.component.ts` — same `ui/native/catalog-card` folder, same
"storefront" vocabulary — does too. Everything else (theme-token-only styling,
no `innerHTML`, OnPush + signal inputs/outputs, no injection, slot collapse
via `empty:hidden`, icon `aria-hidden` plus a text word for every state,
`data-testid` naming, JSDoc shape) matches Batch 9 and the C8 plan section
exactly.

### 5. What would you have done differently, and why is that better rather than merely other?

Extract the heading into a `<ng-template #headingContent>` (or, for
`SourceBand`/`StorefrontHero`, a tiny shared directive/pipe is unnecessary —
`@switch` on the tag with the body factored via `ngTemplateOutlet`, exactly as
`catalog-card.component.ts` does) so the interpolation, id and classes are
written once per component. This is better than "other" because it is not a
style preference invented for this review — it is the pattern the codebase
already committed to one batch earlier for the identical problem (a
1/2/3-step heading level with fixed content), and the plan explicitly names
that file as this batch's pattern to follow.

## Blocking issues

None found.

## Serious issues

### Duplicated heading markup instead of the established `@switch` + `ngTemplateOutlet` idiom

- File: `source-band.component.ts:79-87`; `storefront-hero.component.ts:131-147`, `:170-182`
- Problem: each dynamic heading is written twice, once per `@if`/`@else`
  branch, with the `[id]`, `class`, `data-testid` and interpolated text
  repeated verbatim except for the tag name. `catalog-card.component.ts:123-139`
  (the pattern this batch's own task row in `batches.md:673` names as
  "Pattern to follow") and `storefront-panel.component.ts:67-83` (same
  `ui/native/catalog-card` folder as the catalog card, part of the same
  "storefront" component family) both solve this with `@switch (headingLevel())`
  and, in the card's case, `<ng-container [ngTemplateOutlet]="headingContent" />`
  so the body exists once.
- Tradeoff: with two copies, a future change to the heading's classes,
  `data-testid`, or interpolated expression must be applied twice; the two
  copies have already started to differ in one respect worth noting —
  `storefront-hero.component.ts`'s "Your stack" side heading (`:170-182`) has
  no `data-testid` on the `<h2>`/`<h3>` at all, while the main hero title does
  (`:132-146`), which is consistent with the two headings serving different
  roles but is exactly the kind of small drift the shared-template approach
  would have prevented by construction.
- Recommendation: factor each duplicated heading pair into a single body
  (template reference variable + `ngTemplateOutlet`, or accept the two-way
  `@if`/`@else` only for the outer tag while sharing the inner content), matching
  `catalog-card.component.ts`'s idiom. Not blocking — the current code is
  correct and tested — but it is the one place this batch diverges from the
  sibling it was told to follow.

## Minor issues

- `source-band.component.ts:26` / `storefront-hero.component.ts:111`: the
  storefront hero gradient (`rounded-2xl border border-base-300 bg-gradient-to-br
  from-base-200 via-base-100 to-primary/10 p-6`) is duplicated near-verbatim
  across the two Task 11.1 files with no shared constant, unlike the
  `CATALOG_CARD_SHELL_CLASS` precedent in `catalog-card-shell.styles.ts`. Low
  cost today (the plan pins the gradient's exact utility classes, so both
  copies are unlikely to drift independently), but a shared `export const`
  would remove the duplication outright.
- `category-bento.component.ts` renders no `description` per tile even though
  the closest prototype reference (`variant-2-storefront.html:569`, `cat.description`)
  shows one under the category name. This is not a plan violation — C8 §8
  (`implementation-plan.md:446`) asks only for "category label, count and
  sample brand marks" — so the simplification is licensed by the plan, not a
  fidelity gap; noted only because a reviewer comparing screenshots to the
  prototype could otherwise flag it as a miss.

## File-by-file

### source-band.component.ts

8.5/10 — 0 blocking, 1 serious (shared with storefront-hero, heading
duplication), 0 minor. Small, focused, matches the C8 contract (`heading`
required, `headingLevel` default 1, slot collapse via `empty:hidden`,
gold-only-on-storefront eyebrow) and its own spec covers every branch,
including the "no innerHTML" source-text assertion also used by every other
Batch 9/11 spec (`source-band.component.spec.ts:155-161`).

### storefront-hero.component.ts

8/10 — 0 blocking, 1 serious (heading duplication, twice in this file), 1
minor (gradient string duplication with source-band). Fully matches
`batches.md:664`'s quality requirements (gold eyebrow used once, hero
gradient literal, tiles from real counts with the "never invent a number"
guard at `:55-70`, "Synced to" through `ptah-target-marks`). No ⌘K search, no
"My Stack" link — verified absent and spec-asserted
(`storefront-hero.component.spec.ts:154-159`).

### featured-connectors.component.ts

8.5/10 — 0 blocking, 0 serious, 0 minor. Correctly reuses `CatalogCardComponent`'s
documented stretched-link contract (`catalog-card.component.ts:25-30`) for the
"Details = card activation" decision the executor's report calls out as a
deviation (#4) — this is not a deviation from the sibling, it is the sibling's
intended usage. `selectFeaturedConnectors`, `connectorPillStatus` are pure and
exported for reuse exactly as `batches.md:676` anticipates for Batch 15. The
"not-connected has no pill" call (`:106-107` reasoning) matches Batch 8's
`ProviderStatus` vocabulary rather than inventing a new one.

### category-bento.component.ts

8/10 — 0 blocking, 0 serious, 1 minor (no per-tile description, licensed by
plan). `groupConnectorsByCategory` and `connectorCategoryQueryParams` are
pure, exported, and match the C8/C9 contract (`?category=` through one named
constant). Columns via `@container ptah-mp-content` match the plan's 1/2/4
breakpoints at 480/800.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| No hard-coded hex colour (C8 quality requirement) | PASS | `grep '#[0-9a-fA-F]{3,6}'` over all 4 files: no matches |
| No `innerHTML`, spec-enforced | PASS | Every spec ends with a source-text assertion, e.g. `category-bento.component.spec.ts:228-234` |
| OnPush + signal `input()`/`output()`/`computed()`, no `inject()` | PASS | Confirmed by reading all 4 files; no `inject(` in any |
| Standalone components with explicit `imports` | PASS | All 4 components |
| Icons `aria-hidden`, every state has a text word (never colour alone) | PASS | `storefront-hero.component.ts:122-126,201-227`; `featured-connectors.component.ts` status/activity/error blocks |
| Theme tokens only, hero gradient literal per plan | PASS | `implementation-plan.md:452` matches `storefront-hero.component.ts:111`, `source-band.component.ts:26` |
| Hover lift `hover:-translate-y-px`, disabled under `motion-reduce` | PASS | `category-bento.component.ts:142`, `featured-connectors.component.ts:352` |
| `data-testid` naming: `<component>-<part>` | PASS | Consistent across all 4 files |
| Dynamic heading level shares content once (catalog-card / storefront-panel idiom) | FAIL | `source-band.component.ts:79-87`; `storefront-hero.component.ts:131-147,170-182` duplicate the full heading body per branch |
| No barrel/index.ts export for marketplace ui components (Batch 9 precedent) | PASS | `git status` shows no `index.ts`/`services.ts` change |
| Featured-rule and category-grouping helpers pure and exported for reuse (plan note for Batch 15) | PASS | `selectFeaturedConnectors`, `connectorPillStatus`, `groupConnectorsByCategory`, `connectorCategoryQueryParams` all exported, all pure |
| `[card-status]` slot renders only when there is something to show | PASS | `featured-connectors.component.ts:315-392` gated by `card.hasStatus` |
| Connector card is `CatalogCardComponent`, no separate `ConnectorCardComponent` (plan :447) | PASS | `featured-connectors.component.ts:299-458`; spec confirms no separate card is rendered |

## Maintenance debt

- Introduced: four new presentational components with pure, exported view
  helpers (`selectFeaturedConnectors`, `connectorPillStatus`,
  `groupConnectorsByCategory`, `connectorCategoryQueryParams`) that Batch
  13-16 can reuse without re-deriving the same logic; 68 new passing tests.
- Retired: nothing (net-new files, no code deleted in this batch, as
  expected — the old hub/surfaces are deleted in Batch 10/17/18, not here).
- Net: positive. The one debt item worth tracking is the heading-duplication
  pattern (Serious, above) — low current cost, but it sets a shape that would
  compound if the same duplication is copied into later batches instead of
  the `ngTemplateOutlet` idiom already established one library over.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the duplicated `@if`/`@else` heading markup in `source-band.component.ts`
  and `storefront-hero.component.ts` diverges from the DRYer `@switch` +
  `ngTemplateOutlet` idiom the batch's own cited pattern (`catalog-card.component.ts`)
  already uses for the same problem — real but non-blocking, since behaviour,
  a11y and test coverage are all correct.
- What a 10/10 version would do differently: factor the two duplicated heading
  pairs into a single shared body per component (the `ngTemplateOutlet`
  pattern), and extract the repeated hero-gradient utility string into one
  exported constant shared between `SourceBandComponent` and
  `StorefrontHeroComponent`.

## Round 1 fixes verified (team-leader)

- Serious (duplicated heading markup): fixed. `source-band.component.ts` renders
  its heading through `@switch (headingLevel())` + one `#headingContent` template;
  `storefront-hero.component.ts` does the same for the title (`#headingContent`,
  :133-149) and the "Your stack" side heading (`#stackHeadingContent`, :175-183).
- Minor (gradient duplication): fixed. `storefront-surface.styles.ts` exports
  `STOREFRONT_SURFACE_CLASS`, consumed by `source-band.component.ts:148` and
  `storefront-hero.component.ts:316`; the literal no longer appears elsewhere.
- `nx run-many -t lint,typecheck,test -p @ptah-extension/marketplace`: green,
  38 suites / 897 tests.
