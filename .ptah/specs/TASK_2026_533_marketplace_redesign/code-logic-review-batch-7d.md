# Code Logic Review — Batch 7d (`TASK_2026_533`)

Scope: `CatalogCardComponent`, `CatalogGridComponent`, `StorefrontPanelComponent` and their
specs, under
`D:\projects\ptah-extension\.claude-worktrees\agent-a8c302f40623c0284-9135923403a8\libs\frontend\ui\src\lib\native\catalog-card\`
(`catalog-card.component.ts` + `.spec.ts`, `catalog-grid.component.ts` + `.spec.ts`,
`storefront-panel.component.ts` + `.spec.ts`, `index.ts`), plus the barrel edit in
`libs\frontend\ui\src\lib\native\index.ts`. Reviewed against `batches.md` Batch 7d
(Tasks 7d.1, 7d.2), `implementation-plan.md` section 13 (C13, lines 534–617) and
`prototypes/variant-2-storefront.html:823-873`. No other batch consumes these components
yet (C13's six-view restyle lands in Batches 20–24), so this review is of the primitives
themselves, not of any integration.

Verification run in the worktree: `npx nx run-many -t lint,typecheck,test -p
@ptah-extension/ui` — lint and typecheck pass; 23 suites / 425 tests pass (the whole `ui`
project, `--testPathPattern` did not narrow it under this Nx/Jest config, so the run is a
superset including `dependency-boundaries.spec.ts`, which stays green with the new folder
in place). `grep -rniE "TODO|FIXME|placeholder|not implemented|stub"` over the batch
folder returns nothing.

## Summary

| Metric              | Value                     |
| ------------------- | ------------------------- |
| Overall score       | 8/10                      |
| Assessment          | APPROVED                  |
| Blocking issues     | 0                         |
| Serious issues      | 0                         |
| Moderate issues     | 2                         |
| Failure modes found | 2 (both moderate, latent) |

## Five logic questions

### 1. How does this fail silently?

- If a future consumer ever projects an interactive element (a link, a badge-as-button)
  into `[card-mark]` on an `interactive` card, its clicks would be silently swallowed by
  the stretched-activator overlay rather than reaching the projected element or producing
  any error — see Failure mode "Unshielded mark/badge regions" below. Nothing in the
  component enforces that `[card-mark]` content stays non-interactive; the guarantee is
  documentation-only (`catalog-card.component.ts:9-13`).
- Outside that latent case, no silent-failure path was found: `title` is `input.required`
  (throws loudly if omitted), `activated` only exists behind `interactive()` and only one
  DOM node emits it (`catalog-card.component.ts:184-193`, `:303-306`), and the meta/badge/
  description computed signals all resolve to an explicit `null`/empty state rather than a
  fabricated value when input is blank (`:277-295`).

### 2. What user action produces unexpected behaviour?

None found for the documented interaction contract. Clicking anywhere on an interactive
card's surface (mark, title text, badge, description, or empty article whitespace)
activates it via the stretched pseudo-element, which is the intended "stretched link"
behaviour; clicking a projected `[card-status]`, `[card-actions]` or `[card-expansion]`
control reaches that control only, confirmed both by static analysis of the stacking
order (`article` is `relative`; those three wrappers are `relative z-10`, i.e. painted
above the button's `after:absolute` pseudo, which has no explicit z-index and so paints at
the `z-index:auto` level) and by the passing test
`catalog-card.component.spec.ts:278-285` ("does not activate when a projected action is
clicked").

### 3. What input data produces a wrong answer?

- Nothing found that produces a _wrong_ answer; edge inputs (blank/whitespace-only
  `description`, `subtitle`, badge `label`; empty or all-blank `meta`; more than 3 `meta`
  items with blanks interspersed) all resolve to the documented "collapse rather than
  render blank" behaviour, and are pinned by tests (`catalog-card.component.spec.ts:170-
