import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, catchError, tap, map, switchMap } from 'rxjs';
import { LicenseData } from '../pages/profile/models/license-data.interface';
import { AuthService } from './auth.service';

/**
 * SubscriptionStateService - Manages subscription state for pricing page
 *
 * Pattern: Signal-based state (matches PaddleCheckoutService)
 * Evidence: paddle-checkout.service.ts:77-96
 *
 * Responsibilities:
 * 1. Fetch subscription status from /api/v1/licenses/me on demand
 * 2. Cache subscription state using signals for reactive updates
 * 3. Provide computed helpers for subscription state queries
 * 4. Handle loading and error states gracefully
 *
 * Usage:
 * - Inject into PricingGridComponent
 * - Call fetchSubscriptionState() and subscribe with takeUntilDestroyed
 * - Use computed signals (currentPlanTier, isOnTrial, etc.) for UI logic
 */
@Injectable({ providedIn: 'root' })
export class SubscriptionStateService {
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);

  // Private writable signals
  private readonly _licenseData = signal<LicenseData | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _isFetched = signal(false);

  // Public readonly signals
  public readonly licenseData = this._licenseData.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly isFetched = this._isFetched.asReadonly();

  /**
   * Computed: Current plan tier (normalized)
   *
   * TASK_2025_128: Freemium model (Community + Pro)
   * - Maps trial_pro -> pro
   * - Returns null when data hasn't been fetched yet (loading/unknown state)
   * - Returns 'community' only when explicitly determined (no subscription after auth check)
   *
   * @returns 'community' | 'pro' | null
   */
  public readonly currentPlanTier = computed<'community' | 'pro' | null>(() => {
    // Return null when data hasn't been fetched yet - loading/unknown state
    if (!this._isFetched()) return null;

    const data = this._licenseData();

    // No license data after fetch = Community (free tier)
    // This means user is either unauthenticated or has no subscription
    if (!data?.plan) return 'community';

    // Pro tier (including trial)
    if (data.plan.includes('pro')) return 'pro';

    // Community tier
    if (data.plan.includes('community')) return 'community';

    // Default to community for unknown plans
    return 'community';
  });

  /**
   * Computed: Is user on trial
   *
   * Returns true if user is actually on a trial, meaning:
   * 1. Plan name starts with 'trial_' AND
   * 2. Subscription status is NOT 'active' (active = paying customer)
   *
   * This prevents showing trial UI for users who have an active paid subscription
   * even if their plan name wasn't updated from 'trial_pro' to 'pro'.
   */
  public readonly isOnTrial = computed(() => {
    const data = this._licenseData();
    const hasTrial = data?.plan?.startsWith('trial_') ?? false;
    const isActiveSubscription = data?.subscription?.status === 'active';

    // If subscription is active (paying), they're not on trial
    return hasTrial && !isActiveSubscription;
  });

  /**
   * Computed: Days remaining in trial
   *
   * Returns the number of days remaining in the trial period,
   * or null if user is not on trial.
   */
  public readonly trialDaysRemaining = computed<number | null>(() => {
    const data = this._licenseData();
    if (!this.isOnTrial()) return null;
    return data?.daysRemaining ?? null;
  });

  /**
   * Computed: Subscription status
   *
   * Returns the raw subscription status from the API:
   * 'active' | 'paused' | 'canceled' | 'past_due' | null
   */
  public readonly subscriptionStatus = computed<string | null>(() => {
    return this._licenseData()?.subscription?.status ?? null;
  });

  /**
   * Computed: Has active subscription (not trial)
   *
   * Returns true if user has an active paid subscription (not on trial).
   */
  public readonly hasActiveSubscription = computed(() => {
    const data = this._licenseData();
    return data?.subscription?.status === 'active' && !this.isOnTrial();
  });

  /**
   * Computed: Is subscription canceled but still active
   *
   * Returns true if user canceled but subscription is still active
   * until the period end date.
   */
  public readonly isCanceled = computed(() => {
    return this._licenseData()?.subscription?.status === 'canceled';
  });

  /**
   * Computed: Is subscription past due
   *
   * Returns true if subscription has payment issues (past_due status).
   */
  public readonly isPastDue = computed(() => {
    return this._licenseData()?.subscription?.status === 'past_due';
  });

  /**
   * Computed: Is subscription paused
   *
   * Returns true if subscription is in paused state (Paddle feature).
   */
  public readonly isPaused = computed(() => {
    return this._licenseData()?.subscription?.status === 'paused';
  });

  /**
   * Computed: Subscription period end date
   *
   * Returns the current period end date for display in UI.
   */
  public readonly periodEndDate = computed<string | null>(() => {
    return this._licenseData()?.subscription?.currentPeriodEnd ?? null;
  });

  /**
   * Fetch subscription state (only if authenticated)
   *
   * Pattern: Returns Observable for proper lifecycle management with takeUntilDestroyed.
   * Uses switchMap to ensure proper cancellation of in-flight requests.
   *
   * Flow:
   * 1. Skip if already fetched or currently loading (returns of(null))
   * 2. Check authentication via AuthService.isAuthenticated()
   * 3. If authenticated, fetch license data from API
   * 4. Update signals with response or error
   *
   * @returns Observable<LicenseData | null> - License data or null if not authenticated
   */
  public fetchSubscriptionState(): Observable<LicenseData | null> {
    // Skip if already fetched or currently loading
    if (this._isFetched() || this._isLoading()) {
      return of(this._licenseData());
    }

    this._isLoading.set(true);
    this._error.set(null);

    // Use switchMap to chain observables properly for cleanup
    return this.authService.isAuthenticated().pipe(
      switchMap((isAuth) => {
        if (!isAuth) {
          // Not authenticated - skip API call, mark as fetched
          this._isLoading.set(false);
          this._isFetched.set(true);
          return of(null);
        }

        // Fetch license data from backend
        return this.http.get<LicenseData>('/api/v1/licenses/me').pipe(
          tap((data) => {
            this._licenseData.set(data);
            this._isLoading.set(false);
            this._isFetched.set(true);
          }),
          catchError((err) => {
            console.error(
              '[SubscriptionState] Failed to fetch license data:',
              err.message || err,
              err.status ? `(HTTP ${err.status})` : ''
            );
            this._error.set('Unable to load subscription status');
            this._isLoading.set(false);
            this._isFetched.set(true);
            return of(null);
          })
        );
      }),
      catchError((err) => {
        // Auth check failed - mark as fetched without data
        console.error(
          '[SubscriptionState] Auth check failed:',
          err.message || err
        );
        this._isLoading.set(false);
        this._isFetched.set(true);
        return of(null);
      })
    );
  }

  /**
   * Reset state (for logout or refresh scenarios)
   *
   * Clears all cached data and resets flags.
   * Call this when user logs out to ensure fresh state on next login.
   */
  public reset(): void {
    this._licenseData.set(null);
    this._isLoading.set(false);
    this._error.set(null);
    this._isFetched.set(false);
  }

  /**
   * Force refresh subscription state
   *
   * Resets the fetched flag and re-fetches data from the API.
   * Useful after checkout completion or subscription changes.
   *
   * @returns Observable<LicenseData | null> - Fresh license data
   */
  public refresh(): Observable<LicenseData | null> {
    this._isFetched.set(false);
    return this.fetchSubscriptionState();
  }
}
