import type { Provider } from '@angular/core';
import { SURFACE_FOCUS_ROUTER } from '@ptah-extension/core';
import { AppsFocusRouter } from './apps-focus-router.service';

export function provideAppsFocusRouter(): Provider[] {
  return [{ provide: SURFACE_FOCUS_ROUTER, useExisting: AppsFocusRouter, multi: true }];
}
