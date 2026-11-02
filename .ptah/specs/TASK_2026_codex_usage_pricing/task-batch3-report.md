# Usage batch 3 — Shared price contract

## Summary

Added an opt-in exact-rate valuation path and optional, provider-neutral cost meaning and catalog provenance on result and lifetime stats. The new path returns `totalCost: null` when the model, a required rate, a used cache rate, billing mode, cache counter semantics, or usage evidence cannot be trusted. Existing `findModelPricing` and `calculateMessageCost` behavior and absent-field Claude payloads are preserved. The result callback forwards the lifetime snapshot unchanged. No frontend display was edited.

## Files changed

- `libs/shared/src/lib/types/agent-adapter.types.ts` — optional result cost basis, pricing coverage, and rate provenance.
- `libs/shared/src/lib/types/rpc/rpc-session.types.ts` — optional lifetime cost basis and per-model provenance contract; retained the existing pricing coverage union.
- `libs/shared/src/lib/utils/pricing.utils.ts` — exact model lookup, strict four-class calculator, optional catalog metadata on rates.
- `libs/shared/src/lib/utils/pricing.utils.spec.ts` — exact-rate, variant, missing-rate, cache, labels, live pass-through, and legacy-payload cases.
- `libs/shared/src/lib/types/messages/session-stats-live.ts` — documents pass-through of optional fields inside the live snapshot.
- `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts` — forwards the optional fields once, inside the lifetime snapshot.
- This report.

## Contract

`SessionCostBasis` is `'reported' | 'estimated' | 'covered-by-subscription' | 'unknown'`. It is optional on `ResultStatsPayload` and `SessionStatsEntry`; absence means the current Claude interpretation. New valuations use `'unknown'` whenever `totalCost` is null. `PriceProvenance` records `modelIdUsed` and optional nullable `catalogSource`, `catalogVersion`, and `effectiveDate`. The strict calculator explicitly emits null for catalog fields omitted by a rate supplier. Result and lifetime payloads carry a list because a result/session may use several models. `ModelPricing` may carry the same catalog metadata. The strict calculator returns one provenance entry per model for callers to collect.

The existing `SessionStatsPricingCoverage` is `'full' | 'partial' | 'none'`; `'full'` is the complete state. Renaming it to `'complete'` would change existing Claude payloads and consumers. The strict calculator returns `'partial'` when some used class has a valid rate but another required rate or verified cache semantics is missing, and `'none'` for an unknown model, unknown billing mode, invalid counts, missing zero-token usage evidence, or no priced used class. A non-null total is returned only with `'full'` coverage. It requires finite, positive input and output rates and a positive rate for each used cache class. Cache counters require `cacheSemantics: 'disjoint'`; the default is conservative. Reasoning output is already inside output and receives no fifth charge.

`findExactModelPricing` accepts an exact registered ID. It can locate a base Claude entry for a `[1m]` context tag, which the SDK strips before its API request; a distinct tagged catalog entry wins. It does not strip provider prefixes, snapshots, other tags, or model-family suffixes. `calculateExactMessageCost` refuses a base-only `[1m]` rate because it does not establish the long-context price. Subscription returns the published-rate value with `costBasis: 'covered-by-subscription'`; API key returns the same value with `costBasis: 'estimated'`. Neither is an actual invoice. Null always carries `costBasis: 'unknown'`.

## Rate card entries and sources

**None added.** The supplied `research-codex-usage-pricing.md:29` says the bundled table has no `gpt-5*`/`gpt-6*` Codex API price and lists evidence needed for an estimate, but gives no citable exact Codex rate values with an effective date. The zero values in `codex-provider-entry.ts` are subscription placeholders and remain excluded from the shared rate map. Existing bundled OpenAI entries were left unchanged. Runtime rate suppliers can attach source/version/date to exact entries; this batch does not fabricate those fields for entries that lack them.

## Consumers outside scope

`git grep -n` covered exported pricing and stats symbols across `libs/` and `apps/`. The Ptah dependent graph was incomplete (`fileInGraph: false`), so grep was the usable fallback. Production consumers, grouped by area (first matching line per file), are listed below.

