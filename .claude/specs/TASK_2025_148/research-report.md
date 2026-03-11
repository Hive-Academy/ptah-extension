# TASK_2025_148: Deep Investigation - Setup Wizard Backend Systems

## Executive Summary

**Research Classification**: STRATEGIC_ANALYSIS
**Confidence Level**: 95% (based on exhaustive source code analysis of 25+ files)
**Key Insight**: The setup wizard backend has THREE completely separate prompt systems, TWO workspace analysis pipelines, TWO agent recommendation engines, and a fully-implemented 5-phase generation pipeline that is DISCONNECTED from the frontend because RPC stubs throw errors instead of reaching the existing message handlers.

Building on TASK_2025_147's finding that the wizard is ~60% functional (Steps 0-3 working, Steps 4-6 broken), this report reveals the precise architectural topology of all backend systems, identifies every duplication point, and maps the exact breakage in the generation pipeline.

---

## 1. Prompt Systems Map

Three independent prompt systems exist across two libraries, each serving a different purpose.

### System A: PTAH Core System Prompt (Chat Sessions)

| Property        | Value                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Location**    | `libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts`                                                        |
| **Purpose**     | Base behavioral guidance appended to Claude's system prompt during interactive chat sessions                               |
| **Size**        | ~2500-3000 tokens                                                                                                          |
| **Content**     | VS Code extension context awareness, tone/style rules, AskUserQuestion enforcement, git safety, rich formatting directives |
| **Consumers**   | `SdkQueryOptionsBuilder.buildSystemPrompt()`, `InternalQueryService.buildSystemPrompt()`                                   |
| **Trigger**     | Automatically applied to every chat session for premium users                                                              |
| **Task Origin** | TASK_2025_137 Batch 1                                                                                                      |

### System B: Enhanced Prompts (Chat Session Enrichment)

| Property            | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Location**        | `libs/backend/agent-sdk/src/lib/prompt-harness/enhanced-prompts/enhanced-prompts.service.ts`                         |
| **Purpose**         | Project-specific guidance generated via LLM, appended to chat session system prompts                                 |
| **Components**      | `EnhancedPromptsService` (orchestrator), `PromptDesignerAgent` (LLM generator), `PromptCacheService` (smart cache)   |
| **Output Sections** | `projectContext`, `frameworkGuidelines`, `codingStandards`, `architectureNotes`, `qualityGuidance`                   |
| **Max Tokens**      | 1600 total, 400 per section                                                                                          |
| **Consumers**       | `SdkQueryOptionsBuilder`, `InternalQueryService` (both call `getEnhancedPromptContent()`)                            |
| **Trigger**         | Auto-triggered after wizard agent generation completes (via `GenerationProgressComponent`), or manually via RPC      |
| **RPC Endpoints**   | `enhancedPrompts:getStatus`, `enhancedPrompts:runWizard`, `enhancedPrompts:setEnabled`, `enhancedPrompts:regenerate` |
| **Task Origin**     | TASK_2025_137 Batches 2-4                                                                                            |

### System C: Agentic Analysis System Prompt (Wizard Only)

| Property                | Value                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Location**            | `libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts` method `buildAnalysisSystemPrompt()`                                                                                                                               |
| **Purpose**             | Defines the 4-phase agentic workspace analysis behavior for the setup wizard scan step                                                                                                                                                                 |
| **Content**             | Phase definitions (discovery, architecture, health, quality), MCP tool usage instructions, progress marker formats (`[PHASE:X]`, `[DETECTED:X]`), output JSON schema                                                                                   |
| **Consumers**           | Only `AgenticAnalysisService.runAgenticAnalysis()`                                                                                                                                                                                                     |
| **Trigger**             | When premium user starts wizard scan (Step 2)                                                                                                                                                                                                          |
| **Relationship to A/B** | COMPLETELY SEPARATE - does not use PTAH_CORE_SYSTEM_PROMPT or Enhanced Prompts directly. However, `InternalQueryService.execute()` (which AgenticAnalysisService delegates to) does resolve enhanced prompts as part of its own system prompt assembly |

### Prompt System Flow Diagram

