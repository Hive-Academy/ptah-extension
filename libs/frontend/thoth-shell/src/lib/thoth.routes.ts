import { inject } from '@angular/core';
import type { CanMatchFn, RedirectFunction, Routes } from '@angular/router';
import { AppStateManager } from '@ptah-extension/core';

import {
  ThothShellComponent,
  isThothTabId,
} from './components/thoth-shell.component';

/**
 * `/thoth` with no tab: the tab the active workspace last settled on.
 *
 * The memory is per workspace (`AppStateManager.thothActiveTab`) and the shell
 * writes it on every settled navigation, so a plain Thoth open (the navbar,
 * the canvas link) lands where the user left Thoth in this workspace. A
 * relative redirect, so it resolves below wherever the app mounts this tree.
 * Runs in an injection context, as `restoreMarketplaceRoute` does.
 */
const restoreThothTab: RedirectFunction = () =>
  inject(AppStateManager).thothActiveTab();

/** Only a known tab id matches `:tab`; anything else falls to `**`. */
const thothTabSegment: CanMatchFn = (_route, segments) =>
  isThothTabId(segments[0]?.path);

/**
 * The Thoth hub's route tree, mounted by the app through `loadChildren` under
 * `thoth` (TASK_2026_524 Batch 4e, the marketplace pattern).
 *
 * The `:tab` child is component-less: the shell renders the tab body itself
 * from the settled `tab` param, so a tab switch reuses the same shell (the
 * shell route's config and params do not change) and only the child's param
 * moves. An unknown tab (`/thoth/bogus`, `/thoth/skills/extra`) becomes
 * `/thoth/memory`.
 */
export const THOTH_ROUTES: Routes = [
  {
    path: '',
    component: ThothShellComponent,
    children: [
      { path: '', pathMatch: 'full', redirectTo: restoreThothTab },
      { path: ':tab', canMatch: [thothTabSegment], children: [] },
      { path: '**', redirectTo: 'memory' },
    ],
  },
];
