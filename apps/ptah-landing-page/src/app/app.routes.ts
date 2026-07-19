import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AuthGuard } from './guards/auth.guard';
import { GuestGuard } from './guards/guest.guard';
import { environment } from '../environments/environment';

/**
 * Non-production sandbox routes (whole-page layout/experiment labs).
 * Excluded from production builds via the spread below — kept working in dev
 * (`nx serve`, `environment.production === false`) but never shipped.
 *
 * Add any other `*-lab` routes here (e.g. section-lab, comparison-lab,
 * builders-lab) as they're introduced — none of those exist in this route
 * table today.
 */
const sandboxRoutes: Routes = [
  {
    // Non-production sandbox: 3 whole-page pricing layout variations.
    path: 'pricing-lab',
    loadComponent: () =>
      import('./pages/section-lab/pricing-lab-page.component').then(
        (m) => m.PricingLabPageComponent,
      ),
  },
];

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
  ...(environment.production ? [] : sandboxRoutes),
  {
    path: 'pricing',
    loadComponent: () =>
      import('./pages/pricing/pricing-page.component').then(
        (m) => m.PricingPageComponent,
      ),
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
    canActivate: [AuthGuard],
  },
  {
    path: 'members',
    loadComponent: () =>
      import('./pages/members/members-page.component').then(
        (m) => m.MembersPageComponent,
      ),
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
