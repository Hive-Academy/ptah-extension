import type { Provider } from '@angular/core';
import { SURFACE_FOCUS_ROUTER } from '@ptah-extension/core';
import { HarnessBuilderFocusRouter } from './harness-builder-focus-router.service';

export function provideHarnessBuilderFocusRouter(): Provider[] {
  return [{ provide: SURFACE_FOCUS_ROUTER, useExisting: HarnessBuilderFocusRouter, multi: true }];
}
