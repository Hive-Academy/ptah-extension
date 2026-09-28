# Code Logic Review — `TASK_2026_533` Batch 7c

## Summary

| Metric              | Value       |
| -------------------- | ----------- |
| Overall score        | 9/10        |
| Assessment            | APPROVED    |
| Blocking issues       | 0           |
| Serious issues        | 0           |
| Moderate issues       | 1           |
| Failure modes found   | 0           |

## Scope examined

Full uncommitted diff (`git -C <worktree> diff 9efeb5bea`, 614 lines) across the four
batch files: `provider-mark.component.ts`, `provider-mark.component.spec.ts`,
`provider-marks.data.ts`, `provider-marks.data.spec.ts`. Read in full, not only the
diff hunks. Cross-checked against `../brand-mark/mark-svg.component.ts`,
`../brand-mark/mark-artwork.ts`, `../brand-mark/brand-slugs.ts`,
`../brand-mark/brand-marks.generated.ts` (1221 lines, including the
`PROVIDER_BRAND_ART`/`BRAND_MARKS` split at :1218 and :151), `../brand-mark/index.ts`
(confirms `PROVIDER_BRAND_ART`/`BRAND_MARKS` are not re-exported), both consumers
(`provider-setup-wizard.component.ts:309,469`, `provider-connection-card.component.ts:103`),
`provider-setup-wizard.component.spec.ts:1022-1027`, and
`brand-slugs.spec.ts:9,364-370` (out-of-batch file that imports `PROVIDER_MARKS` — checked
it only asserts presence via `Object.hasOwn`, so the retyping does not break it).
Plan text read: `implementation-plan.md:612-627` (C14), `:768` (R1), `:771-777` (R7);
`batches.md` Batch 7c section (:448-478) and the binding notes at :40-44, :66, :103.
Executor's `batch-7c-report.md` read in full, including its own R7 arithmetic and proof
script output.

## Five logic questions

### 1. How does this fail silently?

Nothing found. `vendoredArt` (`provider-mark.component.ts:106-112`) and the `art`
computed (`:95-102`) are total: every branch returns a defined `MarkArtwork`, and an
unresolvable id/slug degrades to the `fallback` glyph rather than throwing or rendering
nothing — matches the plan's stated failure behaviour ("an unknown slug or provider
falls back... and never throws", `implementation-plan.md:626`).

### 2. What user action produces unexpected behaviour?

None found for this batch's surface. Selector and inputs (`providerId`, `fallback`) are
byte-identical to before; both consumers pass them positionally the same way pre- and
post-diff, and neither consumer inspects the internal DOM of `ptah-provider-mark`
(`provider-connection-card.component.ts:103-106` treats it as an opaque element).

### 3. What input data produces a wrong answer?

Checked prototype-pollution-style ids (`constructor`, `toString`, etc.): both lookups
(`PROVIDER_BRAND_SLUGS[providerId]` at `:107` and `PROVIDER_MARKS[id]` at `:99`) are
guarded with `Object.hasOwn` before indexing, so an id equal to an inherited
`Object.prototype` key cannot resolve to unrelated data — pinned by the new spec
`'never resolves inherited object keys as provider ids'`
(`provider-mark.component.spec.ts:144-148`).

### 4. What happens when a dependency fails?

If `brand-marks.generated.ts`'s vendoring run ever drops a slug from
`PROVIDER_BRAND_ART` while `PROVIDER_BRAND_SLUGS` still names it, `vendoredArt` falls
through to `null` via its own `Object.hasOwn(PROVIDER_BRAND_ART, slug)` guard
(`:109-111`), and resolution continues to the `PROVIDER_MARKS`/lucide tiers. No throw,
no blank render.

### 5. What is missing that the requirements never mentioned?

None found that affects this batch's contract. See Moderate/minor note below on the
stale `brand-slugs.ts:71` present-tense comment — cosmetic, already flagged by the
executor's own report, not a behavioural gap.

## Failure modes

None found with supporting evidence. The resolution chain, the R7 tree-shaking split,
and the consumer contract were all traced end to end without finding an unhandled
branch, a swallowed error, or a stale read. Residual uncertainty: the review trusts the
executor-reported Jest run (`ui: 546/546`, `chat: 1498/1500 + 2 skipped`) rather than
re-executing it; the reported command (`nx run-many -t lint,typecheck,test -p ui chat`)
is scoped correctly to the changed projects.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

