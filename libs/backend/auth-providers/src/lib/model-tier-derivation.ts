/**
 * Derive Opus / Sonnet / Haiku tier mappings from a provider's OWN catalogue.
 *
 * ## Why this exists
 *
 * Three registry entries declare no `defaultTiers` — `openrouter`, `lm-studio`
 * and `requesty` — each for a documented reason (a ~200-model dynamic
 * catalogue, a locally-loaded model set, an unverifiable tier map;
 * `requesty-provider-entry.ts:19-23` says outright that "tiers come from the
 * live model list instead"). Until TASK_2026_262 nothing implemented that
 * sentence, so a tier-shaped value — the chat path's `'default'`, which
 * recurses to `'opus'` — left `ModelResolver.resolve` verbatim and the endpoint
 * 404'd. This function is the missing step: given the catalogue the provider
 * itself returned, name three ids FROM IT.
 *
 * ## The rule, and the reasoning you are invited to disagree with
 *
 * 1. **Candidates.** Entries with a non-empty `id`, narrowed to those that
 *    declare `supportsToolUse`. If that filter empties the list, the whole
 *    list is used instead: LM Studio's `/v1/models` reports no
 *    `supported_parameters` at all and the adapter hardcodes
 *    `supportsToolUse: false` for every entry
 *    (`local-model-translation-proxy.ts:148-154`), so a catalogue must not be
 *    silenced by its own silence. When SOME entries declare it, the ones that
 *    do not are genuinely unusable for an agent and are dropped.
 *
 * 2. **Nominal pass — the provider naming the tier itself.** For each tier,
 *    take candidates whose `id` or `name` contains that tier word on a word
 *    boundary, and pick the greatest `id` under a code-unit ascending sort.
 *    This is the highest-confidence signal available: if a router carries
 *    `anthropic/claude-opus-4.5`, then "opus" on that router means that model
 *    and nothing else. `.sort().at(-1)` as "newest version last" is the
 *    convention inherited from the auto-resolver this rule replaced (deleted in
 *    TASK_2026_265 because it persisted its answer into the user-choice slot);
 *    it was reused here rather than invented — though note that the old one's
 *    `.sort()` had no comparator and was provably inert, so this is the first
 *    implementation where the convention actually sorts. Two known flaws, both
 *    stated rather than hidden: a lexicographic
 *    compare orders `4.10` before `4.9`, and a suffixed variant
 *    (`...:beta`) sorts above its own base id. Both still yield a servable id
 *    from the family the user asked for, which is the bar this rule sets.
 *
 * 3. **Ordinal pass — for tiers the nominal pass left unset.** Rank candidates
 *    by `contextLength` descending, tie-broken by `id` ascending. Opus takes
 *    the largest, Haiku the smallest, Sonnet the upper-middle
 *    (`floor((n-1)/2)` — the workhorse tier leans toward the capable end).
 *    Context length is chosen over price deliberately. Price is the more
 *    intuitive capability proxy, but ranking by price means the top tier is
 *    selected BECAUSE it is expensive — on a ~200-model router that silently
 *    points a user's first message at whatever the priciest listing happens to
 *    be. Context length cannot make that mistake. Its own failure mode is
 *    honest and cheap: a small long-context model out-ranks a large
 *    short-context one.
 *
 * 4. **No ordering signal → one model, not a fabricated spread.** If fewer
 *    than two distinct context lengths exist across candidates, there is
 *    nothing to rank by, and inventing an order from the alphabet would be a
 *    guess wearing a rule's clothes. Every still-unset tier gets the same
 *    single id — the code-unit-first candidate, chosen because it is
 *    independent of the order the provider happened to return. In practice
 *    this branch is reached only by catalogues with uniform metadata, which
 *    means local ones (LM Studio stamps `contextLength: 4096` on everything),
 *    where the models are free and all equally servable. That fall-out is why
 *    no provider id appears anywhere in this file.
 *
 * 5. **An unreadable catalogue returns `{}`.** Never a guess. A wrong-but-
 *    servable model is worse than a 404 because it is silent, so the only
 *    thing this function will not do is name an id the catalogue did not
 *    contain.
 *
 * Deterministic and total: same catalogue in, same map out, no throw, no
 * network, no clock, no `Math.random`. Every returned string is `===` to an
 * `id` on an entry of the input array.
 */

import type {
  ProviderModelInfo,
  ProviderModelTier,
} from '@ptah-extension/shared';

/** Tier → model id, with any tier the catalogue could not justify left out. */
export type DerivedTierMap = Partial<Record<ProviderModelTier, string>>;

/** Ordered most- to least-capable, which is the order the ordinal pass uses. */
const TIERS: readonly ProviderModelTier[] = ['opus', 'sonnet', 'haiku'];

/** Code-unit ascending. Locale-independent so two machines agree. */
function byIdAscending(a: ProviderModelInfo, b: ProviderModelInfo): number {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Context length as a rank key, with anything unusable flattened to 0. */
function rankKey(model: ProviderModelInfo): number {
  const raw = model.contextLength;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Does this entry name the tier in its own id or display name?
 *
 * Word-boundary matched so `claude-3-opus-20240229`, `anthropic/claude-opus-4.5`
 * and `opus[1m]` all count while a substring collision inside a longer token
 * does not. `description` is deliberately NOT scanned — marketing copy
 * comparing a model to Sonnet is not the provider saying it IS Sonnet.
 */
function namesTier(model: ProviderModelInfo, tier: ProviderModelTier): boolean {
  const pattern = new RegExp(`\\b${tier}\\b`, 'i');
  return pattern.test(model.id) || pattern.test(model.name ?? '');
}

export function deriveTiersFromCatalog(
  models: readonly ProviderModelInfo[] | null | undefined,
): DerivedTierMap {
  if (!Array.isArray(models) || models.length === 0) return {};

  const valid = models.filter(
    (m): m is ProviderModelInfo =>
      !!m && typeof m.id === 'string' && m.id.length > 0,
  );
  if (valid.length === 0) return {};

  const toolCapable = valid.filter((m) => m.supportsToolUse === true);
  const candidates = toolCapable.length > 0 ? toolCapable : valid;

  const derived: DerivedTierMap = {};

  for (const tier of TIERS) {
    const named = candidates.filter((m) => namesTier(m, tier));
    if (named.length > 0) {
      derived[tier] = [...named].sort(byIdAscending).at(-1)?.id;
    }
  }

  const unset = TIERS.filter((tier) => !derived[tier]);
  if (unset.length === 0) return derived;

  const distinctRanks = new Set(candidates.map(rankKey));
  if (distinctRanks.size < 2) {
    const only = [...candidates].sort(byIdAscending)[0];
    for (const tier of unset) derived[tier] = only.id;
    return derived;
  }

  const ranked = [...candidates].sort(
    (a, b) => rankKey(b) - rankKey(a) || byIdAscending(a, b),
  );
  const positions: Record<ProviderModelTier, number> = {
    opus: 0,
    sonnet: Math.floor((ranked.length - 1) / 2),
    haiku: ranked.length - 1,
  };
  for (const tier of unset) derived[tier] = ranked[positions[tier]].id;

  return derived;
}