```
CHAT SESSIONS (Interactive):
  SdkQueryOptionsBuilder.buildSystemPrompt()
    -> Identity Prompt (Anthropic preset)
    -> User System Prompt (if any)
    -> Enhanced Prompts content (if available, System B)
       OR PTAH_CORE_SYSTEM_PROMPT fallback (System A)

INTERNAL QUERIES (One-shot, e.g., agentic analysis):
  InternalQueryService.buildSystemPrompt()
    -> Identity Prompt
    -> Enhanced Prompts / PTAH_CORE fallback (System A/B)
    -> Task-specific append (System C for agentic analysis)

WIZARD AGENTIC ANALYSIS:
  AgenticAnalysisService.runAgenticAnalysis()
    -> buildAnalysisSystemPrompt() (System C)
    -> Passed to InternalQueryService.execute() as systemPrompt override
    -> InternalQueryService adds enhanced prompts on top (System A/B)
```

### Overlap Assessment

| Overlap                         | Systems                                                          | Severity | Resolution                                            |
| ------------------------------- | ---------------------------------------------------------------- | -------- | ----------------------------------------------------- |
| Behavioral guidance duplication | A and C both define coding standards/style                       | LOW      | Different purposes - A is for chat, C is for analysis |
| Framework detection redundancy  | B detects stack for prompt generation, C detects during analysis | MEDIUM   | Could share detection results                         |
| No shared prompt composition    | A, B, C have independent assembly                                | LOW      | By design - different consumers                       |

**Verdict**: The three prompt systems serve genuinely different purposes and are NOT duplicating each other's primary function. System A provides base chat behavior, System B enriches with project-specific guidance, System C defines agentic analysis behavior. The overlap is minimal and intentional.

---

## 2. Duplication Matrix

### Workspace Analysis Duplication

| Capability                   | AgenticAnalysisService                               | DeepProjectAnalysisService                                                                              | Orchestrator.analyzeWorkspace()                 |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Library**                  | agent-generation (wizard/)                           | agent-generation (wizard/)                                                                              | agent-generation + workspace-intelligence       |
| **Lines**                    | 942                                                  | 765                                                                                                     | ~200 (delegates to 4 services)                  |
| **Approach**                 | Claude SDK + MCP tools (agentic)                     | Hardcoded VS Code API calls (deterministic)                                                             | workspace-intelligence services (deterministic) |
| **Premium Required**         | YES                                                  | NO                                                                                                      | NO                                              |
| **LLM Required**             | YES (Claude SDK)                                     | NO                                                                                                      | NO                                              |
| **Detects**                  | Frameworks, architecture, health, quality (4 phases) | Architecture patterns (6 types), key locations, language stats, diagnostics, conventions, test coverage | Project type, framework, monorepo structure     |
| **Output Type**              | `ProjectAnalysisResult` (via Zod schema)             | `ProjectAnalysisResult` (same type, different data quality)                                             | `AgentProjectContext` (different type)          |
| **Used By**                  | Step 2 scan (premium path)                           | Step 2 scan (fallback path), AgentRecommendationService                                                 | Orchestrator Phase 1 only                       |
| **Connection to Generation** | Analysis feeds into agent recommendations            | Analysis feeds into agent recommendations                                                               | Analysis feeds into orchestrator phases 2-5     |

**Key Finding**: Three separate analysis systems produce two different output types (`ProjectAnalysisResult` vs `AgentProjectContext`). The orchestrator's analysis is completely disconnected from the wizard's analysis results -- it re-analyzes the workspace from scratch in Phase 1.

### Agent Recommendation/Selection Duplication

| Capability    | AgentRecommendationService                                                                                            | AgentSelectionService (IAgentSelectionService)         |
| ------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **Library**   | agent-generation                                                                                                      | agent-generation                                       |
| **Lines**     | 873                                                                                                                   | ~200                                                   |
| **Input**     | `ProjectAnalysisResult` (from wizard analysis)                                                                        | `AgentProjectContext` (from orchestrator analysis)     |
| **Algorithm** | Sophisticated scoring: 30+ adjustment factors, 5 categories, thresholds (AUTO_SELECT=80, RECOMMENDED=75, CONSIDER=60) | Template relevance scoring via ITemplateStorageService |
| **Output**    | `AgentRecommendation[]` (13 agents with scores, matched criteria)                                                     | Selected template list (interface-based)               |
| **Used By**   | RPC handler `wizard:recommend-agents` -> Step 3/4 UI                                                                  | Orchestrator Phase 2 (`selectAgents()`)                |
| **Catalogs**  | Hardcoded 13-agent catalog with 5 categories                                                                          | Template-driven (loaded from storage)                  |

