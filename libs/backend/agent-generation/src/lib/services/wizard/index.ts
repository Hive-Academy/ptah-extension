/**
 * Wizard Child Services - Barrel Exports
 * TASK_2025_115: Setup Wizard Service Decomposition
 *
 * This module exports all wizard child services that compose the SetupWizardService.
 * Each service handles a focused responsibility following Single Responsibility Principle.
 *
 * Services exported:
 * - WizardWebviewLifecycleService: Webview panel creation and lifecycle management
 * - WizardSessionManagerService: Session CRUD, persistence, and validation
 * - WizardStepMachineService: Step state machine and transition logic
 * - DeepProjectAnalysisService: Comprehensive project analysis and architecture detection
 * - CodeHealthAnalysisService: Diagnostics, conventions, and test coverage analysis
 * - WizardContextMapperService: Frontend-to-backend context transformation
 */

// Barrel exports for wizard child services
export { WizardWebviewLifecycleService } from './webview-lifecycle.service';
export { WizardSessionManagerService } from './session-manager.service';
export { WizardStepMachineService } from './step-machine.service';
export { DeepProjectAnalysisService } from './deep-analysis.service';
export { CodeHealthAnalysisService } from './code-health.service';
export { WizardContextMapperService } from './context-mapper.service';

// Type exports
export type {
  CustomMessageHandler,
  WizardPanelInitialData,
} from './webview-lifecycle.service';
export type { StepDataResult } from './step-machine.service';
