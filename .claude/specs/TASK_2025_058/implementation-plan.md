# Implementation Plan - TASK_2025_058

# Intelligent Project-Adaptive Agent Generation System

**Task ID**: TASK_2025_058
**Created**: 2025-12-08
**Type**: Architecture Specification
**Status**: READY FOR VALIDATION

---

## 📊 Codebase Investigation Summary

### Libraries Analyzed

**1. workspace-intelligence** (`libs/backend/workspace-intelligence/`)

- **Purpose**: Comprehensive workspace analysis, file indexing, project detection
- **Key Exports Verified**:
  - `ContextOrchestrationService` - Main facade for workspace operations
  - `ProjectDetectorService` - 13 project types (Node, React, Angular, Python, etc.)
  - `FrameworkDetectorService` - Framework identification from package.json
  - `MonorepoDetectorService` - 6 monorepo types (Nx, Lerna, Turborepo, etc.)
  - `WorkspaceAnalyzerService` - Deep workspace structure analysis
  - `FileRelevanceScorerService` - Query-based file ranking
  - `WorkspaceIndexerService` - Async file discovery with token counting
- **Documentation**: `libs/backend/workspace-intelligence/CLAUDE.md` (verified)
- **Evidence**: 15+ services, complete type system, production-ready

**2. template-generation** (`libs/backend/template-generation/`)

- **Purpose**: Template rendering infrastructure (from RooCode migration)
- **Key Exports Verified**:
  - `TemplateGeneratorService` - Main entry point (line 20)
  - `ITemplateManager` - Template loading interface (line 6)
  - `ITemplateOrchestrator` - Generation orchestration interface
  - `ProjectContext` interface - Project metadata structure
  - `ProjectConfig` interface - Generation configuration
- **Documentation**: No CLAUDE.md found (technical gap)
- **Evidence**: Working implementation, DI integration, Result pattern usage
- **Integration Point**: Already uses WorkspaceAnalyzerService (line 24)

**3. llm-abstraction** (`libs/backend/llm-abstraction/`)

- **Purpose**: Multi-provider LLM abstraction (Anthropic, OpenAI, Google, OpenRouter)
- **Key Exports Verified**:
  - `LlmService` - Main orchestration service (line 40)
  - `ILlmProvider` - Provider interface
  - `getCompletion()` - Text completion method (line 89)
  - `getStructuredCompletion()` - Schema-validated completion (line 139)
- **Evidence**: Full implementation with Zod schema validation, LangChain integration
- **Integration Note**: NOT VS Code LM API - uses external providers

**4. vscode-core** (`libs/backend/vscode-core/`)

- **Purpose**: DI container, VS Code API wrappers, Logger
- **Key Exports Verified**:
  - `TOKENS` - DI token registry (60+ tokens)
  - `Logger` - Structured logging service
  - DI registration patterns
- **Evidence**: Production-ready infrastructure library

### Patterns Identified

**1. Dependency Injection Pattern**

- **Evidence**: All services use `@injectable()` decorator (tsyringe)
- **Example**: `TemplateGeneratorService` (template-generator.service.ts:19-27)
- **Convention**: Constructor injection with `@inject(TOKENS.X)`
- **Registration**: Dedicated `registration.ts` files per library

**2. Result Pattern for Error Handling**

- **Evidence**: `Result<T, E>` from `@ptah-extension/shared` used everywhere
- **Example**: `generateTemplates()` returns `Result<string, Error>` (template-generator.service.ts:36)
- **Convention**: `Result.ok(value)` for success, `Result.err(error)` for failure
- **Benefits**: Type-safe error handling, no exceptions

**3. Service Orchestration Pattern**

- **Evidence**: High-level services compose low-level services
- **Example**: `TemplateGeneratorService` → `WorkspaceAnalyzerService` + `ITemplateOrchestrator`
- **Convention**: Main service delegates to specialized services via DI

**4. YAML Frontmatter Pattern**

- **Evidence**: Agent discovery uses `gray-matter` for YAML parsing
- **Location**: `autocomplete/agent-discovery.service.ts` (workspace-intelligence)
- **Convention**: Markdown files with YAML frontmatter for metadata

### Integration Points

**1. WorkspaceAnalyzerService** (workspace-intelligence)

- **Location**: `libs/backend/workspace-intelligence/src/workspace/workspace-analyzer.service.ts`
- **Interface**: `getProjectInfo(): Promise<ProjectInfo>`
- **Returns**: Project name, type, dependencies, file stats, git repo status
- **Usage**: Already integrated in template-generation (verified)

**2. ProjectDetectorService** (workspace-intelligence)

- **Location**: `libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`
- **Interface**: `detectProjectType(workspaceUri: vscode.Uri): Promise<ProjectType>`
- **Returns**: Enum value (ProjectType.Angular, ProjectType.Node, etc.)
- **Evidence**: 13 project types supported

**3. MonorepoDetectorService** (workspace-intelligence)

- **Location**: `libs/backend/workspace-intelligence/src/project-analysis/monorepo-detector.service.ts`
- **Interface**: `detectMonorepo(workspaceUri: vscode.Uri): Promise<MonorepoInfo>`
- **Returns**: `{ isMonorepo, type, packageCount, workspaceFiles }`
- **Evidence**: 6 monorepo types (Nx, Lerna, Rush, Turborepo, pnpm, yarn)

**4. VS Code LM API** (External)

- **Status**: NOT currently integrated (uses llm-abstraction instead)
- **Gap**: Need to create VS Code LM API wrapper service
- **API**: `vscode.lm.sendRequest()` (VS Code extension API)
- **Evidence**: Research report mentions VS Code LM API, but no implementation found

### Evidence Provenance

**Decision**: Use workspace-intelligence for project analysis
**Evidence**:

- Definition: `libs/backend/workspace-intelligence/src/index.ts` (exports verified)
- Integration: `libs/backend/template-generation/src/lib/services/template-generator.service.ts:24` (already used)
- Capabilities: 13 project types, 6 monorepo types, framework detection, file indexing
- Documentation: `libs/backend/workspace-intelligence/CLAUDE.md` (comprehensive)

**Decision**: Extend template-generation library for agent templates
**Evidence**:

- Existing infrastructure: `TemplateGeneratorService`, `ITemplateManager`, `ProjectContext`
- Integration point: Already orchestrates WorkspaceAnalyzerService
- Pattern: Proven template rendering with variable substitution
- Gap: No agent-specific template format (need to design)

**Decision**: Create new VS Code LM integration service
**Evidence**:

- llm-abstraction uses external providers (Anthropic, OpenAI), not VS Code LM API
- Research report specifies VS Code LM API requirement
- No existing VS Code LM wrapper found in codebase
- **REQUIRES NEW IMPLEMENTATION**

---

## 🏗️ Architecture Design (Codebase-Aligned)

### Design Philosophy

**Chosen Approach**: Service-Oriented Architecture with Dependency Injection
**Rationale**:

- Matches existing Ptah architecture (all libraries use DI)
- Proven patterns: workspace-intelligence, template-generation already working
- Extensibility: New services integrate via DI tokens
- Testability: Services mock cleanly for unit tests

**Evidence**:

- `libs/backend/workspace-intelligence/` - 15+ services with DI (verified)
- `libs/backend/template-generation/` - Service orchestration pattern (verified)
- `libs/backend/vscode-core/` - 60+ DI tokens, registration patterns (verified)

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                          Ptah Extension                                   │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │         Setup Wizard Webview (Frontend - Angular)                   │  │
│  │                                                                      │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐    │  │
│  │  │  Welcome     │  │   Workspace  │  │   Analysis Results    │    │  │
│  │  │  Component   │→ │   Scan       │→ │   Review Component    │    │  │
│  │  └──────────────┘  │   Progress   │  └───────────────────────┘    │  │
│  │                    │   Component  │           ↓                     │  │
│  │                    └──────────────┘  ┌───────────────────────┐    │  │
│  │                                      │   Agent Selection     │    │  │
│  │                                      │   Component           │    │  │
│  │                                      └───────────────────────┘    │  │
│  │                                               ↓                     │  │
│  │                                      ┌───────────────────────┐    │  │
│  │                                      │   Generation Progress │    │  │
│  │                                      │   Component           │    │  │
│  │                                      └───────────────────────┘    │  │
│  │                                               ↓                     │  │
│  │                                      ┌───────────────────────┐    │  │
│  │                                      │   Completion         │    │  │
│  │                                      │   Component          │    │  │
│  │                                      └───────────────────────┘    │  │
│  └─────────────────────────┬────────────────────────────────────────┘  │
│                            │ RPC Messages                                │
│                            ↓                                             │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │       SetupWizardService (Backend - VS Code Extension)             │  │
│  │  Responsibilities:                                                  │  │
│  │  - Orchestrates 6-step wizard flow                                 │  │
│  │  - Manages UI state transitions (Welcome→Scan→Review→Select→       │  │
│  │    Generate→Complete)                                              │  │
│  │  - Coordinates RPC message handling                                 │  │
│  │  - Tracks wizard progress and session state                         │  │
│  │  - Provides cancellation and resume support                         │  │
│  └──────────┬─────────────────────────────────────────────────────────┘  │
│             │                                                              │
│             ↓                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │     AgentGenerationOrchestratorService (Core Coordinator)          │  │
│  │  Responsibilities:                                                  │  │
│  │  - End-to-end agent generation workflow                            │  │
│  │  - Coordinates: Analysis → Selection → Customization → Rendering  │  │
│  │  - Error handling and recovery                                     │  │
│  │  - Progress tracking and reporting                                 │  │
│  │  - Atomic file operations (all succeed or all rollback)            │  │
│  └──┬──┬──┬──┬──┬──────────────────────────────────────────────────────┘  │
│     │  │  │  │  │                                                          │
│     ↓  ↓  ↓  ↓  ↓                                                          │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ Backend Services (DI Container - tsyringe)                            │ │
│  │                                                                        │ │
│  │  ┌───────────────────────────┐  ┌──────────────────────────────┐    │ │
│  │  │ WorkspaceAnalysisService  │  │ AgentSelectionService        │    │ │
│  │  │ (workspace-intelligence)  │  │ (NEW - agent-generation)     │    │ │
│  │  │ - detectProjectType()     │  │ - scoreAgentRelevance()      │    │ │
│  │  │ - getFrameworks()         │  │ - selectAgents()             │    │ │
│  │  │ - detectMonorepo()        │  │ - applyUserOverrides()       │    │ │
│  │  │ - getProjectInfo()        │  │ - logSelectionReasons()      │    │ │
│  │  │ - indexFiles()            │  └──────────────────────────────┘    │ │
│  │  └───────────────────────────┘                                       │ │
│  │                                                                        │ │
│  │  ┌───────────────────────────┐  ┌──────────────────────────────┐    │ │
│  │  │ TemplateStorageService    │  │ VsCodeLmService              │    │ │
│  │  │ (NEW - agent-generation)  │  │ (NEW - agent-generation)     │    │ │
│  │  │ - loadTemplate()          │  │ - customizeSection()         │    │ │
│  │  │ - listTemplates()         │  │ - validateOutput()           │    │ │
│  │  │ - getVersion()            │  │ - batchCustomize()           │    │ │
│  │  │ - parseMetadata()         │  │ - vscode.lm.sendRequest()    │    │ │
│  │  └───────────────────────────┘  └──────────────────────────────┘    │ │
│  │                                           │                            │ │
│  │                                           ↓                            │ │
│  │  ┌───────────────────────────┐  ┌──────────────────────────────┐    │ │
│  │  │ AgentTemplateRenderer     │  │ OutputValidationService      │    │ │
│  │  │ (template-generation)     │  │ (NEW - agent-generation)     │    │ │
│  │  │ - renderTemplate()        │  │ - validateSchema()           │    │ │
│  │  │ - substituteVariables()   │  │ - validateSafety()           │    │ │
│  │  │ - assembleAgentFile()     │  │ - validateFactualAccuracy()  │    │ │
│  │  └───────────────────────────┘  └──────────────────────────────┘    │ │
│  │                                                                        │ │
│  │  ┌───────────────────────────┐  ┌──────────────────────────────┐    │ │
│  │  │ AgentFileWriterService    │  │ MigrationService             │    │ │
│  │  │ (NEW - agent-generation)  │  │ (NEW - Future Phase)         │    │ │
│  │  │ - writeAgent()            │  │ - detectOutdatedAgents()     │    │ │
│  │  │ - backupExisting()        │  │ - calculateUpdateImpact()    │    │ │
│  │  │ - atomicWrite()           │  │ - showDiffPreview()          │    │ │
│  │  │ - rollbackOnError()       │  │ - regenerateWithConsent()    │    │ │
│  │  └───────────────────────────┘  └──────────────────────────────┘    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ External Dependencies                                               │  │
│  │                                                                      │  │
│  │  ┌────────────────────┐  ┌───────────────────────────────────┐    │  │
│  │  │ VS Code LM API     │  │ Template Assets                    │    │  │
│  │  │ - vscode.lm        │  │ - extension/templates/agents/      │    │  │
│  │  │ - sendRequest()    │  │   *.template.md                    │    │  │
│  │  │ - models API       │  │ - YAML frontmatter with metadata   │    │  │
│  │  └────────────────────┘  └───────────────────────────────────┘    │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Component Specifications

