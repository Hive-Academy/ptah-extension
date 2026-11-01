import type { Provider } from '@angular/core';
import { SURFACE_FOCUS_ROUTER } from '@ptah-extension/core';
import { OnboardingFocusRouter } from './onboarding-focus-router.service';

export function provideOnboardingFocusRouter(): Provider[] {
  return [
    {
      provide: SURFACE_FOCUS_ROUTER,
      useExisting: OnboardingFocusRouter,
      multi: true,
    },
  ];
}
