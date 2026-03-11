# Development Tasks - TASK_2025_154

**Total Tasks**: 17 | **Batches**: 4 | **Status**: 4/4 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `InternalQueryService.execute()` pattern: Verified in `agentic-analysis.service.ts:193-208`. Config accepts `prompt`, `systemPromptAppend`, `maxTurns`, `abortController`, `outputFormat`, `mcpServerRunning`, `mcpPort`, `isPremium`.
- `SdkStreamProcessor` usage: Verified in `agentic-analysis.service.ts:349-357`. Construct with `{ emitter, timeout, logger, serviceTag }`, call `process(stream)`.
- `WebviewManager.broadcastMessage()` for progress: Verified in `agentic-analysis.service.ts:470-478`. Uses `MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS` and `MESSAGE_TYPES.SETUP_WIZARD_ANALYSIS_STREAM`.
- `AnalysisStorageService.slugify()` exists as private method: Verified at `analysis-storage.service.ts:37-43`. Must be made public or accessed via new public method.
- `PromptDesignerInput` does NOT have `additionalContext` field: Verified in `prompt-designer.types.ts:20-72`. Field must be added.
- `AgentProjectContext` does NOT have `analysisDir` field: Verified in `core.types.ts:295-347`. Field must be added.
- DI token pattern uses `Symbol.for()`: Verified in `tokens.ts`. All tokens follow `Symbol.for('DescriptiveName')`.
- DI registration pattern uses `container.register(TOKEN, { useClass }, { lifecycle: Lifecycle.Singleton })`: Verified in `register.ts`.

### Identified Risks

| Risk                                                                                                     | Severity | Mitigation                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Text capture from SdkStreamProcessor for markdown (non-JSON) output                                      | HIGH     | Architecture says to accumulate text deltas from stream events. Developer must verify how SdkStreamProcessor exposes text when `outputFormat` is not set. Fallback: read `result.result` from SDK result message.                        |
| Token overflow in Phase 4 (reads 3 previous phases via MCP)                                              | MED      | System prompt instructs agent to read files via MCP, keeping prompt compact. Architecture notes progressive truncation of Phase 1 first if needed.                                                                                       |
| `AnalysisStorageService` `slugify()` is private                                                          | LOW      | Task 1.2 explicitly makes it public. Simple change.                                                                                                                                                                                      |
| Cross-library DI: `EnhancedPromptsService` (agent-sdk) needs `AnalysisStorageService` (agent-generation) | MED      | Architecture uses `@optional()` injection. DI registration order must ensure `AnalysisStorageService` is registered before `EnhancedPromptsService` resolves it. Verified: `registerAgentGenerationServices()` runs before SDK services. |

### Edge Cases to Handle

- [ ] Phase failure should not block subsequent phases -> Handled in Task 2.1 (try/catch per phase)
- [ ] User cancellation preserves completed outputs -> Handled in Task 2.1 (master AbortController check)
- [ ] Missing phase files in Phase 5 synthesis -> Handled in Task 2.3 (check manifest status per phase)
- [ ] Multi-phase analysis directory doesn't exist when downstream reads -> Handled in Tasks 3.1, 3.2 (null checks, fallback to existing behavior)
- [ ] v1 and v2 analysis formats coexist -> Handled in Task 1.2 (`listAll()` combines both)

---

## Batch 1: Foundation Types + Storage v2 -- IN PROGRESS

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create multi-phase type definitions -- IMPLEMENTED

**Files to Create**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\multi-phase.types.ts`

**Files to Modify**: None
**Dependencies**: None
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Create the type definitions for the multi-phase analysis system. These types are used by the orchestrator service, storage service, and RPC layer.

**Key Implementation Details**:

- Define `MultiPhaseId` as union type: `'project-profile' | 'architecture-assessment' | 'quality-audit' | 'elevation-plan' | 'agent-context'`
- Define `PhaseResult` interface: `{ status: 'completed' | 'failed' | 'skipped'; file: string; durationMs: number; error?: string }`
- Define `MultiPhaseManifest` interface: `{ version: 2; slug: string; analyzedAt: string; model: string; totalDurationMs: number; phases: Record<MultiPhaseId, PhaseResult> }`
- Define `MultiPhaseAnalysisOptions` interface: `{ timeout?: number; model?: string; isPremium?: boolean; mcpServerRunning?: boolean; mcpPort?: number }`
- Define `PHASE_CONFIGS` constant array with `{ id, file, label }` for all 5 phases
- Export all types and the constant
- Reference: architecture.md Section 1.1 for exact interfaces

**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts` for type file structure

