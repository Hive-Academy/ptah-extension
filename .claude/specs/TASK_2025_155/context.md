# TASK_2025_155: LLM Provider Overhaul - Remove Langchain, Native SDKs, Image Generation

## Strategy: REFACTORING

## Status: Team-Leader Decomposition

## Created: 2026-02-18

## User Request

Execute the LLM Provider Overhaul plan (v2) from `task-tracking/llm-provider-overhaul-plan.md`. Key requirements:

1. Remove ALL Langchain packages (6 total)
2. Rewrite Google provider with `@google/genai` (text + image)
3. Rewrite OpenAI provider with native `openai` SDK
4. Fix wizard hardcoded model (`gpt-4o` in VsCodeLmService)
5. Settings UI for API key management (BYOK first)
6. Image generation MCP tool (`ptah_generate_image`)
7. OAuth subscription auth (Phase 5 - follow-up)
8. Intelligent MCP routing (Phase 8 - follow-up)

## Implementation Plan

See: `task-tracking/llm-provider-overhaul-plan.md` (comprehensive 8-phase plan)

## Key Decision

- Phases 1-4, 6-7: Implement now
- Phase 5 (OAuth): Deferred to follow-up task
- Phase 8 (intelligent routing): Deferred to follow-up task

## Affected Libraries

- `libs/backend/llm-abstraction/` - Major rewrite (providers, registry, types, secrets)
- `libs/backend/vscode-lm-tools/` - New MCP tool + namespace
- `libs/backend/vscode-core/` - RPC handler updates
- `libs/backend/agent-generation/` - Fix hardcoded model
- `libs/frontend/chat/` - New settings component
- `libs/frontend/core/` - New state service
- `libs/shared/` - Updated RPC types
- `apps/ptah-extension-vscode/` - DI wiring
