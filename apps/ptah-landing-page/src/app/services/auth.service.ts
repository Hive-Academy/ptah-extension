import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map, of, tap } from 'rxjs';

/**
 * User data returned from auth endpoints
 */
interface AuthUser {
  id: string;
  email: string;
}

/**
 * LocalStorage key for auth hint
 * This is used to avoid unnecessary API calls when no auth cookie exists.
 * Since HTTP-only cookies can't be read from JavaScript, we use this hint
 * to know if we should even attempt to verify authentication.
 */
const AUTH_HINT_KEY = 'ptah_auth_hint';

/**
 * AuthService - Handles authentication state
 *
 * API endpoints:
 * - GET /api/auth/me → Check if authenticated, get user data
 * - POST /api/auth/logout → Clear session
 *
 * Uses HTTP-only cookie (ptah_auth) - no token storage needed.
 * Uses localStorage hint to avoid unnecessary 401 errors when not logged in.
 *
 * Angular 21 patterns:
 * - inject() for DI
 * - providedIn: 'root' singleton
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/auth';

  /**
   * Check if user is authenticated (hint-based, for UI updates)
   *
   * First checks localStorage hint to avoid unnecessary API calls.
   * If hint exists, verifies with backend. If backend returns 401,
   * clears the hint (stale session).
   *
   * Use this for non-critical UI updates like showing/hiding nav items.
   * For route protection, use verifyAuthentication() instead.
   *
   * @returns Observable<boolean>
   */
  public isAuthenticated(): Observable<boolean> {
    if (!this.hasAuthHint()) {
      return of(false);
    }

    return this.verifyWithBackend();
  }

  /**
   * Internal method to verify with backend
   */
  private verifyWithBackend(): Observable<boolean> {
    return this.http.get(`${this.baseUrl}/me`).pipe(
      map(() => {
        this.setAuthHint();
        return true;
      }),
      catchError(() => {
        this.clearAuthHint();
        return of(false);
      }),
    );
  }

  /**
   * Get current authenticated user
   *
   * First checks localStorage hint to avoid unnecessary API calls.
   *
   * @returns Observable<AuthUser | null>
   */
  public getCurrentUser(): Observable<AuthUser | null> {
    if (!this.hasAuthHint()) {
      return of(null);
    }

    return this.http.get<AuthUser>(`${this.baseUrl}/me`).pipe(
      tap(() => {
        this.setAuthHint();
      }),
      catchError(() => {
        this.clearAuthHint();
        return of(null);
      }),
    );
  }

  /**
   * Logout user
   * Clears the auth hint on successful logout.
   *
   * @returns Observable<void>
   */
  public logout(): Observable<void> {
    return this.http.post<void>(`${this.baseUrl}/logout`, {}).pipe(
      tap(() => this.clearAuthHint()),
      catchError(() => {
        this.clearAuthHint();
        return of(undefined);
      }),
    );
  }

  /**
   * Set auth hint after successful login
   * Call this after successful authentication (OAuth callback, magic link, etc.)
   */
  public setAuthHint(): void {
    localStorage.setItem(AUTH_HINT_KEY, 'true');
  }

  /**
   * Clear auth hint
   */
  public clearAuthHint(): void {
    localStorage.removeItem(AUTH_HINT_KEY);
  }

  /**
   * Check if auth hint exists
   */
  private hasAuthHint(): boolean {
    try {
      return localStorage.getItem(AUTH_HINT_KEY) === 'true';
    } catch {
      return true;
    }
  }
}
