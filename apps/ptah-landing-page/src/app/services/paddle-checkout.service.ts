import { Injectable, signal, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, retry, catchError, of } from 'rxjs';
import {
  initializePaddle,
  Paddle,
  type PaddleEventData,
} from '@paddle/paddle-js';
import { PADDLE_CONFIG } from '../config/paddle.config';

export interface CheckoutOptions {
  priceId: string;
  customerEmail?: string;
  customerId?: string;
  successUrl?: string;
}

/**
 * Response from GET /api/v1/subscriptions/checkout-info
 *
 * Returns user's email and Paddle customer ID if they have one.
 */
export interface CheckoutInfoResponse {
  email: string;
  paddleCustomerId?: string;
}

/**
 * Response from POST /api/v1/subscriptions/validate-checkout
 *
 * Validates if user can proceed with checkout (prevents duplicate subscriptions).
 */
export interface ValidateCheckoutResponse {
  canCheckout: boolean;
  reason?: 'existing_subscription' | 'subscription_ending_soon' | 'none';
  existingPlan?: string;
  currentPeriodEnd?: string;
  customerPortalUrl?: string;
  message?: string;
}

/**
 * PaddleCheckoutService - Manages Paddle.js SDK and checkout flow
 *
 * Pattern: Injectable service with signal-based state
 * Evidence: auth.service.ts:28-58, profile-page.component.ts:207-209
 *
 * Uses official @paddle/paddle-js npm package for:
 * - TypeScript types out of the box
 * - Cleaner async/await API
 * - Better tree-shaking and bundling
 *
 * Responsibilities:
 * 1. Initialize Paddle with correct environment via npm package
 * 2. Provide reactive state via signals (isReady, isLoading, error)
 * 3. Open checkout overlay with pre-filled customer email
 * 4. Handle checkout callbacks (success, close)
 * 5. Retry logic for initialization failures (3 attempts)
 */
@Injectable({ providedIn: 'root' })
export class PaddleCheckoutService {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly paddleConfig = inject(PADDLE_CONFIG);

  private readonly MAX_RETRY_ATTEMPTS = this.paddleConfig.maxRetries ?? 3;
  private readonly LICENSE_VERIFY_RETRIES =
    this.paddleConfig.licenseVerifyRetries ?? 3;
  private readonly LICENSE_VERIFY_DELAY =
    this.paddleConfig.licenseVerifyDelay ?? 2000;

  // Paddle instance from npm package
  private paddleInstance: Paddle | null = null;

  // Reactive state signals
  private readonly _isReady = signal(false);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _isVerifying = signal(false);
  private readonly _isCheckoutOpen = signal(false);
  private readonly _loadingPlanName = signal<string | null>(null);
  private readonly _isValidating = signal(false);
  private readonly _validationError = signal<string | null>(null);
  private readonly _customerPortalUrl = signal<string | null>(null);

  // Public readonly signals
  public readonly isReady = this._isReady.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly isVerifying = this._isVerifying.asReadonly();
  public readonly isCheckoutOpen = this._isCheckoutOpen.asReadonly();
  public readonly loadingPlanName = this._loadingPlanName.asReadonly();
  public readonly isValidating = this._isValidating.asReadonly();
  public readonly validationError = this._validationError.asReadonly();
  public readonly customerPortalUrl = this._customerPortalUrl.asReadonly();

  // Computed: Can checkout if ready and not loading
  public readonly canCheckout = computed(
    () => this._isReady() && !this._isLoading()
  );

  private initAttempts = 0;
  private checkoutTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;

  private readonly CHECKOUT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize Paddle.js SDK using npm package
   *
   * Uses initializePaddle from @paddle/paddle-js for cleaner async initialization.
   * Retries up to MAX_RETRY_ATTEMPTS on failure.
   * Guards against concurrent initialization calls.
   */
  public initialize(): Promise<void> {
    // Return existing promise if initialization already in progress
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this._isReady()) {
      return Promise.resolve();
    }

    // Validate configuration before initialization
    if (!this.validateConfig()) {
      return Promise.reject(new Error('Invalid Paddle configuration'));
    }

