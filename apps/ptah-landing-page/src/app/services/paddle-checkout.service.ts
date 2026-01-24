import { Injectable, signal, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, retry, catchError, of } from 'rxjs';
import { PADDLE_CONFIG } from '../config/paddle.config';

/**
 * Paddle.js global interface
 * @see https://developer.paddle.com/paddlejs/overview
 */
declare global {
  interface Window {
    Paddle?: {
      Initialize: (options: PaddleInitOptions) => void;
      Checkout: {
        open: (options: PaddleCheckoutOptions) => void;
        close: () => void;
      };
      Environment: {
        set: (env: 'sandbox' | 'production') => void;
      };
    };
  }
}

interface PaddleInitOptions {
  token?: string;
  environment?: 'sandbox' | 'production';
  eventCallback?: (event: PaddleEvent) => void;
}

interface PaddleCheckoutOptions {
  items: Array<{ priceId: string; quantity: number }>;
  customer?: { email?: string };
  settings?: {
    displayMode?: 'overlay' | 'inline';
    successUrl?: string;
    theme?: 'light' | 'dark';
    locale?: string;
  };
}

interface PaddleEvent {
  name: string;
  data?: unknown;
}

export interface CheckoutOptions {
  priceId: string;
  customerEmail?: string;
  successUrl?: string;
}

/**
 * PaddleCheckoutService - Manages Paddle.js SDK and checkout flow
 *
 * Pattern: Injectable service with signal-based state
 * Evidence: auth.service.ts:28-58, profile-page.component.ts:207-209
 *
 * Responsibilities:
 * 1. Dynamically load Paddle.js SDK from CDN
 * 2. Initialize Paddle with correct environment
 * 3. Provide reactive state via signals (isReady, isLoading, error)
 * 4. Open checkout overlay with pre-filled customer email
 * 5. Handle checkout callbacks (success, close)
 * 6. Retry logic for SDK loading failures (3 attempts)
 */
@Injectable({ providedIn: 'root' })
export class PaddleCheckoutService {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly paddleConfig = inject(PADDLE_CONFIG);

  private readonly PADDLE_SDK_URL =
    'https://cdn.paddle.com/paddle/v2/paddle.js';
  private readonly MAX_RETRY_ATTEMPTS = this.paddleConfig.maxRetries ?? 3;
  private readonly LICENSE_VERIFY_RETRIES = this.paddleConfig.licenseVerifyRetries ?? 3;
  private readonly LICENSE_VERIFY_DELAY = this.paddleConfig.licenseVerifyDelay ?? 2000;

  // Reactive state signals
  private readonly _isReady = signal(false);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _isVerifying = signal(false);
  private readonly _isCheckoutOpen = signal(false);
  private readonly _loadingPlanName = signal<string | null>(null);

  // Public readonly signals
  public readonly isReady = this._isReady.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly isVerifying = this._isVerifying.asReadonly();
  public readonly isCheckoutOpen = this._isCheckoutOpen.asReadonly();
  public readonly loadingPlanName = this._loadingPlanName.asReadonly();

  // Computed: Can checkout if ready and not loading
  public readonly canCheckout = computed(
    () => this._isReady() && !this._isLoading()
  );

  private initAttempts = 0;
  private scriptElement: HTMLScriptElement | null = null;
  private checkoutTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;

  private readonly CHECKOUT_TIMEOUT = 5 * 60 * 1000; // 5 minutes

  /**
   * Initialize Paddle.js SDK
   *
   * Loads script from CDN and initializes with environment config.
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
    this.initPromise = new Promise<void>((resolve, reject) => {
      this.loadScript(resolve, reject);
    });

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
   * Set the loading plan name
   * @param planName - Name of the plan currently loading, or null to clear
   */
  public setLoadingPlan(planName: string | null): void {
    this._loadingPlanName.set(planName);
  }

  /**
   * Open Paddle checkout overlay
   *
   * @param options - Checkout configuration with price ID and optional customer email
   */
  public openCheckout(options: CheckoutOptions): void {
    if (!window.Paddle || !this._isReady()) {
      this._error.set('Paddle SDK not ready. Please try again.');
      return;
    }

    // Prevent duplicate checkout if already open
    if (this._isCheckoutOpen()) {
      return;
    }

    this._isLoading.set(true);
    this._isCheckoutOpen.set(true);

    // Set 5-minute timeout to prevent stuck checkout
    this.checkoutTimeoutId = setTimeout(() => {
      this._error.set(
        'Checkout timed out after 5 minutes of inactivity. Please try again.'
      );
      this.closeCheckout();
    }, this.CHECKOUT_TIMEOUT);

    window.Paddle.Checkout.open({
      items: [{ priceId: options.priceId, quantity: 1 }],
      customer: options.customerEmail
        ? { email: options.customerEmail }
        : undefined,
      settings: {
        displayMode: 'overlay',
        theme: 'dark', // Match anubis theme
        locale: 'en',
      },
    });
  }