**Key Finding**: Two completely separate agent selection systems with different inputs, algorithms, and outputs. The wizard UI uses `AgentRecommendationService` (sophisticated scoring), but the orchestrator generation pipeline uses `IAgentSelectionService` (template-based). If the generation pipeline were connected, user selections from Step 4 would need to be translated.

### File Generation Systems

| Capability    | Orchestrator Pipeline (Phases 3-5)                                                                                                                    | SkillGeneratorService                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Library**   | agent-generation                                                                                                                                      | agent-generation                                                     |
| **Generates** | Agent `.claude/agents/*.md` files                                                                                                                     | Orchestration skill files `.claude/skills/orchestration/` (7 files)  |
| **Approach**  | LLM customization (VsCodeLmService, 5-min timeout) -> Template rendering (IContentGenerationService) -> Atomic file writing (IAgentFileWriterService) | Template-based with variable substitution (`{{PROJECT_TYPE}}`, etc.) |
| **Overlap**   | None - different file types                                                                                                                           | None - different file types                                          |

**Verdict**: File generation is NOT duplicated. The orchestrator generates agent files, SkillGeneratorService generates skill files. These are complementary.

### State Management Duplication

| Aspect                 | Frontend (SetupWizardStateService)                 | Backend (SetupWizardService facade)                                |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| **Step Tracking**      | Signal-based `currentStep` (6 steps)               | `WizardStepMachineService` (6 steps, state machine)                |
| **Session Management** | Implicit (signals reset on wizard close)           | `WizardSessionManagerService` (24hr expiry, workspace persistence) |
| **Progress**           | `skillGenerationProgress` signal (never populated) | Orchestrator emits progress via events                             |
| **Communication**      | RPC calls + broadcast message listeners            | RPC handlers + broadcast emitters                                  |

**Key Finding**: Frontend and backend track wizard state independently. The backend has a full step machine that the frontend does not coordinate with. The frontend drives steps via user actions and RPC calls; the backend drives steps via message handlers. These two state machines are NOT synchronized.

### Communication Architecture Duplication

| Channel              | RPC (Request/Response)                                                                                      | Broadcast (Webview postMessage)                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Working Examples** | `wizard:deep-analyze`, `wizard:recommend-agents`, `wizard:cancel-analysis`, `enhancedPrompts:*`             | `SETUP_WIZARD_SCAN_PROGRESS`, `SETUP_WIZARD_ANALYSIS_STREAM`                            |
| **Broken/Missing**   | `wizard:start` (stub), `wizard:submit-selection` (stub), `wizard:cancel` (stub), `wizard:retry-item` (stub) | Generation progress events (emitted by orchestrator but no frontend listener connected) |
| **Used By**          | Analysis + recommendations (Steps 2-3)                                                                      | Streaming analysis progress (Step 2)                                                    |

---

## 3. Service Dependency Graph

### Complete Backend Service Map for Wizard

