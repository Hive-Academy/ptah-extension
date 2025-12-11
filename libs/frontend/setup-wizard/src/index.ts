// Wizard Services
export { SetupWizardStateService } from './lib/services/setup-wizard-state.service';
export { WizardRpcService } from './lib/services/wizard-rpc.service';

// Wizard Components (Steps 1-3)
export { WelcomeComponent } from './lib/components/welcome.component';
export { ScanProgressComponent } from './lib/components/scan-progress.component';
export { AnalysisResultsComponent } from './lib/components/analysis-results.component';

// Wizard Components (Steps 4-6)
export { AgentSelectionComponent } from './lib/components/agent-selection.component';
export { GenerationProgressComponent } from './lib/components/generation-progress.component';
export { CompletionComponent } from './lib/components/completion.component';

// Wizard Types
export type {
  WizardStep,
  ProjectContext,
  AgentSelection,
  GenerationProgress,
  AgentProgress,
} from './lib/services/setup-wizard-state.service';
