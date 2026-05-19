/**
 * Service Interfaces for Agent Generation
 *
 * This module exports all service interfaces used in the agent generation system.
 * These interfaces define contracts for services that will be implemented and
 * injected via dependency injection.
 *
 * @module @ptah-extension/agent-generation/interfaces
 */
export { ITemplateStorageService } from './template-storage.interface';
export {
  IAgentSelectionService,
  SelectionResult,
} from './agent-selection.interface';
export {
  IContentGenerationService,
  type ContentGenerationSdkConfig,
} from './content-generation.interface';
export { IOutputValidationService } from './output-validation.interface';
export { IAgentFileWriterService } from './agent-file-writer.interface';
export { ISetupWizardOrchestrator } from './setup-wizard-orchestrator.interface';
export {
  IAgentCustomizationService,
  CustomizationRequest,
} from './agent-customization.interface';
