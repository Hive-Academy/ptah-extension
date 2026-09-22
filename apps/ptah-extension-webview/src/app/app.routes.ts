import { Routes } from '@angular/router';
import {
  DEFAULT_SURFACE_ID,
  SURFACE_ACTIVE,
  surfaceActiveFor,
} from '@ptah-extension/core';
import { SettingsComponent } from '@ptah-extension/chat';
import { DashboardGridComponent } from '@ptah-extension/dashboard';
import { WizardViewComponent } from '@ptah-extension/setup-wizard';

/**
 * The webview's route table — one entry per standalone surface.
 *
 * **Why this file is in the app and not in a library.** Every symbol a route
 * names has to be reachable from the composition root, and half of them live in
 * libraries that `@ptah-extension/core` is imported BY. Putting the table in
 * core would invert that and create a cycle. It is also the trap
 * `apps/ptah-landing-page/src/app/app.routes.ts:82-87` documents from the other
 * side: `@nx/enforce-module-boundaries` forbids a static import out of a
 * lazy-loaded library, so anything a route needs eagerly must come from a
 * library that is already eager. The app is the only place where both
 * constraints hold.
 *
 * **The surface ids are not declared here.** They come from
 * `SURFACE_ROUTE_IDS` in `@ptah-extension/core`, which is the one list — the
 * three disagreeing `initialView` allow-lists (8, 13 and 13 entries) and
 * `AppShellComponent.STANDALONE_VIEWS` are all gone. `app.spec.ts` asserts this
 * table and that list stay in step, so TASK_2026_492_0bcc's remap into two
 * navigation sets is a single edit to the constant plus this table.
 *
 * **Only the surfaces the old `@switch` already destroyed are routed.** The
 * chat and canvas content area is deliberately NOT in the outlet: it is kept
 * mounted and toggled with `[class.hidden]` so `CanvasStore`, the gridstack
 * instance and the tile-to-session bindings survive navigation. The `chat`
 * route below is therefore a **component-less route** — it addresses "no
 * standalone surface is showing" so that state has a URL, and
 * `AppShellComponent` un-hides the shared chrome for it. Replacing the CSS
 * hiding with a workspace-keyed `RouteReuseStrategy` is batch 3, not this one.
 *
 * Eagerness is chosen per surface, not by default:
 * - `chat` — no component to load.
 * - `setup-wizard` — EAGER. `ptah.setupAgents` opens a dedicated panel
 *   hardcoded to `initialView: 'setup-wizard'`, so it is a launch surface with
 *   a user already waiting; a module hop would be added to that wait for
 *   nothing.
 * - `settings` — EAGER. Startup-reachable (`initialView: 'settings'`), and the
 *   boot auth check in `AppShellComponent` navigates here when no credential
 *   is configured. It also lives in `@ptah-extension/chat`, which the shell
 *   itself makes eager, so deferring it would move zero bytes.
 * - `analytics` — EAGER. Startup-reachable via `ptah.openDashboard`, and
 *   measured at 0 bytes moved in TASK_2026_187 because `@ptah-extension/dashboard`
 *   is already in the eager graph.
 * - everything else — `loadComponent`. These replace the five deferred
 *   `LazyViewService` tokens one-for-one, plus `thoth`'s
 *   `@defer (on immediate)` block.
 *
 * `harness-builder` and `setup-hub` both resolve out of
 * `@ptah-extension/harness-builder`, so ONE chunk serves both. That is
 * expected — do not restructure to force two.
 */
export const appRoutes: Routes = [
  {
    // Component-less on purpose — see the note above. `children: []` is the
    // same construct `apps/ptah-landing-page`'s `docs` route uses to declare a
    // reachable path that renders nothing into the outlet.
    path: 'chat',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('chat') },
    ],
    children: [],
  },
  {
    path: 'setup-wizard',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('setup-wizard') },
    ],
    component: WizardViewComponent,
  },
  {
    path: 'settings',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('settings') },
    ],
    component: SettingsComponent,
  },
  {
    path: 'analytics',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('analytics') },
    ],
    component: DashboardGridComponent,
  },
  {
    path: 'harness-builder',
    providers: [
      {
        provide: SURFACE_ACTIVE,
        useFactory: surfaceActiveFor('harness-builder'),
      },
    ],
    loadComponent: () =>
      import('@ptah-extension/harness-builder').then(
        (m) => m.HarnessBuilderViewComponent,
      ),
  },
  {
    path: 'setup-hub',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('setup-hub') },
    ],
    loadComponent: () =>
      import('@ptah-extension/harness-builder').then(
        (m) => m.SetupHubComponent,
      ),
  },
  {
    path: 'thoth',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('thoth') },
    ],
    loadComponent: () =>
      import('@ptah-extension/thoth-shell').then((m) => m.ThothShellComponent),
  },
  {
    path: 'marketplace',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('marketplace') },
    ],
    loadComponent: () =>
      import('@ptah-extension/marketplace').then(
        (m) => m.MarketplaceHubComponent,
      ),
  },
  {
    path: 'tribunal',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('tribunal') },
    ],
    loadComponent: () =>
      import('@ptah-extension/tribunal-panel').then(
        (m) => m.TribunalPageComponent,
      ),
  },
  {
    path: 'tasks',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('tasks') },
    ],
    loadComponent: () =>
      import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent),
  },
  // An unaddressable URL is the chat surface, not an error page: the host can
  // send an `initialView` this build does not know, and a webview has nowhere
  // to show a 404.
  { path: '', pathMatch: 'full', redirectTo: DEFAULT_SURFACE_ID },
  { path: '**', redirectTo: DEFAULT_SURFACE_ID },
];
