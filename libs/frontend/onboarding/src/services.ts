/**
 * Onboarding Library - eager entry point.
 *
 * Exports the first-run guard/state and notification focus router needed at
 * bootstrap, without pulling onboarding pages into the initial bundle.
 * Keep wizard UI modules outside this eager entry point.
 *
 *   import { onboardingFirstRunGuard } from '@ptah-extension/onboarding/services';
 *
 * Pages load through the main entry, `@ptah-extension/onboarding`, which is
 * only ever reached through a dynamic `import()`.
 */

export {
  ONBOARDING_FLAG_KEY,
  OnboardingFlagService,
  type OnboardingFlag,
} from './lib/first-run/onboarding-flag.service';
export { OnboardingFirstRunTracker } from './lib/first-run/onboarding-first-run.tracker';
export { onboardingFirstRunGuard } from './lib/first-run/onboarding-first-run.guard';
export { provideOnboardingFirstRun } from './lib/first-run/provide-onboarding-first-run';
export { OnboardingFocusRouter } from './lib/focus/onboarding-focus-router.service';
export { provideOnboardingFocusRouter } from './lib/focus/onboarding-focus-router.provider';
