import {
  inject,
  provideAppInitializer,
  type EnvironmentProviders,
} from '@angular/core';
import { OnboardingFirstRunTracker } from './onboarding-first-run.tracker';

/**
 * Starts the first-run tracker at bootstrap, before the boot navigation the
 * chat guard may redirect. Register once in the webview's `app.config.ts`.
 */
export function provideOnboardingFirstRun(): EnvironmentProviders {
  return provideAppInitializer(() => inject(OnboardingFirstRunTracker).start());
}
