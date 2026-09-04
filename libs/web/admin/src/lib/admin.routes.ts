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
 *   /admin/builders/*       → Builders content (packs registry, calendar
 *                             sessions, community moderation, course authoring)
 *   /admin/users            → UsersList (people directory + entitlement lenses)
 *   /admin/users/:id        → UserProfile (identity + merged billing surface)
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
      // Licenses + Paddle subscriptions are MERGED into the user surface. Both
      // legacy slugs redirect so bookmarks and any missed deep link land on the
      // merged view instead of falling through to the generic `:model` table
      // (which would silently re-expose the split, user-less list). Angular
      // preserves query params across `redirectTo`, so `?search=<email>`
      // hand-offs keep working — `email` is a searchable field on `users`.
      {
        path: 'licenses',
        pathMatch: 'full',
        redirectTo: 'users',
      },
      {
        path: 'subscriptions',
        pathMatch: 'full',
        redirectTo: 'users',
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
      // Bespoke Marketing & Campaigns views (TASK_2026_166) — also precede the
      // generic ':model' / ':model/:id' catch-all. 'marketing-campaigns' and
      // 'marketing-campaign-templates' move off the generic table onto bespoke
      // components; 'marketing-campaign-templates/:id' intentionally stays on
      // the generic AdminDetail edit form (handled by the ':model/:id' route).
      {
        path: 'marketing',
        loadComponent: () =>
          import('./marketing/marketing-hub/marketing-hub').then(
            (m) => m.MarketingHub,
          ),
      },
      {
        path: 'marketing-campaigns',
        loadComponent: () =>
          import('./marketing/campaign-history/campaign-history-list').then(
            (m) => m.CampaignHistoryList,
          ),
      },
      {
        path: 'marketing-campaigns/:id',
        loadComponent: () =>
          import('./marketing/campaign-history/campaign-detail/campaign-detail').then(
            (m) => m.CampaignDetail,
          ),
      },
      {
        path: 'marketing-campaign-templates',
        loadComponent: () =>
          import('./marketing/templates/templates-gallery').then(
            (m) => m.TemplatesGallery,
          ),
      },
      // Builders content management (TASK_2026_169) — MUST precede the generic
      // ':model' / ':model/:id' catch-all. `builders` is NOT an `AdminModelKey`,
      // so a mis-ordered entry here resolves to `AdminList` and the API answers
      // 400 "Unknown admin model: builders".
      {
        path: 'builders',
        pathMatch: 'full',
        redirectTo: 'builders/packs',
      },
      {
        path: 'builders/packs',
        loadComponent: () =>
          import('./builders/packs/packs-list').then((m) => m.PacksList),
      },
      {
        path: 'builders/sessions',
        loadComponent: () =>
          import('./builders/sessions/sessions-list').then(
            (m) => m.SessionsList,
          ),
      },
      {
        /**
         * The native community moderation surface (TASK_2026_177 Batch 7,
         * R8.2/R8.5).
         *
         * ⚠️ A NEW SCREEN AT AN OLD PATH, NOT A RESTORATION. A read-only triage
         * view over the EXTERNAL forum used to sit here; P1b deleted it together
         * with the two endpoints behind it
         * (`GET v1/admin/community/{topics,review-queue}`), so the route could
         * only 404. `CommunityModeration` reads Batch 6's three NATIVE admin
         * controllers and — unlike its predecessor — writes: pin, lock, move,
         * soft-delete, restore. Structural test G5 asserted the old surface was
         * read-only and was deleted for that reason; do not restore it.
         *
         * ⚠️ IT IS DECLARED ABOVE `:model` AND THAT ORDER IS LOAD-BEARING. The
         * generic catch-all below would otherwise match `builders/community`…
         * except it would not, because `:model` is one segment and this is two —
         * `builders/:model` is what would collide, and no such route exists. The
         * ordering is kept anyway so a future single-segment sibling does not
         * quietly get swallowed.
         */
        path: 'builders/community',
        loadComponent: () =>
          import('./builders/community/community-moderation').then(
            (m) => m.CommunityModeration,
          ),
      },
      {
        /**
         * The course authoring surface (TASK_2026_377 Batch 3, R2.1/R8.1/R8.8).
         *
         * ⚠️ A NEW SCREEN OVER AN API THAT SHIPPED WITHOUT ONE. The learning
         * admin endpoints were complete and audited before any client existed.
         * Nothing on the server changes for these two routes.
         *
         * ⚠️ BOTH ENTRIES SIT ABOVE `:model` AND `:model/:id`, AND FOR THE
         * DETAIL ROUTE THE ORDER IS GENUINELY LOAD-BEARING.
         * `builders/courses/:id` has two segments before the parameter, so it
         * cannot collide with the single-segment `:model`; but
         * `builders/courses` IS two segments and `:model/:id` is two segments,
         * so declared after it, `/admin/builders/courses` would resolve to
         * `AdminDetail` with `model='builders'` and the API would answer
         * `400 Unknown admin model: builders`. `courses` is not an
         * `AdminModelKey` and must never be added as one.
         */
        path: 'builders/courses',
        loadComponent: () =>
          import('./builders/courses/courses-list').then((m) => m.CoursesList),
      },
      {
        path: 'builders/courses/:id',
        loadComponent: () =>
          import('./builders/courses/course-detail').then(
            (m) => m.CourseDetail,
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