---

### Task 1.2: Extend AnalysisStorageService with v2 methods -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.ts`

**Dependencies**: Task 1.1
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Add v2 multi-phase analysis storage methods to the existing `AnalysisStorageService`. The existing v1 methods (save, list, load, delete) remain unchanged. New methods handle directory-based v2 storage with manifest.json.

**Key Implementation Details**:

- Add imports: `rm, stat as fsStat` from `fs/promises`; `MultiPhaseManifest` from the new types file
- Make `slugify()` method **public** (change `private` to `public`) -- it was private at line 37
- Make `getAnalysisDir()` method **public** (change `private` to `public`) -- it was private at line 29
- Add `getSlugDir(workspacePath: string, slug: string): string` - returns `join(getAnalysisDir(workspacePath), slug)`
- Add `async createSlugDir(workspacePath: string, projectDescription: string): Promise<{ slugDir: string; slug: string }>` - slugifies, removes existing dir, creates new
- Add `async writePhaseFile(slugDir: string, filename: string, content: string): Promise<void>` - writes UTF-8
- Add `async writeManifest(slugDir: string, manifest: MultiPhaseManifest): Promise<void>` - JSON.stringify with indent 2
- Add `async loadManifest(slugDir: string): Promise<MultiPhaseManifest | null>` - reads, parses, validates version === 2
- Add `async readPhaseFile(slugDir: string, filename: string): Promise<string | null>` - returns null on error
- Add `async findLatestMultiPhaseAnalysis(workspacePath: string): Promise<{ slugDir: string; manifest: MultiPhaseManifest } | null>` - scans for directories with valid manifests, returns most recent by `analyzedAt`
- Add `async listAll(workspacePath: string): Promise<SavedAnalysisMetadata[]>` - combines v1 `list()` + v2 directory scan, sorted by date descending
- Reference: architecture.md Section 2.3 for exact method signatures

**Pattern to Follow**: Existing methods in `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\analysis-storage.service.ts`

---

### Task 1.3: Extend shared types for v2 analysis phases and progress -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\setup-wizard.types.ts`

**Dependencies**: None
**Verification**: `npx nx run shared:typecheck`

**Description**:
Extend the `AnalysisPhase` type and `ScanProgressPayload` interface to support multi-phase analysis progress tracking.

**Key Implementation Details**:

- Extend `AnalysisPhase` type (line 758) to add v2 phases:
  ```typescript
  export type AnalysisPhase =
    | 'discovery'
    | 'architecture'
    | 'health'
    | 'quality' // v1 (kept for backward compat)
    | 'project-profile'
    | 'architecture-assessment'
    | 'quality-audit'
    | 'elevation-plan'
    | 'synthesis'; // v2
  ```
- Add multi-phase fields to `ScanProgressPayload` (line 768):
  - `currentPhaseNumber?: number` - 1-based phase number
  - `totalPhaseCount?: number` - total number of phases
  - `phaseStatuses?: Array<{ id: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' }>`
- Reference: architecture.md Section 5.1 and 5.2

**Pattern to Follow**: Existing `ScanProgressPayload` structure at line 768

---

### Task 1.4: Add `analysisDir` to `AgentProjectContext` -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\types\core.types.ts`

**Dependencies**: None
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Add the optional `analysisDir` field to `AgentProjectContext` so `ContentGenerationService` can use it to read rich analysis files.

**Key Implementation Details**:

- Add after the `fullAnalysis` field (line 346):
  ```typescript
  /**
   * Path to the multi-phase analysis directory.
   * When present, ContentGenerationService reads rich analysis files
   * instead of using formatAnalysisData().
   */
  analysisDir?: string;
  ```
- Reference: architecture.md Section 4.1

**Pattern to Follow**: Existing optional fields in `AgentProjectContext`

---

**Batch 1 Verification**:

- All files exist at listed paths
- Build passes: `npx nx run agent-generation:typecheck && npx nx run shared:typecheck`
- code-logic-reviewer approved
- No stubs or TODOs

---

