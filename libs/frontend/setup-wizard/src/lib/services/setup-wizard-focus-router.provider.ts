import type { Provider } from '@angular/core';
import { SURFACE_FOCUS_ROUTER } from '@ptah-extension/core';
import { SetupWizardFocusRouter } from './setup-wizard-focus-router.service';

export function provideSetupWizardFocusRouter(): Provider[] {
  return [{ provide: SURFACE_FOCUS_ROUTER, useExisting: SetupWizardFocusRouter, multi: true }];
}
