import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, throwError } from 'rxjs';
import {
  AuthErrorResponse,
  AuthSuccessResponse,
  LoginRequest,
  MagicLinkRequest,
  MagicLinkResponse,
  OAuthProvider,
  ResendVerificationRequest,
  ResendVerificationResponse,
  SignupPendingResponse,
  SignupRequest,
  VerifyEmailRequest,
} from '../models/auth.types';

/**
 * Auth API Service
 *
 * Handles all HTTP communication with the license server
 * authentication endpoints.
 *
 * Endpoints:
 * - POST /api/auth/login/email - Email/password login
 * - POST /api/auth/signup - Create new account (returns pending verification)
 * - POST /api/auth/verify-email - Verify email with code
 * - POST /api/auth/resend-verification - Resend verification code
 * - POST /api/auth/magic-link - Send magic link email
 * - GET /api/auth/oauth/:provider - OAuth redirect
 */
@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/auth';

  /**
   * Login with email and password
   */
  public loginWithEmail(
    request: LoginRequest
  ): Observable<AuthSuccessResponse> {
    return this.http
      .post<AuthSuccessResponse>(`${this.baseUrl}/login/email`, request)
      .pipe(catchError(this.handleError));
  }

  /**
   * Sign up with email and password
   * Returns pending verification status - user must verify email
   */
  public signup(request: SignupRequest): Observable<SignupPendingResponse> {
    return this.http
      .post<SignupPendingResponse>(`${this.baseUrl}/signup`, request)
      .pipe(catchError(this.handleError));
  }

  /**
   * Verify email with 6-digit code
   */
  public verifyEmail(
    request: VerifyEmailRequest
  ): Observable<AuthSuccessResponse> {
    return this.http
      .post<AuthSuccessResponse>(`${this.baseUrl}/verify-email`, request)
      .pipe(catchError(this.handleError));
  }

  /**
   * Resend verification code
   */
  public resendVerificationCode(
    request: ResendVerificationRequest
  ): Observable<ResendVerificationResponse> {
    return this.http
      .post<ResendVerificationResponse>(
        `${this.baseUrl}/resend-verification`,
        request
      )
      .pipe(catchError(this.handleError));
  }

  /**
   * Request magic link for passwordless login
   */
  public requestMagicLink(
    request: MagicLinkRequest
  ): Observable<MagicLinkResponse> {
    return this.http
      .post<MagicLinkResponse>(`${this.baseUrl}/magic-link`, request)
      .pipe(catchError(this.handleError));
  }

  /**
   * Redirect to OAuth provider with optional return URL and plan
   * Note: This performs a browser redirect, not an HTTP request
   *
   * @param provider - OAuth provider (github, google)
   * @param returnUrl - Optional URL path to redirect to after auth
   * @param plan - Optional plan key for auto-checkout (e.g., 'pro-monthly', 'pro-yearly')
   */
  public redirectToOAuth(
    provider: OAuthProvider,
    returnUrl?: string | null,
    plan?: string | null
  ): void {
    let url = `${this.baseUrl}/oauth/${provider}`;
    const params = new URLSearchParams();

    if (returnUrl) {
      params.set('returnUrl', returnUrl);
    }
    if (plan) {
      params.set('plan', plan);
    }

    const queryString = params.toString();
    if (queryString) {
      url += `?${queryString}`;
    }

    window.location.href = url;
  }

  /**
   * Redirect to GitHub OAuth
   *
   * @param returnUrl - Optional URL path to redirect to after auth
   * @param plan - Optional plan key for auto-checkout
   */
  public loginWithGitHub(
    returnUrl?: string | null,
    plan?: string | null
  ): void {
    this.redirectToOAuth('github', returnUrl, plan);
  }

  /**
   * Redirect to Google OAuth
   *
   * @param returnUrl - Optional URL path to redirect to after auth
   * @param plan - Optional plan key for auto-checkout
   */
  public loginWithGoogle(
    returnUrl?: string | null,
    plan?: string | null
  ): void {
    this.redirectToOAuth('google', returnUrl, plan);
  }

  /**
   * Handle HTTP errors and transform to consistent format
   */
  private handleError(error: HttpErrorResponse): Observable<never> {
    let message = 'An unexpected error occurred. Please try again.';
    let code: string | undefined;
    let userId: string | undefined;
    let email: string | undefined;

    if (error.error instanceof ErrorEvent) {
      // Client-side error
      message = error.error.message;
    } else if (error.error?.message) {
      // Server-side error with message
      // Check if it's a JSON-encoded error with special codes
      try {
        const parsed = JSON.parse(error.error.message);
        if (parsed.code === 'email_verification_required') {
          code = parsed.code;
          userId = parsed.userId;
          email = parsed.email;
          message = parsed.message || 'Please verify your email first.';
        } else {
          message = error.error.message;
        }
      } catch {
        // Not JSON, use message directly
        message = error.error.message;
      }
    } else {
      // Fallback messages by status code
      switch (error.status) {
        case 401:
          message =
            'Invalid credentials. Please check your email and password.';
          break;
        case 409:
          message =
            'An account with this email already exists. Please sign in instead.';
          break;
        case 400:
          message = 'Invalid request. Please check your input.';
          break;
        case 500:
          message = 'Server error. Please try again later.';
          break;
      }
    }

    const errorResponse: AuthErrorResponse = {
      success: false,
      message,
      error: error.error?.error,
      code,
      userId,
      email,
    };

    return throwError(() => errorResponse);
  }
}
