import { Routes } from '@angular/router';
import {
  DEFAULT_SURFACE_ID,
  SURFACE_ACTIVE,
  surfaceActiveFor,
} from '@ptah-extension/core';
import { SettingsComponent } from '@ptah-extension/chat';
import { DashboardGridComponent } from '@ptah-extension/dashboard';
import { onboardingFirstRunGuard } from '@ptah-extension/onboarding/services';
import {
  GenerationWorkflowShellComponent,
  WizardViewComponent,
} from '@ptah-extension/setup-wizard/app';

import { electronOnlySurface } from './electron-only-surface.guard';

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
 * chat and canvas content area is deliberately NOT in the outlet. It is one
 * instance, never keyed by workspace (`CanvasStore` partitions workspaces
 * itself), and `AppShellComponent` retains it with `*ptahRetainWhile`: on a
 * standalone surface the row is detached from the DOM and from change
 * detection but never destroyed, so `CanvasStore`, the gridstack instance and
 * the tile-to-session bindings survive navigation. The `chat` route below is
 * therefore a **component-less route** — it addresses "no standalone surface
 * is showing" so that state has a URL, and the shell re-inserts the retained
 * chrome for it.
 *
 * **No routed surface is retained.** There is no `RouteReuseStrategy`: every
 * surface below is destroyed on leave and re-created on return, as under the
 * old `@switch`. Configuration surfaces re-mount on a workspace switch, and
 * `tasks` / `harness-builder` rely on construction-time work, so a stored
 * handle would be stale. Retaining one needs its mount-time work moved onto
 * `SURFACE_ACTIVE` edges first (TASK_2026_524 implementation plan, L3).
 *
 * Eagerness is chosen per surface, not by default:
 * - `chat` — no component to load. `canActivate: [onboardingFirstRunGuard]`
 *   sends the first Electron boot to `/onboarding` once (TASK_2026_ONBOARDING);
 *   every other path to chat passes straight through.
 * - `onboarding` — `loadChildren`. Only the narrow
 *   `@ptah-extension/onboarding/services` entry (the guard, flag and tracker)
 *   is eager; the pages load with `ONBOARDING_ROUTES`.
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
 *   `@defer (on immediate)` block. `marketplace` and `thoth` are
 *   `loadChildren`: their pages (Thoth: its tabs) are child routes of the
 *   lazily loaded tree.
 * - `apps` — `loadComponent`, Electron-only. `canMatch: [electronOnlySurface]`
 *   refuses the match on VS Code before the chunk is requested, and the `**`
 *   fallback lands on `chat`. Nothing eager may import
 *   `@ptah-extension/mcp-apps-page`; this dynamic import is its only entry.
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
    //
    // The optional `:tabId` makes the active chat tab addressable
    // (`/chat/<tabId>`). It renders nothing either: `TabManagerService` owns the
    // active tab and `ChatTabRouteSync` keeps this segment in step with it.
    path: 'chat',
    // First run only: an Electron boot with no `shownAt` in the onboarding
    // flag is redirected to `/onboarding`. Deep links to other surfaces never
    // reach this guard.
    canActivate: [onboardingFirstRunGuard],
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('chat') },
    ],
    children: [
      { path: '', children: [] },
      { path: ':tabId', children: [] },
    ],
  },
  {
    path: 'onboarding',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('onboarding') },
    ],
    loadChildren: () =>
      import('@ptah-extension/onboarding').then((m) => m.ONBOARDING_ROUTES),
  },
  {
    path: 'setup-wizard/generation/:workflow/:tabId',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('setup-wizard') },
    ],
    component: GenerationWorkflowShellComponent,
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
    path: 'harness-builder/:mode/:tabId',
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
    // A routed tree: the shell over `/thoth/:tab`, with `/thoth` redirecting to
    // the remembered tab (`THOTH_ROUTES`, TASK_2026_524 Batch 4e). Same chunk
    // as the former `loadComponent`.
    loadChildren: () =>
      import('@ptah-extension/thoth-shell').then((m) => m.THOTH_ROUTES),
  },
  {
    path: 'marketplace',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('marketplace') },
    ],
    // A routed tree, not one component: the shell and its pages live under
    // `/marketplace/...` (`MARKETPLACE_ROUTES`, TASK_2026_533).
    loadChildren: () =>
      import('@ptah-extension/marketplace').then((m) => m.MARKETPLACE_ROUTES),
  },
  {
    path: 'tasks',
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('tasks') },
    ],
    loadComponent: () =>
      import('@ptah-extension/tasks-ui').then((m) => m.TasksViewComponent),
  },
  {
    // Electron-only. On VS Code the match is refused before `loadComponent`
    // runs, so the chunk is never requested and `**` below lands on chat.
    path: 'apps',
    canMatch: [electronOnlySurface],
    providers: [
      { provide: SURFACE_ACTIVE, useFactory: surfaceActiveFor('apps') },
    ],
    loadComponent: () =>
      import('@ptah-extension/mcp-apps-page').then((m) => m.AppsPageComponent),
  },
  {
    // Electron-only. The guard refuses VS Code before requesting the lazy chunk.
    path: 'command-center',
    canMatch: [electronOnlySurface],
    providers: [
      {
        provide: SURFACE_ACTIVE,
        useFactory: surfaceActiveFor('command-center'),
      },
    ],
    loadComponent: () =>
      import('@ptah-extension/command-center').then(
        (m) => m.CommandCenterPageComponent,
      ),
  },
  // An unaddressable URL is the chat surface, not an error page: the host can
  // send an `initialView` this build does not know, and a webview has nowhere
  // to show a 404.
  { path: '', pathMatch: 'full', redirectTo: DEFAULT_SURFACE_ID },
  { path: '**', redirectTo: DEFAULT_SURFACE_ID },
];
