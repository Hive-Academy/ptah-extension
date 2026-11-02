# Batch 9: bundled Codex rate card

## Summary

The seven static Codex fallback model IDs now price exact-rate turns with no
runtime catalog hydration. A dated, provenance-carrying OpenAI API rate card
(`utils/codex-rate-card.ts`) is bundled into the shared base pricing layer
(`DEFAULT_MODEL_PRICING`), so the batch-3 price contract
(`findExactModelPricing` / `calculateExactMessageCost`) resolves each ID
directly. The four token classes stay disjoint: uncached input, cached input
(read), 30-minute cache write, output. Write tokens bill at the write price
and never also at the input price. An ID absent from the card stays
unavailable — never a rate borrowed from a similar name, a `-codex` variant
or a date snapshot. ChatGPT-plan sessions label the same published-rate value
`covered-by-subscription` (an estimate, not a charge), per the batch 4/5
semantics. The $0 registry placeholders still never seed, so no bare slug is
ever pinned to zero.

## Design choice

One lookup path, no second one. The card is a `Record<string, ModelPricing>`
spread into `DEFAULT_MODEL_PRICING` (`pricing.utils.ts:125-128`). That is the
layer the exact-rate price contract already reads, and the layer
`resetPricingMapForTesting` restores, so every spec's `resetPricingMap()`
`beforeEach` starts from a map that contains the card. Runtime catalog
hydration still overrides a card entry, exactly as it overrides every other
bundled entry. No public-index export was added; the card's only dependency is
the type-only `ModelPricing` import (`codex-rate-card.ts:39`), so there is no
runtime import cycle with `pricing.utils.ts`.

Provenance uses the batch-3 `ModelPricing` catalog fields the strict
calculator already copies into `PriceProvenance` (`pricing.utils.ts:529-534`):
`catalogSource` (the model page URL), `catalogVersion`
(`retrieved 2026-11-02`) and `effectiveDate` only where OpenAI states one —
`gpt-5.6-sol` carries `promotional through 2026-11-21`. The six other entries
emit a null effective date in provenance, per the batch-3 D6 rule.

Card entries set no `maxTokens`: context windows stay catalog-only, and live
per-provider discovery keeps its precedence.

## Files changed

- `libs/shared/src/lib/utils/codex-rate-card.ts` (new, `:1-119`): one entry
  per fallback ID with the model page URL, the retrieval date, the four
  class rates, and derivation comments for the two 1.25x-rule write prices.
- `libs/shared/src/lib/utils/pricing.utils.ts`: import the card (`:21`);
  rewrite the subscription-absence paragraph of the `DEFAULT_MODEL_PRICING`
  doc comment to explain the card and keep the no-seeding rationale
  (`:66-74`); spread the card into the bundled base layer (`:125-128`).
- `libs/shared/src/lib/utils/pricing.utils.spec.ts`: new
  `bundled Codex API rate card` describe (`:781-947`); the discovered-window
  fixture test moved from `gpt-5.6-sol` to `gpt-6.2-sol` because the card now
  prices the old fixture ID (`:1000-1011`).
- `libs/shared/src/lib/providers/provider-registry.spec.ts`: the
  subscription-seed regression now asserts seeding writes nothing (before/
  after map equality) and that anything published under a Codex slug is a
  positive exact rate with no registry `maxTokens` — not the $0 placeholder
  (`:398-422`).
- `libs/shared/src/lib/providers/entries/codex-provider-entry.spec.ts`: the
  same invariant for the seven IDs (`:91-109`); header pin 5 names the card
  (`:9-11`).
- `libs/shared/src/lib/providers/entries/codex-provider-entry.ts`:
  comment-only pointer from the static list to the card (`:31-35`).
- This report.

## Specs added

`pricing.utils.spec.ts`, describe `bundled Codex API rate card`:

- One numeric case per model, `it.each` over the seven-row table
  (`:785-829`): 1M tokens per class must total the sum of the four published
  rates, so a wrong class rate misses by its full value; a write-only
  1M-token turn must cost exactly the published cache-write price, never the
  input price, and a `cacheWrite !== input` guard pins that the check cannot
  pass against the wrong class rate.