183`, `:210-218`, `:242-246`; `storefront-panel.component.spec.ts:88-100`).
- `meta` filters blanks before slicing to 3 (`catalog-card.component.ts:277-283`), so a
  5-item array with one blank correctly yields the first 3 _non-blank_ items, not the
  first 3 raw items with a blank counted — verified by
  `catalog-card.component.spec.ts:170-176`.

### 4. What happens when a dependency fails?

Not applicable at this layer: all three components are pure, injection-free,
presentational units with no RPC, store, or external service dependency (confirmed — no
`inject()` call in any of the three files). Failure-mode ownership for loading/error
states is explicitly deferred to consumers via the `[card-status]` slot, per the plan's
"Failure behaviour: unchanged per view" note (implementation-plan.md:610).

### 5. What is missing that the requirements never mentioned?

- Nothing in the plan requires `[card-mark]` to carry the same click-shielding `relative
z-10` treatment as the other three slots, but the plan's own description of the pattern
  ("Status, action and expansion slots sit above the stretched target" —
  `catalog-card.component.ts:26-27`) implicitly excludes the mark slot from that
  protection without saying why. This is worth the architect/team-leader confirming is
  intentional (mark is contractually always non-interactive artwork) rather than an
  oversight, since a later batch could otherwise "discover" the gap the hard way.
  See Failure mode below.

## Failure modes

### Unshielded mark/badge regions under the stretched activator

- Trigger: an `interactive` card where `[card-mark]` (or, in principle, the fixed badge
  markup) is given interactive content in a later batch.
- Symptom: clicks on that content do nothing and produce no console warning; the click is
  captured by the title button's `after:absolute after:inset-0` pseudo-element instead,
  because the mark wrapper (`catalog-card.component.ts:110`,
  `class="shrink-0 empty:hidden"`) and the badge (`:144-151`) are not `position: relative`
  with `z-10`, unlike `[card-status]` (`:164`), `[card-actions]` (`:168-173`) and
  `[card-expansion]` (`:175-180`), which are.
- Evidence: `catalog-card.component.ts:104` (`<article … class="… relative …">` — the
  pseudo's containing block), `:110` vs `:164/:168/:175` (three of four documented slots
  get `relative z-10`, the fourth does not), `:183-197` (`after:absolute after:inset-0`
  pseudo with no z-index utility, so it paints at the `z-index:auto` level — above
  non-positioned/inline content, below anything with an explicit positive z-index).
- Current handling: relies entirely on the documented contract that `[card-mark]` content
  (a `ptah-brand-mark` or `ptah-monogram-tile`, both `aria-hidden` per the C14 contract)
  and the fixed badge `<span>` are never interactive. Nothing in this component enforces
  or asserts that.
- Recommendation: either add `relative z-10` to the mark wrapper for consistency with the
  other three slots (cheap, removes the asymmetry, costs nothing since mark content is
  non-interactive anyway), or add a one-line spec assertion that pins the _intentional_
  asymmetry (e.g. "mark wrapper does not get z-10, because it must never contain
  interactive content") so a future change that adds z-10 elsewhere doesn't quietly leave
  this one out, or a future change to mark content doesn't quietly regress into the dead
  zone. Moderate: currently unreachable given today's only consumers of `[card-mark]`, but
  a real, silent, hard-to-diagnose click-loss trap if that changes.

### `@container` column rule has no execution proof, only source-text proof

- Trigger: any regression in the actual column counts, breakpoints, or in the interaction
  between Angular's `ViewEncapsulation.Emulated` attribute-scoping and the native
  `@container ptah-catalog` at-rule.
- Symptom: `catalog-grid.component.spec.ts` and `catalog-card.component.spec.ts`'s clamp
  test would still pass, because both read the component's own `.ts` source file with
  `readFileSync` and regex-match the CSS text (`catalog-grid.component.spec.ts:41-46`,
  `:68-91`, `:130-136`; `catalog-card.component.spec.ts:196-208`), not the DOM's computed
  style. A change that broke the rule's _effect_ while keeping matching-enough source text
  (or a change that reformatted the source enough to dodge the exact-spacing regex while
  the CSS still behaves correctly) would go undetected either way.
- Evidence: `catalog-grid.component.spec.ts:36-40` states the reason explicitly
  ("jest-preset-angular strips inline `styles` at compile time"); the same disclosure
  appears at `catalog-card.component.spec.ts:195-196`.
- Current handling: the executor disclosed the limitation in comments rather than hiding
  it, and the column/breakpoint values themselves are correct against the C13 spec (< 480
  → 1, 480–799 → 2, 800–1199 → 3, ≥1200 → 4; matches implementation-plan.md:554-555) as far
  as source text goes.
- Recommendation (for Batch 24/25, per the plan's own B10 capture step at
  implementation-plan.md:614): a real browser check must confirm (a) the grid actually
  lays out 1/2/3/4 columns at the four bands, not just that the source text says so; (b)
  the card's compact density (`catalog-card.component.ts:230-240`) actually activates in
  sync with the grid's own 1-column state, since they are two separate `@container`
  declarations in two separate component style blocks that must agree by convention, not
  by any shared constant; (c) Angular's per-component attribute-scoping does not
  interfere with container-name resolution across the host/child boundary (grid `:host`
  establishes the container; the card's rule lives in a different component's scoped
  stylesheet one DOM level down) — this is expected to work architecturally but is
  unverified by any test in this batch. Not a defect in this batch: it is exactly the gap
  the plan already assigns downstream, and this review's job is to confirm that gap is
  real and specific rather than assume the disclosed jsdom limitation is harmless.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

1. (Moderate) `[card-mark]` wrapper lacks the `relative z-10` shielding given to the other
   three slots — `catalog-card.component.ts:110` vs `:164/:168-173/:175-180`. See failure
   mode above.
2. (Moderate) `@container` column-count and clamp rules are verified only by
   source-text regex against the authored `.ts` file, not by rendered/computed behaviour —
   `catalog-grid.component.spec.ts:41-91`, `:130-136`; `catalog-card.component.spec.ts:194-
