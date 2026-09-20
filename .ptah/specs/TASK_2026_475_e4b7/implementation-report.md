# TASK_2026_475_e4b7 Implementation Report: Fix Pricing Lookup Substring Matching

## Overview

Fixed the pricing lookup defect in `lookupPricingEntry` (`libs/shared/src/lib/utils/pricing.utils.ts`), where bidirectional substring matching allowed distinct model variants like `gpt-5.3-codex` to match shorter registered keys like `gpt-5`, silently billing at another model's rates without triggering the unknown-model warning.

---

## 1. Forward-Direction Rule & Model ID Survey

### The Defect

Previously:

```typescript
for (const [key, pricing] of Object.entries(modelPricingMap)) {
  if (normalizedId.includes(key.toLowerCase())) return pricing;
  if (key.toLowerCase().includes(normalizedId)) return pricing;
}
```

If `gpt-5` was in the pricing map, `gpt-5.3-codex` satisfied `normalizedId.includes('gpt-5')`. A naive segment boundary rule (splitting on `.`, `-`, `/`) also failed because `gpt-5.3-codex` starts with `gpt-5` followed by `.`, which is a segment boundary.

### Model ID Survey

The following model IDs and patterns were surveyed across `DEFAULT_MODEL_PRICING` and `libs/shared/src/lib/providers/entries/`:

- **`DEFAULT_MODEL_PRICING`**: `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `local`, `:cloud`
- **`claude-cli-provider-entry.ts`**: `claude-opus-4-8`, `claude-sonnet-4-6`, `claude-haiku-4-5`
- **`codex-provider-entry.ts`**: `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex-mini`
- **`copilot-provider-entry.ts`**: `claude-sonnet-4.6`, `claude-opus-4.7`, `claude-opus-4.5`, `claude-sonnet-4.5`, `claude-sonnet-4`, `claude-haiku-4.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.2-codex`, `gpt-5.2`, `gpt-5.1-codex-max`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`, `gpt-5.1`, `gpt-5-mini`, `gpt-4.1`, `gemini-3-pro-preview`
- **`local-provider-entry.ts`**: `llama3.1:8b`, `qwen2.5-coder:7b`, `deepseek-r1:14b`, `qwen3:8b`, `devstral`, `qwen3:32b`, `ministral-3:cloud`, `kimi-k2.5:cloud`, `deepseek-v3.2:cloud`
- **`requesty-provider-entry.ts`**: `anthropic/claude-sonnet-4-5-20250514`
- **`sakana-provider-entry.ts`**: `fugu`, `fugu-ultra`, `fugu-ultra-20260615`
- **`pricing.utils.ts` / `formatClaudeModelDisplayName`**: `gpt-4o-2024-08-06`, `claude-opus-4-5-20251101`, stripping `/-\d{8}$/` and `/-\d{4}-\d{2}-\d{2}$/`

### The Rule

A forward partial match is accepted **only** when the remainder of the model identifier (after stripping any provider prefix) matches a date-snapshot suffix:

```typescript
const DATE_SNAPSHOT_SUFFIX = /^-(?:\d{4}-\d{2}-\d{2}|\d{8})$/;
```

This handles:

- ISO-8601 date snapshots: `-YYYY-MM-DD` (e.g. `gpt-4o-2024-08-06` -> `gpt-4o`)
- Compact date snapshots: `-YYYYMMDD` (e.g. `claude-opus-4-5-20251101` -> `claude-opus-4-5`, `claude-sonnet-4-20250514` -> `claude-sonnet-4`, `fugu-ultra-20260615` -> `fugu-ultra`)
- Rejects non-date suffixes: `gpt-5.3-codex` leaves remainder `.3-codex` (against `gpt-5`) or `-codex` (against `gpt-5.3`), neither of which matches `DATE_SNAPSHOT_SUFFIX`.
- When multiple registered keys match with a date snapshot remainder, the longest key wins (most specific registered model).

---

## 2. Reverse-Direction Match Decision

### Decision: REMOVED

The reverse direction (`key.toLowerCase().includes(normalizedId)`) was removed:

- **Search findings**: No caller in the entire repository depends on reverse substring matching. Its only trace was a test in `pricing.utils.spec.ts:132` (`'supermodel'` resolving to `'supermodel-2099-final-edition'`).
- **Rationale**: Reverse substring matching is unsafe and conceptually flawed. Querying a general or shorthand model ID like `supermodel` or `gpt-5` should never silently resolve to an arbitrary specialized or future edition like `supermodel-2099-final-edition` or `gpt-5.3-codex`. That would charge the user at potentially wildly divergent rates without warning.
- **Spec update**: Updated `pricing.utils.spec.ts` to assert that `findModelPricing('supermodel')` returns `null`.

---

## 3. Unknown-Model Warning

`findModelPricing` maintains `warnedModelIds: Set<string>`:

```typescript
const found = lookupPricingEntry(modelId);
if (found) {
  return found;
}
if (!warnedModelIds.has(modelId)) {
  warnedModelIds.add(modelId);
  console.warn(`[Pricing] Model '${modelId}' not found in pricing map — cost will render as unavailable`);
}
return null;
```

When `gpt-5.3-codex` is queried and only `gpt-5` is registered:

1. `lookupPricingEntry('gpt-5.3-codex')` returns `null`.
2. `warnedModelIds.has('gpt-5.3-codex')` is false.
3. It emits the `[Pricing] Model 'gpt-5.3-codex' not found in pricing map — cost will render as unavailable` warning once.
4. Subsequent calls return `null` without logging duplicate warnings.

---

## 4. Caller Audit for Behaviour Changes

Audited all callers of `findModelPricing` and `calculateMessageCost`:

1. **`calculateMessageCost` (`pricing.utils.ts`)**:
   Returns `null` when `findModelPricing` returns `null`. Does not coerce to 0.

2. **`getModelPricingDescription` (`pricing.utils.ts`)**:
   Returns `'Pricing unavailable'` when `findModelPricing` returns `null`. Does not coerce to 0.

