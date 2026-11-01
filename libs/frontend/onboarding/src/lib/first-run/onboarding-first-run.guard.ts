import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { VSCodeService } from '@ptah-extension/core';
import { OnboardingFlagService } from './onboarding-flag.service';
import { OnboardingFirstRunTracker } from './onboarding-first-run.tracker';

/**
 * The chat route's first-run guard.
 *
 * On Electron, while the onboarding flag is eligible, it redirects to the
 * Get ready stage 1 (`/onboarding/ready`) until a pre-step was left by
 * Continue or skipped, otherwise to Home (`/onboarding`), and records the redirected navigation with the tracker, which
 * commits `shownAt` only when the redirect lands. Everywhere else it returns
 * `true`: the VS Code host, a written flag, unavailable storage or an
 * unreadable record. It sits on chat because every boot path that would show
 * chat (host default, restored `/chat`, the root redirect) ends there, while a
 * deep link to any other surface never reaches it.
 *
 * No readiness polling: the boot navigation already runs after the host is
 * connected.
 */
export const onboardingFirstRunGuard: CanActivateFn = () => {
  if (!inject(VSCodeService).isElectron) return true;
  const flags = inject(OnboardingFlagService);
  if (!flags.isFirstRunEligible()) return true;

  const router = inject(Router);
  // An untracked redirect never commits `shownAt`, so every later visit to
  // chat would redirect again; without a navigation to track, let chat open.
  const navigationId = router.currentNavigation()?.id;
  if (navigationId === undefined) return true;
  inject(OnboardingFirstRunTracker).recordRedirect(navigationId);
  const ready = flags.flag().ready;
  return ready?.claudeAt || ready?.skippedAt
    ? router.createUrlTree(['/onboarding'])
    : router.createUrlTree(['/onboarding', 'ready']);
};
