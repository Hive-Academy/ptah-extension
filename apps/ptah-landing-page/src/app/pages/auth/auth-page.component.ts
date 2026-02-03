import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

// Child Components
import { AuthFormComponent } from './components/auth-form.component';
import { AuthHeaderComponent } from './components/auth-header.component';
import { AuthFooterComponent } from './components/auth-footer.component';
import { AuthMessagesComponent } from './components/auth-messages.component';
import { AuthHeroComponent } from './components/auth-hero.component';
import { SocialLoginButtonsComponent } from './components/social-login-buttons.component';
import { VerificationCodeComponent } from './components/verification-code.component';

// Services & Types
import { AuthApiService } from './services/auth-api.service';
import { AuthService } from '../../services/auth.service';
import {
  AuthMode,
  AUTH_ERROR_MESSAGES,
  AuthErrorResponse,
} from './models/auth.types';
import { isValidEmail } from './utils/auth-validation.utils';

/**
 * AuthPageComponent - Unified authentication page with split-screen layout
 *
 * Refactored to use child components for better separation of concerns:
 * - AuthHeaderComponent: Logo, title, mode tabs
 * - AuthMessagesComponent: Error/success alerts
 * - AuthFormComponent: Email/password inputs
 * - SocialLoginButtonsComponent: OAuth buttons
 * - AuthFooterComponent: Footer text
 * - AuthHeroComponent: Right-side hero section
 *
 * Features:
 * - Split screen: Form on left, temple image on right
 * - Tab switcher for Sign In / Sign Up
 * - Email/Password authentication
 * - Social login (GitHub, Google)
 * - Magic Link for existing users
 * - Type-safe API integration with license server
 */
