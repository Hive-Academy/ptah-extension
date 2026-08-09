import { InjectionToken, Type } from '@angular/core';

/**
 * Token for lazily-provided view components that break circular dependencies.
 *
 * Some feature libraries (e.g. setup-wizard, canvas) export components that are
 * rendered inside other feature libraries (e.g. chat's AppShellComponent). Direct
 * imports would create circular dependencies. Instead, the application provides
 * these component references at bootstrap time via these tokens.
 *
 * Two binding forms are live (TASK_2026_187) — **check the individual token's
 * generic before wiring it.**
 *
 * Eager form (tokens typed `InjectionToken<Type<unknown>>`):
 * ```typescript
 * import { WizardViewComponent } from '@ptah-extension/setup-wizard';
 * { provide: WIZARD_VIEW_COMPONENT, useValue: WizardViewComponent }
 *
 * readonly wizardComponent = inject(WIZARD_VIEW_COMPONENT, { optional: true });
 * ```
 *
 * Deferred form (tokens typed `InjectionToken<LazyViewLoader>`) — `useValue`
 * with an arrow function, never `useFactory`:
 * ```typescript
 * {
 *   provide: MARKETPLACE_COMPONENT,
 *   useValue: () =>
 *     import('@ptah-extension/marketplace').then((m) => m.MarketplaceHubComponent),
 * }
 *
 * readonly marketplaceComponent = this.lazyViews.resolveWhen(
 *   MARKETPLACE_COMPONENT,
 *   () => this.currentView() === 'marketplace',
 * );
 * ```
 *
 * **Only defer a surface the user is not already waiting for.** A view reached
 * by explicit navigation (marketplace, tribunal) is a good candidate; a launch
 * surface is not. `ORCHESTRA_CANVAS_COMPONENT` is deliberately eager for exactly
 * this reason — see its own doc comment.
 */
/**
 * Deferred component resolver for a lazy view token.
 *
 * The application binds each token to a **plain arrow function** via `useValue`
 * (never `useFactory` — that would invoke the arrow at injection time and start
 * every dynamic import at bootstrap, which is the exact inverse of the goal):
 *
 * ```typescript
 * {
 *   provide: MARKETPLACE_COMPONENT,
 *   useValue: () =>
 *     import('@ptah-extension/marketplace').then((m) => m.MarketplaceHubComponent),
 * }
 * ```
 *
 * Consumers must not call the loader directly — go through
 * {@link LazyViewService.resolveWhen}, which is trigger-gated so the import only
 * starts when the surface is actually wanted.
 *
 * @see TASK_2026_187
 */
export type LazyViewLoader = () => Promise<Type<unknown>>;

export const WIZARD_VIEW_COMPONENT = new InjectionToken<Type<unknown>>(
  'WIZARD_VIEW_COMPONENT',
);

/**
 * Token for OrchestraCanvasComponent — breaks circular dependency between
 * @ptah-extension/canvas (which depends on @ptah-extension/chat) and
 * @ptah-extension/chat (AppShellComponent renders the canvas view).
 *
 * **Deliberately EAGER — do not convert this to a {@link LazyViewLoader}.**
 * It was deferred during TASK_2026_187 and reverted on measured evidence: the
 * canvas is the launch surface in Electron (`ElectronShellComponent` calls
 * `setLayoutMode('grid')` unconditionally in its constructor), so deferring it
 * cost 50-70 ms of startup TTI on every launch with no path on which it helped.
 * Deferring the surface the user is already waiting for is a loss, not a win.
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

/**
 * Token for SetupHubComponent — breaks circular dependency between
 * @ptah-extension/harness-builder and @ptah-extension/chat (AppShellComponent renders the view).
 */
export const SETUP_HUB_COMPONENT = new InjectionToken<Type<unknown>>(
  'SETUP_HUB_COMPONENT',
);

/**
 * Token for MarketplaceHubComponent — breaks circular dependency between
 * @ptah-extension/marketplace and @ptah-extension/chat (AppShellComponent renders the view).
 *
 * Bound to a {@link LazyViewLoader} (TASK_2026_187).
 */
export const MARKETPLACE_COMPONENT = new InjectionToken<LazyViewLoader>(
  'MARKETPLACE_COMPONENT',
);

/**
 * Token for TribunalPageComponent — breaks circular dependency between
 * @ptah-extension/tribunal-panel and @ptah-extension/chat.
 *
 * Bound to a {@link LazyViewLoader} (TASK_2026_187).
 */
export const TRIBUNAL_COMPONENT = new InjectionToken<LazyViewLoader>(
  'TRIBUNAL_COMPONENT',
);

/**
 * Token for TasksViewComponent — breaks circular dependency between
 * @ptah-extension/tasks-ui and @ptah-extension/chat (AppShellComponent renders
 * the view). Provided by the application bootstrapper (app.config.ts).
 */
export const TASKS_VIEW_COMPONENT = new InjectionToken<Type<unknown>>(
  'TASKS_VIEW_COMPONENT',
);
