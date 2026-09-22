import {
  InjectionToken,
  Provider,
  Signal,
  computed,
  inject,
} from '@angular/core';
import { SurfaceRouterService } from './surface-router.service';
import { DEFAULT_SURFACE_ID, type ViewType } from './surface-routes';

/**
 * Whether the component tree reading this is currently VISIBLE to the user.
 *
 * ## Why this exists
 *
 * A surface can be in one of three conditions, and they are not the same
 * thing:
 *
 * | Condition                  | In the DOM | In change detection | State survives |
 * | -------------------------- | ---------- | ------------------- | -------------- |
 * | destroyed by the outlet    | no         | no                  | no             |
 * | `[class.hidden]`           | yes        | **yes**             | yes            |
 * | detached (batch 3)         | no         | no                  | yes            |
 *
 * `display: none` removes a tree from layout and paint. It does NOT remove it
 * from Angular's view hierarchy. Under `OnPush` with signals a hidden
 * component is still re-checked whenever its own signal dependencies change,
 * and it still performs its DOM writes — the compositor simply discards every
 * pixel. So while the user reads Settings, a hidden transcript keeps ingesting
 * `chat:chunk` events and re-rendering bubbles, and a hidden gridstack keeps
 * measuring a subtree whose `getBoundingClientRect` returns zeros.
 *
 * Before this token a hidden component had **no way to know it was hidden**,
 * which is why that cost was unmanaged rather than chosen. This is the signal
 * that makes it choosable.
 *
 * ## What the default answers
 *
 * The root factory answers for the **always-mounted chrome** — the sidebar,
 * the header, the chat content area, the canvas and the transcript. That tree
 * is rendered unconditionally and only ever `display: none`-toggled
 * (`app-shell.component.html`, the `[class.hidden]="isStandaloneView()"`
 * wrapper), so it is visible exactly when no standalone surface is addressed.
 *
 * This is deliberately NOT a per-route provider, which is what
 * TASK_2026_524_1125's carrier first proposed. The two consumers batch 2 is
 * written for — the canvas and the transcript — sit OUTSIDE the router outlet,
 * because `CanvasStore` is scoped to `OrchestraCanvasComponent` and an outlet
 * swap would destroy it. A per-route provider cannot reach them.
 *
 * ## What it does NOT answer
 *
 * Visibility a component owns privately. The canvas grid and the single chat
 * view are toggled against each other by `layoutMode()` inside the chrome, and
 * the chrome-level answer cannot see that. A consumer with its own visibility
 * gate must AND the two:
 *
 * ```ts
 * private readonly chromeVisible = inject(SURFACE_ACTIVE);
 * protected readonly visible = computed(
 *   () => this.chromeVisible() && this.layout.layoutMode() === 'grid',
 * );
 * ```
 *
 * ## A retained surface gets no `ngOnDestroy`
 *
 * This token stops work; it does not stop lifecycles. Batch 3 replaces the CSS
 * hiding with a `RouteReuseStrategy`, and a detached view leaves change
 * detection while its instance stays alive — so its timers, effects and
 * subscriptions keep running unless they read this signal. Anything periodic
 * must gate on it, not rely on teardown.
 *
 * @see TASK_2026_524_1125 batch 2
 */
export const SURFACE_ACTIVE = new InjectionToken<Signal<boolean>>(
  'SURFACE_ACTIVE',
  {
    providedIn: 'root',
    factory: () => {
      const surfaceRouter = inject(SurfaceRouterService);
      return computed(
        () => surfaceRouter.currentSurface() === DEFAULT_SURFACE_ID,
      );
    },
  },
);

/**
 * Bind {@link SURFACE_ACTIVE} to one surface id, for a route's `providers`.
 *
 * Only meaningful for a surface that can be mounted while it is NOT displayed.
 * Today every routed surface is destroyed the moment it stops being addressed,
 * so `SURFACE_ACTIVE` would be `true` for its whole lifetime and this helper
 * buys nothing. It becomes load-bearing in batch 3, when
 * `data: { retain: true }` keeps a routed surface alive after the user leaves
 * it.
 *
 * It is shipped now, unused, for one reason: a consumer written in batch 2
 * should read the same token whether its surface is later retained or not, so
 * batch 3 changes the route table and nothing else.
 *
 * @example
 * ```ts
 * {
 *   path: 'tasks',
 *   loadComponent: () => import('@ptah-extension/tasks-ui').then(m => m.TasksViewComponent),
 *   data: { retain: true },
 *   providers: [provideSurfaceActive('tasks')],
 * }
 * ```
 */
export function provideSurfaceActive(id: ViewType): Provider {
  return {
    provide: SURFACE_ACTIVE,
    useFactory: (surfaceRouter: SurfaceRouterService): Signal<boolean> =>
      computed(() => surfaceRouter.currentSurface() === id),
    deps: [SurfaceRouterService],
  };
}