## Batch 2: Core Pipeline -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 5 | **Dependencies**: Batch 1

### Task 2.1: Create MultiPhaseAnalysisService orchestrator -- IMPLEMENTED

**Files to Create**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-analysis.service.ts`

**Dependencies**: Tasks 1.1, 1.2, 1.3
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Create the main orchestrator service that executes 4 sequential LLM phases + 1 deterministic synthesis phase. This is the core service for the multi-phase analysis pipeline.

**Key Implementation Details**:

- Use `@injectable()` decorator, follow `AgenticAnalysisService` pattern for constructor injection
- Inject: `TOKENS.LOGGER`, `TOKENS.CONFIG_MANAGER`, `TOKENS.WEBVIEW_MANAGER`, `SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE`, `AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE`
- Import `MultiPhaseManifest`, `MultiPhaseAnalysisOptions`, `PHASE_CONFIGS`, `MultiPhaseId`, `PhaseResult` from `../../types/multi-phase.types`
- Import `SdkStreamProcessor`, `StreamEventEmitter`, `StreamEvent` from `@ptah-extension/agent-sdk`
- Import `Result`, `MESSAGE_TYPES`, `AnalysisStreamPayload` from `@ptah-extension/shared`
- Import prompt builders from `./multi-phase-prompts`

**Main method `analyzeWorkspace(workspaceUri, options)`**:

1. Validate `isPremium` and `mcpServerRunning` (return `Result.err` if not met)
2. Create master `AbortController`, store as `this.activeAbortController`
3. Call `storageService.createSlugDir()` to create/overwrite slug directory
4. Loop through PHASE_CONFIGS[0..3] (phases 1-4):
   - Create per-phase AbortController linked to master
   - Build system/user prompts using prompt builder functions (pass `slugDir` for phases 2-4)
   - Call `internalQueryService.execute()` with: `cwd`, `model`, `prompt` (user prompt), `systemPromptAppend` (system prompt), `isPremium`, `mcpServerRunning`, `mcpPort`, `maxTurns: 50`, `abortController` (per-phase), NO `outputFormat` (markdown output)
   - Process stream for progress events and text capture
   - Extract final text from stream processing
   - Write markdown to slug directory via `storageService.writePhaseFile()`
   - Record `PhaseResult` in manifest
   - On failure: log error, mark phase as `failed`, continue to next phase
   - On master abort: mark remaining phases as `skipped`, break
5. Run Phase 5 `synthesizeAgentContext()` (deterministic, no LLM)
6. Write `manifest.json` via `storageService.writeManifest()`
7. Return `Result.ok(manifest)`

**Stream processing per phase**:

- Create `SdkStreamProcessor` with emitter that broadcasts to both `SETUP_WIZARD_ANALYSIS_STREAM` and `SETUP_WIZARD_SCAN_PROGRESS`
- Accumulate text from stream `text` events into a buffer
- Also check result message for final text as fallback
- Broadcast phase progress with `currentPhaseNumber`, `totalPhaseCount`, `phaseStatuses`

**Text capture strategy**:

- The emitter callback accumulates text content from `text` kind events
- After `processor.process(stream)` completes, the accumulated buffer contains the full markdown
- Fallback: if buffer is empty, try extracting from SDK result message

**Phase 5 `synthesizeAgentContext()`**:

- Pure TypeScript, no LLM call
- Read completed phase files from disk using `storageService.readPhaseFile()`
- Build sections: "For All Agents" (phases 1-2), "For Backend Agents", "For Frontend Agents", "For QA Agents" (quality audit), "For Architecture Agents" (phases 2+4)
- Handle missing phases gracefully (note the gap)
- Write to `05-agent-context.md`

**`cancelAnalysis()` method**: Abort the master controller, same pattern as `AgenticAnalysisService.cancelAnalysis()`

- Reference: architecture.md Sections 1.1-1.5 for complete implementation

**Pattern to Follow**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`

---

### Task 2.2: Create phase prompt builders -- IMPLEMENTED