  /**
   * Close checkout overlay programmatically
   */
  public closeCheckout(): void {
    this.clearCheckoutTimeout();
    if (window.Paddle) {
      window.Paddle.Checkout.close();
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

    // Remove existing script if present
    if (this.scriptElement) {
      this.scriptElement.remove();
      this.scriptElement = null;
    }

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
    const { environment, priceIdMonthly, priceIdYearly } = this.paddleConfig;

    // Check environment is valid
    if (environment !== 'sandbox' && environment !== 'production') {
      this._error.set('Invalid Paddle environment configuration');
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

    const isMonthlyPlaceholder = placeholderPatterns.some(
      (pattern) =>
        !priceIdMonthly || priceIdMonthly.toLowerCase().includes(pattern.toLowerCase())
    );

    const isYearlyPlaceholder = placeholderPatterns.some(
      (pattern) =>
        !priceIdYearly || priceIdYearly.toLowerCase().includes(pattern.toLowerCase())
    );

    if (isMonthlyPlaceholder || isYearlyPlaceholder) {
      this._error.set(
        'Paddle price IDs not configured. Please check environment configuration.'
      );
      return false;
    }

    return true;
  }

  private loadScript(
    resolve: () => void,
    reject: (reason?: Error) => void
  ): void {
    // Check if script already exists
    if (document.querySelector(`script[src="${this.PADDLE_SDK_URL}"]`)) {
      this.initializePaddle(resolve, reject);
      return;
    }

    this.scriptElement = document.createElement('script');
    this.scriptElement.src = this.PADDLE_SDK_URL;
    this.scriptElement.async = true;

    this.scriptElement.onload = () => this.initializePaddle(resolve, reject);
    this.scriptElement.onerror = () => this.handleScriptError(reject);

    document.head.appendChild(this.scriptElement);
  }

  /**
   * Type guard to check if window.Paddle has expected SDK structure
   *
   * @param obj - Object to check (typically window.Paddle)
   * @returns true if obj has Paddle SDK methods, false otherwise
   */
  private isPaddleSDK(obj: unknown): obj is NonNullable<typeof window.Paddle> {
    if (!obj || typeof obj !== 'object') {
      return false;
    }

    const paddle = obj as Record<string, unknown>;

    // Check for required methods using bracket notation for index signatures
    const hasInitialize = typeof paddle['Initialize'] === 'function';
    const checkout = paddle['Checkout'];
    const hasCheckout = typeof checkout === 'object' && checkout !== null;

    if (!hasCheckout) {
      return false;
    }

    const checkoutObj = checkout as Record<string, unknown>;
    const hasOpen = typeof checkoutObj['open'] === 'function';
    const hasClose = typeof checkoutObj['close'] === 'function';

    return hasInitialize && hasOpen && hasClose;
  }

  private initializePaddle(
    resolve: () => void,
    reject: (reason?: Error) => void
  ): void {
    if (!this.isPaddleSDK(window.Paddle)) {
      this.handleScriptError(reject);
      return;
    }

    try {
      window.Paddle.Initialize({
        environment: this.paddleConfig.environment,
        eventCallback: (event) => this.handlePaddleEvent(event),
      });

      this._isReady.set(true);
      this._isLoading.set(false);
      this._error.set(null);
      resolve();
    } catch {
      this.handleScriptError(reject);
    }
  }

  private handleScriptError(reject?: (reason?: Error) => void): void {
    this.initAttempts++;

    if (this.initAttempts < this.MAX_RETRY_ATTEMPTS) {
      // Retry with exponential backoff using extracted method
      this.retryWithBackoff(
        () =>
          new Promise<void>((resolve, reject) => {
            this.loadScript(resolve, reject);
          }),
        this.MAX_RETRY_ATTEMPTS - this.initAttempts,
        this.paddleConfig.baseRetryDelay ?? 1000
      )
        .then(() => {
          // Retry succeeded, nothing to do
        })
        .catch(() => {
          // All retries exhausted
          this._isLoading.set(false);
          this._error.set(
            'Payment system temporarily unavailable. Please try again later.'
          );
          if (reject) {
            reject(new Error('Paddle SDK loading failed after retries'));
          }
        });
    } else {
      this._isLoading.set(false);
      this._error.set(
        'Payment system temporarily unavailable. Please try again later.'
      );
      if (reject) {
        reject(new Error('Paddle SDK loading failed'));
      }
    }
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
        this.http.get<{ active: boolean }>('/api/v1/licenses/me').pipe(
          retry({
            count: this.LICENSE_VERIFY_RETRIES,
            delay: this.LICENSE_VERIFY_DELAY,
          }),
          catchError(() => of({ active: false }))
        )
      );

      this._isVerifying.set(false);
      return result.active;
    } catch {
      this._isVerifying.set(false);
      return false;
    }
  }

  private handlePaddleEvent(event: PaddleEvent): void {
    switch (event.name) {
      case 'checkout.completed':
        this.clearCheckoutTimeout();
        this._isLoading.set(false);
        this._isCheckoutOpen.set(false);
        // Verify license activation with backend before navigation
        this.verifyLicenseActivation().then((isActive) => {
          if (isActive) {
            // Navigate to profile page after successful verification
            this.router.navigate(['/profile']);
          } else {
            // Show error if verification fails
            this._error.set(
              'License verification failed. Please contact support if your payment was processed.'
            );
          }
        });
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
