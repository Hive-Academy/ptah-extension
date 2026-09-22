import { InjectionToken, Type } from '@angular/core';

/**
 * Tokens for view components that `@ptah-extension/chat` renders but cannot
 * import.
 *
 * Some feature libraries (e.g. setup-wizard, canvas) export components that are
 * rendered inside `AppShellComponent`. A direct import would be circular,
 * because those libraries import from chat. The application binds the component
 * reference here at bootstrap instead.
 *
 * **This is the residue, not the pattern.** TASK_2026_524 moved every
 * standalone surface into the application's route table, so the five deferred
 * tokens this file used to carry (`HARNESS_BUILDER_COMPONENT`,
 * `SETUP_HUB_COMPONENT`, `MARKETPLACE_COMPONENT`, `TRIBUNAL_COMPONENT`,
 * `TASKS_VIEW_COMPONENT`), the `LazyViewService` that resolved them and
 * `WIZARD_VIEW_COMPONENT` are all gone: `loadComponent` (or a plain
 * `component:` for a launch surface) does the same job with no DI indirection,
 * no `*ngComponentOutlet` and no hand-written spinner branch. The one token
 * below remains only because the canvas is rendered INSIDE the shared chrome
 * rather than through the outlet. Do not add a new token here for a surface
 * that could be a route.
 */

/**
 * Token for OrchestraCanvasComponent — breaks circular dependency between
 * @ptah-extension/canvas (which depends on @ptah-extension/chat) and
 * @ptah-extension/chat (AppShellComponent renders the canvas).
 *
 * **Deliberately EAGER — do not convert this to a lazy loader.** It was
 * deferred during TASK_2026_187 and reverted on measured evidence: the canvas
 * is the launch surface in Electron (`ElectronShellComponent` calls
 * `setLayoutMode('grid')` unconditionally in its constructor), so deferring it
 * cost 50-70 ms of startup TTI on every launch with no path on which it helped.
 *
 * It is also **not** a route, and that is deliberate (TASK_2026_524 batch 1):
 * the canvas and the single-chat view are both kept mounted and toggled with
 * `[class.hidden]` so `CanvasStore` and the gridstack instance survive
 * navigation. Replacing that with a `RouteReuseStrategy` is batch 3.
 */
export const ORCHESTRA_CANVAS_COMPONENT = new InjectionToken<Type<unknown>>(
  'ORCHESTRA_CANVAS_COMPONENT',
);
