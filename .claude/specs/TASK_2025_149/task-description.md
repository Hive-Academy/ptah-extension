# Requirements Document - TASK_2025_149

## Prompt Harness Wizard Integration & Silent Fallback Elimination

### Title & Summary

This task eliminates six identified silent fallback code paths across the setup wizard and agent generation pipeline, integrates the existing prompt harness system as a visible wizard step, re-adds a settings UI toggle for prompt harness configuration (removed in TASK_2025_141), and wires enhanced prompts into the Phase 3 generation pipeline. The scope covers backend error handling replacement across `setup-rpc.handlers.ts`, `orchestrator.service.ts`, `prompt-designer-agent.ts`, and `enhanced-prompts.service.ts`; a new "Prompt Enhancement" wizard step between Selection and Generation; a settings UI toggle for enhanced prompts; integration of enhanced prompts into the orchestrator's Phase 3 LLM customization; and comprehensive test coverage for all error paths. The goal is production-grade error visibility -- users must know when degraded-quality results are being used, and must be able to opt into or out of enhanced prompt generation.

---

## Background & Problem Statement

### Why This Matters

The current codebase has six locations where failures are silently swallowed, producing degraded-quality output without any user visibility. When agentic analysis fails, the system falls back to zero-LLM `DeepProjectAnalysisService` without telling the user. When LLM customization fails in Phase 3, agents get empty content instead of customized sections. When the prompt designer agent has no LLM provider or encounters an LLM error, it returns generic fallback guidance indistinguishable from real LLM output. When enhanced prompts are enabled but no generated prompt exists, it silently returns `PTAH_CORE_SYSTEM_PROMPT`.

These silent fallbacks create a situation where:

1. **Users believe they received full-quality output** when they actually received degraded results
2. **Debugging is extremely difficult** because failures leave no visible trace in the UI
3. **Premium features appear to work** when they silently degrade to free-tier quality
4. **The prompt harness system (TASK_2025_135/137) is fully implemented but never called** from the setup wizard, meaning users cannot access this premium feature through the intended workflow

Additionally, the settings UI toggle for prompt harness was removed during TASK_2025_141 and needs to be re-added so users can control whether enhanced prompts are active.

### Current State

- **EnhancedPromptsService.runWizard()** is fully implemented in `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` but never called from the setup wizard flow
- **SetupWizardStateService** already has enhanced prompts state signals (`enhancedPromptsStatus`, `enhancedPromptsError`, `enhancedPromptsDetectedStack`) and mutation methods, indicating the frontend was partially prepared for this integration
- **The wizard step stepper** in `wizard-view.component.ts` currently has 6 steps: Welcome, Scan, Analysis, Select, Generate, Complete
- **SkillGenerationProgressItem.type** already includes `'enhanced-prompt'` as a valid type, confirming this was planned

---

## Scope

### In Scope

1. **Silent Fallback Elimination** -- Replace all 6 identified silent fallbacks with visible error reporting
2. **Wizard Step Addition** -- Add "Prompt Enhancement" step between Selection and Generation
3. **Settings UI Toggle** -- Re-add a settings toggle for enabling/disabling enhanced prompts
4. **Generation Pipeline Integration** -- Wire enhanced prompts into the orchestrator Phase 3 system prompt
5. **RPC Handlers** -- Add new RPC handler for `wizard:generate-enhanced-prompt`
6. **Frontend Components** -- New prompt enhancement step component with progress visualization
7. **Error Handling Tests** -- Test coverage for all replaced silent fallback paths
8. **Shared Types** -- Add any new message types or payload types needed

### Out of Scope

1. **Prompt Harness Core Logic** -- The `EnhancedPromptsService`, `PromptDesignerAgent`, and `PromptCacheService` are already implemented (TASK_2025_135/137); we only wire them in
2. **Agentic Analysis Refactoring** -- The `AgenticAnalysisService` itself stays unchanged; we only change how its fallback is surfaced
3. **New LLM Provider Support** -- No new providers; we use existing `llm-abstraction` and `VsCodeLmService`
4. **Landing Page or Marketing Changes** -- No external-facing marketing changes
5. **License Server Changes** -- No backend server changes; premium gating logic already exists
6. **Wizard UI Redesign** -- No visual redesign beyond adding the new step and error states

