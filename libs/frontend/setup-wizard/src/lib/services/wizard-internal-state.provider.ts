/**
 * provideWizardInternalState — Composition-root helper for binding the
 * `WIZARD_INTERNAL_STATE` token to the `SetupWizardStateService` instance.
 *
 * Usage in app.config.ts:
 *
 *   providers: [
 *     ...
 *     ...provideWizardInternalState(),
 *   ]
 *
 * The factory reads `getInternalState()` off the singleton coordinator so
 * external consumers can inject the writable-signal map without depending
 * on the coordinator class — that import direction is what previously
 * formed the cycle with the in-process helpers.
 */

import { inject, type Provider } from '@angular/core';

import { SetupWizardStateService } from './setup-wizard-state.service';
import { WIZARD_INTERNAL_STATE } from './setup-wizard/wizard-internal-state';

export function provideWizardInternalState(): Provider[] {
  return [
    {
      provide: WIZARD_INTERNAL_STATE,
      useFactory: () => inject(SetupWizardStateService).getInternalState(),
    },
  ];
}
