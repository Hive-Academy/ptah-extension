# TASK_2025_167: Custom Agent Adapter - Isolated SDK Provider Support

## Strategy: FEATURE (Partial - Architect → Team-Leader → QA)

## Flow: Architect → Team-Leader → Developers → QA

## Status: In Progress

## User Intent

Create a new agent adapter that uses the Claude Agent SDK `query()` function with its own isolated AuthEnv, enabling independent provider configurations (Moonshot, Z.AI, OpenRouter) that run completely separately from the main SDK setup.

This builds on TASK_2025_164 (AuthEnv encapsulation). The adapter should:

1. Accept provider-specific config (base URL, API key/token)
2. Create its own AuthEnv instance (not the DI singleton)
3. Pass it to SDK `query()` via the `env` parameter
4. Appear in the agent orchestration as a selectable provider alongside the main Claude SDK

## Key Constraint

The main agent SDK's OAuth/API key setup must remain completely unaffected. Each custom provider agent operates with full isolation.

## Prior Research (from previous session)

- SDK `query()` function accepts `env: Record<string, string | undefined>` — the only mechanism for provider config
- Each `query()` call spawns an independent subprocess with its own environment
- Three Anthropic-compatible providers already catalogued: OpenRouter, Moonshot (Kimi), Z.AI
- Provider registry exists at `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts`
- TASK_2025_164 introduced AuthEnv type and DI singleton pattern — the merge point `{ ...process.env, ...authEnv }` proves the env isolation mechanism works

## Dependencies

- TASK_2025_164 (AuthEnv encapsulation) — COMPLETE (committed as 5f37632c)

## Key Files (from research)

1. `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — Main IAIProvider implementation to reference
2. `libs/backend/agent-sdk/src/lib/helpers/anthropic-provider-registry.ts` — Provider registry with Moonshot, Z.AI, OpenRouter
3. `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` — Query options with env merge
4. `libs/shared/src/lib/types/auth-env.types.ts` — AuthEnv type definition
5. `libs/backend/agent-sdk/src/lib/di/tokens.ts` — DI tokens
6. Existing CLI adapters: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/` — Pattern reference
