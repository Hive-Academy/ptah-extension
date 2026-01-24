import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { PricingPageComponent } from './pages/pricing/pricing-page.component';
import { LoginPageComponent } from './pages/login/login-page.component';
import { ProfilePageComponent } from './pages/profile/profile-page.component';
import { AuthGuard } from './guards/auth.guard';

/**
 * Application Routes
 *
 * Route definitions for the Ptah landing page and license system pages.
 *
 * Routes:
 * - `/` → Landing page (home)
 * - `/pricing` → Pricing plans page
 * - `/login` → Magic link authentication
 * - `/profile` → User license dashboard (protected by AuthGuard)
 * - `/**` → Wildcard redirects to home (404 handling)
 *
 * Evidence: implementation-plan.md Phase 1 - Routing Infrastructure
 */
export const routes: Routes = [
  {
    path: '',
    component: LandingPageComponent,
  },
  {
    path: 'pricing',
    component: PricingPageComponent,
  },
  {
    path: 'login',
    component: LoginPageComponent,
  },
  {
    path: 'profile',
    component: ProfilePageComponent,
    canActivate: [AuthGuard],
  },
  {
    path: '**',
    redirectTo: '',
  },
];
