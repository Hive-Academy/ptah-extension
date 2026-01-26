import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * AuthGuard - Functional route guard
 *
 * Protects routes that require authentication.
 * Redirects unauthenticated users to /login.
 *
 * Uses verifyAuthentication() which always makes an API call.
 * This is necessary because OAuth/magic link redirects may land
 * on protected routes before the localStorage hint is set.
 *
 * Usage in routes:
 * { path: 'profile', component: ProfilePageComponent, canActivate: [AuthGuard] }
 *
 * Angular 21 patterns:
 * - Functional guard (not class-based)
 * - inject() for DI
 */
export const AuthGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  // Use verifyAuthentication() to always check with backend
  // This handles OAuth/magic link redirects where cookie exists but no hint yet
  return authService.verifyAuthentication().pipe(
    map((isAuth) => {
      if (!isAuth) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    })
  );
};
