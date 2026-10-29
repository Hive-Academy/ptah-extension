import type { Routes } from '@angular/router';
import { OnboardingHomeComponent } from './home/onboarding-home.component';
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
      { path: '**', redirectTo: '' },
    ],
  },
];
