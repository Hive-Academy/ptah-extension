import { Routes } from '@angular/router';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { LandingPageComponent } from '@ptah-web/landing';
import { AdminAuthGuard } from '@ptah-web/core';
import { AuthGuard } from '@ptah-web/core';
import { GuestGuard } from '@ptah-web/core';

/**
 * Application Routes
 *
 * Route definitions for the Ptah landing page and license system pages.
 *
 * The home route is eager (primary entry). Every other page is lazy-loaded via
 * `loadComponent` so the ancillary pages (pricing, download, auth, profile,
 * legal) stay out of the home page's initial bundle — prerendering still works
 * for the Prerender-mode routes in `app.routes.server.ts`.
 *
 * Guards:
 * - AuthGuard: Protects authenticated routes, redirects guests to /login
 * - GuestGuard: Protects guest-only routes, redirects authenticated users to /profile
 */
export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
  },
  {
    path: 'docs',
    canActivate: [
      () => {
        if (typeof window !== 'undefined') {
          window.location.replace('https://docs.ptah.live');
        }
        return false;
      },
    ],
    children: [],
  },
  {
    path: 'download',
    loadComponent: () =>
      import('./pages/download/download-page.component').then(
        (m) => m.DownloadPageComponent,
      ),
  },
  {
    path: 'pricing',
    loadComponent: () =>
      import('@ptah-web/pricing').then((m) => m.PricingPageComponent),
  },
  {
    path: 'login',
    loadComponent: () =>
      import('@ptah-web/auth').then((m) => m.AuthPageComponent),
    canActivate: [GuestGuard],
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('@ptah-web/auth').then((m) => m.AuthPageComponent),
    canActivate: [GuestGuard],
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('@ptah-web/account').then((m) => m.ProfilePageComponent),
    canActivate: [AuthGuard],
  },
  {
    /**
     * The Ptah Builders member panel (R9.5, F-6, AD-1).
     *
     * ⚠️ THE GUARD IS `MemberGuard`, AND IT IS DECLARED INSIDE `MEMBER_ROUTES`
     * RATHER THAN HERE. It probes `GET /api/v1/members/entitlement` and routes
     * the three outcomes apart: 401 → `/login`, `{ entitled: false }` →
     * `/pricing`, entitled → the hub. `AuthGuard` — which is what this route
     * used before — can only tell logged-out from logged-in, so a member whose
     * subscription had lapsed landed on a login page instead of a renewal page.
     *
     * It cannot be named here: `@nx/enforce-module-boundaries` forbids a static
     * import from a library this file also lazy-loads, and `MemberGuard` ships
     * in `@ptah-web/members`. `/admin` gets to write `canActivate` inline only
     * because `AdminAuthGuard` lives in the never-lazy `@ptah-web/core`. See the
     * comment on `MEMBER_ROUTES` for why the placement is behaviourally
     * equivalent.
     *
     * ⚠️ THE `providers` ARRAY IS LOAD-BEARING (AD-1). It creates a route-level
     * injector whose `MarkdownService` + `SANITIZE` shadow the app's `'basic'`
     * pair for the member subtree ONLY. `provideMarkdown()` returns plain
     * providers (its `MarkdownService` is a bare class provider, not
     * `providedIn: 'root'`), so this needs no `app.config.ts` change and cannot
     * leak the member sanitizer onto the marketing pages — or, more
     * importantly, leak `'basic'` onto member-authored content. `'basic'`
     * installs NO DOMPurify override at all and is not safe for UGC (NFR-S2).
     */
    path: 'members',
    loadChildren: () =>
      import('@ptah-web/members').then((m) => m.MEMBER_ROUTES),
    providers: [provideMarkdownRendering({ extensions: 'member' })],
    data: { hideFromNav: true },
  },
  {
    path: 'contact',
    redirectTo: 'profile',
  },
  {
    path: 'sessions',
    redirectTo: 'profile',
  },
  {
    path: 'terms-and-conditions',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.TermsPageComponent),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.PrivacyPageComponent),
  },
  {
    path: 'refund',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.RefundPageComponent),
  },
  {
    path: 'admin',
    canActivate: [AdminAuthGuard],
    loadChildren: () => import('@ptah-web/admin').then((m) => m.ADMIN_ROUTES),
    data: { hideFromNav: true },
  },
  {
    path: '**',
    redirectTo: '',
  },
];