208`. See failure mode above; not this batch's defect, but the specific claim the task
   asked to verify, so recorded precisely for Batch 24/25 to act on.
3. (Minor) The badge `<span>` (`catalog-card.component.ts:144-151`) is likewise outside
   the `z-10` shield, same reasoning as finding 1 but lower severity since a badge is
   fixed, non-slotted markup the component itself controls (no consumer can make it
   interactive without changing this file).

## Data flow

1. Consumer sets `title`/`description`/`meta`/`badge`/`headingLevel`/`interactive` inputs
   on `ptah-catalog-card` and projects content into `[card-mark]`/`[card-status]`/
   `[card-actions]`/`[card-expansion]` — OK, all via `input()`/`ng-content`, no coercion
   surprises.
2. `metaText`, `visibleDescription`, `visibleBadge`, `badgeClass` computed signals derive
   render-ready values, trimming and filtering blanks — OK, verified by tests for every
   blank/edge case listed above.
3. Template renders the heading at the configured level, always with a stable `titleId`
   from a module-scope counter — OK, uniqueness verified across two live instances
   (`catalog-card.component.spec.ts:110-118`).
4. When `interactive()`, the title renders as a `<button>` with an `after:absolute
after:inset-0` pseudo-element scoped to the `relative` `<article>` — OK for activation;
   gap noted above for the one unshielded slot.
5. User click/keyboard-Enter/Space on the activator button fires the native `click` event,
   Angular's `(click)="activate()"` calls `activated.emit()` only when `interactive()` is
   true — OK, double-checked defensively inside `activate()` itself
   (`catalog-card.component.ts:303-306`), not just by the template's `@if`.
6. `CatalogGridComponent` establishes the named container on its host and renders
   `role="list"`; consumers are responsible for `role="listitem"` on every direct child —
   OK per contract, verified with real DOM assertions
   (`catalog-grid.component.spec.ts:95-127`), not source text, for the role/child-count
   behaviour (only the CSS breakpoint values themselves are source-text-verified, see
   above).
7. `StorefrontPanelComponent` mirrors the card's heading/id/slot pattern for a
   single-panel form/gate treatment — OK, same verification depth as the card for
   everything except the (shared) container CSS.

## Requirements fulfilment

| Requirement                                                                                      | Status   | Gap                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `title` required, `description`/`meta`/`badge`/`headingLevel`/`interactive` inputs               | COMPLETE | none                                                                                                                                                                                                                                                    |
| `activated` only when `interactive`, via stretched `<button>`, no nested interactive element     | COMPLETE | none; pinned by a dedicated "never nests" test (`:302-315`)                                                                                                                                                                                             |
| Slots `[card-mark]`/`[card-status]`/`[card-actions]`/`[card-expansion]`, `empty:hidden` collapse | COMPLETE | mark slot's click-shielding asymmetry (moderate, see above)                                                                                                                                                                                             |
| `meta` ≤3 non-blank, joined with `·`                                                             | COMPLETE | none                                                                                                                                                                                                                                                    |
| Badge text always present, never colour-only                                                     | COMPLETE | none                                                                                                                                                                                                                                                    |
| `headingLevel: 2\|3\|4`, default 3                                                               | COMPLETE | none                                                                                                                                                                                                                                                    |
| No `BRAND_MARKS`/brand inputs on the card                                                        | COMPLETE | none                                                                                                                                                                                                                                                    |
| `CatalogGridComponent` container + 1/2/3/4 column rule, `role="list"`/`role="listitem"`          | PARTIAL  | column-count/breakpoints proven only by source text, not real layout                                                                                                                                                                                    |
| Card compact density keyed off the same `ptah-catalog` container                                 | PARTIAL  | same gap as above                                                                                                                                                                                                                                       |
| `StorefrontPanelComponent` title/subtitle/headingLevel, `[panel-mark]`/body/`[panel-footer]`     | COMPLETE | none                                                                                                                                                                                                                                                    |
| Reduced-motion: hover lift disabled                                                              | COMPLETE | class-presence verified (`:128-134`); real `prefers-reduced-motion` media evaluation is out of jsdom's reach, same caveat class as the container-query gap, but lower risk since it is a standard, unmodified Tailwind variant, not hand-authored logic |
| No `innerHTML`, no stubs/TODOs                                                                   | COMPLETE | none                                                                                                                                                                                                                                                    |

Implicit requirements not addressed: none beyond the mark/badge z-index asymmetry noted
above.

## Edge cases

| Case                                                     | Handled | How                                                                                                                | Concern                                                                                            |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Click on projected action button (interactive card)      | YES     | Handler bound directly on the activator button, not on `article`; action buttons are siblings, not descendants     | none — real DOM test passes                                                                        |
| Click on the mark region (interactive card)              | YES*    | Falls through to the stretched activator (mark has no z-10)                                                        | *Correct today only because mark content is always non-interactive by contract, not by enforcement |
| Many card instances on one page                          | YES     | Module-scope counter guarantees unique `titleId`/`descriptionId`                                                   | none — verified with two live instances                                                            |
| Blank/whitespace-only description, subtitle, badge label | YES     | Trimmed, collapses to `null`/no element                                                                            | none                                                                                               |
| >3 meta items, some blank                                | YES     | Filter-then-slice, first 3 non-blank                                                                               | none                                                                                               |
| Non-interactive card clicked                             | YES     | No button rendered, no click handler exists                                                                        | none                                                                                               |
| Grid at 480/800/1200px                                   | UNKNOWN | Source-text regex only                                                                                             | No jsdom proof; needs a real-browser check (Batch 24/25)                                           |
| `prefers-reduced-motion: reduce`                         | YES     | Standard Tailwind `motion-reduce:` variant classes present                                                         | Not independently exercised under jsdom, low risk (unmodified Tailwind mechanism)                  |
| XSS via title/description/meta/badge text                | YES     | Angular text interpolation, no `[innerHTML]`; runtime test injects `<img onerror>` and confirms it renders as text | none                                                                                               |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the `@container` column/breakpoint behaviour and the card/grid compact-density
  sync are unverified in any real rendering environment — the plan already assigns that
  verification to Batch 24/25 (B10 captures at 720/1100/1750), and this review confirms
  that assignment is load-bearing, not optional, because today's tests cannot catch a
  regression there.
- What a robust implementation would add: (1) `relative z-10` on the `[card-mark]`
  wrapper for consistency with the other three slots, or an explicit test/comment pinning
  the asymmetry as intentional; (2) a real-browser (not jsdom) smoke check — even a single
  Playwright/visual-reviewer pass at the four breakpoints — wired into this task's own
  verification chain rather than deferred silently three batches downstream with no
  tracking artifact beyond a batches.md line; (3) a shared constant (or a single source of
  truth) for the `480px` boundary that both `CatalogCardComponent`'s compact-density rule
  and `CatalogGridComponent`'s 1-column rule currently duplicate as separate literals in
  separate files, so the two can never drift independently.