1. **Moderate — `strokeMark` exported from a data file for a component-local concern.**
   `provider-marks.data.ts:527` exports `strokeMark` so
   `provider-mark.component.ts:29-43` can build the three lucide fallback glyphs with it.
   This is a logic non-issue (both call sites agree on the `MarkArtwork` shape and the
   helper is pure/total), but it makes `provider-marks.data.ts` reachable for a reason
   unrelated to "the vendor-mark table," which is exactly the kind of implicit coupling
   this repo's "the table is the allowlist" convention warns about elsewhere in the same
   file's header comment. Not blocking: the barrel (`provider-mark/index.ts`) does not
   re-export `strokeMark`, so the coupling is contained to the two files that already
   know about each other. Route any naming/placement objection to the style review.
2. **Minor — stale present-tense-vs-past-tense comments**, already self-identified in
   `batch-7c-report.md`'s "Out-of-scope observations": `brand-slugs.ts:71` and
   `brand-slugs.spec.ts:368`. No behavioural effect; the assertions they annotate still
   pass under the new shape.

## Data flow

1. `providerId` input set by a consumer (`provider-setup-wizard.component.ts:309,469`,
   `provider-connection-card.component.ts:103`) — OK, unchanged contract.
2. `art` computed (`provider-mark.component.ts:95-102`) reads `providerId()` and tries,
   in order: `vendoredArt` (`PROVIDER_BRAND_SLUGS` → `PROVIDER_BRAND_ART`, both
   `Object.hasOwn`-guarded) — OK; then `PROVIDER_MARKS[id]` when `kind === 'stroke'` —
   OK; then `LUCIDE_MARKS[pinned lucide icon or fallback input]` — OK, total.
3. `<ptah-mark-svg [art]="art()" paint="mono">` (`:77-82`) — the resolved `MarkArtwork`
   crosses the component boundary as a plain object; `MarkSvgComponent` (`../brand-mark/mark-svg.component.ts:83-94`)
   recomputes `isStroke()` from `art().kind` and forces every path's `fill` to
   `'currentColor'` under `mono` regardless of the artwork's own `fill`/`fillRule` — OK,
   matches the "mono paints in currentColor" contract and is pinned by both the
   `provider-mark` and `mark-svg` spec suites.
4. Renderer template builds `<svg><path [attr.d] [attr.fill] ...>` from bindings only —
   OK, no `innerHTML`, confirmed by the source-pin test
   (`provider-mark.component.spec.ts:156-172`) that also asserts `PROVIDER_BRAND_ART` is
   imported and `BRAND_MARKS` is not, directly in the component's import block.
5. Bundler (esbuild, `ui` package `sideEffects:false`) tree-shakes the unreferenced
   `BRAND_MARKS` export out of the eager chunk — OK per the executor's before/after
   build comparison (see R7 evidence assessment below); not independently re-run by this
   review.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Selector/inputs (`providerId`, `fallback`) unchanged | COMPLETE | none |
| Resolution order `PROVIDER_BRAND_SLUGS` → `PROVIDER_BRAND_ART` (direct import, never `BRAND_MARKS`) → `PROVIDER_MARKS` stroke → lucide fallback | COMPLETE | none — verified in source and by the source-pin spec |
| Lucide pins for `anthropic`/`claude-cli` removed from `provider-marks.data.ts` | COMPLETE | none |
| `PROVIDER_MARKS` records re-typed to `MarkArtwork` (`kind:'stroke'`) | COMPLETE | none |
| Licensing doc comment cites R1 | COMPLETE | `provider-marks.data.ts:1-31` rewritten accordingly |
| Consumers (`provider-setup-wizard`, `provider-connection-card`) keep behaviour | COMPLETE | neither consumer touched; both treat the component opaquely |
| R7 initial-chunk evidence (`BRAND_MARKS` absent, only allowed pieces add bytes) | COMPLETE | see assessment below |

Implicit requirements not addressed: none found.

## R1/R7 evidence assessment

- **Resolution order**: matches `implementation-plan.md:615-618` exactly (slug table →
  `PROVIDER_BRAND_ART` → tabled stroke → lucide), confirmed by direct source read, not
  only by the executor's own description.
