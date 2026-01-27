import { inject, Injectable } from '@angular/core';
import { AuthService } from './auth.service';

/**
 * AuthInitializerService - Handles auth state synchronization on app startup
 *
 * Problem this solves:
 * When users authenticate via OAuth or magic link, the backend sets an HTTP-only
 * cookie and redirects to the frontend. However, the frontend uses a localStorage
 * hint to avoid unnecessary API calls. Without this initializer, the hint is never
 * set, causing AuthGuard to immediately return false without checking the cookie.
 *
 * Solution:
 * Backend adds `?auth_hint=1` to redirect URLs after successful authentication.
 * This service runs as an APP_INITIALIZER (before routing) to:
 * 1. Check for the `auth_hint` query parameter
 * 2. If found, set the localStorage hint so guards will call the API
 * 3. Remove the parameter from URL for a clean browser history
 *
 * Flow:
 * 1. User authenticates (OAuth/magic link)
 * 2. Backend sets cookie, redirects to `/profile?auth_hint=1`
 * 3. APP_INITIALIZER runs this service BEFORE routing
 * 4. Service sets localStorage hint, removes param from URL
 * 5. AuthGuard runs, sees hint, calls API, verifies cookie
 * 6. User successfully lands on protected route
 *
 * @example
 * ```typescript
 * // In app.config.ts
 * {
 *   provide: APP_INITIALIZER,
 *   useFactory: (authInit: AuthInitializerService) => () => authInit.initialize(),
 *   deps: [AuthInitializerService],
 *   multi: true,
 * }
 * ```
 */
@Injectable({ providedIn: 'root' })
export class AuthInitializerService {
  private readonly authService = inject(AuthService);

  /**
   * Initialize auth state from URL parameters
   *
   * Called by APP_INITIALIZER before Angular routing begins.
   * Synchronous operation - no need for async/Promise.
   */
  public initialize(): void {
    // Parse current URL to check for auth_hint parameter
    const url = new URL(window.location.href);
    const authHint = url.searchParams.get('auth_hint');

    if (authHint === '1') {
      // Backend signaled successful authentication - set localStorage hint
      // This allows AuthGuard to call the API and verify the HTTP-only cookie
      this.authService.setAuthHint();

      // Remove auth_hint from URL for clean browser history
      // Uses replaceState to avoid adding to history stack
      url.searchParams.delete('auth_hint');
      window.history.replaceState({}, '', url.toString());
    }
  }
}
