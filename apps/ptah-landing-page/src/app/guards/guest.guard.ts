import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * GuestGuard - Functional route guard for guest-only pages
 *
 * Redirects authenticated users away from auth pages (login, signup)
 * to the profile page. This prevents logged-in users from seeing
 * login/signup forms unnecessarily.
 *
 * Usage in routes:
 * { path: 'login', component: AuthPageComponent, canActivate: [GuestGuard] }
 * { path: 'signup', component: AuthPageComponent, canActivate: [GuestGuard] }
 *
 * Complementary to AuthGuard:
 * - AuthGuard: Protects authenticated routes, redirects guests to /login
 * - GuestGuard: Protects guest routes, redirects authenticated users to /profile
 *
 * Angular 21 patterns:
 * - Functional guard (not class-based)
 * - inject() for DI
 */
export const GuestGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAuthenticated().pipe(
    map((isAuth) => {
      if (isAuth) {
        // User is already authenticated, redirect to profile
        router.navigate(['/profile']);
        return false;
      }
      // User is not authenticated, allow access to auth pages
      return true;
    })
  );
};
