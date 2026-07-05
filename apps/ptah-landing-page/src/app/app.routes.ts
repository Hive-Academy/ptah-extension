import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AuthGuard } from './guards/auth.guard';
import { GuestGuard } from './guards/guest.guard';
import { TrialStatusGuard } from './guards/trial-status.guard';

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
 * - TrialStatusGuard: Redirects users with expired trials to /trial-ended
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
      import('./pages/pricing/pricing-page.component').then(
        (m) => m.PricingPageComponent,
      ),
    canActivate: [TrialStatusGuard], // Redirect expired trials to /trial-ended
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/auth/auth-page.component').then(
        (m) => m.AuthPageComponent,
      ),
    canActivate: [GuestGuard],
  },
  {
    path: 'signup',
    loadComponent: () =>
      import('./pages/auth/auth-page.component').then(
        (m) => m.AuthPageComponent,
      ),
    canActivate: [GuestGuard],
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./pages/profile/profile-page.component').then(
        (m) => m.ProfilePageComponent,
      ),
    canActivate: [AuthGuard, TrialStatusGuard], // Auth + trial status check
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
      import('./pages/legal/terms-page.component').then(
        (m) => m.TermsPageComponent,
      ),
  },
  {
    path: 'privacy',
    loadComponent: () =>
      import('./pages/legal/privacy-page.component').then(
        (m) => m.PrivacyPageComponent,
      ),
  },
  {
    path: 'refund',
    loadComponent: () =>
      import('./pages/legal/refund-page.component').then(
        (m) => m.RefundPageComponent,
      ),
  },
  {
    path: 'trial-ended',
    loadComponent: () =>
      import('./pages/trial-ended/trial-ended-page.component').then(
        (m) => m.TrialEndedPageComponent,
      ),
    canActivate: [AuthGuard], // Must be logged in, but no trial check
  },
  {
    path: 'admin',
    canActivate: [AdminAuthGuard],
    loadChildren: () =>
      import('./pages/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
    data: { hideFromNav: true },
  },
  {
    path: '**',
    redirectTo: '',
  },
];
