# TASK_2025_149: Prompt Harness Wizard Integration & Silent Fallback Elimination

## User Request

Fix all silent fallbacks in the setup wizard and agent generation pipeline, and properly integrate the prompt harness as a visible wizard step. Replace degraded-quality silent fallbacks with visible error reporting. Add settings UI toggle for prompt harness. Ensure production-grade error handling across all major code paths.

## Strategy

**Type**: FEATURE (with REFACTORING aspects)
**Flow**: PM -> Architect -> Team-Leader -> QA
**Complexity**: High (6+ libraries, backend + frontend, new wizard step, settings UI, error boundaries)

## Identified Issues

### Silent Fallbacks (6 locations)

1. **setup-rpc.handlers.ts:316-326** - Agentic analysis silently falls back to DeepProjectAnalysisService (zero LLM)
2. **orchestrator.service.ts:277-289** - Phase 3 LLM customization failure silently defaults to empty Map()
3. **orchestrator.service.ts:638-654** - Individual section customization failures silently fall back to empty string
4. **prompt-designer-agent.ts:209-213** - Missing LLM provider silently uses generateFallbackGuidance()
5. **prompt-designer-agent.ts:273-286** - Any LLM error returns generateFallbackGuidance()
6. **enhanced-prompts.service.ts:434-436** - Enabled but no generated prompt silently returns PTAH_CORE

### Missing Integration

- EnhancedPromptsService.runWizard() is never called from setup wizard flow
- No wizard step for "Generate Enhanced Prompt"
- No settings UI to toggle prompt harness (removed in TASK_2025_141)
- Generation pipeline (VsCodeLmService/Orchestrator Phase 3) doesn't use enhanced prompts

## Key Files

### Backend

- `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`
- `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`
- `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`
- `libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts`
- `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`
- `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer-agent.ts`
- `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`

### Frontend

- `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`
- `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`
- `libs/shared/src/lib/types/setup-wizard.types.ts`

### Shared Types

- `libs/shared/src/lib/types/setup-wizard.types.ts`

## Goals

1. Replace ALL silent fallbacks with visible error reporting (VS Code notifications + frontend error states)
2. Only keep DeepProjectAnalysisService as a HARD fallback for extreme errors (SDK completely unavailable)
3. Add prompt harness generation as a visible wizard step
4. Wire enhanced prompts into the generation pipeline (Phase 3)
5. Add settings "System Prompt Mode" selector: Ptah Enhanced vs Default Claude Code
6. Show generated prompt content as read-only preview in wizard Enhance step
7. Add prompt download (.md export) from settings
8. Add proper error boundaries with user-facing error messages
9. Write tests for all error paths

## Dependencies

- TASK_2025_135 (Prompt Harness System) - Complete
- TASK_2025_137 (Intelligent Prompt Generation) - Planned
- TASK_2025_141 (Unified Project Intelligence) - Complete
- TASK_2025_148 (Wizard Backend Generation Pipeline) - Complete

## Created

2026-02-10
