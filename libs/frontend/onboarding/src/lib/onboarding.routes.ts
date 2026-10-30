import type { Routes } from '@angular/router';
import { AnalyzeWorkspacePage } from './analyze/analyze-workspace.page';
import { ChooseAgentsPage } from './analyze/choose-agents.page';
import { OnboardingHomeComponent } from './home/onboarding-home.component';
import { onboardingReadyHostGuard } from './ready/onboarding-ready-host.guard';
import { ReadyClaudeStepPage } from './ready/ready-claude-step.page';
import {
  READY_SETTINGS_PROVIDERS,
  ReadySettingsStepPage,
} from './ready/ready-settings-step.page';
import { OnboardingShellComponent } from './shell/onboarding-shell.component';

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
      { path: 'analyze', component: AnalyzeWorkspacePage, data: { crumb: 'Analyze workspace' } },
      { path: 'analyze/agents', component: ChooseAgentsPage, data: { crumb: 'Choose agents' } },
      { path: '**', redirectTo: '' },
    ],
  },
];