- **"Never `BRAND_MARKS`" claim**: independently verified — `provider-mark.component.ts`
  contains zero references to the `BRAND_MARKS` identifier, and `PROVIDER_BRAND_ART` is
  imported from `../brand-mark/brand-marks.generated` directly, matching the binding
  note at `batches.md:66` that the barrel does not re-export it.
- **BRAND_MARKS-absence proof (report §"Proof that BRAND_MARKS is not in the initial
  bundle")**: the method (partition every `d:` path string into "BRAND_MARKS-only" vs
  "PROVIDER_BRAND_ART" sets, grep all 19 emitted chunk files for each) is sound as an
  absence proof for path-level content, and the `PROVIDER_ART_ANTHROPIC`/
  `PROVIDER_ART_CLAUDE` constants are declared as independent top-level `const`s
  (`brand-marks.generated.ts:128,139`) referenced by both `BRAND_MARKS` (:190,:284) and
  `PROVIDER_BRAND_ART` (:1219-1220) — the shape a bundler needs to tree-shake the large
  object literal while keeping the two shared consts, which is consistent with the
  reported 0-hit result for the 109 BRAND_MARKS-only strings.
- **Chunk-byte comparison**: the three-column methodology (origin/main baseline,
  branch-HEAD-without-7c, after-7c) isolates 7c's own delta from the rest of the
  in-flight branch, which is the correct comparison for attributing the +1,167 byte
  change to this batch specifically rather than to the branch as a whole. This review
  did not re-run the build to re-verify the exact byte counts; the method is credible
  and the reported delta (two short path strings, ~1.3 kB of raw source before
  minification) is the right order of magnkeitude for adding two brand paths.
- **Mono paint correctness**: `PROVIDER_ART_ANTHROPIC`/`PROVIDER_ART_CLAUDE` are `kind:
  'fill'` artwork with `fill: null` per path and no `fillRule` (single non-self-
  intersecting path per mark, unlike the multi-path `evenodd` `art` variant at
  `brand-marks.generated.ts:178-189`), so `MarkSvgComponent`'s mono override to
  `currentColor` produces a correct monochrome glyph with no missed holes.

## Deviations judged

| Deviation | Verdict | Reason |
| --- | --- | --- |
| Kept 32px `provider-mark-box` wrapper | Acceptable | Plan's own C14 prose describes "a 32 px box... holding a 24 px mark"; nothing in the plan asked for its removal. |
| `data-testid="provider-mark-svg"` moved to the `ptah-mark-svg` host (no longer the raw `<svg>`) | Acceptable | No production or e2e code selects this testid (repo-wide grep found only the spec and component files); the inner `<svg>` still exposes the renderer's own `data-testid="mark-svg"`. Spec updated consistently. |
| Lucide glyphs (`LUCIDE_MARKS`) kept in the component file rather than moved to the data file | Acceptable | Plan does not require the move; keeps the diff inside the one file the plan names for lucide fallback ownership. |
| `strokeMark` exported from `provider-marks.data.ts` | Acceptable, flagged (see Moderate #1) | Functionally correct and total; the only objection is placement/coupling, which is a style concern, not a logic one. |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty `providerId` (`''`, the input default) | YES | Fails both `Object.hasOwn` guards, falls to `LUCIDE_MARKS[fallback()]` | none |
| Prototype-polluting id (`constructor`, etc.) | YES | `Object.hasOwn` on both `PROVIDER_BRAND_SLUGS` and `PROVIDER_MARKS` before indexing | none |
| Slug present in `PROVIDER_BRAND_SLUGS` but missing from `PROVIDER_BRAND_ART` | YES | `vendoredArt` returns `null`, falls through to stroke/lucide tiers | none |
| `PROVIDER_MARKS` lucide pin (`lm-studio`) vs. fallback input collision | YES | Pin wins; spec `'lets a lucide record in the table win over the fallback input'` (`provider-mark.component.spec.ts:132-142`) | none |
| Shared Ollama artwork object identity | YES | `ollama`/`ollama-cloud` both reference the same `OLLAMA_MARK` const; spec asserts `toBe` (identity, not just equality) | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only carried risk is the `strokeMark` cross-file export
  (Moderate #1), which is a maintainability/placement question, not a correctness one.
- What a robust implementation would add: nothing required by this batch's contract;
  optionally, a bundle-size regression assertion (rather than a manually-run report) if
  R7 is expected to be re-checked automatically in CI on later batches that touch the
  same files.