### Component 1: SetupWizardService

**Purpose**: Orchestrates the 6-step setup wizard UI flow and manages webview communication.

**Pattern**: Webview Provider + RPC Message Handler
**Evidence**: Similar patterns in existing webview services (webview message validation, sender services)
**Source**: `apps/ptah-extension-webview/` architecture patterns

**Responsibilities**:

- Manage wizard step transitions (Welcome → Scan → Review → Select → Generate → Complete)
- Handle RPC messages between webview and extension backend
- Track wizard session state and progress
- Provide cancellation and resume capabilities
- Emit progress events for UI updates

**Implementation Pattern**:

```typescript
// Pattern: Webview service with state management
// Evidence: apps/ptah-extension-vscode/src/webview/ patterns

@injectable()
export class SetupWizardService {
  constructor(
    @inject(TOKENS.WEBVIEW_MANAGER) private webviewManager: WebviewManager,
    @inject(TOKENS.AGENT_GENERATION_ORCHESTRATOR)
    private orchestrator: AgentGenerationOrchestratorService,
    @inject(TOKENS.LOGGER) private logger: Logger
  ) {}

  /**
   * Launches the setup wizard webview
   * Evidence: WebviewManager pattern from vscode-core
   */
  async launchWizard(): Promise<Result<void, Error>> {
    // Create webview panel
    // Register RPC message handlers
    // Initialize wizard state
  }

  /**
   * Handles wizard step progression
   */
  async handleStepTransition(currentStep: WizardStep, data: StepData): Promise<Result<WizardStep, Error>> {
    // Validate step data
    // Trigger corresponding backend operation
    // Return next step
  }

  /**
   * Handles user cancellation
   */
  async cancelWizard(sessionId: string): Promise<Result<void, Error>> {
    // Save progress for resume
    // Clean up partial state
    // Close webview
  }
}
```

**Quality Requirements**:

**Functional**:

- Must support 6 wizard steps with data persistence
- Must handle cancellation at any step (except Generation)
- Must provide resume capability after cancellation
- Must validate step data before progression

**Non-Functional**:

- UI must remain responsive during long operations
- State transitions must complete in <500ms
- Progress updates must emit every 1-2 seconds

**Pattern Compliance**:

- Must use WebviewManager from vscode-core (verified: TOKENS.WEBVIEW_MANAGER)
- Must follow RPC message validation pattern (verified in webview architecture)
- Must emit events via EventBus (verified: vscode-core pattern)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts`
- CREATE: `libs/backend/agent-generation/src/lib/types/wizard.types.ts`
- MODIFY: `apps/ptah-extension-vscode/src/extension.ts` (register wizard command)

---

### Component 2: AgentGenerationOrchestratorService

**Purpose**: End-to-end coordinator for agent generation workflow (Analysis → Selection → Customization → Rendering → Writing).

**Pattern**: Service Orchestration with Transaction Management
**Evidence**: `TemplateGeneratorService` orchestration pattern (template-generator.service.ts:20-109)

**Responsibilities**:

- Coordinate 5-phase generation workflow
- Manage transaction boundaries (all succeed or all rollback)
- Track generation progress and report to wizard
- Handle partial failures with graceful degradation
- Provide detailed error reporting

**Implementation Pattern**:

```typescript
// Pattern: Orchestration service with Result pattern
// Evidence: TemplateGeneratorService (template-generator.service.ts:34-108)