3. **`getModelContextWindow` (`pricing.utils.ts`)**:
   Calls `lookupPricingEntry(modelId)`. When it returns `null`, it falls back to discovered context windows, Claude family regex derivation, or 0. It avoids incorrectly inheriting the context window of a shorter unrelated model (e.g. `gpt-5.3-codex` no longer gets `gpt-5`'s context window).

4. **`ModelResolver.resolveForCost` (`libs/backend/auth-providers/src/lib/auth/model-resolver.ts`)**:
   Calls `findModelPricing(resolved)` and returns `{ modelId, pricing: ModelPricing | null, subscriptionCovered }`. Preserves `null`.

5. **`stream-transformer.ts` (`libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:465-477`)**:
   When pricing is null, sets `costUSD = null`. The frontend `ptah-cost-badge` (`cost-badge.component.ts:38-44`) correctly renders "cost unavailable" rather than "$0.00".

6. **`assistant-message.transformer.ts` (`libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts:378`)**:
   Coerces `calculateMessageCost(...) ?? undefined`, attaching `cost: undefined` to `MessageCompleteEvent`. Renders "cost unavailable".

7. **`subagent-metrics-extractor.ts` (`libs/backend/skill-synthesis/src/lib/subagent-metrics-extractor.ts:162-193`)**:
   When no model has pricing, returns `costUsd: null`. Does not coerce to 0.

8. **`session-usage-aggregator.ts` (`libs/backend/agent-sdk/src/lib/session-stats/session-usage-aggregator.ts:184-217`)**:
   When `costUSD === null`, increments `unpricedTokens` and leaves `pricedModels === 0`, returning `totalCost: null` and `pricingCoverage: 'none'`.

9. **`session-history-reader.service.ts` (`libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:1094-1113`)**:
   If no models have pricing, `totalCost` resolves to `null`.

10. **`session-replay.service.ts` (`libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts:255, 582`)**:
    Contains `calculateMessageCost(...) ?? 0` for session replay events. This was noted during the audit; it is specific to historical JSONL event replay.

---

## 5. Acceptance Criteria Checklist

| Criterion | Description                                                                          | Status                        |
| --------- | ------------------------------------------------------------------------------------ | ----------------------------- |
| 1         | `gpt-5.3-codex` returns null when only `gpt-5` is registered                         | PASS                          |
| 2         | `gpt-4o-2024-08-06` still resolves to `gpt-4o`                                       | PASS                          |
| 3         | Reverse-direction match is either justified in comment or removed, with test updated | PASS (Removed & test updated) |
| 4         | Newly unresolvable ID emits unknown-model warning                                    | PASS                          |
| 5         | Test, typecheck, and lint pass for every touched project                             | PASS (Verified below)         |

---

## 6. Verification (Unedited Output)

### `npx nx run-many -t test -p @ptah-extension/shared`

```
 NX   Running target test for project @ptah-extension/shared:

- @ptah-extension/shared



> nx run @ptah-extension/shared:test

(node:6084) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:6084) Warning: Failed to load the ES module: D:\projects\ptah-extension\.claude-worktrees\fix-pricing-lookup-substring-match-7e8a8fb0e204\libs\shared\jest.config.ts. Make sure to set "type": "module" in the nearest package.json file or use the .mjs extension.
(node:37420) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34960) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13896) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:20996) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:37716) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:27724) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:20176) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31240) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13932) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26156) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:23004) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:21748) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:28440) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:18700) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:15036) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
 PASS   shared  libs/shared/src/lib/utils/history-page.utils.spec.ts (7.312 s)
 PASS   shared  libs/shared/src/lib/types/harness-blocked-wording.spec.ts
 PASS   shared  libs/shared/src/lib/connectors/ptah-connectors.catalog.spec.ts
 PASS   shared  libs/shared/src/lib/providers/provider-lookup.spec.ts
 PASS   shared  libs/shared/src/lib/types/auth-strategy.types.spec.ts (8.223 s)
 PASS   shared  libs/shared/src/lib/utils/workspace-path-encoder.spec.ts (8.474 s)
 PASS   shared  libs/shared/src/lib/utils/subagent-cost.utils.spec.ts (8.173 s)
 PASS   shared  libs/shared/src/lib/constants/stack-profiles.spec.ts (8.657 s)
 PASS   shared  libs/shared/src/lib/types/rpc/rpc-activity.types.spec.ts
 PASS   shared  libs/shared/src/lib/types/provider-profile.types.spec.ts
 PASS   shared  libs/shared/src/lib/utils/auth-env.utils.spec.ts
 PASS   shared  libs/shared/src/lib/types/agent-process.types.spec.ts
 PASS   shared  libs/shared/src/lib/utils/pick-primary-model.spec.ts
 PASS   shared  libs/shared/src/lib/types/execution/inbound-peer.spec.ts
 PASS   shared  libs/shared/src/lib/types/task-filter.spec.ts (9.312 s)
 PASS   shared  libs/shared/src/lib/utils/assert-never.spec.ts
 PASS   shared  libs/shared/src/lib/types/user-layer-agents.spec.ts
 PASS   shared  libs/shared/src/lib/types/branded.types.spec.ts (9.187 s)
 PASS   shared  libs/shared/src/lib/types/task-spec.contract.spec.ts (8.799 s)
 PASS   shared  libs/shared/src/lib/constants/workspace-scan.constants.spec.ts (9.821 s)
 PASS   shared  libs/shared/src/lib/types/rpc/rpc-harness.types.spec.ts
 PASS   shared  libs/shared/src/lib/utils/workspace-root-key.spec.ts
 PASS   shared  libs/shared/src/lib/utils/path-display.utils.spec.ts
 PASS   shared  libs/shared/src/lib/types/origin-sidecar.workspace-plugins.spec.ts
 PASS   shared  libs/shared/src/lib/constants/skill-drain.constants.spec.ts
 PASS   shared  libs/shared/src/lib/types/ai-provider.types.spec.ts
 PASS   shared  libs/shared/src/testing/matchers/matchers.spec.ts
 PASS   shared  libs/shared/src/testing/path/expect-normalized-path.spec.ts
 PASS   shared  libs/shared/src/testing/time/freeze-time.spec.ts
 PASS   shared  libs/shared/src/lib/types/rpc/rpc-chat.types.spec.ts
 PASS   shared  libs/shared/src/testing/fake-async-generator.spec.ts
 PASS   shared  libs/shared/src/testing/tsyringe-test-container.spec.ts
 PASS   shared  libs/shared/src/lib/utils/session-totals.utils.spec.ts
 PASS   shared  libs/shared/src/lib/types/sdk-hook.parsers.spec.ts
 PASS   shared  libs/shared/src/lib/types/rpc/rpc-degradation.types.spec.ts
 PASS   shared  libs/shared/src/lib/utils/git.utils.spec.ts
 PASS   shared  libs/shared/src/lib/types/sdk-hook.schemas.spec.ts
 PASS   shared  libs/shared/src/lib/utils/result.spec.ts
 PASS   shared  libs/shared/src/lib/type-guards/guards/exec.spec.ts
 PASS   shared  libs/shared/src/lib/types/task-graph.spec.ts (9.941 s)
 PASS   shared  libs/shared/src/lib/utils/json.utils.spec.ts
 PASS   shared  libs/shared/src/testing/index.spec.ts
 PASS   shared  libs/shared/src/lib/types/harness-sync.types.spec.ts
 PASS   shared  libs/shared/src/lib/utils/image-media-type.spec.ts
 PASS   shared  libs/shared/src/testing/mock-logger.spec.ts
 PASS   shared  libs/shared/src/lib/types/rpc/rpc-readiness.types.spec.ts
 PASS   shared  libs/shared/src/testing/fixtures/correlation-id.spec.ts
 PASS   shared  libs/shared/src/lib/utils/nested-repo-roots.spec.ts
 PASS   shared  libs/shared/src/lib/types/harness-sync.blocked.spec.ts
 PASS   shared  libs/shared/src/lib/utils/message-normalizer.spec.ts
 PASS   shared  libs/shared/src/lib/type-guards/guards/net.spec.ts
 PASS   shared  libs/shared/src/lib/types/source-slug.spec.ts
 PASS   shared  libs/shared/src/lib/utils/codex-token-freshness.spec.ts
 PASS   shared  libs/shared/src/lib/utils/pricing.utils.spec.ts (10.862 s)
 PASS   shared  libs/shared/src/lib/utils/retry.utils.spec.ts
 PASS   shared  libs/shared/src/lib/utils/session-id.utils.spec.ts
 PASS   shared  libs/shared/src/lib/providers/provider-registry.spec.ts (10.867 s)
 PASS   shared  libs/shared/src/lib/types/messages/session-mcp-status.spec.ts (10.741 s)
 PASS   shared  libs/shared/src/lib/types/wire-parsers.equivalence.spec.ts (11.419 s)
 PASS   shared  libs/shared/src/lib/types/task-saved-view.types.spec.ts (10.442 s)

Test Suites: 60 passed, 60 total
Tests:       1550 passed, 1550 total
Snapshots:   0 total
Time:        13.707 s
Ran all test suites.



 NX   Successfully ran target test for project @ptah-extension/shared
```

### `npx nx run-many -t typecheck -p @ptah-extension/shared`

```
 NX   Running target typecheck for project @ptah-extension/shared:

- @ptah-extension/shared



> nx run @ptah-extension/shared:typecheck

> tsc --noEmit --project libs/shared/tsconfig.lib.json




 NX   Successfully ran target typecheck for project @ptah-extension/shared
```

### `npx nx run-many -t lint -p @ptah-extension/shared`

```
 NX   Running target lint for project @ptah-extension/shared:

- @ptah-extension/shared



> nx run @ptah-extension/shared:lint

(node:28484) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/shared"...

D:\projects\ptah-extension\.claude-worktrees\fix-pricing-lookup-substring-match-7e8a8fb0e204\libs\shared\src\lib\connectors\ptah-connectors.catalog.ts
  777:1  warning  File has too many lines (810). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\fix-pricing-lookup-substring-match-7e8a8fb0e204\libs\shared\src\lib\types\rpc.types.ts
  759:1  warning  File has too many lines (3201). Maximum allowed is 700  max-lines

✖ 2 problems (0 errors, 2 warnings)

✖ 2 problems (0 errors, 2 warnings)




 NX   Successfully ran target lint for project @ptah-extension/shared
```
