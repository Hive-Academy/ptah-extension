# Research Report: Setup Wizard End-to-End Implementation Audit

**Task**: TASK_2025_147
**Date**: 2026-02-09
**Researcher**: researcher-expert
**Confidence Level**: 95% (based on direct source code reading of 15+ files)

---

## 1. Executive Summary

The setup wizard has **two distinct communication architectures** coexisting in the codebase, creating significant confusion about what actually works:

1. **RPC-based architecture** (via `wizard-rpc.service.ts`) -- Methods that call the backend through `ClaudeRpcService.call()` and receive direct responses. These are registered in `setup-rpc.handlers.ts`.

2. **WebSocket/postMessage broadcast architecture** (via `setup-wizard.service.ts` backend facade) -- The backend pushes progress messages to the frontend via `webviewManager.broadcastMessage()`, and the frontend's `SetupWizardStateService` listens via `window.addEventListener('message')`.

**Key Finding**: The wizard's primary working flow (`welcome -> scan -> analysis -> selection`) uses Architecture #1 (RPC calls from `ScanProgressComponent`). The stubs in `wizard-rpc.service.ts` (`startSetupWizard`, `submitAgentSelection`, `cancelWizard`, `retryGenerationItem`) are remnants of an older Architecture #2 design that was never fully connected. The working flow bypasses them entirely.

The generation step (Step 5) calls `submitAgentSelection()` which **will always throw** because it is a stub. This means the wizard flow is **broken at the selection-to-generation transition**.

---

## 2. Status Matrix: Every Wizard Feature

### 2.1 Frontend RPC Methods (`wizard-rpc.service.ts`)

| #   | Method                       | RPC Target                  | Status      | Evidence                                                                                             |
| --- | ---------------------------- | --------------------------- | ----------- | ---------------------------------------------------------------------------------------------------- |
| 1   | `launchWizard()`             | `setup-wizard:launch`       | **WORKING** | Calls backend SetupWizardService.launchWizard(), creates webview panel                               |
| 2   | `deepAnalyze()`              | `wizard:deep-analyze`       | **WORKING** | Full implementation: agentic analysis (Claude SDK) with hardcoded fallback                           |
| 3   | `recommendAgents()`          | `wizard:recommend-agents`   | **WORKING** | Full implementation: Zod validation, AgentRecommendationService calculates scores for 13 agents      |
| 4   | `cancelAnalysis()`           | `wizard:cancel-analysis`    | **WORKING** | Aborts active AbortController in AgenticAnalysisService, best-effort                                 |
| 5   | `runEnhancedPromptsWizard()` | `enhancedPrompts:runWizard` | **WORKING** | Full backend handler in `enhanced-prompts-rpc.handlers.ts`                                           |
| 6   | `getEnhancedPromptsStatus()` | `enhancedPrompts:getStatus` | **WORKING** | Full backend handler in `enhanced-prompts-rpc.handlers.ts`                                           |
| 7   | `startSetupWizard()`         | `wizard:start`              | **STUB**    | `console.warn` + `throw new Error('...not fully implemented')`. No backend handler registered.       |
| 8   | `submitAgentSelection()`     | `wizard:submit-selection`   | **STUB**    | `console.warn` + `throw new Error('...not yet implemented')`. No backend handler registered via RPC. |
| 9   | `cancelWizard()`             | `wizard:cancel`             | **STUB**    | `console.warn` + `throw new Error('...not yet implemented')`. No backend handler registered via RPC. |
| 10  | `retryGenerationItem()`      | `wizard:retry-item`         | **STUB**    | `console.warn` + `throw new Error('...not yet implemented')`. No backend handler registered.         |

### 2.2 Backend RPC Handlers Registered (`setup-rpc.handlers.ts`)

| #   | RPC Method                | Handler                     | Status      | Notes                                                                                |
| --- | ------------------------- | --------------------------- | ----------- | ------------------------------------------------------------------------------------ |
| 1   | `setup-status:get-status` | `registerGetStatus()`       | **WORKING** | Returns agent config status via SetupStatusService                                   |
| 2   | `setup-wizard:launch`     | `registerLaunchWizard()`    | **WORKING** | Creates webview panel via SetupWizardService.launchWizard()                          |
| 3   | `wizard:deep-analyze`     | `registerDeepAnalyze()`     | **WORKING** | Agentic analysis primary, hardcoded fallback. Premium+MCP required for agentic path. |
| 4   | `wizard:recommend-agents` | `registerRecommendAgents()` | **WORKING** | Zod validation + AgentRecommendationService.calculateRecommendations()               |
| 5   | `wizard:cancel-analysis`  | `registerCancelAnalysis()`  | **WORKING** | Aborts AbortController in AgenticAnalysisService                                     |