---

## Requirements

### Category 1: Error Handling -- Silent Fallback Replacement

#### R1: Agentic Analysis Fallback Visibility

**User Story:** As a premium user running the setup wizard, I want to be clearly informed when the agentic (LLM-powered) analysis fails and the system falls back to quick analysis, so that I understand the quality level of my project analysis.

**Current State (setup-rpc.handlers.ts:316-326):** When `AgenticAnalysisService.analyzeWorkspace()` fails or returns error, the system logs a warning and silently falls back to `DeepProjectAnalysisService.performDeepAnalysis()`. The frontend receives no indication that fallback occurred.

**Acceptance Criteria:**

1. WHEN agentic analysis fails THEN the backend SHALL broadcast a `setup-wizard:error` message with type `'fallback-warning'` and a human-readable explanation: "AI-powered analysis unavailable. Using quick analysis mode -- results may be less detailed."
2. WHEN the fallback activates THEN the `ScanProgressComponent` SHALL display a visible warning alert (DaisyUI `alert-warning`) indicating degraded analysis mode
3. WHEN the fallback analysis also fails THEN the system SHALL throw an error that surfaces in the wizard error state (not silently degrade further)
4. WHEN agentic analysis succeeds THEN no fallback warning SHALL be shown (baseline behavior unchanged)

#### R2: Phase 3 LLM Customization Failure Visibility

**User Story:** As a user generating agents, I want to know when LLM customization fails and generic content is being used, so that I can decide whether to retry or accept the generic output.

**Current State (orchestrator.service.ts:277-289):** When Phase 3 LLM customization fails entirely, the orchestrator logs a warning, adds to `warnings[]` array, but uses `new Map()` as empty customizations. The user sees agents generated with generic content but no indication of quality degradation.

**Acceptance Criteria:**

1. WHEN Phase 3 customization fails completely THEN the generation progress broadcast SHALL include a `warnings` field with the failure reason
2. WHEN Phase 3 customization times out (5-minute limit) THEN the progress broadcast SHALL indicate the timeout explicitly: "LLM customization timed out after 5 minutes. Agents generated with default content."
3. WHEN the `GenerationCompletePayload` includes warnings THEN the `CompletionComponent` SHALL display them in a visible warning section (DaisyUI `alert-warning`)
4. WHEN individual section customization fails (orchestrator.service.ts:638-654) THEN a per-agent warning SHALL be included in the generation summary

#### R3: Prompt Designer Agent LLM Unavailable Visibility

**User Story:** As a premium user, I want to know when the prompt designer cannot access an LLM and falls back to template-based guidance, so that I understand the quality of my enhanced prompts.

**Current State (prompt-designer-agent.ts:209-213):** When `llmService.hasProvider()` returns false, the agent silently calls `generateFallbackGuidance()` and returns it as if it were LLM-generated.

**Acceptance Criteria:**

1. WHEN `llmService.hasProvider()` returns false THEN the `PromptDesignerAgent.generateGuidance()` SHALL include a `usedFallback: true` flag in the returned `PromptDesignerOutput`
2. WHEN fallback guidance is used THEN the progress callback SHALL report status `'fallback'` with message "LLM provider unavailable. Using template-based guidance."
3. WHEN the caller receives output with `usedFallback: true` THEN the frontend SHALL display an informational notice indicating template-based (non-AI) guidance was generated

#### R4: Prompt Designer Agent LLM Error Visibility

**User Story:** As a premium user, I want to know when prompt generation fails due to an LLM error, so that I can troubleshoot or retry.

**Current State (prompt-designer-agent.ts:273-286):** Any LLM error in the try/catch block silently returns `generateFallbackGuidance()` without distinguishing it from successful generation.

**Acceptance Criteria:**

1. WHEN an LLM error occurs during guidance generation THEN the returned output SHALL include `usedFallback: true` and `fallbackReason: string` describing the error
2. WHEN both structured and text completion fail THEN the error SHALL be propagated via the progress callback with status `'error'` before falling back
3. WHEN the error is a rate limit or authentication error THEN the error message SHALL suggest specific user actions (check API key, wait and retry)

