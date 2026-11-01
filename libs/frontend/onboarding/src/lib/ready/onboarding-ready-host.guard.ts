import { inject } from '@angular/core';
import { Router, type CanMatchFn } from '@angular/router';
import { VSCodeService } from '@ptah-extension/core';

/**
 * The Get ready stages exist only in Electron. Anywhere else a deep link, a
 * restored URL or a stray link to `/onboarding/ready*` lands on Home.
 */
export const onboardingReadyHostGuard: CanMatchFn = () =>
  inject(VSCodeService).isElectron ||
  inject(Router).createUrlTree(['/onboarding']);
