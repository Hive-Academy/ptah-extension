import type { Routes } from '@angular/router';
import { AnalyzeWorkspacePage } from './analyze/analyze-workspace.page';
import { ChooseAgentsPage } from './analyze/choose-agents.page';
import { GenerateAgentsPage } from './analyze/generate-agents.page';
import { ProjectGuidancePage } from './analyze/project-guidance.page';
import { AnalyzeDonePage } from './analyze/analyze-done.page';
import { OnboardingHomeComponent } from './home/onboarding-home.component';
import { onboardingReadyHostGuard } from './ready/onboarding-ready-host.guard';
import { ReadyClaudeStepPage } from './ready/ready-claude-step.page';
import {
  READY_SETTINGS_PROVIDERS,
  ReadySettingsStepPage,
} from './ready/ready-settings-step.page';
import { OnboardingShellComponent } from './shell/onboarding-shell.component';
import {
  HARNESS_FLOW_MODE,
  ProposalFlowStore,
} from './proposal/proposal-flow.store';
import { NewProjectIntakePage } from './proposal/new-project-intake.page';
import { TeamBuilderStartPage } from './proposal/team-builder-start.page';
import { ProposalWorkspacePage } from './proposal/proposal-workspace.page';
import { ReviewApplyPage } from './proposal/review-apply.page';

/**
 * The onboarding surface's route tree, loaded by the webview's `onboarding`
 * route through `loadChildren`. Every page renders inside the shell and ships
 * in this one lazy chunk.
 *
 * Flow routes are added before the `**` fallback, which keeps it last.
 */
export const ONBOARDING_ROUTES: Routes = [
  {
    path: '',
    component: OnboardingShellComponent,
    children: [
      { path: '', pathMatch: 'full', component: OnboardingHomeComponent },
      {
        // Get ready pre-steps (Electron only; elsewhere they land on Home).
        path: 'ready',
        canMatch: [onboardingReadyHostGuard],
        data: { crumb: 'Get ready' },
        children: [
          { path: '', pathMatch: 'full', component: ReadyClaudeStepPage },
          {
            path: 'settings',
            component: ReadySettingsStepPage,
            providers: READY_SETTINGS_PROVIDERS,
          },
        ],
      },
      {
        path: 'analyze',
        component: AnalyzeWorkspacePage,
        data: { crumb: 'Analyze workspace' },
      },
      {
        path: 'analyze/agents',
        component: ChooseAgentsPage,
        data: { crumb: 'Choose agents' },
      },
      {
        path: 'analyze/generate',
        component: GenerateAgentsPage,
        data: { crumb: 'Generate agents' },
      },
      {
        path: 'analyze/guidance',
        component: ProjectGuidancePage,
        data: { crumb: 'Project guidance' },
      },
      {
        path: 'analyze/done',
        component: AnalyzeDonePage,
        data: { crumb: 'Done' },
      },
      {
        path: 'guidance',
        component: ProjectGuidancePage,
        data: { crumb: 'Project guidance', standalone: true },
      },
      {
        path: 'new-project',
        data: { crumb: 'New project' },
        providers: [
          ProposalFlowStore,
          { provide: HARNESS_FLOW_MODE, useValue: 'new-project' },
        ],
        children: [
          { path: '', pathMatch: 'full', component: NewProjectIntakePage },
          { path: 'workspace', component: ProposalWorkspacePage },
          { path: 'review', component: ReviewApplyPage },
        ],
      },
      {
        path: 'team-builder',
        data: { crumb: 'AI team builder' },
        providers: [
          ProposalFlowStore,
          { provide: HARNESS_FLOW_MODE, useValue: 'configure-harness' },
        ],
        children: [
          { path: '', pathMatch: 'full', component: TeamBuilderStartPage },
          { path: 'workspace', component: ProposalWorkspacePage },
          { path: 'review', component: ReviewApplyPage },
        ],
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
