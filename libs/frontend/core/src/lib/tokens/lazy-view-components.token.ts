import { InjectionToken, Type } from '@angular/core';

/**
 * Token for lazily-provided view components that break circular dependencies.
 *
 * Some feature libraries (e.g. setup-wizard, canvas) export components that are
 * rendered inside other feature libraries (e.g. chat's AppShellComponent). Direct
 * imports would create circular dependencies. Instead, the application provides
 * these component references at bootstrap time via these tokens.
 *
 * Usage in app.config.ts:
 * ```typescript
 * import { WizardViewComponent } from '@ptah-extension/setup-wizard';
 * { provide: WIZARD_VIEW_COMPONENT, useValue: WizardViewComponent }
 *
 * import { OrchestraCanvasComponent } from '@ptah-extension/canvas';
 * { provide: ORCHESTRA_CANVAS_COMPONENT, useValue: OrchestraCanvasComponent }
 * ```
 *
 * Usage in consuming component:
 * ```typescript
 * readonly wizardComponent = inject(WIZARD_VIEW_COMPONENT, { optional: true });
 * readonly orchestraCanvasComponent = inject(ORCHESTRA_CANVAS_COMPONENT, { optional: true });
 * ```
 */
export const WIZARD_VIEW_COMPONENT = new InjectionToken<Type<unknown>>(
  'WIZARD_VIEW_COMPONENT',
);

/**
 * Token for OrchestraCanvasComponent — breaks circular dependency between
 * @ptah-extension/canvas (which depends on @ptah-extension/chat) and
 * @ptah-extension/chat (AppShellComponent renders the canvas view).
 */
export const ORCHESTRA_CANVAS_COMPONENT = new InjectionToken<Type<unknown>>(
  'ORCHESTRA_CANVAS_COMPONENT',
);

/**
 * Token for HarnessBuilderViewComponent — breaks circular dependency between
 * @ptah-extension/harness-builder and @ptah-extension/chat (AppShellComponent renders the view).
 */
export const HARNESS_BUILDER_COMPONENT = new InjectionToken<Type<unknown>>(
  'HARNESS_BUILDER_COMPONENT',
);
