# Model resolution and cost investigation

MEASURED: This bounded investigation read production code and ran one in-memory resolver probe. It did not edit product files, build, launch Electron, spawn a CLI agent, or inspect the observed session's runtime state. Paths below are relative to `D:\projects\ptah-extension`.

## Conditional model defect, verified in code

| Label | Link | Evidence |
| --- | --- | --- |
| MEASURED | One process-wide auth environment | `libs/backend/auth-providers/src/lib/di/register.ts:38` registers `SDK_AUTH_ENV` with `registerInstance(createEmptyAuthEnv())`. |
| MEASURED | Actual session uses workspace identity | `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:539` documents workspace provider isolation; `:543` resolves that profile. `libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:162` constructs a native Claude CLI profile with its own blank base URL/auth values (`:163-170`). |
| MEASURED | Session query receives that identity | `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:674` extracts `providerProfile?.authEnv`; `:727` passes it as `authEnvOverride` to the query. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:780` chooses the override rather than global auth. |
| MEASURED | Stats discard that identity | The subsequent `streamTransformer.transform` call, `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:742`, passes no auth override. `StreamTransformConfig` has no env field (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:131`), and `transform` captures `this.authEnv` at `:309`. This is the shared instance, not a session snapshot. |
| MEASURED | Global provider changes shared state | `libs/backend/auth-providers/src/lib/auth/auth-manager.ts:190` passes shared auth into its strategy. The Codex OAuth strategy writes proxy base URL and token at `libs/backend/auth-providers/src/lib/auth/strategies/oauth-proxy.strategy.ts:243`, then switches provider tiers at `:247`. `libs/backend/auth-providers/src/lib/provider-models.service.ts:937` clears and applies active tiers; `:682` reads `mainAgent` mappings and `:701-705` writes them to shared auth and process env. |
| MEASURED | Stats reinterpret actual model with global provider | `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:454` calls `resolveForCost(model, authEnv)` for SDK `modelUsage` keys and emits `resolvedModel` at `:501`. `libs/backend/auth-providers/src/lib/auth/model-resolver.ts:195-199` calls `resolveForPricing`; `:147-151` preserves IDs for direct Anthropic but invokes remapping for a proxy. `:39-45` detects the tier of `claude-*` IDs and replaces it with that tier's env override. |

INFERRED: If the observed session used its native Claude profile while the process-global auth pointed at a proxy whose Opus tier was `gpt-5.6-sol`, this precise chain explains a Claude Opus session producing a `gpt-5.6-sol` modelUsage entry. The incident's global auth, tier configuration, and actual result payload were not available, so this is not proof of the incident's prerequisites.

MEASURED: A child-lane tier edit is explicitly prevented from changing global identity. `libs/backend/auth-providers/src/lib/provider-models.service.ts:510` documents the guard, and `:528-531` mutates globals only for `scope === 'mainAgent'`. `libs/backend/auth-providers/src/lib/auth/provider-auth-resolver.ts:399-415` builds a fresh tier object, and `:456-461` copies the process env and strips chat auth keys before applying lane values. There is no evidence in this bounded trace that a Codex spawn writes the shared auth instance. The process-manager investigator owns the native-spawn path.

## No-build synthetic probe

MEASURED: Ran Node against installed TypeScript to transpile the production `model-resolver.ts` in memory and evaluate its class with stub DI decorators, logger, provider lookup, subscription lookup and pricing lookup. The `isDirectAnthropic` predicate and tier-map values matched the production code. Pricing returned null deliberately. The production resolver received `claude-opus-4-6` in both calls:

| Label | Input env | Output modelId |
| --- | --- | --- |
| MEASURED | `{ ANTHROPIC_BASE_URL: 'http://127.0.0.1:12345', ANTHROPIC_DEFAULT_OPUS_MODEL: 'gpt-5.6-sol' }` | `gpt-5.6-sol` |
| MEASURED | `{ ANTHROPIC_BASE_URL: '' }` | `claude-opus-4-6` |

MEASURED: No agent spawn is necessary for this conditional resolver behavior. This is not an end-to-end session reproduction, does not validate prices, and does not answer question 5. Question 5 remains **NOT REPRODUCED**; the plain-session tile requires the running Electron product surface.