- Hosts and agent SDK: `apps/ptah-tui/src/hooks/use-sessions.ts:6`; `libs/backend/agent-sdk/src/index.ts:424`; `libs/backend/agent-sdk/src/lib/auth-env.port.ts:1`; `libs/backend/agent-sdk/src/lib/codex-app-server/codex-session-usage-owner.ts:3`; `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:31`; `libs/backend/agent-sdk/src/lib/helpers/live-session-stats-publisher.ts:29`; `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget.service.ts:5`; `libs/backend/agent-sdk/src/lib/helpers/session-budget/session-budget-stage.ts:4`; `libs/backend/agent-sdk/src/lib/helpers/session-budget/weighted-tokens.ts:19`; `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:18`; `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:10`; `libs/backend/agent-sdk/src/lib/pricing.port.ts:1`; `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:32`; `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:41`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-owner.service.ts:43`; `libs/backend/agent-sdk/src/lib/session-stats/session-stats-reader.service.ts:34`; `libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:3`.
- Rate suppliers and RPC: `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:5`; `libs/backend/auth-providers/src/lib/auth/strategies/api-key.strategy.ts:46`; `libs/backend/auth-providers/src/lib/auth/strategies/cli.strategy.ts:15`; `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:39`; `libs/backend/auth-providers/src/lib/provider-models.service.ts:27`; `libs/backend/auth-providers/src/lib/providers/local/ollama-cloud-metadata.service.ts:54`; `libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:6`; `libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:44`; `libs/backend/rpc-handlers/src/lib/handlers/config-rpc.handlers.ts:56`; `libs/backend/rpc-handlers/src/lib/handlers/provider-rpc.handlers.ts:94`; `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:55`; `libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:3`; `libs/backend/usage-analytics/src/lib/usage-pricing.service.ts:3`.
- Shared catalog and types: `libs/shared/src/lib/providers/entries/codex-provider-entry.ts:32`; `libs/shared/src/lib/providers/entries/kimi-code-provider-entry.ts:9`; `libs/shared/src/lib/providers/entries/opencode-provider-entry.ts:79`; `libs/shared/src/lib/providers/entries/sakana-provider-entry.ts:17`; `libs/shared/src/lib/providers/provider-registry.ts:24`; `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:18`; `libs/shared/src/lib/types/rpc/rpc-config.types.ts:11`; `libs/shared/src/lib/utils/token-usage.utils.ts:2`.
- Frontend and web: `libs/frontend/chat/src/lib/services/chat.store.ts:19`; `libs/frontend/chat/src/lib/services/chat-message-handler.service.ts:40`; `libs/frontend/chat/src/lib/services/chat-store/session-stats-aggregator.service.ts:14`; `libs/frontend/chat-state/src/lib/session-stats-snapshot.ts:1`; `libs/frontend/chat-state/src/lib/surface-session-stats.registry.ts:2`; `libs/frontend/chat-state/src/lib/tab-manager.service.ts:35`; `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:46`; `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:23`; `libs/frontend/chat-types/src/lib/chat-types.ts:13`; `libs/frontend/chat-ui/src/lib/atoms/cost-badge.component.ts:59`; `libs/frontend/chat-ui/src/lib/molecules/agent-lane-stats/agent-lane-stats.component.ts:39`; `libs/frontend/chat-ui/src/lib/molecules/session/inspector-stats/inspector-cache-tile.component.ts:8`; `libs/frontend/chat-ui/src/lib/molecules/session/session-model-breakdown.component.ts:10`; `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-summary.component.ts:12`; `libs/frontend/chat-ui/src/lib/molecules/session/session-stats-view.ts:1`; `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:22`; `libs/frontend/command-center/src/lib/components/command-center-start.component.ts:15`; `libs/frontend/command-center/src/lib/components/command-session-stats.component.ts:15`; `libs/frontend/core/src/lib/services/model-state.service.ts:162`; `libs/frontend/dashboard/src/lib/models/session-analytics.models.ts:3`; `libs/frontend/harness-builder/src/lib/components/sidebar/builder-session-section.component.ts:13`; `libs/frontend/onboarding/src/lib/shared/details-log.component.ts:16`; `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits.fixtures.ts:39`; `libs/web/landing/src/lib/live-demo/scenario/replay-scenario.types.ts:9`.

## Decisions

- Kept the existing `'full'` pricing-coverage wire value and added only optional fields for host compatibility.
- Used the plan's labels (`'estimated'` and `'covered-by-subscription'`) so batch 5 can render them without a Codex-specific branch.
- Left rate fields optional in the input model because bundled and runtime entries do not consistently carry versioned source metadata. The strict calculator records missing catalog metadata as null in its output provenance.
- Kept live optional fields inside `sessionStats`, the existing authoritative snapshot, instead of duplicating top-level state.
- Read the local `execute-phase-gated-task` skill file because this lane exposed no native skill loader. Its build/test and commit steps were superseded by this task's prohibitions.

## Open risks

- No exact Codex rate is bundled; an offline or unhydrated Codex model remains unavailable. Batch 4 must supply a trusted exact rate and verified native cache semantics before publishing a value.
- Existing rate suppliers do not yet attach catalog source/version/effective date, so their exact entries can be valued but their provenance fields remain null. Repricing persisted records on catalog version changes is future wiring.
- Frontend presentation is batch 5. Existing frontend snapshot validation/display may not yet use the new fields; it was outside this scope.
- Tests, typecheck, lint, builds, Nx targets and diagnostics were prohibited; host compilation and the new specs are unverified. Ptah AST parsing was clean for five edited TypeScript files; `rpc-session.types.ts` had the same one recovered parser error before and after this edit.
- The foreign `task-tracking/landing-live-demo/HANDOFF.md` change was left untouched.

## Degradation audit result

The permitted `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` exited 0: 279 existing unsuppressed sites, within baselines; no finding in the edited source files. `git diff --check` exited 0. Every edited file and this report has LF line endings, no CR, and no BOM.

## Revision 1

| Defect | Fix and file:line | Spec |
| --- | --- | --- |
| D1 | Require `usageObserved: true` before an all-zero turn can yield a known $0; otherwise null, unknown basis, and none coverage. `pricing.utils.ts:482,543` | `pricing.utils.spec.ts:655` covers missing evidence and an observed zero-token turn. |
| D2 | Reject zero, negative, and non-finite exact rates. `pricing.utils.ts:493` | `pricing.utils.spec.ts:623` covers zero, negative, and both infinities; NaN was already covered. |
| D3 | Use `costBasis: 'unknown'` on every null total, documented in the shared type. `pricing.utils.ts:507,535,543,573`; `rpc-session.types.ts:487` | `pricing.utils.spec.ts:588,611,623,655` asserts unknown basis on unavailable results for both billing modes. |
| D4 | Correct the live-wire comment: its consumer does not validate these optional values. `session-stats-live.ts:23` | Comment-only correction; no new spec. |
| D5 | Keep the documented `[1m]` base lookup but refuse an exact cost unless the tagged key has its own rate. `pricing.utils.ts:454,515` | `pricing.utils.spec.ts:548` covers base-only unavailable and distinct tagged rate pricing. |
| D6 | Emit explicit null source/version/effective date when a hydrated rate lacks those fields, and document the gap. `pricing.utils.ts:519`; `rpc-session.types.ts:497` | `pricing.utils.spec.ts:675` covers all three null values. |
| D7 | Forward optional fields once in the authoritative `sessionStats` snapshot; legacy turn fields remain. `sdk-callbacks.ts:441`; `agent-adapter.types.ts:66` | Existing live-snapshot pass-through spec at `pricing.utils.spec.ts:745`; callback wiring inspected, with no callback spec in the allowed files. |
| D8 | Wrapped new exact-rate code and specs to the repository's 80-column width. `pricing.utils.ts:462,529,553`; `pricing.utils.spec.ts:548-758` | Static line-length scan; formatting commands were prohibited. |

The permitted degradation audit was rerun for this revision and exited 0 with 279 existing findings within baseline. `git diff --check` passed. Tests, typecheck, lint, build, Nx targets, diagnostics, and Prettier were not run under the task rules. No rate card entries were added, and the separate `research-codex-rate-card.md` and foreign handoff file were left untouched.
