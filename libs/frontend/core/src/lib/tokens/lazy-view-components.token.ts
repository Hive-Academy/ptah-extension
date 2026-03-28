import { InjectionToken, Type } from '@angular/core';

/**
 * Token for lazily-provided view components that break circular dependencies.
 *
 * Some feature libraries (e.g. setup-wizard) export components that are rendered
 * inside other feature libraries (e.g. chat's AppShellComponent). Direct imports
 * would create circular dependencies. Instead, the application provides these
 * component references at bootstrap time via this token.
 *
 * Usage in app.config.ts:
 * ```typescript
 * import { WizardViewComponent } from '@ptah-extension/setup-wizard';
 * { provide: WIZARD_VIEW_COMPONENT, useValue: WizardViewComponent }
 * ```
 *
 * Usage in consuming component:
 * ```typescript
 * readonly wizardComponent = inject(WIZARD_VIEW_COMPONENT, { optional: true });
 * ```
 */
export const WIZARD_VIEW_COMPONENT = new InjectionToken<Type<unknown>>(
  'WIZARD_VIEW_COMPONENT',
);
