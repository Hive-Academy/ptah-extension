import { inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CanActivateFn, Router } from '@angular/router';
import { Observable, catchError, map, of } from 'rxjs';

/**
 * AdminAuthGuard - Functional route guard for the native admin dashboard
 *
 * Probes `GET /api/v1/admin/records/users?pageSize=1`. The backend guard chain
 * is `JwtAuthGuard -> AdminGuard`, so the HTTP status cleanly separates the
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
 * ⚠️ THE PROBE PATH IS LOAD-BEARING AND MUST TRACK THE SERVER (TASK_2026_170 R2).
 * This used to probe `GET /api/v1/admin/users`, which only ever resolved
 * because it fell through to `AdminController`'s `@Get(':model')` wildcard —
 * i.e. it was always the GENERIC record list for the `users` model, never a
 * route `AdminUsersController` declared. R2 moved that wildcard to
 * `v1/admin/records/:model`. If this path is left pointing at a route the
 * server no longer serves, the probe 404s, the `catchError` below reads that as
 * "not an admin", and EVERY admin is redirected away from the entire dashboard
 * with no error anywhere saying a route moved.
 * Do NOT switch this to `/api/v1/admin/stats`: that handler runs heavy
 * aggregation and this guard fires on every admin route activation.
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
    .get('/api/v1/admin/records/users', {
      params: { pageSize: 1 },
      observe: 'response',
    })
    .pipe(
      map(() => true),
      catchError((err: HttpErrorResponse) => {
        if (err?.status === 403) {
          router.navigate(['/profile']);
        } else {
          router.navigate(['/login'], {
            queryParams: { returnUrl: '/admin' },
          });
        }
        return of(false);
      }),
    );
};
