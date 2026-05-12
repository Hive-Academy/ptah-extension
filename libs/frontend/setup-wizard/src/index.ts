// Wizard Services
export { SetupWizardStateService } from './lib/services/setup-wizard-state.service';
export { WizardRpcService } from './lib/services/wizard-rpc.service';
export { ToolOutputFormatterService } from './lib/services/tool-output-formatter.service';

// Wave F1 (TASK_2026_103): inverted-dependency contract for the wizard
// internal-state map. Composition root binds the token via
// `provideWizardInternalState()` (mirrors B1's STREAMING_CONTROL pattern).
export {
  WIZARD_INTERNAL_STATE,
  type WizardInternalState,
} from './lib/services/setup-wizard/wizard-internal-state';
export { provideWizardInternalState } from './lib/services/wizard-internal-state.provider';

// Main Wizard Container
export { WizardViewComponent } from './lib/components/wizard-view.component';

// Wizard Components (Steps 1-3)
export { WelcomeComponent } from './lib/components/welcome.component';
export { ScanProgressComponent } from './lib/components/scan-progress.component';
export { AnalysisResultsComponent } from './lib/components/analysis-results.component';

// Wizard Components (Steps 4-6)
export { AgentSelectionComponent } from './lib/components/agent-selection.component';
export { PromptEnhancementComponent } from './lib/components/prompt-enhancement.component';
export { GenerationProgressComponent } from './lib/components/generation-progress.component';
export { CompletionComponent } from './lib/components/completion.component';

// Utility Components
export { ConfirmationModalComponent } from './lib/components/confirmation-modal.component';
export { PremiumUpsellComponent } from './lib/components/premium-upsell.component';
export { AnalysisTranscriptComponent } from './lib/components/analysis-transcript.component';
export { AnalysisStatsDashboardComponent } from './lib/components/analysis-stats-dashboard.component';

// Summary Cards
export { EnhancedPromptsSummaryCardComponent } from './lib/components/cards/enhanced-prompts-summary-card.component';

// Wizard Types
export type {
  WizardStep,
  ProjectContext,
  AgentSelection,
  GenerationProgress,
  AgentProgress,
  ScanProgress,
  AnalysisResults,
  CompletionData,
  ErrorState,
  EnhancedPromptsWizardStatus,
} from './lib/services/setup-wizard-state.service';