- Subscription parity (`:831-853`): the same tokens give the same value with
  `costBasis: 'covered-by-subscription'` under plan billing and `'estimated'`
  under API-key billing.
- Provenance (`:855-864`): every entry's `catalogSource` is its model page
  URL and `catalogVersion` is the retrieval date.
- Null effective dates (`:866-881`): the six non-promotional entries emit
  `effectiveDate: null` in provenance.
- Promotional flag (`:883-892`): `gpt-5.6-sol` emits
  `effectiveDate: 'promotional through 2026-11-21'`.
- Unavailable IDs (`:894-913`): `gpt-7-nova` (synthetic), `gpt-6.2-sol`
  (plausible live model outside the card) and `gpt-5.4` (a live slug outside
  the dated fallback) resolve to null and to
  `{ totalCost: null, costBasis: 'unknown', pricingCoverage: 'none' }`.
- No borrowing (`:915-936`): the `-codex` variants, historical `gpt-5.3-codex`
  (published base rates but no exact write price) and the `-20261101` date
  snapshot all stay unavailable on the strict path.
- No context windows (`:938-946`): card entries carry no `maxTokens` and
  `getModelContextWindow` returns 0 for all seven IDs.

Existing Claude pricing specs are untouched and still hold: the exact-rate
fixtures, the `DEFAULT_MODEL_PRICING['local']` use and the
no-anthropic-provider anti-regression pass because card entries use
`provider: 'openai'` and add no Claude keys.

## Evidence

- Ptah AST parse is clean (0 error nodes) for the new card and all five
  edited TypeScript files.
- The six files contain no CR characters and no UTF-8 BOM (Grep
  verification; git commands were prohibited).
- The replacement fixture `gpt-6.2-sol` was checked against the lenient
  partial matcher (`lookupPricingEntry`, `pricing.utils.ts:343-391`): no
  bundled or card key is a prefix of it with a date-snapshot remainder, so
  `findModelPricing('gpt-6.2-sol')` stays null on a fresh module.
- No test, typecheck, lint, build, Nx, npm or prettier command was run, as
  instructed. Jest, tsc and Prettier behavior awaits coordinator and CI
  verification.

## Open questions and risks

- The card pins the 30-minute ("published") cache-write price per the task
  instruction. OpenAI also publishes higher 12-hour write rates for some of
  these models, but the pinned App Server protocol does not report which
  retention a write used, so the card cannot split them today.
- The lenient `findModelPricing` still resolves a date-snapshot id such as
  `gpt-5.6-sol-20261101` to the card entry (the pre-existing snapshot
  policy); the strict path the native wiring uses refuses it. Noted, not
  changed.
- The `gpt-5.6-sol` rates are promotional through 2026-11-21: recheck the
  model page after that date before trusting the entry.
- The card is a dated snapshot, not a live feed: refresh it when the cited
  pages change.
- Long-context multipliers and non-Standard service tiers (Flex/Batch, Fast,
  Ultrafast) are out of scope: native Codex turns are Standard short-context.
- The `gpt-5.6-terra` and `gpt-5.6-luna` write prices are derived from the
  published 1.25x cache-write rule, not a printed write cell (their model
  pages print none); the derivation is recorded as comments on the entries.
- GitHub Copilot also lists some of these slugs as statics; it is
  subscription-covered too, so nothing it seeds changes the card. The card
  publishing OpenAI's published rates under those slugs matches the existing
  "costed from the same published rates" design.

## Coordinator verification commands (do not run in this lane)

Run from the workspace root, one heavy command at a time. All changes are in
`@ptah-extension/shared`; each host that depends on it stays covered by the
typecheck/lint line below.

```powershell
npm run verify -- -t test -p @ptah-extension/shared -- "--testPathPatterns=pricing.utils|codex-provider-entry|provider-registry" --coverage=false --maxWorkers=2
npm run verify -- -t lint,typecheck -p @ptah-extension/shared,@ptah-extension/agent-sdk,@ptah-extension/rpc-handlers,ptah-electron,ptah-extension-vscode,ptah-cli,ptah-tui --parallel=1
```