#### R5: Enhanced Prompts Missing Prompt Visibility

**User Story:** As a premium user with enhanced prompts enabled, I want to know when no generated prompt exists and the system falls back to core system prompt, so that I know to run the prompt generation wizard.

**Current State (enhanced-prompts.service.ts:434-436):** When enabled but no `generatedPrompt` exists, `getEnhancedPromptContent()` silently returns `PTAH_CORE_SYSTEM_PROMPT`.

**Acceptance Criteria:**

1. WHEN enhanced prompts is enabled but `generatedPrompt` is null THEN `getEnhancedPromptContent()` SHALL return `null` (not PTAH_CORE fallback)
2. WHEN the caller receives `null` from `getEnhancedPromptContent()` THEN `InternalQueryService.resolveEnhancedPrompts()` (and `SdkQueryOptionsBuilder`) SHALL fall back to `PTAH_CORE_SYSTEM_PROMPT` explicitly, and log an info message: "Enhanced prompts enabled but not generated. Using core system prompt. Run the setup wizard to generate enhanced prompts."
3. WHEN the user starts a new chat session without generated prompts THEN the system SHALL NOT silently use enhanced prompt infrastructure (the fallback decision must be at the caller, not inside EnhancedPromptsService)

### Category 2: Wizard Integration -- Prompt Enhancement Step

#### R6: New Wizard Step Definition

**User Story:** As a premium user running the setup wizard, I want a dedicated "Prompt Enhancement" step after agent selection, so that I can generate project-specific enhanced prompts as part of the wizard flow.

**Acceptance Criteria:**

1. WHEN the wizard step order is defined THEN it SHALL be: Welcome -> Scan -> Analysis -> Selection -> **Enhance** -> Generation -> Complete (7 steps)
2. WHEN the `WizardStep` type is updated THEN it SHALL include `'enhance'` as a valid step identifier
3. WHEN the step stepper UI is rendered THEN it SHALL display 7 steps with "Enhance" between "Select" and "Generate"
4. WHEN navigating steps THEN the stepIndex computed signal SHALL correctly map the 7-step order
5. WHEN `SetupWizardStateService.stepOrder` is referenced THEN it SHALL include the `'enhance'` step at position 4 (0-indexed)

#### R7: Prompt Enhancement Component

**User Story:** As a premium user at the Enhance step, I want to see prompt generation progress with workspace analysis results and a clear success/error state, so that I know the enhancement is working.

**Acceptance Criteria:**

1. WHEN the user reaches the Enhance step THEN a new `PromptEnhancementComponent` SHALL be rendered
2. WHEN the step loads THEN it SHALL display: detected stack info (languages, frameworks, build tools), a "Generate Enhanced Prompt" button, and an option to skip
3. WHEN the user clicks "Generate" THEN it SHALL call the `wizard:generate-enhanced-prompt` RPC method
4. WHEN generation is in progress THEN a progress indicator SHALL show the current status (analyzing workspace, generating guidance) with percentage
5. WHEN generation succeeds THEN the component SHALL show a success state with detected stack summary and a "Continue to Generation" button
6. WHEN generation fails THEN the component SHALL show the error message with "Retry" and "Skip" buttons
7. WHEN the user clicks "Skip" THEN the wizard SHALL proceed to the Generation step with `enhancedPromptsStatus` set to `'skipped'`

#### R8: Backend RPC Handler for Enhanced Prompt Generation

**User Story:** As the wizard frontend, I need an RPC endpoint to trigger enhanced prompt generation, so that the prompt harness wizard runs within the setup wizard context.

**Acceptance Criteria:**

1. WHEN the `wizard:generate-enhanced-prompt` RPC method is called THEN it SHALL resolve `EnhancedPromptsService` from the DI container and call `runWizard()`
2. WHEN the workspace path is available THEN it SHALL be passed to `runWizard(workspacePath)`
3. WHEN progress callbacks fire THEN they SHALL be broadcast to the frontend via `setup-wizard:generation-progress` messages with `phase: 'enhance'`
4. WHEN the wizard result is successful THEN the RPC SHALL return `{ success: true, detectedStack: string[] }`
5. WHEN the wizard result fails THEN the RPC SHALL return `{ success: false, error: string }`
6. WHEN no workspace folder is open THEN the RPC SHALL return an error immediately

