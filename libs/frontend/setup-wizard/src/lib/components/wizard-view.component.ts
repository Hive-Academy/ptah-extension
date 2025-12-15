/**
 * WizardViewComponent - Main Setup Wizard Container
 *
 * Renders the appropriate step component based on current wizard state.
 * This component is the main entry point for the setup wizard view.
 */

import { Component, inject, ChangeDetectionStrategy } from '@angular/core';

import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WelcomeComponent } from './welcome.component';
import { ScanProgressComponent } from './scan-progress.component';
import { AnalysisResultsComponent } from './analysis-results.component';
import { AgentSelectionComponent } from './agent-selection.component';
import { GenerationProgressComponent } from './generation-progress.component';
import { CompletionComponent } from './completion.component';

@Component({
  selector: 'ptah-wizard-view',
  standalone: true,
  imports: [
    WelcomeComponent,
    ScanProgressComponent,
    AnalysisResultsComponent,
    AgentSelectionComponent,
    GenerationProgressComponent,
    CompletionComponent,
  ],
  template: `
    <div class="wizard-container h-full flex flex-col bg-base-100">
      <!-- Progress indicator -->
      <div class="wizard-progress p-4 border-b border-base-300">
        <ul class="steps steps-horizontal w-full">
          <li class="step" [class.step-primary]="stepIndex() >= 0">Welcome</li>
          <li class="step" [class.step-primary]="stepIndex() >= 1">Scan</li>
          <li class="step" [class.step-primary]="stepIndex() >= 2">Analysis</li>
          <li class="step" [class.step-primary]="stepIndex() >= 3">Select</li>
          <li class="step" [class.step-primary]="stepIndex() >= 4">Generate</li>
          <li class="step" [class.step-primary]="stepIndex() >= 5">Complete</li>
        </ul>
      </div>

      <!-- Step content -->
      <div class="wizard-content flex-1 overflow-y-auto p-4">
        @switch (currentStep()) { @case ('welcome') {
        <ptah-welcome />
        } @case ('scan') {
        <ptah-scan-progress />
        } @case ('analysis') {
        <ptah-analysis-results />
        } @case ('selection') {
        <ptah-agent-selection />
        } @case ('generation') {
        <ptah-generation-progress />
        } @case ('completion') {
        <ptah-completion />
        } }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WizardViewComponent {
  private readonly wizardState = inject(SetupWizardStateService);

  readonly currentStep = this.wizardState.currentStep;

  readonly stepIndex = this.wizardState.stepIndex;
}
