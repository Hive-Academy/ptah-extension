// DO NOT add /admin* to sitemap.xml or public navigation.
// The admin dashboard is intentionally hidden — discovery happens via direct
// URL (bookmarked by operators) and access is enforced server-side by the
// ADMIN_EMAILS allowlist (see apps/ptah-license-server/src/admin/admin.guard.ts).
import { Routes } from '@angular/router';

import { AdminLayout } from './admin-layout/admin-layout';

/**
 * Admin Routes — lazy-loaded child tree mounted at `/admin` by `app.routes.ts`.
 *
 * Shape:
 *   /admin                  → redirects to /admin/users (first model, always
 *                             safe because User is never read-only / empty)
 *   /admin/:model           → AdminList (table view for a single model)
 *   /admin/:model/:id       → AdminDetail (read / edit a single record)
 *
 * Notes:
 * - All three routes render INSIDE `AdminLayout`, which provides the drawer
 *   sidebar + router-outlet.
 * - Children use `loadComponent` (lazy) to keep the initial admin bundle
 *   minimal and to prevent accidental circular imports between siblings.
 * - The parent `canActivate` (AdminAuthGuard) lives on the `/admin` route in
 *   `app.routes.ts` — it guards the entire subtree before any child loads.
 */
export const ADMIN_ROUTES: Routes = [
  {
    path: '',
    component: AdminLayout,
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'users',
      },
      {
        path: 'marketing/compose',
        loadComponent: () =>
          import('./marketing/marketing-compose/marketing-compose').then(
            (m) => m.MarketingCompose,
          ),
      },
      {
        path: 'marketing/campaigns',
        pathMatch: 'full',
        redirectTo: 'marketing-campaigns',
      },
      {
        path: ':model',
        loadComponent: () =>
          import('./admin-list/admin-list').then((m) => m.AdminList),
      },
      {
        path: ':model/:id',
        loadComponent: () =>
          import('./admin-detail/admin-detail').then((m) => m.AdminDetail),
      },
    ],
  },
];