### 2.3 Backend Message Handlers (Architecture #2, in `setup-wizard.service.ts`)

These are registered as **webview message handlers** (not RPC handlers), inside the `launchWizard()` method's callback array:

| #   | Message Type                    | Handler Method             | Status                          | Notes                                                                                                                                                                                                      |
| --- | ------------------------------- | -------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `setup-wizard:start`            | `handleStartMessage()`     | **IMPLEMENTED but unreachable** | Full implementation exists: maps context, calls orchestrator.generateAgents(), forwards progress. But frontend never sends this message type via its current flow.                                         |
| 2   | `setup-wizard:submit-selection` | `handleSelectionMessage()` | **IMPLEMENTED but unreachable** | Full implementation exists: validates selection, calls orchestrator.generateAgents() with overrides. But `AgentSelectionComponent.onGenerateAgents()` calls the STUB `submitAgentSelection()` RPC instead. |
| 3   | `setup-wizard:cancel`           | `handleCancelMessage()`    | **IMPLEMENTED but unreachable** | Full implementation exists: saves progress, calls cleanup. But frontend's `cancelWizard()` RPC stub throws.                                                                                                |

### 2.4 Wizard Steps (Frontend Components)

| Step | Component                     | Backend Integration                                                    | Status                      | Details                                                                                                                                                                                                  |
| ---- | ----------------------------- | ---------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `WizardViewComponent`         | `license:getStatus` RPC                                                | **WORKING**                 | Premium gate via license RPC check. Shows upsell for non-premium.                                                                                                                                        |
| 1    | `WelcomeComponent`            | None (client-side only)                                                | **WORKING**                 | Sets step to 'scan' on click. No backend call needed.                                                                                                                                                    |
| 2    | `ScanProgressComponent`       | `wizard:deep-analyze` + `wizard:recommend-agents` RPC                  | **WORKING**                 | Calls `deepAnalyze()` then `recommendAgents()`. Receives broadcast progress via window message listener.                                                                                                 |
| 3    | `AnalysisResultsComponent`    | None (reads state from signals)                                        | **WORKING**                 | Displays deep analysis results. "Continue" sets step to 'selection'.                                                                                                                                     |
| 4    | `AgentSelectionComponent`     | `wizard:submit-selection` (STUB)                                       | **BROKEN**                  | `onGenerateAgents()` calls `wizardRpc.submitAgentSelection()` which always throws. User sees "Agent selection submission not yet implemented" error.                                                     |
| 5    | `GenerationProgressComponent` | `wizard:retry-item` (STUB) + `enhancedPrompts:runWizard` (WORKING)     | **PARTIALLY BROKEN**        | Component reads from `skillGenerationProgress` signal, which is never populated by the generation flow. Enhanced Prompts auto-trigger works once agents are "done". Retry button calls stub that throws. |
| 6    | `CompletionComponent`         | `SETUP_WIZARD_OPEN_AGENTS_FOLDER` + `SETUP_WIZARD_START_CHAT` messages | **WORKING (conditionally)** | Displays completed items and action buttons. But completion data is never set because generation never runs.                                                                                             |

---

## 3. Prompt Harness / Agentic Analysis Integration

### 3.1 Architecture Overview

