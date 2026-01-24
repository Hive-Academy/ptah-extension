import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of } from 'rxjs';

/**
 * User data returned from auth endpoints
 */
interface AuthUser {
  id: string;
  email: string;
}

/**
 * AuthService - Handles authentication state
 *
 * API endpoints:
 * - GET /auth/me → Check if authenticated, get user data
 * - POST /auth/logout → Clear session
 *
 * Uses HTTP-only cookies (ptah_auth) - no token storage needed.
 *
 * Angular 21 patterns:
 * - inject() for DI
 * - providedIn: 'root' singleton
 *
 * Evidence: implementation-plan.md Phase 1 - Authentication Services
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);

  /**
   * Check if user is authenticated
   * @returns Observable<boolean>
   */
  public isAuthenticated(): Observable<boolean> {
    return this.http.get('/auth/me').pipe(
      map(() => true),
      catchError(() => of(false))
    );
  }

  /**
   * Get current authenticated user
   * @returns Observable<AuthUser | null>
   */
  public getCurrentUser(): Observable<AuthUser | null> {
    return this.http.get<AuthUser>('/auth/me').pipe(catchError(() => of(null)));
  }

  /**
   * Logout user
   * @returns Observable<void>
   */
  public logout(): Observable<void> {
    return this.http.post<void>('/auth/logout', {});
  }
}