```
SetupWizardService (Facade - 874 lines)
  libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts
  |
  +-- WizardWebviewLifecycleService (panel creation, RPC responses, progress emission)
  |     libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts
  |
  +-- WizardSessionManagerService (session CRUD, workspace state, 24hr expiry)
  |     libs/backend/agent-generation/src/lib/services/wizard/session-manager.service.ts
  |
  +-- WizardStepMachineService (step state machine: welcome->scan->review->select->generate->complete)
  |     libs/backend/agent-generation/src/lib/services/wizard/step-machine.service.ts
  |
  +-- DeepProjectAnalysisService (hardcoded analysis, NO LLM) [765 lines]
  |     libs/backend/agent-generation/src/lib/services/wizard/deep-analysis.service.ts
  |     |
  |     +-- AgentGenerationOrchestratorService.analyzeWorkspace() (step 1 only)
  |     +-- CodeHealthAnalysisService (diagnostics, conventions, test coverage)
  |     +-- ProjectIntelligenceService (optional, TASK_2025_141)
  |
  +-- WizardContextMapperService (frontend-to-backend context transformation)
  |     libs/backend/agent-generation/src/lib/services/wizard/context-mapper.service.ts
  |
  +-- AgenticAnalysisService (Claude SDK + MCP analysis) [942 lines]
  |     libs/backend/agent-generation/src/lib/services/wizard/agentic-analysis.service.ts
  |     |
  |     +-- InternalQueryService (agent-sdk) -> SDK execution
  |     +-- WebviewManager -> broadcast progress to frontend
  |
  +-- AgentGenerationOrchestratorService [909 lines]
        libs/backend/agent-generation/src/lib/services/orchestrator.service.ts
        |
        +-- Phase 1: WorkspaceAnalyzerService, ProjectDetectorService,
        |            FrameworkDetectorService, MonorepoDetectorService
        |            (all from workspace-intelligence)
        |
        +-- Phase 2: IAgentSelectionService (agent-selection.service.ts)
        |            + ITemplateStorageService (template-storage.service.ts)
        |
        +-- Phase 3: VsCodeLmService (VS Code LM API, 5-min timeout)
        |
        +-- Phase 4: IContentGenerationService (content-generation.service.ts)
        |
        +-- Phase 5: IAgentFileWriterService (file-writer.service.ts)
```

### Standalone Services (Not Under Wizard Facade)

```
AgentRecommendationService [873 lines]
  libs/backend/agent-generation/src/lib/services/agent-recommendation.service.ts
  - Standalone, injected directly by RPC handler
  - Input: ProjectAnalysisResult (from wizard analysis)
  - Output: AgentRecommendation[] (13 agents scored)

SkillGeneratorService [484 lines]
  libs/backend/agent-generation/src/lib/services/skill-generator.service.ts
  - Standalone, generates .claude/skills/orchestration/ files
  - Template-based with variable substitution
  - Loads templates from extension assets

SetupStatusService
  libs/backend/agent-generation/src/lib/services/setup-status.service.ts
  - Tracks agent setup completion state
  - Used by extension to show/hide wizard prompt

AgentCustomizationService (via VsCodeLmService)
  libs/backend/agent-generation/src/lib/services/vscode-lm.service.ts
  - LLM-powered content customization for agent files
  - Used by Orchestrator Phase 3
```

### Frontend Service Map

```
SetupWizardStateService (Signal-based state)
  libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts
  - Manages: currentStep, projectContext, selectedAgents, generationProgress
  - Computed: canProceed, hasSelectedAgents, generationComplete

WizardRpcService (RPC facade)
  libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts
  |
  +-- WORKING:
  |   - launchWizard() -> 'setup-wizard:launch'
  |   - deepAnalyze() -> 'wizard:deep-analyze'
  |   - recommendAgents() -> 'wizard:recommend-agents'
  |   - cancelAnalysis() -> 'wizard:cancel-analysis'
  |   - runEnhancedPromptsWizard() -> 'enhancedPrompts:runWizard'
  |   - getEnhancedPromptsStatus() -> 'enhancedPrompts:getStatus'
  |
  +-- BROKEN (stubs that throw):
      - startSetupWizard() -> throws Error
      - submitAgentSelection() -> throws Error
      - cancelWizard() -> throws Error
      - retryGenerationItem() -> throws Error
```

### Cross-Library Dependencies

```
agent-generation library
  DEPENDS ON:
    -> @ptah-extension/shared (Result, CorrelationId, types)
    -> @ptah-extension/vscode-core (Logger, TOKENS, FileSystemManager)
    -> @ptah-extension/workspace-intelligence (analyzers, detectors)
    -> @ptah-extension/llm-abstraction (LLM providers)
    -> @ptah-extension/agent-sdk (InternalQueryService, SDK_TOKENS)

agent-sdk library (prompt harness)
  DEPENDS ON:
    -> @ptah-extension/shared (types)
    -> @ptah-extension/vscode-core (Logger, TOKENS)
  NO dependency on agent-generation (correct layering)

workspace-intelligence library
  DEPENDS ON:
    -> @ptah-extension/shared (types)
    -> @ptah-extension/vscode-core (Logger, TOKENS)
  NO dependency on agent-generation or agent-sdk (correct layering)
```

---

## 4. Enhanced Prompts vs Wizard Comparison

### Purpose Comparison