@injectable()
export class AgentGenerationOrchestratorService {
  constructor(
    @inject(TOKENS.WORKSPACE_ANALYZER)
    private workspaceAnalyzer: WorkspaceAnalyzerService,
    @inject(TOKENS.AGENT_SELECTOR)
    private agentSelector: AgentSelectionService,
    @inject(TOKENS.AGENT_CUSTOMIZATION)
    private agentCustomization: AgentCustomizationService,
    @inject(TOKENS.TEMPLATE_RENDERER)
    private templateRenderer: AgentTemplateRenderer,
    @inject(TOKENS.AGENT_FILE_WRITER)
    private fileWriter: AgentFileWriterService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Orchestrates complete agent generation workflow
   * Evidence: Similar to TemplateGeneratorService.generateTemplates()
   */
  async generateAgents(options: GenerationOptions, progressCallback?: (progress: GenerationProgress) => void): Promise<Result<GenerationSummary, Error>> {
    try {
      // Phase 1: Workspace Analysis (30s target)
      const projectContext = await this.analyzeWorkspace();
      if (projectContext.isErr()) return projectContext;
      progressCallback?.({ phase: 'analysis', percentComplete: 20 });

      // Phase 2: Agent Selection (5s target)
      const selectedAgents = await this.selectRelevantAgents(projectContext.value!, options.userOverrides);
      if (selectedAgents.isErr()) return selectedAgents;
      progressCallback?.({ phase: 'selection', percentComplete: 30 });

      // Phase 3: LLM Customization (10s per agent target)
      const customizations = await this.customizeAgents(selectedAgents.value!, projectContext.value!);
      progressCallback?.({ phase: 'customization', percentComplete: 70 });

      // Phase 4: Template Rendering (<1s per agent)
      const renderedAgents = await this.renderAgents(customizations, projectContext.value!);
      progressCallback?.({ phase: 'rendering', percentComplete: 90 });

      // Phase 5: Atomic File Writing
      const writeResult = await this.writeAgentsAtomic(renderedAgents);
      if (writeResult.isErr()) {
        await this.rollbackGeneration();
        return writeResult;
      }
      progressCallback?.({ phase: 'complete', percentComplete: 100 });

      return Result.ok(this.buildSummary(renderedAgents));
    } catch (error) {
      await this.rollbackGeneration();
      return Result.err(error as Error);
    }
  }
}
```

**Quality Requirements**:

**Functional**:

- Must complete end-to-end generation in <5 minutes (typical project)
- Must rollback all writes if any phase fails
- Must support partial success (some agents succeed, others fail)
- Must provide detailed progress reporting

**Non-Functional**:

- Performance: 95% of projects complete in <3 minutes
- Reliability: 95% success rate (or graceful degradation)
- Memory: <200MB additional memory usage
- Atomicity: All file writes succeed or all rollback

**Pattern Compliance**:

- Must use Result pattern for all method returns (verified: shared library)
- Must inject services via DI (verified: tsyringe pattern)
- Must follow orchestration pattern (verified: TemplateGeneratorService)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/agent-generation-orchestrator.service.ts`
- CREATE: `libs/backend/agent-generation/src/lib/types/generation.types.ts`

---

### Component 3: AgentSelectionService

**Purpose**: Scores agent templates for relevance to project context and selects agents above threshold.

**Pattern**: Scoring Algorithm with Rule Engine
**Evidence**: FileRelevanceScorerService pattern (workspace-intelligence/context-analysis/)

**Responsibilities**:

- Score each agent template (0-100) based on project characteristics
- Apply selection threshold (default: 50)
- Handle user overrides (manual selection/deselection)
- Log selection reasoning for audit trail
- Handle edge cases (unknown project, no matches)

**Implementation Pattern**:

```typescript
// Pattern: Scoring service with configurable rules
// Evidence: FileRelevanceScorerService (workspace-intelligence)

@injectable()
export class AgentSelectionService {
  constructor(
    @inject(TOKENS.TEMPLATE_STORAGE)
    private templateStorage: TemplateStorageService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Scores all agent templates against project context
   * Evidence: Similar to FileRelevanceScorerService.rankFiles()
   */
  async scoreAgents(projectContext: ProjectContext): Promise<Result<Map<string, AgentRelevanceScore>, Error>> {
    const templates = await this.templateStorage.listTemplates();
    if (templates.isErr()) return templates;

    const scores = new Map<string, AgentRelevanceScore>();

    for (const template of templates.value!) {
      const score = this.scoreAgentRelevance(template, projectContext);
      scores.set(template.id, score);
    }

    return Result.ok(scores);
  }

  /**
   * Relevance scoring algorithm (from research-report.md:474-538)
   */
  private scoreAgentRelevance(template: AgentTemplate, context: ProjectContext): AgentRelevanceScore {
    let score = 0;
    const reasons: string[] = [];

    // Base score: Project type match (0-40 points)
    if (template.applicabilityRules.projectTypes.includes(context.type)) {
      score += 40;
      reasons.push(`Matches project type: ${context.type}`);
    }

    // Tech stack match (0-30 points)
    const techMatches = template.applicabilityRules.techStack?.filter((tech) => context.techStack.includes(tech)) || [];
    score += Math.min(30, techMatches.length * 10);
    if (techMatches.length > 0) {
      reasons.push(`Tech stack match: ${techMatches.join(', ')}`);
    }

    // File pattern match (0-20 points) - use workspace indexer
    // Architecture match (0-10 points)
    // Exclusion patterns (-50 points)

    // Auto-include override
    if (template.applicabilityRules.alwaysInclude) {
      score = 100;
      reasons.push('Always included (core agent)');
    }

    return { agentId: template.id, score, reasons, autoInclude: template.applicabilityRules.alwaysInclude || false };
  }

  /**
   * Selects agents above threshold with user overrides
   */
  async selectAgents(scores: Map<string, AgentRelevanceScore>, threshold: number = 50, userOverrides?: AgentSelection[]): Promise<Result<AgentTemplate[], Error>> {
    // Filter by threshold
    // Apply user overrides
    // Load selected templates
    // Log selection reasoning
  }
}
```

**Quality Requirements**:

**Functional**:

- Must score agents consistently (same inputs → same scores)
- Must respect user overrides (manual selection trumps algorithm)
- Must log selection reasoning for each agent
- Must handle unknown project types gracefully (fallback to core agents)

**Non-Functional**:

- Performance: Score 100 agents in <5 seconds
- Accuracy: 85% relevance accuracy (manual validation)
- Extensibility: Support new scoring rules without code changes

**Pattern Compliance**:

- Must follow scoring pattern (verified: FileRelevanceScorerService)
- Must use Result pattern (verified: shared library)
- Must log decisions (verified: Logger from vscode-core)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/agent-selection.service.ts`
- CREATE: `libs/backend/agent-generation/src/lib/types/selection.types.ts`

---

### Component 4: AgentCustomizationService

**Purpose**: Wraps ptah.ai.invokeAgent() for LLM-powered agent customization with quality validation.

**Pattern**: Facade Service wrapping existing ptah.ai LLM infrastructure
**Evidence**: ptah.ai.invokeAgent() implementation (system-namespace.builders.ts:366-424)

**Key Change**: **REUSE ptah.ai instead of creating VsCodeLmService**

**Why This Change**:

- ptah.ai already provides VS Code LM integration with battle-tested code
- Built-in token counting, retry logic, security (10MB limit, path traversal protection)
- Supports model selection (gpt-4o-mini 150x cheaper than gpt-4o)
- Already integrated with VS Code LM API via vscode.lm.sendRequest()

**Responsibilities**:

- Build customization tasks for agent templates
- Call ptah.ai.invokeAgent() with template path and task
- Validate LLM output (schema, safety, factual accuracy)
- Batch process multiple sections in parallel
- Provide fallback to generic content

**Implementation Pattern**:

```typescript
// Pattern: Facade wrapping ptah.ai LLM infrastructure
// Evidence: ptah.ai.invokeAgent() (system-namespace.builders.ts:366-424)

import { PtahAPIBuilder } from '@ptah-extension/vscode-lm-tools';

@injectable()
export class AgentCustomizationService {
  constructor(
    @inject(TOKENS.PTAH_API_BUILDER)
    private ptahApiBuilder: PtahAPIBuilder,
    @inject(TOKENS.OUTPUT_VALIDATOR)
    private validator: OutputValidationService,
    @inject(TOKENS.TEMPLATE_STORAGE)
    private templateStorage: TemplateStorageService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Customizes a template section using ptah.ai.invokeAgent()
   * Evidence: ptah.ai.invokeAgent(agentPath, task, model?) (system-namespace.builders.ts:366-424)
   */
  async customizeSection(sectionTopic: string, templateId: string, projectContext: ProjectContext): Promise<Result<string, Error>> {
    try {
      // Build task description for LLM from research-report.md:264-296
      const task = this.buildCustomizationTask(sectionTopic, projectContext);

      // Get template path for agent MD file
      const templatePath = this.templateStorage.getTemplatePath(templateId);

      // Call ptah.ai.invokeAgent() - Uses template as system prompt
      // Evidence: ptah.ai reads .md file, uses as system prompt, calls chatWithSystem()
      const ptahApi = await this.ptahApiBuilder.buildAPI();
      const response = await ptahApi.ai.invokeAgent(
        templatePath,
        task,
        'gpt-4o-mini' // 150x cheaper, perfect for customization
      );

      // Three-tier validation (research-report.md:428-449)
      const validationResult = await this.validator.validateOutput(response, {
        schema: 'markdown-bullets',
        safety: true,
        factual: projectContext,
      });

      if (!validationResult.isValid) {
        // Retry once with simplified task
        const simplifiedTask = this.simplifyTask(task);
        const retryResponse = await ptahApi.ai.invokeAgent(templatePath, simplifiedTask, 'gpt-4o-mini');

        const retryValidation = await this.validator.validateOutput(retryResponse, { schema: 'markdown-bullets' });
        if (!retryValidation.isValid) {
          // Fallback to generic content
          this.logger.warn(`LLM customization failed for ${sectionTopic}, using fallback`);
          return Result.ok(''); // Empty = skip section
        }

        return Result.ok(retryResponse);
      }

      return Result.ok(response);
    } catch (error) {
      this.logger.error(`AgentCustomizationService error: ${error}`);
      return Result.err(error as Error);
    }
  }

  /**
   * Build customization task for LLM
   * Pattern: Clear task description for agent MD template
   */
  private buildCustomizationTask(sectionTopic: string, projectContext: ProjectContext): string {
    return `
Customize the ${sectionTopic} section for this project:

Project Type: ${projectContext.type}
Tech Stack: ${projectContext.techStack.join(', ')}
Architecture: ${projectContext.architecture || 'Standard'}

Provide 5-10 bullet points specific to this project's tech stack and patterns.
Focus on actionable guidance, not generic advice.
    `.trim();
  }

  /**
   * Batch process multiple sections in parallel
   */
  async batchCustomize(sections: SectionRequest[], concurrency: number = 5): Promise<Map<string, Result<string, Error>>> {
    // Process sections in batches of ${concurrency}
    // Return map of section ID to Result
  }
}
```

**Quality Requirements**:

**Functional**:

- Must validate all LLM outputs (schema, safety, factual)
- Must retry failed requests 2 times (ptah.ai has built-in retry)
- Must fallback to generic content if validation fails
- Must support parallel processing (5 concurrent requests)
- Must leverage ptah.ai token counting to avoid context overflow

**Non-Functional**:

- Performance: 95% of requests complete in <10 seconds (ptah.ai already optimized)
- Reliability: 90% first-attempt success rate (ptah.ai battle-tested)
- Safety: 100% of outputs pass safety validation
- Security: Leverage ptah.ai's 10MB limit and path traversal protection

**Pattern Compliance**:

- Must use Result pattern (verified: shared library)
- Must inject PtahAPIBuilder via DI (verified: vscode-lm-tools)
- Must reuse ptah.ai.invokeAgent() (evidence: system-namespace.builders.ts:366-424)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/agent-customization.service.ts` (replaces VsCodeLmService)
- CREATE: `libs/backend/agent-generation/src/lib/services/output-validation.service.ts`
- CREATE: `libs/backend/agent-generation/src/lib/types/customization.types.ts`

---

### Component 4.5: VS Code Walkthroughs Integration (Hybrid Onboarding)

**Purpose**: Native VS Code onboarding experience that launches custom Angular wizard.

**Pattern**: VS Code Walkthroughs API + Custom Webview Integration
**Evidence**: VS Code Walkthroughs API (https://code.visualstudio.com/api/ux-guidelines/walkthroughs)

**Key Insight**: Combine native VS Code Getting Started experience with rich Angular webview wizard.

**Why Hybrid Approach**:

- **VS Code Walkthroughs**: High-level checklist on Getting Started page (native, discoverable)
- **Angular Webview**: Detailed 6-step wizard with rich UI (DaisyUI components, progress tracking)
- **Integration**: Walkthrough buttons trigger commands that open webview

**Implementation Pattern**:

```json
// package.json contribution
{
  "contributes": {
    "walkthroughs": [
      {
        "id": "ptah-setup",
        "title": "Set Up Ptah for Your Project",
        "description": "Generate project-specific agents tailored to your tech stack",
        "steps": [
          {
            "id": "scan-project",
            "title": "Scan Your Project",
            "description": "Analyze your workspace to detect tech stack and architecture.\n\n[Start Scan](command:ptah.setupWizard.scan)",
            "media": { "image": "resources/walkthrough/scan.svg" },
            "completionEvents": ["onCommand:ptah.setupWizard.scan"]
          },
          {
            "id": "select-agents",
            "title": "Select Agents",
            "description": "Review and customize which agents to generate.\n\n[Open Agent Selection](command:ptah.setupWizard.selectAgents)",
            "media": { "image": "resources/walkthrough/agents.svg" },
            "completionEvents": ["onContext:ptah.agentsSelected"]
          },
          {
            "id": "generate-agents",
            "title": "Generate Agents",
            "description": "Create customized agents for your project.\n\n[Generate Now](command:ptah.setupWizard.generate)",
            "media": { "image": "resources/walkthrough/generate.svg" },
            "completionEvents": ["onContext:ptah.setupComplete"]
          }
        ]
      }
    ]
  },
  "commands": [
    {
      "command": "ptah.setupWizard.scan",
      "title": "Ptah: Start Setup Wizard"
    },
    {
      "command": "ptah.setupWizard.selectAgents",
      "title": "Ptah: Select Agents"
    },
    {
      "command": "ptah.setupWizard.generate",
      "title": "Ptah: Generate Agents"
    }
  ]
}
```

**Service Integration**:

```typescript
// libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts

@injectable()
export class SetupWizardService {
  /**
   * Command handler: ptah.setupWizard.scan
   * Opens webview wizard at Scan step
   */
  async startScanFlow(): Promise<Result<void, Error>> {
    // Open webview at Step 2 (Workspace Scan)
    await this.webviewManager.showWizard({ startStep: 'scan' });

    // Update context for walkthrough completion
    await vscode.commands.executeCommand('setContext', 'ptah.scanStarted', true);

    return Result.ok(undefined);
  }

  /**
   * Command handler: ptah.setupWizard.selectAgents
   * Opens webview wizard at Agent Selection step
   */
  async startSelectionFlow(): Promise<Result<void, Error>> {
    // Open webview at Step 4 (Agent Selection)
    await this.webviewManager.showWizard({ startStep: 'selection' });
    return Result.ok(undefined);
  }

  /**
   * Command handler: ptah.setupWizard.generate
   * Opens webview wizard at Generation step
   */
  async startGenerationFlow(): Promise<Result<void, Error>> {
    // Open webview at Step 5 (Generation Progress)
    await this.webviewManager.showWizard({ startStep: 'generation' });
    return Result.ok(undefined);
  }

  /**
   * Update context keys for walkthrough completion tracking
   */
  async updateWalkthroughProgress(step: 'scanned' | 'selected' | 'complete'): Promise<void> {
    const contextMap = {
      scanned: 'ptah.projectScanned',
      selected: 'ptah.agentsSelected',
      complete: 'ptah.setupComplete',
    };

    await vscode.commands.executeCommand('setContext', contextMap[step], true);
  }
}
```

**User Flow**:

1. **First Install**: VS Code shows "Get Started with Ptah" walkthrough
2. **Step 1: Scan**: User clicks "Start Scan" → Opens Angular webview at scan step
3. **Step 2: Select**: User completes scan → Walkthrough marks step complete → Next step appears
4. **Step 3: Generate**: User selects agents → Clicks "Generate Now" → Webview shows progress
5. **Completion**: Context key `ptah.setupComplete` set → Walkthrough marks complete

**Benefits**:

- ✅ **Discoverability**: Walkthrough appears in VS Code Getting Started page (native experience)
- ✅ **Rich UI**: Angular + DaisyUI provides beautiful, interactive wizard
- ✅ **Completion Tracking**: Context keys track progress, enable conditional UI
- ✅ **Integration**: Seamless transition between native walkthrough and custom webview

**Files Affected**:

- MODIFY: `apps/ptah-extension-vscode/package.json` (add walkthroughs contribution)
- CREATE: `resources/walkthrough/*.svg` (3 walkthrough step images)
- MODIFY: `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts` (add command handlers)
- CREATE: `apps/ptah-extension-vscode/src/commands/setup-wizard.commands.ts` (register commands)

**References**:

- VS Code Walkthroughs API: https://code.visualstudio.com/api/ux-guidelines/walkthroughs
- Context Keys: https://code.visualstudio.com/api/extension-capabilities/common-capabilities#context-keys
- Commands: https://code.visualstudio.com/api/extension-guides/command

---

### Component 5: TemplateStorageService

**Purpose**: Manages agent template files, metadata parsing, and versioning.

**Pattern**: Storage Service with Metadata Caching
**Evidence**: Template loading pattern from template-generation library

**Responsibilities**:

- Load template files from bundled assets
- Parse YAML frontmatter for metadata
- Cache parsed templates in memory
- Provide version information
- List templates with filtering

**Implementation Pattern**:

```typescript
// Pattern: Template manager with caching
// Evidence: ITemplateManager (template-manager.interface.ts:6-24)

import * as grayMatter from 'gray-matter';

@injectable()
export class TemplateStorageService {
  private templateCache: Map<string, AgentTemplate> = new Map();

  constructor(
    @inject(TOKENS.FILE_SYSTEM)
    private fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Loads a template by ID
   * Evidence: ITemplateManager.loadTemplate() (template-manager.interface.ts:12)
   */
  async loadTemplate(templateId: string): Promise<Result<AgentTemplate, Error>> {
    // Check cache first
    if (this.templateCache.has(templateId)) {
      return Result.ok(this.templateCache.get(templateId)!);
    }

    try {
      // Load from bundled assets
      const templatePath = this.getTemplatePath(templateId);
      const content = await this.fileSystem.readFile(templatePath);
      if (content.isErr()) return content;

      // Parse YAML frontmatter (evidence: gray-matter usage in workspace-intelligence)
      const parsed = grayMatter(content.value!);

      const template: AgentTemplate = {
        id: templateId,
        name: parsed.data.name || templateId,
        description: parsed.data.description || '',
        version: this.parseVersion(parsed.data.templateVersion || '1.0.0'),
        content: parsed.content,
        applicabilityRules: this.parseApplicabilityRules(parsed.data.applicabilityRules),
        variables: this.extractVariables(parsed.content),
        llmSections: this.extractLlmSections(parsed.content),
        dependencies: parsed.data.dependencies || [],
      };

      // Cache for future use
      this.templateCache.set(templateId, template);

      return Result.ok(template);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  /**
   * Lists all available templates with optional filtering
   */
  async listTemplates(filter?: TemplateFilter): Promise<Result<AgentTemplate[], Error>> {
    // Scan extension/templates/agents/ directory
    // Load and cache all templates
    // Apply filter if provided
  }

  /**
   * Gets template file path
   * Evidence: IPtahTemplateManager.getTemplatePath() (template-manager.interface.ts:38)
   */
  private getTemplatePath(templateId: string): string {
    // Extension bundle path: extension/templates/agents/${templateId}.template.md
    const extensionPath = vscode.extensions.getExtension('ptah.ptah-extension')!.extensionPath;
    return path.join(extensionPath, 'templates', 'agents', `${templateId}.template.md`);
  }
}
```

**Quality Requirements**:

**Functional**:

- Must parse YAML frontmatter correctly (gray-matter)
- Must cache templates to avoid repeated file I/O
- Must extract variable placeholders from template content
- Must extract LLM section markers

**Non-Functional**:

- Performance: Load template in <100ms (cached <1ms)
- Memory: Cache up to 100 templates (<10MB total)
- Reliability: 100% parse success for valid templates

**Pattern Compliance**:

- Must follow ITemplateManager interface (verified: template-generation)
- Must use gray-matter for YAML parsing (verified: workspace-intelligence usage)
- Must use FileSystemService (verified: vscode-core pattern)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/template-storage.service.ts`
- CREATE: `libs/backend/agent-generation/src/lib/types/template.types.ts`

---

### Component 6: AgentTemplateRenderer

**Purpose**: Renders agent templates by substituting variables and assembling LLM-customized sections.

**Pattern**: Template Rendering with Section Assembly
**Evidence**: Template rendering from template-generation library

**Responsibilities**:

- Substitute variable placeholders ({{VAR_NAME}})
- Assemble STATIC + LLM + VARIABLE sections
- Handle conditional sections ({{#if CONDITION}})
- Inject metadata into YAML frontmatter
- Produce final agent markdown file

**Implementation Pattern**:

```typescript
// Pattern: Template processor with variable substitution
// Evidence: ITemplateProcessor (template-generation)

@injectable()
export class AgentTemplateRenderer {
  constructor(
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Renders a complete agent from template + customizations
   * Evidence: Template rendering pattern from template-generation
   */
  async renderAgent(template: AgentTemplate, projectContext: ProjectContext, customizations: Map<string, string>): Promise<Result<GeneratedAgent, Error>> {
    try {
      let content = template.content;

      // Step 1: Substitute variables ({{VAR_NAME}})
      const variables = this.buildVariableMap(template, projectContext);
      content = this.substituteVariables(content, variables);

      // Step 2: Replace LLM sections (<!-- LLM:TOPIC -->)
      content = this.assembleLlmSections(content, customizations);

      // Step 3: Process conditionals ({{#if CONDITION}})
      content = this.processConditionals(content, projectContext);

      // Step 4: Inject generated metadata into YAML frontmatter
      const finalContent = this.injectMetadata(content, template, projectContext);

      const generatedAgent: GeneratedAgent = {
        id: template.id,
        sourceTemplate: template.id,
        sourceTemplateVersion: template.version,
        content: finalContent,
        variables: variables,
        customizations: this.buildCustomizationInfo(customizations),
        generatedAt: new Date(),
        filePath: '', // Set by FileWriterService
      };

      return Result.ok(generatedAgent);
    } catch (error) {
      return Result.err(error as Error);
    }
  }

  /**
   * Substitutes variable placeholders
   * Pattern: {{VAR_NAME}} → value
   */
  private substituteVariables(content: string, variables: Record<string, any>): string {
    return content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables[varName]?.toString() || match;
    });
  }

  /**
   * Assembles LLM-customized sections
   * Pattern: <!-- LLM:TOPIC -->...<!-- /LLM:TOPIC --> → customized content
   */
  private assembleLlmSections(content: string, customizations: Map<string, string>): string {
    return content.replace(/<!-- LLM:(\w+) -->([\s\S]*?)<!-- \/LLM:\1 -->/g, (match, topic, defaultContent) => {
      const customContent = customizations.get(topic);
      return customContent || defaultContent;
    });
  }
}
```

**Quality Requirements**:

**Functional**:

- Must preserve STATIC sections unchanged (validation required)
- Must substitute all variables correctly
- Must assemble all LLM sections
- Must process conditional sections
- Must inject generated metadata

**Non-Functional**:

- Performance: Render agent in <1 second
- Correctness: 100% variable substitution accuracy
- Safety: STATIC sections never modified

**Pattern Compliance**:

- Must follow template processing pattern (verified: template-generation)
- Must use regex for variable substitution (proven pattern)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/agent-template-renderer.service.ts`

---

### Component 7: AgentFileWriterService

**Purpose**: Writes generated agents to `.claude/agents/` with atomic operations and rollback support.

**Pattern**: Atomic File Operations with Transaction Management
**Evidence**: File system operations from workspace-intelligence

**Responsibilities**:

- Write agent files to `.claude/agents/` directory
- Backup existing agents before overwriting
- Provide atomic write operations (all succeed or all rollback)
- Handle file system errors gracefully
- Support rollback on partial failure

**Implementation Pattern**:

```typescript
// Pattern: Atomic file writer with rollback
// Evidence: FileSystemService pattern from workspace-intelligence

@injectable()
export class AgentFileWriterService {
  private writeLog: WriteOperation[] = [];

  constructor(
    @inject(TOKENS.FILE_SYSTEM)
    private fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Writes agents atomically (all succeed or all rollback)
   */
  async writeAgentsAtomic(agents: GeneratedAgent[], workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    try {
      // Step 1: Backup existing agents
      const backupResult = await this.backupExisting(workspaceUri);
      if (backupResult.isErr()) return backupResult;

      // Step 2: Write all agents (track operations)
      for (const agent of agents) {
        const writeResult = await this.writeAgent(agent, workspaceUri);
        if (writeResult.isErr()) {
          // Rollback all writes on first failure
          await this.rollback();
          return writeResult;
        }
      }

      // Step 3: Commit transaction (clear write log)
      this.writeLog = [];
      return Result.ok(undefined);
    } catch (error) {
      await this.rollback();
      return Result.err(error as Error);
    }
  }

  /**
   * Writes a single agent file
   */
  private async writeAgent(agent: GeneratedAgent, workspaceUri: vscode.Uri): Promise<Result<void, Error>> {
    const agentPath = vscode.Uri.joinPath(workspaceUri, '.claude', 'agents', `${agent.id}.md`);

    // Ensure directory exists
    const dirResult = await this.fileSystem.ensureDirectory(vscode.Uri.joinPath(workspaceUri, '.claude', 'agents'));
    if (dirResult.isErr()) return dirResult;

    // Write file
    const writeResult = await this.fileSystem.writeFile(agentPath, agent.content);
    if (writeResult.isErr()) return writeResult;

    // Track operation for potential rollback
    this.writeLog.push({
      type: 'write',
      path: agentPath,
      timestamp: Date.now(),
    });

    return Result.ok(undefined);
  }

  /**
   * Rollback all writes in reverse order
   */
  private async rollback(): Promise<void> {
    this.logger.warn(`Rolling back ${this.writeLog.length} file operations`);

    for (const operation of this.writeLog.reverse()) {
      try {
        if (operation.type === 'write') {
          await this.fileSystem.deleteFile(operation.path);
        }
      } catch (error) {
        this.logger.error(`Rollback failed for ${operation.path}: ${error}`);
      }
    }

    this.writeLog = [];
  }
}
```

**Quality Requirements**:

**Functional**:

- Must backup existing agents before overwriting
- Must provide atomic writes (all or nothing)
- Must rollback on any write failure
- Must create `.claude/agents/` directory if missing

**Non-Functional**:

- Performance: Write 10 agents in <5 seconds
- Reliability: 100% atomicity (no partial writes)
- Safety: Always backup before overwrite

**Pattern Compliance**:

- Must use FileSystemService (verified: workspace-intelligence)
- Must follow atomic operation pattern
- Must use vscode.Uri for paths (VS Code best practice)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/agent-file-writer.service.ts`

---

### Component 8: OutputValidationService

**Purpose**: Three-tier validation of LLM outputs (schema, safety, factual accuracy).

**Pattern**: Validation Pipeline with Multiple Validators
**Evidence**: Validation pattern from research-report.md

**Responsibilities**:

- Tier 1: Schema validation (markdown structure, length, format)
- Tier 2: Safety checks (no malicious code, credentials, external URLs)
- Tier 3: Factual accuracy (file references exist, framework versions match)
- Provide validation scores (0-100)
- Return detailed issues and suggestions

**Implementation Pattern**:

```typescript
// Pattern: Validation pipeline
// Evidence: Research report validation framework (research-report.md:428-449)

@injectable()
export class OutputValidationService {
  constructor(
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Three-tier validation pipeline
   */
  validateOutput(content: string, rules: ValidationRules): ValidationResult {
    const issues: ValidationIssue[] = [];
    let score = 100;

    // Tier 1: Schema Validation (Immediate)
    if (rules.schema) {
      const schemaIssues = this.validateSchema(content, rules.schema);
      issues.push(...schemaIssues);
      score -= schemaIssues.length * 10;
    }

    // Tier 2: Safety Checks (Fast)
    if (rules.safety) {
      const safetyIssues = this.validateSafety(content);
      issues.push(...safetyIssues);
      score -= safetyIssues.length * 20; // Higher penalty
    }

    // Tier 3: Factual Accuracy (Slower, optional)
    if (rules.factual) {
      const factualIssues = this.validateFactualAccuracy(content, rules.factual);
      issues.push(...factualIssues);
      score -= factualIssues.length * 15;
    }

    return {
      isValid: issues.filter((i) => i.severity === 'error').length === 0,
      score: Math.max(0, score),
      issues,
      warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.message),
    };
  }