The agentic analysis is the most sophisticated and best-implemented part of the wizard.

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`

**Flow**:

```
ScanProgressComponent.ngOnInit()
  -> wizardRpc.deepAnalyze()
    -> RPC: 'wizard:deep-analyze'
      -> setup-rpc.handlers.ts: registerDeepAnalyze()
        -> Checks isPremium && mcpServerRunning
        -> [PRIMARY] AgenticAnalysisService.analyzeWorkspace()
          -> InternalQueryService.execute() (Claude SDK session)
            -> System prompt: buildAnalysisSystemPrompt()
            -> 4 phases: discovery, architecture, health, quality
            -> Uses MCP tools: ptah.workspace.analyze(), ptah.search.findFiles(), ptah.diagnostics.getProblems()
            -> Streams progress via broadcastMessage() -> setup-wizard:scan-progress
            -> Streams transcript via broadcastMessage() -> setup-wizard:analysis-stream
            -> Parses JSON result from agent's response
            -> Validates with ProjectAnalysisZodSchema
            -> Normalizes with normalizeAgentOutput()
        -> [FALLBACK] SetupWizardService.performDeepAnalysis()
          -> DeepProjectAnalysisService.performDeepAnalysis()
            -> Hardcoded file-system-based analysis (no LLM)
```

### 3.2 Analysis System Prompt

Located in `agentic-analysis.service.ts`, the `buildAnalysisSystemPrompt()` function defines:

- **Phase markers**: Agent must emit `[PHASE:discovery]`, `[PHASE:architecture]`, `[PHASE:health]`, `[PHASE:quality]`
- **Detection markers**: Agent emits `[DETECTED:Angular]`, `[DETECTED:TypeScript]`, etc.
- **Tool usage rules**: Each MCP tool called exactly once
- **Final output**: JSON schema matching `ProjectAnalysisZodSchema`

### 3.3 Four Analysis Phases

Defined in `PHASE_LABELS` constant:

1. **Discovery**: `ptah.workspace.analyze()` + `ptah.search.findFiles()` - project type, frameworks, file count
2. **Architecture**: Folder structure examination for patterns (DDD, Layered, MVC, Microservices, Hexagonal)
3. **Health**: `ptah.diagnostics.getProblems()` - error/warning counts, linter/formatter configs
4. **Quality**: Test file discovery, coverage estimation, test framework identification

### 3.4 Progress Broadcasting

The `AgenticAnalysisService` broadcasts to the frontend in real-time:

1. **Scan progress** (`setup-wizard:scan-progress`): Phase markers, detections, agent reasoning text
2. **Analysis stream** (`setup-wizard:analysis-stream`): Full transcript with kinds: `text`, `tool_start`, `tool_input`, `tool_result`, `thinking`, `error`, `status`

These broadcasts are received by `SetupWizardStateService.setupMessageListener()` which processes them via a discriminated union switch statement.

### 3.5 Premium Gate

Agentic analysis requires `isPremium === true` AND `mcpServerRunning === true`. If either condition fails, it falls through to the hardcoded `DeepProjectAnalysisService` fallback.

---

## 4. Message Flow Diagram

### 4.1 Working Flow (Steps 0-3: License Check -> Welcome -> Scan -> Analysis)

```
FRONTEND                              BACKEND
--------                              -------
WizardViewComponent
  |
  +-- RPC: license:getStatus ---------> LicenseRpcHandlers
  |                                      |
  <-- { isPremium: true } ---------------+
  |
  +-- [Shows WelcomeComponent]
  |    User clicks "Start Setup"
  |    -> sets step to 'scan'
  |
  +-- [ScanProgressComponent mounts]
  |    |
  |    +-- RPC: wizard:deep-analyze ----> SetupRpcHandlers.registerDeepAnalyze()
  |    |                                   |
  |    |                                   +-- AgenticAnalysisService.analyzeWorkspace()
  |    |                                   |    |
  |    |    broadcastMessage() <-----------+    +-- InternalQueryService.execute()
  |    |    setup-wizard:scan-progress             |
  |    |    setup-wizard:analysis-stream           (Claude SDK session with MCP tools)
  |    |                                           |
  |    |                                   <-------+ JSON analysis result
  |    |                                   |
  |    <-- ProjectAnalysisResult ----------+
  |    |
  |    +-- state.setDeepAnalysis(result)
  |    |
  |    +-- RPC: wizard:recommend-agents -> SetupRpcHandlers.registerRecommendAgents()
  |    |                                   |
  |    |                                   +-- Zod validate + normalize
  |    |                                   +-- AgentRecommendationService.calculateRecommendations()
  |    |                                   |
  |    <-- AgentRecommendation[] ----------+
  |    |
  |    +-- state.setRecommendations(recs)
  |    +-- state.setCurrentStep('analysis')
  |
  +-- [AnalysisResultsComponent]
       User clicks "Continue"
       -> sets step to 'selection'
