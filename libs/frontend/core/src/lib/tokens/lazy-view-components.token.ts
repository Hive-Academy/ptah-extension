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

/**
 * Token for WizardViewComponent — breaks circular dependency between
 * @ptah-extension/setup-wizard and @ptah-extension/chat.
 *
 * **Deliberately EAGER — do not convert this to a {@link LazyViewLoader}.**
 * The setup wizard is a *launch surface*, checked and rejected for deferral in
 * TASK_2026_187 Batch 4 (R15). The VS Code activation event
 * `onCommand:ptah.setupAgents` (`apps/ptah-extension-vscode/package.json:41`,
 * contributed command `:91`, menu entry `:141`) opens a **dedicated new webview
 * panel** whose HTML hardcodes `initialView: 'setup-wizard'`
 * (`libs/backend/agent-generation/src/lib/services/wizard/webview-lifecycle.service.ts:153`).
 * `'setup-wizard'` passes both allow-lists, so `AppStateManager` sets
 * `currentView` to it at service construction, before first render — the user
 * who clicked "Setup Ptah Agents" is waiting on exactly this component.
 * Deferring it would add a module hop to that wait for no benefit.
 */
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
 *
 * Bound to a {@link LazyViewLoader} (TASK_2026_187). `'harness-builder'` is
 * absent from both `initialView` allow-lists and is not persisted, so it is
 * reachable only by explicit navigation — safe to defer (R15).
 */
export const HARNESS_BUILDER_COMPONENT = new InjectionToken<LazyViewLoader>(
  'HARNESS_BUILDER_COMPONENT',
);

/**
 * Token for SetupHubComponent — breaks circular dependency between
 * @ptah-extension/harness-builder and @ptah-extension/chat (AppShellComponent renders the view).
 *
 * Bound to a {@link LazyViewLoader} (TASK_2026_187). Resolves out of the **same**
 * library as {@link HARNESS_BUILDER_COMPONENT}, so one lazy chunk serves both —
 * that is expected, not a bug to be restructured away.
 */
export const SETUP_HUB_COMPONENT = new InjectionToken<LazyViewLoader>(
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
 *
 * Bound to a {@link LazyViewLoader} (TASK_2026_187). `'tasks'` is absent from
 * both `initialView` allow-lists and is not persisted, so it is reachable only
 * by explicit navigation — safe to defer (R15).
 */
export const TASKS_VIEW_COMPONENT = new InjectionToken<LazyViewLoader>(
  'TASKS_VIEW_COMPONENT',
);
