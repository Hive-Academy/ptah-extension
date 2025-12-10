/**
 * Service Interfaces for Agent Generation
 *
 * This module exports all service interfaces used in the agent generation system.
 * These interfaces define contracts for services that will be implemented and
 * injected via dependency injection.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */

// Template Storage
export { ITemplateStorageService } from './template-storage.interface';

// Agent Selection
export {
  IAgentSelectionService,
  SelectionResult,
} from './agent-selection.interface';

// Content Generation
export { IContentGenerationService } from './content-generation.interface';

// Output Validation
export { IOutputValidationService } from './output-validation.interface';

// Agent File Writer
export { IAgentFileWriterService } from './agent-file-writer.interface';

// Setup Wizard Orchestrator
export { ISetupWizardOrchestrator } from './setup-wizard-orchestrator.interface';
