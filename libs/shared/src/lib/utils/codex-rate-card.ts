/**
 * Bundled OpenAI Codex API rate card
 *
 * Exact, dated published rates for the seven static Codex fallback model IDs
 * (see `../providers/entries/codex-provider-entry.ts`), retrieved 2026-11-02
 * from each model's OpenAI API model page (per entry in `catalogSource`) and
 * the shared API pricing page (https://platform.openai.com/docs/pricing).
 * USD per 1 million text tokens, Standard short-context prices only:
 * long-context multipliers and non-Standard service tiers (Flex/Batch, Fast,
 * Ultrafast) are out of scope for this card.
 *
 * The card merges into the bundled base layer of the shared pricing map
 * (`DEFAULT_MODEL_PRICING` in `pricing.utils.ts`), so the exact-rate price
 * contract (`findExactModelPricing` / `calculateExactMessageCost`) resolves
 * these IDs with no runtime catalog hydration, and a hydrated catalog entry
 * for the same slug overrides it, like every bundled entry.
 *
 * The four token classes are disjoint: uncached input, cached input (read),
 * cache creation (write) and output. `cacheCreationCostPerToken` records the
 * published 30-minute cache-write price — write tokens bill there and never
 * also at the input rate. OpenAI also publishes higher 12-hour write rates
 * for some of these models, but the pinned App Server protocol does not
 * report which retention a write used.
 *
 * Provenance uses the catalog fields of `ModelPricing`: `catalogSource` is
 * the model page URL, `catalogVersion` is this card's retrieval date, and
 * `effectiveDate` carries a validity statement only where OpenAI states
 * one — `gpt-5.6-sol` is explicitly promotional. A null effective date in
 * the emitted provenance means OpenAI publishes no start date for the rate.
 *
 * A model ID absent from this card stays unavailable (null cost). Rates are
 * never borrowed from a similarly named model, a `-codex` variant or a date
 * snapshot; the historical `gpt-5.3-codex` publishes base rates but no exact
 * cache-write price, so it stays out of the card.
 *
 * @see .ptah/specs/TASK_2026_codex_usage_pricing/research-codex-rate-card.md
 */

import type { ModelPricing } from './pricing.utils';

/** One retrieval of the cited OpenAI pages; refresh the card when they change. */
const RETRIEVED = 'retrieved 2026-11-02';

/** The dated rate card for the seven static Codex fallback model IDs. */
export const CODEX_RATE_CARD: Record<string, ModelPricing> = {
  'gpt-6.1-sol': {
    inputCostPerToken: 2e-6, // $2.00 per 1M input
    outputCostPerToken: 10e-6, // $10.00 per 1M output
    cacheReadCostPerToken: 0.1e-6, // $0.10 per 1M cached input
    cacheCreationCostPerToken: 2.5e-6, // $2.50 per 1M 30-minute cache write
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-6.1-sol',
    catalogVersion: RETRIEVED,
  },
  'gpt-6-astra': {
    inputCostPerToken: 10e-6, // $10.00 per 1M input
    outputCostPerToken: 50e-6, // $50.00 per 1M output
    cacheReadCostPerToken: 1e-6, // $1.00 per 1M cached input
    cacheCreationCostPerToken: 12.5e-6, // $12.50 per 1M 30-minute write
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-6-astra',
    catalogVersion: RETRIEVED,
  },
  'gpt-6-sol': {
    // A distinct ID from gpt-6.1-sol with a different cached-read price. The
    // pricing-page flagship table omits this older ID and its model page
    // publishes no 12-hour write rate.
    inputCostPerToken: 2e-6, // $2.00 per 1M input
    outputCostPerToken: 10e-6, // $10.00 per 1M output
    cacheReadCostPerToken: 0.2e-6, // $0.20 per 1M cached input
    cacheCreationCostPerToken: 2.5e-6, // $2.50 per 1M published cache write
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-6-sol',
    catalogVersion: RETRIEVED,
  },
  'gpt-6-luna': {
    inputCostPerToken: 0.1e-6, // $0.10 per 1M input
    outputCostPerToken: 0.5e-6, // $0.50 per 1M output
    cacheReadCostPerToken: 0.01e-6, // $0.01 per 1M cached input
    cacheCreationCostPerToken: 0.125e-6, // $0.125 per 1M 30-minute write
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-6-luna',
    catalogVersion: RETRIEVED,
  },
  'gpt-5.6-sol': {
    inputCostPerToken: 4e-6, // $4.00 per 1M input
    outputCostPerToken: 20e-6, // $20.00 per 1M output
    cacheReadCostPerToken: 0.4e-6, // $0.40 per 1M cached input
    cacheCreationCostPerToken: 5e-6, // $5.00 per 1M 30-minute cache write
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-5.6-sol',
    catalogVersion: RETRIEVED,
    // OpenAI explicitly calls these rates promotional. Recheck after the
    // stated date before trusting this entry.
    effectiveDate: 'promotional through 2026-11-21',
  },
  'gpt-5.6-terra': {
    inputCostPerToken: 2e-6, // $2.00 per 1M input
    outputCostPerToken: 12e-6, // $12.00 per 1M output
    cacheReadCostPerToken: 0.2e-6, // $0.20 per 1M cached input
    // $2.50 = $2.00 x the published 1.25x cache-write rule; the model page
    // prints no separate write cell and no 12-hour rate.
    cacheCreationCostPerToken: 2.5e-6,
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-5.6-terra',
    catalogVersion: RETRIEVED,
  },
  'gpt-5.6-luna': {
    inputCostPerToken: 0.2e-6, // $0.20 per 1M input
    outputCostPerToken: 1.2e-6, // $1.20 per 1M output
    cacheReadCostPerToken: 0.02e-6, // $0.02 per 1M cached input
    // $0.25 = $0.20 x the published 1.25x cache-write rule; the model page
    // prints no separate write cell and no 12-hour rate.
    cacheCreationCostPerToken: 0.25e-6,
    provider: 'openai',
    catalogSource: 'https://platform.openai.com/docs/models/gpt-5.6-luna',
    catalogVersion: RETRIEVED,
  },
};