### Category 3: Settings UI -- Prompt Harness Configuration

#### R9: System Prompt Mode Selector (Ptah Harness vs Default Claude Code)

**User Story:** As a premium user, I want to choose between Ptah's enhanced prompt harness and the default Claude Code system prompt, so that I can switch back and forth depending on my preference.

**Acceptance Criteria:**

1. WHEN the settings UI is rendered for premium users THEN it SHALL include a "System Prompt" section with two selectable modes: **"Ptah Enhanced" (our harness)** and **"Default Claude Code" (vanilla SDK preset)**
2. WHEN "Ptah Enhanced" is selected THEN `EnhancedPromptsService.setEnabled(workspacePath, true)` SHALL be called and all sessions SHALL use the generated enhanced prompt (or PTAH_CORE if not generated yet)
3. WHEN "Default Claude Code" is selected THEN `EnhancedPromptsService.setEnabled(workspacePath, false)` SHALL be called and all sessions SHALL use the vanilla `claude_code` preset with no Ptah prompt appended
4. WHEN "Ptah Enhanced" is active THEN the UI SHALL show: current status (generated/not generated/stale), generation timestamp, detected stack summary, and a "Regenerate" button
5. WHEN "Default Claude Code" is active THEN the UI SHALL show a brief description: "Using the default Claude Code system prompt without project-specific enhancements"
6. WHEN enhanced prompts cache is stale (project config changed) THEN the UI SHALL show a warning: "Project configuration changed. Regeneration recommended."
7. WHEN the user is not premium THEN the system prompt section SHALL show that "Default Claude Code" is active with an upsell note for enhanced prompts
8. WHEN the mode is changed THEN it SHALL take effect immediately for the next session (no restart required)

#### R10: Settings RPC Handlers

**User Story:** As the settings frontend, I need RPC endpoints to get status, toggle, regenerate, and download enhanced prompts.

**Acceptance Criteria:**

1. WHEN `settings:enhanced-prompts-status` is called THEN it SHALL return the current `EnhancedPromptsStatus` for the active workspace, including: enabled, hasGeneratedPrompt, generatedAt, detectedStack, cacheValid, invalidationReason
2. WHEN `settings:enhanced-prompts-toggle` is called with `{ enabled: boolean }` THEN it SHALL call `EnhancedPromptsService.setEnabled()`
3. WHEN `settings:enhanced-prompts-regenerate` is called THEN it SHALL call `EnhancedPromptsService.regenerate()` and return the result
4. WHEN `settings:enhanced-prompts-download` is called THEN it SHALL retrieve the generated prompt content and trigger a file save dialog via `vscode.window.showSaveDialog()` to export the prompt as a `.md` file
5. WHEN no workspace is open THEN all settings RPC methods SHALL return appropriate error messages

#### R10a: Prompt Content Preview & Download

**User Story:** As a premium user, I want to view the generated enhanced prompt content and download it as a file, so that I can review what Ptah generated and keep a local copy.

**Acceptance Criteria:**

1. WHEN enhanced prompts have been generated THEN the settings UI SHALL show a "View Generated Prompt" expandable section with a read-only preview of the prompt content (rendered markdown)
2. WHEN the user clicks "Download Prompt" THEN a `.md` file SHALL be saved via VS Code's file save dialog with the prompt content
3. WHEN the prompt is displayed in the wizard Enhance step (R7) THEN it SHALL also show a read-only preview of the generated prompt sections (project context, framework guidelines, coding standards, architecture notes) after successful generation
4. WHEN no prompt has been generated THEN the preview and download options SHALL be hidden
5. WHEN the prompt content is displayed THEN it SHALL be rendered as formatted markdown (using the same ngx-markdown rendering as the chat)

### Category 4: Generation Pipeline -- Enhanced Prompts Integration

#### R11: Wire Enhanced Prompts into Orchestrator Phase 3