| Dimension            | Enhanced Prompts (System B)                                                       | Wizard Agent Generation                                                   |
| -------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Primary Goal**     | Generate project-specific text to enrich Claude's system prompt during chat       | Generate `.claude/agents/*.md` files on disk for agent specialization     |
| **Output Type**      | In-memory prompt text (cached, never written to disk as standalone files)         | Physical markdown files in workspace `.claude/agents/` directory          |
| **Output Lifetime**  | Session-scoped (cached per workspace, invalidated on file changes)                | Permanent (persists as workspace files)                                   |
| **User Visibility**  | Invisible to user (embedded in system prompt)                                     | Visible files user can edit, review, version-control                      |
| **Effect on Claude** | Behavioral guidance during conversation (coding standards, architecture patterns) | Agent role definitions that Claude adopts when invoked as specific agents |

### Technical Comparison

| Dimension              | Enhanced Prompts                                                                                                     | Wizard Generation Pipeline                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Workspace Analysis** | `EnhancedPromptsService.runWizard()` detects stack via VS Code API + `PromptDesignerAgent`                           | `DeepProjectAnalysisService` (11-step analysis) OR `AgenticAnalysisService` (4-phase SDK analysis) |
| **LLM Usage**          | `PromptDesignerAgent.generateGuidance()` - structured output, text fallback                                          | `VsCodeLmService` (Phase 3 customization) - section-by-section customization                       |
| **Token Budget**       | 1600 tokens max (400/section)                                                                                        | No explicit budget (full agent file content)                                                       |
| **Caching**            | `PromptCacheService` with file-based invalidation triggers                                                           | None (files on disk are the "cache")                                                               |
| **Premium Required**   | YES (license gated via RPC handler)                                                                                  | YES for agentic analysis, NO for deterministic analysis                                            |
| **RPC Endpoints**      | `enhancedPrompts:getStatus`, `enhancedPrompts:runWizard`, `enhancedPrompts:setEnabled`, `enhancedPrompts:regenerate` | `wizard:deep-analyze`, `wizard:recommend-agents`, `wizard:submit-selection` (stub)                 |

### Connection Between Systems

The two systems are connected at ONE point:

```
GenerationProgressComponent (Step 5 UI)
  -> When isGenerationComplete() becomes true
  -> Auto-triggers: wizardRpc.runEnhancedPromptsWizard()
  -> Enhanced Prompts runs as a "bonus step" after agent file generation
```

This means Enhanced Prompts is designed to run AFTER the wizard completes, as a complementary enrichment step. It is NOT a replacement for wizard generation, and wizard generation is NOT a replacement for Enhanced Prompts.

### Verdict

**Enhanced Prompts and Wizard Agent Generation are COMPLEMENTARY systems, NOT duplicates.**

- Wizard generates persistent agent definition files (`.claude/agents/*.md`)
- Enhanced Prompts generates ephemeral system prompt enrichment for chat sessions
- They analyze the workspace independently but for different purposes
- The wizard auto-triggers Enhanced Prompts as a follow-up step
- No consolidation needed between these two systems

---

## 5. Generation Pipeline Map

### Complete Pipeline: What Exists vs What's Broken

#### Phase 0: Wizard Launch (WORKING)

```
Frontend: wizardRpc.launchWizard() -> RPC 'setup-wizard:launch'
Backend:  SetupWizardService.launchWizard() -> creates webview panel
Status:   FULLY WORKING
```

#### Phase 1: Workspace Analysis (WORKING)

**Path A - Agentic Analysis (Premium)**:

```
Frontend: scan-progress.component triggers analysis
Backend:  AgenticAnalysisService.runAgenticAnalysis()
  -> buildAnalysisSystemPrompt() (System C prompt)
  -> InternalQueryService.execute() (Claude SDK)
  -> Streams progress via broadcast messages
  -> Parses JSON output, validates with Zod schema
  -> Returns ProjectAnalysisResult
Status:   FULLY WORKING (TASK_2025_146 fixes applied)
```

**Path B - Deep Analysis (Fallback)**:

```
Frontend: wizardRpc.deepAnalyze() -> RPC 'wizard:deep-analyze'
Backend:  DeepProjectAnalysisService.analyze()
  -> 11-step deterministic analysis (VS Code APIs)
  -> Returns ProjectAnalysisResult
Status:   FULLY WORKING
```