  /**
   * Tier 1: Schema validation
   */
  private validateSchema(content: string, schema: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    if (schema === 'markdown-bullets') {
      // Must have bullet points
      if (!/^[-*]\s/m.test(content)) {
        issues.push({
          type: 'schema',
          severity: 'error',
          message: 'Content must include bullet points',
          suggestion: 'Format as markdown list with - or *',
        });
      }

      // Length constraints (100-1000 words)
      const wordCount = content.split(/\s+/).length;
      if (wordCount < 100) {
        issues.push({
          type: 'schema',
          severity: 'error',
          message: `Content too short: ${wordCount} words (min 100)`,
          suggestion: 'Expand with more details',
        });
      }
      if (wordCount > 1000) {
        issues.push({
          type: 'schema',
          severity: 'warning',
          message: `Content too long: ${wordCount} words (max 1000)`,
          suggestion: 'Condense to key points',
        });
      }
    }

    return issues;
  }

  /**
   * Tier 2: Safety checks
   */
  private validateSafety(content: string): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check for malicious patterns
    const maliciousPatterns = [
      /eval\(/i,
      /exec\(/i,
      /Function\(/i,
      /<script/i,
      /on\w+\s*=/i, // onclick=, onerror=, etc.
    ];

    for (const pattern of maliciousPatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: 'safety',
          severity: 'error',
          message: `Potentially malicious code pattern detected: ${pattern}`,
          suggestion: 'Remove code injection patterns',
        });
      }
    }