**User Story:** As a user generating agents, I want the LLM customization phase to use my enhanced project-specific prompts when available, so that generated agent content is more tailored to my project.

**Acceptance Criteria:**

1. WHEN Phase 3 customization runs and enhanced prompts are available THEN the `VsCodeLmService.buildPrompt()` SHALL append enhanced prompt context to the system prompt
2. WHEN enhanced prompts are not available (not generated or disabled) THEN Phase 3 SHALL use the existing generic prompt (no regression)
3. WHEN the orchestrator resolves enhanced prompts THEN it SHALL use `EnhancedPromptsService.getEnhancedPromptContent(workspacePath)` to retrieve the content
4. WHEN enhanced prompt content is appended THEN it SHALL be added as a "Project Context" section in the LLM customization prompt, not replacing the existing prompt structure

#### R12: Generation Progress Includes Enhancement Status

**User Story:** As a user in the generation step, I want to see whether enhanced prompts were applied during generation, so that I know my agents benefited from the enhanced context.

**Acceptance Criteria:**

1. WHEN generation completes with enhanced prompts active THEN the `GenerationCompletePayload` SHALL include `enhancedPromptsUsed: true`
2. WHEN generation completes without enhanced prompts THEN the payload SHALL include `enhancedPromptsUsed: false`
3. WHEN the `CompletionComponent` renders THEN it SHALL display whether enhanced prompts were used in the generation summary

### Category 5: Testing

#### R13: Error Path Tests for Silent Fallback Replacements

**User Story:** As a developer, I want comprehensive tests for all error paths, so that regressions to silent fallbacks are caught.

**Acceptance Criteria:**

1. WHEN testing `setup-rpc.handlers.ts` THEN there SHALL be tests for: agentic analysis failure triggering visible fallback warning, both agentic and fallback analysis failure throwing user-visible error
2. WHEN testing `orchestrator.service.ts` THEN there SHALL be tests for: Phase 3 complete failure with visible warning in summary, Phase 3 timeout with timeout-specific warning, individual section failure with per-agent warning
3. WHEN testing `prompt-designer-agent.ts` THEN there SHALL be tests for: no LLM provider returning output with `usedFallback: true`, LLM error returning output with `usedFallback: true` and `fallbackReason`
4. WHEN testing `enhanced-prompts.service.ts` THEN there SHALL be tests for: enabled with no generated prompt returning `null` (not PTAH_CORE), disabled returning `null`
5. WHEN testing the new `wizard:generate-enhanced-prompt` RPC handler THEN there SHALL be tests for: success path, workspace not open, EnhancedPromptsService failure, concurrent generation guard

#### R14: Frontend Component Tests

**User Story:** As a developer, I want tests for the new wizard step and settings components.

**Acceptance Criteria:**

1. WHEN testing `PromptEnhancementComponent` THEN there SHALL be tests for: initial render with detected stack, generate button triggering RPC, success state display, error state with retry, skip navigation
2. WHEN testing the enhanced prompts settings toggle THEN there SHALL be tests for: toggle on/off, regenerate action, stale cache warning display, premium gating

---

## Non-Functional Requirements

### Performance Requirements

- **Enhanced prompt generation** SHALL complete within 60 seconds for typical projects (< 500 files)
- **Wizard step navigation** SHALL respond within 100ms (no blocking operations on step transitions)
- **Settings toggle** SHALL apply within 500ms (local state update, no network call)
- **Error messages** SHALL display within 200ms of error detection (no delayed error reporting)

### Security Requirements

- **Enhanced prompt content** SHALL be viewable by premium users who generated it (read-only preview in wizard and settings). Content is project-specific and belongs to the user.
- **Settings RPC handlers** SHALL validate workspace path to prevent path traversal
- **Premium gating** SHALL be enforced for all enhanced prompt features (wizard step, settings toggle, regenerate, view/download)

### Reliability Requirements

- **Generation lock** SHALL prevent concurrent enhanced prompt generation (existing `acquireGenerationLock()` pattern)
- **Timeout protection** SHALL be applied to enhanced prompt generation (existing 5-minute `GENERATION_LOCK_TIMEOUT_MS`)
- **Error boundaries** SHALL catch and surface all errors without crashing the wizard or settings UI