## Cost producer distinctions

MEASURED: Direct Anthropic classification is based solely on the env base URL (`libs/shared/src/lib/utils/auth-env.utils.ts:3-5`). On that branch, live result costs are authoritative SDK numbers, not a Ptah price-table recomputation: per-model `usage.costUSD` at `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:458`, total `sdkMessage.total_cost_usd` at `:538`.

MEASURED: If classified as a proxy, live result costs use the remapped ID (`stream-transformer.ts:454-467`), prefer the hydrated shared pricing map, fall back to `pricingProvider.getPricing(resolvedModel)` (`:462-464`), and compute input/output/cache costs (`:465-477`). They then sum those per-model costs (`:539-549`). Therefore the global-env defect can affect both model identity and rate selection, conditionally. It cannot establish that the observed $2.55 used a wrong rate.

MEASURED: `ModelResolver.resolveForCost` reads `findModelPricing(resolved)` (`libs/backend/auth-providers/src/lib/auth/model-resolver.ts:199`). The map starts at `DEFAULT_MODEL_PRICING` (`libs/shared/src/lib/utils/pricing.utils.ts:64,122`), takes additive runtime merges (`:135-138`), and returns null for unknown models (`:219-237`). Provider model catalog prices are added by `libs/backend/auth-providers/src/lib/provider-models.service.ts:1124-1157`. `calculateMessageCost` multiplies input/output/cache read/cache creation by their rates, returning null if unknown (`libs/shared/src/lib/utils/pricing.utils.ts:331-347`). The fallback implementation looks up exact/lowercase/provider-stripped IDs in its fetched catalog (`libs/backend/auth-providers/src/lib/providers/openrouter/openrouter-pricing.service.ts:49-62`). The actual hydrated map and chosen row during the incident are unmeasured.

MEASURED: Complete assistant events also calculate cost using the global resolver, not necessarily the actual session env: `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:380-393`; the event preserves the raw model at `:406` while putting the calculated cost at `:405`. Thus the footer cannot be pronounced universally correct from appearance alone. Its component/store and streaming-duration semantics are outside this bounded trace.

MEASURED: History stats repeat the implicit-global resolver use: `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:950` computes per-model keys/costs, `:1099` handles fallback total cost. History replay message costs similarly call `resolveForCost(msgModel)` at `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:244`; SDK subagent message replay does so at `:573`.

## Proposed smallest coherent fix and risk

INFERRED proposal: Pass the session's effective auth snapshot through `StreamTransformConfig`, starting with the existing profile in `sdk-agent-adapter.ts`, and use that snapshot for both result-model resolution and direct/proxy cost branching in `helpers/stream-transformer.ts`. Capture it for resumed/reused streams too. Preserve the existing provider-aware mapping for actual proxy sessions; removing remapping globally would break their usage attribution.

INFERRED proposal: Carry the same session context into the isolated `SdkMessageTransformer` and its `message-transform/assistant-message.transformer.ts` helper; otherwise the live result header and footer continue to price under different provider context. History needs a persisted/resolved session provider context passed into `session-history-reader.service.ts` and `helpers/history/session-replay.service.ts`. Existing history lacks that argument at the measured resolver callsites; how to recover provider identity for legacy history requires a deliberate fallback policy.

INFERRED risk: Fixing only the header badge leaves incorrect cost classification and replay results possible. Changing the global `ModelResolver` contract or bypassing remapping affects proxy sessions and every caller above. Replacing the singleton auth object itself would affect query construction and global provider switching; the narrower change is caller-scoped context. This investigation does not propose modifying usage aggregation.

## Unverified

- INFERRED: The specific observed session traversed the workspace-profile/global-proxy mismatch. Its runtime provider snapshot, current global config and raw SDK result were not inspected.
- INFERRED: The observed $2.55 used the remapped model's pricing row. Direct live SDK cost, proxy recomputation and loaded history are distinct paths; the incident path and hydrated rate data are unknown.
- INFERRED: The observed $1.44 footer was correctly costed. The complete-event and replay paths have their own global resolver dependency.
- MEASURED limitation: No running Electron/plain-Claude reproduction occurred; the synthetic resolver probe is not that reproduction.
