import { InjectionToken, type Signal } from '@angular/core';

/**
 * Angular-only entry point. Never re-export from the platform-neutral shared root:
 * CLI, Electron main and extension-host consumers must not load Angular.
 */
export const SURFACE_ACTIVE = new InjectionToken<Signal<boolean>>(
  'SURFACE_ACTIVE',
);
