import { Routes } from '@angular/router';
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
    path: 'members',
    loadComponent: () =>
      import('@ptah-web/account').then((m) => m.MembersPageComponent),
    canActivate: [AuthGuard],
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