```

### 4.2 Broken Flow (Steps 4-6: Selection -> Generation -> Completion)

```
FRONTEND                              BACKEND
--------                              -------
AgentSelectionComponent
  |
  +-- User clicks "Generate N Agents"
  |    onGenerateAgents()
  |    |
  |    +-- wizardRpc.submitAgentSelection(selectedAgents)
  |    |    |
  |    |    +-- console.warn("not implemented")  <-- THROWS HERE
  |    |    +-- throw new Error("Agent selection submission not yet implemented")
  |    |
  |    +-- errorMessage.set(error.message)  <-- User sees error
  |
  X--- FLOW STOPS HERE - Never reaches generation step
  |
  [GenerationProgressComponent - NEVER MOUNTED in normal flow]
  |    (If forced to mount, reads empty skillGenerationProgress signal)
  |    (Enhanced Prompts auto-trigger fires but agents never "complete")
  |    (retryGenerationItem() stub throws)
  |
  [CompletionComponent - NEVER REACHED in normal flow]
       (Would display counts from empty skillGenerationProgress)
```

### 4.3 Backend Architecture #2 (Exists but Disconnected)

```
SetupWizardService.launchWizard()
  |
  +-- Creates webview panel with message handlers:
       |
       +-- 'setup-wizard:start'
       |    handleStartMessage() -> orchestrator.generateAgents() with progress callbacks
       |    (Would broadcast setup-wizard:scan-progress, setup-wizard:generation-progress)
       |
       +-- 'setup-wizard:submit-selection'
       |    handleSelectionMessage() -> orchestrator.generateAgents() with user overrides
       |    (Would broadcast setup-wizard:generation-progress)
       |
       +-- 'setup-wizard:cancel'
            handleCancelMessage() -> cancelWizard() with save option

