/**
 * Dependency Injection tokens for agent-generation library.
 *
 * Uses tsyringe for DI container management.
 * All tokens use Symbol.for() for cross-module DI support.
 *
 * @see libs/backend/vscode-core/src/di/tokens.ts for pattern reference
 * @see task-tracking/TASK_2025_058/implementation-plan.md for service specifications
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

  // Content Generation
  CONTENT_GENERATION_SERVICE,
  AGENT_CUSTOMIZATION_SERVICE,
  VSCODE_LM_SERVICE,
  OUTPUT_VALIDATION_SERVICE,

  // File Operations
  AGENT_FILE_WRITER_SERVICE,

  // Migration (Future)
  MIGRATION_SERVICE,
} as const;

/**
 * Type helper for type-safe token access
 */
export type AgentGenerationTokens = typeof AGENT_GENERATION_TOKENS;