---

## Risk Assessment

### Technical Risks

| Risk                                                                      | Probability | Impact | Score | Mitigation Strategy                                                                                                        |
| ------------------------------------------------------------------------- | ----------- | ------ | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| WizardStep type change breaks existing step navigation                    | Medium      | High   | 6     | Add 'enhance' step carefully, update all stepOrder arrays and stepIndex computations. Run full wizard E2E test.            |
| EnhancedPromptsService DI resolution fails in wizard context              | Medium      | High   | 6     | Use lazy resolution with try/catch (same pattern as other DI resolutions in setup-rpc.handlers.ts). Log descriptive error. |
| Enhanced prompt generation slows wizard flow                              | Low         | Medium | 3     | Generation is optional (skip button). Timeout protection already exists.                                                   |
| Removing PTAH_CORE fallback from getEnhancedPromptContent breaks sessions | Medium      | High   | 6     | Update all callers (InternalQueryService, SdkQueryOptionsBuilder) to handle null return. Add integration tests.            |
| Concurrent generation conflict between wizard and settings regenerate     | Low         | Medium | 3     | Existing generation lock prevents this. Settings regenerate should check lock and show "already in progress" message.      |
| Shared type changes break existing message handling                       | Low         | High   | 4     | Add new types/fields as optional. Existing exhaustive switch in SetupWizardStateService handles unknown message types.     |

### Business Risks

| Risk                                                          | Probability | Impact | Score | Mitigation Strategy                                                                                   |
| ------------------------------------------------------------- | ----------- | ------ | ----- | ----------------------------------------------------------------------------------------------------- |
| Users confused by new wizard step                             | Low         | Low    | 1     | Clear UI copy explaining what enhanced prompts do. Skip button for users who don't want it.           |
| Error messages alarm users unnecessarily                      | Medium      | Medium | 4     | Use warning level (yellow/amber) for fallback notices, not error level (red). Frame as informational. |
| Premium users perceive degradation when errors become visible | Low         | Medium | 2     | Frame visibility as improvement: "We now tell you when something goes wrong so you can take action."  |

---

## Dependencies

| Dependency                                         | Status      | Impact                                                                                                                     |
| -------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| TASK_2025_135 (Prompt Harness System)              | Complete    | Provides the core EnhancedPromptsService, PromptDesignerAgent, and PromptCacheService that this task wires into the wizard |
| TASK_2025_137 (Intelligent Prompt Generation)      | Planned     | The runWizard() method we invoke is from this system. Already implemented in codebase.                                     |
| TASK_2025_141 (Unified Project Intelligence)       | Complete    | Provides ProjectIntelligenceService used by PromptDesignerAgent for quality assessment                                     |
| TASK_2025_148 (Wizard Backend Generation Pipeline) | Complete    | Provides the wizard:submit-selection RPC handler and WizardGenerationRpcHandlers that we extend                            |
| TASK_2025_147 (Setup Wizard UI Enhancement)        | In Progress | UI polish for wizard steps. Our new step should follow the same DaisyUI patterns.                                          |

---

## Affected Files Summary

### Backend Files to Modify

| File                                                                                         | Change Type | Requirement                                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.ts`                 | Modify      | R1: Add fallback warning broadcast                                                                                                                             |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-generation-rpc.handlers.ts`     | Modify      | R8: Add wizard:generate-enhanced-prompt handler, R10: Add settings:enhanced-prompts-\* handlers, R10a: Add download handler, R12: Add enhancedPromptsUsed flag |
| `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`                     | Modify      | R2: Add warnings to progress broadcasts, R11: Wire enhanced prompts into Phase 3                                                                               |
| `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer-agent.ts`     | Modify      | R3, R4: Add usedFallback flag, propagate fallback reason                                                                                                       |
| `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts` | Modify      | R5: Return null instead of PTAH_CORE when no generated prompt                                                                                                  |
| `libs/backend/agent-sdk/src/lib/internal-query/internal-query.service.ts`                    | Modify      | R5: Handle null return from getEnhancedPromptContent explicitly                                                                                                |
| `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer.types.ts`     | Modify      | R3, R4: Add usedFallback and fallbackReason to PromptDesignerOutput                                                                                            |

