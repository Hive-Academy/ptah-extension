# TASK_2025_164: Encapsulate AuthEnv - Eliminate Global process.env Mutation

## Strategy: REFACTORING

## Flow: Architect → Team-Leader → Developers → QA

## Status: In Progress

## User Intent

Refactor AuthManager and ProviderModelsService to return an AuthEnv value object instead of mutating `process.env` globally. Update all consumers (SdkQueryOptionsBuilder, helper functions) to accept AuthEnv as a parameter. Zero behavior change — better isolation for SDK environment configuration.

This is preparation for a follow-up task (Custom Agent Adapter) that will create isolated agent instances with different provider configs running simultaneously.

## Problem Statement

Currently 8 places mutate `process.env` globally:

- AuthManager: 6 mutations (ANTHROPIC_BASE_URL, AUTH_TOKEN, API_KEY, OAUTH_TOKEN)
- ProviderModelsService: 2 mutations (tier env vars via setModelTier, applyPersistedTiers)

And 3 places read `process.env` directly instead of taking env as parameter:

- SdkQueryOptionsBuilder line 358: `env: process.env as Record<...>`
- buildModelIdentityPrompt() lines 73-76: reads ANTHROPIC*DEFAULT*\*\_MODEL
- resolveActualModelForPricing() lines 374-393: reads ANTHROPIC_BASE_URL + tier vars

## AuthEnv Type (7 variables)

```typescript
interface AuthEnv {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  ANTHROPIC_AUTH_TOKEN?: string;
  CLAUDE_CODE_OAUTH_TOKEN?: string;
  ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
  ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
  ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
}
```

## Key Files

1. `libs/backend/agent-sdk/src/lib/helpers/auth-manager.ts` - Return AuthEnv instead of mutating process.env
2. `libs/backend/agent-sdk/src/lib/provider-models.service.ts` - Populate AuthEnv instead of mutating process.env
3. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` - Accept AuthEnv, merge with process.env
4. `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts` - resolveActualModelForPricing() takes env param
5. `libs/shared/src/lib/types/` - Add AuthEnv type definition
6. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` - Stores AuthEnv, passes to builder
7. Consumers of resolveActualModelForPricing() - Pass env

## Constraints

- Zero behavior change (pure refactoring)
- AuthEnv type in @ptah-extension/shared (foundation layer)
- Backward compatibility: no breaking changes to public APIs
- Must pass existing typecheck for all affected projects
