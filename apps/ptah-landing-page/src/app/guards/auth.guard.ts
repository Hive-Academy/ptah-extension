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
 * Usage in routes:
 * { path: 'profile', component: ProfilePageComponent, canActivate: [AuthGuard] }
 *
 * Angular 21 patterns:
 * - Functional guard (not class-based)
 * - inject() for DI
 *
 * Evidence: implementation-plan.md Phase 1 - Auth Guard
 */
export const AuthGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.isAuthenticated().pipe(
    map((isAuth) => {
      if (!isAuth) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    })
  );
};
