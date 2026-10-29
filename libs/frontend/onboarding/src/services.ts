/**
 * Onboarding Library - eager entry point.
 *
 * Exports only the first-run pieces the webview's composition root needs at
 * bootstrap (the chat route's guard, the flag and its tracker), so importing
 * it statically does not pull the onboarding pages into the initial bundle.
 * Nothing reachable from here may import `@ptah-extension/setup-wizard`.
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
