# Codex Turn Cost — Investigation Findings

Read-only investigation. Every claim below was verified against the cited file and line. Repo-relative paths; line numbers as read on 2026-09-19.

There are two distinct Codex paths in this product, and they behave differently:

- **Chat-provider lane** — `CodexTranslationProxy` (Anthropic-compatible proxy over the OpenAI Responses API). This is the lane the chat header's cost badge is fed from.
- **Rival-CLI lane** — `CodexCliAdapter` (`@openai/codex-sdk` Thread API, spawned by `AgentProcessManager`). This lane computes no cost at all.

---

## 1. Where does a Codex turn's token usage enter the codebase?

**Chat-provider lane.** The adapter is `libs/backend/auth-providers/src/lib/providers/codex/codex-translation-proxy.ts` (extends `TranslationProxyBase`). It always uses the Responses API (`shouldUseResponsesApi` returns true, codex-translation-proxy.ts:130-132). The OpenAI Responses API usage object carries:

- `usage.input_tokens` — total input, **including** cached tokens
- `usage.output_tokens` — total output, **including** reasoning tokens (the API's `output_tokens_details.reasoning_tokens` is never read)
- `usage.input_tokens_details.cached_tokens` — the cached portion of the input

These are translated into the Anthropic usage shape by `translateResponsesUsage` in `libs/backend/auth-providers/src/lib/translation/translation-proxy-helpers.ts:25-39`. Its doc comment (lines 22-24) states the two facts the whole pipeline rests on: "Responses input includes cache hits; Anthropic input excludes them. Output already includes reasoning tokens, so never add reasoning details." The translation produces `input_tokens = input - cacheRead`, `output_tokens`, and `cache_read_input_tokens = cacheRead`. No `cache_creation_input_tokens` is ever emitted for Codex. The streaming variant is `responses-stream-translator.ts` (`handleResponseCompleted` 458-481, `emitFinalEvents` 487-523); the non-streaming variant is `responses-stream-collector.ts:190`.

**Rival-CLI lane.** `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.ts:92-99` — the `turn.completed` event carries `usage: { input_tokens, cached_input_tokens, output_tokens }` (note the different field name: `cached_input_tokens`, not `input_tokens_details.cached_tokens`). `handleTurnCompleted` (codex-cli.adapter.ts:1104-1113) converts this to a text segment only: `Usage: ${input} input, ${output} output tokens` — `cached_input_tokens` is dropped and no cost is computed. `cli-agent-runtime` contains zero references to `calculateMessageCost` or `costUSD` (verified by search).

## 2. Which model id is attached, and is it in the pricing map?

The normalization function is `CodexTranslationProxy.normalizeModelId` (codex-translation-proxy.ts:93-113). It maps `'default'`/`'sonnet'`/`'opus'`/`'haiku'` and any `claude-*` id to the tier values in `CODEX_DEFAULT_TIERS` (`libs/shared/src/lib/providers/entries/codex-provider-entry.ts:80-84`): sonnet → `gpt-5.3-codex`, opus → `gpt-5.4`, haiku → `gpt-5.1-codex-mini`. Non-claude ids pass through unchanged. This normalization is applied to the request before forwarding (`translation-proxy-base.ts:363`), and the resulting id rides back on `message_start.model` and `message_delta` (responses-stream-translator.ts:148-165, 487-523). The Claude Agent SDK therefore keys `result.modelUsage` by the Codex id, and that is the id `resolveForCost` prices (`model-resolver.ts:187-202` passes non-claude ids through via `resolveForPricing`, 144-164).

Is that exact string in the pricing map the OpenRouter fetch builds? The map is hydrated by `OpenRouterPricingService.fetchAndRegister` (`openrouter-pricing.service.ts:93-117`), which registers the catalog id (`openai/gpt-...`) plus the `/`-stripped tail (`stripPrefix`, 241-247). The repo's own documentation makes two statements:

- `gpt-5.4` **is** on OpenRouter — `pricing.utils.ts:54-59`: "`gpt-5.4` is a Codex model AND an OpenRouter one."
- Codex subscription models generally **are not** priced — `pricing.utils.ts:307-312`: "a discovered model with a real `context_window` but no published price (every Codex subscription model) never reaches the pricing map."

So `gpt-5.4` (opus tier) resolves to a real price; the codex-only ids (`gpt-5.3-codex` — the default sonnet tier — `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`) are documented as having no published price. Whether any given id is in OpenRouter's *live* catalog is a network fact this repo cannot pin; I could not verify it from code. The Codex provider's own `$0` static models never seed the map: `seedStaticModelPricing` returns early for subscription-covered providers (`libs/shared/src/lib/providers/provider-registry.ts:891-892`), which is deliberate.

Two lookup details matter (both in `pricing.utils.ts`): `findModelPricing` (210-229) warns once and returns null on a miss, and `lookupPricingEntry` (236-250) falls back from exact match to **bidirectional substring matching** — any registered key that is a substring of the model id (or vice versa) wins. That fallback is a hazard for Codex ids; see Verdict.

## 3. Reasoning and cached tokens

**Reasoning tokens: counted exactly once.** They are inside `output_tokens` from the Responses API, and the translation layer deliberately never adds a separate reasoning field (translation-proxy-helpers.ts:22-24, 25-39). Not double-counted, not dropped.

**Cached input: correctly split, rate-dependent billing.** The proxy subtracts cached from input (translation-proxy-helpers.ts:25-39), so uncached input bills at the full input rate — correct. The result-stats path passes cache reads into the cost calculation (`stream-transformer.ts:465-477`: `cacheHit: usage.cacheReadInputTokens ?? 0`), and `calculateMessageCost` bills them at `resolved.cacheReadCostPerToken ?? 0` (`pricing.utils.ts:289-290`). Two consequences:

- If the OpenRouter entry carries `input_cache_read` (parsed at openrouter-pricing.service.ts:249-288), cached tokens bill at the published cache rate — correct.
- If it does not, cached tokens bill at **$0** — silently under-billed, not double-counted. Codex never emits cache-creation tokens, so that term is always 0.

**One path drops cache for everyone.** The per-message transformer (`assistant-message.transformer.ts:363-371`) extracts only `input` and `output` from `message.usage`; `cache_read_input_tokens` and `cache_creation_input_tokens` are discarded before `calculateMessageCost` runs (376-380). This is provider-agnostic (Claude messages lose cache there too), and for Codex it means the message-level cost counts only the uncached input.

## 4. What does `subscriptionCovered` actually change?

Only a label. Never a displayed number, never a computed cost.

The chain: `isSubscriptionCoveredProvider` (`provider-registry.ts:871-876`, true for `openai-codex` and `github-copilot` — anything with `pricingModel: 'subscription'`) is read by `ModelResolver.isSubscriptionCovered` (`model-resolver.ts:172-176`), which is returned by `resolveForCost` as `subscriptionCovered` (187-202). Every production reader:

- `config-rpc.handlers.ts:489-493` — the only RPC consumer. It passes the flag into `getModelPricingDescription` for the model-picker description strings.
- `getModelPricingDescription` (`pricing.utils.ts:446-461`) — the flag's sole effect in the codebase is line 459-461: it appends `" · covered by subscription"` to the rate string.

That is all. `stream-transformer.ts:445-477` computes cost identically regardless of the flag (it never reads `priced.subscriptionCovered`), and the frontend has zero references to `subscriptionCovered` (verified by search across `libs/frontend`). The design intent is stated at `pricing.utils.ts:57-59` ("the flat-fee billing is a labelling concern") and `model-resolver.ts:184` ("`subscriptionCovered` rides along so surfaces can say the fee is flat").

## 5. What does the chat header show for a Codex subscription user today?

It depends on whether the normalized model id found a price:

- **`gpt-5.4` (opus tier):** priced per `pricing.utils.ts:54-59`, so `stream-transformer.ts:465-477` computes a real number and the badge renders it (`cost-badge.component.ts:30-36`).
- **`gpt-5.3-codex` (the default sonnet tier), `gpt-5.1-codex-mini`, `gpt-5.1-codex-max`:** per `pricing.utils.ts:307-312` these publish no price, so `findModelPricing` returns null, `costUSD = null` (deciding line: `stream-transformer.ts:477`), and the badge renders **"cost unavailable"** (`cost-badge.component.html` template, `cost-badge.component.ts:37-45`, specifically line 43). The binding is `<ptah-cost-badge [cost]="message().cost" />` in `message-bubble.component.html:174` (and `summary.cost` at line 133). Session-level totals behave the same: `session-usage-aggregator.ts:174-217` returns `totalCost: null` when no model priced.
- **Never `$0.0000`:** the Codex provider's `$0` static models are never registered (`provider-registry.ts:891-892` skips subscription providers), and the badge deliberately distinguishes a known `0` from `null` (`cost-badge.component.ts:19-24, 59-68`) — a null cost renders "cost unavailable", never "$0.00".

One caveat: if the substring fallback in `lookupPricingEntry` matches a shorter registered id (see Verdict), the badge would show a wrong *number* instead of "cost unavailable" — silently.

## 6. Codex vs the Claude path — every difference

| # | Difference | Evidence | Deliberate or oversight? |
|---|------------|----------|---------------------------|
| 1 | Cost source: direct Claude uses the SDK's `usage.costUSD` (`stream-transformer.ts:457-458`); Codex proxy computes from the pricing map (459-477) | stream-transformer.ts | **Deliberate** — the proxy response carries no cost figure, so there is nothing to read |
| 2 | Model id normalization: Codex rewrites tier words/`claude-*` to codex ids before forwarding (translation-proxy-base.ts:363, codex-translation-proxy.ts:93-113); Claude ids pass through | codex-translation-proxy.ts | **Deliberate** — the endpoint can only serve codex ids |
| 3 | Usage translation: Codex subtracts cached from input (translation-proxy-helpers.ts:25-39); Claude usage already separates cache natively | translation-proxy-helpers.ts | **Deliberate** — the math is equivalent |
| 4 | Cache rates: Claude entries carry published cache read/write rates; Codex entries get them only if the OpenRouter catalog supplies `input_cache_read`/`input_cache_write`, else cache bills at $0 | pricing.utils.ts:289-292, openrouter-pricing.service.ts:249-288 | **Data availability; the `?? 0` fallback is an oversight of consequence** — it silently understates rather than degrading to "unavailable" |
| 5 | Subscription label ("· covered by subscription") applies only to Codex/Copilot | pricing.utils.ts:54-59, 459-461 | **Deliberate** — documented design |
| 6 | Per-message path drops cache tokens for all providers, Claude included | assistant-message.transformer.ts:363-371 | **Shared limitation**, not Codex-specific |
| 7 | Rival-CLI lane: the Codex SDK adapter emits usage as text only, drops `cached_input_tokens`, computes no cost (codex-cli.adapter.ts:1104-1113); Claude has no rival-CLI lane, and its primary path always costs | codex-cli.adapter.ts | **Oversight/gap** — nothing in the file records a decision to skip cost; `cli-agent-runtime` has no cost plumbing at all |

---

## Verdict

Where a Codex model has a published price, the arithmetic is correct: reasoning is counted once inside output, cached input is split correctly, and unpriced models render "cost unavailable" rather than a fabricated number. But it is not fully correct:

1. `lookupPricingEntry`'s substring fallback (pricing.utils.ts:241-248) can bill a Codex id at a *different, shorter* model's registered rates (e.g. `gpt-5.3-codex` contains `gpt-5`) — a silently wrong number with no warning, because the miss-warning only fires on a total miss.
2. Entries without `input_cache_read` bill cached tokens at $0 (pricing.utils.ts:289-290) — silently understated.
3. The `@openai/codex-sdk` lane computes no cost and discards `cached_input_tokens` outright (codex-cli.adapter.ts:1104-1113).

**Smallest single fix:** change `lookupPricingEntry` (pricing.utils.ts:241-248) to accept a partial match only on full segment boundaries (split on `/`, `.`, `-`) instead of bare `includes`, so a Codex id either finds its own entry or returns null ("cost unavailable"). One function, one file, and it removes the only path that can print a confidently wrong dollar figure. Not implemented, per instructions.