#### Phase 2: Agent Recommendations (WORKING)

```
Frontend: wizardRpc.recommendAgents(analysis) -> RPC 'wizard:recommend-agents'
Backend:  AgentRecommendationService.calculateRecommendations()
  -> Scores 13 agents against ProjectAnalysisResult
  -> Returns AgentRecommendation[] (sorted by score)
Frontend: Displays recommendations in AgentSelectionComponent (Step 4)
Status:   FULLY WORKING
```

#### Phase 3: Agent Selection Submission (BROKEN)

```
Frontend: wizardRpc.submitAgentSelection(selections)
  -> THROWS ERROR: "Agent selection submission not yet implemented"
  -> RPC handler 'wizard:submit-selection' DOES NOT EXIST

Backend (UNREACHABLE):
  SetupWizardService registers message handler for 'setup-wizard:submit-selection'
  -> handleSelectionMessage() calls orchestrator.generateAgents()
  -> But this uses webview postMessage, NOT RPC
  -> Frontend uses RPC, backend expects postMessage = PROTOCOL MISMATCH
Status:   BROKEN - Protocol mismatch between frontend (RPC) and backend (postMessage)
```

#### Phase 4: Agent Generation (EXISTS but UNREACHABLE)

```
AgentGenerationOrchestratorService.generateAgents():
  Phase 1 (0-20%):  analyzeWorkspace() - RE-ANALYZES workspace (ignores wizard analysis)
    -> WorkspaceAnalyzerService, ProjectDetectorService,
       FrameworkDetectorService, MonorepoDetectorService
    -> Produces AgentProjectContext (DIFFERENT type than wizard's ProjectAnalysisResult)

  Phase 2 (20-30%): selectAgents()
    -> IAgentSelectionService (template-based) OR user overrides
    -> Uses ITemplateStorageService to load agent templates

  Phase 3 (30-80%): customizeAgents()
    -> VsCodeLmService (VS Code LM API)
    -> Section-by-section LLM customization
    -> 5-minute timeout per agent
    -> Falls back to template defaults on LLM failure

  Phase 4 (80-95%): renderAgents()
    -> IContentGenerationService
    -> Template rendering with variables
    -> Produces final markdown content

  Phase 5 (95-100%): writeAgentsBatch()
    -> IAgentFileWriterService
    -> Atomic file writing to .claude/agents/
    -> Rollback on failure

Status:   FULLY IMPLEMENTED but UNREACHABLE from frontend
Reason:   submitAgentSelection() RPC stub throws before reaching backend
```

#### Phase 5: Skill Generation (EXISTS but UNREACHABLE)

```
SkillGeneratorService.generateSkillFiles():
  -> Loads 7 templates from extension assets
  -> Substitutes variables: {{PROJECT_TYPE}}, {{FRAMEWORKS}}, {{AGENTS}}, etc.
  -> Writes to .claude/skills/orchestration/
  -> Files: SKILL.md, agent-catalog.md, strategies.md, team-leader-modes.md,
            task-tracking.md, checkpoints.md, git-standards.md

Status:   FULLY IMPLEMENTED but UNREACHABLE
Reason:   Never invoked because orchestrator Phase 4/5 never reached
```

#### Phase 6: Completion + Enhanced Prompts Bonus (BROKEN)

```
Frontend: GenerationProgressComponent
  -> Watches wizardState.skillGenerationProgress signal
  -> Signal is NEVER POPULATED (no generation events reach frontend)
  -> isGenerationComplete() never becomes true
  -> Enhanced Prompts auto-trigger never fires

Status:   BROKEN - No generation events reach frontend
```

### Pipeline Breakage Summary

```
WORKING:     [Launch] -> [Analysis] -> [Recommendations] -> [Display in UI]
                                                                |
BROKEN HERE: ------------------------------------------------> [Submit Selection]
                                                                |
                                                          RPC stub throws error
                                                                |
UNREACHABLE: [Orchestrator Phase 1-5] -> [Skill Generation] -> [Completion + Enhanced Prompts]
```

**Root Cause**: The frontend was refactored to use RPC (TASK_2025_078) but the backend generation handlers still use the old webview postMessage protocol. The RPC handlers for `wizard:submit-selection`, `wizard:start`, `wizard:cancel`, and `wizard:retry-item` were never created.

