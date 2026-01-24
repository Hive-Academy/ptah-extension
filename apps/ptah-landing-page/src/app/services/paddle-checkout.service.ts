import { Injectable, signal, inject, computed } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, retry, delay, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

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

  private readonly paddleConfig = environment.paddle;
  private readonly PADDLE_SDK_URL =
    'https://cdn.paddle.com/paddle/v2/paddle.js';
  private readonly MAX_RETRY_ATTEMPTS = 3;
  private readonly LICENSE_VERIFY_RETRIES = 3;
  private readonly LICENSE_VERIFY_DELAY = 2000; // 2 seconds

  // Reactive state signals
  private readonly _isReady = signal(false);
  private readonly _isLoading = signal(false);
  private readonly _error = signal<string | null>(null);
  private readonly _isVerifying = signal(false);

  // Public readonly signals
  public readonly isReady = this._isReady.asReadonly();
  public readonly isLoading = this._isLoading.asReadonly();
  public readonly error = this._error.asReadonly();
  public readonly isVerifying = this._isVerifying.asReadonly();

  // Computed: Can checkout if ready and not loading
  public readonly canCheckout = computed(
    () => this._isReady() && !this._isLoading()
  );

  private initAttempts = 0;
  private scriptElement: HTMLScriptElement | null = null;

  /**
   * Initialize Paddle.js SDK
   *
   * Loads script from CDN and initializes with environment config.
   * Retries up to MAX_RETRY_ATTEMPTS on failure.
   */
  public initialize(): void {
    if (this._isReady() || this._isLoading()) {
      return; // Already initialized or in progress
    }

    this._isLoading.set(true);
    this._error.set(null);
    this.loadScript();
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

    this._isLoading.set(true);

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
    if (window.Paddle) {
      window.Paddle.Checkout.close();
    }
    this._isLoading.set(false);
  }

  /**
   * Retry initialization after failure
   */
  public retryInitialization(): void {
    this.initAttempts = 0;
    this._isReady.set(false);
    this._error.set(null);

    // Remove existing script if present
    if (this.scriptElement) {
      this.scriptElement.remove();
      this.scriptElement = null;
    }

    this.initialize();
  }

  private loadScript(): void {
    // Check if script already exists
    if (document.querySelector(`script[src="${this.PADDLE_SDK_URL}"]`)) {
      this.initializePaddle();
      return;
    }

    this.scriptElement = document.createElement('script');
    this.scriptElement.src = this.PADDLE_SDK_URL;
    this.scriptElement.async = true;

    this.scriptElement.onload = () => this.initializePaddle();
    this.scriptElement.onerror = () => this.handleScriptError();

    document.head.appendChild(this.scriptElement);
  }

  private initializePaddle(): void {
    if (!window.Paddle) {
      this.handleScriptError();
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
      console.log(
        `Paddle SDK initialized in ${this.paddleConfig.environment} mode`
      );
    } catch (err) {
      console.error(err);
      this.handleScriptError();
    }
  }

  private handleScriptError(): void {
    this.initAttempts++;

    if (this.initAttempts < this.MAX_RETRY_ATTEMPTS) {
      // Retry with exponential backoff
      const delay = Math.pow(2, this.initAttempts) * 1000;
      setTimeout(() => this.loadScript(), delay);
    } else {
      this._isLoading.set(false);
      this._error.set(
        'Payment system temporarily unavailable. Please try again later.'
      );
    }
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
    console.log('Paddle event:', event.name, event.data);

    switch (event.name) {
      case 'checkout.completed':
        this._isLoading.set(false);
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
        this._isLoading.set(false);
        // User closed checkout - no action needed
        break;

      case 'checkout.error':
        this._isLoading.set(false);
        // Paddle handles error display in overlay
        break;
    }
  }
}
