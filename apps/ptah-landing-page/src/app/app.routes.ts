import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { PricingPageComponent } from './pages/pricing/pricing-page.component';
import { AuthPageComponent } from './pages/auth/auth-page.component';
import { ProfilePageComponent } from './pages/profile/profile-page.component';
import { AuthGuard } from './guards/auth.guard';
import { GuestGuard } from './guards/guest.guard';

/**
 * Application Routes
 *
 * Route definitions for the Ptah landing page and license system pages.
 *
 * Routes:
 * - `/` → Landing page (home)
 * - `/pricing` → Pricing plans page
 * - `/login` → Unified auth page (Sign In mode) - GuestGuard redirects to /profile if already logged in
 * - `/signup` → Unified auth page (Sign Up mode) - GuestGuard redirects to /profile if already logged in
 * - `/profile` → User license dashboard (protected by AuthGuard)
 * - `/**` → Wildcard redirects to home (404 handling)
 *
 * Guards:
 * - AuthGuard: Protects authenticated routes, redirects guests to /login
 * - GuestGuard: Protects guest-only routes, redirects authenticated users to /profile
 *
 * Authentication:
 * Uses unified AuthPageComponent with child components:
 * - AuthFormComponent: Email/password form
 * - SocialLoginButtonsComponent: GitHub, Google OAuth
 * - AuthHeroComponent: Right-side hero section
 *
 * Backend Integration:
 * - POST /api/auth/login/email - Email/password login
 * - POST /api/auth/signup - User registration
 * - GET /api/auth/oauth/:provider - OAuth redirects
 * - POST /api/auth/magic-link - Passwordless login
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
    component: AuthPageComponent,
    canActivate: [GuestGuard],
  },
  {
    path: 'signup',
    component: AuthPageComponent,
    canActivate: [GuestGuard],
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
