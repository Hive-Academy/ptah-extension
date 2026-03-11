# TASK_2025_151 - Wire Enhanced Prompts into Chat Sessions & Settings UI Toggle

## Task Type: FEATURE

## Strategy: PARTIAL (Architect → Team-Leader → Dev → QA)

## Complexity: MEDIUM

## User Request

Wire the Enhanced Prompts feature into the chat workflow so premium users can use their AI-generated enhanced prompt as the system prompt for all chat sessions. Add a Settings UI toggle for premium users to switch between "Ptah Enhanced" and "Default Claude Code" system prompt modes.

## Context & Background

TASK_2025_149 defined requirements R9 (System Prompt Mode Selector) and R10a (Prompt Content Preview & Download) but the chat path integration and settings UI were never implemented. The setup wizard already BUILDS the enhanced prompt (via `EnhancedPromptsService.runWizard()` → `InternalQueryService`), but the chat path doesn't USE it yet.

### Circular DI Fix (Pre-requisite - Already Done)

- `InternalQueryService` had a circular dependency with `EnhancedPromptsService`
- FIXED in this session by lazy container resolution in `internal-query.service.ts`

### Architecture Distinction (Critical Design Constraint)

- **Setup Wizard** = BUILDS the enhanced prompt (EnhancedPromptsService → InternalQueryService → SDK)
- **Chat Sessions** = USES the stored prompt (just pass string to SdkQueryOptionsBuilder)
- No need for `EnhancedPromptsService` in the chat DI chain — just read the stored string and pass it through

## Key Findings from Investigation

### Chat Path Gap

- `SdkQueryOptionsBuilder` already has `enhancedPromptsContent?: string` in `QueryOptionsInput` (line 157)
- `buildSystemPrompt()` already handles it (line 397) — appends to system prompt or falls back to PTAH_CORE
- BUT `SessionLifecycleManager.executeQuery()` never passes it (lines 488-497)
- The caller (`SdkAgentAdapter`) needs to resolve the stored prompt string and pass it through `ExecuteQueryConfig`

### Settings UI Gap

- Settings page has Pro Features section (lines 411-484) with MCP Port and LLM Keys
- Missing: "System Prompt Mode" section per R9
- RPC handlers already exist: `enhancedPrompts:getStatus`, `enhancedPrompts:setEnabled`, `enhancedPrompts:regenerate`, `enhancedPrompts:getPromptContent`, `enhancedPrompts:download`

## Requirements (from TASK_2025_149)

### R9: System Prompt Mode Selector

1. Settings UI for premium users: two modes — "Ptah Enhanced" vs "Default Claude Code"
2. "Ptah Enhanced" → `EnhancedPromptsService.setEnabled(true)` → sessions use generated prompt (or PTAH_CORE if not generated)
3. "Default Claude Code" → `EnhancedPromptsService.setEnabled(false)` → vanilla claude_code preset
4. When "Ptah Enhanced" active: show status, timestamp, detected stack, "Regenerate" button
5. When "Default Claude Code" active: brief description
6. Stale cache warning, non-premium upsell, immediate effect on next session

### R10a: Prompt Content Preview & Download

1. "View Generated Prompt" expandable section with read-only markdown preview
2. "Download Prompt" button saves .md via VS Code save dialog
3. Hidden when no prompt generated

## Files Identified

### Backend (Chat Path Wiring)

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — Add `enhancedPromptsContent?: string` to `ExecuteQueryConfig`, pass to builder
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — Resolve enhanced prompt content before `executeQuery()`, pass as string

### Frontend (Settings UI)

- `libs/frontend/chat/src/lib/settings/settings.component.ts` — Add state, RPC methods, computed signals
- `libs/frontend/chat/src/lib/settings/settings.component.html` — Add "System Prompt Mode" card

### Existing Infrastructure (No Changes Needed)

- `enhanced-prompts-rpc.handlers.ts` — RPC handlers already registered
- `sdk-query-options-builder.ts` — Already handles `enhancedPromptsContent` parameter
- `enhanced-prompts.service.ts` — Already has getStatus, setEnabled, getEnhancedPromptContent, regenerate

## Related Tasks

- TASK_2025_149 (parent requirements — R9, R10a)
- TASK_2025_137 (Intelligent Prompt Generation System)
- TASK_2025_135 (Prompt Harness System)
- TASK_2025_108 (Premium Feature Enforcement)
