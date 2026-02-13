import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError } from 'rxjs/operators';
import { of } from 'rxjs';
import { HttpClient } from '@angular/common/http';
import { LicenseData } from '../pages/profile/models/license-data.interface';

/**
 * TrialStatusGuard - Functional route guard
 *
 * TASK_2025_143: Redirect users with expired trials to dedicated page
 *
 * Protects routes from users whose trial has ended.
 * Redirects to /trial-ended page instead of showing dismissible modal.
 *
 * Checks backend for `reason: 'trial_ended'` field.
 * Works even if cron job hasn't run yet (backend checks trialEnd date).
 *
 * **Authentication handling**:
 * - Unauthenticated users (401 error) → Allow access (for pricing page)
 * - Authenticated users with expired trials → Redirect to /trial-ended
 * - Authenticated users with active trials → Allow access
 *
 * Usage:
 * ```typescript
 * {
 *   path: 'profile',
 *   canActivate: [AuthGuard, TrialStatusGuard] // Auth required first
 * }
 * {
 *   path: 'pricing',
 *   canActivate: [TrialStatusGuard] // Allow guests, block expired trials
 * }
 * ```
 *
 * Angular 21 patterns:
 * - Functional guard (not class-based)
 * - inject() for DI
 * - Observable-based activation
 */
export const TrialStatusGuard: CanActivateFn = () => {
  const http = inject(HttpClient);
  const router = inject(Router);

  return http.get<LicenseData>('/api/v1/licenses/me').pipe(
    map((license) => {
      // If trial has ended, redirect to dedicated page
      if (license.reason === 'trial_ended') {
        router.navigate(['/trial-ended']);
        return false;
      }
      return true;
    }),
    catchError((error) => {
      // If user is not authenticated (401), allow access
      // This enables guest users to view pricing page
      if (error.status === 401) {
        return of(true);
      }
      // For other errors, deny access for safety
      return of(false);
    })
  );
};
