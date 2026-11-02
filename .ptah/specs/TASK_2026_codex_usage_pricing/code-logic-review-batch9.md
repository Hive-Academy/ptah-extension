# Code Logic Review - Batch 9 (bundled Codex rate card)

Score: 8/10. Verdict: APPROVE (0 blocking, 0 serious, 3 moderate). Static read only; no tests, tsc or lint run.

## 1. Numbers vs research table
All 28 values in `libs/shared/src/lib/utils/codex-rate-card.ts` match `research-codex-rate-card.md` exactly, and the unit conversion is correct ($/1M x 1e-6, same as the existing DEFAULT_MODEL_PRICING entries):

| Model | Input | Cached read | Cache write | Output |
| --- | --- | --- | --- | --- |
| gpt-6.1-sol | 2e-6 | 0.1e-6 | 2.5e-6 | 10e-6 |
| gpt-6-astra | 10e-6 | 1e-6 | 12.5e-6 | 50e-6 |
| gpt-6-sol | 2e-6 | 0.2e-6 | 2.5e-6 | 10e-6 |
| gpt-6-luna | 0.1e-6 | 0.01e-6 | 0.125e-6 | 0.5e-6 |
| gpt-5.6-sol | 4e-6 | 0.4e-6 | 5e-6 | 20e-6 |
| gpt-5.6-terra | 2e-6 | 0.2e-6 | 2.5e-6 | 12e-6 |
| gpt-5.6-luna | 0.2e-6 | 0.02e-6 | 0.25e-6 | 1.2e-6 |

Cache write is the 30m price (or the published single price for gpt-6-sol and the 1.25x rule for terra and luna). No mismatches. The spec table (`pricing.utils.spec.ts` CARD) is in per-million units and matches the research table too.

## 2. Spread into DEFAULT_MODEL_PRICING
- Exact path (`findExactModelPricing`): key lookup only, plus the claude `[1m]` rule. `-codex`, date-snapshot and unknown IDs (gpt-6.2-sol, gpt-5.4) stay null. The new specs pin this. Preserved.
- Subscription labelling is unchanged. `calculateExactMessageCost` takes `billingMode`, so ChatGPT-plan sessions get `covered-by-subscription`, and the spec checks that the value is identical to api-key. OK.
- Lenient path (`lookupPricingEntry`, pricing.utils.ts ~346-400): this does change behaviour. `findModelPricing` and `calculateMessageCost` are used by session-replay, stream-transformer, usage-pricing, model-resolver, agent-monitor and others. The seven bare keys now resolve for:
  - the bare id on any provider, including Copilot, OpenRouter and OpenAI-compatible providers (previously null until catalog hydration);
  - `provider/<id>`, through the prefix strip;
  - `<id>-YYYY-MM-DD` and `<id>-YYYYMMDD` snapshots, through the date-snapshot rule (the forward match stays strict and does not hit `-codex` or other suffixes).
  This is the designed base-layer behaviour. A hydrated catalog entry for the same key overrides the card, and the existing test "unpriced discovered gpt-5.6-sol" had to be moved to gpt-6.2-sol because of it. Not blocking, but see M1.

## 3. Cache write as its own class
Confirmed. `calculateExactMessageCost` sums input, output, cacheHit x read and cacheCreation x write as four disjoint classes (pricing.utils.ts ~592). The card has a distinct write rate on every entry, and the spec's write-only test cannot pass against the input rate. OK.

## 4. Provenance
`catalogSource` (model page URL), `catalogVersion` ('retrieved 2026-11-02') and `effectiveDate` (only gpt-5.6-sol: 'promotional through 2026-11-21') map to the `ModelPricing` fields and to the `PriceProvenance` emitted at pricing.utils.ts ~529. All other entries emit `effectiveDate: null`, which the spec asserts. The research doc says "at least through 2026-11-21", so the card's "through" wording is a slight tightening; it is acceptable. The research note says the pricing page was cited for some entries, but `catalogSource` carries only the model page; that is fine.

## 5. Spec changes
- `provider-registry.spec` and `codex-provider-entry.spec` still assert `before == after` after seeding (the seeding write is still proven to be a no-op) and keep the maxTokens-undefined guard. They add a positive-rate check. The relaxed `if (!entry) continue` is a slight weakening: the card now guarantees presence, so it could assert it. Minor.
- The moved fixture (gpt-5.6-sol to gpt-6.2-sol) preserves the intent: an unpriced discovered model keeps its context window.
- Existing specs elsewhere that name these IDs mock their own pricing (model-resolver.spec:40), so nothing is expected to break. I did not exhaustively check every spec in the list.

## 6. TypeScript
No likely compile errors. The import is type-only (no runtime cycle), `Record<string, ModelPricing>` spreads cleanly, and the `as const` tuple works with `it.each`. A prettier formatting nit is possible in the spec (the two-argument `calculateExactMessageCost(\n 'gpt-6.1-sol', tokens, ...)` calls), which lint-staged will catch.

## Moderate findings
- M1: `libs/shared/src/lib/utils/pricing.utils.ts` (lenient `lookupPricingEntry`). Legacy lenient cost displays now show a dollar figure for these slugs on non-Codex providers that may bill differently (for example `openai/gpt-5.6-sol` via OpenRouter before hydration, or Copilot premium-request billing). The exact-rate path is protected; the legacy path is not. Mitigation: hydration overrides; keep the callers that matter on the exact path.
- M2: `gpt-5.6-sol` is promotional through 2026-11-21 (19 days from retrieval) and nothing in code expires or flags it. After that date the figure is still labelled as an estimate with a stale `effectiveDate` string. Add a follow-up recheck or an expiry guard.
- M3: The 12h cache-write price is ignored by design (documented). A 12h write is undercounted by half. This is disclosed in the card header but not in the UI. Accept.

## Verdict
APPROVE. No blocking issues.
