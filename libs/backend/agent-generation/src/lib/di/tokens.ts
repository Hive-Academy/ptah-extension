/**
 * DI Token Registry - Agent Generation Tokens
 *
 * CONVENTION: All DI tokens MUST use Symbol.for('DescriptiveName')
 *
 * Why Symbol.for():
 * - Symbol.for() creates globally shared symbols (same description = same symbol)
 * - String tokens ('Name') and Symbol.for('Name') are different — causes silent DI failures
 * - Plain Symbol('Name') !== Symbol('Name') — creates unique symbols per call
 * - Symbol.for('Name') === Symbol.for('Name') — always matches, even across modules
 *
 * Rules:
 * 1. Always use Symbol.for() for token values
 * 2. Never use string literals as DI tokens
 * 3. Never use plain Symbol() (without .for)
 * 4. Always inject via token constants (TOKENS.X, SDK_TOKENS.X), never hardcode strings
 *    in @inject() decorators
 * 5. Each Symbol.for() description must be globally unique across all token files
 *    (unless intentionally shared for cross-library resolution)
 *
 * Token files:
 * - vscode-core/src/di/tokens.ts    — core infrastructure tokens (TOKENS)
 * - agent-sdk/src/lib/di/tokens.ts  — SDK-specific tokens (SDK_TOKENS)
 * - agent-generation/src/lib/di/tokens.ts (this file) — agent generation tokens
 *
 * @see libs/backend/vscode-core/src/di/tokens.ts for canonical convention reference
 */

// ========================================
// Core Orchestration Services
// ========================================

/**
 * SetupWizardService - Orchestrates 6-step wizard UI flow
 * Responsibilities: Manage wizard step transitions, handle RPC messages, track session state
 */
export const SETUP_WIZARD_SERVICE = Symbol.for('SetupWizardService');

/**
 * SetupStatusService - Agent configuration status detection
 * Responsibilities: Check agent existence, count agents, return last modified timestamp
 */
export const SETUP_STATUS_SERVICE = Symbol.for('SetupStatusService');

/**
 * AgentGenerationOrchestratorService - End-to-end generation coordinator
 * Responsibilities: Coordinate 5-phase workflow (Analysis → Selection → Customization → Rendering → Writing)
 */
export const AGENT_GENERATION_ORCHESTRATOR = Symbol.for(
  'AgentGenerationOrchestratorService'
);

// ========================================
// Template Management Services
// ========================================

/**
 * TemplateStorageService - Template loading and metadata caching
 * Responsibilities: Load templates, parse YAML frontmatter, cache templates, extract metadata
 */
export const TEMPLATE_STORAGE_SERVICE = Symbol.for('TemplateStorageService');

/**
 * AgentTemplateRenderer - Template rendering with variable substitution
 * Responsibilities: Substitute variables, assemble sections, process conditionals, inject metadata
 */
export const AGENT_TEMPLATE_RENDERER = Symbol.for('AgentTemplateRenderer');

// ========================================
// Agent Selection Services
// ========================================

/**
 * AgentSelectionService - Agent relevance scoring and selection
 * Responsibilities: Score templates (0-100), apply threshold, handle user overrides, log reasoning
 */
export const AGENT_SELECTION_SERVICE = Symbol.for('AgentSelectionService');

/**
 * AgentRecommendationService - Deep analysis-based agent recommendations
 * Responsibilities: Score all 13 agents based on project analysis, categorize agents, generate recommendations
 */
export const AGENT_RECOMMENDATION_SERVICE = Symbol.for(
  'AgentRecommendationService'
);

/**
 * SkillGeneratorService - Orchestration skill generation
 * Responsibilities: Generate SKILL.md and reference files, handle template variable substitution, project customization
 */
export const SKILL_GENERATOR_SERVICE = Symbol.for('SkillGeneratorService');

// ========================================
// Content Generation Services
// ========================================

/**
 * ContentGenerationService - Template rendering with variable substitution
 * Responsibilities: Substitute variables, inject LLM sections, process conditionals, preserve static sections
 */
export const CONTENT_GENERATION_SERVICE = Symbol.for(
  'ContentGenerationService'
);

/**
 * AgentCustomizationService - LLM-based content customization
 * Responsibilities: Customize agent sections, validate outputs, batch customize, wrap ptah.ai
 */