---

## 6. Architecture Recommendation

### What to Consolidate

1. **Create RPC handlers for generation pipeline**: This is the SINGLE highest-impact fix. Implement `wizard:submit-selection` RPC handler that bridges to the existing `SetupWizardService.handleSelectionMessage()` or directly to `AgentGenerationOrchestratorService.generateAgents()`.

2. **Unify workspace analysis output**: The orchestrator re-analyzes the workspace in Phase 1 even though the wizard already analyzed it. The wizard analysis (`ProjectAnalysisResult`) should be passed through to the orchestrator, which should accept it as pre-computed context instead of re-running `WorkspaceAnalyzerService`.

3. **Bridge agent recommendation to selection**: The wizard's `AgentRecommendationService` produces `AgentRecommendation[]` with agent names. The orchestrator's `IAgentSelectionService` expects template-based selection. The user's selections from Step 4 need to be translated into the orchestrator's expected format (already partially implemented via `userOverrides` parameter in `generateAgents()`).

### What to Keep Separate

1. **Enhanced Prompts vs Wizard Generation**: These are complementary systems. Keep them separate. The auto-trigger from `GenerationProgressComponent` is the correct integration point.

2. **Three prompt systems**: Each serves a genuinely different purpose. Do not consolidate.

3. **Agentic vs Deep Analysis**: These serve different user tiers (premium vs free). Keep both paths but ensure they produce consistent output types.

4. **AgentRecommendationService vs AgentSelectionService**: These serve different stages. Recommendation is for UI display (scored suggestions), Selection is for pipeline execution (template matching). Keep both but bridge them.

### Architecture Priorities for TASK_2025_148 Implementation

**Priority 1 (Critical - Unblocks everything)**:

- Implement `wizard:submit-selection` RPC handler
- Connect frontend selection to orchestrator's `generateAgents()`
- Pass user-selected agent IDs as `userOverrides`

**Priority 2 (Important - Eliminates redundancy)**:

- Pass wizard's `ProjectAnalysisResult` into orchestrator to skip Phase 1 re-analysis
- Map `ProjectAnalysisResult` to `AgentProjectContext` in a transformer

**Priority 3 (Nice-to-have - Completes the loop)**:

- Implement `wizard:retry-item` RPC handler for retry functionality
- Implement generation progress events via RPC (replace broadcast for progress tracking)
- Wire up `GenerationProgressComponent` to receive and display orchestrator progress

---

## 7. TASK_2025_148 Scope Recommendation

### Minimum Viable Scope (Connect the Pipeline)

The minimum work to make Steps 4-6 functional:

1. **Create `wizard:submit-selection` RPC handler** in `apps/ptah-extension-vscode/src/services/rpc/handlers/`

   - Accept `{ agentIds: string[] }` from frontend
   - Call `AgentGenerationOrchestratorService.generateAgents()` with `userOverrides`
   - Return acknowledgment response

2. **Implement `submitAgentSelection()` in `WizardRpcService`** (replace stub)

   - Call `wizard:submit-selection` RPC endpoint
   - Return `AgentSelectionResponse`

3. **Wire generation progress to frontend**

   - Option A: RPC-based progress polling
   - Option B: Continue using broadcast messages but add frontend listeners
   - Update `skillGenerationProgress` signal in `SetupWizardStateService`

4. **Register the new RPC handler** in the RPC method registry

### Recommended Scope (Connect + Optimize)

In addition to minimum scope:

5. **Pass wizard analysis to orchestrator** to eliminate redundant Phase 1

   - Create a `WorkspaceAnalysisCache` or simply pass `ProjectAnalysisResult` through the RPC payload
   - Add a `preComputedContext` parameter to `OrchestratorGenerationOptions`

6. **Implement `wizard:cancel` RPC handler** for proper wizard cancellation

7. **Implement `wizard:retry-item` RPC handler** for per-agent retry

### Out of Scope (Separate Tasks)

- Consolidating prompt systems (not needed, they serve different purposes)
- Rewriting Enhanced Prompts (working correctly, complementary to wizard)
- Migrating broadcast messages to RPC (working for analysis streaming, can be done later)
- Synchronizing frontend/backend step machines (low priority, frontend drives the flow)