    // Check for credentials
    const credentialPatterns = [/api[_-]?key/i, /password/i, /secret/i, /token/i, /bearer/i];

    for (const pattern of credentialPatterns) {
      if (pattern.test(content)) {
        issues.push({
          type: 'safety',
          severity: 'warning',
          message: `Potential credential reference: ${pattern}`,
          suggestion: 'Ensure no actual credentials in output',
        });
      }
    }

    return issues;
  }

  /**
   * Tier 3: Factual accuracy
   */
  private validateFactualAccuracy(content: string, projectContext: ProjectContext): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Extract file references (*.ts, *.js, etc.)
    const fileReferences = content.match(/\b[\w\-./]+\.(ts|js|tsx|jsx|py|java|go)\b/g) || [];

    for (const fileRef of fileReferences) {
      // Check if file exists in project context
      const exists = projectContext.fileIndex?.some((f) => f.includes(fileRef));
      if (!exists) {
        issues.push({
          type: 'factual',
          severity: 'warning',
          message: `Referenced file not found: ${fileRef}`,
          suggestion: 'Verify file path or use generic example',
        });
      }
    }

    return issues;
  }
}
```

**Quality Requirements**:

**Functional**:

- Must validate all three tiers (schema, safety, factual)
- Must return detailed issues with suggestions
- Must provide validation score (0-100)
- Must distinguish errors vs warnings

**Non-Functional**:

- Performance: Validate content in <500ms
- Accuracy: 95% detection of malicious patterns
- False Positives: <5% false positive rate

**Pattern Compliance**:

- Must return ValidationResult interface (verified: research report)
- Must use regex for pattern matching (proven approach)

**Files Affected**:

- CREATE: `libs/backend/agent-generation/src/lib/services/output-validation.service.ts`
- CREATE: `libs/backend/agent-generation/src/lib/types/validation.types.ts`

---

### Component 9: MigrationService (Future Phase - Placeholder)

**Purpose**: Handles template version updates and agent regeneration (Phase 4+).

**Pattern**: Version Comparison + Diff Generation
**Evidence**: Research report migration strategy (research-report.md:689-802)

**Responsibilities** (Future):

- Detect outdated generated agents
- Calculate update impact (breaking vs non-breaking)
- Show diff preview to user
- Regenerate with user consent
- Preserve user customizations

**Implementation Pattern** (Placeholder):

```typescript
// Pattern: Version management service
// Evidence: Research report migration workflow (research-report.md:723-780)

@injectable()
export class MigrationService {
  constructor(
    @inject(TOKENS.TEMPLATE_STORAGE)
    private templateStorage: TemplateStorageService,
    @inject(TOKENS.LOGGER)
    private logger: Logger
  ) {}

  /**
   * Detects outdated generated agents
   * FUTURE IMPLEMENTATION - Phase 4
   */
  async detectOutdatedAgents(workspaceUri: vscode.Uri): Promise<Result<UpdateInfo[], Error>> {
    // Read .claude/agents/*.md files
    // Parse sourceTemplateVersion from frontmatter
    // Compare with current template versions
    // Return list of agents needing updates
    throw new Error('Not implemented - Future Phase');
  }

  /**
   * Calculates update impact
   * FUTURE IMPLEMENTATION - Phase 4
   */
  calculateUpdateImpact(currentVersion: SemanticVersion, newVersion: SemanticVersion): UpdateImpact {
    // MAJOR bump = breaking change
    // MINOR bump = new features
    // PATCH bump = bug fixes
    throw new Error('Not implemented - Future Phase');
  }
}
```

**Quality Requirements** (Future):

- Must preserve user customizations during regeneration
- Must show diff before applying updates
- Must require user consent for breaking changes

**Files Affected** (Future):

- CREATE: `libs/backend/agent-generation/src/lib/services/migration.service.ts` (stub only)

---

## 🔗 Integration Architecture

### Integration Points

**1. workspace-intelligence Integration**

- **Service**: WorkspaceAnalyzerService
- **Pattern**: DI injection via TOKENS.WORKSPACE_ANALYZER
- **Evidence**: Already integrated in template-generation (template-generator.service.ts:24)
- **Usage**: `getProjectInfo()`, `detectProjectType()`, `detectMonorepo()`

**2. template-generation Integration**

- **Service**: TemplateGeneratorService (extend for agents)
- **Pattern**: Reuse ProjectContext interface, extend rendering logic
- **Evidence**: Existing template infrastructure (template-generator.service.ts)
- **Enhancement**: Add agent-specific template format support

**3. ptah.ai LLM Integration** (EXISTING - Reuse)

- **API**: `ptah.ai.invokeAgent()` from vscode-lm-tools library
- **Pattern**: Existing battle-tested LLM wrapper with VS Code LM API integration
- **Evidence**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:366-424`
- **Implementation**: Wrap ptah.ai.invokeAgent() instead of creating new VsCodeLmService
- **Capabilities**: Token counting, retry logic, streaming, model selection, security (10MB limit, path traversal protection)

**4. VS Code Webview Integration**

- **Service**: WebviewManager from vscode-core
- **Pattern**: RPC message handling (existing pattern)
- **Evidence**: Webview architecture in apps/ptah-extension-webview/
- **Usage**: Setup wizard UI communication

### Data Flow

```
User triggers setup
  ↓
SetupWizardService.launchWizard()
  ↓
AgentGenerationOrchestratorService.generateAgents()
  ↓
┌─────────────────────────────────────┐
│ Phase 1: Workspace Analysis          │
│ WorkspaceAnalyzerService             │
│ → ProjectContext                     │
└───────────┬─────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ Phase 2: Agent Selection             │
│ AgentSelectionService                │
│ → AgentTemplate[]                    │
└───────────┬─────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ Phase 3: LLM Customization           │
│ VsCodeLmService                      │
│ → Map<section, customizedContent>   │
└───────────┬─────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ Phase 4: Template Rendering          │
│ AgentTemplateRenderer                │
│ → GeneratedAgent[]                   │
└───────────┬─────────────────────────┘
            ↓
┌─────────────────────────────────────┐
│ Phase 5: Atomic File Writing         │
│ AgentFileWriterService               │
│ → .claude/agents/*.md                │
└─────────────────────────────────────┘
```

### Dependencies

**Internal Dependencies** (Verified):

- `@ptah-extension/shared` - Result type, branded types
- `@ptah-extension/vscode-core` - DI tokens, Logger, FileSystemService
- `@ptah-extension/workspace-intelligence` - Project analysis
- `@ptah-extension/template-generation` - Template infrastructure

**External Dependencies** (New):

- `gray-matter` (^4.0.3) - YAML frontmatter parsing (already in workspace-intelligence)
- `picomatch` (^4.0.2) - File pattern matching (already in workspace-intelligence)
- VS Code Extension API - `vscode.lm` namespace (built-in)

---

## 📦 New Library: agent-generation

### Library Structure

```
libs/backend/agent-generation/
├── src/
│   ├── lib/
│   │   ├── services/
│   │   │   ├── setup-wizard.service.ts
│   │   │   ├── agent-generation-orchestrator.service.ts
│   │   │   ├── agent-selection.service.ts
│   │   │   ├── template-storage.service.ts
│   │   │   ├── vscode-lm.service.ts
│   │   │   ├── output-validation.service.ts
│   │   │   ├── agent-template-renderer.service.ts
│   │   │   ├── agent-file-writer.service.ts
│   │   │   └── migration.service.ts (stub)
│   │   ├── types/
│   │   │   ├── wizard.types.ts
│   │   │   ├── generation.types.ts
│   │   │   ├── selection.types.ts
│   │   │   ├── template.types.ts
│   │   │   └── validation.types.ts
│   │   ├── prompts/
│   │   │   └── agent-customization.prompts.ts
│   │   ├── errors/
│   │   │   └── agent-generation.errors.ts
│   │   └── di/
│   │       └── registration.ts
│   └── index.ts
├── project.json
├── tsconfig.json
└── tsconfig.lib.json
```

### DI Token Registration

```typescript
// libs/backend/agent-generation/src/lib/di/registration.ts
export const AGENT_GENERATION_TOKENS = {
  SETUP_WIZARD: Symbol('SETUP_WIZARD'),
  AGENT_GENERATION_ORCHESTRATOR: Symbol('AGENT_GENERATION_ORCHESTRATOR'),
  AGENT_SELECTOR: Symbol('AGENT_SELECTOR'),
  TEMPLATE_STORAGE: Symbol('TEMPLATE_STORAGE'),
  AGENT_CUSTOMIZATION: Symbol('AGENT_CUSTOMIZATION'), // Renamed from VSCODE_LM_SERVICE
  OUTPUT_VALIDATOR: Symbol('OUTPUT_VALIDATOR'),
  AGENT_TEMPLATE_RENDERER: Symbol('AGENT_TEMPLATE_RENDERER'),
  AGENT_FILE_WRITER: Symbol('AGENT_FILE_WRITER'),
  MIGRATION_SERVICE: Symbol('MIGRATION_SERVICE'),
};

export function registerAgentGeneration(container: DependencyContainer): void {
  container.registerSingleton(AGENT_GENERATION_TOKENS.SETUP_WIZARD, SetupWizardService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR, AgentGenerationOrchestratorService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.AGENT_SELECTOR, AgentSelectionService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.TEMPLATE_STORAGE, TemplateStorageService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.AGENT_CUSTOMIZATION, AgentCustomizationService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.OUTPUT_VALIDATOR, OutputValidationService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.AGENT_TEMPLATE_RENDERER, AgentTemplateRenderer);
  container.registerSingleton(AGENT_GENERATION_TOKENS.AGENT_FILE_WRITER, AgentFileWriterService);
  container.registerSingleton(AGENT_GENERATION_TOKENS.MIGRATION_SERVICE, MigrationService);
}
```

---

## 🎯 Quality Requirements (Architecture-Level)