### Frontend Files to Modify

| File                                                                            | Change Type | Requirement                                        |
| ------------------------------------------------------------------------------- | ----------- | -------------------------------------------------- |
| `libs/frontend/setup-wizard/src/lib/components/wizard-view.component.ts`        | Modify      | R6: Add Enhance step to stepper and step routing   |
| `libs/frontend/setup-wizard/src/lib/components/prompt-enhancement.component.ts` | **New**     | R7: New wizard step component                      |
| `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`         | Modify      | R2, R12: Display warnings and enhancement status   |
| `libs/frontend/setup-wizard/src/lib/components/scan-progress.component.ts`      | Modify      | R1: Display fallback warning alert                 |
| `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`     | Modify      | R6: Update WizardStep type, step order, step index |

### Shared Types Files to Modify

| File                                              | Change Type | Requirement                                                                                                                                     |
| ------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/lib/types/setup-wizard.types.ts` | Modify      | R8: Add wizard:generate-enhanced-prompt params/response types, R2: Add warnings to GenerationCompletePayload, R12: Add enhancedPromptsUsed flag |

### Test Files to Create/Modify

| File                                                                                              | Change Type    | Requirement                                     |
| ------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.spec.ts` | **New/Modify** | R13: Test null return for enabled-but-no-prompt |
| `libs/backend/agent-sdk/src/lib/prompt-harness/prompt-designer/prompt-designer-agent.spec.ts`     | **New/Modify** | R13: Test usedFallback flag scenarios           |
| `libs/backend/agent-generation/src/lib/services/orchestrator.service.spec.ts`                     | **New/Modify** | R13: Test Phase 3 failure visibility            |
| `apps/ptah-extension-vscode/src/services/rpc/handlers/setup-rpc.handlers.spec.ts`                 | **New/Modify** | R13: Test agentic fallback visibility           |

---

## Implementation Notes

### Key Design Decisions

1. **Enhance step is optional (skippable)**: The "Skip" button ensures users are not blocked by enhanced prompt generation failures or preference to use default prompts.

2. **Error visibility uses warnings, not blocking errors**: Fallback scenarios use DaisyUI `alert-warning` (amber), not `alert-error` (red). The wizard should never be blocked by enhanced prompt failures -- it should degrade gracefully with full visibility.

3. **EnhancedPromptsService.getEnhancedPromptContent returns null, not PTAH_CORE**: This is a deliberate architectural change. The service should report its own state honestly. The caller (InternalQueryService, SdkQueryOptionsBuilder) makes the fallback decision. This follows the single responsibility principle.

4. **PromptDesignerOutput gains usedFallback field**: Rather than creating a separate return type or error type, we add an optional boolean flag. This is backward-compatible with all existing callers.

5. **Settings UI for premium users only**: The enhanced prompts settings section is gated by premium license status, consistent with all other premium features in the settings UI.

6. **Shared type additions are optional fields**: New fields on `GenerationCompletePayload` and `PromptDesignerOutput` are optional to maintain backward compatibility with existing message handlers.

7. **System Prompt Mode Selector**: The settings UI presents a clear binary choice between "Ptah Enhanced" and "Default Claude Code" prompt modes. This maps directly to the existing `EnhancedPromptsService.setEnabled()` toggle. When disabled, InternalQueryService and SdkQueryOptionsBuilder skip all Ptah prompt appending, giving the user vanilla Claude Code behavior.

8. **Prompt content is user-viewable**: Unlike the original TASK_2025_137 design which hid prompt content for IP protection, the user explicitly requested the ability to see and download the generated prompt. The generated prompt is project-specific (contains no Ptah proprietary logic) and belongs to the user. It is shown as read-only rendered markdown in both the wizard Enhance step and the settings UI.

9. **Prompt download via VS Code file save dialog**: The download feature uses `vscode.window.showSaveDialog()` to let users export the generated prompt as a `.md` file. This is a standard VS Code pattern and requires no custom file handling.
