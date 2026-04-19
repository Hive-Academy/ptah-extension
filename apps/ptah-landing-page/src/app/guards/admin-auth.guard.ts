import { inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';

/**
 * AdminAuthGuard - Functional route guard for the native admin dashboard
 *
 * Probes `GET /api/v1/admin/users?pageSize=1`. The backend guard chain is
 * `JwtAuthGuard -> AdminGuard`, so the HTTP status cleanly separates the
 * two failure modes:
 *   - 200 → authenticated AND admin → allow navigation
 *   - 401 → not logged in → redirect to /login
 *   - 403 → logged in but email not in ADMIN_EMAILS → redirect to /profile
 *   - Any other error → conservative fallback to /login
 *
 * Notes:
 * - `apiInterceptor` auto-prepends `environment.apiBaseUrl` for `/api/*`
 *   requests and adds `withCredentials: true`, so the URL stays relative here.
 * - Returns `Observable<boolean>` so Angular awaits the probe before routing.
 *
 * Angular 21 patterns:
 * - Functional guard (CanActivateFn)
 * - inject() for DI
 * - Observable-based (no Promise)
 */
export const AdminAuthGuard: CanActivateFn = (): Observable<boolean> => {
  const http = inject(HttpClient);
  const router = inject(Router);

  return http
    .get('/api/v1/admin/users', {
      params: { pageSize: 1 },
      observe: 'response',
    })
    .pipe(
      map(() => true),
      catchError((err: HttpErrorResponse) => {
        if (err?.status === 403) {
          router.navigate(['/profile']);
        } else {
          // 401 or any other error → conservative redirect to login
          router.navigate(['/login'], {
            queryParams: { returnUrl: '/admin' },
          });
        }
        return of(false);
      }),
    );
};