### Functional Requirements

**1. Generation Workflow**

- Must complete end-to-end generation in <5 minutes for typical projects
- Must support cancellation at Steps 1-4 (before Generation phase)
- Must provide resume capability after cancellation
- Must generate agents based on project characteristics (no irrelevant agents)

**2. Template System**

- Must preserve STATIC sections unchanged (validation required)
- Must substitute all variables correctly (100% accuracy)
- Must support conditional sections based on project type
- Must inject generation metadata into YAML frontmatter

**3. LLM Integration**

- Must validate all LLM outputs (schema, safety, factual)
- Must retry failed requests 3 times with exponential backoff
- Must fallback to generic content if validation fails after retries
- Must support parallel LLM requests (5 concurrent max)

**4. File Operations**

- Must write files atomically (all succeed or all rollback)
- Must backup existing agents before overwriting
- Must create `.claude/agents/` directory if missing
- Must use absolute paths for Windows compatibility

### Non-Functional Requirements

**Performance**:

- Workspace scan: <30 seconds for 95% of projects, <2 minutes for 99%
- LLM customization: <10 seconds per agent for 95%, <30 seconds for 99%
- Total setup time: <5 minutes for typical project
- Memory usage: <200MB additional during generation

**Security**:

- LLM output safety: 100% of outputs scanned for malicious patterns
- Template integrity: Templates bundled with extension (no external fetch)
- User data privacy: Workspace data only sent to VS Code LM API (no external servers)
- File system safety: All writes restricted to `.claude/` directory

**Reliability**:

- Wizard completion rate: >90% (successful or graceful degradation)
- LLM first-attempt success: >90%
- Atomic write guarantee: 100% (no partial writes)
- Error recovery: All errors handled gracefully

**Usability**:

- Onboarding time: Users understand wizard flow within 30 seconds
- Error clarity: Error messages use plain language (no technical jargon)
- Progress transparency: Users always see current status and remaining time
- Customization options: Users can deselect agents before generation

### Pattern Compliance

**Must Follow Existing Patterns**:

- ✅ Dependency Injection: All services use `@injectable()` and constructor injection
- ✅ Result Pattern: All methods return `Result<T, E>` for type-safe error handling
- ✅ Service Orchestration: High-level services compose low-level services
- ✅ YAML Frontmatter: Agent metadata in frontmatter (gray-matter parsing)
- ✅ Logging: All services log errors and important operations
- ✅ File Paths: Use `vscode.Uri` for cross-platform compatibility

**Evidence for Each Pattern**:

- DI: template-generator.service.ts:19-27, workspace-intelligence services
- Result: template-generator.service.ts:36, llm.service.ts:89-130
- Orchestration: TemplateGeneratorService pattern (template-generator.service.ts)
- YAML: workspace-intelligence/autocomplete/agent-discovery.service.ts
- Logging: All services inject TOKENS.LOGGER
- Paths: workspace-intelligence FileSystemService usage

---

## 📋 POC Scope Definition (2-3 Weeks)

### POC Goals

**Validate Core Assumptions**:

1. Template format works for agent conversion (STATIC + LLM + VARIABLE sections)
2. VS Code LM API provides acceptable quality customizations
3. Users trust and adopt generated agents (blind quality test)
4. Wizard UX is intuitive and complete-able

### POC Phase Breakdown

**Week 1: Template Foundation + Selection**

- **Days 1-2**: Convert 2 agent templates
  - `backend-developer.template.md` (complex, many sections)
  - `orchestrate.template.md` (command template)
  - Implement template syntax: `{{VAR}}`, `<!-- STATIC -->`, `<!-- LLM:TOPIC -->`
- **Days 3-4**: Implement TemplateStorageService + AgentSelectionService
  - Template loading with YAML parsing
  - Relevance scoring algorithm (research-report.md:474-538)
  - Test on 3 projects: Angular Nx, Node.js API, Python app
- **Day 5**: Validation
  - Verify templates parse correctly
  - Verify selection algorithm accuracy (>85% target)

**Week 2: LLM Integration + Validation**

- **Days 1-2**: Implement VsCodeLmService
  - VS Code LM API integration (`vscode.lm.sendRequest()`)
  - Create 2 prompts: Agent Customization, Tech Stack Injection
  - Retry logic with exponential backoff
- **Days 3-4**: Implement OutputValidationService
  - Three-tier validation (schema, safety, factual)
  - Validation scoring (0-100)
  - Fallback strategy testing
- **Day 5**: End-to-end test
  - Generate 2 agents with LLM customization
  - Measure quality, latency, success rate

**Week 3: Minimal Wizard + User Testing**

- **Days 1-3**: Implement 3-step wizard
  - Step 1: Workspace Scan (WorkspaceAnalyzerService integration)
  - Step 2: Agent Selection (show relevance scores, allow deselection)
  - Step 3: Generation Progress + Completion
  - Backend: AgentGenerationOrchestratorService (simplified)
  - Frontend: 3 Angular components (minimal UI)
- **Days 4-5**: User testing
  - Recruit 5 developers (mix of tech stacks)
  - Blind quality test: Can they distinguish generated vs hand-written agents?
  - Usability survey: 4/5 satisfaction target
  - Performance measurement: <3 minute completion target

### POC Success Criteria

**Must Achieve**:

- ✅ Generated agents pass blind quality test (3/5 reviewers can't distinguish)
- ✅ Setup completes in <3 minutes for typical project
- ✅ Agent selection achieves >85% relevance accuracy (manual review)
- ✅ User satisfaction >4/5 (feedback survey)
- ✅ Zero critical bugs (crashes, data loss)

**POC Deliverables**:

1. 2 working agent templates (backend-developer, orchestrate)
2. Functional template storage + selection services
3. Working VS Code LM integration with validation
4. 3-step setup wizard (end-to-end functional)
5. User feedback report with quality scores

**POC Decision Gate**:

- **If POC succeeds**: Proceed to Phase 1 (full template library conversion)
- **If POC partially succeeds**: Iterate 1 more week on identified issues
- **If POC fails**: Pivot to alternative (manual customization wizard, pre-built agent packs)

---

## 📅 Implementation Phases (Post-POC)

### Phase 1: Template Foundation (2-3 weeks)

**Goal**: Production-ready template infrastructure

**Tasks**:

1. Convert all 11 agents to template format
   - backend-developer, frontend-developer, team-leader, project-manager
   - software-architect, senior-tester, code-style-reviewer, code-logic-reviewer
   - researcher-expert, ui-ux-designer, modernization-detector
2. Convert all commands to templates
   - orchestrate, help, etc.
3. Build template versioning system (semantic versioning)
4. Implement template storage with bundled assets
5. Create template metadata schema (ApplicabilityRules)
6. Write template authoring documentation
7. Build template validation CI pipeline

**Deliverables**:

- ✅ Full template library (11 agents + N commands)
- ✅ Template versioning system
- ✅ Template authoring guide (TEMPLATE_AUTHORING.md)
- ✅ CI pipeline for template validation

**Success Criteria**:

- All agents convert to template format without loss of functionality
- Template validation catches 100% of syntax errors at build time
- Generated agents load correctly in Claude SDK

---

### Phase 2: LLM Integration Enhancement (2-3 weeks)

**Goal**: Production-quality LLM customization

**Tasks**:

1. Create complete prompt library (10+ prompts)
   - Agent Customization, Tech Stack Injection, Architecture Detection
   - Code Convention Analysis, Quality Validation, etc.
2. Enhance OutputValidationService
   - Advanced factual accuracy checking
   - Coherence scoring
   - Hallucination detection
3. Implement batch processing (5 concurrent requests)
4. Add LLM output caching (avoid redundant requests)
5. Build fallback strategy framework
6. Create LLM prompt testing suite

**Deliverables**:

- ✅ 10+ production prompts with examples
- ✅ Advanced validation framework
- ✅ Batch processing support
- ✅ Prompt testing suite

**Success Criteria**:

- LLM customization quality score >80/100 (automated scoring)
- First-attempt success rate >90%
- Fallback strategy tested for all failure modes

---

### Phase 3: Full Setup Wizard (2-3 weeks)

**Goal**: Complete 6-step wizard UI

**Tasks**:

1. Build all 6 wizard steps
   - Welcome, Workspace Scan, Analysis Results, Agent Selection, Generation Progress, Completion
2. Implement progress tracking UI
3. Add error handling UX (retry, skip, cancel)
4. Build diff preview modal (for future migration)
5. Add help documentation to each step
6. Implement wizard state persistence (resume support)

**Deliverables**:

- ✅ Complete 6-step wizard
- ✅ Progress tracking with ETA
- ✅ Error handling UX
- ✅ Help documentation

**Success Criteria**:

- Wizard completion rate >90%
- Users complete setup without external documentation
- Error messages are clear and actionable

---

### Phase 4: Production Hardening (1-2 weeks)

**Goal**: Production-ready system

**Tasks**:

1. Error recovery testing
   - LLM API failures, workspace scan failures, file write errors
2. Performance optimization
   - Workspace scan streaming, parallel LLM requests
3. Comprehensive testing suite
   - Unit tests (80% coverage), integration tests, E2E tests
4. Documentation
   - User guide, troubleshooting, FAQ
5. Telemetry integration (opt-in)
6. Beta rollout plan

**Deliverables**:

- ✅ Complete test suite (80%+ coverage)
- ✅ User documentation
- ✅ Performance benchmarks
- ✅ Beta rollout plan

**Success Criteria**:

- All failure modes have recovery strategies
- Performance targets met (<5 min setup, <200MB memory)
- Test coverage >80%

---

## 🧪 Testing Strategy

### Unit Tests (Service Isolation)

**Test Coverage**: 80% minimum

**Key Test Suites**:

**1. AgentSelectionService**

```typescript
// Test: Relevance scoring algorithm
describe('AgentSelectionService.scoreAgentRelevance', () => {
  it('should score 100 for always-include agents', () => {
    // Mock template with alwaysInclude: true
    // Assert score === 100
  });

  it('should score based on project type match', () => {
    // Mock Angular project context
    // Mock frontend-developer template
    // Assert score >= 40 (base score)
  });

  it('should apply exclusion penalty', () => {
    // Mock backend project (no UI files)
    // Mock ui-ux-designer template with excludePatterns
    // Assert score is penalized (-50)
  });
});
```

**2. VsCodeLmService**

```typescript
// Test: LLM integration with retry logic
describe('VsCodeLmService.customizeSection', () => {
  it('should retry failed requests with exponential backoff', async () => {
    // Mock vscode.lm.sendRequest to fail 2x, succeed 3rd
    // Assert 3 attempts made
    // Assert exponential backoff delays (5s, 10s)
  });

  it('should fallback to generic content after max retries', async () => {
    // Mock vscode.lm.sendRequest to always fail
    // Assert returns empty string (fallback)
  });
});
```

**3. OutputValidationService**

```typescript
// Test: Three-tier validation
describe('OutputValidationService.validateOutput', () => {
  it('should detect malicious code patterns', () => {
    const maliciousContent = 'Use eval() to execute code';
    const result = validator.validateOutput(maliciousContent, { safety: true });
    expect(result.isValid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ type: 'safety', severity: 'error' }));
  });

  it('should validate schema for markdown bullets', () => {
    const invalidContent = 'No bullets here';
    const result = validator.validateOutput(invalidContent, { schema: 'markdown-bullets' });
    expect(result.isValid).toBe(false);
  });
});
```

**4. AgentFileWriterService**

```typescript
// Test: Atomic write operations
describe('AgentFileWriterService.writeAgentsAtomic', () => {
  it('should rollback all writes if any fails', async () => {
    // Mock 3 agents, 2nd write fails
    // Assert 1st write is rolled back (deleted)
    // Assert 3rd write never attempted
  });

  it('should backup existing agents before overwrite', async () => {
    // Mock existing agent file
    // Assert backup created before write
  });
});
```

---

### Integration Tests (Service Interaction)

**Test Coverage**: Key workflows

**Key Integration Tests**:

**1. End-to-End Generation Workflow**

```typescript
describe('Agent Generation Integration', () => {
  it('should generate agents from workspace analysis', async () => {
    // Setup: Mock workspace with Angular Nx project
    // Execute: AgentGenerationOrchestratorService.generateAgents()
    // Assert:
    //   - WorkspaceAnalyzerService called
    //   - AgentSelectionService returned 8+ agents
    //   - VsCodeLmService customized sections
    //   - AgentFileWriterService wrote files
    //   - .claude/agents/*.md files exist
  });

  it('should handle partial LLM failures gracefully', async () => {
    // Mock: LLM customization fails for 2 sections
    // Execute: Generate agents
    // Assert: Agents generated with generic content for failed sections
  });
});
```

**2. Template Rendering Integration**

```typescript
describe('Template Rendering Integration', () => {
  it('should render complete agent from template + customizations', () => {
    // Load template: backend-developer.template.md
    // Mock customizations: Map<section, content>
    // Mock project context: Angular Nx
    // Execute: AgentTemplateRenderer.renderAgent()
    // Assert:
    //   - STATIC sections unchanged
    //   - Variables substituted correctly
    //   - LLM sections replaced with customizations
    //   - Metadata injected into frontmatter
  });
});
```

---

### E2E Tests (Full Wizard Flow)

**Test Coverage**: User scenarios

**Key E2E Tests**:

**1. Complete Setup Wizard**

```typescript
describe('Setup Wizard E2E', () => {
  it('should complete full wizard flow for Angular project', async () => {
    // Open workspace: Test Angular project
    // Execute: Launch wizard
    // Step 1: Welcome → Click "Start Setup"
    // Step 2: Scan → Wait for completion
    // Step 3: Review → Verify detected: Angular, Nx, NestJS
    // Step 4: Selection → Verify 8+ agents selected, allow deselection
    // Step 5: Generation → Wait for completion
    // Step 6: Completion → Verify success message
    // Assert: .claude/agents/ contains 8+ .md files
  });

  it('should handle cancellation and resume', async () => {
    // Execute: Start wizard, cancel at Step 3
    // Assert: Progress saved
    // Execute: Resume wizard
    // Assert: Resumes at Step 3, continues to completion
  });
});
```

---

### Quality Tests (LLM Output Validation)

**Test Coverage**: LLM quality assurance

**Key Quality Tests**:

**1. Blind Quality Test**

```typescript
describe('LLM Quality Blind Test', () => {
  it('generated agents should be indistinguishable from hand-written', async () => {
    // Generate agents for 3 test projects
    // Mix with 3 hand-written agents
    // Survey: 5 reviewers, identify which are generated
    // Assert: <40% identification accuracy (blind threshold)
  });
});
```

**2. Validation Accuracy Test**

```typescript
describe('Validation Accuracy', () => {
  it('should detect 95% of malicious patterns', () => {
    // Test with 100 malicious samples
    // Assert: 95+ detected by OutputValidationService
  });

  it('should have <5% false positive rate', () => {
    // Test with 100 safe samples
    // Assert: <5 flagged as malicious
  });
});
```

---

## 🚨 Risk Mitigation Architecture

### Risk 1: LLM Quality Inconsistency

**Architectural Solutions**:

**1. Three-Tier Validation Pipeline**

```typescript
// Architecture: Validation as a first-class service
// Component: OutputValidationService (detailed above)

const validationResult = await validator.validateOutput(llmOutput, { schema: 'markdown-bullets', safety: true, factual: projectContext });

if (!validationResult.isValid) {
  // Tier 1 failed: Retry with simplified prompt
  // Tier 2 failed: Fallback to generic content
  // Tier 3 failed: Log for manual review
}
```

**2. Fallback Strategy Framework**

```typescript
// Architecture: Multi-level fallback
class FallbackStrategy {
  async execute(context: FallbackContext): Promise<string> {
    // Level 1: Retry with simplified prompt (once)
    const retry = await this.retrySimplified(context);
    if (retry.isOk()) return retry.value!;

    // Level 2: Use generic template content
    const generic = this.getGenericContent(context.section);
    if (generic) return generic;

    // Level 3: Empty content (mark for later customization)
    return '<!-- [Customize Later] -->';
  }
}
```

**3. User Preview Before Commit**

```typescript
// Architecture: User approval checkpoint
// Wizard Step 5: Show generated agents BEFORE writing files
// User can review, edit, or regenerate specific agents
```

---

### Risk 2: SDK Breaking Changes

**Architectural Solutions**:

**1. Version Compatibility Layer**

```typescript
// Architecture: Adapter pattern for SDK versions
interface AgentLoaderAdapter {
  loadGeneratedAgents(): Promise<Agent[]>;
  supportsVersion(sdkVersion: string): boolean;
}

class SdkV1Adapter implements AgentLoaderAdapter {
  // Handles SDK 1.x agent loading
}

class SdkV2Adapter implements AgentLoaderAdapter {
  // Handles SDK 2.x agent loading (future)
}

// Use factory to select adapter based on SDK version
```

**2. Integration Tests with SDK**

```typescript
// Architecture: CI integration tests
// Test generated agents load correctly in Claude SDK
// Run on every commit to catch SDK breaking changes early
```

**3. Template Format Versioning**

```typescript
// Architecture: Template format evolution support
interface TemplateFormat {
  version: string; // "1.0", "2.0", etc.
  parser: TemplateParser;
  renderer: TemplateRenderer;
}

// Support multiple format versions simultaneously
// Migrate templates incrementally
```

---

### Risk 3: Template Format Rigidity

**Architectural Solutions**:

**1. Extensible Section Types**

```typescript
// Architecture: Plugin-based section handlers
interface SectionHandler {
  canHandle(sectionType: string): boolean;
  process(content: string, context: any): Promise<string>;
}

// Built-in handlers: STATIC, VARIABLE, LLM, CONDITIONAL
// Future: Custom handlers via extension points
```

**2. Template Composition**

```typescript
// Architecture: Reusable template fragments
// Template can import shared sections
---
templateId: backend-developer-v2
imports:
  - shared/core-principles.md
  - shared/git-conventions.md
---

<!-- IMPORT:shared/core-principles.md -->
<!-- IMPORT:shared/git-conventions.md -->
```

**3. Format Validation at Build Time**

```typescript
// Architecture: Template linting CI pipeline
// Catch format errors before bundling extension
// Validate: YAML schema, section syntax, variable references
```

---

## ⚡ Performance Considerations

### 1. Workspace Scan Optimization

**Target**: <30 seconds for 95% of projects

**Optimizations**:

- **Streaming File Discovery**: Use async generators (evidence: WorkspaceIndexerService)
  ```typescript
  for await (const file of indexer.indexWorkspaceStream(options)) {
    // Process incrementally, don't load all files in memory
  }
  ```
- **Parallel Analysis**: Analyze file types concurrently
- **Early Termination**: Stop scanning after detecting project type (confidence threshold)
- **Ignore Patterns**: Respect .gitignore, exclude node_modules, dist, .git

**Benchmarks** (from workspace-intelligence):

- Small projects (100 files): <5 seconds
- Medium projects (1000 files): <15 seconds
- Large projects (5000 files): <30 seconds
- Very large monorepos (10,000+ files): <2 minutes

---

### 2. LLM Call Caching

**Target**: Avoid redundant LLM requests

**Optimizations**:

- **Project-Level Caching**: Cache customizations per project hash

  ```typescript
  const projectHash = crypto.createHash('sha256').update(JSON.stringify(projectContext)).digest('hex');

  const cached = this.cache.get(`${templateId}-${sectionId}-${projectHash}`);
  if (cached) return cached;
  ```

- **Session-Level Caching**: Reuse customizations within wizard session
- **TTL**: 24 hour cache expiry (stale after project changes)

**Impact**:

- First generation: 10s per agent (LLM calls)
- Regeneration: <1s per agent (cached)

---

### 3. Incremental Generation

**Target**: Generate agents as they complete, not all at once

**Optimizations**:

- **Agent-by-Agent Writing**: Write each agent immediately after rendering
  ```typescript
  for (const template of selectedAgents) {
    const rendered = await this.renderAgent(template, context);
    await this.fileWriter.writeAgent(rendered); // Write immediately
    progressCallback({ agentCompleted: template.id });
  }
  ```
- **Progress Streaming**: Update UI every 1-2 seconds with latest status
- **Partial Success Support**: If 1 agent fails, continue with others

**Impact**:

- Users see progress in real-time (better UX)
- Partial success possible (not all-or-nothing)

---

### 4. Memory Footprint

**Target**: <200MB additional memory

**Optimizations**:

- **Stream File Content**: Don't load all files into memory
- **LRU Template Cache**: Limit to 100 templates (from TemplateStorageService)
- **Dispose After Write**: Clear rendered agents after file write
- **Lazy LLM Requests**: Only request customization when needed (not all upfront)

**Memory Budget**:

- Template cache: ~10MB (100 templates × 100KB)
- Project context: ~5MB (file index + metadata)
- LLM responses: ~50MB (10 agents × 5 sections × 1KB)
- Rendered agents: ~5MB (10 agents × 500KB)
- Buffer: ~130MB
- **Total**: ~200MB

---

## 🤝 Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: **Backend Developer** (Primary) + **Frontend Developer** (Wizard UI)

**Rationale**:

**Backend Work (80% of effort)**:

- Service implementation (8 new services in agent-generation library)
- DI registration and integration
- VS Code LM API integration (extension API work)
- Template parsing and rendering logic
- File system operations (atomic writes, rollback)
- LLM prompt engineering and validation

**Frontend Work (20% of effort)**:

- Setup wizard UI (6 Angular components)
- Progress tracking and real-time updates
- Error handling UX (retry, cancel, resume)
- Agent preview and diff UI (future)

**Recommended Approach**:

1. **POC Week 1-2**: Backend developer implements core services + template format
2. **POC Week 3**: Frontend developer builds minimal 3-step wizard
3. **Phase 1-4**: Backend developer leads, frontend developer supports wizard enhancements

---

### Complexity Assessment

**Complexity**: **HIGH**

**Estimated Effort**: 10-12 weeks (including POC)

**Breakdown**:

- POC: 2-3 weeks (validate approach)
- Phase 1: 2-3 weeks (template foundation)
- Phase 2: 2-3 weeks (LLM integration)
- Phase 3: 2-3 weeks (full wizard UI)
- Phase 4: 1-2 weeks (production hardening)

**Complexity Factors**:

1. **New Library Creation**: agent-generation library (8 services, complete DI setup)
2. **External API Integration**: VS Code LM API (no existing wrapper)
3. **Prompt Engineering**: LLM quality validation and fallback strategies
4. **Template Format Design**: New syntax (STATIC, LLM, VARIABLE, CONDITIONAL sections)
5. **Atomic Operations**: Transaction management for file writes
6. **Multi-Phase Workflow**: 6-step wizard with complex state management

---

### Files Affected Summary

**CREATE** (New Library):

- `libs/backend/agent-generation/` - Complete new library
  - 9 services (SetupWizard, Orchestrator, Selection, TemplateStorage, AgentCustomization, Validation, Renderer, FileWriter, Migration)
  - 5 type definition files (wizard, generation, selection, template, validation, customization)
  - 1 errors file
  - 1 DI registration file

**CREATE** (Template Assets):

- `extension/templates/agents/backend-developer.template.md`
- `extension/templates/agents/frontend-developer.template.md`
- `extension/templates/agents/team-leader.template.md`
- ... (11 total agent templates)
- `extension/templates/commands/orchestrate.template.md`

**CREATE** (Wizard UI):

- `apps/ptah-extension-webview/src/app/wizard/` - 6 Angular components
  - welcome.component.ts
  - workspace-scan.component.ts
  - analysis-results.component.ts
  - agent-selection.component.ts
  - generation-progress.component.ts
  - completion.component.ts

**MODIFY**:

- `apps/ptah-extension-vscode/src/extension.ts` - Register wizard commands, setup wizard service
- `apps/ptah-extension-vscode/package.json` - Add walkthroughs contribution, setup commands
- `libs/backend/vscode-core/src/di/tokens.ts` - Add agent-generation tokens
- `libs/backend/template-generation/src/lib/services/template-generator.service.ts` - Extend for agents (optional)

**CREATE** (VS Code Walkthroughs):

- `resources/walkthrough/scan.svg` - Walkthrough step image (scan)
- `resources/walkthrough/agents.svg` - Walkthrough step image (selection)
- `resources/walkthrough/generate.svg` - Walkthrough step image (generation)
- `apps/ptah-extension-vscode/src/commands/setup-wizard.commands.ts` - Command registrations

**Total New Files**: ~45 files

---

### Critical Verification Points

**Before Implementation, Team-Leader Must Ensure Developer Verifies**:

**1. All DI tokens registered correctly**:

- Verify: `libs/backend/agent-generation/src/lib/di/registration.ts` registers all 9 services
- Verify: `libs/backend/vscode-core/src/di/tokens.ts` exports AGENT_GENERATION_TOKENS
- Test: DI container resolves all services without circular dependencies

**2. All service interfaces follow Result pattern**:

- Verify: Every public method returns `Result<T, Error>`
- Evidence: shared library Result type (verified)
- Test: Error handling uses Result.err(), not thrown exceptions

**3. VS Code LM API integration works**:

- Verify: `vscode.lm.sendRequest()` accessible in extension context
- Verify: API usage matches VS Code documentation (research-report.md references)
- Test: LLM requests succeed with sample project context

**4. Template format parses correctly**:

- Verify: gray-matter parses YAML frontmatter
- Verify: Regex extracts `{{VAR}}`, `<!-- STATIC -->`, `<!-- LLM:TOPIC -->` sections
- Test: Convert 1 agent manually, verify parsing

**5. Workspace-intelligence integration works**:

- Verify: `WorkspaceAnalyzerService` injected via TOKENS.WORKSPACE_ANALYZER
- Verify: `getProjectInfo()` returns expected ProjectContext
- Test: Run workspace analysis on test project, inspect results

**6. File write operations are atomic**:

- Verify: AgentFileWriterService tracks all writes in writeLog
- Verify: Rollback deletes all written files on error
- Test: Simulate write failure, verify rollback occurs

---

### Architecture Delivery Checklist

- [x] All services specified with evidence-based patterns
- [x] All service interfaces use Result pattern (verified)
- [x] All integrations verified against existing libraries
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented with evidence
- [x] Files affected list complete
- [x] Developer type recommended (backend + frontend)
- [x] Complexity assessed (HIGH, 10-12 weeks)
- [x] POC scope defined (2-3 weeks, actionable)
- [x] Testing strategy complete (unit, integration, E2E)
- [x] Risk mitigation architecture provided
- [x] Performance targets specified (<5 min, <200MB)
- [x] No step-by-step implementation (team-leader's job to create tasks.md)

---

## 🎯 Implementation Plan Summary

**This architecture specification is COMPLETE and READY for team-leader decomposition.**

**What This Document Provides**:

1. ✅ **Detailed Component Architecture**: 9 services with TypeScript interfaces, evidence-based patterns
2. ✅ **Service Specifications**: Responsibilities, implementation patterns, quality requirements
3. ✅ **Data Models**: TypeScript interfaces for all domain types
4. ✅ **Integration Strategy**: workspace-intelligence, template-generation, VS Code LM API
5. ✅ **POC Scope Definition**: 2-3 week actionable plan with success criteria
6. ✅ **Phase 1-4 Breakdown**: Clear milestones, deliverables, success criteria
7. ✅ **Testing Strategy**: Unit, integration, E2E, quality tests
8. ✅ **Risk Mitigation Architecture**: Validation pipelines, fallback strategies, version compatibility
9. ✅ **Performance Targets**: <5 min setup, <200MB memory, <30s workspace scan

**What Team-Leader Will Do Next**:

1. Read this implementation-plan.md
2. Decompose into atomic, git-verifiable tasks in tasks.md
3. Assign tasks to backend-developer (POC Week 1-2) and frontend-developer (POC Week 3)
4. Verify git commits after each task completion
5. Manage POC → Phase 1 → Phase 2 → Phase 3 → Phase 4 progression

**Key Architectural Decisions (Evidence-Based)**:

- ✅ Use workspace-intelligence for project analysis (verified: existing integration)
- ✅ Extend template-generation for agent templates (verified: compatible infrastructure)
- ✅ Create new VsCodeLmService (verified: no existing VS Code LM wrapper, research requirement)
- ✅ Follow DI + Result patterns (verified: consistent across all libraries)
- ✅ Use gray-matter for YAML parsing (verified: workspace-intelligence usage)
- ✅ Implement atomic file writes with rollback (verified: reliability requirement)

**No Hallucinated APIs**:

- ✅ All services use verified DI tokens (TOKENS.\*)
- ✅ All integrations reference existing services (WorkspaceAnalyzerService, TemplateGeneratorService)
- ✅ All patterns extracted from real codebase examples (file:line citations)
- ✅ All external dependencies verified (gray-matter, picomatch already used)

**Architecture Ready for Implementation** ✅

---

## 📝 Architecture Updates (2025-12-08)

### Update Summary

Based on user feedback and codebase research, the architecture has been updated to leverage existing infrastructure instead of creating redundant services.

### Key Changes

**1. LLM Integration: AgentCustomizationService (replaces VsCodeLmService)**

**Before**:

- Create new VsCodeLmService wrapper around VS Code LM API
- Implement retry logic, token counting, security from scratch
- 680 lines of new code with unknown reliability

**After**:

- Reuse ptah.ai.invokeAgent() from vscode-lm-tools library
- Battle-tested LLM wrapper already integrated with VS Code LM API
- Built-in token counting, retry, security (10MB limit, path traversal protection)
- Supports gpt-4o-mini (150x cheaper than gpt-4o)
- ~200 lines of facade code wrapping proven infrastructure

**Evidence**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts:366-424`

**Benefits**:

- ✅ **Less Code**: 70% reduction in new code (200 vs 680 lines)
- ✅ **Higher Reliability**: Proven infrastructure vs untested wrapper
- ✅ **Cost Savings**: gpt-4o-mini model support (150x cheaper)
- ✅ **Security**: 10MB limit and path traversal protection built-in
- ✅ **Maintenance**: No need to maintain LLM wrapper

---

**2. Onboarding UX: Hybrid VS Code Walkthroughs + Angular Webview**

**Before**:

- Angular webview wizard only
- Poor discoverability (users must trigger command manually)
- No native Getting Started experience

**After**:

- **VS Code Walkthroughs**: Native 3-step checklist on Getting Started page
- **Angular Webview**: Rich 6-step wizard with DaisyUI components
- **Integration**: Walkthrough buttons trigger commands that open webview
- **Completion Tracking**: Context keys track progress (ptah.setupComplete)

**Evidence**: VS Code Walkthroughs API (https://code.visualstudio.com/api/ux-guidelines/walkthroughs)

**Benefits**:

- ✅ **Discoverability**: Walkthrough appears in VS Code Getting Started page automatically
- ✅ **Native Experience**: Users see familiar VS Code onboarding pattern
- ✅ **Rich UI**: Angular + DaisyUI provides beautiful interactive wizard
- ✅ **Progress Tracking**: Context keys enable conditional UI and completion badges
- ✅ **Best of Both Worlds**: Native discoverability + custom rich UI

**Files Affected**:

- `apps/ptah-extension-vscode/package.json` - Add walkthroughs contribution
- `resources/walkthrough/*.svg` - 3 walkthrough step images
- `apps/ptah-extension-vscode/src/commands/setup-wizard.commands.ts` - Command registrations
- `libs/backend/agent-generation/src/lib/services/setup-wizard.service.ts` - Command handlers + context updates

---

### Updated Service Count

**Total Services**: 9 (unchanged)

1. ✅ SetupWizardService (enhanced with walkthrough integration)
2. ✅ AgentGenerationOrchestratorService (updated to use AgentCustomizationService)
3. ✅ AgentSelectionService (unchanged)
4. ✅ **AgentCustomizationService** (replaces VsCodeLmService - wraps ptah.ai)
5. ✅ TemplateStorageService (unchanged)
6. ✅ OutputValidationService (unchanged)
7. ✅ AgentTemplateRenderer (unchanged)
8. ✅ AgentFileWriterService (unchanged)
9. ✅ MigrationService (stub, unchanged)

### Updated Dependencies

**Internal Dependencies** (Verified):

- `@ptah-extension/shared` - Result type, branded types
- `@ptah-extension/vscode-core` - DI tokens, Logger, FileSystemService
- `@ptah-extension/workspace-intelligence` - Project analysis
- `@ptah-extension/template-generation` - Template infrastructure
- **`@ptah-extension/vscode-lm-tools`** - ptah.ai LLM infrastructure (NEW)

**External Dependencies** (No new dependencies):

- `gray-matter` (^4.0.3) - Already in workspace-intelligence
- `picomatch` (^4.0.2) - Already in workspace-intelligence
- VS Code Extension API - Built-in (walkthroughs, commands, context)

### Updated File Count

**Before**: ~40 new files
**After**: ~45 new files (+5 for walkthroughs)

**Breakdown**:

- 9 service files
- 6 type definition files
- 1 errors file
- 1 DI registration file
- 11 agent templates
- N command templates
- 6 Angular wizard components
- 3 walkthrough SVG images
- 1 command registration file
- 4 modified files (extension.ts, package.json, tokens.ts, template-generator.service.ts)

### Architecture Validation

**All Changes Evidence-Based**:

- ✅ ptah.ai.invokeAgent() verified in codebase (system-namespace.builders.ts:366-424)
- ✅ VS Code Walkthroughs API verified in official documentation
- ✅ Context keys pattern verified in VS Code API docs
- ✅ PtahAPIBuilder DI pattern verified in vscode-lm-tools
- ✅ No hallucinated APIs or services

**Pattern Compliance Maintained**:

- ✅ Dependency Injection (all services use @injectable())
- ✅ Result Pattern (all methods return Result<T, E>)
- ✅ Service Orchestration (high-level services compose low-level)
- ✅ YAML Frontmatter (agent metadata parsing)
- ✅ Logging (all services inject Logger)

**Performance Targets Unchanged**:

- Workspace scan: <30 seconds (95% of projects)
- LLM customization: <10 seconds per agent (95%)
- Total setup: <5 minutes
- Memory: <200MB additional

**Architecture Ready for Team-Leader Decomposition** ✅
