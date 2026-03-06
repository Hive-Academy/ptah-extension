import { Routes } from '@angular/router';
import { LandingPageComponent } from './pages/landing-page.component';
import { PricingPageComponent } from './pages/pricing/pricing-page.component';
import { AuthPageComponent } from './pages/auth/auth-page.component';
import { ProfilePageComponent } from './pages/profile/profile-page.component';
import { TrialEndedPageComponent } from './pages/trial-ended/trial-ended-page.component';
import { AuthGuard } from './guards/auth.guard';
import { GuestGuard } from './guards/guest.guard';
import { DocsPageComponent } from './pages/docs/docs-page.component';
import { TermsPageComponent } from './pages/legal/terms-page.component';
import { PrivacyPageComponent } from './pages/legal/privacy-page.component';
import { RefundPageComponent } from './pages/legal/refund-page.component';
import { TrialStatusGuard } from './guards/trial-status.guard';

/**
 * Application Routes
 *
 * Route definitions for the Ptah landing page and license system pages.
 *
 * Routes:
 * - `/` → Landing page (home)
 * - `/pricing` → Pricing plans page (protected by TrialStatusGuard)
 * - `/login` → Unified auth page (Sign In mode) - GuestGuard redirects to /profile if already logged in
 * - `/signup` → Unified auth page (Sign Up mode) - GuestGuard redirects to /profile if already logged in
 * - `/profile` → User dashboard with tabs: Account, Sessions, Contact (protected by AuthGuard + TrialStatusGuard)
 * - `/sessions` → Redirects to /profile (sessions tab lives under profile)
 * - `/contact` → Redirects to /profile (contact tab lives under profile)
 * - `/trial-ended` → Trial expired page (protected by AuthGuard only)
 * - `/**` → Wildcard redirects to home (404 handling)
 *
 * Guards:
 * - AuthGuard: Protects authenticated routes, redirects guests to /login
 * - GuestGuard: Protects guest-only routes, redirects authenticated users to /profile
 * - TrialStatusGuard: Redirects users with expired trials to /trial-ended
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
    path: 'docs',
    component: DocsPageComponent,
  },
  {
    path: 'pricing',
    component: PricingPageComponent,
    canActivate: [TrialStatusGuard], // Redirect expired trials to /trial-ended
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
    canActivate: [AuthGuard, TrialStatusGuard], // Auth + trial status check
  },
  // Redirect old standalone pages to profile (now tabs within profile)
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
    component: TermsPageComponent,
  },
  {
    path: 'privacy',
    component: PrivacyPageComponent,
  },
  {
    path: 'refund',
    component: RefundPageComponent,
  },
  {
    path: 'trial-ended',
    component: TrialEndedPageComponent,
    canActivate: [AuthGuard], // Must be logged in, but no trial check
  },
  {
    path: '**',
    redirectTo: '',
  },
];