**Files to Create**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\multi-phase-prompts.ts`

**Dependencies**: None (pure functions)
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Create the system prompt and user prompt builder functions for phases 1-4. Each function returns `{ systemPrompt: string; userPrompt: string }`.

**Key Implementation Details**:

- `buildPhase1Prompts()`: Factual project profile. Output contract: Tech Stack, Dependencies, File Structure, Entry Points & Configuration, Monorepo Structure, Language Distribution. ZERO opinions.
- `buildPhase2Prompts(slugDir: string)`: Architecture assessment. References `${slugDir}/01-project-profile.md`. Output contract: Detected Patterns, Pattern Consistency, Dependency Flow, Coupling Analysis, State Management, Pattern Comparison.
- `buildPhase3Prompts(slugDir: string)`: Quality audit. References phases 1-2 files. Output contract: Overall Quality Score, File-Level Findings, Anti-Pattern Inventory, Type Safety, Error Handling, Security Concerns, Test Coverage, Strengths.
- `buildPhase4Prompts(slugDir: string)`: Elevation plan. References phases 1-3 files. Output contract: Priority Tiers (Quick Wins, Small, Medium, Large), before/after code examples, Summary Matrix.
- Export all 4 functions
- Reference: architecture.md Section 3.2-3.5 for exact prompt text

**Pattern to Follow**: `buildAnalysisSystemPrompt()` in `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts:85-122`

---

### Task 2.3: Add DI token and register MultiPhaseAnalysisService -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\tokens.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\di\register.ts`

**Dependencies**: Task 2.1
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Add the DI token for `MultiPhaseAnalysisService` and register it in the DI container.

**Key Implementation Details**:

**In `tokens.ts`**:

- Add new token after `ANALYSIS_STORAGE_SERVICE` (line 191):
  ```typescript
  /**
   * MultiPhaseAnalysisService - Multi-phase workspace analysis orchestrator
   * Responsibilities: Execute 4 LLM phases + 1 deterministic synthesis, write markdown outputs, manage manifests
   */
  export const MULTI_PHASE_ANALYSIS_SERVICE = Symbol.for('MultiPhaseAnalysisService');
  ```
- Add `MULTI_PHASE_ANALYSIS_SERVICE` to the `AGENT_GENERATION_TOKENS` object (inside the "Agentic Analysis" section, after line 236)

**In `register.ts`**:

- Import `MultiPhaseAnalysisService` from `'../services/wizard'`
- Add registration after `AGENTIC_ANALYSIS_SERVICE` registration (around line 133):
  ```typescript
  // Multi-phase analysis service - 4 LLM phases + deterministic synthesis
  container.register(AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE, { useClass: MultiPhaseAnalysisService }, { lifecycle: Lifecycle.Singleton });
  ```
- Add `'MULTI_PHASE_ANALYSIS_SERVICE'` to the logger.info services array

**Pattern to Follow**: Existing token definitions and registrations in the same files

---

### Task 2.4: Update barrel exports for wizard and types -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts`

**Dependencies**: Tasks 2.1, 2.2
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
Export the new `MultiPhaseAnalysisService` and multi-phase types from barrel files.

**Key Implementation Details**:

**In `wizard/index.ts`**:

- Add export: `export { MultiPhaseAnalysisService } from './multi-phase-analysis.service';`

**In `src/index.ts`**:

- Add export for MultiPhaseAnalysisService in the wizard exports section:
  ```typescript
  export { MultiPhaseAnalysisService } from './lib/services/wizard';
  ```
  (add to the existing export block from `'./lib/services/wizard'`)
- Add export for multi-phase types:
  ```typescript
  export type { MultiPhaseManifest, PhaseResult, MultiPhaseAnalysisOptions, MultiPhaseId } from './lib/types/multi-phase.types';
  export { PHASE_CONFIGS } from './lib/types/multi-phase.types';
  ```

**Pattern to Follow**: Existing exports in both files

---

### Task 2.5: Add `additionalContext` to `PromptDesignerInput` -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\prompt-designer\prompt-designer.types.ts`

**Dependencies**: None
**Verification**: `npx nx run agent-sdk:typecheck`

**Description**:
Add the `additionalContext` optional field to `PromptDesignerInput` so that `EnhancedPromptsService` can pass quality audit and elevation plan content.

**Key Implementation Details**:

- Add after `includeQualityGuidance` field (line 71):
  ```typescript
  /**
   * Additional analysis context from multi-phase analysis.
   * When present, includes quality audit findings and elevation plan priorities
   * for richer prompt generation.
   * @since TASK_2025_154
   */
  additionalContext?: string;
  ```