    this._isLoading.set(true);
    this._error.set(null);

    // Create and store initialization promise
    this.initPromise = this.initializePaddleWithRetry();

    // Clear promise when complete (success or failure)
    this.initPromise
      .then(() => {
        this.initPromise = null;
      })
      .catch(() => {
        this.initPromise = null;
      });

    return this.initPromise;
  }

  /**
   * Initialize Paddle with retry logic
   */
  private async initializePaddleWithRetry(): Promise<void> {
    try {
      const paddle = await this.retryWithBackoff(
        () => this.doInitialize(),
        this.MAX_RETRY_ATTEMPTS,
        this.paddleConfig.baseRetryDelay ?? 1000
      );

      this.paddleInstance = paddle;
      this._isReady.set(true);
      this._isLoading.set(false);
      this._error.set(null);
    } catch (err) {
      this._isLoading.set(false);
      this._error.set(
        'Payment system temporarily unavailable. Please try again later.'
      );
      throw err;
    }
  }

  /**
   * Perform the actual Paddle initialization
   */
  private async doInitialize(): Promise<Paddle> {
    const paddle = await initializePaddle({
      token: this.paddleConfig.token,
      environment: this.paddleConfig.environment,
      eventCallback: (event) => this.handlePaddleEvent(event),
    });

    if (!paddle) {
      throw new Error('Paddle initialization returned undefined');
    }

    return paddle;
  }

  /**
   * Set the loading plan name
   * @param planName - Name of the plan currently loading, or null to clear
   */
  public setLoadingPlan(planName: string | null): void {
    this._loadingPlanName.set(planName);
  }

  /**
   * Clear validation error state
   * Call this when user dismisses the validation error dialog
   */
  public clearValidationError(): void {
    this._validationError.set(null);
    this._customerPortalUrl.set(null);
  }

  /**
   * Validate checkout before opening Paddle overlay
   *
   * Calls POST /api/v1/subscriptions/validate-checkout to check if user
   * already has an active subscription (prevents duplicate subscriptions).
   *
   * @param priceId - The Paddle price ID to validate checkout for
   * @returns true if checkout can proceed, false if blocked by existing subscription
   */
  private async validateCheckoutBeforeOpen(priceId: string): Promise<boolean> {
    this._isValidating.set(true);
    this._validationError.set(null);
    this._customerPortalUrl.set(null);

    try {
      const response = await firstValueFrom(
        this.http.post<ValidateCheckoutResponse>(
          '/api/v1/subscriptions/validate-checkout',
          { priceId }
        )
      );

      this._isValidating.set(false);

      if (!response.canCheckout) {
        // User has an existing subscription - show error with portal link
        const errorMessage =
          response.message ||
          `You already have an active ${
            response.existingPlan || 'subscription'
          }. ` + 'Please manage your existing subscription first.';

        this._validationError.set(errorMessage);
        this._customerPortalUrl.set(response.customerPortalUrl || null);

        console.log(
          '[Paddle] Checkout blocked:',
          response.reason,
          errorMessage
        );
        return false;
      }

      return true;
    } catch (error) {
      this._isValidating.set(false);

      // If validation API fails, log but allow checkout to proceed
      // (fail-open approach - don't block checkout on validation API issues)
      console.error(
        '[Paddle] Checkout validation failed, proceeding anyway:',
        error
      );
      return true;
    }
  }

  /**
   * Fetch checkout info (email and Paddle customer ID) from backend
   *
   * This ensures we reuse the same Paddle customer for returning users,
   * preventing duplicate customer accounts.
   */
  private async fetchCheckoutInfo(): Promise<CheckoutInfoResponse | null> {
    try {
      const response = await firstValueFrom(
        this.http.get<CheckoutInfoResponse>(
          '/api/v1/subscriptions/checkout-info'
        )
      );
      return response;
    } catch (error) {
      console.warn('[Paddle] Failed to fetch checkout info:', error);
      return null;
    }
  }

  /**
   * Open Paddle checkout overlay
   *
   * Flow:
   * 1. Validates checkout to prevent duplicate subscriptions
   * 2. Fetches checkout info (email + Paddle customer ID if exists)
   * 3. Opens Paddle overlay with customer ID (reuses existing customer)
   *
   * @param options - Checkout configuration with price ID and optional customer email
   */
  public async openCheckout(options: CheckoutOptions): Promise<void> {
    if (!this.paddleInstance || !this._isReady()) {
      this._error.set('Paddle SDK not ready. Please try again.');
      return;
    }

    // Prevent duplicate checkout if already open
    if (this._isCheckoutOpen()) {
      return;
    }

    // Step 1: Validate checkout before opening overlay
    const canProceed = await this.validateCheckoutBeforeOpen(options.priceId);

    if (!canProceed) {
      // Validation failed - error state already set by validateCheckoutBeforeOpen
      // Do NOT open Paddle overlay
      return;
    }

    // Step 2: Fetch checkout info to get existing Paddle customer ID
    const checkoutInfo = await this.fetchCheckoutInfo();

    // Step 3: Proceed with opening checkout
    this._isLoading.set(true);
    this._isCheckoutOpen.set(true);

    // Set 5-minute timeout to prevent stuck checkout
    this.checkoutTimeoutId = setTimeout(() => {
      this._error.set(
        'Checkout timed out after 5 minutes of inactivity. Please try again.'
      );
      this.closeCheckout();
    }, this.CHECKOUT_TIMEOUT);

    // Build customer object - prefer ID over email to reuse existing customer
    let customerConfig: { id: string } | { email: string } | undefined;

    if (checkoutInfo?.paddleCustomerId) {
      // Use existing Paddle customer ID (prevents duplicate customers)
      customerConfig = { id: checkoutInfo.paddleCustomerId };
    } else if (checkoutInfo?.email) {
      // Fall back to email from checkout info
      customerConfig = { email: checkoutInfo.email };
    } else if (options.customerEmail) {
      // Last resort: use provided email
      customerConfig = { email: options.customerEmail };
    }

    const checkoutOptions = {
      items: [{ priceId: options.priceId, quantity: 1 }],
      customer: customerConfig,
      settings: {
        displayMode: 'overlay' as const,
        theme: 'dark' as const,
        locale: 'en',
      },
    };

    // Debug: log checkout options in development
    if (
      !this.paddleConfig.environment ||
      this.paddleConfig.environment === 'sandbox'
    ) {
      console.log(
        '[Paddle] Opening checkout with options:',
        JSON.stringify(checkoutOptions, null, 2)
      );
    }

    this.paddleInstance.Checkout.open(checkoutOptions);
  }

  /**
   * Close checkout overlay programmatically
   */
  public closeCheckout(): void {
    this.clearCheckoutTimeout();
    if (this.paddleInstance) {
      this.paddleInstance.Checkout.close();
    }
    this._isLoading.set(false);
    this._isCheckoutOpen.set(false);
  }

  /**
   * Clear checkout timeout if set
   */
  private clearCheckoutTimeout(): void {
    if (this.checkoutTimeoutId !== null) {
      clearTimeout(this.checkoutTimeoutId);
      this.checkoutTimeoutId = null;
    }
  }

  /**
   * Retry initialization after failure
   */
  public retryInitialization(): void {
    this.initAttempts = 0;
    this._isReady.set(false);
    this._error.set(null);
    this.initPromise = null;
    this.paddleInstance = null;

    this.initialize();
  }

  /**
   * Validate Paddle configuration
   *
   * Checks that price IDs are not placeholders and environment is valid.
   * Sets error state if validation fails.
   *
   * @returns true if config is valid, false otherwise
   */
  private validateConfig(): boolean {
    const {
      environment,
      token,
      basicPriceIdMonthly,
      basicPriceIdYearly,
      proPriceIdMonthly,
      proPriceIdYearly,
    } = this.paddleConfig;

    // Check environment is valid
    if (environment !== 'sandbox' && environment !== 'production') {
      this._error.set('Invalid Paddle environment configuration');
      return false;
    }

    // Check token is configured and matches environment
    if (!token || token.includes('REPLACE')) {
      this._error.set(
        'Paddle client-side token not configured. Please check environment configuration.'
      );
      return false;
    }

    // Validate token prefix matches environment
    const expectedPrefix = environment === 'sandbox' ? 'test_' : 'live_';
    if (!token.startsWith(expectedPrefix)) {
      this._error.set(
        `Paddle token mismatch: ${environment} environment requires ${expectedPrefix} token`
      );
      return false;
    }

    // Check for placeholder price IDs
    const placeholderPatterns = [
      'REPLACE',
      'xxxxxxxxx',
      'yyyyyyyyy',
      'REPLACE_ME',
      'placeholder',
    ];

    const isPlaceholder = (priceId: string | undefined): boolean =>
      placeholderPatterns.some(
        (pattern) =>
          !priceId || priceId.toLowerCase().includes(pattern.toLowerCase())
      );

    // Check all 4 price IDs (Basic monthly/yearly, Pro monthly/yearly)
    const hasPlaceholders =
      isPlaceholder(basicPriceIdMonthly) ||
      isPlaceholder(basicPriceIdYearly) ||
      isPlaceholder(proPriceIdMonthly) ||
      isPlaceholder(proPriceIdYearly);

    if (hasPlaceholders) {
      this._error.set(
        'Paddle price IDs not configured. Please check environment configuration.'
      );
      return false;
    }

    return true;
  }

  /**
   * Retry a promise-returning function with exponential backoff
   *
   * @param fn - Function that returns a promise to retry
   * @param maxRetries - Maximum number of retry attempts
   * @param baseDelay - Base delay in milliseconds (doubled each retry)
   * @returns Promise that resolves if fn succeeds, rejects if all retries fail
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    baseDelay: number
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        this.initAttempts++;

        if (attempt < maxRetries) {
          // Calculate exponential backoff delay
          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('All retry attempts failed');
  }

  /**
   * Verify license activation with backend
   * Retries up to 3 times with 2-second delay to handle webhook processing time
   * @returns Promise<boolean> - true if license is active, false otherwise
   */
  private async verifyLicenseActivation(): Promise<boolean> {
    this._isVerifying.set(true);

    try {
      const result = await firstValueFrom(
        this.http
          .get<{
            plan: string;
            status: string;
            expiresAt?: string | null;
            email?: string;
          }>('/api/v1/licenses/me')
          .pipe(
            retry({
              count: this.LICENSE_VERIFY_RETRIES,
              delay: this.LICENSE_VERIFY_DELAY,
            }),
            catchError(() => of({ plan: 'trial', status: 'none' }))
          )
      );

      this._isVerifying.set(false);
      return result.status === 'active';
    } catch {
      this._isVerifying.set(false);
      return false;
    }
  }

  /**
   * Handle Paddle events from the checkout
   */
  private handlePaddleEvent(event: PaddleEventData): void {
    switch (event.name) {
      case 'checkout.completed':
        this.clearCheckoutTimeout();
        this._isLoading.set(false);
        this._isCheckoutOpen.set(false);

        // Close the Paddle overlay after a brief delay to show success message
        setTimeout(() => {
          if (this.paddleInstance) {
            this.paddleInstance.Checkout.close();
          }

          // Verify license activation with backend before navigation
          this.verifyLicenseActivation().then((isActive) => {
            if (isActive) {
              // Navigate to profile page after successful verification
              this.router.navigate(['/profile']);
            } else {
              // License might not be ready yet (webhook delay) - navigate anyway
              // The profile page will show trial/pending status
              console.log(
                '[Paddle] License not yet active, navigating to profile anyway'
              );
              this.router.navigate(['/profile']);
            }
          });
        }, 2000); // 2 second delay to let user see success message
        break;

      case 'checkout.closed':
        this.clearCheckoutTimeout();
        this._isLoading.set(false);
        this._isCheckoutOpen.set(false);
        // User closed checkout - no action needed
        break;

      case 'checkout.error':
        this.clearCheckoutTimeout();
        this._isLoading.set(false);
        this._isCheckoutOpen.set(false);
        // Paddle handles error display in overlay
        break;
    }
  }
}