@Component({
  selector: 'ptah-auth-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    RouterLink,
    AuthFormComponent,
    AuthHeaderComponent,
    AuthFooterComponent,
    AuthMessagesComponent,
    AuthHeroComponent,
    SocialLoginButtonsComponent,
    VerificationCodeComponent,
  ],
  template: `
    <div class="min-h-screen flex bg-base-100 overflow-hidden">
      <!-- Left Side - Form -->
      <div
        class="w-full lg:w-1/2 flex flex-col justify-center px-8 lg:px-16 xl:px-24 py-12 relative"
      >
        <!-- Subtle gradient background -->
        <div
          class="absolute inset-0 bg-gradient-to-br from-base-100 via-base-100 to-secondary/5 pointer-events-none"
          aria-hidden="true"
        ></div>

        <!-- Animated glow orb -->
        <div
          class="absolute top-1/4 -left-32 w-64 h-64 bg-secondary/10 rounded-full blur-3xl animate-pulse-slow pointer-events-none"
          aria-hidden="true"
        ></div>

        <div class="relative z-10 max-w-md mx-auto w-full">
          @if (showVscodeSuccess()) {
          <!-- VS Code Post-Signup Success Screen -->
          <div class="flex flex-col items-center text-center gap-6 py-8">
            <div
              class="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="w-8 h-8 text-success"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <h2 class="text-2xl font-bold text-base-content">
              Account Created Successfully!
            </h2>
            <div class="flex flex-col gap-3 text-base-content/70">
              <p>
                Check your email for your <strong>license key</strong>. It will
                look like:
              </p>
              <code
                class="bg-base-200 px-4 py-2 rounded-lg text-sm font-mono text-base-content/80"
              >
                ptah_lic_...
              </code>
              <p>
                Copy the license key and paste it into the
                <strong>Ptah extension</strong> in VS Code to activate your
                account.
              </p>
            </div>
            <div class="divider text-xs text-base-content/40">What's next?</div>
            <ol
              class="text-left text-sm text-base-content/70 space-y-2 w-full max-w-xs"
            >
              <li class="flex gap-2">
                <span
                  class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold"
                  >1</span
                >
                <span>Check your email for the license key</span>
              </li>
              <li class="flex gap-2">
                <span
                  class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold"
                  >2</span
                >
                <span>Go back to VS Code</span>
              </li>
              <li class="flex gap-2">
                <span
                  class="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary text-xs flex items-center justify-center font-bold"
                  >3</span
                >
                <span>Paste the license key in the Ptah welcome screen</span>
              </li>
            </ol>
            <a
              routerLink="/profile"
              class="btn btn-ghost btn-sm text-base-content/60 mt-4"
            >
              Or continue to your profile →
            </a>
          </div>
          } @else if (pendingVerification()) {
          <!-- Email Verification Flow -->
          <!-- Messages: Errors & Success -->
          <ptah-auth-messages
            [urlError]="''"
            [successMessage]="successMessage()"
            [errorMessage]="errorMessage()"
          />

          <ptah-verification-code
            [email]="pendingEmail()"
            [isLoading]="isLoading()"
            [isResending]="isResending()"
            (verify)="handleVerifyCode($event)"
            (resend)="handleResendCode()"
            (back)="handleBackToSignup()"
          />
          } @else {
          <!-- Header: Logo, Title, Tabs -->
          <ptah-auth-header
            [mode]="mode()"
            [isTransitioning]="isTransitioning()"
            (modeChange)="setMode($event)"
          />

          <!-- Messages: Errors & Success -->
          <ptah-auth-messages
            [urlError]="urlError()"
            [successMessage]="successMessage()"
            [errorMessage]="errorMessage()"
          />

          <!-- Form: Email & Password -->
          <ptah-auth-form
            [mode]="mode()"
            [isLoading]="isLoading()"
            (formSubmit)="handleFormSubmit($event)"
            (emailChange)="onEmailChange($event)"
          />

          <!-- Social Login Buttons -->
          <ptah-social-login-buttons
            [mode]="mode()"
            [emailValid]="hasValidEmail()"
            (githubClick)="loginWithGitHub()"
            (googleClick)="loginWithGoogle()"
            (magicLinkClick)="sendMagicLink()"
          />

          <!-- Footer -->
          <ptah-auth-footer [mode]="mode()" />
          }
        </div>
      </div>

      <!-- Right Side - Hero Image -->
      <ptah-auth-hero />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Slow pulse animation for glow orb */
      @keyframes pulse-slow {
        0%,
        100% {
          opacity: 0.3;
          transform: scale(1);
        }
        50% {
          opacity: 0.5;
          transform: scale(1.1);
        }
      }

      .animate-pulse-slow {
        animation: pulse-slow 4s ease-in-out infinite;
      }
    `,
  ],
})
export class AuthPageComponent implements OnInit {
  private readonly authApi = inject(AuthApiService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  /** Reference to the form component for resetting */
  private readonly authForm = viewChild(AuthFormComponent);

  // ============================================
  // STATE SIGNALS
  // ============================================

  /** Current authentication mode */
  public readonly mode = signal<AuthMode>('signin');

  /** Whether transitioning between modes */
  public readonly isTransitioning = signal(false);

  /** Loading state for API calls */
  public readonly isLoading = signal(false);

  /** Success message to display */
  public readonly successMessage = signal('');

  /** Error message to display */
  public readonly errorMessage = signal('');

  /** Email value from form (for magic link validation) */
  private readonly currentEmail = signal('');

  /** Return URL after successful login (from query params) */
  private readonly returnUrl = signal<string | null>(null);

  /** Selected plan for auto-checkout after login (from query params) */
  private readonly selectedPlan = signal<string | null>(null);

  /** Source of signup (e.g., 'vscode' for VS Code extension users) */
  private readonly source = signal<string | null>(null);

  /** Whether to show VS Code post-signup success screen */
  public readonly showVscodeSuccess = signal(false);

  // ============================================
  // EMAIL VERIFICATION STATE
  // ============================================

  /** Whether waiting for email verification */
  public readonly pendingVerification = signal(false);

  /** User ID for verification (from signup response) */
  private readonly pendingUserId = signal('');

  /** Email for verification display */
  public readonly pendingEmail = signal('');

  /** Resending verification code state */
  public readonly isResending = signal(false);

  // ============================================
  // COMPUTED SIGNALS
  // ============================================

  /** URL error from query params */
  public readonly urlError = computed(() => {
    const error = this.route.snapshot.queryParamMap.get('error');
    if (!error) return '';
    return AUTH_ERROR_MESSAGES[error] || 'An error occurred. Please try again.';
  });

  /** Whether email is valid (for magic link button) */
  public readonly hasValidEmail = computed(() =>
    isValidEmail(this.currentEmail())
  );

  // ============================================
  // LIFECYCLE
  // ============================================

  public ngOnInit(): void {
    // Set mode based on current route
    const path = this.route.snapshot.routeConfig?.path;
    if (path === 'signup') {
      this.mode.set('signup');
    }

    // Capture return URL and plan from query params
    // These are set when redirecting from pricing page for unauthenticated checkout
    const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
    const plan = this.route.snapshot.queryParamMap.get('plan');

    if (returnUrl) {
      this.returnUrl.set(returnUrl);
    }
    if (plan) {
      this.selectedPlan.set(plan);
    }

    // Capture source (e.g., 'vscode') for post-signup welcome screen
    const source = this.route.snapshot.queryParamMap.get('source');
    if (source) {
      this.source.set(source);
    }
  }

  // ============================================
  // MODE SWITCHING
  // ============================================

  /**
   * Handle email changes from form (for magic link validation)
   */
  public onEmailChange(email: string): void {
    this.currentEmail.set(email);
  }

  /**
   * Switch between signin and signup modes with smooth transition
   */
  public setMode(newMode: AuthMode): void {
    if (this.mode() === newMode) return;

    // Trigger transition state for CSS animations
    this.isTransitioning.set(true);

    setTimeout(() => {
      this.mode.set(newMode);
      this.successMessage.set('');
      this.errorMessage.set('');

      // Reset form password
      this.authForm()?.resetPassword();

      // Update URL without navigation
      const newPath = newMode === 'signup' ? '/signup' : '/login';
      this.router.navigate([newPath], { replaceUrl: true });

      // End transition
      setTimeout(() => {
        this.isTransitioning.set(false);
      }, 100);
    }, 150);
  }

  // ============================================
  // FORM SUBMISSION
  // ============================================

  /**
   * Handle form submission (email/password)
   */
  public handleFormSubmit(credentials: {
    email: string;
    password: string;
  }): void {
    this.currentEmail.set(credentials.email);
    this.successMessage.set('');
    this.errorMessage.set('');
    this.isLoading.set(true);

    if (this.mode() === 'signin') {
      this.loginWithEmailPassword(credentials.email, credentials.password);
    } else {
      this.signupWithEmailPassword(credentials.email, credentials.password);
    }
  }

  /**
   * Login with email and password
   */
  private loginWithEmailPassword(email: string, password: string): void {
    this.authApi.loginWithEmail({ email, password }).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        if (response.success) {
          this.navigateAfterAuth();
        }
      },
      error: (error: AuthErrorResponse) => {
        this.isLoading.set(false);

        // Check if email verification is required
        if (error.code === 'email_verification_required' && error.userId) {
          // Show verification UI
          this.pendingVerification.set(true);
          this.pendingUserId.set(error.userId);
          this.pendingEmail.set(error.email || email);
          this.successMessage.set(
            'A verification code has been sent to your email.'
          );
          this.errorMessage.set('');
          return;
        }

        this.errorMessage.set(
          error.message || 'Invalid email or password. Please try again.'
        );
      },
    });
  }

  /**
   * Navigate to appropriate page after successful authentication
   * If returnUrl and plan were set (from pricing redirect), goes back with autoCheckout param
   * Otherwise, defaults to profile page
   */
  private navigateAfterAuth(): void {
    // Set auth hint so future auth checks don't make unnecessary API calls
    this.authService.setAuthHint();

    // VS Code extension users: show inline success screen with license key instructions
    if (this.source() === 'vscode') {
      this.showVscodeSuccess.set(true);
      return;
    }

    const returnUrl = this.returnUrl();
    const plan = this.selectedPlan();

    if (returnUrl) {
      // Build query params for return URL (e.g., /pricing?autoCheckout=pro-monthly)
      const queryParams = plan ? { autoCheckout: plan } : {};
      this.router.navigate([returnUrl], { queryParams });
    } else {
      // Default: go to profile
      this.router.navigate(['/profile']);
    }
  }

  /**
   * Sign up with email and password
   * Now returns pending verification status instead of immediate login
   */
  private signupWithEmailPassword(email: string, password: string): void {
    this.authApi.signup({ email, password }).subscribe({
      next: (response) => {
        this.isLoading.set(false);
        if (response.success && response.pendingVerification) {
          // Show verification code input
          this.pendingVerification.set(true);
          this.pendingUserId.set(response.userId);
          this.pendingEmail.set(response.email);
          this.successMessage.set('');
          this.errorMessage.set('');
        }
      },
      error: (error: AuthErrorResponse) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.message || 'Failed to create account. Please try again.'
        );
      },
    });
  }

  // ============================================
  // EMAIL VERIFICATION METHODS
  // ============================================

  /**
   * Handle verification code submission
   */
  public handleVerifyCode(code: string): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.isLoading.set(true);

    this.authApi
      .verifyEmail({
        userId: this.pendingUserId(),
        code,
      })
      .subscribe({
        next: (response) => {
          this.isLoading.set(false);
          if (response.success) {
            // Clear pending state
            this.pendingVerification.set(false);
            this.pendingUserId.set('');
            this.pendingEmail.set('');
            // Navigate to return URL or profile
            this.navigateAfterAuth();
          }
        },
        error: (error: AuthErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            error.message || 'Invalid verification code. Please try again.'
          );
        },
      });
  }

  /**
   * Handle resend verification code
   */
  public handleResendCode(): void {
    this.errorMessage.set('');
    this.isResending.set(true);

    this.authApi
      .resendVerificationCode({
        userId: this.pendingUserId(),
      })
      .subscribe({
        next: (response) => {
          this.isResending.set(false);
          this.successMessage.set(response.message);
        },
        error: (error: AuthErrorResponse) => {
          this.isResending.set(false);
          this.errorMessage.set(
            error.message || 'Failed to resend code. Please try again.'
          );
        },
      });
  }

  /**
   * Handle back to signup form
   */
  public handleBackToSignup(): void {
    this.pendingVerification.set(false);
    this.pendingUserId.set('');
    this.pendingEmail.set('');
    this.errorMessage.set('');
    this.successMessage.set('');
  }

  // ============================================
  // OAUTH METHODS
  // ============================================

  /**
   * Login with GitHub OAuth
   * Passes returnUrl and plan to the OAuth flow for post-auth redirect
   */
  public loginWithGitHub(): void {
    const returnUrl = this.returnUrl();
    const plan = this.selectedPlan();
    this.authApi.loginWithGitHub(returnUrl, plan);
  }

  /**
   * Login with Google OAuth
   * Passes returnUrl and plan to the OAuth flow for post-auth redirect
   */
  public loginWithGoogle(): void {
    const returnUrl = this.returnUrl();
    const plan = this.selectedPlan();
    this.authApi.loginWithGoogle(returnUrl, plan);
  }

  // ============================================
  // MAGIC LINK
  // ============================================

  /**
   * Send magic link for passwordless login
   * Passes returnUrl and plan to preserve checkout intent after auth
   */
  public sendMagicLink(): void {
    const email = this.currentEmail();
    if (!isValidEmail(email)) {
      this.errorMessage.set('Please enter a valid email address');
      return;
    }

    this.successMessage.set('');
    this.errorMessage.set('');
    this.isLoading.set(true);

    // Include returnUrl and plan so checkout intent is preserved after magic link auth
    const returnUrl = this.returnUrl();
    const plan = this.selectedPlan();

    this.authApi
      .requestMagicLink({
        email,
        returnUrl: returnUrl ?? undefined,
        plan: plan ?? undefined,
      })
      .subscribe({
        next: () => {
          this.isLoading.set(false);
          this.successMessage.set(
            'Magic link sent! Check your email and click the link to sign in.'
          );
        },
        error: (error: AuthErrorResponse) => {
          this.isLoading.set(false);
          this.errorMessage.set(
            error.message || 'Failed to send magic link. Please try again.'
          );
        },
      });
  }
}