- Reference: architecture.md Section 4.2

**Pattern to Follow**: Existing optional fields in `PromptDesignerInput`

---

**Batch 2 Verification**:

- All files exist at listed paths
- Build passes: `npx nx run agent-generation:typecheck && npx nx run agent-sdk:typecheck`
- code-logic-reviewer approved
- No stubs or TODOs
- `MultiPhaseAnalysisService` has real orchestration logic (not empty methods)

---

## Batch 3: Downstream Integration -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2

### Task 3.1: Integrate multi-phase analysis into ContentGenerationService -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\content-generation.service.ts`

**Dependencies**: Tasks 1.4, 2.4
**Verification**: `npx nx run agent-generation:typecheck`

**Description**:
When `AgentProjectContext.analysisDir` is set, read role-specific analysis content from `05-agent-context.md` instead of using `formatAnalysisData()`.

**Key Implementation Details**:

- Add imports: `readFileSync` from `fs`, `join` from `path`
- Modify `buildAllSectionsPrompt()` method (line 342):

  - Before calling `this.formatAnalysisData(context)`, check if `context.analysisDir` is set
  - If set, call new method `this.readRoleSpecificContext(context.analysisDir, templateName)`
  - If not set or method returns empty, fallback to `this.formatAnalysisData(context)`

- Add `private readRoleSpecificContext(analysisDir: string, templateName: string): string`:

  - Read `join(analysisDir, '05-agent-context.md')` using `readFileSync` (sync because existing flow is sync-compatible)
  - Extract "For All Agents" section (always included)
  - Extract role-specific section based on template name using `getRoleSectionForTemplate()`
  - Combine both sections
  - Token budget check: if combined.length > 50,000 chars, truncate "For All Agents" content first
  - On any error (file missing, read failure): return empty string (caller falls back to `formatAnalysisData`)

- Add `private getRoleSectionForTemplate(templateName: string): string | null`:

  - If templateName includes 'backend' -> 'For Backend Agents'
  - If templateName includes 'frontend' -> 'For Frontend Agents'
  - If templateName includes 'tester' or 'qa' -> 'For QA Agents'
  - If templateName includes 'architect' -> 'For Architecture Agents'
  - Otherwise -> null (use "For All Agents" only)

- Add `private extractSection(content: string, sectionName: string): string`:

  - Regex: `/## ${sectionName}\n([\s\S]*?)(?=\n## |$)/`
  - Return matched group 1 trimmed, or empty string

- Reference: architecture.md Section 4.1

**Pattern to Follow**: Existing `formatAnalysisData()` method at line 475-567

---

### Task 3.2: Integrate multi-phase analysis into EnhancedPromptsService -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts`

**Dependencies**: Tasks 1.2, 2.5
**Verification**: `npx nx run agent-sdk:typecheck`

**Description**:
When multi-phase analysis exists for the workspace, incorporate quality audit findings and elevation plan priorities into the `PromptDesignerInput` for richer enhanced prompt generation.

**Key Implementation Details**:

- Add import for `AGENT_GENERATION_TOKENS` from `@ptah-extension/agent-generation`
- Add import for `optional` from `tsyringe`
- Add optional injection of `AnalysisStorageService` in constructor:

  ```typescript
  @inject(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE) @optional()
  private readonly analysisStorageService?: any,  // Use 'any' to avoid cross-library type import issue, or import the type
  ```

  NOTE: Since `EnhancedPromptsService` is in `agent-sdk` and `AnalysisStorageService` is in `agent-generation`, use the DI token for injection. The type can be imported as a type-only import if the build supports it, otherwise use a minimal interface.

- In `runWizard()` method, after building the `input` (around line 280 for preComputed path, or after Step 3 for the analysis path):

  - Check if `this.analysisStorageService` exists
  - If yes, call `findLatestMultiPhaseAnalysis(workspacePath)`
  - If multi-phase analysis found, read `03-quality-audit.md` and `04-elevation-plan.md` via `readPhaseFile()`
  - Set `input.additionalContext` with truncated content (quality audit max 10,000 chars, elevation plan max 5,000 chars)

- The `PromptDesignerAgent.buildPrompts()` will naturally include `additionalContext` in the user prompt

- IMPORTANT: Handle the case where `analysisStorageService` is null/undefined (not injected). This is the fallback path -- existing behavior unchanged.