These handlers listen for messages posted directly to the webview panel.
The frontend NEVER posts these message types because it uses the RPC layer instead.
```

---

## 5. Integration Gaps

### 5.1 Critical Gaps (Blocking End-to-End Flow)

| #   | Gap                                              | Impact                                                                                                                                                                                                                                                                                                                                   | Severity     |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| G1  | `submitAgentSelection()` is a stub               | Cannot transition from selection to generation. Wizard flow dead-ends at Step 4.                                                                                                                                                                                                                                                         | **CRITICAL** |
| G2  | No RPC handler for agent generation              | Backend `AgentGenerationOrchestratorService` exists but has no RPC entry point. The `setup-wizard:submit-selection` message handler in `SetupWizardService` calls it, but nothing reaches that handler.                                                                                                                                  | **CRITICAL** |
| G3  | `skillGenerationProgress` signal never populated | The generation progress UI reads from `wizardState.skillGenerationProgress()`, but no backend broadcast ever populates it. The backend broadcasts `setup-wizard:generation-progress` with a different payload shape (`GenerationProgressPayload.progress`) that maps to `generationProgressSignal`, not `skillGenerationProgressSignal`. | **CRITICAL** |
| G4  | `retryGenerationItem()` is a stub                | If generation had partial failures, retry would not work.                                                                                                                                                                                                                                                                                | **HIGH**     |

### 5.2 Moderate Gaps (Functional but Incomplete)

| #   | Gap                                                                                                      | Impact                                                                                                                                                                                     | Severity                        |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| G5  | `cancelWizard()` is a stub                                                                               | No graceful wizard cancellation with progress saving.                                                                                                                                      | **MEDIUM**                      |
| G6  | `startSetupWizard()` is a stub                                                                           | Unused -- the welcome step transitions client-side. Legacy method from older design.                                                                                                       | **LOW** (unused)                |
| G7  | No connection between backend `setup-wizard:generation-complete` broadcast and frontend `CompletionData` | `handleGenerationComplete()` in state service exists but backend never sends this message type through the working RPC flow.                                                               | **HIGH**                        |
| G8  | `setup-wizard:available-agents` broadcast has no sender                                                  | `handleAvailableAgents()` exists in state service but no backend code ever broadcasts this message type. Agents come through the direct RPC response to `wizard:recommend-agents` instead. | **LOW** (state is set directly) |

### 5.3 Architecture Mismatch

The root cause is an **architecture split** between two paradigms:

- **Architecture A (RPC request/response)**: Frontend calls `wizard:deep-analyze` via RPC, waits for response, sets state directly. This is what Steps 1-3 use. It works.

- **Architecture B (WebSocket-style broadcast)**: Backend pushes `setup-wizard:*` messages to frontend via `webviewManager.broadcastMessage()`. Frontend listens via `window.addEventListener('message')`. The state service's `handleScanProgress`, `handleAnalysisComplete`, `handleGenerationProgress`, `handleGenerationComplete` handlers are built for this. Steps 2-6 have message handlers ready but only scan-progress and analysis-stream messages actually get sent (from AgenticAnalysisService).

For the generation flow (Steps 4-6), **neither architecture is connected end-to-end**.

---

## 6. The Generation Pipeline (What Exists)

### 6.1 Backend Orchestrator

The `AgentGenerationOrchestratorService` exists at:
`D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`

It has a `generateAgents()` method that:

1. Accepts workspace URI, threshold, optional user overrides
2. Reports progress through a callback
3. Returns a Result with agents generated, success/failure counts

This service IS called by `SetupWizardService.handleStartMessage()` and `handleSelectionMessage()` -- but those handlers are unreachable as explained above.

### 6.2 Template System

Templates exist in `D:\projects\ptah-extension\libs\backend\agent-generation\templates\`:

- Agent templates for all 13 agent types
- Command templates (review-code, review-logic, review-security, orchestrate, orchestrate-help)
- Skill files (orchestration SKILL.md + references)

### 6.3 What Would Need to Happen

To make generation work, one of two approaches is needed:

**Option A: Add RPC handler for generation**

- Register a new `wizard:generate-agents` RPC handler in `setup-rpc.handlers.ts`
- Handler calls `AgentGenerationOrchestratorService.generateAgents()`
- Handler broadcasts progress via `setup-wizard:generation-progress` messages
- Handler broadcasts completion via `setup-wizard:generation-complete`
- Frontend `submitAgentSelection()` calls this new RPC method
- Frontend `GenerationProgressComponent` reads from broadcast-populated signals

**Option B: Connect frontend to existing message handlers**

- Make `AgentSelectionComponent.onGenerateAgents()` post a `setup-wizard:submit-selection` message directly to the webview panel instead of using the RPC layer
- This would reach the existing `handleSelectionMessage()` in `SetupWizardService`
- But this approach conflicts with the RPC architecture used everywhere else

---

## 7. Recommendations

### 7.1 Before Any UI Enhancements

These must be addressed first:

1. **Implement `wizard:generate-agents` RPC handler** (or rename/repurpose `submitAgentSelection`). This is the single most critical gap -- without it, the wizard cannot complete its primary purpose.

2. **Wire up `skillGenerationProgress` population**. The `GenerationProgressComponent` reads from this signal, but nothing writes to it. The backend needs to broadcast per-item progress in the `SkillGenerationProgressItem` format.

3. **Decide on Architecture A or B**. The codebase has both architectures partially implemented. Clean recommendation: **Use Architecture A (RPC) for request/response, Architecture B (broadcast) only for streaming progress**. This is already the pattern for deep analysis.

4. **Remove or mark deprecated stubs clearly**. The 4 stub methods in `wizard-rpc.service.ts` cause confusion. They should either be implemented or removed.

### 7.2 Prioritized Fix Order

| Priority | Item                                                                | Effort     | Impact                                |
| -------- | ------------------------------------------------------------------- | ---------- | ------------------------------------- |
| P0       | Implement generation RPC handler (connect orchestrator to frontend) | ~4 hours   | Unblocks entire generation flow       |
| P0       | Wire up skillGenerationProgress signal population                   | ~2 hours   | Makes progress UI functional          |
| P1       | Implement generation-complete broadcast                             | ~1 hour    | Enables auto-transition to completion |
| P1       | Implement cancelWizard via RPC                                      | ~1 hour    | User can cancel mid-generation        |
| P2       | Implement retryGenerationItem via RPC                               | ~2 hours   | Enables retry for partial failures    |
| P2       | Remove/deprecate unused stubs                                       | ~0.5 hours | Reduces confusion                     |
| P3       | Clean up dual-architecture confusion                                | ~3 hours   | Long-term maintainability             |

### 7.3 UI Enhancements Safe to Build Now

These are safe because they only touch working parts:

- Welcome step UI improvements (Step 1) -- purely client-side
- Analysis results display enhancements (Step 3) -- reads from already-populated signals
- Agent selection UI improvements (Step 4) -- reads from already-populated signals
- Scan progress visualization improvements (Step 2) -- reads from working broadcast messages
- Premium upsell UI improvements -- purely client-side

### 7.4 UI Enhancements NOT Safe to Build

These depend on broken functionality:

- Generation progress UI enhancements (Step 5) -- depends on working generation flow
- Completion screen enhancements (Step 6) -- depends on generation producing data
- Retry mechanism UI -- depends on working `retryGenerationItem` RPC
- Cancel during generation UI -- depends on working `cancelWizard` RPC

---

## 8. Risk Assessment

### What Happens If UI Enhancements Are Built on Top of Stubs

| Risk                                                   | Probability | Impact | Consequence                                                                                  |
| ------------------------------------------------------ | ----------- | ------ | -------------------------------------------------------------------------------------------- |
| Users reach Step 4 and see "not yet implemented" error | 100%        | HIGH   | Users lose trust; appears broken/unfinished                                                  |
| Generation progress UI shows permanent loading state   | 100%        | HIGH   | If Step 5 is somehow reached, no progress data populates                                     |
| Completion screen shows 0 agents generated             | 100%        | MEDIUM | If Step 6 is somehow reached, all counters are zero                                          |
| Enhanced Prompts never triggers in generation step     | ~80%        | LOW    | Auto-trigger checks `isGenerationComplete()` which reads empty signal, so it stays in 'idle' |
| Retry button always fails with "not yet implemented"   | 100%        | HIGH   | User frustration; no recovery path                                                           |

### Mitigation

If generation fixes cannot be done immediately, the wizard should **prevent the user from reaching Step 5** by either:

- Disabling the "Generate" button in Step 4 with a "Coming Soon" tooltip
- Showing an info banner that generation is under development
- Stopping the wizard at Step 3 (analysis results) with a "Download analysis results" option

---

## 9. File Reference

All file paths are absolute for Windows:

| File                                                                                                               | Purpose                                                    |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`                     | Frontend RPC facade (4 working + 4 stub methods)           |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`             | Frontend state management (signal-based, message listener) |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`            | Backend RPC handler registration (5 handlers)              |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`     | Agentic analysis (Claude SDK + MCP, 942 lines)             |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\setup-wizard.service.ts`                | Backend wizard facade (unreachable message handlers)       |
| `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\orchestrator.service.ts`                | Agent generation orchestrator (exists but disconnected)    |
| `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`                                       | Shared types: WizardMessage discriminated union, payloads  |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\wizard-view.component.ts`                | Main wizard container with step routing + license gate     |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\welcome.component.ts`                    | Step 1: Welcome screen                                     |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`              | Step 2: Scan progress with agentic analysis UI             |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\analysis-results.component.ts`           | Step 3: Analysis results display                           |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\agent-selection.component.ts`            | Step 4: Agent selection with scores                        |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\generation-progress.component.ts`        | Step 5: Generation progress (broken)                       |
| `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\completion.component.ts`                 | Step 6: Completion screen (unreachable)                    |
| `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\enhanced-prompts-rpc.handlers.ts` | Enhanced Prompts RPC handlers (working)                    |

---

## 10. Summary

**What WORKS end-to-end**: License check -> Welcome -> Deep Analysis (with agentic AI) -> Agent Recommendations -> Analysis Results Display -> Agent Selection UI

**What is BROKEN**: Agent Selection "Generate" button -> Generation Progress -> Completion

**Root cause**: The `submitAgentSelection()` RPC method in the frontend is a stub that throws. The backend has the generation logic implemented in `SetupWizardService.handleSelectionMessage()`, but it is registered as a webview message handler (Architecture B) that the frontend never invokes because it uses the RPC layer (Architecture A) instead.

**Bottom line**: The wizard is approximately **60% functional**. The analysis pipeline (the hardest part) works beautifully. The generation pipeline (connecting analysis to file generation) needs approximately 8-10 hours of engineering work to bridge the gap between the two architectures.
