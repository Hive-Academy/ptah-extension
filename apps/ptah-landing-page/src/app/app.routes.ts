import { Routes } from '@angular/router';
import { i18nScopesResolver } from '@ptah-extension/i18n';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { LANDING_I18N_SCOPE, LandingPageComponent } from '@ptah-web/landing';
import { AdminAuthGuard } from '@ptah-web/core';
import { AuthGuard } from '@ptah-web/core';
import { GuestGuard } from '@ptah-web/core';
import { MemberGuard } from '@ptah-web/core';

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
 *
 * i18n: each page route resolves its own translation scope before navigation
 * ends, so the prerender and the first client render show resolved text (the
 * global `app`, `ui` and `core` scopes load in `provideI18n`). A lazy library's
 * scope is reached through the same dynamic `import()` as its component: a
 * static import would pull the library into the initial bundle and break the
 * "static imports of lazy-loaded libraries" lint. `download` needs no resolver;
 * its strings live in the global `app` scope.
 */
const authScopes = i18nScopesResolver(() =>
  import('@ptah-web/auth').then((m) => m.AUTH_I18N_SCOPE),
);
const legalScopes = i18nScopesResolver(() =>
  import('@ptah-web/legal').then((m) => m.LEGAL_I18N_SCOPE),
);

export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
    resolve: { i18n: i18nScopesResolver(LANDING_I18N_SCOPE) },
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
    resolve: {
      i18n: i18nScopesResolver(() =>
        import('@ptah-web/pricing').then((m) => m.PRICING_I18N_SCOPE),
      ),
    },
  },
  {
    path: 'login',
    loadComponent: () =>
      import('@ptah-web/auth').then((m) => m.AuthPageComponent),
    canActivate: [GuestGuard],
    resolve: { i18n: authScopes },
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('@ptah-web/auth').then((m) => m.AuthPageComponent),
    canActivate: [GuestGuard],
    resolve: { i18n: authScopes },
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('@ptah-web/account').then((m) => m.ProfilePageComponent),
    canActivate: [AuthGuard],
    resolve: {
      i18n: i18nScopesResolver(() =>
        import('@ptah-web/account').then((m) => m.ACCOUNT_I18N_SCOPE),
      ),
    },
  },
  {
    /**
     * The Ptah Builders member panel (R9.5, F-6, AD-1).
     *
     * ⚠️ THE GUARD IS `MemberGuard`, NOT `AuthGuard`. It probes
     * `GET /api/v1/members/entitlement` and routes the three outcomes apart:
     * 401 → `/login?returnUrl=/members`, `{ entitled: false }` → `/pricing`,
     * entitled → the hub, seeding `MemberSessionStore` on the way through.
     * `AuthGuard` — which is what this route used before — can only tell
     * logged-out from logged-in, so a member whose subscription had lapsed
     * landed on a login page instead of a renewal page.
     *
     * ⚠️ IT IS IMPORTED FROM `@ptah-web/core`, NOT `@ptah-web/members`, AND
     * THAT IS LOAD-BEARING. This file lazy-loads `@ptah-web/members` below, and
     * `@nx/enforce-module-boundaries` errors on "Static imports of lazy-loaded
     * libraries are forbidden" for any symbol pulled statically out of that
     * same lib. `MemberGuard` and `MemberSessionStore` therefore live in
     * `@ptah-web/core` — eagerly imported, never lazy — exactly like
     * `AdminAuthGuard` below. Moving either of them back into the member lib
     * re-breaks this line. `MEMBER_ROUTES` declares no guard of its own;
     * declaring one there too would run the probe twice per navigation.
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
    canActivate: [MemberGuard],
    loadChildren: () =>
      import('@ptah-web/members').then((m) => m.MEMBER_ROUTES),
    resolve: {
      i18n: i18nScopesResolver(() =>
        import('@ptah-web/members').then((m) => m.MEMBERS_I18N_SCOPES),
      ),
    },
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
    resolve: { i18n: legalScopes },
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.PrivacyPageComponent),
    resolve: { i18n: legalScopes },
  },
  {
    path: 'refund',
    loadComponent: () =>
      import('@ptah-web/legal').then((m) => m.RefundPageComponent),
    resolve: { i18n: legalScopes },
  },
  {
    path: 'admin',
    canActivate: [AdminAuthGuard],
    loadChildren: () => import('@ptah-web/admin').then((m) => m.ADMIN_ROUTES),
    resolve: {
      i18n: i18nScopesResolver(() =>
        import('@ptah-web/admin').then((m) => m.ADMIN_I18N_SCOPES),
      ),
    },
    data: { hideFromNav: true },
  },
  {
    path: '**',
    redirectTo: '',
  },
];
