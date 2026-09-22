# Catalog Batch Report — TASK_2026_526

## Changes

| File | Change | File:line |
| --- | --- | --- |
| `libs/shared/src/lib/providers/entries/opencode-model-routes.ts` | Created pure scoped route map (`(subscription, modelId)`), protocol/ID types, and own-property lookup functions (`isOpenCodeProviderId`, `getOpenCodeModelProtocol`). | `libs/shared/src/lib/providers/entries/opencode-model-routes.ts:1` |
| `libs/shared/src/lib/providers/entries/opencode-provider-entry.ts` | Created `OPENCODE_ZEN_PROVIDER_ENTRY` and `OPENCODE_GO_PROVIDER_ENTRY`, default tier mappings (`OPENCODE_ZEN_DEFAULT_TIERS`, `OPENCODE_GO_DEFAULT_TIERS`), and route-derived static models. | `libs/shared/src/lib/providers/entries/opencode-provider-entry.ts:1` |
| `libs/shared/src/lib/providers/entries/opencode-provider-entry.spec.ts` | Created comprehensive unit test suite covering protocol routing, cross-subscription collisions (e.g. `minimax-m3`), 9 excluded models, static models, default tiers, registry integration, and pricing guard. | `libs/shared/src/lib/providers/entries/opencode-provider-entry.spec.ts:1` |
| `libs/shared/src/lib/providers/provider-registry.ts` | Imported and registered `OPENCODE_ZEN_PROVIDER_ENTRY` and `OPENCODE_GO_PROVIDER_ENTRY` into `ANTHROPIC_PROVIDERS`; extended `AnthropicProviderId` union with `'opencode-zen' | 'opencode-go'`. | `libs/shared/src/lib/providers/provider-registry.ts:34`, `:476`, `:493` |
| `libs/shared/src/lib/providers/index.ts` | Exported entries, tiers, route table, types, and lookup functions from shared providers barrel. | `libs/shared/src/lib/providers/index.ts:33` |

## Coverage

Model counts encoded per subscription per protocol (matching `research-report.md`):

### OpenCode Zen (`https://opencode.ai/zen/v1`, usage-billed)
- `/messages` (Anthropic Messages): **16**
  - `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-opus-4-5`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5`, `qwen3.8-flash`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`, `qwen3.5-plus`
- `/chat/completions` (OpenAI Chat): **22**
  - `deepseek-v4.1-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `glm-5.3-flash`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `glm-5`, `kimi-k2.5`, `kimi-k2.6`, `kimi-k2.7-code`, `kimi-k3`, `big-pickle`, `mimo-v2.6-flash-free`, `mimo-v2.5-free`, `ling-3.0-flash-fin-free`, `nemotron-3-ultra-free`, `nemotron-3.5-lightning-free`
- `/responses` (OpenAI Responses): **28**
  - `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.4`, `gpt-5.4-pro`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`, `gpt-5`, `gpt-5-codex`, `gpt-5-nano`, `grok-4.7`, `grok-4.6`, `grok-4.5`, `grok-build-0.1`, `muse-spark-1.3`, `muse-spark-1.2`, `muse-spark-1.3-contributor-free`
- **Total Zen Models**: **66**

### OpenCode Go (`https://opencode.ai/zen/go/v1`, $10/mo subscription)
- `/messages` (Anthropic Messages): **8**
  - `minimax-m3`, `minimax-m2.7`, `minimax-m2.5`, `qwen3.8-max`, `qwen3.8-flash`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`
- `/chat/completions` (OpenAI Chat): **18**
  - `glm-5.3-flash`, `glm-5.3`, `glm-5.2`, `glm-5.1`, `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `longcat-2.0`, `deepseek-v4.1-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `deepseek-v4-flash-vision-exp`, `mimo-v2.6-flash`, `mimo-v2.6-pro`, `mimo-v2.5`, `mimo-v2.5-pro`, `hy4-preview`, `hy3`
- `/responses` (OpenAI Responses): **5**
  - `grok-4.7`, `grok-4.6`, `gpt-5.6-luna`, `muse-spark-1.3-contributor`, `muse-spark-1.2-contributor`
- **Total Go Models**: **31**

### Total Across Both Subscriptions
- **97 total models** (66 Zen + 31 Go)

### Deliberately Excluded Models (9 IDs, absent from all tables, static models, and default tiers)
- Google generateContent (7): `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-pro`, `gemini-3-flash`
- Jev systemone (2): `jev-1.13`, `jev-1.13-free`

## Verification

### 1. `npx nx typecheck @ptah-extension/shared`
```
> nx run @ptah-extension/shared:typecheck

> tsc --noEmit --project libs/shared/tsconfig.lib.json

 NX   Successfully ran target typecheck for project @ptah-extension/shared
```

### 2. `npx nx lint @ptah-extension/shared`
```
> nx run @ptah-extension/shared:lint

Linting "@ptah-extension/shared"...
✖ 3 problems (0 errors, 3 warnings)

 NX   Successfully ran target lint for project @ptah-extension/shared
```
*(All 3 warnings are pre-existing in untouched files `ptah-connectors.catalog.ts`, `rpc.types.ts`, and `json.utils.ts`)*

### 3. Colocated and Provider Unit Tests
```
> nx run @ptah-extension/shared:test --testFile=opencode-provider-entry.spec.ts
PASS shared libs/shared/src/lib/providers/entries/opencode-provider-entry.spec.ts (34 passed, 34 total)

> nx run @ptah-extension/shared:test --testFile=provider-
PASS shared libs/shared/src/lib/providers/entries/opencode-provider-entry.spec.ts
PASS shared libs/shared/src/lib/providers/provider-lookup.spec.ts
PASS shared libs/shared/src/lib/providers/provider-registry.spec.ts
PASS shared libs/shared/src/lib/types/provider-profile.types.spec.ts
Test Suites: 4 passed, 4 total
Tests:       102 passed, 102 total
```

### 4. Full Shared Test Suite `npx nx test @ptah-extension/shared`
```
Summary of all failing tests
FAIL src/lib/types/auth-strategy.types.spec.ts
  ● resolveStrategy — live ANTHROPIC_PROVIDERS registry › covers every provider in the registry (no unrouted entries)
  ● resolveStrategy — live ANTHROPIC_PROVIDERS registry › the API-key provider set is exactly {openrouter, moonshot, z-ai, sakana, requesty} — regression guard for acceptance criterion 2
Test Suites: 1 failed, 60 passed, 61 total
Tests:       2 failed, 1613 passed, 1615 total
```

## Not done

- `libs/shared/src/lib/types/auth-strategy.types.spec.ts` was not modified because it is outside the authorized Catalog file ownership ("Files you may touch — nothing else") and governed by the boundary rule ("Do not edit files outside your batch's ownership, even to fix something you noticed. Report it instead"). That test contains a hardcoded list of 11 provider IDs pinning the previous state of `ANTHROPIC_PROVIDERS`. Adding `opencode-zen` and `opencode-go` causes its exhaustiveness assertion to fail. Updating `EXPECTED_ROUTE_BY_PROVIDER_ID` and `apiKeyRouted` in `auth-strategy.types.spec.ts` belongs to the Registration or coordinating batch.
- None otherwise.
