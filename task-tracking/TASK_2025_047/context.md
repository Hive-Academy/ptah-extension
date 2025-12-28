# Task Context - TASK_2025_047

## User Intent

Display token counts and costs in the chat UI. Currently, token/cost data comes with each message from Claude CLI but is not shown anywhere. Need:

1. Per-message token count and cost display
2. Session-level cost summary component

## Conversation Summary

Investigation completed. Key findings:

- Claude CLI sends `usage` field with each assistant message containing:
  - `input_tokens`, `output_tokens`
  - `cache_creation_input_tokens`, `cache_read_input_tokens`
  - `service_tier`
- Types already exist but not populated:
  - `StrictChatMessage.tokens` and `.cost`
  - `StrictChatSession.totalCost`, `.totalTokensInput`, `.totalTokensOutput`
  - `ExecutionNode.tokenUsage`
  - `ClaudeTokenUsageEvent`
- UI components already exist but not integrated:
  - `TokenBadgeComponent` (libs/frontend/chat/src/lib/components/atoms/)
  - `DurationBadgeComponent`
- Missing: extraction of usage data from JSONL, population of fields, UI integration

## Technical Context

- Branch: feature/TASK_2025_047-token-cost-display
- Created: 2025-12-06
- Type: FEATURE
- Complexity: Medium (types exist, components exist, need wiring)

## Execution Strategy

FEATURE workflow: PM → Architect → Team Leader → Frontend Developer → QA