- Reference: architecture.md Section 4.2

**Pattern to Follow**: Existing `runWizard()` method in `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\prompt-harness\enhanced-prompts\enhanced-prompts.service.ts:251-320`

---

**Batch 3 Verification**:

- All modified files compile
- Build passes: `npx nx run agent-generation:typecheck && npx nx run agent-sdk:typecheck`
- code-logic-reviewer approved
- Fallback behavior preserved (when analysisDir is null or multi-phase analysis doesn't exist)

---

## Batch 4: RPC Wiring + Frontend Progress -- IMPLEMENTED

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 3

### Task 4.1: Add RPC types for multi-phase analysis -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\shared\src\lib\types\rpc.types.ts`

**Dependencies**: None
**Verification**: `npx nx run shared:typecheck`

**Description**:
Add the RPC parameter and response types for the `wizard:start-multi-phase-analysis` method.

**Key Implementation Details**:

- Add after existing wizard RPC types:

  ```typescript
  // ============================================================
  // Multi-Phase Analysis RPC Types (TASK_2025_154)
  // ============================================================

  export interface WizardStartMultiPhaseParams {
    /** Workspace path to analyze */
    workspacePath: string;
    /** Model to use for analysis (optional, uses configured default) */
    model?: string;
  }

  export interface WizardStartMultiPhaseResult {
    /** Whether analysis started/completed successfully */
    success: boolean;
    /** Error message if failed */
    error?: string;
  }
  ```

**Pattern to Follow**: Existing RPC type definitions in the file

---

### Task 4.2: Add RPC handler for multi-phase analysis -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\wizard-generation-rpc.handlers.ts`

**Dependencies**: Tasks 2.1, 2.3, 4.1
**Verification**: `npx nx run ptah-extension-vscode:typecheck`

**Description**:
Add the `wizard:start-multi-phase-analysis` RPC handler to `WizardGenerationRpcHandlers`. This handler resolves `MultiPhaseAnalysisService` from DI and invokes `analyzeWorkspace()`.

**Key Implementation Details**:

- Import `WizardStartMultiPhaseParams`, `WizardStartMultiPhaseResult` from `@ptah-extension/shared`
- Import `MultiPhaseAnalysisService` type (or use DI resolution with token)
- In the `register()` method, add a new RPC method registration:

  ```typescript
  this.rpcHandler.register('wizard:start-multi-phase-analysis', async (params: WizardStartMultiPhaseParams) => {
    // Resolve services from container
    const multiPhaseService = this.container.resolve(AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE);
    const licenseService = this.container.resolve<LicenseService>(TOKENS.LICENSE_SERVICE);

    // Get MCP status
    const mcpServer = this.container.resolve(CodeExecutionMCP);

    const workspaceUri = vscode.Uri.file(params.workspacePath);
    const result = await multiPhaseService.analyzeWorkspace(workspaceUri, {
      model: params.model,
      isPremium: licenseService.isPremium(),
      mcpServerRunning: mcpServer.isRunning(),
      mcpPort: mcpServer.getPort(),
    });

    if (result.isErr()) {
      return { success: false, error: result.error.message };
    }
    return { success: true };
  });
  ```

- Also add `wizard:cancel-multi-phase-analysis` handler that calls `multiPhaseService.cancelAnalysis()`
- Reference: architecture.md Section 4.3

**Pattern to Follow**: Existing handlers in the same file (e.g., `handleSubmitSelection` pattern)

---

### Task 4.3: Register new RPC methods -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts`

**Dependencies**: Task 4.2
**Verification**: `npx nx run ptah-extension-vscode:typecheck`

**Description**:
Ensure the new RPC methods are registered via the existing `WizardGenerationRpcHandlers`. Since Task 4.2 adds methods inside the existing handler's `register()` method, this task only needs to verify the RPC method registry includes the new methods.

**Key Implementation Details**:

- Check if `verifyRpcRegistration` has a registry of expected methods. If so, add `'wizard:start-multi-phase-analysis'` and `'wizard:cancel-multi-phase-analysis'` to that registry.
- If the registry is auto-detected from registered handlers, no changes needed here -- verify by reading the `verifyRpcRegistration` implementation.
- Reference: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\rpc-method-registration.service.ts:134-147`

**Pattern to Follow**: Existing RPC registration flow

---

### Task 4.4: Ensure DI container resolves MultiPhaseAnalysisService -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\di\container.ts`

**Dependencies**: Task 2.3
**Verification**: `npx nx run ptah-extension-vscode:typecheck`

**Description**:
Verify that `MultiPhaseAnalysisService` is available in the DI container. Since Task 2.3 adds the registration in `registerAgentGenerationServices()`, and `container.ts` already calls that function, this task may only need verification. However, if any manual container configuration is needed, add it.

**Key Implementation Details**:

- Read `container.ts` to verify `registerAgentGenerationServices()` is called
- If the token is registered in `register.ts` (Task 2.3) and `registerAgentGenerationServices()` is called during activation, no changes needed
- If container has explicit resolution or eager initialization, add `MULTI_PHASE_ANALYSIS_SERVICE` appropriately

**Pattern to Follow**: Existing service resolution in container.ts

---

### Task 4.5: Add multi-phase progress tracking to frontend state service -- IMPLEMENTED

**Files to Modify**:

- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\setup-wizard-state.service.ts`

**Dependencies**: Task 1.3
**Verification**: `npx nx run setup-wizard:typecheck`

**Description**:
Add signal-based multi-phase progress tracking to `SetupWizardStateService`. The frontend already listens for `SETUP_WIZARD_SCAN_PROGRESS` messages; this task adds signals to expose the new multi-phase fields.

**Key Implementation Details**:

- Add new signals:

  ```typescript
  private readonly _currentPhaseNumber = signal<number | null>(null);
  private readonly _totalPhaseCount = signal<number | null>(null);
  private readonly _phaseStatuses = signal<Array<{ id: string; status: string }>>([]);

  readonly currentPhaseNumber = this._currentPhaseNumber.asReadonly();
  readonly totalPhaseCount = this._totalPhaseCount.asReadonly();
  readonly phaseStatuses = this._phaseStatuses.asReadonly();

  readonly isMultiPhaseAnalysis = computed(() => this._totalPhaseCount() !== null && this._totalPhaseCount()! > 0);
  ```

- In the existing message handler for `ScanProgressPayload`, add extraction of new fields:
  ```typescript
  if (payload.currentPhaseNumber !== undefined) {
    this._currentPhaseNumber.set(payload.currentPhaseNumber);
  }
  if (payload.totalPhaseCount !== undefined) {
    this._totalPhaseCount.set(payload.totalPhaseCount);
  }
  if (payload.phaseStatuses) {
    this._phaseStatuses.set(payload.phaseStatuses);
  }
  ```
- Add reset logic in the existing `reset()` or equivalent method

**Pattern to Follow**: Existing signal patterns in the same file

---

### Task 4.6: Add RPC method to verifyRpcRegistration registry -- IMPLEMENTED

**Files to Modify**: Depends on where the RPC method registry is defined

**Dependencies**: Task 4.2
**Verification**: `npx nx run ptah-extension-vscode:typecheck`

**Description**:
Add the new `wizard:start-multi-phase-analysis` and `wizard:cancel-multi-phase-analysis` methods to the RPC method registry that `verifyRpcRegistration` checks against. This ensures the verification step at startup doesn't flag these as missing.

**Key Implementation Details**:

- Find the RPC method registry (likely in `@ptah-extension/vscode-core` or a config file)
- Add both new method names to the registry
- This is a simple string addition to an array/set

**Pattern to Follow**: Existing entries in the RPC method registry

---

**Batch 4 Verification**:

- All files compile
- Build passes: `npx nx run ptah-extension-vscode:typecheck && npx nx run shared:typecheck && npx nx run setup-wizard:typecheck`
- code-logic-reviewer approved
- RPC methods respond correctly (manual test via extension)
- Frontend signals update when progress messages arrive

---

## Summary

| Batch | Name                           | Tasks | Developer         | Dependencies |
| ----- | ------------------------------ | ----- | ----------------- | ------------ |
| 1     | Foundation Types + Storage v2  | 4     | backend-developer | None         |
| 2     | Core Pipeline                  | 5     | backend-developer | Batch 1      |
| 3     | Downstream Integration         | 2     | backend-developer | Batch 2      |
| 4     | RPC Wiring + Frontend Progress | 6     | backend-developer | Batch 3      |
