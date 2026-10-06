# Batch 32 report: Cost estimate per request model (F.5 M3, decision F-E)

Status: both tasks done. Not committed. All scoped checks exit 0.

## Files changed

- `libs/shared/src/lib/utils/pricing.utils.ts`
- `libs/shared/src/lib/utils/pricing.utils.spec.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts`
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.spec.ts`

The other modified files in the worktree (`apps/ptah-cli/...`, `libs/backend/vscode-lm-tools/...`) belong to batches
running in parallel. This batch did not touch them.

## Task 32.1: Missing cache price shows "unknown" (F-E)

- New shared predicate `pricesCacheTokens(pricing, tokens)` in `pricing.utils.ts`. It returns false when the request
  used cache read tokens and the model has no `cacheReadCostPerToken`, or used cache write tokens and the model has no
  `cacheCreationCostPerToken`. A cache kind with 0 tokens, or none reported, needs no price. An explicit price of 0
  (the `local` and `:cloud` entries) counts as a price.
- `calculateMessageCost` itself is unchanged. Its doc now says that it bills a missing cache price at 0, and points
  callers that must show "unknown" to `pricesCacheTokens`.
- Why not change `calculateMessageCost`: its zero-cache behaviour is pinned by existing specs ("treats missing cache
  pricing as zero"). It also feeds backend session cost totals (`stream-transformer`, `session-usage-aggregator`,
  `session-replay`, `assistant-message.transformer`, `skill-synthesis`). Changing it would make every Codex/OpenAI
  message that has cached input cost `null` in the header total, and agent-sdk is being edited in parallel. F-E is about
  the agent monitor estimate (F.5 M3), so the rule is applied there.

## Task 32.2: Price each request with its own model

- `agent-monitor.store.ts`:
  - `sumRequestUsage` now also returns `estimatedCostUsd`. `sumRequestCost` prices each request with its own `model`.
    A request that named no model uses the latest model the subagent named, which is the only model evidence available.
    The function returns `null` as soon as any request is unpriced: either its model has no price, or it used cache
    tokens that have no cache price. The sum is rounded to 6 decimals. Pricing is looked up once per distinct model per
    sum (a local `Map`), so a long subagent run does not repeat the prefix-match scan for every request on every event.
  - `estimateCost(model, tokens, pricing)` combines `pricesCacheTokens` with `calculateMessageCost`. `requestTokens`
    maps `{ input, output, cacheRead, cacheWrite }` to `TokenBreakdown`.
  - `SubagentUsageTotals` gains the optional `estimatedCostUsd?: number | null`. The `AgentUsageView.estimatedCostUsd`
    doc is updated.
  - `subagentUsageView` reads the totals' per-request figure through `totalsCost`. Totals that carry no figure, because
    the store did not build them (the type is exported, and the `chat` lib spec builds them by hand), are priced as one
    request on their `model` under the same cache rule. When the store built the totals and no request named a model,
    both paths give `undefined`, as before.

## Tests

- `pricing.utils.spec.ts`: a new `describe('pricesCacheTokens')` with 4 cases: no cache tokens, read unpriced, write
  unpriced, and an explicit zero price. A comment was added on the kept "treats missing cache pricing as zero" test.
- `agent-monitor.store.spec.ts`, in the block `N6 per-agent usage, context and cache data`:
  - Two test models with cache prices are registered through `updatePricingMap` and reset in `afterEach`.
  - The existing "sums usage per message" test used `gpt-4o`, which has no cache price, with cache tokens. Under F-E
    that is now `null`, so the test now uses a cache-priced model.
  - A new `describe('cost estimate per request model (F-E)')` has 7 cases:
    - a mid-run model change equals the sum of per-request prices, not all tokens priced on the latest model
    - a request with no model falls back to the latest model
    - cache read with no price gives `null`
    - one unpriced cache write among several requests gives `null`
    - a model with no cache prices is still priced when it used no cache tokens
    - an unknown request model gives `null`
    - hand-built totals are priced on their model under the cache rule

## Checks run (from the worktree)

| Command | Exit |
| --- | --- |
| `npx nx run-many -t typecheck,lint,test -p shared chat-streaming --parallel=2 -- --maxWorkers=2` | 1: typecheck only, because I passed `--maxWorkers` through to `ngc` (TS5023, my mistake). lint and test passed for both projects. |
| `npx nx affected -t typecheck --exclude='api-*,ptah-license-server,ptah-landing-page-e2e' --parallel=2` (covers shared, chat-streaming, chat, agent-sdk, vscode-lm-tools and the rest of the affected projects) | 0 |
| `npx nx run di-lint:lint` | 0 |
| `npx nx run degradation-audit:lint` | 0 |
| `npx nx run @ptah-extension/chat:test --testPathPattern=subagent-usage-summary --maxWorkers=2` (the hand-built-totals consumer) | 0 |

The affected typecheck reran typecheck for `shared` and `chat-streaming` without the bad flag, so typecheck is covered.
No baseline PNGs were rewritten (`git status` shows none).

## Open notes

- The UI in `libs/frontend/chat/.../subagent-usage-summary.component` gives a `null` estimate the title "No price is
  known for this model". A missing cache price now also produces `null`, so that title is slightly inaccurate in that
  case: the model has a price, but not for its cache tokens. This is outside this batch (chat lib); it could become a
  wording follow-up in Batch 33.
- A request with no `model` is priced with the latest model the subagent named. If the user wants such a request to
  make the whole estimate "unknown" instead, it is a one-line change in `sumRequestCost`.
