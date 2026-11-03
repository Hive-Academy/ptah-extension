/**
 * Onboarding Library - lazy entry point (TASK_2026_ONBOARDING).
 *
 * Reached only through the webview's `loadChildren`:
 *
 *   import('@ptah-extension/onboarding').then((m) => m.ONBOARDING_ROUTES);
 *
 * Eager code (the app's routes and config) imports the narrow
 * `@ptah-extension/onboarding/services` entry instead.
 */
export { ONBOARDING_ROUTES } from './lib/onboarding.routes';
