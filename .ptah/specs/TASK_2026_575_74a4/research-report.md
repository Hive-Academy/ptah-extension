# Research Report - TASK_2026_575_74a4 (session cost accounting)

Sources: three researcher-expert investigations (cost pipeline, analytics, git history) plus orchestrator verification on base 722d921ab. All paths relative to the repo root.

## Accounting facts (SDK contract)

- `SDKResultSuccess.total_cost_usd` and `modelUsage[*]` (tokens and `costUSD`) are CUMULATIVE per SDK process (query). They reset when a fresh process starts (resume, model switch, restart).
- `sdkMessage.usage` is per turn and main-loop only.
- Claude native route = `reported` cost source (SDK dollars). Codex / other proxies = `unreported`: cost is priced locally from `modelUsage` tokens x rate card (`stream-transformer.ts:682-686`), still cumulative.

## Defect 1 - per-message cost is the cumulative process total (Claude AND Codex)

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:674-687` computes `totalCost` (cumulative); `:772-779` publishes it as `rawStats.cost` next to `tokens: sdkTokens` (per-turn). Comment at `:769-771` claims per-turn semantics.
- Frontend: `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:604,627-652` (`mergeStatsOntoLastAssistant`), `message-finalization.service.ts:169`, `chat-transcript.component.ts:378-382` put it on the last assistant message `cost`; rendered by `message-bubble.component.ts:157` / `cost-badge.component.ts`.
- Test that encodes the wrong semantics: `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.spec.ts:2365-2399` expects `payloads.map(p => p.cost)` = `[10, 15]` (cumulative); `:1284-1317` single-turn only.
- TASK_2026_418_a91c research (`.ptah/specs/TASK_2026_418_a91c/research-report.md:44-52`) planned a per-turn delta normalization before `onResultStats`; commit b75f6f0cf implemented only the session-total half (`SessionStatsOwnerService.replaceRun` / `subtractRunBase`).
- Correct: per-turn cost = this result's cumulative - previous accepted cumulative in the same run (first result of a run: minus the run base restored from disk, if any). Must be consistent with the per-turn tokens.

## Defect 2 - live header omits subagent / CLI-lane spend

- `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:526-533` `recordAgent()` only adds the id to `agentIds` (AGENTS count). No token/cost contribution is added live. `state.prefix` is captured once at owner creation.
- Only the disk path `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:202-305` (`aggregateLedgers`) folds subagent ledgers into totals, so the header jumps after reload.
- Unverified: whether CLI-lane (`ptah_agent_spawn`) spend is included anywhere (`cliAgents` field attached by a handler; `session-usage-aggregator.ts:53`). Must be verified and decided.
- Open question: does the SDK's `total_cost_usd` / `modelUsage` of the MAIN process already include Task-tool subagent spend? (Claude SDK `modelUsage` is known to include subagent models in some versions.) If yes, adding subagent ledgers live would double count. Must be settled with evidence (SDK types / real transcripts) before implementation.

## Defect 3 - analytics drops the whole cost of partially priced sessions

- `session-usage-aggregator.ts:285-292`: `totalCost = pricingCoverage === 'full' ? knownCost : null`.
- `libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:286-291`: `null` sessions are excluded from `totalCost`, only counted in `unknownCostSessionCount`.
- Real data (40 most recent sessions of this workspace): 8 mix Opus with `opencode-go/*`, `glm-5.3`, `ollama/kimi-k3:cloud` or `claude-opus-5-5[1m]`; their Opus spend vanishes from the analytics total.
- Correct: aggregate the known cost of every session; surface partial coverage explicitly (partial flag + unpriced token count), never drop known spend.

## Defect 4 - `[1m]` model ids get no price

- `libs/shared/src/lib/utils/pricing.utils.ts:266-302` `lookupPricingEntry`: exact, provider-prefix strip, date-snapshot suffix. No handling of the `[1m]` context-variant suffix, so `claude-opus-5-5[1m]` -> null. Commit 20a67d5e1 fixed `[1m]` only for context-window matching.
- Must bill the `[1m]` variant at the correct rates (check whether the 1M-context tier has different long-context pricing in the rate data; do not guess).

## Correct in base (keep)

- Session header total for the main agent across process restarts: `SessionStatsOwnerService` `resolveRunBase` / `subtractRunBase` / `replaceRun`.
- Exact-match pricing (b9813a73d): never bill a model at another model's rates.
- Unknown price renders as unavailable, never $0 (c10d0438f).

## Recurrence causes

1. One field name (`cost`) carries per-turn and cumulative meanings across `rawStats.cost` and `sessionStats.totalCost` (`session-stats-aggregator.service.ts:26-39`).
2. Tests use a fresh session with a zero base, so cumulative == delta for the first run.
3. No contract test pins: sum of per-message costs == session total; header total == analytics total for the same session.
4. Provider branches (`reported` / `unreported`) repeatedly re-derive `totalCost` in the same block.
