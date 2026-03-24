# TASK_2025_204 — Tasks

## Batch 1 (Parallel — Core Prompt Rewrites)

### Task 1A: Rewrite PTAH_CORE_SYSTEM_PROMPT

- **File**: `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`
- **Status**: COMPLETE
- **Agent**: backend-developer

### Task 1B: Restructure PTAH_SYSTEM_PROMPT

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-system-prompt.constant.ts`
- **Status**: COMPLETE
- **Agent**: backend-developer

## Batch 2 (Integration Changes)

### Task 2A: Update enhanced-prompts.service.ts

- **File**: `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`
- **Status**: COMPLETE
- **Agent**: backend-developer + orchestrator fix (PTAH_CORE duplication bug)

### Task 2B: Update sdk-query-options-builder.ts

- **File**: `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
- **Status**: COMPLETE
- **Agent**: backend-developer

### Task 2C: Update remaining files

- **Files**: enhanced-prompts.types.ts, tool-description.builder.ts, system-namespace.builders.ts, cache-invalidation.ts
- **Status**: COMPLETE
- **Agent**: backend-developer

## QA Review

- **Status**: COMPLETE
- **Agent**: code-logic-reviewer
- **Finding**: PTAH_CORE_SYSTEM_PROMPT duplication bug in buildCombinedPrompt() — FIXED by orchestrator

## All Tasks COMPLETE