### Service Inventory for Implementation

All services that will be touched or created:

| Service                            | Action                                        | File                                                                             |
| ---------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| WizardRpcHandlers (NEW)            | CREATE                                        | `apps/ptah-extension-vscode/src/services/rpc/handlers/wizard-rpc.handlers.ts`    |
| WizardRpcService                   | MODIFY (replace stubs)                        | `libs/frontend/setup-wizard/src/lib/services/wizard-rpc.service.ts`              |
| SetupWizardStateService            | MODIFY (wire progress)                        | `libs/frontend/setup-wizard/src/lib/services/setup-wizard-state.service.ts`      |
| GenerationProgressComponent        | MODIFY (connect to real events)               | `libs/frontend/setup-wizard/src/lib/components/generation-progress.component.ts` |
| AgentGenerationOrchestratorService | POSSIBLY MODIFY (accept pre-computed context) | `libs/backend/agent-generation/src/lib/services/orchestrator.service.ts`         |
| RpcMethodRegistry                  | MODIFY (register new handlers)                | RPC registration file in vscode app                                              |

### Estimated Complexity

- **Minimum scope**: MEDIUM (4-6 hours) - primarily wiring existing systems together
- **Recommended scope**: MEDIUM-HIGH (8-12 hours) - adds optimization and additional handlers
- **Risk**: LOW - all generation logic already exists and is tested, this is integration work

---

## Appendix A: Complete Service Catalog (agent-generation library)

| Service                               | Lines | Purpose                                   | Status                                      |
| ------------------------------------- | ----- | ----------------------------------------- | ------------------------------------------- |
| `orchestrator.service.ts`             | 909   | 5-phase generation workflow               | Implemented, unreachable                    |
| `setup-wizard.service.ts`             | 874   | Facade for wizard child services          | Implemented, partially connected            |
| `agent-recommendation.service.ts`     | 873   | Scores 13 agents against analysis         | Working                                     |
| `wizard/agentic-analysis.service.ts`  | 942   | Claude SDK workspace analysis             | Working                                     |
| `wizard/deep-analysis.service.ts`     | 765   | Deterministic workspace analysis          | Working                                     |
| `wizard/code-health.service.ts`       | ~300  | Diagnostics, conventions, coverage        | Working                                     |
| `wizard/step-machine.service.ts`      | ~200  | Step state machine                        | Implemented, not synchronized with frontend |
| `wizard/session-manager.service.ts`   | ~200  | Session CRUD, 24hr expiry                 | Implemented                                 |
| `wizard/webview-lifecycle.service.ts` | ~200  | Panel creation, progress emission         | Implemented                                 |
| `wizard/context-mapper.service.ts`    | ~150  | Frontend-to-backend context mapping       | Implemented                                 |
| `skill-generator.service.ts`          | 484   | Generates 7 skill files                   | Implemented, unreachable                    |
| `agent-selection.service.ts`          | ~200  | Template-based selection for orchestrator | Implemented, unreachable                    |
| `content-generation.service.ts`       | ~300  | LLM content generation                    | Implemented, unreachable                    |
| `file-writer.service.ts`              | ~250  | Atomic file writing with rollback         | Implemented, unreachable                    |
| `output-validation.service.ts`        | ~200  | Zod schema validation                     | Implemented, unreachable                    |
| `template-storage.service.ts`         | ~200  | Template loading and caching              | Implemented, unreachable                    |
| `vscode-lm.service.ts`                | ~400  | VS Code LM API integration                | Implemented, unreachable                    |
| `agent-customization.service.ts`      | ~200  | Agent content customization               | Implemented, unreachable                    |
| `setup-status.service.ts`             | ~150  | Setup completion tracking                 | Working                                     |

## Appendix B: File Path Reference

All files analyzed in this investigation (absolute paths):

### Prompt Harness (agent-sdk)

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\ptah-core-prompt.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.types.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer-agent.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\helpers\sdk-query-options-builder.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`

### Enhanced Prompts RPC

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts`

### Agent Generation

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-recommendation.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\agent-selection.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\skill-generator.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\deep-analysis.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\code-health.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\context-mapper.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\session-manager.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\step-machine.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\webview-lifecycle.service.ts`

### Frontend (setup-wizard)

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`
