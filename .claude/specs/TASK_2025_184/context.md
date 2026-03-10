# TASK_2025_184: Reasoning Effort Configuration

## User Request

Add reasoning effort configuration to both the main SdkAgentAdapter and PtahCliAdapter. The Claude Agent SDK supports `thinking` (ThinkingConfig: adaptive/enabled/disabled) and `effort` (low/medium/high/max) options. Currently neither adapter passes these options.

## Task Type: FEATURE

## Complexity: Medium

## Strategy: Partial (Architect -> Team-Leader -> QA)

## Known Requirements

1. Add reasoning effort settings to session config/shared types
2. Wire `thinking` and `effort` into SdkQueryOptionsBuilder for the main agent
3. Wire the same into PtahCliAdapter for Ptah CLI agents
4. Expose the setting in the frontend (agent orchestration config or chat settings)
5. Make it configurable per-session or as a global default

## Key Files

- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` - Main agent query builder
- `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-adapter.ts` - Ptah CLI adapter
- `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` - SDK types with Options interface
- `libs/shared/src/lib/types/` - Shared types for session config
- `libs/frontend/chat/src/lib/settings/` - Frontend settings components

## SDK API Reference

```typescript
// ThinkingConfig options
thinking: { type: "adaptive" }                    // Recommended for Opus 4.6+
thinking: { type: "enabled", budgetTokens?: number }  // Fixed budget
thinking: { type: "disabled" }                    // No extended thinking

// Effort levels (works with adaptive thinking)
effort: "low" | "medium" | "high" | "max"        // Default: "high"
```

## Status

- Created: 2026-03-10
- Owner: orchestrator