export const AGENT_CUSTOMIZATION_SERVICE = Symbol.for(
  'AgentCustomizationService'
);

/**
 * VsCodeLmService - VS Code LM API integration with retry and validation
 * Responsibilities: Wrap VsCodeLmProvider, add retry logic, integrate OutputValidationService
 */
export const VSCODE_LM_SERVICE = Symbol.for('VsCodeLmService');

/**
 * OutputValidationService - Multi-stage output validation
 * Responsibilities: Validate schema, safety, factual accuracy for LLM outputs
 */
export const OUTPUT_VALIDATION_SERVICE = Symbol.for('OutputValidationService');

// ========================================
// File Operations Services
// ========================================

/**
 * AgentFileWriterService - Atomic file writing with rollback
 * Responsibilities: Write agents atomically, backup existing files, rollback on error
 */
export const AGENT_FILE_WRITER_SERVICE = Symbol.for('AgentFileWriterService');

// ========================================
// Migration Services (Future Phase)
// ========================================

/**
 * MigrationService - Agent upgrade and migration
 * Responsibilities: Detect outdated agents, calculate update impact, show diff preview, regenerate with consent
 */
export const MIGRATION_SERVICE = Symbol.for('MigrationService');

// ========================================
// Wizard Child Services (TASK_2025_115)
// ========================================

/**
 * WizardWebviewLifecycleService - Webview panel management
 * Responsibilities: Create panels, send responses, emit progress, cleanup
 */
export const WIZARD_WEBVIEW_LIFECYCLE = Symbol.for(
  'WizardWebviewLifecycleService'
);

/**
 * WizardSessionManagerService - Session CRUD and persistence
 * Responsibilities: Create, save, load, validate sessions
 */
export const WIZARD_SESSION_MANAGER = Symbol.for('WizardSessionManagerService');

/**
 * WizardStepMachineService - Step state machine
 * Responsibilities: Validate transitions, determine next step
 */
export const WIZARD_STEP_MACHINE = Symbol.for('WizardStepMachineService');

/**
 * DeepProjectAnalysisService - Comprehensive project analysis
 * Responsibilities: Architecture detection, key file discovery, language stats
 */
export const DEEP_PROJECT_ANALYSIS = Symbol.for('DeepProjectAnalysisService');

/**
 * CodeHealthAnalysisService - Code health metrics
 * Responsibilities: Diagnostics, conventions, test coverage
 */
export const CODE_HEALTH_ANALYSIS = Symbol.for('CodeHealthAnalysisService');

/**
 * WizardContextMapperService - Context transformation
 * Responsibilities: Frontend to backend context mapping
 */
export const WIZARD_CONTEXT_MAPPER = Symbol.for('WizardContextMapperService');

// ========================================
// Token Registry (Type-Safe Access)
// ========================================

/**
 * AGENT_GENERATION_TOKENS - Centralized token registry
 * Provides a single source of truth for all agent-generation DI tokens
 */
export const AGENT_GENERATION_TOKENS = {
  // Core Orchestration
  SETUP_WIZARD_SERVICE,
  SETUP_STATUS_SERVICE,
  AGENT_GENERATION_ORCHESTRATOR,

  // Template Management
  TEMPLATE_STORAGE_SERVICE,
  AGENT_TEMPLATE_RENDERER,

  // Agent Selection
  AGENT_SELECTION_SERVICE,
  AGENT_RECOMMENDATION_SERVICE,

  // Skill Generation
  SKILL_GENERATOR_SERVICE,

  // Content Generation
  CONTENT_GENERATION_SERVICE,
  AGENT_CUSTOMIZATION_SERVICE,
  VSCODE_LM_SERVICE,
  OUTPUT_VALIDATION_SERVICE,

  // File Operations
  AGENT_FILE_WRITER_SERVICE,

  // Migration (Future)
  MIGRATION_SERVICE,

  // Wizard Child Services (TASK_2025_115)
  WIZARD_WEBVIEW_LIFECYCLE,
  WIZARD_SESSION_MANAGER,
  WIZARD_STEP_MACHINE,
  DEEP_PROJECT_ANALYSIS,
  CODE_HEALTH_ANALYSIS,
  WIZARD_CONTEXT_MAPPER,
} as const;

/**
 * Type helper for type-safe token access
 */
export type AgentGenerationTokens = typeof AGENT_GENERATION_TOKENS;
