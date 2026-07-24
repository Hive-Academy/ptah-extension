import { Routes } from '@angular/router';

import { AdminLayout } from './admin-layout/admin-layout';

/**
 * Admin Routes — lazy-loaded child tree mounted at `/admin` by `app.routes.ts`.
 *
 * Shape:
 *   /admin                  → redirects to /admin/overview (stat-tile
 *                             dashboard — the default admin landing view)
 *   /admin/overview         → AdminOverview (GET /api/v1/admin/stats tiles)
 *   /admin/groups           → GroupsList (member-cohort management —
 *                             dedicated view, NOT the generic model CRUD)
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
        redirectTo: 'overview',
      },
      {
        path: 'overview',
        loadComponent: () =>
          import('./overview/overview').then((m) => m.AdminOverview),
      },
      {
        path: 'marketing/compose',
        loadComponent: () =>
          import('./marketing/marketing-compose/marketing-compose').then(
            (m) => m.MarketingCompose,
          ),
      },
      {
        path: 'marketing/templates/new',
        loadComponent: () =>
          import('./marketing/template-create/template-create').then(
            (m) => m.TemplateCreate,
          ),
      },
      {
        path: 'marketing/campaigns',
        pathMatch: 'full',
        redirectTo: 'marketing-campaigns',
      },
      {
        path: 'groups',
        loadComponent: () =>
          import('./groups/groups-list/groups-list').then((m) => m.GroupsList),
      },
      // Bespoke workflow views (TASK_2026_164) — MUST precede the generic
      // ':model' / ':model/:id' catch-all so these slugs resolve to their
      // purpose-built components instead of the generic table.
      {
        path: 'waitlist',
        loadComponent: () =>
          import('./waitlist/waitlist-pipeline').then(
            (m) => m.WaitlistPipeline,
          ),
      },
      {
        path: 'licenses',
        loadComponent: () =>
          import('./licenses/licenses-list').then((m) => m.LicensesList),
      },
      {
        path: 'failed-webhooks',
        loadComponent: () =>
          import('./failed-webhooks/webhooks-triage').then(
            (m) => m.WebhooksTriage,
          ),
      },
      {
        path: 'users',
        loadComponent: () =>
          import('./users/users-list').then((m) => m.UsersList),
      },
      {
        path: 'users/:id',
        loadComponent: () =>
          import('./users/user-profile/user-profile').then(
            (m) => m.UserProfile,
          ),
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
